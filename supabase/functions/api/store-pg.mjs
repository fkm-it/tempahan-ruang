/**
 * store-pg.mjs — penyimpanan Postgres untuk runtime.mjs (skema: supabase/migrations/*_edge_store.sql).
 * Semua jadual dalam skema `private` (tidak didedahkan melalui API Supabase; hanya fungsi ini yang mengaksesnya).
 *
 * @param {Function} sql klien postgres.js
 */
import { keyRows } from './runtime.mjs';

export function createPgStore(sql) {
  const LOCK_KEY = 7262025; /* kunci nasihat untuk penulisan sheet (setara LockService) */

  async function versions() {
    const [rows, pv] = await Promise.all([
      sql`select name, ver::text as ver, header from private.sheets`,
      sql`select v from private.meta where k = 'props_ver'`
    ]);
    const sheets = {};
    const headers = {};
    for (const r of rows) { sheets[r.name] = r.ver; headers[r.name] = r.header || []; }
    return { sheets, headers, props: pv.length ? pv[0].v : '0' };
  }

  /** Isolat sejuk: versi + semua sheet (kecuali log besar) + tetapan dalam SATU perjalanan ke pangkalan data. */
  async function boot(lazy) {
    const [r] = await sql`select json_build_object(
        'sheets', (select coalesce(json_object_agg(name, json_build_object('ver', ver::text, 'header', header)), '{}'::json) from private.sheets),
        'rows', (select coalesce(json_object_agg(sheet, r), '{}'::json) from (
                   select sheet, json_agg(vals order by pos) as r from private.sheet_rows where not (sheet = any(${lazy})) group by sheet) x),
        'props', (select coalesce(json_object_agg(k, v), '{}'::json) from private.props),
        'propsVer', (select v from private.meta where k = 'props_ver')
      ) as b`;
    const b = r.b;
    const vers = { sheets: {}, headers: {}, props: b.propsVer || '0' };
    const sheets = [];
    for (const name of Object.keys(b.sheets)) {
      vers.sheets[name] = b.sheets[name].ver;
      vers.headers[name] = b.sheets[name].header || [];
      if (lazy.indexOf(name) < 0) sheets.push({ name, ver: b.sheets[name].ver, header: b.sheets[name].header || [], rows: b.rows[name] || [] });
    }
    return { vers, sheets, props: { ver: vers.props, map: b.props } };
  }

  async function loadSheets(names) {
    const [heads, rows] = await Promise.all([
      sql`select name, header, ver::text as ver from private.sheets where name = any(${names})`,
      sql`select sheet, vals from private.sheet_rows where sheet = any(${names}) order by sheet, pos`
    ]);
    const by = new Map();
    for (const h of heads) by.set(h.name, { name: h.name, ver: h.ver, header: h.header || [], rows: [] });
    for (const r of rows) { const s = by.get(r.sheet); if (s) s.rows.push(r.vals); }
    return [...by.values()];
  }

  async function loadProps() {
    const [rows, pv] = await Promise.all([
      sql`select k, v from private.props`,
      sql`select v from private.meta where k = 'props_ver'`
    ]);
    const map = {};
    for (const r of rows) map[r.k] = r.v;
    return { ver: pv.length ? pv[0].v : '0', map };
  }

  async function loadKv(keys) {
    const rows = await sql`select k, v, (extract(epoch from exp) * 1000)::float8 as exp from private.kv where k = any(${keys}) and exp > now()`;
    const out = {};
    for (const r of rows) out[r.k] = { v: r.v, exp: Number(r.exp) };
    return out;
  }

  /** Simpan perubahan dalam satu transaksi. @return {{vers:Object, propsVer?:string}|{conflict:string[]}} */
  async function commit(ch) {
    try {
      return await sql.begin(async (tx) => {
        const out = { vers: {} };
        /* Kunci kongsi: compare-and-set (nilai semasa mesti sama dengan yang dibaca permintaan ini) */
        if (ch.kv.length) {
          const keys = ch.kv.map((e) => e.k);
          const cur = await tx`select k, v from private.kv where k = any(${keys}) and exp > now() for update`;
          const m = new Map(cur.map((r) => [r.k, r.v]));
          const bad = ch.kv.filter((e) => (m.has(e.k) ? m.get(e.k) : null) !== (e.expect === undefined ? null : e.expect)).map((e) => 'kv:' + e.k);
          if (bad.length) { const err = new Error('conflict'); err.conflict = bad; throw err; }
        }
        if (ch.sheets.length) {
          await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
          const names = ch.checks.map((c) => c.name);
          const cur = names.length ? await tx`select name, ver::text as ver from private.sheets where name = any(${names})` : [];
          const now = new Map(cur.map((r) => [r.name, r.ver]));
          const bad = ch.checks.filter((c) => (c.ver === null ? now.has(c.name) : now.get(c.name) !== c.ver)).map((c) => c.name);
          if (bad.length) { const e = new Error('conflict'); e.conflict = bad; throw e; }
          for (const s of ch.sheets) {
            if (s.deleted) { await tx`delete from private.sheets where name = ${s.name}`; continue; }
            if (s.created) {
              await tx`insert into private.sheets (name, header, ver) values (${s.name}, ${tx.json(s.header || [])}, 1)
                       on conflict (name) do update set header = excluded.header, ver = private.sheets.ver + 1`;
            }
            if (s.replace) await tx`delete from private.sheet_rows where sheet = ${s.name}`;
            if (s.deletes.length) await tx`delete from private.sheet_rows where sheet = ${s.name} and k = any(${s.deletes})`;
            if (s.upserts.length) {
              const payload = s.upserts.map((u) => ({ k: u.k, ord: u.ord, vals: u.vals }));
              await tx`insert into private.sheet_rows (sheet, k, pos, vals)
                       select ${s.name}, x.k, coalesce((select max(pos) from private.sheet_rows where sheet = ${s.name}), 0) + x.ord + 1, x.vals
                       from jsonb_to_recordset(${tx.json(payload)}::jsonb) as x(k text, ord int, vals jsonb)
                       on conflict (sheet, k) do update set vals = excluded.vals`;
            }
            const r = s.header && !s.created
              ? await tx`update private.sheets set header = ${tx.json(s.header)}, ver = ver + 1, updated_at = now() where name = ${s.name} returning ver::text as ver`
              : await tx`update private.sheets set ver = ver + ${s.created ? 0 : 1}, updated_at = now() where name = ${s.name} returning ver::text as ver`;
            if (r.length) out.vers[s.name] = r[0].ver;
          }
        }
        for (const e of ch.kv) {
          if (e.del) await tx`delete from private.kv where k = ${e.k}`;
          else await tx`insert into private.kv (k, v, exp) values (${e.k}, ${e.v}, to_timestamp(${e.exp / 1000}))
                         on conflict (k) do update set v = excluded.v, exp = excluded.exp`;
        }
        if (ch.props) {
          for (const k of Object.keys(ch.props.set)) {
            await tx`insert into private.props (k, v) values (${k}, ${ch.props.set[k]}) on conflict (k) do update set v = excluded.v`;
          }
          if (ch.props.del.length) await tx`delete from private.props where k = any(${ch.props.del})`;
          const pv = await tx`update private.meta set v = (v::bigint + 1)::text where k = 'props_ver' returning v`;
          out.propsVer = pv.length ? pv[0].v : undefined;
        }
        if (ch.outbox.length) {
          await tx`insert into private.outbox (kind, payload)
                   select x.kind, x.payload from jsonb_to_recordset(${tx.json(ch.outbox)}::jsonb) as x(kind text, payload jsonb)`;
        }
        return out;
      });
    } catch (e) {
      if (e && e.conflict) return { conflict: e.conflict };
      throw e;
    }
  }

  // ---------------------------------------------------------------- Pekerja (Apps Script) & penyelenggaraan
  /** @param {string[]} [kinds] lalai: email & FCM (pekerja Apps Script). 'webpush' dihantar oleh Edge Function sendiri. */
  async function claimOutbox(limit, kinds) {
    const k = Array.isArray(kinds) && kinds.length ? kinds : ['mail', 'push'];
    return sql`update private.outbox set claimed_at = now(), attempts = attempts + 1
               where id in (select id from private.outbox where sent_at is null and attempts < 5 and kind = any(${k})
                            and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                            order by id limit ${limit || 20} for update skip locked)
               returning id::text as id, kind, payload`;
  }

  async function ackOutbox(results) {
    for (const r of results || []) {
      if (r.ok) await sql`update private.outbox set sent_at = now(), last_error = null where id = ${r.id}`;
      else await sql`update private.outbox set last_error = ${String(r.error || 'gagal').slice(0, 500)} where id = ${r.id}`;
    }
  }

  /** Tandakan tugasan berkala; pulang true jika panggilan ini yang "menang" (elak dijalankan dua kali). */
  async function markOnce(key, value) {
    const r = await sql`insert into private.meta (k, v) values (${key}, ${value})
                        on conflict (k) do update set v = excluded.v where private.meta.v is distinct from excluded.v
                        returning k`;
    return r.length > 0;
  }

  async function getMeta(key) {
    const r = await sql`select v from private.meta where k = ${key}`;
    return r.length ? r[0].v : null;
  }

  async function housekeeping() {
    const kv = await sql`delete from private.kv where exp < now()`;
    const ob = await sql`delete from private.outbox where sent_at < now() - interval '30 days' or (attempts >= 5 and created_at < now() - interval '30 days')`;
    return { kvPurged: kv.count, outboxPurged: ob.count };
  }

  async function outboxStatus() {
    const r = await sql`select count(*) filter (where sent_at is null and attempts < 5)::int as pending,
                               count(*) filter (where sent_at is null and attempts >= 5)::int as failed,
                               count(*) filter (where sent_at > now() - interval '1 day')::int as sent24h
                        from private.outbox`;
    return r[0];
  }

  /** Import penuh daripada Google Sheets (sekali sahaja, hanya jika private.meta import_open = '1'). */
  async function importAll(sheets, props) {
    return sql.begin(async (tx) => {
      const open = await tx`select v from private.meta where k = 'import_open' for update`;
      if (!open.length || open[0].v !== '1') { const e = new Error('Import ditutup.'); e.code = 'IMPORT_CLOSED'; throw e; }
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      await tx`delete from private.sheets`;
      let rowsTotal = 0;
      let dropped = 0;
      for (const s of sheets) {
        await tx`insert into private.sheets (name, header, ver) values (${s.name}, ${tx.json(s.header || [])}, 1)`;
        const payload = keyRows(s.rows || []).map(([k, vals], i) => ({ k, ord: i, vals }));
        dropped += (s.rows || []).length - payload.length;
        for (let i = 0; i < payload.length; i += 500) {
          const chunk = payload.slice(i, i + 500);
          await tx`insert into private.sheet_rows (sheet, k, pos, vals)
                   select ${s.name}, x.k, x.ord + 1, x.vals from jsonb_to_recordset(${tx.json(chunk)}::jsonb) as x(k text, ord int, vals jsonb)`;
        }
        rowsTotal += payload.length;
      }
      for (const k of Object.keys(props || {})) {
        await tx`insert into private.props (k, v) values (${k}, ${String(props[k])}) on conflict (k) do update set v = excluded.v`;
      }
      await tx`update private.meta set v = (v::bigint + 1)::text where k = 'props_ver'`;
      await tx`update private.meta set v = '0' where k = 'import_open'`;
      return { sheets: sheets.length, rows: rowsTotal, props: Object.keys(props || {}).length, droppedBlankId: dropped };
    });
  }

  /** Eksport semua sheet (untuk sandaran harian oleh pekerja ke Google Sheets). */
  async function exportAll() {
    const names = (await sql`select name from private.sheets order by name`).map((r) => r.name);
    return loadSheets(names);
  }

  return { versions, boot, loadSheets, loadProps, loadKv, commit, claimOutbox, ackOutbox, markOnce, getMeta, housekeeping, outboxStatus, importAll, exportAll };
}
