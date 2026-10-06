#!/usr/bin/env node
/**
 * build-gas.js — sediakan folder untuk `clasp push`: salinan src/ dengan komen dibuang daripada
 * setiap <script> dalam src/frontend/**.html (lihat tools/js-strip.js untuk sebabnya).
 *
 *   node tools/build-gas.js [--out build/gas]
 *
 * CI (deploy.yml) menolak folder ini (rootDir = build/gas). Fail .gs disalin tanpa diubah.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripHtmlScripts } = require('./js-strip');
const { gasStripScript } = require('./gas-html');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = path.resolve(ROOT, oi >= 0 ? args[oi + 1] : 'build/gas');

fs.rmSync(OUT, { recursive: true, force: true });
let files = 0;
let saved = 0;
function copy(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, e.name);
    const rel = path.relative(SRC, from);
    const to = path.join(OUT, rel);
    if (e.isDirectory()) { copy(from); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (rel.startsWith('frontend' + path.sep) && e.name.endsWith('.html')) {
      const src = fs.readFileSync(from, 'utf8');
      const out = stripHtmlScripts(src);
      for (const m of out.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        new vm.Script(m[1], { filename: rel });
        new vm.Script(gasStripScript(m[1]), { filename: rel + ' (selepas GAS)' });
      }
      saved += src.length - out.length;
      fs.writeFileSync(to, out);
    } else {
      fs.copyFileSync(from, to);
    }
    files++;
  }
}
copy(SRC);
console.log(`✔ build-gas: ${files} fail → ${path.relative(ROOT, OUT)} (${Math.round(saved / 1024)} KB komen dibuang)`);
