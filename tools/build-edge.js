#!/usr/bin/env node
/**
 * build-edge.js — himpun semua src/**\/*.gs menjadi SATU modul ES untuk Supabase Edge Function.
 *
 *   node tools/build-edge.js                       → supabase/functions/api/backend.mjs
 *   node tools/build-edge.js --tests --out <fail>  → sertakan src/tests (untuk mengesahkan himpunan)
 *
 * Modul mengeksport createBackend(G): G = objek perkhidmatan GAS tiruan (SpreadsheetApp, CacheService, …).
 * Setiap panggilan createBackend() mencipta salinan BAHARU semua objek global (sama seperti setiap
 * eksekusi Apps Script bermula bersih) — tiada keadaan bocor antara permintaan.
 * Kod dijalankan dalam mod ketat (modul ES); `npm run test:edge` membuktikan ujian GAS lulus dalam himpunan ini.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./js-strip');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const withTests = args.includes('--tests');
const oi = args.indexOf('--out');
const OUT = path.resolve(ROOT, oi >= 0 ? args[oi + 1] : 'supabase/functions/api/backend.mjs');

/** Perkhidmatan GAS yang dibekalkan oleh runtime (lihat supabase/functions/api/runtime.js). */
const SERVICES = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Session', 'MailApp',
  'ScriptApp', 'HtmlService', 'ContentService', 'DriveApp', 'MimeType', 'UrlFetchApp', 'console', 'EDGE_RUNTIME', 'globalThis'];

function listGs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return (!withTests && e.name === 'tests') ? [] : listGs(p);
    return e.name.endsWith('.gs') ? [p] : [];
  }).sort();
}

const files = listGs(SRC);
const names = new Set();
let body = '';
for (const f of files) {
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of code.matchAll(/^(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  body += '\n/* ---- ' + path.relative(SRC, f) + ' ---- */\n' + code + '\n';
}

const out = [
  '/* DIJANA oleh tools/build-edge.js — JANGAN SUNTING. Sumber: src (fail .gs) */',
  'export const BACKEND_FILES = ' + files.length + ';',
  'export function createBackend(G) {',
  '  const { ' + SERVICES.concat(withTests ? ['__mails'] : []).join(', ') + ' } = G;',
  body,
  '  return { ' + [...names].join(', ') + ' };',
  '}',
  ''
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
/* Konfigurasi awam fungsi (URL Apps Script untuk proksi sebelum data dipindahkan) */
if (!withTests) {
  const bj = path.join(ROOT, 'backend.json');
  const cfg = fs.existsSync(bj) ? JSON.parse(fs.readFileSync(bj, 'utf8')) : {};
  fs.writeFileSync(path.join(path.dirname(OUT), 'config.json'), JSON.stringify({ gasUrl: cfg.gasUrl || '' }, null, 2) + '\n');
}
console.log(`✔ build-edge: ${files.length} fail .gs → ${path.relative(ROOT, OUT)} (${Math.round(out.length / 1024)} KB, ${names.size} nama global)`);
