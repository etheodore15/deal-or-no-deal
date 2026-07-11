/**
 * Generates the PWA icons (gold briefcase with a $ on a dark tile) as raw
 * PNGs — no image libraries needed, just zlib for the IDAT stream.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x0b, 0x0f, 0x1e, 255];
const GOLD = [0xf2, 0xb6, 0x32, 255];
const GOLD_DARK = [0x8a, 0x6b, 0x1e, 255];

const DOLLAR = [
  '...XX...',
  '.XXXXXX.',
  'XX.XX.XX',
  'XX.XX...',
  '.XXXXX..',
  '..XXXXX.',
  '...XX.XX',
  'XX.XX.XX',
  '.XXXXXX.',
  '...XX...',
];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance-ish test for a rounded rectangle. */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function drawIcon(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512; // design coordinates are on a 512 grid

  // Case geometry
  const bodyX0 = 72 * s, bodyY0 = 176 * s, bodyX1 = 440 * s, bodyY1 = 424 * s, bodyR = 42 * s;
  const handleX0 = 196 * s, handleY0 = 128 * s, handleX1 = 316 * s, handleY1 = 210 * s;
  const handleR = 28 * s, handleW = 26 * s;

  // Dollar glyph geometry
  const cell = 20 * s;
  const gw = DOLLAR[0].length * cell;
  const gh = DOLLAR.length * cell;
  const gx = (256 * s) - gw / 2 + (36 * s); // shifted right of centre-line
  const gy = (bodyY0 + bodyY1) / 2 - gh / 2;

  const tileR = maskable ? 0 : 96 * s;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = null;

      if (!inRoundRect(x, y, 0, 0, size - 1, size - 1, tileR)) {
        color = [0, 0, 0, 0]; // transparent corner
      } else {
        color = BG;
        // Handle: rounded rect outline
        const inOuter = inRoundRect(x, y, handleX0, handleY0, handleX1, handleY1, handleR);
        const inInner = inRoundRect(
          x, y,
          handleX0 + handleW, handleY0 + handleW,
          handleX1 - handleW, handleY1 - handleW,
          Math.max(2, handleR - handleW)
        );
        if (inOuter && !inInner) color = GOLD_DARK;
        // Body on top of handle bottom
        if (inRoundRect(x, y, bodyX0, bodyY0, bodyX1, bodyY1, bodyR)) {
          color = GOLD;
          // Clasp line
          if (Math.abs(y - (bodyY0 + 54 * s)) < 5 * s) color = GOLD_DARK;
          // Dollar glyph
          const cx = Math.floor((x - gx) / cell);
          const cy = Math.floor((y - gy) / cell);
          if (cy >= 0 && cy < DOLLAR.length && cx >= 0 && cx < DOLLAR[0].length
              && DOLLAR[cy][cx] === 'X') {
            color = BG;
          }
        }
      }

      const i = (y * size + x) * 4;
      px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3];
    }
  }
  return encodePNG(size, px);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
writeFileSync(new URL('../icons/icon-192.png', import.meta.url), drawIcon(192, { maskable: false }));
writeFileSync(new URL('../icons/icon-512.png', import.meta.url), drawIcon(512, { maskable: false }));
writeFileSync(new URL('../icons/maskable-512.png', import.meta.url), drawIcon(512, { maskable: true }));
console.log('icons written');
