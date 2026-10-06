/**
 * @file LegacyImport.gs
 * Import SEKALI data daripada spreadsheet sistem tempahan lama (sheet "Ruang", "Staf", "Tempahan").
 *
 * Cara (editor Apps Script):
 *   1. Project Settings → Script Properties → LEGACY_SPREADSHEET_ID = ID spreadsheet lama
 *      (bahagian antara /d/ dan /edit dalam URL). Akaun pemilik skrip mesti boleh membukanya.
 *   2. Pilih fungsi importLegacyData → Run. Ringkasan dipaparkan dalam log.
 * Idempoten: rekod yang sudah wujud (ruang ikut nama, staf ikut No. Staf, tempahan ikut ID lama) dilangkau,
 * jadi selamat dijalankan semula. Data lama tidak diubah.
 *
 * Setiap baris tempahan lama diimport sebagai tempahan SEHARI dengan ID lama sebagai No. Rujukan
 * (kumpulan berbilang hari lama mempunyai status berbeza setiap hari, jadi tidak digabungkan).
 */
function importLegacyData() {
  requireOwner_();
  const id = Env.get('LEGACY_SPREADSHEET_ID');
  if (!id) throw new Error('Tetapkan Script Property LEGACY_SPREADSHEET_ID dahulu.');
  const out = LegacyImport.run(SpreadsheetApp.openById(id));
  console.log(JSON.stringify(out, null, 2));
  return out;
}

const LegacyImport = {
  STATUS_MAP: { MENUNGGU: 'MENUNGGU', DILULUSKAN: 'DILULUSKAN', LULUS: 'DILULUSKAN', DITOLAK: 'DITOLAK', TOLAK: 'DITOLAK', DIBATALKAN: 'DIBATALKAN', BATAL: 'DIBATALKAN', SELESAI: 'SELESAI' },

  /** @param {Spreadsheet} ss spreadsheet lama  @return {Object} ringkasan */
  run: function (ss) {
    const out = { ruang: LegacyImport.ruang(ss), staf: LegacyImport.staf(ss) };
    out.tempahan = LegacyImport.tempahan(ss); // selepas ruang (padanan nama)
    AppCache.remove('stats:admin');
    return out;
  },

  /** Baris sheet sebagai objek ikut header. Masa dibaca daripada nilai paparan (elak isu zon waktu sel masa). */
  read: function (ss, name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    const range = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
    const values = range.getValues();
    let display = values;
    try { display = range.getDisplayValues(); } catch (e) { /* mock lama */ }
    const head = values[0].map(function (h) { return String(h).trim(); });
    return values.slice(1).map(function (line, i) {
      const o = { __display: {} };
      head.forEach(function (h, c) { o[h] = line[c]; o.__display[h] = display[i + 1][c]; });
      return o;
    }).filter(function (o) { return head.some(function (h) { return o[h] !== '' && o[h] !== null && o[h] !== undefined; }); });
  },

  str: function (v) { return v === null || v === undefined ? '' : StringUtils.singleLine(String(v)).trim(); },

  base: function (prefix, extra) {
    const now = DateUtils.nowIso();
    const id = IdUtils.generate(prefix);
    return Object.assign({
      id: id, ref_no: id, owner_user_id: '', owner_name: '', status: '', status_note: '', status_changed_at: '', status_changed_by: '',
      state: RECORD_STATE.ACTIVE, created_at: now, updated_at: now, deleted_at: ''
    }, extra);
  },

  /** "Aras 1 · Dewan Kuliah · E07 · Kod: E07 - 01.02.01" → {aras, jenis, blok, kod} */
  parseLokasi: function (s) {
    const o = { aras: '', jenis: '', blok: '', kod: '' };
    LegacyImport.str(s).split(/\s*·\s*/).forEach(function (p) {
      if (/^aras\s*/i.test(p)) o.aras = p.replace(/^aras\s*/i, '');
      else if (/^kod\s*:/i.test(p)) o.kod = p.replace(/^kod\s*:\s*/i, '');
      else if (/^[A-Z]\d{2,3}[A-Z]?$/i.test(p)) o.blok = p.toUpperCase();
      else if (p && !o.jenis) o.jenis = p;
    });
    return o;
  },

  ruang: function (ss) {
    const repo = Repo.of('RUANG');
    const seen = {};
    repo.all().forEach(function (r) { if (r.state === RECORD_STATE.ACTIVE) seen[r.nama.toLowerCase()] = true; });
    const rows = [];
    LegacyImport.read(ss, 'Ruang').forEach(function (o) {
      const nama = LegacyImport.str(o['Nama Ruang']);
      if (!nama || seen[nama.toLowerCase()]) return;
      seen[nama.toLowerCase()] = true;
      const lok = LegacyImport.parseLokasi(o['Lokasi']);
      const emelPic = StringUtils.normalizeEmail(LegacyImport.str(o['Emel PIC']));
      rows.push(LegacyImport.base('RU', {
        nama: nama.slice(0, 200), blok: lok.blok || (nama.match(/\(([A-Z]\d{2,3}[A-Z]?)\)\s*$/i) || [])[1] || '-', jenis: lok.jenis, aras: lok.aras, kod_ruang: lok.kod,
        kapasiti: parseInt(o['Kapasiti'], 10) || 0, pic: LegacyImport.str(o['PIC']).slice(0, 200), emel_pic: Validator.EMAIL_RE.test(emelPic) ? emelPic : '',
        aktif: !/^tidak|^tutup|^inaktif/i.test(LegacyImport.str(o['Status'])), catatan: ''
      }));
    });
    if (rows.length) repo.insertMany(rows);
    return { diimport: rows.length };
  },

  staf: function (ss) {
    const repo = Repo.of('STAF');
    const seen = {};
    repo.all().forEach(function (r) { if (r.state === RECORD_STATE.ACTIVE) seen[StafHooks.norm(r.no_staf)] = true; });
    const rows = [];
    let langkau = 0;
    LegacyImport.read(ss, 'Staf').forEach(function (o) {
      const no = StafHooks.norm(o['No Pekerja'] !== undefined ? o['No Pekerja'] : o['No Staf']);
      const nama = LegacyImport.str(o['Nama']);
      const emel = StringUtils.normalizeEmail(LegacyImport.str(o['Emel']));
      if (!no || !nama || !Validator.EMAIL_RE.test(emel)) { langkau++; return; }
      if (seen[no]) return;
      seen[no] = true;
      rows.push(LegacyImport.base('SF', { no_staf: no, nama: nama.slice(0, 200), emel: emel, aktif: true }));
    });
    if (rows.length) repo.insertMany(rows);
    return { diimport: rows.length, tidakSah: langkau };
  },

  /** Date | 'yyyy-MM-dd' | 'dd/MM/yyyy' → 'yyyy-MM-dd' ('' jika tidak sah). */
  dateKey: function (v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, DateUtils.tz(), 'yyyy-MM-dd');
    const s = LegacyImport.str(v);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  },

  /** '8:00' | '08:00:00' | '2:30 PM' → 'HH:mm' ('' jika tidak sah). */
  timeHM: function (v) {
    const s = LegacyImport.str(v).toUpperCase();
    const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    if (m[3] === 'PM' && h < 12) h += 12;
    if (m[3] === 'AM' && h === 12) h = 0;
    return h > 23 ? '' : ('0' + h).slice(-2) + ':' + m[2];
  },

  /** 139314611 (sifar hadapan hilang dalam Excel) → '0139314611'. */
  phone: function (v) {
    let s = LegacyImport.str(v).replace(/\.0+$/, '');
    if (/^1\d{7,9}$/.test(s)) s = '0' + s;
    return Validator.PHONE_RE.test(s) ? s : '';
  },

  tempahan: function (ss) {
    const repo = Repo.of('TEMPAHAN');
    const seen = {};
    repo.all().forEach(function (r) { seen[String(r.ref_no).toUpperCase()] = true; });
    const ruangByName = {};
    Repo.of('RUANG').all().forEach(function (r) { if (r.state === RECORD_STATE.ACTIVE) ruangByName[r.nama.toLowerCase()] = r.id; });
    const rows = [];
    const gagal = [];
    LegacyImport.read(ss, 'Tempahan').forEach(function (o) {
      const ref = LegacyImport.str(o['ID']).toUpperCase();
      if (!ref || seen[ref]) return;
      const ruang = ruangByName[LegacyImport.str(o['Ruang']).toLowerCase()];
      const tarikh = LegacyImport.dateKey(o['Tarikh']);
      const mula = LegacyImport.timeHM(o.__display['Masa Mula'] || o['Masa Mula']);
      const tamat = LegacyImport.timeHM(o.__display['Masa Tamat'] || o['Masa Tamat']);
      if (!ruang || !tarikh || !mula || !tamat) { gagal.push(ref + (!ruang ? ' (ruang "' + LegacyImport.str(o['Ruang']) + '" tiada)' : ' (tarikh/masa tidak sah)')); return; }
      seen[ref] = true;
      const status = LegacyImport.STATUS_MAP[LegacyImport.str(o['Status']).toUpperCase()] || 'MENUNGGU';
      const mohon = DateUtils.toIso(o['Tarikh Mohon']) || DateUtils.nowIso();
      const nama = LegacyImport.str(o['Nama']).slice(0, 200);
      const emel = StringUtils.normalizeEmail(LegacyImport.str(o['Emel']));
      const sebab = LegacyImport.str(o['Sebab Tolak']);
      rows.push(Object.assign(LegacyImport.base('TP', {
        ref_no: ref, owner_name: nama, no_staf: StafHooks.norm(o['No Staf']), nama: nama, emel: Validator.EMAIL_RE.test(emel) ? emel : '',
        no_telefon: LegacyImport.phone(o['No Telefon']), ruang: ruang, tarikh: tarikh, tarikh_tamat: tarikh, masa_mula: mula, masa_tamat: tamat,
        bilangan_peserta: 0, tujuan: LegacyImport.str(o['Tujuan']).slice(0, 500) || '-',
        peringatan_dihantar: LegacyImport.str(o['Peringatan Dihantar']) ? mohon : '',
        peringatan_jam_dihantar: LegacyImport.str(o['Peringatan Jam Dihantar']) ? tarikh : '',
        bahasa: /^(en|eng|english|bi)/i.test(LegacyImport.str(o['Bahasa'])) ? 'en' : 'ms',
        status: status, status_note: sebab ? sebab.slice(0, 500) : 'Diimport daripada sistem lama.', status_changed_by: 'Import'
      }), { created_at: mohon, updated_at: mohon, status_changed_at: mohon }));
    });
    if (rows.length) repo.insertMany(rows);
    return { diimport: rows.length, gagal: gagal };
  }
};
