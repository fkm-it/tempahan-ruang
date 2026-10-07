/**
 * Supabase Edge Function `api` — backend sistem (kod Apps Script yang sama) dengan data dalam Postgres.
 *
 * Frontend (GitHub Pages) menghantar POST text/plain {action, payload, token, meta} — format sama seperti doPost Apps Script.
 * text/plain + tanpa pengepala tersuai = "simple request" → tiada CORS preflight. Pengesahan melalui token dalam badan
 * (bukan JWT Supabase), jadi fungsi ini dideploy dengan --no-verify-jwt.
 *
 * Fail: backend.mjs (DIJANA: tools/build-edge.js), runtime.mjs, store-pg.mjs, worker.mjs.
 */
import postgres from 'npm:postgres@3.4.5';
import { createBackend } from './backend.mjs';
import { createRuntime } from './runtime.mjs';
import { createPgStore } from './store-pg.mjs';
import { createWorkerApi } from './worker.mjs';
import { deliverPending } from './webpush.mjs';
import cfg from './config.json' with { type: 'json' };

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 4, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
const store = createPgStore(sql);
const runtime = createRuntime({ store, createBackend });
/** Sahkan nonce import dengan Apps Script (cfg.gasUrl — dalam kod, bukan daripada permintaan). */
async function verifyImport(nonce: string): Promise<boolean> {
  if (!cfg.gasUrl) return false;
  try {
    const r = await fetch(cfg.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ verifyImport: nonce }), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const j = JSON.parse(await r.text());
    return !!(j && j.success && j.data && j.data.ok === true);
  } catch (e) {
    console.error('[api] pengesahan import gagal', e);
    return false;
  }
}
const worker = createWorkerApi({ store, runtime, verifyImport });

const MAX_API_BYTES = 2_000_000;
const MAX_IMPORT_BYTES = 40_000_000;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info, x-region',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (code: string, message: string, status = 200) => json({ success: false, data: null, code, message, meta: {} }, status);

/** Hantar notifikasi telefon (Web Push) tertunggak di latar — tidak melambatkan jawapan API. */
function deliverPush() {
  const p = deliverPending({ store, runtime }).catch((e) => console.error('[webpush]', e));
  // @ts-ignore EdgeRuntime disediakan oleh Supabase
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

/** Kejut pekerja Apps Script supaya email dihantar segera (pencetus setiap minit kekal sebagai sandaran). */
let lastPoke = 0;
function pokeWorker() {
  const url = runtime.prop('WORKER_URL');
  if (!url || !/^https:\/\/script\.google\.com\//.test(url) || Date.now() - lastPoke < 3000) return;
  lastPoke = Date.now();
  const p = fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ poke: 1 }), redirect: 'manual' })
    .then((r) => r.body?.cancel()).catch(() => {});
  // @ts-ignore EdgeRuntime disediakan oleh Supabase
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

/**
 * Sebelum data dipindahkan (pindahKeSupabase() belum dijalankan), permintaan diteruskan ke Apps Script — jadi frontend
 * boleh bertukar ke URL ini lebih awal tanpa gangguan. Selepas import, fungsi ini melayan sendiri (selamanya).
 */
let imported = false;
async function isImported() {
  if (imported) return true;
  imported = (await store.getMeta('import_open')) !== '1';
  return imported;
}
async function proxyToGas(body: Record<string, unknown>) {
  if (!cfg.gasUrl) return fail('CONFIG_ERROR', 'Data belum dipindahkan ke Supabase.');
  const meta = Object.assign({}, (body.meta as Record<string, unknown>) || {}, { via: 'edge' });
  try {
    const r = await fetch(cfg.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, meta }), redirect: 'follow', signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    JSON.parse(t);
    return new Response(t, { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api] proksi Apps Script gagal', e);
    return fail('NETWORK', 'Sambungan ke pelayan gagal. Sila cuba lagi.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return json({ success: true, data: { service: 'api', ok: true } });
  if (req.method !== 'POST') return fail('BAD_REQUEST', 'Kaedah tidak dibenarkan.', 405);

  const started = Date.now();
  let text = '';
  try { text = await req.text(); } catch { return fail('BAD_REQUEST', 'Permintaan tidak sah.'); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return fail('BAD_REQUEST', 'Permintaan tidak sah.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('BAD_REQUEST', 'Permintaan tidak sah.');
  const action = String(body.action || '');

  if (action.startsWith('system.')) {
    if (text.length > MAX_IMPORT_BYTES) return fail('VALIDATION_ERROR', 'Permintaan terlalu besar.');
    return json(await worker.handle(body));
  }
  if (text.length > MAX_API_BYTES) return fail('VALIDATION_ERROR', 'Permintaan terlalu besar.');
  if (!(await isImported())) return proxyToGas(body);

  try {
    const { result, outbox } = await runtime.handle(body);
    if (outbox) { pokeWorker(); deliverPush(); }
    if (result && result.meta) result.meta.ms = Date.now() - started;
    return json(result);
  } catch (e) {
    console.error('[api] ' + action, e);
    return fail('INTERNAL_ERROR', 'Ralat pelayan. Sila cuba sebentar lagi.');
  }
});
