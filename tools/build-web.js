#!/usr/bin/env node
/**
 * build-web.js — bina versi web statik (untuk GitHub Pages / domain sendiri).
 *
 *   npm run build:web                       (guna webAppUrl dalam pwa/config.js)
 *   node tools/build-web.js --api URL       (tindih webAppUrl; atau env WEB_APP_URL — digunakan oleh CI)
 *   node tools/build-web.js --out DIR       (folder output, lalai: web/)
 *
 * Hasil (folder web/) — muat naik KANDUNGANNYA ke akar repo GitHub Pages:
 *   index.html, config.js, sw.js, manifest.webmanifest (dijana: nama/warna/pintasan modul), offline.html, icons/, assets/
 *
 * Frontend SAMA dengan versi Apps Script (src/frontend). Bezanya:
 *   - Semua <script>/<style> sebaris dikumpul ke fail aset berhash → CSP ketat (script-src 'self').
 *   - pwa/bridge.js menyediakan google.script.run.api() yang memanggil doPost() melalui fetch tanpa cookie.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { renderTemplate, readAppConfig } = require('./template');
const { stripHtmlScripts } = require('./js-strip');

const ROOT = path.join(__dirname, '..');
const PWA = path.join(ROOT, 'pwa');
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const OUT = path.resolve(argVal('--out') || path.join(ROOT, 'web'));

const PROD_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const DEV_URL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/__api$/;
/* Backend Supabase Edge Function (lihat backend.json & supabase/functions/api) */
const EDGE_URL = /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/[a-z0-9_-]+$/;
const backendJson = fs.existsSync(path.join(ROOT, 'backend.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'backend.json'), 'utf8')) : {};

function fail(msg) { console.error('✖ ' + msg); process.exit(1); }
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

// ---------------------------------------------------------------- URL API
const cfgFile = fs.existsSync(path.join(PWA, 'config.js')) ? 'config.js' : 'config.example.js';
let configJs = fs.readFileSync(path.join(PWA, cfgFile), 'utf8');
const m = configJs.match(/webAppUrl:\s*'([^']*)'/);
if (!m) fail('pwa/config.js: medan webAppUrl tidak dijumpai.');
/* backend.json webUsesEdge=true → web memanggil Supabase terus (tukar SELEPAS pindahKeSupabase()) */
let apiUrl = argVal('--api') || (backendJson.webUsesEdge ? backendJson.apiUrl : '') || process.env.WEB_APP_URL || m[1];
if (/\s/.test(apiUrl)) apiUrl = apiUrl.trim();
if (/GANTIKAN/i.test(apiUrl) || (!PROD_URL.test(apiUrl) && !DEV_URL.test(apiUrl) && !EDGE_URL.test(apiUrl))) {
  fail('URL Web App tidak sah: "' + apiUrl + '"\n  Jangkaan: https://script.google.com/macros/s/<ID>/exec\n' +
    '  Salin daripada Apps Script → Deploy → Manage deployments, kemudian edit pwa/config.js (atau guna --api).');
}
configJs = configJs.replace(m[0], "webAppUrl: '" + apiUrl + "'");
// config.js dimuatkan juga oleh service worker (tiada `window` di sana) — format lama dinormalkan
configJs = configJs.replace(/window\.APP_CONFIG/g, 'self.APP_CONFIG');
// CI: nilai Firebase (AWAM, bukan rahsia) disuntik melalui env tanpa mengubah fail
[['FIREBASE_API_KEY', 'apiKey'], ['FIREBASE_AUTH_DOMAIN', 'authDomain'], ['FIREBASE_PROJECT_ID', 'projectId'],
  ['FIREBASE_SENDER_ID', 'messagingSenderId'], ['FIREBASE_APP_ID', 'appId'], ['FIREBASE_VAPID_KEY', 'vapidKey']].forEach(([env, key]) => {
  const v = String(process.env[env] || '').trim();
  if (!v) return;
  if (!/^[A-Za-z0-9_:.\-]+$/.test(v)) fail('Nilai ' + env + ' mengandungi aksara tidak sah.');
  configJs = configJs.replace(new RegExp(key + ":\\s*'[^']*'"), key + ": '" + v + "'");
});
// Firebase (pilihan): sahkan sama ada lengkap atau kosong sepenuhnya
const fbVals = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId', 'vapidKey'].map((k) => {
  const mm = configJs.match(new RegExp(k + ":\\s*'([^']*)'"));
  return mm ? mm[1] : '';
});
const fbFilled = fbVals.filter(Boolean).length;
if (fbFilled && fbFilled < 5) fail('pwa/config.js: konfigurasi Firebase separuh lengkap. Isi apiKey, projectId, messagingSenderId, appId dan vapidKey (atau kosongkan semua).');
const PUSH = fbFilled >= 5;

// ---------------------------------------------------------------- Render frontend
const app = readAppConfig();
let page = renderTemplate('frontend/index', { appName: app.appName, tagline: app.tagline, version: app.version, slug: app.slug }, { processInclude: stripHtmlScripts });
const tokens = fs.readFileSync(path.join(ROOT, 'src', 'frontend', 'css', 'tokens.html'), 'utf8');
const token = (name, def) => { const t = tokens.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})')); return t ? t[1] : def; };
const THEME = token('brand', '#4F46E5');
const THEME_DARK = token('brand-900', '#312E81');

const styles = [];
page = page.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (all, attrs, css) => {
  const media = (attrs.match(/media="([^"]+)"/) || [])[1];
  styles.push(media ? '@media ' + media + ' {\n' + css + '\n}' : css);
  return '';
});
const scripts = [fs.readFileSync(path.join(PWA, 'bridge.js'), 'utf8')];
page = page.replace(/<script>([\s\S]*?)<\/script>/g, (all, js) => { scripts.push(js); return ''; });
if (/<script[\s>]/i.test(page.replace(/<noscript>[\s\S]*?<\/noscript>/g, ''))) fail('Tag <script> tidak dijangka kekal dalam halaman.');
if (/\son[a-z]+\s*=\s*"/i.test(page)) fail('Pengendali acara sebaris (onclick=...) tidak dibenarkan oleh CSP.');

// Daftar service worker (HTTPS sahaja; localhost dilangkau supaya pembangunan tidak dicache)
scripts.push("if ('serviceWorker' in navigator && location.protocol === 'https:') {\n" +
  "  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW gagal', e); }); });\n}");

// Bundel: setiap blok dalam skop asal (fail berasingan dalam HTML = skrip berasingan).
const bundleJs = scripts.map((s, i) => '/* ---- bahagian ' + i + ' ---- */\n' + s.trim() + '\n').join(';\n');
try { new vm.Script(bundleJs, { filename: 'app.js' }); } catch (e) { fail('Ralat sintaks dalam bundel JS: ' + e.message); }
const bundleCss = styles.join('\n');
const jsName = 'assets/app.' + hash(bundleJs) + '.js';
const cssName = 'assets/app.' + hash(bundleCss) + '.css';

// ---------------------------------------------------------------- CSP & head
const apiOrigin = new URL(apiUrl).origin;
const connect = DEV_URL.test(apiUrl) || EDGE_URL.test(apiUrl) ? [apiOrigin] : ['https://script.google.com', 'https://script.googleusercontent.com'];
const csp = [
  "default-src 'self'",
  "script-src 'self'" + (PUSH ? ' https://www.gstatic.com' : ''),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' " + connect.join(' ') + (PUSH ? ' https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com https://fcm.googleapis.com https://www.gstatic.com' : ''),
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const headExtra = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
  '<meta name="referrer" content="strict-origin-when-cross-origin">',
  '<meta name="theme-color" content="' + THEME + '">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="' + app.appName + '">',
  '<title>' + app.appName + ' — ' + app.tagline + '</title>',
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
].join('\n  ');
page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + headExtra);
page = page.replace('</head>', '  <link rel="stylesheet" href="' + cssName + '">\n</head>');
page = page.replace('</body>', '  <script src="config.js"></script>\n  <script src="' + jsName + '"></script>\n</body>');
page = page.replace(/\n\s*\n\s*\n+/g, '\n\n');

// ---------------------------------------------------------------- Tulis output
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, 'config.js'), configJs);
fs.writeFileSync(path.join(OUT, jsName), bundleJs);
fs.writeFileSync(path.join(OUT, cssName), bundleCss);
const manifest = buildManifest();
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(PWA, 'offline.html'), path.join(OUT, 'offline.html'));
const icons = fs.readdirSync(path.join(PWA, 'icons'));
icons.forEach((f) => fs.copyFileSync(path.join(PWA, 'icons', f), path.join(OUT, 'icons', f)));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
// Tangkapan skrin untuk dialog pasang Android (tidak dicache oleh service worker)
const shotsDir = path.join(PWA, 'screenshots');
if (fs.existsSync(shotsDir)) {
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  fs.readdirSync(shotsDir).filter((f) => /\.png$/.test(f)).forEach((f) => fs.copyFileSync(path.join(shotsDir, f), path.join(OUT, 'screenshots', f)));
}
// Semak setiap fail yang dirujuk oleh manifest wujud
const refs = [].concat(manifest.icons || [], manifest.screenshots || [], ...(manifest.shortcuts || []).map((x) => x.icons || []));
refs.forEach((r) => { if (!fs.existsSync(path.join(OUT, r.src))) fail('manifest merujuk fail yang tiada: ' + r.src); });

const assets = ['./', 'index.html', 'config.js', jsName, cssName, 'offline.html', 'manifest.webmanifest']
  .concat(icons.filter((f) => /\.png$/.test(f)).map((f) => 'icons/' + f));
const buildId = hash(page + bundleJs + bundleCss + configJs);
let sw = fs.readFileSync(path.join(PWA, 'sw.js'), 'utf8');
if (!sw.includes("'__CACHE__'") || !sw.includes('= __ASSETS__;')) fail('pwa/sw.js: pemegang tempat __CACHE__/__ASSETS__ tidak dijumpai.');
sw = sw.split("'__CACHE__'").join(JSON.stringify((app.slug || 'app').toLowerCase() + '-' + app.version + '-' + buildId))
  .split('= __ASSETS__;').join('= ' + JSON.stringify(assets) + ';');
if (/__(CACHE|ASSETS)__/.test(sw)) fail('sw.js masih mengandungi pemegang tempat.');
try { new vm.Script(sw, { filename: 'sw.js' }); } catch (e) { fail('Ralat sintaks sw.js: ' + e.message); }
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('✔ Binaan web ' + app.appName + ' ' + app.version + ' → ' + path.relative(process.cwd(), OUT) + path.sep);
console.log('  API     : ' + apiUrl);
console.log('  Push    : ' + (PUSH ? 'Firebase ' + fbVals[2] : 'tidak dikonfigurasi (pilihan)'));
console.log('  JS      : ' + jsName + ' (' + kb(bundleJs) + ')');
console.log('  CSS     : ' + cssName + ' (' + kb(bundleCss) + ')');
console.log('  Fail    : ' + (assets.length + 3) + ' (muat naik KANDUNGAN folder ini ke akar repo GitHub Pages)');

/** Manifest PWA dijana: nama & warna daripada Config.gs / tokens.html, pintasan daripada modules/*.json. */
function buildManifest() {
  const base = JSON.parse(fs.readFileSync(path.join(PWA, 'manifest.webmanifest'), 'utf8'));
  const modDir = path.join(ROOT, 'modules');
  const mods = fs.existsSync(modDir) ? fs.readdirSync(modDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(modDir, f), 'utf8'))) : [];
  const shortcuts = mods.filter((x) => (x.access || {}).create !== 'ADMIN' && !(x.nav && x.nav.user === false))
    .sort((a, b) => ((a.nav || {}).order || 50) - ((b.nav || {}).order || 50)).slice(0, 3)
    .map((x) => ({ name: (x.label || x.key) + ' baharu', short_name: x.label || x.key, url: './#' + (x.path || '/' + x.key) + '/baru',
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }));
  const shots = fs.existsSync(path.join(PWA, 'screenshots')) ? fs.readdirSync(path.join(PWA, 'screenshots')).filter((f) => /\.png$/.test(f)) : [];
  return Object.assign(base, {
    name: app.appName, short_name: app.shortName || app.appName.slice(0, 12), description: app.tagline,
    theme_color: THEME, background_color: THEME_DARK, shortcuts,
    screenshots: shots.map((f) => ({ src: 'screenshots/' + f, sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: app.appName }))
  });
}
