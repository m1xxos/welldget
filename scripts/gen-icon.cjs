// Dependency-free icon generator: draws the welldget mark (sage rounded square
// with a cream progress ring + checkmark) and a monochrome menu-bar template.
// Outputs build/icon.png (1024) and electron/trayTemplate{,@2x}.png.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// ---- minimal PNG writer (RGBA, 8-bit) ----
const CRC_T = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(file, n, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < n * 4; x++) raw[y * (n * 4 + 1) + 1 + x] = rgba[y * n * 4 + x];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

// ---- geometry helpers ----
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function mix(c, d, a) { return [c[0] + (d[0] - c[0]) * a, c[1] + (d[1] - c[1]) * a, c[2] + (d[2] - c[2]) * a]; }

const CREAM = [247, 240, 226];
const SAGE_TOP = [174, 191, 146];
const SAGE_BOT = [124, 143, 96];

// ---- full-colour app icon ----
function genAppIcon(N) {
  const buf = new Uint8ClampedArray(N * N * 4);
  const PAD = N * 0.085, R = N * 0.225;
  const cx = N / 2, cy = N / 2;
  const rMid = N * 0.30, halfStroke = N * 0.052;
  // checkmark points (normalised)
  const p = [[0.345, 0.515], [0.455, 0.635], [0.695, 0.375]].map(([a, b]) => [a * N, b * N]);
  const ckHalf = N * 0.028;
  const halfW = (N - 2 * PAD) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5, py = y + 0.5;
      // rounded-rect signed distance
      const dx = Math.abs(px - cx) - (halfW - R);
      const dy = Math.abs(py - cy) - (halfW - R);
      const rr = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - R;
      const bgCov = clamp(0.5 - rr);
      const i = (y * N + x) * 4;
      if (bgCov <= 0) { buf[i + 3] = 0; continue; }
      let col = mix(SAGE_TOP, SAGE_BOT, clamp((py - PAD) / (N - 2 * PAD)));
      const ringSd = Math.abs(Math.hypot(px - cx, py - cy) - rMid) - halfStroke;
      col = mix(col, CREAM, clamp(0.5 - ringSd));
      const ck = Math.min(distSeg(px, py, ...p[0], ...p[1]), distSeg(px, py, ...p[1], ...p[2])) - ckHalf;
      col = mix(col, CREAM, clamp(0.5 - ck));
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = bgCov * 255;
    }
  }
  return buf;
}

// ---- monochrome menu-bar template (black checkmark, tinted by macOS) ----
function genTray(N) {
  const buf = new Uint8ClampedArray(N * N * 4);
  // clean checkmark only — reads well at menu-bar size
  const p = [[0.18, 0.52], [0.42, 0.76], [0.84, 0.26]].map(([a, b]) => [a * N, b * N]);
  const ckHalf = N * 0.085;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5, py = y + 0.5;
      const ck = Math.min(distSeg(px, py, ...p[0], ...p[1]), distSeg(px, py, ...p[1], ...p[2])) - ckHalf;
      const cov = clamp(0.5 - ck);
      const i = (y * N + x) * 4;
      buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = cov * 255;
    }
  }
  return buf;
}

writePNG(path.join(ROOT, 'build', 'icon.png'), 1024, genAppIcon(1024));
writePNG(path.join(ROOT, 'electron', 'trayTemplate.png'), 16, genTray(16));
writePNG(path.join(ROOT, 'electron', 'trayTemplate@2x.png'), 32, genTray(32));
console.log('icons written: build/icon.png, electron/trayTemplate.png, electron/trayTemplate@2x.png');
