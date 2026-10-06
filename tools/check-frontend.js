#!/usr/bin/env node
/**
 * check-frontend.js — semak sintaks setiap <script> dalam src/frontend/**.html,
 * pastikan setiap include() wujud, dan tiada rahsia/API GAS terlarang dalam frontend.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { gasStripScript } = require('./gas-html');
const ROOT = path.join(__dirname, '..', 'src');
const FE = path.join(ROOT, 'frontend');
let failed = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(FE).filter((x) => x.endsWith('.html'))) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    try { new vm.Script(code, { filename: rel + '#' + i }); } catch (e) { failed++; console.error('✘ Sintaks', rel, e.message); }
    // Apps Script membuang teks selepas // dalam <script>; kod mesti kekal sah selepas itu
    try { new vm.Script(gasStripScript(code), { filename: rel + '#' + i + ' (selepas pemprosesan GAS)' }); } catch (e) {
      failed++;
      const bad = code.split('\n').map((l, n) => [n + 1, l]).filter(([, l]) => { const t = l.trim(); return l.indexOf('//') >= 0 && !t.startsWith('//') && !/\s\/\/ /.test(l); });
      console.error('✘ Rosak selepas Apps Script buang "//":', rel, e.message, bad.slice(0, 3).map(([n, l]) => '\n    baris ' + n + ': ' + l.trim().slice(0, 100)).join(''));
    }
  });
  for (const m of src.matchAll(/include\('([^']+)'\)/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1] + '.html'))) { failed++; console.error('✘ include tiada:', m[1], 'dalam', rel); }
  }
  if (/SpreadsheetApp|DriveApp|PropertiesService|AUTH_PEPPER|FORM_SECRET/.test(src)) { failed++; console.error('✘ API/rahsia server dalam frontend:', rel); }
  // innerHTML hanya boleh menerima templat html`` (auto-escape) — larang penyambungan string mentah
  for (const m of src.matchAll(/\.innerHTML\s*=\s*([^;]*);/g)) {
    if (/\+\s*[a-zA-Z_]/.test(m[1]) && !/html`/.test(m[1])) { failed++; console.error('✘ innerHTML dengan penyambungan string (risiko XSS):', rel, m[1].slice(0, 80)); }
  }
}
console.log(failed ? `\n${failed} masalah ditemui.` : '✔ Semua skrip frontend sah, include lengkap, tiada API server/rahsia.');
process.exit(failed ? 1 : 0);
