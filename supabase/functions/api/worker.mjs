/**
 * worker.mjs — tindakan `system.*` untuk pekerja Apps Script (WorkerService.gs) — BUKAN untuk pelayar.
 *
 *  system.import  : pindah data Google Sheets + Script Properties (sekali; dibuka oleh private.meta import_open = '1')
 *  system.tick    : dipanggil setiap minit oleh pencetus Apps Script → penyelenggaraan berkala + tuntut email untuk dihantar
 *  system.ack     : keputusan penghantaran email / push (+ token telefon yang perlu dibatalkan)
 *  system.export  : semua data (sandaran harian ke Google Sheets oleh pekerja)
 *  system.status  : status baris gilir email
 *
 * Pengesahan: HMAC-SHA256(AUTH_PEPPER, 'druang-worker-v1') — kedua-dua pihak mengetahui AUTH_PEPPER (Script Property
 * yang dipindahkan semasa import), jadi tiada rahsia baharu perlu disalin secara manual.
 */
import nodeCrypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TIME_ZONE, formatDate } from './runtime.mjs';
import { deliverPending } from './webpush.mjs';

const SIG_PREFIX = 'druang-worker-v2';
const SIG_WINDOW_MS = 5 * 60 * 1000;
/** Script Properties yang TIDAK dipindahkan (khusus Google / tidak digunakan di Supabase). */
const SKIP_PROPS = ['SPREADSHEET_ID', 'LEGACY_SPREADSHEET_ID', 'FCM_SERVICE_ACCOUNT', 'DRIVE_ROOT_FOLDER_ID', 'ATTACHMENT_FOLDER_ID', 'BACKUP_FOLDER_ID'];
const DAILY_HOUR = 2;

/**
 * @param {{store:Object, runtime:Object, log?:Object, verifyImport?:function(string):Promise<boolean>, pushFetch?:function}} opts
 *   pushFetch: (ujian) pengganti fetch untuk Web Push.
 *   verifyImport(nonce): sahkan dengan Apps Script (URL dipercayai dalam config.json) bahawa import ini dimulakan olehnya.
 */
export function createWorkerApi({ store, runtime, log, verifyImport, pushFetch }) {
  const L = log || console;
  const ok = (data) => ({ success: true, data });
  const fail = (code, message) => ({ success: false, code, message });

  /**
   * Tandatangan = HMAC-SHA256(AUTH_PEPPER, 'druang-worker-v2|' + ts + '|' + action + '|' + sha256(JSON payload)).
   * Terikat pada tindakan & kandungan, sah 5 minit — tidak boleh diguna semula untuk tindakan lain.
   */
  async function verify(req) {
    const sig = req && req.worker;
    const ts = Number(req && req.ts);
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig) || !isFinite(ts) || Math.abs(Date.now() - ts) > SIG_WINDOW_MS) return false;
    const props = await store.loadProps();
    const pepper = props.map.AUTH_PEPPER;
    if (!pepper) return false;
    const bodyHash = nodeCrypto.createHash('sha256').update(JSON.stringify(req.payload === undefined ? {} : req.payload)).digest('hex');
    const want = nodeCrypto.createHmac('sha256', pepper).update(SIG_PREFIX + '|' + ts + '|' + String(req.action) + '|' + bodyHash).digest();
    const got = Buffer.from(sig, 'hex');
    return got.length === want.length && nodeCrypto.timingSafeEqual(got, want);
  }

  async function maintenance(force) {
    const now = new Date();
    const dateKey = formatDate(now, TIME_ZONE, 'yyyy-MM-dd');
    const hour = Number(formatDate(now, TIME_ZONE, 'HH'));
    const out = {};
    if (force || await store.markOnce('last_hourly', dateKey + 'T' + hour)) {
      try {
        out.hourly = (await runtime.execute((B) => (B.CrudEngine.hasHook('hourly') ? B.MaintenanceService.hourly() : { skipped: true }))).result;
      } catch (e) {
        out.hourlyError = String(e && e.message || e); L.error('[worker] hourly', e);
        await store.markOnce('last_hourly', 'gagal').catch(() => {}); /* cuba semula pada kitaran berikutnya */
      }
    }
    if (force || (hour >= DAILY_HOUR && await store.markOnce('last_daily', dateKey))) {
      try {
        out.daily = (await runtime.execute((B) => B.MaintenanceService.daily())).result;
      } catch (e) {
        out.dailyError = String(e && e.message || e); L.error('[worker] daily', e);
        await store.markOnce('last_daily', 'gagal').catch(() => {});
      }
      try { out.housekeeping = await store.housekeeping(); } catch (e) { out.housekeepingError = String(e && e.message || e); }
    }
    return out;
  }

  async function handle(req) {
    const action = String(req && req.action || '');
    const payload = (req && req.payload) || {};
    try {
      if (action === 'system.import') {
        if (!Array.isArray(payload.sheets) || !payload.sheets.length) return fail('VALIDATION_ERROR', 'Tiada sheet.');
        const props = {};
        Object.keys(payload.props || {}).forEach((k) => { if (SKIP_PROPS.indexOf(k) < 0) props[k] = String(payload.props[k]); });
        if (!props.AUTH_PEPPER || !props.FORM_SECRET) return fail('VALIDATION_ERROR', 'AUTH_PEPPER / FORM_SECRET tiada dalam Script Properties.');
        /* Hanya Apps Script pemilik boleh memulakan import: pelayan menyemak nonce dengan URL Apps Script yang dipercayai */
        const nonce = String(payload.nonce || '');
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !verifyImport || !(await verifyImport(nonce))) return fail('FORBIDDEN', 'Import tidak disahkan oleh Apps Script.');
        const sheets = payload.sheets.map((s) => ({ name: String(s.name), header: (s.header || []).map((v) => (v === null ? '' : v)), rows: s.rows || [] }));
        return ok(await store.importAll(sheets, props));
      }
      if (!(await verify(req))) return fail('FORBIDDEN', 'Tandatangan pekerja tidak sah.');
      if (action === 'system.tick') {
        if (payload.pushRelay !== undefined && (runtime.prop('PUSH_RELAY') === '1') !== !!payload.pushRelay) {
          try { await runtime.execute((B) => B.PushService.setRelay(!!payload.pushRelay)); } catch (e) { L.error('[worker] pushRelay', e); }
        }
        const m = await maintenance(!!payload.force);
        /* Web Push dihantar oleh pelayan ini sendiri (termasuk cubaan semula); pekerja Apps Script hanya menerima email/FCM */
        try { m.webpush = await deliverPending({ store, runtime, fetchImpl: pushFetch, log: L }); } catch (e) { L.error('[worker] webpush', e); }
        const mails = await store.claimOutbox(payload.limit || 20, ['mail', 'push']);
        return ok({ maintenance: m, mails });
      }
      if (action === 'system.ack') {
        const results = Array.isArray(payload.results) ? payload.results : [];
        await store.ackOutbox(results);
        /* Token telefon yang ditolak FCM → dibatalkan */
        const dead = [].concat(...results.map((r) => (r && Array.isArray(r.revoke) ? r.revoke : []))).filter((x) => typeof x === 'string').slice(0, 200);
        if (dead.length) { try { await runtime.execute((B) => B.PushService.revokeTokens(dead)); } catch (e) { L.error('[worker] revoke', e); } }
        return ok({ acked: results.length });
      }
      if (action === 'system.export') return ok({ sheets: await store.exportAll(), at: new Date().toISOString() });
      if (action === 'system.status') return ok(await store.outboxStatus());
      return fail('BAD_REQUEST', 'Tindakan pekerja tidak dikenali.');
    } catch (e) {
      if (e && e.code === 'IMPORT_CLOSED') return fail('FORBIDDEN', 'Import telah dibuat. Hubungi pembangun untuk membukanya semula.');
      L.error('[worker] ' + action, e);
      return fail('INTERNAL_ERROR', String(e && e.message || e).slice(0, 300));
    }
  }

  return { handle, verify, maintenance };
}
