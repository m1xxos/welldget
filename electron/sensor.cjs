const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

class DeskSensorManager {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.child = null;
    this.rl = null;
    this.sensorAvailable = process.platform === 'darwin' && process.arch === 'arm64';
    this.ready = false;
    this.deskState = 'sitting';
    this.stopped = false;
    this.restartTimer = null;
    this.restartAttempts = 0;
  }

  getBinaryPath() {
    const directPath = path.join(__dirname, 'bin', 'desk-sensor');
    const unpackedPath = directPath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpackedPath)) return unpackedPath;

    if (process.resourcesPath) {
      const resUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', 'desk-sensor');
      if (fs.existsSync(resUnpacked)) return resUnpacked;
      const prodPath = path.join(process.resourcesPath, 'electron', 'bin', 'desk-sensor');
      if (fs.existsSync(prodPath)) return prodPath;
    }
    return directPath;
  }

  isSupported() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return false;
    return fs.existsSync(this.getBinaryPath());
  }

  start(initialState) {
    if (initialState) this.deskState = initialState;
    this.stopped = false;
    if (this.child) return;

    const binPath = this.getBinaryPath();
    if (!fs.existsSync(binPath)) {
      this.sensorAvailable = false;
      this.ready = false;
      this.onStatusChange({ available: false, ready: false, error: 'Binary not found' });
      return;
    }

    try {
      const args = ['--current', this.deskState];
      this.child = spawn(binPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.rl = readline.createInterface({
        input: this.child.stdout,
        terminal: false,
      });

      this.rl.on('line', (line) => {
        line = line.trim();
        if (!line) return;
        try {
          const data = JSON.parse(line);
          this.handleEvent(data);
        } catch (e) {
          // Non-JSON line or debug text
        }
      });

      this.child.stderr.on('data', () => {});

      this.child.on('error', (err) => {
        this.sensorAvailable = false;
        this.ready = false;
        this.onStatusChange({ available: false, ready: false, error: err.message });
      });

      this.child.on('exit', (code, signal) => {
        this.child = null;
        this.rl = null;
        if (!this.stopped) {
          this.ready = false;
          this.onStatusChange({ available: this.sensorAvailable, ready: false });
          // Auto-restart if unexpected exit
          if (this.restartAttempts < 5) {
            this.restartAttempts++;
            this.restartTimer = setTimeout(() => this.start(), 3000);
          }
        }
      });
    } catch (err) {
      this.sensorAvailable = false;
      this.ready = false;
      this.onStatusChange({ available: false, ready: false, error: err.message });
    }
  }

  handleEvent(data) {
    if (data.event === 'status') {
      this.sensorAvailable = !!data.ready;
      this.ready = !!data.ready;
      this.restartAttempts = 0;
      this.onStatusChange({ available: this.sensorAvailable, ready: this.ready });
    } else if (data.event === 'state') {
      if (data.state && data.state !== this.deskState) {
        this.deskState = data.state;
        this.onStateChange({
          state: data.state,
          duration: data.duration,
          confidence: data.confidence,
          deltaPos: data.delta_pos,
        });
      }
    } else if (data.event === 'error') {
      this.sensorAvailable = false;
      this.ready = false;
      this.onStatusChange({ available: false, ready: false, error: data.message });
    }
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch (e) {}
      this.child = null;
      this.rl = null;
    }
    this.ready = false;
  }
}

module.exports = { DeskSensorManager };
