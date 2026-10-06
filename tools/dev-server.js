#!/usr/bin/env node
/**
 * dev-server.js — Pelayan pembangunan tempatan: backend GAS sebenar (mock perkhidmatan Google)
 * + frontend sebenar, tanpa perlu clasp push. Untuk pembangunan UI & ujian E2E.
 *
 *   node tools/dev-server.js [--port 8080] [--seed]
 *
 * --web DIR : hidangkan juga binaan web statik (npm run build:web) di /web/
 *             — bina dengan: node tools/build-web.js --api http://localhost:PORT/__api --out DIR
 * --fake-push : akaun servis FCM palsu; mesej FCM dicetak ke konsol (uji notifikasi telefon)
 * --seed  : cipta akaun demo & data contoh (tools/seed-demo.js)
 *   super@demo.local / Demo1234 (SUPER_ADMIN), user@demo.local / Demo1234 (USER)
 *
 * NOTA: hanya untuk pembangunan. Data disimpan dalam memori dan hilang apabila dihentikan.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./load-gas');
const { gasProcessHtml } = require('./gas-html');
const { stripHtmlScripts } = require('./js-strip');
const tpl = require('./template');

const args = process.argv.slice(2);
const pi = args.indexOf('--port');
const PORT = pi >= 0 ? Number(args[pi + 1]) : 8080;
const wi = args.indexOf('--web');
const WEB_DIR = wi >= 0 ? path.resolve(args[wi + 1]) : '';

const props = { BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@demo.local' };
if (args.includes('--fake-push')) {
  // Akaun servis FCM palsu (UrlFetchApp dimock) — untuk menguji aliran notifikasi telefon secara tempatan
  const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
  props.FCM_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'app-dev', client_email: 'dev@app-dev.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  props.PUBLIC_BASE_URL = 'https://example.github.io/';
}
const gas = loadGas({ quiet: !args.includes('--verbose'), webAppUrl: 'http://localhost:' + PORT + '/', properties: props });
if (args.includes('--fake-push')) {
  gas.env.state.fetchHandler = (url, params) => {
    if (/oauth2/.test(url)) return { code: 200, body: { access_token: 'ya29.dev', expires_in: 3599 } };
    const m = JSON.parse(params.payload).message;
    console.log('[FCM] → ' + m.token.slice(0, 16) + '… | ' + m.notification.title + ' | ' + m.notification.body);
    return { code: 200, body: { name: 'projects/app-dev/messages/1' } };
  };
}
const ctx = gas.context;
ctx.setupDatabase();
if (args.includes('--seed')) require('./seed-demo')(ctx, gas);

/*
 * --edge <postgres-url>: layan /__api melalui runtime Supabase (supabase/functions/api) dengan Postgres sebenar —
 * data demo di atas dipindahkan seperti pindahKeSupabase(). Pemacu postgres: env POSTGRES_JS atau node_modules/postgres.
 */
const ei = args.indexOf('--edge');
let edgeRuntime = null;
const edgeReady = ei < 0 ? Promise.resolve() : (async () => {
  const { pathToFileURL } = require('url');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-edge.js')], { stdio: 'inherit' });
  const FN = path.join(__dirname, '..', 'supabase', 'functions', 'api');
  const imp = (f) => import(pathToFileURL(path.join(FN, f)).href);
  const postgres = (await import(pathToFileURL(path.join(process.env.POSTGRES_JS || path.join(__dirname, '..', 'node_modules', 'postgres'), 'src', 'index.js')).href)).default;
  const [{ createBackend }, { createRuntime }, { createPgStore }, { createWorkerApi }] = await Promise.all([imp('backend.mjs'), imp('runtime.mjs'), imp('store-pg.mjs'), imp('worker.mjs')]);
  const sql = postgres(args[ei + 1], { prepare: false, max: 8, onnotice: () => {} });
  await sql.unsafe('drop schema if exists private cascade');
  const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const f of fs.readdirSync(MIG).sort()) await sql.unsafe(fs.readFileSync(path.join(MIG, f), 'utf8'));
  const store = createPgStore(sql);
  edgeRuntime = createRuntime({ store, createBackend, log: { log() {}, info() {}, warn() {}, error: (...a) => console.error('[edge]', ...a) } });
  const ssObj = gas.env.state.spreadsheets[Object.keys(gas.env.state.spreadsheets)[0]];
  const sheets = ssObj.getSheets().map((sh) => {
    const lr = sh.getLastRow(); const lc = sh.getLastColumn();
    const v = lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
    return { name: sh.getName(), header: v[0] || [], rows: v.slice(1) };
  });
  const nonce = 'dev'.repeat(11);
  const r = await createWorkerApi({ store, runtime: edgeRuntime, verifyImport: async (n) => n === nonce }).handle({ action: 'system.import', payload: { sheets, props: Object.assign({}, gas.env.state.props), nonce } });
  if (!r.success) throw new Error('Import edge gagal: ' + r.message);
  console.log('Mod EDGE: /__api dilayan oleh runtime Supabase + Postgres (' + r.data.rows + ' baris diimport)');
})();

function renderTemplate(file, vars) {
  return tpl.renderTemplate(file, vars, { processInclude: (h) => gasProcessHtml(stripHtmlScripts(h)) } /* sama seperti build-gas + Apps Script */);
}

/** Shim google.script.* untuk pelayar. */
const SHIM = `<script>
window.google = { script: {
  run: (function () {
    function make(s, f) {
      return {
        withSuccessHandler: function (fn) { return make(fn, f); },
        withFailureHandler: function (fn) { return make(s, fn); },
        api: function (req) {
          fetch('/__api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) })
            .then(function (r) { return r.json(); }).then(function (d) { setTimeout(function () { s && s(d); }, window.__latency || 120); })
            .catch(function (e) { f && f(e); });
        }
      };
    }
    return make(null, null);
  })(),
  url: { getLocation: function (cb) { cb({ hash: '', parameter: {} }); } },
  history: { replace: function () {}, push: function () {} }
} };
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/__api') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 40e6) req.destroy(); });
    req.on('end', async () => {
      let out;
      try {
        const request = JSON.parse(body);
        if (ei >= 0) { await edgeReady; out = (await edgeRuntime.handle(request)).result; } else out = ctx.api(request);
      } catch (e) { out = { success: false, code: 'BAD_REQUEST', message: String(e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (WEB_DIR && (url.pathname === '/web' || url.pathname.startsWith('/web/'))) {
    if (url.pathname === '/web') { res.writeHead(301, { Location: '/web/' + url.search }); res.end(); return; }
    let rel = decodeURIComponent(url.pathname.slice(5)) || 'index.html';
    const file = path.resolve(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const app = tpl.readAppConfig();
    let page = renderTemplate('frontend/index', { appName: app.appName, tagline: app.tagline, version: app.version, slug: app.slug });
    page = page.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + SHIM);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(PORT, () => console.log(tpl.readAppConfig().appName + ' — dev server: http://localhost:' + PORT + '/'));
