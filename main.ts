// news-image-20261125 — "Wednesday 25 November 2026 in one picture".
// Hand-drawn, from scratch: a raster canvas, a hand-written stroke font,
// vector pictograms and a hand-written PNG encoder. Node 22 stdlib only,
// no network, no external assets, fully deterministic.
//
// Layout (1024x1024):
//   masthead (date) -> hero: Shenzhou-24 / Pakistan's first astronaut
//   -> 2x7 grid of the day's other stories -> footer with sources.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Canvas: plain RGB buffer with filled-shape primitives.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  set(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
        o += 3;
      }
    }
  }
  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }
  ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
    const steps = Math.max(24, Math.ceil(2 * Math.PI * r));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      this.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, t / 2, c);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    // Floor the radius: a 1px stroke at radius 0.5 falls between pixel
    // centres and vanishes. 0.75 keeps thin strokes visible.
    const r = Math.max(0.75, t / 2);
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      this.fillCircle(x0 + dx * f, y0 + dy * f, r, c);
    }
  }
  poly(points: Array<[number, number]>, c: RGB): void {
    // Scanline fill of a simple polygon.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const f = (y + 0.5 - ay) / (by - ay);
          xs.push(ax + f * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
  }
  strokePoly(points: Array<[number, number]>, c: RGB, t = 1, close = false): void {
    const n = points.length;
    const lim = close ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % n];
      this.line(ax, ay, bx, by, c, t);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      const s = Math.sqrt(Math.max(0, 1 - dy * dy));
      const xa = Math.max(0, Math.ceil(cx - rx * s));
      const xb = Math.min(this.w - 1, Math.floor(cx + rx * s));
      for (let x = xa; x <= xb; x++) this.set(x, y, c);
    }
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.fillRect(x, y + r, w, h - 2 * r, c);
    this.fillCircle(x + r, y + r, r, c);
    this.fillCircle(x + w - r, y + r, r, c);
    this.fillCircle(x + r, y + h - r, r, c);
    this.fillCircle(x + w - r, y + h - r, r, c);
  }
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB): void {
    for (let yy = 0; yy < h; yy++) {
      const f = h <= 1 ? 0 : yy / (h - 1);
      const c: RGB = [
        Math.round(top[0] + (bottom[0] - top[0]) * f),
        Math.round(top[1] + (bottom[1] - top[1]) * f),
        Math.round(top[2] + (bottom[2] - top[2]) * f),
      ];
      this.fillRect(x, y + yy, w, 1, c);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder (colour type 2, 8-bit, filter 0, zlib level 9).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    const rowStart = y * (cv.w * 3 + 1);
    raw[rowStart] = 0; // filter none
    Buffer.from(cv.px.buffer, cv.px.byteOffset + y * cv.w * 3, cv.w * 3).copy(raw, rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Stroke font. Glyphs live in a 9-wide x 13-tall box (units), strokes are
// "x,y x,y; x,y x,y" polylines. All-caps newspaper face, drawn by hand.
// ---------------------------------------------------------------------------

const FONT: Record<string, string> = {
  A: '0,13 4.5,0 9,13;2.7,8 6.3,8',
  B: '0,0 0,13;0,0 6,0 9,2 9,4.5 6,6.5 0,6.5;0,6.5 6,6.5 9,8.5 9,11 6,13 0,13',
  C: '8.5,2.5 6,0 2.5,0 0,2.5 0,10.5 2.5,13 6,13 8.5,10.5',
  D: '0,0 0,13;0,0 6,0 9,3 9,10 6,13 0,13',
  E: '0,0 0,13;0,0 8,0;0,6.5 6,6.5;0,13 8,13',
  F: '0,0 0,13;0,0 8,0;0,6.5 6,6.5',
  G: '8.5,2.5 6,0 2.5,0 0,2.5 0,10.5 2.5,13 6,13 8.5,10.5 8.5,7 5,7',
  H: '0,0 0,13;9,0 9,13;0,6.5 9,6.5',
  I: '4.5,0 4.5,13;2,0 7,0;2,13 7,13',
  J: '9,0 9,10 7,13 3,13 1,11',
  K: '0,0 0,13;9,0 0,6.5 9,13',
  L: '0,0 0,13;0,13 8,13',
  M: '0,13 0,0 4.5,8 9,0 9,13',
  N: '0,13 0,0 9,13 9,0',
  O: '2.5,0 6.5,0 9,2.5 9,10.5 6.5,13 2.5,13 0,10.5 0,2.5 2.5,0',
  P: '0,0 0,13;0,0 6,0 9,2.5 9,4.5 6,7 0,7',
  Q: '2.5,0 6.5,0 9,2.5 9,10.5 6.5,13 2.5,13 0,10.5 0,2.5 2.5,0;6,10 9,13',
  R: '0,0 0,13;0,0 6,0 9,2.5 9,4.5 6,7 0,7;5,7 9,13',
  S: '8,2 6,0 3,0 1,1.5 0,3.5 0,5 2,6.5 7,6.5 9,8 9,10 7.5,12 5,13 2,13 1,11.5',
  T: '0,0 9,0;4.5,0 4.5,13',
  U: '0,0 0,10 2.5,13 6.5,13 9,10 9,0',
  V: '0,0 4.5,13 9,0',
  W: '0,0 2.2,13 4.5,4 6.8,13 9,0',
  X: '0,0 9,13;9,0 0,13',
  Y: '0,0 4.5,6.5 9,0;4.5,6.5 4.5,13',
  Z: '0,0 9,0 0,13 9,13',
  '0': '2.5,0 6.5,0 9,2.5 9,10.5 6.5,13 2.5,13 0,10.5 0,2.5 2.5,0',
  '1': '2,2 4.5,0 4.5,13;2,13 7,13',
  '2': '0.5,2.5 2.5,0 6.5,0 8.5,2 8.5,4.5 0,13 9,13',
  '3': '0.5,1.5 2.5,0 6.5,0 8.5,2 8.5,4.5 6,6.5;6,6.5 8.5,8.5 8.5,11 6.5,13 2.5,13 0.5,11.5',
  '4': '0,0 0,7 8,7;6,0 6,13',
  '5': '9,0 0,0 0,6 7,6 9,8 9,11 7,13 2,13 0,11',
  '6': '8.5,1 6,0 2.5,0 0,3 0,10 2.5,13 6.5,13 9,10.5 9,7.5 6.5,6 2.5,6 0,8',
  '7': '0,0 9,0 4,13',
  '8': '2.5,0 6.5,0 9,2.5 9,5 6.5,7 2.5,7 0,5 0,2.5 2.5,0;2.5,7 6.5,7 9,9 9,11 6.5,13 2.5,13 0,11 0,9 2.5,7',
  '9': '9,12 6.5,13 2.5,13 0,10.5 0,7.5 2.5,6 6.5,6 9,8 9,3 6.5,0 2.5,0 0,2',
  ',': '4,11 4,12.5 2.5,14',
  "'": '4,0 5,3.5',
  '"': '2.5,0 3.5,3.5;5.5,0 6.5,3.5',
  '-': '0.5,6.5 8.5,6.5',
  '(': '6.5,0 3,3 3,10 6.5,13',
  ')': '2.5,0 6,3 6,10 2.5,13',
  '/': '7,0 2,13',
  '%': '8,0 1,13;1.5,1 3,1 3,3.5 1.5,3.5 1.5,1;6,9.5 7.5,9.5 7.5,12 6,12 6,9.5',
  '+': '4.5,3 4.5,10;1,6.5 8,6.5',
  '=': '0.5,5 8.5,5;0.5,9 8.5,9',
  ':': 'DOT 3.5,2.5 2,2;DOT 3.5,9.5 2,2',
  ';': 'DOT 3.5,2.5 2,2;4,9 4,11.5 2.5,13',
  '!': '4.5,0 4.5,9;DOT 3.5,11 2,2',
  '?': '1.5,3 1.5,1.5 3,0 6,0 8,2 8,4 6,6 4.5,7 4.5,9;DOT 3.5,11 2,2',
  '.': 'DOT 3.5,11 2,2',
  '°': '2.5,0.5 5.5,0.5 7,2 7,3.5 5.5,5 2.5,5 1,3.5 1,2 2.5,0.5',
};

// Advance width of a glyph, in font units (box is 9 wide).
function glyphAdvance(ch: string): number {
  if (ch === ' ') return 5;
  if (ch === 'I' || ch === "'" || ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === '!') return 7;
  if (ch === 'M' || ch === 'W') return 12;
  return 11;
}

function textWidth(text: string, size: number): number {
  text = text.toUpperCase(); // the hand font is caps-only
  const s = size / 13;
  let w = 0;
  for (const ch of text) w += glyphAdvance(ch) * s;
  return w;
}

// Draw one glyph at (x, y) = top-left of the cap-height box.
function drawGlyph(cv: Canvas, ch: string, x: number, y: number, size: number, c: RGB): void {
  const def = FONT[ch];
  if (!def) return;
  const s = size / 13;
  const t = Math.max(1, Math.round(size / 7));
  for (const stroke of def.split(';')) {
    const st = stroke.trim();
    if (st.startsWith('DOT')) {
      const [, coords, wh] = st.split(' ');
      const [dx, dy] = coords.split(',').map(Number);
      const d = Number(wh.split(',')[0]) * s;
      cv.fillRect(x + dx * s, y + dy * s, d, d, c);
      continue;
    }
    const pts = st.split(' ').map((p) => {
      const [px, py] = p.split(',').map(Number);
      return [x + px * s, y + py * s] as [number, number];
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, t);
    }
  }
}

function drawText(cv: Canvas, text: string, x: number, y: number, size: number, c: RGB, align: 'left' | 'center' | 'right' = 'left'): void {
  text = text.toUpperCase(); // the hand font is caps-only
  let startX = x;
  if (align === 'center') startX = x - textWidth(text, size) / 2;
  if (align === 'right') startX = x - textWidth(text, size);
  let cx = startX;
  for (const ch of text) {
    if (ch !== ' ') drawGlyph(cv, ch, cx, y, size, c);
    cx += glyphAdvance(ch) * (size / 13);
  }
}

// Greedy word wrap; returns lines that fit maxWidth.
function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (textWidth(trial, size) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const PAPER: RGB = [246, 239, 224];
const CARD: RGB = [251, 247, 236];
const INK: RGB = [26, 32, 44];
const MUTED: RGB = [96, 96, 88];
const NAVY_TOP: RGB = [9, 24, 51];
const NAVY_BOT: RGB = [18, 58, 96];
const WHITE: RGB = [255, 255, 255];
const CREAM: RGB = [214, 226, 240];
const GOLD: RGB = [212, 160, 60];
const RULE: RGB = [200, 188, 164];

// Region colours (restrained, used for icon tiles + tags).
const REGION_COLOR: Record<string, RGB> = {
  CLIMATE: [46, 125, 87],
  MARKETS: [176, 58, 44],
  TECH: [94, 74, 158],
  USA: [52, 84, 148],
  'MIDDLE EAST': [178, 118, 32],
  EUROPE: [48, 96, 160],
  ASIA: [24, 128, 128],
  HEALTH: [178, 52, 84],
  AFRICA: [168, 92, 44],
  AMERICAS: [66, 128, 52],
};

// Deterministic RNG (LCG) so every run draws identical stars.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pictograms: each draws a small white glyph inside a 46x46 tile at (x, y).
// ---------------------------------------------------------------------------

function iconGlobe(cv: Canvas, x: number, y: number, s: number): void {
  const cx = x + 23 * s;
  const cy = y + 23 * s;
  const r = 15 * s;
  cv.ring(cx, cy, r, 2.5 * s, WHITE);
  cv.ring(cx, cy, r * 0.45, 1.5 * s, WHITE);
  cv.line(cx - r, cy, cx + r, cy, WHITE, 1.5 * s);
  cv.line(cx - r * 0.8, cy - r * 0.55, cx + r * 0.8, cy - r * 0.55, WHITE, 1.2 * s);
  cv.line(cx - r * 0.8, cy + r * 0.55, cx + r * 0.8, cy + r * 0.55, WHITE, 1.2 * s);
}

function iconChartDown(cv: Canvas, x: number, y: number, s: number): void {
  const pts: Array<[number, number]> = [
    [x + 8 * s, y + 10 * s],
    [x + 17 * s, y + 18 * s],
    [x + 24 * s, y + 14 * s],
    [x + 38 * s, y + 30 * s],
  ];
  cv.strokePoly(pts, WHITE, 3 * s);
  // arrow head at the end
  cv.poly(
    [
      [x + 38 * s, y + 30 * s],
      [x + 30 * s, y + 28 * s],
      [x + 36 * s, y + 36 * s],
    ],
    WHITE,
  );
  cv.line(x + 8 * s, y + 38 * s, x + 38 * s, y + 38 * s, WHITE, 2 * s);
}

function iconChip(cv: Canvas, x: number, y: number, s: number): void {
  const bx = x + 13 * s;
  const by = y + 13 * s;
  const bw = 20 * s;
  cv.fillRect(bx, by, bw, bw, WHITE);
  cv.fillRect(bx + 6 * s, by + 6 * s, 8 * s, 8 * s, [94, 74, 158]);
  for (let i = 0; i < 3; i++) {
    const o = (16 + i * 7) * s;
    cv.line(x + o, y + 7 * s, x + o, y + 13 * s, WHITE, 2 * s);
    cv.line(x + o, y + 33 * s, x + o, y + 39 * s, WHITE, 2 * s);
    cv.line(x + 7 * s, y + o, x + 13 * s, y + o, WHITE, 2 * s);
    cv.line(x + 33 * s, y + o, x + 39 * s, y + o, WHITE, 2 * s);
  }
}

function iconLock(cv: Canvas, x: number, y: number, s: number): void {
  cv.roundRect(x + 13 * s, y + 20 * s, 20 * s, 16 * s, 2 * s, WHITE);
  cv.strokePoly(
    [
      [x + 16 * s, y + 20 * s],
      [x + 16 * s, y + 15 * s],
      [x + 30 * s, y + 15 * s],
      [x + 30 * s, y + 20 * s],
    ],
    WHITE,
    2.5 * s,
  );
  cv.fillCircle(x + 23 * s, y + 26 * s, 2.5 * s, [52, 84, 148]);
  cv.line(x + 23 * s, y + 27 * s, x + 23 * s, y + 32 * s, [52, 84, 148], 2 * s);
}

function iconBurst(cv: Canvas, x: number, y: number, s: number): void {
  const cx = x + 23 * s;
  const cy = y + 22 * s;
  const spikes = 8;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * 2 * Math.PI - Math.PI / 2;
    const r = (i % 2 === 0 ? 17 : 7) * s;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  cv.poly(pts, WHITE);
  cv.fillCircle(cx, cy, 4 * s, [178, 118, 32]);
}

function iconSatellite(cv: Canvas, x: number, y: number, s: number): void {
  // Body with two solar panels, drawn slightly askew by hand.
  cv.poly(
    [
      [x + 19 * s, y + 17 * s],
      [x + 28 * s, y + 15 * s],
      [x + 30 * s, y + 24 * s],
      [x + 21 * s, y + 26 * s],
    ],
    WHITE,
  );
  cv.poly(
    [
      [x + 6 * s, y + 20 * s],
      [x + 18 * s, y + 17 * s],
      [x + 19 * s, y + 24 * s],
      [x + 7 * s, y + 27 * s],
    ],
    WHITE,
  );
  cv.poly(
    [
      [x + 29 * s, y + 16 * s],
      [x + 40 * s, y + 13 * s],
      [x + 41 * s, y + 20 * s],
      [x + 30 * s, y + 23 * s],
    ],
    WHITE,
  );
  cv.line(x + 11 * s, y + 21 * s, x + 12 * s, y + 25 * s, [48, 96, 160], 1 * s);
  cv.line(x + 35 * s, y + 14 * s, x + 36 * s, y + 18 * s, [48, 96, 160], 1 * s);
  cv.line(x + 24 * s, y + 27 * s, x + 26 * s, y + 33 * s, WHITE, 2 * s);
  cv.fillCircle(x + 27 * s, y + 35 * s, 2 * s, WHITE);
}

function iconShip(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 9 * s, y + 22 * s],
      [x + 37 * s, y + 22 * s],
      [x + 33 * s, y + 32 * s],
      [x + 13 * s, y + 32 * s],
    ],
    WHITE,
  );
  cv.fillRect(x + 18 * s, y + 14 * s, 10 * s, 8 * s, WHITE);
  cv.line(x + 23 * s, y + 14 * s, x + 23 * s, y + 8 * s, WHITE, 2 * s);
  cv.line(x + 8 * s, y + 38 * s, x + 14 * s, y + 38 * s, WHITE, 2 * s);
  cv.line(x + 18 * s, y + 38 * s, x + 24 * s, y + 38 * s, WHITE, 2 * s);
  cv.line(x + 28 * s, y + 38 * s, x + 38 * s, y + 38 * s, WHITE, 2 * s);
}

function iconTower(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 17 * s, y + 8 * s],
      [x + 29 * s, y + 8 * s],
      [x + 27 * s, y + 38 * s],
      [x + 19 * s, y + 38 * s],
    ],
    WHITE,
  );
  cv.line(x + 23 * s, y + 8 * s, x + 23 * s, y + 4 * s, WHITE, 2 * s);
  for (let i = 0; i < 4; i++) {
    cv.fillRect(x + 20 * s, y + (13 + i * 6) * s, 6 * s, 2.5 * s, [178, 118, 32]);
  }
}

function iconQuake(cv: Canvas, x: number, y: number, s: number): void {
  cv.strokePoly(
    [
      [x + 6 * s, y + 8 * s],
      [x + 12 * s, y + 16 * s],
      [x + 18 * s, y + 10 * s],
      [x + 24 * s, y + 20 * s],
      [x + 30 * s, y + 12 * s],
      [x + 38 * s, y + 22 * s],
      [x + 40 * s, y + 30 * s],
    ],
    WHITE,
    3 * s,
  );
  cv.line(x + 8 * s, y + 36 * s, x + 14 * s, y + 36 * s, WHITE, 2 * s);
  cv.line(x + 20 * s, y + 36 * s, x + 38 * s, y + 36 * s, WHITE, 2 * s);
}

function iconCap(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 23 * s, y + 10 * s],
      [x + 40 * s, y + 18 * s],
      [x + 23 * s, y + 26 * s],
      [x + 6 * s, y + 18 * s],
    ],
    WHITE,
  );
  cv.strokePoly(
    [
      [x + 14 * s, y + 22 * s],
      [x + 14 * s, y + 30 * s],
      [x + 32 * s, y + 30 * s],
      [x + 32 * s, y + 22 * s],
    ],
    WHITE,
    2.5 * s,
  );
  cv.line(x + 40 * s, y + 18 * s, x + 40 * s, y + 32 * s, WHITE, 2 * s);
  cv.fillCircle(x + 40 * s, y + 34 * s, 2 * s, WHITE);
}

function iconBoat(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 8 * s, y + 26 * s],
      [x + 38 * s, y + 26 * s],
      [x + 33 * s, y + 34 * s],
      [x + 13 * s, y + 34 * s],
    ],
    WHITE,
  );
  cv.line(x + 23 * s, y + 26 * s, x + 23 * s, y + 10 * s, WHITE, 2 * s);
  cv.poly(
    [
      [x + 23 * s, y + 10 * s],
      [x + 23 * s, y + 24 * s],
      [x + 34 * s, y + 24 * s],
    ],
    WHITE,
  );
  cv.line(x + 8 * s, y + 39 * s, x + 16 * s, y + 39 * s, WHITE, 2 * s);
  cv.line(x + 22 * s, y + 39 * s, x + 38 * s, y + 39 * s, WHITE, 2 * s);
}

function iconRibbon(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 23 * s, y + 8 * s],
      [x + 31 * s, y + 16 * s],
      [x + 27 * s, y + 26 * s],
      [x + 23 * s, y + 22 * s],
      [x + 19 * s, y + 26 * s],
      [x + 15 * s, y + 16 * s],
    ],
    WHITE,
  );
  cv.poly(
    [
      [x + 23 * s, y + 22 * s],
      [x + 27 * s, y + 26 * s],
      [x + 30 * s, y + 38 * s],
      [x + 23 * s, y + 33 * s],
    ],
    WHITE,
  );
  cv.poly(
    [
      [x + 23 * s, y + 22 * s],
      [x + 19 * s, y + 26 * s],
      [x + 16 * s, y + 38 * s],
      [x + 23 * s, y + 33 * s],
    ],
    WHITE,
  );
}

function iconCross(cv: Canvas, x: number, y: number, s: number): void {
  cv.ring(x + 23 * s, y + 23 * s, 16 * s, 2.5 * s, WHITE);
  cv.fillRect(x + 20 * s, y + 13 * s, 6 * s, 20 * s, WHITE);
  cv.fillRect(x + 13 * s, y + 20 * s, 20 * s, 6 * s, WHITE);
}

function iconShop(cv: Canvas, x: number, y: number, s: number): void {
  cv.poly(
    [
      [x + 8 * s, y + 12 * s],
      [x + 38 * s, y + 12 * s],
      [x + 36 * s, y + 20 * s],
      [x + 10 * s, y + 20 * s],
    ],
    WHITE,
  );
  cv.fillRect(x + 11 * s, y + 20 * s, 24 * s, 16 * s, WHITE);
  cv.fillRect(x + 19 * s, y + 26 * s, 8 * s, 10 * s, [66, 128, 52]);
  cv.line(x + 11 * s, y + 38 * s, x + 35 * s, y + 38 * s, WHITE, 2 * s);
}

const ICONS: Record<string, (cv: Canvas, x: number, y: number, s: number) => void> = {  globe: iconGlobe,
  chart: iconChartDown,
  chip: iconChip,
  lock: iconLock,
  burst: iconBurst,
  satellite: iconSatellite,
  ship: iconShip,
  tower: iconTower,
  quake: iconQuake,
  cap: iconCap,
  boat: iconBoat,
  ribbon: iconRibbon,
  cross: iconCross,
  shop: iconShop,
};

// ---------------------------------------------------------------------------
// Hero: night sky, Earth arc, Tiangong station, Shenzhou-24 rocket.
// ---------------------------------------------------------------------------

function drawStars(cv: Canvas, x0: number, y0: number, w: number, h: number, n: number, seed: number): void {
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * w;
    const y = y0 + rng() * h;
    const r = 0.8 + rng() * 1.6;
    const bright = rng();
    const c: RGB = bright > 0.85 ? [255, 240, 200] : [220, 230, 245];
    cv.fillCircle(x, y, r, c);
    if (bright > 0.93) {
      cv.line(x - 4, y, x + 4, y, c, 1);
      cv.line(x, y - 4, x, y + 4, c, 1);
    }
  }
}

function drawEarth(cv: Canvas, cx: number, cy: number, r: number): void {
  // Atmosphere glow, ocean, land blobs, cloud arcs.
  cv.fillCircle(cx, cy, r + 10, [70, 130, 200]);
  cv.fillCircle(cx, cy, r + 4, [40, 95, 170]);
  cv.fillCircle(cx, cy, r, [28, 84, 158]);
  const rng = makeRng(77);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.55;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d;
    const br = r * (0.12 + rng() * 0.16);
    cv.fillCircle(bx, by, br, [62, 150, 92]);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.7;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d;
    cv.ellipse(bx, by, r * 0.22, r * 0.05, [235, 242, 248]);
  }
}

// Rocket drawn pointing up, rotated `ang` radians around (px, py).
// Local coords: body from y=-70 (nose) to y=60 (base), half-width 14.
function drawRocket(cv: Canvas, px: number, py: number, ang: number, scale: number): void {
  const rot = (lx: number, ly: number): [number, number] => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [px + (lx * c - ly * s) * scale, py + (lx * s + ly * c) * scale];
  };
  const P = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, y]) => rot(x, y));
  // Flame (behind body): layered triangles.
  cv.poly(P([[0, 62], [-13, 88], [0, 118], [13, 88]]), [240, 120, 40]);
  cv.poly(P([[0, 62], [-8, 82], [0, 100], [8, 82]]), [250, 200, 80]);
  cv.poly(P([[0, 62], [-4, 76], [0, 88], [4, 76]]), [255, 245, 200]);
  // Smoke puffs trailing down-left.
  const rng = makeRng(9);
  for (let i = 0; i < 9; i++) {
    const f = i / 9;
    const bx = -26 - f * 55 + (rng() - 0.5) * 14;
    const by = 96 + f * 60 + (rng() - 0.5) * 14;
    cv.fillCircle(...rot(bx, by), 10 + f * 16, [225, 228, 232]);
  }
  // Fins.
  cv.poly(P([[-14, 28], [-14, 58], [-34, 74], [-14, 50]]), [192, 48, 40]);
  cv.poly(P([[14, 28], [14, 58], [34, 74], [14, 50]]), [192, 48, 40]);
  // Body.
  cv.poly(
    P([
      [-14, 58],
      [-14, -18],
      [-8, -52],
      [0, -70],
      [8, -52],
      [14, -18],
      [14, 58],
    ]),
    [242, 242, 240],
  );
  // Nose cone.
  cv.poly(P([[-8, -52], [0, -70], [8, -52]]), [192, 48, 40]);
  // Body band + window.
  cv.poly(P([[-14, 30], [14, 30], [14, 38], [-14, 38]]), [36, 90, 160]);
  const [wx, wy] = rot(0, -28);
  cv.fillCircle(wx, wy, 7.5 * scale, [36, 90, 160]);
  cv.fillCircle(wx, wy, 5.5 * scale, [150, 205, 235]);
}

// Text drawn rotated by `ang` around its start point (baseline = top).
// Each glyph is placed at its own origin on the rotated baseline.
function drawTextRotated(cv: Canvas, text: string, x: number, y: number, size: number, c: RGB, ang: number): void {
  text = text.toUpperCase(); // the hand font is caps-only
  const s = size / 13;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  let ox = x;
  let oy = y;
  const t = Math.max(1, Math.round(size / 7));
  for (const ch of text) {
    if (ch !== ' ') {
      const def = FONT[ch];
      if (def) {
        for (const stroke of def.split(';')) {
          const st = stroke.trim();
          if (st.startsWith('DOT')) {
            const [, coords, wh] = st.split(' ');
            const [dx, dy] = coords.split(',').map(Number);
            const d = Number(wh.split(',')[0]) * s;
            const rx = ox + (dx * s * ca - dy * s * sa);
            const ry = oy + (dx * s * sa + dy * s * ca);
            cv.fillRect(rx, ry, d, d, c);
            continue;
          }
          const pts = st.split(' ').map((p) => {
            const [px, py] = p.split(',').map(Number);
            return [ox + (px * s * ca - py * s * sa), oy + (px * s * sa + py * s * ca)] as [number, number];
          });
          for (let i = 0; i + 1 < pts.length; i++) {
            cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, t);
          }
        }
      }
    }
    const adv = glyphAdvance(ch) * s;
    ox += adv * ca;
    oy += adv * sa;
  }
}

// Small Tiangong-style station: core module + two solar wings.
function drawStation(cv: Canvas, x: number, y: number, s: number): void {
  cv.fillRect(x, y, 66 * s, 12 * s, [210, 216, 222]);
  cv.fillRect(x + 20 * s, y - 6 * s, 26 * s, 24 * s, [190, 196, 202]);
  cv.fillRect(x - 34 * s, y + 2 * s, 32 * s, 8 * s, [52, 110, 200]);
  cv.fillRect(x + 68 * s, y + 2 * s, 32 * s, 8 * s, [52, 110, 200]);
  for (let i = 0; i < 3; i++) {
    cv.line(x - 26 * s + i * 10 * s, y + 2 * s, x - 26 * s + i * 10 * s, y + 10 * s, [30, 70, 140], 1);
    cv.line(x + 76 * s + i * 10 * s, y + 2 * s, x + 76 * s + i * 10 * s, y + 10 * s, [30, 70, 140], 1);
  }
  cv.fillCircle(x + 33 * s, y + 6 * s, 3 * s, [240, 200, 90]);
}

// Pakistani crescent + star motif.
function drawCrescent(cv: Canvas, cx: number, cy: number, r: number): void {
  cv.fillCircle(cx, cy, r, GOLD);
  cv.fillCircle(cx + r * 0.42, cy - r * 0.12, r * 0.88, NAVY_TOP);
  const sx = cx + r * 0.55;
  const sy = cy - r * 0.28;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 2 * Math.PI - Math.PI / 2;
    const rr = i % 2 === 0 ? r * 0.42 : r * 0.17;
    pts.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr]);
  }
  cv.poly(pts, GOLD);
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

interface Story {
  tag: string;
  icon: string;
  headline: string;
  summary: string;
}

const STORIES: Story[] = [
  { tag: 'CLIMATE', icon: 'globe', headline: 'COP31 ENDS WITH NO DEAL', summary: 'Climate summit in Antalya collapses as oil states block fossil-fuel phaseout.' },
  { tag: 'MARKETS', icon: 'chart', headline: 'AI RALLY REVERSES', summary: 'Nasdaq -1.5%, Nvidia -6%, Micron -11% a day after the AI surge. Dow +0.8%.' },
  { tag: 'TECH', icon: 'chip', headline: 'HUAWEI GUILTY ON 10 COUNTS', summary: 'US jury convicts the Chinese firm of trade-secret theft and bank fraud.' },
  { tag: 'USA', icon: 'lock', headline: 'CIA HIT BY CYBERATTACK', summary: 'Classified systems at the CIA and ODNI breached, CNN reports.' },
  { tag: 'MIDDLE EAST', icon: 'burst', headline: 'GAZA STRIKE KILLS 7', summary: 'Israeli strike in Gaza City kills a Hamas security chief; 7 dead that day.' },
  { tag: 'EUROPE', icon: 'satellite', headline: 'NATO VOWS SPACE DEFENCE', summary: 'Alliance to defend against space threats amid reports of a Russian satellite.' },
  { tag: 'EUROPE', icon: 'ship', headline: 'UKRAINE HITS SHIP AT SEA', summary: 'Zelenskiy confirms a drone strike on a Russian cargo ship off Finland.' },
  { tag: 'MIDDLE EAST', icon: 'tower', headline: 'HOUTHIS HIT RIYADH TOWER', summary: 'Strike on Riyadh\u0027s tallest tower wounds 11; Saudis hit Yemen telecom sites.' },
  { tag: 'ASIA', icon: 'quake', headline: 'NEPAL QUAKE: MAGNITUDE 5.6', summary: 'Magnitude 5.6 quake shakes eastern Nepal near the Tibet border.' },
  { tag: 'ASIA', icon: 'cap', headline: 'SEOUL MINISTER RESIGNS', summary: 'Education minister Choi Kyo-jin quits over an exam-cheating scandal.' },
  { tag: 'ASIA', icon: 'boat', headline: 'MALAYSIA TO RETURN ROHINGYA', summary: '6,500+ refugees to be sent back to Myanmar in December, PM Anwar says.' },
  { tag: 'HEALTH', icon: 'ribbon', headline: 'AIDS DEATHS AT 20-YEAR LOW', summary: 'Deaths fell to 570,000 in 2025, but global HIV funding dropped 18%.' },
  { tag: 'AFRICA', icon: 'cross', headline: 'WHO FLEES EBOLA HOSPITAL', summary: 'WHO evacuates staff from a hospital in DR Congo after days of fighting.' },
  { tag: 'AMERICAS', icon: 'shop', headline: 'CARTAGENA HOSTAGE SIEGE', summary: 'Gunmen seize a supermarket after a failed cash-truck robbery; 30 held hostage.' },
];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function drawMasthead(cv: Canvas): void {
  cv.fillRect(0, 0, W, 6, INK);
  drawText(cv, 'THE WORLD IN ONE PICTURE', W / 2, 18, 13, MUTED, 'center');
  drawText(cv, 'WEDNESDAY 25 NOVEMBER 2026', W / 2, 36, 38, INK, 'center');
  cv.fillRect(28, 78, W - 56, 2, RULE);
}

function drawHero(cv: Canvas): void {
  const y0 = 84;
  const y1 = 470;
  cv.vgrad(0, y0, W, y1 - y0, NAVY_TOP, NAVY_BOT);
  drawStars(cv, 0, y0, W, y1 - y0, 110, 20261125);
  // Earth arc, bottom-left.
  drawEarth(cv, 120, 560, 185);
  // Tiangong station, right of the sky, clear of headline and rocket.
  drawStation(cv, 830, 250, 1.0);
  // Crescent + star, left of the sky, clear of the headline.
  drawCrescent(cv, 58, 216, 24);
  // Headline + subline, top centre-left.
  drawText(cv, 'PAKISTAN\u0027S FIRST ASTRONAUT', 512, 102, 40, WHITE, 'center');
  drawText(cv, 'SHENZHOU-24 LIFTS OFF WITH MUHAMMAD ZEESHAN ALI, 40', 512, 152, 15, CREAM, 'center');
  drawText(cv, 'FIRST PAKISTANI IN ORBIT, ABOARD CHINA\u0027S TIANGONG STATION', 512, 174, 15, CREAM, 'center');
  // Dateline caption, under the sublines in clear sky.
  drawText(cv, 'LAUNCHED 05:18 PKT  -  ONE WEEK IN ORBIT  -  4 PAKISTANI EXPERIMENTS', 512, 200, 13, GOLD, 'center');
  // Rocket ascending right of centre, tilted.
  drawRocket(cv, 660, 330, -0.28, 1.15);
  // Gold rule under hero.
  cv.fillRect(0, y1, W, 4, GOLD);
}

function drawGrid(cv: Canvas): void {
  const cols = 2;
  const rows = 7;
  const margin = 14;
  const gapX = 10;
  const gapY = 3;
  const cellW = (W - margin * 2 - gapX) / cols;
  const top = 478;
  const cellH = 72;
  for (let i = 0; i < STORIES.length; i++) {
    const st = STORIES[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellW + gapX);
    const y = top + row * (cellH + gapY);
    const colour = REGION_COLOR[st.tag];
    // Card.
    cv.fillRect(x, y, cellW, cellH, CARD);
    cv.fillRect(x, y, cellW, 1, RULE);
    cv.fillRect(x, y + cellH - 1, cellW, 1, RULE);
    // Icon tile.
    cv.roundRect(x + 9, y + 12, 46, 46, 6, colour);
    ICONS[st.icon](cv, x + 9, y + 12, 1.0);
    // Region tag.
    drawText(cv, st.tag, x + 64, y + 8, 10, colour);
    // Headline (one line).
    drawText(cv, st.headline, x + 64, y + 24, 16, INK);
    // Summary (two lines max).
    const lines = wrapText(st.summary, 11, cellW - 74);
    for (let li = 0; li < Math.min(2, lines.length); li++) {
      drawText(cv, lines[li], x + 64, y + 44 + li * 14, 11, MUTED);
    }
  }
}

function drawFooter(cv: Canvas): void {
  cv.fillRect(28, 1004, W - 56, 1, RULE);
  drawText(
    cv,
    'ALL EVENTS 25 NOVEMBER 2026  -  SOURCES: REUTERS, AP, CNN, WSJ, UNAIDS, WHO',
    W / 2,
    1009,
    11,
    MUTED,
    'center',
  );
}

function main(): void {
  const cv = new Canvas(W, H);
  cv.fillRect(0, 0, W, H, PAPER);
  drawMasthead(cv);
  drawHero(cv);
  drawGrid(cv);
  drawFooter(cv);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG(cv));
}

main();
