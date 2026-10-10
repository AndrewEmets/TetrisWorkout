// Draws the app icons (a T piece on a dark tile) as PNGs into icons/. No dependencies.
// Usage: node tools/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x12, 0x13, 0x18], TILE = [0x1d, 0x1f, 0x27], T = [0xb3, 0x4a, 0xd0];
const SS = 4; // supersampling per axis

// opts: size, rounded (transparent corners), scale (piece size relative to the icon).
function draw({ size, rounded, scale }) {
  const n = size * SS;
  const cell = n * scale / 3;
  const ox = (n - 3 * cell) / 2, oy = (n - 2 * cell) / 2;
  const cells = [[0, 0], [1, 0], [2, 0], [1, 1]]; // T pointing down
  const r = n * 0.22;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px * SS + sx + 0.5, y = py * SS + sy + 0.5;
          let col = rounded ? TILE : BG, a = 1;
          if (rounded) {
            const cx = Math.min(Math.max(x, r), n - r), cy = Math.min(Math.max(y, r), n - r);
            if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) a = 0;
          }
          const gx = (x - ox) / cell, gy = (y - oy) / cell;
          const ix = Math.floor(gx), iy = Math.floor(gy);
          if (a && cells.some(([cx, cy]) => cx === ix && cy === iy)) {
            const fy = gy - iy, gap = 0.04, fx = gx - ix;
            if (fx > gap && fx < 1 - gap && fy > gap && fy < 1 - gap) {
              const k = fy < 0.18 ? 1.3 : fy > 0.82 ? 0.75 : 1; // light top edge, dark bottom edge
              col = T.map((v) => Math.min(255, v * k));
            }
          }
          rr += col[0] * a; gg += col[1] * a; bb += col[2] * a; aa += a;
        }
      }
      const i = (py * size + px) * 4, s = SS * SS;
      out[i] = aa ? rr / aa : 0; out[i + 1] = aa ? gg / aa : 0; out[i + 2] = aa ? bb / aa : 0; out[i + 3] = 255 * aa / s;
    }
  }
  return encode(size, size, out);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
const icons = {
  'icon-192.png': { size: 192, rounded: true, scale: 0.66 },
  'icon-512.png': { size: 512, rounded: true, scale: 0.66 },
  'icon-maskable-512.png': { size: 512, rounded: false, scale: 0.5 }, // inside the maskable safe zone
  'icon-180.png': { size: 180, rounded: false, scale: 0.6 }, // iOS rounds the corners itself
};
for (const [name, opts] of Object.entries(icons)) {
  fs.writeFileSync(path.join(dir, name), draw(opts));
  console.log('icons/' + name);
}
