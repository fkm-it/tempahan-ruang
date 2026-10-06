#!/usr/bin/env node
/**
 * init.js — jenamakan templat untuk sistem baharu (jalankan SEKALI selepas menyalin templat).
 *
 *   npm run init -- --name "Sistem Tempahan Dewan" --short "Tempahan" --tagline "Tempah dewan dengan mudah" --color "#0F766E"
 *
 * Mengemas kini: Config.gs, SettingModel.gs (nilai lalai), tokens.html (warna jenama), ikon PWA (PNG dijana),
 * pwa/offline.html, package.json, README.md. Selamat dijalankan semula untuk menukar nama/warna.
 * Pilihan: --slug NamaTanpaRuang (awalan fail Drive; lalai daripada --name), --org "Nama Organisasi"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? String(args[i + 1] || '') : ''; };

function fail(m) { console.error('✘ ' + m); process.exit(1); }

const cfgSrc = fs.readFileSync(path.join(ROOT, 'src', 'config', 'Config.gs'), 'utf8');
const current = (k) => { const m = cfgSrc.match(new RegExp(k + ":\\s*'([^']*)'")); return m ? m[1] : ''; };
const tokSrc = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'css', 'tokens.html'), 'utf8');
if (!args.length) fail('Guna: npm run init -- --name "Nama Sistem" [--short "Nama Pendek"] [--tagline "Slogan"] [--color "#4F46E5"] [--slug NamaSlug]\n  (nilai yang tidak diberi dikekalkan)');
const name = (arg('name') || current('APP_NAME')).trim();
if (!name || name.length > 60 || /['\\<>]/.test(name)) fail('--name 1–60 aksara dan tidak boleh mengandungi \' \\ < >');
const shortName = (arg('short') || (arg('name') ? name : current('SHORT_NAME')) || name).trim().slice(0, 12);
const tagline = (arg('tagline') || current('TAGLINE')).trim();
if (tagline.length > 120 || /['\\<>]/.test(tagline)) fail('--tagline maksimum 120 aksara dan tidak boleh mengandungi \' \\ < >');
const slug = (arg('slug') || (arg('name') ? name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase()) : current('APP_SLUG'))).slice(0, 30);
if (!/^[A-Za-z][A-Za-z0-9]{1,29}$/.test(slug)) fail('--slug mesti huruf/nombor sahaja (cth. TempahanDewan)');
const color = (arg('color') || (tokSrc.match(/--brand: (#[0-9A-Fa-f]{6})/) || [])[1] || '#4F46E5').toUpperCase();
if (!/^#[0-9A-F]{6}$/.test(color)) fail('--color mesti format #RRGGBB');

// ---------------------------------------------------------------- Warna
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const brand = hex2rgb(color);
const palette = {
  brand: color,
  brand900: rgb2hex(mix(brand, [10, 12, 30], 0.55)),
  brand100: rgb2hex(mix(brand, [255, 255, 255], 0.84)),
  brand50: rgb2hex(mix(brand, [255, 255, 255], 0.93)),
  brandRing: 'rgba(' + brand.join(', ') + ', .16)'
};
const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (1.05) / (lum(brand) + 0.05);
if (contrast < 4.5) console.warn('⚠ Kontras teks putih atas ' + color + ' = ' + contrast.toFixed(1) + ':1 (< 4.5:1 WCAG AA). Pertimbang warna lebih gelap.');

// ---------------------------------------------------------------- Kemas kini fail
function edit(rel, fn) {
  const file = path.join(ROOT, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) { fs.writeFileSync(file, after); console.log('✎ ' + rel); }
}
const setMarked = (src, marker, value) => src.replace(new RegExp("'[^']*'(,? *(?:\\}, *)?\\/\\/ @init:" + marker + ')', 'g'), "'" + value + "'$1");

edit('src/config/Config.gs', (s) => {
  s = setMarked(s, 'appName', name);
  s = setMarked(s, 'tagline', tagline);
  s = setMarked(s, 'slug', slug);
  s = setMarked(s, 'brandColor', color);
  return setMarked(s, 'shortName', shortName);
});
edit('src/models/SettingModel.gs', (s) => setMarked(setMarked(s, 'appName', name), 'tagline', tagline));
edit('src/frontend/css/tokens.html', (s) => {
  Object.keys(palette).forEach((k) => {
    s = s.replace(new RegExp('(--[a-z0-9-]+: )[^;]+(;\\s*\\/\\* @init:' + k + ' \\*\\/)'), '$1' + palette[k] + '$2');
  });
  return s;
});
edit('pwa/offline.html', (s) => s.replace(/#[0-9A-Fa-f]{6}(?=">\n  <title>)/, color).replace(/background: #[0-9A-Fa-f]{6}; color: #fff; font-weight/, 'background: ' + color + '; color: #fff; font-weight'));
edit('package.json', (s) => { const j = JSON.parse(s); j.name = slug.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); j.description = name + ' — ' + tagline; return JSON.stringify(j, null, 2) + '\n'; });
edit('README.md', (s) => s.replace(/^# .*$/m, '# ' + name));

// ---------------------------------------------------------------- Ikon PNG (tanpa kebergantungan luar)
function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** Jarak titik ke segmen. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Logo: petak bucu bulat warna jenama + tanda "M" putih (sama dengan #i-brand). opts: full (maskable), mono (lencana) */
function drawIcon(size, opts) {
  const o = opts || {};
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling
  const pad = o.full ? 0 : size * 6 / 64, r = o.full ? 0 : size * 14 / 64;
  const scale = o.full ? 0.72 : 1; // maskable: tanda dalam zon selamat
  const cx = size / 2, cy = size / 2;
  const P = [[22, 40], [22, 24], [32, 32], [42, 24], [42, 40]].map(([x, y]) => [cx + (x - 32) * size / 64 * scale, cy + (y - 32) * size / 64 * scale]);
  const stroke = size * 4.5 / 64 / 2 * scale * (o.mono ? 1.5 : 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inBg = 0, inMark = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
          const qx = Math.max(pad + r - px, 0, px - (size - pad - r)), qy = Math.max(pad + r - py, 0, py - (size - pad - r));
          if (Math.hypot(qx, qy) <= r && px >= pad && px <= size - pad && py >= pad && py <= size - pad) inBg++;
          let d = Infinity;
          for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segDist(px, py, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]));
          if (d <= stroke) inMark++;
        }
      }
      const a = inBg / (ss * ss), m = inMark / (ss * ss), i = (y * size + x) * 4;
      if (o.mono) { buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = Math.round(255 * m); continue; }
      const col = mix(brand, [255, 255, 255], m);
      buf[i] = Math.round(col[0]); buf[i + 1] = Math.round(col[1]); buf[i + 2] = Math.round(col[2]);
      buf[i + 3] = Math.round(255 * Math.max(a, m * a));
    }
  }
  return png(size, size, buf);
}
const ICONS = path.join(ROOT, 'pwa', 'icons');
fs.mkdirSync(ICONS, { recursive: true });
[['icon-192.png', 192, {}], ['icon-512.png', 512, {}], ['maskable-512.png', 512, { full: true }], ['apple-touch-icon.png', 180, { full: true }],
  ['favicon-32.png', 32, {}], ['badge-72.png', 72, { mono: true }]].forEach(([f, s, o]) => fs.writeFileSync(path.join(ICONS, f), drawIcon(s, o)));
fs.writeFileSync(path.join(ICONS, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="' + color +
  '"/><path d="M22 40V24l10 8 10-8v16" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n');
console.log('✎ pwa/icons/* (6 PNG + SVG, warna ' + color + ')');
console.log('\n✔ Sistem dinamakan "' + name + '" (' + shortName + ', slug ' + slug + ').');
console.log('  Seterusnya: takrif modul dalam modules/*.json → npm run gen → npm test → npm run dev');
