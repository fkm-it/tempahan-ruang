#!/usr/bin/env node
/**
 * scan-secrets.js — gagalkan build/CI jika RAHSIA tersalah masuk ke repo.
 * Diperiksa: kunci peribadi PEM, fail akaun servis Firebase/GCP, .clasprc.json, token OAuth Google.
 * (Nilai awam seperti apiKey Firebase web & URL Web App BUKAN rahsia dan dibenarkan.)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'web', '.verify-web']);
const RULES = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'kunci peribadi PEM'],
  [/"type"\s*:\s*"service_account"/, 'fail JSON akaun servis (Firebase/GCP)'],
  [/"refresh_token"\s*:\s*"1\/\/[A-Za-z0-9_-]{20,}/, 'refresh token Google (.clasprc.json)'],
  [/\bya29\.[A-Za-z0-9_-]{40,}/, 'token akses OAuth Google'],
  [/\bAUTH_PEPPER\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/, 'nilai AUTH_PEPPER']
];
const BAD_NAMES = [/firebase-adminsdk.*\.json$/i, /^\.clasprc\.json$/, /service[-_]?account.*\.json$/i];

let found = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p);
    if (e.isDirectory()) { walk(p); continue; }
    if (BAD_NAMES.some((re) => re.test(e.name))) { found++; console.error('✘ Fail rahsia tidak boleh berada dalam repo: ' + rel); continue; }
    if (fs.statSync(p).size > 2 * 1024 * 1024 || /\.(png|jpe?g|webp|ico|zip)$/i.test(e.name)) continue;
    const text = fs.readFileSync(p, 'utf8');
    RULES.forEach(([re, what]) => { if (re.test(text)) { found++; console.error('✘ ' + what + ' dikesan dalam ' + rel); } });
  }
}
walk(ROOT);
if (found) {
  console.error('\n' + found + ' rahsia dikesan. Buang daripada repo (dan sejarah git), putar (rotate) kunci tersebut, simpan dalam Script Properties / GitHub Secrets.');
  process.exit(1);
}
console.log('✔ Tiada rahsia dikesan dalam repo.');
