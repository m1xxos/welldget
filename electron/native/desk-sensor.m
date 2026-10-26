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

typedef enum {
    MOTION_IDLE = 0,
    MOTION_UP = 1,
    MOTION_DOWN = 2
} MotionPhase;

static DeskState current_state = STATE_SITTING;
static MotionPhase motion_phase = MOTION_IDLE;
static BOOL test_mode = NO;
static CFRunLoopRef main_run_loop = NULL;

// Gravity baseline
static double base_gx = 0.0, base_gy = 0.0, base_gz = -1.0;
static BOOL calibrated = NO;
static int warmup_samples = 0;

// High-frequency vibration tracking (motor hum vs quiet)
static double prev_az = -1.0;
static double vibe_energy = 0.0;

// Gyroscope tracking
static double current_gyro_deg_s = 0.0;

// Motion kinematics & state machine
static double last_accel_time = 0.0;
static double vel_z = 0.0;
static double motion_dur = 0.0;
static double est_displacement = 0.0;
static double quiet_dur = 0.0;
static double cooldown_dur = 0.0;

static inline double get_monotonic_time() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static void emit_json(const char *json) {
    printf("%s\n", json);
    fflush(stdout);
}

static void emit_state_change(DeskState new_state, double duration, double confidence, double delta_pos) {
    current_state = new_state;
    char buf[256];
    snprintf(buf, sizeof(buf),
             "{\"event\":\"state\",\"state\":\"%s\",\"duration\":%.2f,\"confidence\":%.2f,\"delta_pos\":%.3f}",
             (new_state == STATE_STANDING ? "standing" : "sitting"),
             duration, confidence, delta_pos);
    emit_json(buf);
}

static void process_gyro(double gx, double gy, double gz) {
    current_gyro_deg_s = sqrt(gx * gx + gy * gy + gz * gz);
}

static void process_accel(double ax, double ay, double az, double t) {
    if (last_accel_time == 0.0) {
        last_accel_time = t;
        base_gx = ax; base_gy = ay; base_gz = az;
        prev_az = az;
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
        prev_az = az;
        if (warmup_samples >= 75) {
            calibrated = YES;
            char buf[128];
            snprintf(buf, sizeof(buf), "{\"event\":\"status\",\"ready\":true,\"sensor\":\"AppleSPU\"}");
            emit_json(buf);
        }
        return;
    }

    // 2. High-frequency vibration tracking (40-120 Hz motor hum)
    double raw_diff = az - prev_az;
    prev_az = az;
    vibe_energy = 0.96 * vibe_energy + 0.04 * (raw_diff * raw_diff);
    double vibe_rms_mg = sqrt(vibe_energy) * 1000.0;

    // 3. Project dynamic linear acceleration along gravity vector (in m/s^2)
    double g_norm = sqrt(base_gx * base_gx + base_gy * base_gy + base_gz * base_gz);
    if (g_norm < 1e-3) g_norm = 1.0;
    double unit_gx = base_gx / g_norm;
    double unit_gy = base_gy / g_norm;
    double unit_gz = base_gz / g_norm;

    // Upward dynamic acceleration: positive when accelerating UP, negative when DOWN
    double lin_acc = ((ax - base_gx) * unit_gx +
                      (ay - base_gy) * unit_gy +
                      (az - base_gz) * unit_gz) * 9.80665;

    // 4. Post-transition Cooldown (allows braking spike to fully dissipate)
    if (cooldown_dur > 0.0) {
        cooldown_dur -= dt;
        motion_phase = MOTION_IDLE;
        vel_z = 0.0;
        motion_dur = 0.0;
        est_displacement = 0.0;
        quiet_dur = 0.0;
        // Settle baseline gently if stationary
        if (current_gyro_deg_s < 0.8 && fabs(lin_acc) < 0.03) {
            base_gx = 0.995 * base_gx + 0.005 * ax;
            base_gy = 0.995 * base_gy + 0.005 * ay;
            base_gz = 0.995 * base_gz + 0.005 * az;
        }
        return;
    }

    // 5. Gyroscope gating: picking up or carrying laptop cancels motion
    if (current_gyro_deg_s > 2.5) {
        motion_phase = MOTION_IDLE;
        motion_dur = 0.0;
        est_displacement = 0.0;
        vel_z = 0.0;
        quiet_dur = 0.0;
        return;
    }

    // 6. Kinematic State Machine
    if (motion_phase == MOTION_IDLE) {
        // Continuous baseline adaptation when resting:
        // Automatically absorbs static desk flex from resting forearms/elbows
        if (current_gyro_deg_s < 0.8 && fabs(lin_acc) < 0.03) {
            base_gx = 0.9985 * base_gx + 0.0015 * ax;
            base_gy = 0.9985 * base_gy + 0.0015 * ay;
            base_gz = 0.9985 * base_gz + 0.0015 * az;
        }

        // Leaky velocity in idle state (prevents unbounded drift from zero-g noise)
        vel_z = 0.997 * vel_z + lin_acc * dt;

        // Motion trigger condition:
        // Real desk ramp creates sustained velocity > 5 mm/s and directional acceleration
        if (vel_z > 0.005 && lin_acc > 0.004) {
            motion_phase = MOTION_UP;
            motion_dur = dt;
            est_displacement = 0.0;
            quiet_dur = 0.0;
        } else if (vel_z < -0.005 && lin_acc < -0.004) {
            motion_phase = MOTION_DOWN;
            motion_dur = dt;
            est_displacement = 0.0;
            quiet_dur = 0.0;
        }
    } else {
        // Active motion tracking
        motion_dur += dt;

        // Maintain constant cruise speed if motor vibration is present
        if (vibe_rms_mg > 1.0) {
            if (motion_phase == MOTION_UP && vel_z < 0.030) {
                vel_z = 0.995 * vel_z + 0.005 * 0.042;
            } else if (motion_phase == MOTION_DOWN && vel_z > -0.030) {
                vel_z = 0.995 * vel_z + 0.005 * (-0.043);
            }
        } else {
            vel_z = 0.998 * vel_z + lin_acc * dt;
        }

        est_displacement += vel_z * dt;

        // Braking detection: motor vibration ends or sharp brake deceleration occurs
        BOOL is_braking = NO;
        if (motion_phase == MOTION_UP && (lin_acc < -0.050 || (vibe_rms_mg < 0.85 && motion_dur > 2.0))) {
            is_braking = YES;
        }
        if (motion_phase == MOTION_DOWN && (lin_acc > 0.050 || (vibe_rms_mg < 0.85 && motion_dur > 2.0))) {
            is_braking = YES;
        }

        if (is_braking || fabs(vel_z) < 0.005) {
            quiet_dur += dt;
        } else {
            quiet_dur = fmax(0.0, quiet_dur - dt * 2.0);
        }

        // Confirmation requirement:
        // Duration MUST be >= 3.0 seconds AND displacement MUST be >= 10 cm!
        // Rejects all typing, bumps, leaning, chair shifts (< 1.0s, < 1 cm).
        if (quiet_dur >= 0.4 || motion_dur > 15.0) {
            if (motion_phase == MOTION_UP) {
                if (motion_dur >= 3.0 && est_displacement >= 0.10) {
                    emit_state_change(STATE_STANDING, motion_dur, 0.99, est_displacement);
                    cooldown_dur = 3.0;
                }
            } else if (motion_phase == MOTION_DOWN) {
                if (motion_dur >= 3.0 && est_displacement <= -0.10) {
                    emit_state_change(STATE_SITTING, motion_dur, 0.99, est_displacement);
                    cooldown_dur = 3.0;
                }
            }

            // Reset motion state
            motion_phase = MOTION_IDLE;
            motion_dur = 0.0;
            est_displacement = 0.0;
            vel_z = 0.0;
            quiet_dur = 0.0;
        }
    }

    if (test_mode) {
        static int print_count = 0;
        if (++print_count % 30 == 0) {
            printf("\r[t=%.1fs] State=%s Motion=%s Acc=%+.1fmm/s^2 Vel=%+.1fmm/s Disp=%+.1fcm Vibe=%.2fmg Gyro=%.1f°/s   ",
                   t, (current_state == STATE_STANDING ? "STAND" : "SIT"),
                   (motion_phase == MOTION_UP ? "UP" : (motion_phase == MOTION_DOWN ? "DOWN" : "IDLE")),
                   lin_acc * 1000.0, vel_z * 1000.0, est_displacement * 100.0, vibe_rms_mg, current_gyro_deg_s);
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
