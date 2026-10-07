/**
 * test-edge-pg.mjs — ujian integrasi runtime Supabase (supabase/functions/api) terhadap Postgres SEBENAR.
 *
 *   EDGE_TEST_PG=postgres://postgres@localhost:54329/postgres POSTGRES_JS=<dir node_modules/postgres> node tools/test-edge-pg.mjs
 *
 * Aliran: data demo dijana dengan backend GAS (mock) → diimport seperti pindahKeSupabase() → semua tindakan melalui
 * runtime.mjs + store-pg.mjs: log masuk, borang awam, pertindihan, konkurensi antara isolat, kunci kongsi, sheet malas,
 * penyelenggaraan, outbox email, cache isolat.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PG = process.env.EDGE_TEST_PG;
if (!PG) { console.log('EDGE_TEST_PG tidak ditetapkan — ujian Postgres dilangkau.'); process.exit(0); }
const postgres = (await import(pathToFileURL(path.join(process.env.POSTGRES_JS || path.join(ROOT, 'node_modules/postgres'), 'src/index.js')).href)).default;

execFileSync(process.execPath, [path.join(here, 'build-edge.js')], { stdio: 'inherit' });
const FN = path.join(ROOT, 'supabase/functions/api');
const { createBackend } = await import(pathToFileURL(path.join(FN, 'backend.mjs')).href);
const { createRuntime } = await import(pathToFileURL(path.join(FN, 'runtime.mjs')).href);
const { createPgStore } = await import(pathToFileURL(path.join(FN, 'store-pg.mjs')).href);
const { createWorkerApi } = await import(pathToFileURL(path.join(FN, 'worker.mjs')).href);

const sql = postgres(PG, { prepare: false, max: 6, onnotice: () => {} });
await sql.unsafe('drop schema if exists private cascade');
for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort()) await sql.unsafe(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));

let failed = 0;
let passed = 0;
const quiet = { log() {}, info() {}, warn() {}, error: (...a) => console.error('  [log]', ...a) };
async function test(name, fn) {
  try { await fn(); passed++; console.log('✔ ' + name); } catch (e) { failed++; console.log('✘ ' + name + '\n    ' + (e && e.stack || e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'gagal'); };

// ---------------------------------------------------------------- 1. Data sumber (Google Sheets tiruan) → import
const { loadGas } = require('./load-gas');
const gas = loadGas({ quiet: true, properties: { BOOTSTRAP_SUPER_ADMIN_EMAIL: 'super@demo.local', APP_ENV: 'PRODUCTION' } });
gas.context.setupDatabase();
require('./seed-demo')(gas.context, gas);
const ss = gas.env.state.spreadsheets[Object.keys(gas.env.state.spreadsheets)[0]];
const sheets = ss.getSheets().map((sh) => {
  const lr = sh.getLastRow();
  const lc = sh.getLastColumn();
  const values = lr && lc ? sh.getRange(1, 1, lr, lc).getValues() : [];
  return { name: sh.getName(), header: values[0] || [], rows: values.slice(1) };
});
const props = Object.assign({}, gas.env.state.props);
delete props.SPREADSHEET_ID;
/* Data lama yang "kotor": ID berganda & baris tanpa ID dalam STAF */
const stafSheet = sheets.find((x) => x.name === 'STAF');
const dupRow = stafSheet.rows[0].slice();
dupRow[stafSheet.header.indexOf('nama')] = 'Pendua Lama';
stafSheet.rows.push(dupRow, ['', 'tanpa id']);

const store = createPgStore(sql);
const mkRuntime = () => createRuntime({ store, createBackend, log: quiet });
const NONCE = 'n'.repeat(43);
const worker = createWorkerApi({ store, runtime: mkRuntime(), log: quiet, verifyImport: async (n) => n === NONCE });
const nodeCrypto = await import('node:crypto');
let PEPPER = '';
const signed = (action, payload, tsShift) => {
  const p = payload || {};
  const ts = Date.now() + (tsShift || 0);
  const h = nodeCrypto.createHash('sha256').update(JSON.stringify(p)).digest('hex');
  return { action, payload: p, ts, worker: nodeCrypto.createHmac('sha256', PEPPER).update('druang-worker-v2|' + ts + '|' + action + '|' + h).digest('hex') };
};

await test('Import: tanpa nonce sah ditolak; dengan nonce → semua sheet & Script Properties dipindah; ditutup selepas itu', async () => {
  const bad = await worker.handle({ action: 'system.import', payload: { sheets, props, nonce: 'x'.repeat(43) } });
  assert(!bad.success && bad.code === 'FORBIDDEN', 'nonce palsu ' + JSON.stringify(bad));
  const r = await worker.handle({ action: 'system.import', payload: { sheets, props, nonce: NONCE } });
  assert(r.success, JSON.stringify(r));
  assert(r.data.sheets === sheets.length, 'bilangan sheet');
  assert(r.data.droppedBlankId === 1, 'baris tanpa ID dilaporkan');
  PEPPER = props.AUTH_PEPPER;
  const again = await worker.handle({ action: 'system.import', payload: { sheets, props, nonce: NONCE } });
  assert(!again.success, 'import kedua sepatutnya ditolak');
});

const A = mkRuntime();
const B = mkRuntime();
const call = async (rt, action, payload, token, meta) => (await rt.handle({ action, payload: payload || {}, token: token || '', meta: meta || {} })).result;
const ok = (r) => { if (!r.success) throw new Error(r.code + ': ' + r.message); return r.data; };
const day = (n) => { const d = new Date(Date.now() + n * 86400000 + 8 * 3600000); return d.toISOString().slice(0, 10); };

let sup;
await test('Log masuk dengan kata laluan sedia ada (AUTH_PEPPER dibawa bersama)', async () => {
  sup = ok(await call(A, 'auth.login', { email: 'super@demo.local', password: 'Demo1234' }));
  const me = ok(await call(B, 'auth.me', {}, sup.token));
  /* Ujian konkurensi menggunakan tarikh relatif: buka semua hari & tiada tarikh tutup */
  ok(await call(A, 'admin.settings.update', { changes: { HARI_OPERASI: '0,1,2,3,4,5,6', TARIKH_TUTUP: '[]', WAKTU_MULA: '07:00', WAKTU_TAMAT: '23:00' } }, sup.token));
  assert(me.user.role === 'SUPER_ADMIN', 'peranan');
});

let room;
await test('Data diimport boleh dibaca (ruang, staf, tempahan, bootstrap)', async () => {
  const boot = ok(await call(A, 'public.bootstrap'));
  assert(boot.modules && boot.modules.length >= 3, 'modul');
  const list = ok(await call(A, 'crud.list', { module: 'ruang', pageSize: 50 }, sup.token));
  room = list.items.find((x) => x.values && x.values.aktif);
  assert(list.items.length >= 8 && room, 'ruang');
  const tp = ok(await call(B, 'crud.list', { module: 'tempahan', pageSize: 50 }, sup.token));
  assert(tp.items.length >= 8, 'tempahan ' + tp.items.length);
});

const formToken = () => gas.get('SecurityUtils').signFormToken('crud:tempahan', Date.now() - 5000);
const pub = (rt, extra) => call(rt, 'crud.publicCreate', Object.assign({ module: 'tempahan', formToken: formToken(), noStaf: 'D1003', noTelefon: '012-3456789', ruang: room.id, tujuan: 'Ujian edge', bilanganPeserta: 10 }, extra));

await test('Borang awam: tempahan dicipta, email masuk outbox, kunci had kadar disimpan di kv', async () => {
  const before = (await sql`select count(*)::int as n from private.outbox`)[0].n;
  const r = ok(await pub(A, { tarikh: day(20), masaMula: '09:00', masaTamat: '10:00' }));
  assert(/^TP/.test(r.refNo) || r.refNo, 'refNo');
  const after = (await sql`select count(*)::int as n from private.outbox`)[0].n;
  assert(after > before, 'outbox email');
  const kv = (await sql`select count(*)::int as n from private.kv where k like 'kd1:rl:%'`)[0].n;
  assert(kv > 0, 'kv had kadar');
  const semak = ok(await call(B, 'tempahan.semak', { refNo: r.refNo, noStaf: 'D1003' }));
  assert(semak && (semak.refNo === r.refNo || semak.ref === r.refNo || JSON.stringify(semak).indexOf(r.refNo) >= 0), 'semak dari isolat lain');
});

await test('Pertindihan ditolak (isolat lain, data segar)', async () => {
  const r = await pub(B, { tarikh: day(20), masaMula: '09:30', masaTamat: '10:30' });
  assert(!r.success && r.code === 'CONFLICT', JSON.stringify(r));
});

await test('Konkurensi: 6 permintaan serentak untuk slot sama → tepat 1 berjaya', async () => {
  const rts = [0, 1, 2, 3, 4, 5].map(() => mkRuntime());
  await Promise.all(rts.map((rt) => call(rt, 'public.config')));
  const res = await Promise.all(rts.map((rt, i) => pub(rt, { noStaf: 'D100' + ((i % 5) + 1), tarikh: day(25), masaMula: '14:00', masaTamat: '15:00' })));
  const okN = res.filter((r) => r.success).length;
  assert(okN === 1, 'berjaya: ' + okN + ' → ' + JSON.stringify(res.map((r) => r.code || 'OK')));
  const rows = (await sql`select count(*)::int as n from private.sheet_rows where sheet = 'TEMPAHAN' and vals::text like ${'%' + day(25) + '%14:00%'}`)[0].n;
  assert(rows === 1, 'baris dalam DB: ' + rows);
});

await test('Idempotensi meta.rid: cubaan semula tindakan menulis → jawapan asal, tiada rekod berganda', async () => {
  const rid = 'rid' + Date.now() + 'abcdef';
  const p = { module: 'tempahan', formToken: formToken(), noStaf: 'D1004', noTelefon: '012-3456789', ruang: room.id, tujuan: 'Ujian rid', tarikh: day(30), masaMula: '08:00', masaTamat: '09:00' };
  const r1 = (await A.handle({ action: 'crud.publicCreate', payload: p, meta: { rid } })).result;
  const r2 = (await mkRuntime().handle({ action: 'crud.publicCreate', payload: p, meta: { rid } })).result;
  assert(r1.success && r2.success && r1.data.refNo === r2.data.refNo, JSON.stringify([r1, r2]).slice(0, 300));
  const n = (await sql`select count(*)::int as n from private.sheet_rows where sheet = 'TEMPAHAN' and vals::text like '%Ujian rid%'`)[0].n;
  assert(n === 1, 'rekod ' + n);
});

await test('Status: admin luluskan → versi sheet naik, isolat lain nampak perubahan', async () => {
  const list = ok(await call(A, 'crud.list', { module: 'tempahan', status: 'MENUNGGU', pageSize: 50 }, sup.token));
  const t = list.items[0];
  ok(await call(A, 'crud.setStatus', { module: 'tempahan', id: t.id, status: 'DILULUSKAN', note: 'ok' }, sup.token));
  const got = ok(await call(B, 'crud.get', { module: 'tempahan', id: t.id }, sup.token));
  const st = (got.record || got).status;
  assert(st === 'DILULUSKAN', 'status ' + st);
});

await test('Sheet malas (AUDIT_LOGS) dimuat apabila diperlukan', async () => {
  const r = ok(await call(mkRuntime(), 'admin.audit', {}, sup.token));
  assert(r && (Array.isArray(r) ? r.length : (r.items || []).length) > 0, 'audit kosong');
});

await test('Cache isolat: permintaan baca berulang tidak memuat semula sheet', async () => {
  await call(A, 'public.config');
  const loads = A.stats.loads;
  for (let i = 0; i < 3; i++) await call(A, 'public.config');
  assert(A.stats.loads === loads, 'loads ' + loads + ' → ' + A.stats.loads);
});

await test('Kunci log masuk kongsi: 5 cubaan gagal (pelbagai isolat) → akaun dikunci', async () => {
  for (let i = 0; i < 5; i++) await call(mkRuntime(), 'auth.login', { email: 'user@demo.local', password: 'salah' + i });
  const r = await call(mkRuntime(), 'auth.login', { email: 'user@demo.local', password: 'Demo1234' });
  assert(!r.success, 'sepatutnya dikunci: ' + JSON.stringify(r).slice(0, 120));
});

await test('Tetapan admin disimpan (sheet SETTINGS) & dibaca isolat lain', async () => {
  ok(await call(A, 'admin.settings.update', { changes: { LANDING_MESSAGE: 'Ujian edge ' + Date.now() } }, sup.token));
  const cfg = ok(await call(B, 'public.config'));
  assert(String(cfg.LANDING_MESSAGE || '').indexOf('Ujian edge') === 0, 'tetapan');
});

await test('Pekerja: tandatangan v2 (ts + tindakan + kandungan); tick menjalankan penyelenggaraan & menuntut email', async () => {
  assert(!(await worker.handle({ action: 'system.tick', worker: 'salah', ts: Date.now() })).success, 'tandatangan salah ditolak');
  assert(!(await worker.handle(signed('system.tick', { force: true }, -10 * 60 * 1000))).success, 'tandatangan lapuk ditolak');
  const reuse = signed('system.status', {});
  assert(!(await worker.handle(Object.assign({}, reuse, { action: 'system.export' }))).success, 'tandatangan tidak boleh diguna untuk tindakan lain');
  const tampered = signed('system.tick', { force: false });
  tampered.payload = { force: true, limit: 999 };
  assert(!(await worker.handle(tampered)).success, 'kandungan diubah ditolak');
  const r = await worker.handle(signed('system.tick', { force: true }));
  assert(r.success, JSON.stringify(r));
  assert(r.data.mails.length > 0, 'tiada email dituntut');
  assert(r.data.maintenance && r.data.maintenance.daily, 'penyelenggaraan harian');
  const m = r.data.mails[0];
  assert(m.payload.to && m.payload.subject, 'format email');
  const ack = await worker.handle(signed('system.ack', { results: r.data.mails.map((x) => ({ id: x.id, ok: true })) }));
  assert(ack.success, 'ack');
  const pending = (await sql`select count(*)::int as n from private.outbox where sent_at is null`)[0].n;
  assert(pending === 0, 'masih tertunggak ' + pending);
});

await test('Push melalui pekerja: status FCM dilaporkan, permohonan baharu → outbox push untuk admin, token mati dibatalkan', async () => {
  const off = await worker.handle(signed('system.tick', { pushRelay: false }));
  assert(off.success, 'tick');
  assert(ok(await call(A, 'public.config')).PUSH_ENABLED === false, 'tanpa pekerja FCM → tidak aktif');
  const on = await worker.handle(signed('system.tick', { pushRelay: true }));
  assert(on.success, 'tick relay');
  await worker.handle(signed('system.ack', { results: on.data.mails.map((x) => ({ id: x.id, ok: true })) }));
  assert(ok(await call(B, 'public.config')).PUSH_ENABLED === true, 'pekerja melaporkan FCM → aktif (isolat lain)');
  ok(await call(A, 'push.register', { token: 'edgeAdminTok_' + 'z'.repeat(40) }, sup.token));
  ok(await call(A, 'push.register', { token: 'edgeDeadTok_' + 'y'.repeat(40) }, sup.token));
  ok(await pub(B, { tarikh: day(27), masaMula: '08:00', masaTamat: '09:00', tujuan: 'Makluman telefon' }));
  const rows = await sql`select id::text as id, payload from private.outbox where kind = 'push' and sent_at is null`;
  const mine = rows.find((r) => r.payload.tokens.some((t) => t.token.indexOf('edgeAdminTok_') === 0));
  assert(mine, 'outbox push untuk admin');
  assert(/Makluman telefon/.test(mine.payload.msg.body) && /^#\/admin\/tempahan\//.test(mine.payload.msg.path), 'mesej push: ' + JSON.stringify(mine.payload.msg));
  const t = await worker.handle(signed('system.tick', { limit: 50 }));
  const claimed = t.data.mails.filter((m) => m.kind === 'push');
  assert(claimed.length >= 1, 'pekerja menuntut push');
  const deadId = mine.payload.tokens.find((x) => x.token.indexOf('edgeDeadTok_') === 0).id;
  const ack = await worker.handle(signed('system.ack', { results: t.data.mails.map((x) => ({ id: x.id, ok: true, revoke: x.kind === 'push' ? [deadId] : undefined })) }));
  assert(ack.success, 'ack');
  const st = ok(await call(A, 'push.status', {}, sup.token));
  assert(st.devices === 1 && st.serverEnabled === true, 'token mati dibatalkan: ' + JSON.stringify(st));
});

await test('PIC: lulus + tugaskan pembantu operasi; PIC sahkan melalui pautan (isolat lain)', async () => {
  await A.execute((Bk) => Bk.Env.set('PUBLIC_BASE_URL', 'https://contoh.github.io/app/'));
  const pic = ok(await call(A, 'crud.create', { module: 'pembantu', nama: 'PIC Edge', noTelefon: '011-2345 6789', emel: 'pic.edge@test.local' }, sup.token));
  const r = ok(await pub(A, { tarikh: day(28), masaMula: '10:00', masaTamat: '11:00', tujuan: 'Ujian PIC edge' }));
  const tp = ok(await call(B, 'crud.list', { module: 'tempahan', q: r.refNo }, sup.token)).items.find((x) => x.refNo === r.refNo);
  const l = ok(await call(B, 'tempahan.lulus', { id: tp.id, pembantu: pic.id, arahan: 'Buka 15 minit awal' }, sup.token));
  assert(l.status === 'DILULUSKAN' && l.tugasan && /^https:\/\/wa\.me\/601123456789\?text=/.test(l.tugasan.waUrl), 'tugasan + wa.me: ' + JSON.stringify(l).slice(0, 300));
  const m = /id=(TG-[0-9A-F]{16})&k=([0-9a-f]{32})/.exec(decodeURIComponent(l.tugasan.waUrl));
  assert(m, 'pautan pengesahan dalam mesej WhatsApp');
  const mail = (await sql`select payload from private.outbox where kind = 'mail' and payload->>'to' = 'pic.edge@test.local'`);
  assert(mail.length === 1 || mail.length === 0, 'emel PIC (jika emel dihidupkan)');
  const v = ok(await call(A, 'tugasan.lihat', { id: m[1], k: m[2] }));
  assert(v.pic === 'PIC Edge' && v.status === 'DITUGASKAN', 'paparan PIC');
  const d = ok(await call(B, 'tugasan.selesai', { id: m[1], k: m[2], catatan: 'Siap' }));
  assert(d.status === 'SELESAI', 'selesai');
  const log = ok(await call(A, 'crud.get', { module: 'tugasan', id: m[1] }, sup.token));
  assert(log.status === 'SELESAI' && /PIC Edge/.test(log.values.disahkanOleh) && log.values.kod === undefined, 'log kerja');
});

await test('Eksport untuk sandaran pekerja', async () => {
  const r = await worker.handle(signed('system.export', {}));
  assert(r.success && r.data.sheets.find((s) => s.name === 'TEMPAHAN').rows.length >= 9, 'eksport ' + JSON.stringify(r).slice(0, 200));
});

await test('ID berganda (data lama): kunci konsisten; suntingan tidak menggandakan rekod', async () => {
  const before = (await sql`select k from private.sheet_rows where sheet = 'STAF' order by pos`).map((r) => r.k);
  assert(before.some((k) => /#2$/.test(k)), 'kunci #2 ' + before.join(','));
  const list = ok(await call(A, 'crud.list', { module: 'staf', pageSize: 100 }, sup.token));
  const target = list.items.find((x) => x.values && x.values.nama !== 'Pendua Lama' && x.values.noStaf === 'D1002');
  ok(await call(A, 'crud.update', { module: 'staf', id: target.id, nama: 'Siti Dikemas Kini' }, sup.token));
  const after = (await sql`select k from private.sheet_rows where sheet = 'STAF' order by pos`).map((r) => r.k);
  assert(after.length === before.length, 'bilangan baris berubah: ' + before.length + ' → ' + after.length);
});

await test('rid sama dihantar serentak dari 4 isolat → satu rekod sahaja, semua mendapat jawapan sama', async () => {
  const rid = 'serentak' + Date.now() + 'xyz';
  const p = { module: 'tempahan', formToken: formToken(), noStaf: 'D1005', noTelefon: '012-3456789', ruang: room.id, tujuan: 'Serentak rid', tarikh: day(33), masaMula: '16:00', masaTamat: '17:00' };
  const res = await Promise.all([0, 1, 2, 3].map(() => mkRuntime().handle({ action: 'crud.publicCreate', payload: p, meta: { rid } })));
  const refs = new Set(res.map((x) => x.result.success && x.result.data.refNo));
  assert(refs.size === 1 && !refs.has(false), JSON.stringify(res.map((x) => x.result.code || x.result.data.refNo)));
  const n = (await sql`select count(*)::int as n from private.sheet_rows where sheet = 'TEMPAHAN' and vals::text like '%Serentak rid%'`)[0].n;
  assert(n === 1, 'rekod ' + n);
});

await test('Kiraan kongsi tidak hilang di bawah konkurensi: 5 cubaan log masuk gagal serentak → akaun dikunci', async () => {
  const email = 'user0@demo.local';
  await Promise.all([0, 1, 2, 3, 4].map((i) => call(mkRuntime(), 'auth.login', { email, password: 'salah' + i })));
  const r = await call(mkRuntime(), 'auth.login', { email, password: 'Demo1234' });
  assert(!r.success, 'sepatutnya dikunci: ' + JSON.stringify(r).slice(0, 160));
});

await test('Prestasi: permintaan panas < 40 ms (purata 20 panggilan)', async () => {
  const rt = mkRuntime();
  await call(rt, 'tempahan.jadual', { dari: day(0), hingga: day(6) });
  const t = Date.now();
  for (let i = 0; i < 20; i++) await call(rt, 'tempahan.jadual', { dari: day(0), hingga: day(6) });
  const ms = (Date.now() - t) / 20;
  console.log('    purata ' + ms.toFixed(1) + ' ms / permintaan (jadual 7 hari)');
  assert(ms < 40, ms + ' ms');
});

await sql.end();
console.log(`\n${passed} lulus, ${failed} gagal.`);
process.exit(failed ? 1 : 0);
