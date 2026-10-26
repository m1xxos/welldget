#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/hid/IOHIDDevice.h>
#import <math.h>
#import <signal.h>
#import <time.h>
#import <unistd.h>

// Current states
typedef enum {
    STATE_SITTING = 0,
    STATE_STANDING = 1
} DeskState;

static DeskState current_state = STATE_SITTING;
static BOOL test_mode = NO;
static CFRunLoopRef main_run_loop = NULL;

// Gravity baseline
static double base_gx = 0.0, base_gy = 0.0, base_gz = -1.0;
static BOOL calibrated = NO;
static int warmup_samples = 0;

// Gyroscope tracking
static double current_gyro_deg_s = 0.0;

// Motion kinematics: drift-free low-pass filtered acceleration
static double smooth_acc = 0.0;
static double last_accel_time = 0.0;
static double up_dur = 0.0;
static double down_dur = 0.0;

static inline double get_monotonic_time() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static void emit_json(const char *json) {
    printf("%s\n", json);
    fflush(stdout);
}

static void emit_state_change(DeskState new_state, double duration, double confidence, double acc) {
    current_state = new_state;
    char buf[256];
    snprintf(buf, sizeof(buf),
             "{\"event\":\"state\",\"state\":\"%s\",\"duration\":%.2f,\"confidence\":%.2f,\"smooth_acc\":%.4f}",
             (new_state == STATE_STANDING ? "standing" : "sitting"),
             duration, confidence, acc);
    emit_json(buf);
}

static void process_gyro(double gx, double gy, double gz) {
    current_gyro_deg_s = sqrt(gx * gx + gy * gy + gz * gz);
}

static void process_accel(double ax, double ay, double az, double t) {
    if (last_accel_time == 0.0) {
        last_accel_time = t;
        base_gx = ax; base_gy = ay; base_gz = az;
        return;
    }

    double dt = t - last_accel_time;
    last_accel_time = t;
    if (dt <= 0.0 || dt > 0.05) return;

    // 1. Initial warmup / baseline calibration (first 75 samples ~ 0.3s)
    if (!calibrated) {
        warmup_samples++;
        base_gx = 0.95 * base_gx + 0.05 * ax;
        base_gy = 0.95 * base_gy + 0.05 * ay;
        base_gz = 0.95 * base_gz + 0.05 * az;
        if (warmup_samples >= 75) {
            calibrated = YES;
            char buf[128];
            snprintf(buf, sizeof(buf), "{\"event\":\"status\",\"ready\":true,\"sensor\":\"AppleSPU\"}");
            emit_json(buf);
        }
        return;
    }

    // 2. Project dynamic acceleration along the gravity axis (in m/s^2)
    double g_norm = sqrt(base_gx * base_gx + base_gy * base_gy + base_gz * base_gz);
    if (g_norm < 1e-3) g_norm = 1.0;
    double unit_gx = base_gx / g_norm;
    double unit_gy = base_gy / g_norm;
    double unit_gz = base_gz / g_norm;

    // Upward dynamic acceleration: positive when moving UP
    double lin_acc_vertical = ((ax - base_gx) * unit_gx +
                               (ay - base_gy) * unit_gy +
                               (az - base_gz) * unit_gz) * 9.80665;

    // 3. Low-pass filtered acceleration (tau ≈ 0.4s) — mathematically drift-free!
    smooth_acc = 0.992 * smooth_acc + 0.008 * lin_acc_vertical;

    // Slow baseline adaptation when completely quiet
    if (fabs(smooth_acc) < 0.002 && current_gyro_deg_s < 0.5) {
        base_gx = 0.9995 * base_gx + 0.0005 * ax;
        base_gy = 0.9995 * base_gy + 0.0005 * ay;
        base_gz = 0.9995 * base_gz + 0.0005 * az;
    }

    // 4. Gyroscope gating: picking up or carrying laptop resets direction timers
    if (current_gyro_deg_s > 2.5) {
        up_dur = 0.0;
        down_dur = 0.0;
    } else {
        // Sustained acceleration in one direction:
        // Real desk measurements: UP start = +11 mm/s^2, DOWN start = -10 mm/s^2
        if (smooth_acc > 0.0035) { // +3.5 mm/s^2 sustained upward
            up_dur += dt;
            down_dur = 0.0;
            if (up_dur >= 1.5 && current_state != STATE_STANDING) {
                emit_state_change(STATE_STANDING, up_dur, 0.98, smooth_acc);
            }
        } else if (smooth_acc < -0.0035) { // -3.5 mm/s^2 sustained downward
            down_dur += dt;
            up_dur = 0.0;
            if (down_dur >= 1.5 && current_state != STATE_SITTING) {
                emit_state_change(STATE_SITTING, down_dur, 0.98, smooth_acc);
            }
        } else {
            up_dur = fmax(0.0, up_dur - dt * 2.0);
            down_dur = fmax(0.0, down_dur - dt * 2.0);
        }
    }

    if (test_mode) {
        static int print_count = 0;
        if (++print_count % 30 == 0) {
            printf("\r[t=%.1fs] Acc=%+.2fmm/s^2 UpDur=%.1fs DownDur=%.1fs Gyro=%.1f°/s State=%s   ",
                   t, smooth_acc * 1000.0, up_dur, down_dur, current_gyro_deg_s,
                   (current_state == STATE_STANDING ? "STANDING" : "SITTING"));
            fflush(stdout);
        }
    }
}

// HID Callbacks
static void on_accel_report(void *context, IOReturn result, void *sender,
                            IOHIDReportType type, uint32_t reportID,
                            uint8_t *report, CFIndex reportLength) {
    if (reportLength == 22) {
        int32_t x_raw = *(int32_t *)(report + 6);
        int32_t y_raw = *(int32_t *)(report + 10);
        int32_t z_raw = *(int32_t *)(report + 14);

        double x = (double)x_raw / 65536.0;
        double y = (double)y_raw / 65536.0;
        double z = (double)z_raw / 65536.0;
        double t = get_monotonic_time();

        process_accel(x, y, z, t);
    }
}

static void on_gyro_report(void *context, IOReturn result, void *sender,
                           IOHIDReportType type, uint32_t reportID,
                           uint8_t *report, CFIndex reportLength) {
    if (reportLength == 22) {
        int32_t gx_raw = *(int32_t *)(report + 6);
        int32_t gy_raw = *(int32_t *)(report + 10);
        int32_t gz_raw = *(int32_t *)(report + 14);

        double gx = (double)gx_raw / 65536.0;
        double gy = (double)gy_raw / 65536.0;
        double gz = (double)gz_raw / 65536.0;

        process_gyro(gx, gy, gz);
    }
}

static void signal_handler(int sig) {
    if (main_run_loop) {
        CFRunLoopStop(main_run_loop);
    }
}

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "--test") == 0 || strcmp(argv[i], "-t") == 0) {
                test_mode = YES;
            } else if (strcmp(argv[i], "--current") == 0 && i + 1 < argc) {
                if (strcmp(argv[i+1], "standing") == 0) {
                    current_state = STATE_STANDING;
                } else {
                    current_state = STATE_SITTING;
                }
                i++;
            }
        }

        signal(SIGINT, signal_handler);
        signal(SIGTERM, signal_handler);

        // 1. Wake AppleSPUHIDDriver
        io_iterator_t driver_it;
        kern_return_t kr = IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSPUHIDDriver"), &driver_it);
        if (kr != KERN_SUCCESS) {
            emit_json("{\"event\":\"error\",\"message\":\"Failed to find AppleSPUHIDDriver\"}");
            return 1;
        }

        io_service_t driver_svc;
        int drivers_woken = 0;
        while ((driver_svc = IOIteratorNext(driver_it))) {
            int state_val = 1;
            int interval_us = 4000; // 250 Hz
            CFNumberRef num_one = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &state_val);
            CFNumberRef num_interval = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &interval_us);

            IORegistryEntrySetCFProperty(driver_svc, CFSTR("SensorPropertyReportingState"), num_one);
            IORegistryEntrySetCFProperty(driver_svc, CFSTR("SensorPropertyPowerState"), num_one);
            IORegistryEntrySetCFProperty(driver_svc, CFSTR("ReportInterval"), num_interval);

            CFRelease(num_one);
            CFRelease(num_interval);
            IOObjectRelease(driver_svc);
            drivers_woken++;
        }
        IOObjectRelease(driver_it);

        if (drivers_woken == 0) {
            emit_json("{\"event\":\"error\",\"message\":\"No AppleSPUHIDDriver instances available\"}");
            return 2;
        }

        // 2. Open SPU HID Devices (accel and gyro)
        io_iterator_t dev_it;
        kr = IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSPUHIDDevice"), &dev_it);
        if (kr != KERN_SUCCESS) {
            emit_json("{\"event\":\"error\",\"message\":\"Failed to find AppleSPUHIDDevice\"}");
            return 3;
        }

        io_service_t dev_svc;
        static uint8_t accel_buf[1024];
        static uint8_t gyro_buf[1024];
        BOOL accel_opened = NO;
        BOOL gyro_opened = NO;

        main_run_loop = CFRunLoopGetCurrent();

        while ((dev_svc = IOIteratorNext(dev_it))) {
            CFTypeRef upRef = IORegistryEntryCreateCFProperty(dev_svc, CFSTR("PrimaryUsagePage"), kCFAllocatorDefault, 0);
            CFTypeRef uRef = IORegistryEntryCreateCFProperty(dev_svc, CFSTR("PrimaryUsage"), kCFAllocatorDefault, 0);
            int up = 0, u = 0;
            if (upRef) { CFNumberGetValue((CFNumberRef)upRef, kCFNumberIntType, &up); CFRelease(upRef); }
            if (uRef) { CFNumberGetValue((CFNumberRef)uRef, kCFNumberIntType, &u); CFRelease(uRef); }

            if (up == 0xFF00 && u == 3) {
                IOHIDDeviceRef hid = IOHIDDeviceCreate(kCFAllocatorDefault, dev_svc);
                if (hid && IOHIDDeviceOpen(hid, kIOHIDOptionsTypeNone) == kIOReturnSuccess) {
                    IOHIDDeviceRegisterInputReportCallback(hid, accel_buf, sizeof(accel_buf), on_accel_report, NULL);
                    IOHIDDeviceScheduleWithRunLoop(hid, main_run_loop, kCFRunLoopDefaultMode);
                    accel_opened = YES;
                }
            } else if (up == 0xFF00 && u == 9) {
                IOHIDDeviceRef hid = IOHIDDeviceCreate(kCFAllocatorDefault, dev_svc);
                if (hid && IOHIDDeviceOpen(hid, kIOHIDOptionsTypeNone) == kIOReturnSuccess) {
                    IOHIDDeviceRegisterInputReportCallback(hid, gyro_buf, sizeof(gyro_buf), on_gyro_report, NULL);
                    IOHIDDeviceScheduleWithRunLoop(hid, main_run_loop, kCFRunLoopDefaultMode);
                    gyro_opened = YES;
                }
            }
            IOObjectRelease(dev_svc);
        }
        IOObjectRelease(dev_it);

        if (!accel_opened) {
            emit_json("{\"event\":\"error\",\"message\":\"Failed to open accelerometer device\"}");
            return 4;
        }

        if (test_mode) {
            printf("Sensor running in TEST mode (Accel: %d, Gyro: %d). Press Ctrl+C to stop.\n",
                   accel_opened, gyro_opened);
        }

        CFRunLoopRun();

        if (test_mode) {
            printf("\nSensor terminated.\n");
        }
    }
    return 0;
}
