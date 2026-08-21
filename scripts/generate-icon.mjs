// Генератор иконки Remote Hub без внешних зависимостей (только Node zlib).
// Рисует «терминальное окно»: тёмный скруглённый квадрат с градиентом,
// шапка с тремя «светофорами», промпт «>_» в бирюзовом цвете.
// Вывод: build/icon.ico (16…256) и build/icon.png (512).

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'build');

// ---------- палитра (0..1) ----------
const TOP = [0.078, 0.243, 0.361]; // #143E5C
const BOT = [0.027, 0.086, 0.141]; // #071624
const CYAN = [0.176, 0.831, 0.749]; // #2DD4BF
const LIGHT_CYAN = [0.404, 0.91, 0.976]; // #67E8F9
const DOTS = [
  [1.0, 0.373, 0.341], // red
  [0.996, 0.737, 0.18], // yellow
  [0.157, 0.784, 0.251] // green
];
const WHITE = [1, 1, 1];

// ---------- геометрия (нормализованные координаты) ----------
const RADIUS = 0.22;
const RING = 0.016;
const CHEV_TIP = [0.545, 0.6];
const CHEV_P1 = [0.285, 0.395];
const CHEV_P2 = [0.285, 0.805];
const CHEV_HALF = 0.052;
const UNDER = { x0: 0.67, x1: 0.78, y0: 0.545, y1: 0.655 };
const DOT_R = 0.045;
const DOT_Y = 0.19;
const DOT_X = [0.22, 0.35, 0.48];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideRoundedRect(px, py, half, r) {
  const dx = Math.abs(px - 0.5) - (half - r);
  const dy = Math.abs(py - 0.5) - (half - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return ox * ox + oy * oy <= r * r;
}

function distToSegment(px, py, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((px - a[0]) * abx + (py - a[1]) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t;
  const cy = a[1] + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function gradient(py) {
  return [
    lerp(TOP[0], BOT[0], py),
    lerp(TOP[1], BOT[1], py),
    lerp(TOP[2], BOT[2], py)
  ];
}

function blend(c, d, t) {
  return [lerp(c[0], d[0], t), lerp(c[1], d[1], t), lerp(c[2], d[2], t)];
}

function sample(px, py) {
  if (!insideRoundedRect(px, py, 0.5, RADIUS)) return null;
  if (!insideRoundedRect(px, py, 0.5 - RING, RADIUS - RING)) return blend(gradient(py), WHITE, 0.14);
  for (let i = 0; i < DOTS.length; i++) {
    if (Math.hypot(px - DOT_X[i], py - DOT_Y) <= DOT_R) return DOTS[i];
  }
  if (distToSegment(px, py, CHEV_P1, CHEV_TIP) <= CHEV_HALF) return CYAN;
  if (distToSegment(px, py, CHEV_P2, CHEV_TIP) <= CHEV_HALF) return CYAN;
  if (px >= UNDER.x0 && px <= UNDER.x1 && py >= UNDER.y0 && py <= UNDER.y1) return LIGHT_CYAN;
  return gradient(py);
}

function renderIcon(S) {
  const SS = 8;
  const out = new Uint8Array(S * S * 4);
  const n = SS * SS;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / S;
          const py = (y + (sy + 0.5) / SS) / S;
          const c = sample(px, py);
          if (c) {
            r += c[0] * 255;
            g += c[1] * 255;
            b += c[2] * 255;
            a += 255;
          }
        }
      }
      const i = (y * S + x) * 4;
      if (a > 0) {
        out[i] = Math.round((r / a) * 255);
        out[i + 1] = Math.round((g / a) * 255);
        out[i + 2] = Math.round((b / a) * 255);
        out[i + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngEncode(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- ICO (PNG-записи, поддерживаются Vista+) ----------
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------- ASCII-превью для визуальной проверки ----------
function asciiPreview(S) {
  const data = renderIcon(S);
  const W = 48;
  const H = 24;
  const rows = [];
  for (let ry = 0; ry < H; ry++) {
    let line = '';
    for (let rx = 0; rx < W; rx++) {
      const x = Math.floor((rx / W) * S);
      const y = Math.floor((ry / H) * S);
      const i = (y * S + x) * 4;
      const a = data[i + 3];
      if (a < 32) {
        line += ' ';
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (g > 120 && g >= r && b >= r - 40) line += 'C'; // бирюза/циан
      else if (mx - mn > 60 && mx > 140) line += 'o'; // светофоры
      else line += '#'; // тёмный фон
    }
    rows.push(line);
  }
  return rows;
}

// ---------- main ----------
mkdirSync(OUT_DIR, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: pngEncode(size, size, renderIcon(size)) }));
writeFileSync(resolve(OUT_DIR, 'icon.ico'), packIco(images));
writeFileSync(resolve(OUT_DIR, 'icon.png'), pngEncode(512, 512, renderIcon(512)));

console.log('icon.ico: 16..256 (multi-resolution, PNG entries)');
console.log('icon.png: 512x512');
console.log('');
console.log(asciiPreview(96).join('\n'));
