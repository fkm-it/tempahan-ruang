#!/usr/bin/env node
/**
 * gen.js — Penjana modul: modules/*.json → kod Apps Script + skema + migrasi + daftar modul.
 *
 *   npm run gen                     jana semula SEMUA modul daripada modules/*.json
 *   npm run gen -- --check          sahkan JSON & pastikan fail dijana terkini (untuk CI) — tiada tulisan
 *   npm run new -- aduan "Aduan"    cipta modules/aduan.json permulaan (kemudian sunting & jalankan npm run gen)
 *
 * Fail yang DIJANA (jangan sunting dengan tangan — akan ditulis semula):
 *   src/modules/Registry.gs
 *   src/modules/<key>/<Name>Module.gs
 *   blok @generator dalam src/models/Schema.gs, src/database/Migration.gs, src/frontend/index.html
 * Fail yang dicipta SEKALI (selamat disunting):
 *   src/modules/<key>/<Name>Hooks.gs         logik khusus domain (validate, beforeSave, afterCreate, …)
 *   src/frontend/modules/<key>.html          (pilihan, anda cipta sendiri) paparan tersuai — dimasukkan automatik
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'modules');
const SRC = path.join(ROOT, 'src');

const FIELD_TYPES = ['string', 'text', 'email', 'phone', 'int', 'number', 'date', 'time', 'bool', 'enum', 'category', 'ref', 'files'];
const ROLES = ['PUBLIC', 'USER', 'ADMIN', 'SUPER_ADMIN'];
const TONES = ['info', 'success', 'warn', 'danger', 'muted', 'brand'];
const ICONS = ['home', 'send', 'list', 'grid', 'user', 'users', 'bell', 'heart', 'book', 'pdf', 'star', 'settings', 'shield', 'chart', 'activity',
  'database', 'link', 'clip', 'mail', 'lock', 'inbox', 'archive', 'calendar', 'clock', 'feedback', 'briefcase', 'info', 'sparkle'];
/** Awalan ID yang digunakan sheet teras — modul tidak boleh guna. */
const RESERVED_PREFIX = ['U', 'C', 'A', 'K', 'N', 'L', 'S', 'B', 'E', 'R'];
const RESERVED_SHEETS = ['USERS', 'CREDENTIALS', 'SESSIONS', 'CATEGORIES', 'ATTACHMENTS', 'PUSH_TOKENS', 'NOTIFICATIONS', 'AUDIT_LOGS', 'SETTINGS', 'SYSTEM_LOGS', 'FEEDBACK', 'MIGRATIONS'];
const RESERVED_PATHS = ['/', '/utama', '/log-masuk', '/daftar', '/lupa-kata-laluan', '/notifikasi', '/profil', '/admin', '/borang'];
const SYSTEM_COLS_HEAD = ['id', 'ref_no', 'owner_user_id', 'owner_name'];
const SYSTEM_COLS_TAIL = ['status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'];

const snake = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const pascal = (k) => k.replace(/(^|[-_\s])([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');

// ============================================================================ Validasi & lalai

function normalize(raw, file) {
  const errs = [];
  const err = (m) => errs.push(m);
  const m = JSON.parse(JSON.stringify(raw));
  if (!/^[a-z][a-z0-9]{1,19}$/.test(m.key || '')) err('"key" mesti huruf kecil/nombor, 2–20 aksara, bermula dengan huruf (cth. "aduan")');
  m.name = m.name || pascal(m.key || '');
  if (!/^[A-Z][A-Za-z0-9]{1,30}$/.test(m.name)) err('"name" mesti PascalCase (cth. "Aduan")');
  m.label = m.label || m.name;
  m.labelPlural = m.labelPlural || m.label;
  m.icon = m.icon || 'list';
  if (ICONS.indexOf(m.icon) < 0) err('"icon" tidak dikenali: ' + m.icon + '. Pilihan: ' + ICONS.join(', '));
  m.path = m.path || '/' + m.key;
  if (!/^\/[a-z0-9-]{2,30}$/.test(m.path)) err('"path" mesti seperti "/aduan" (huruf kecil, nombor, sengkang)');
  if (RESERVED_PATHS.indexOf(m.path) >= 0) err('"path" ' + m.path + ' dikhaskan untuk sistem');
  m.sheet = m.sheet || (m.key || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(m.sheet)) err('"sheet" mesti HURUF_BESAR');
  if (RESERVED_SHEETS.indexOf(m.sheet) >= 0) err('"sheet" ' + m.sheet + ' dikhaskan untuk sistem');
  m.prefix = m.prefix || (m.key || 'X').slice(0, 2).toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(m.prefix)) err('"prefix" mesti 1–3 huruf besar');
  if (RESERVED_PREFIX.indexOf(m.prefix) >= 0) err('"prefix" ' + m.prefix + ' dikhaskan untuk sheet teras (' + RESERVED_PREFIX.join(',') + ')');
  if (m.refFormat === undefined && /^[A-Z]{1,3}$/.test(m.prefix)) m.refFormat = m.prefix + '-{YYYY}-{SEQ4}';
  if (m.refFormat !== undefined && !/^[A-Z0-9-]*(\{YYYY\}|\{MM\}|[A-Z0-9-])*\{SEQ[3-6]\}$/.test(m.refFormat)) err('"refFormat" mesti berakhir dengan {SEQ3}..{SEQ6}, cth. "ADU-{YYYY}-{SEQ4}"');
  m.description = m.description || '';

  const a = Object.assign({ create: 'USER', list: 'OWN', edit: 'OWNER', delete: 'OWNER', ownerEditStatuses: [] }, m.access || {});
  if (ROLES.indexOf(a.create) < 0 || a.create === 'SUPER_ADMIN') err('access.create mesti PUBLIC | USER | ADMIN');
  if (['OWN', 'ALL'].indexOf(a.list) < 0) err('access.list mesti OWN | ALL');
  if (['OWNER', 'ADMIN'].indexOf(a.edit) < 0) err('access.edit mesti OWNER | ADMIN');
  if (['OWNER', 'ADMIN'].indexOf(a.delete) < 0) err('access.delete mesti OWNER | ADMIN');
  m.access = a;

  m.statuses = (m.statuses || []).map((s) => (typeof s === 'string' ? { value: s, label: s } : s));
  m.statuses.forEach((s) => {
    if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(s.value || '')) err('statuses[].value mesti HURUF_BESAR: ' + JSON.stringify(s));
    s.label = s.label || s.value;
    s.tone = s.tone || 'info';
    if (TONES.indexOf(s.tone) < 0) err('statuses[].tone mesti salah satu: ' + TONES.join(', '));
  });
  const sv = m.statuses.map((s) => s.value);
  if (m.statuses.length) {
    m.defaultStatus = m.defaultStatus || sv[0];
    if (sv.indexOf(m.defaultStatus) < 0) err('defaultStatus mesti salah satu statuses');
  } else m.defaultStatus = '';
  a.ownerEditStatuses.forEach((s) => { if (sv.indexOf(s) < 0) err('access.ownerEditStatuses: status tidak wujud ' + s); });
  m.statusRole = m.statusRole || 'ADMIN';
  if (['USER', 'ADMIN', 'SUPER_ADMIN'].indexOf(m.statusRole) < 0) err('statusRole mesti USER | ADMIN | SUPER_ADMIN');
  m.notify = Object.assign({ adminsOnCreate: true, ownerOnStatus: true }, m.notify || {});
  m.nav = Object.assign({ user: a.create !== 'ADMIN' || a.list === 'ALL', admin: true, order: 50 }, m.nav || {});

  const keys = {};
  if (!Array.isArray(m.fields) || !m.fields.length) err('"fields" mesti senarai sekurang-kurangnya 1 medan');
  (m.fields || []).forEach((f, i) => {
    const where = 'fields[' + i + '] (' + (f.key || '?') + ')';
    if (!/^[a-z][A-Za-z0-9]{0,30}$/.test(f.key || '')) err(where + ': "key" mesti camelCase (cth. "tarikhMula")');
    if (keys[f.key]) err(where + ': key berganda');
    keys[f.key] = true;
    f.column = snake(f.key || '');
    if (SYSTEM_COLS_HEAD.concat(SYSTEM_COLS_TAIL).indexOf(f.column) >= 0) err(where + ': nama dikhaskan untuk lajur sistem (' + f.column + ')');
    if (FIELD_TYPES.indexOf(f.type) < 0) err(where + ': "type" mesti salah satu: ' + FIELD_TYPES.join(', '));
    f.label = f.label || f.key;
    if (f.type === 'enum') {
      f.options = (f.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
      if (!f.options.length) err(where + ': enum memerlukan "options"');
    }
    if (f.type === 'files') f.maxFiles = f.maxFiles || 3;
    if (f.type === 'files' && f.search) err(where + ': medan files tidak boleh "search"');
    if (f.filter && ['enum', 'category', 'bool', 'ref'].indexOf(f.type) < 0) err(where + ': "filter" hanya untuk enum / category / bool / ref');
    if (f.type === 'ref' && !/^[a-z][a-z0-9]{1,19}$/.test(f.ref || '')) err(where + ': medan ref memerlukan "ref": "<key modul sasaran>"');
  });
  m.titleField = m.titleField || ((m.fields || []).find((f) => f.type === 'string') || {}).key || '';
  if (m.titleField && !keys[m.titleField]) err('"titleField" tidak wujud dalam fields: ' + m.titleField);
  if (m.subtitleField && !keys[m.subtitleField]) err('"subtitleField" tidak wujud dalam fields: ' + m.subtitleField);
  if (a.create === 'PUBLIC') {
    m.publicForm = Object.assign({ title: m.label, intro: '', successMessage: 'Terima kasih. Borang anda telah diterima.' }, m.publicForm || {});
    if (m.publicForm.contactEmailField && !(m.fields || []).some((f) => f.key === m.publicForm.contactEmailField && f.type === 'email')) {
      err('publicForm.contactEmailField mesti medan jenis email');
    }
    if (m.publicForm.successLink && !(m.publicForm.successLink.href && /^#\//.test(m.publicForm.successLink.href))) err('publicForm.successLink.href mesti bermula dengan "#/"');
    if (m.publicForm.nameField && !(m.fields || []).some((f) => f.key === m.publicForm.nameField && f.type === 'string')) {
      err('publicForm.nameField mesti medan jenis string');
    }
    if ((m.fields || []).some((f) => f.type === 'files' && f.public !== false)) err('Borang awam tidak menyokong lampiran — tetapkan "public": false pada medan files');
  } else delete m.publicForm;
  if (errs.length) throw new Error(path.relative(ROOT, file) + ':\n  - ' + errs.join('\n  - '));
  return m;
}

// ============================================================================ Penjanaan

const HEADER = (src) => '/**\n * DIJANA oleh tools/gen.js daripada ' + src + ' — JANGAN sunting dengan tangan.\n * Ubah fail JSON, kemudian jalankan: npm run gen\n */\n';

function moduleFile(m) {
  const def = Object.assign({}, m);
  const json = JSON.stringify(def, null, 2).replace(/\n/g, '\n  ');
  return HEADER('modules/' + m.key + '.json') +
    'const ' + m.name + 'Module = Object.freeze(Object.assign(\n  ' + json + ',\n' +
    '  { hooks: function () { return typeof ' + m.name + 'Hooks !== \'undefined\' ? ' + m.name + 'Hooks : {}; } }\n));\n';
}

function hooksFile(m) {
  return `/**
 * @file ${m.name}Hooks.gs
 * Logik khusus modul "${m.label}". Fail ini dicipta SEKALI oleh tools/gen.js — selamat disunting.
 * Semua hook pilihan; buang yang tidak digunakan. Rujuk modules/CrudEngine.gs untuk butiran.
 */
const ${m.name}Hooks = {
  /**
   * Peraturan perniagaan tambahan. Lontar Errors.validation(msg, { medan: msg }) atau Errors.conflict(msg).
   * @param {Object} data nilai disahkan (kunci camelCase)  @param {{ctx:Object, mode:string, current:Object|null}} info
   */
  // validate: function (data, info) {},

  /** Ubah baris (lajur snake_case) sebelum disimpan. */
  // beforeSave: function (row, info) {},

  /** Selepas rekod dicipta (cth. hantar email pengesahan). */
  // afterCreate: function (row, ctx) {},

  /** Selepas status berubah. */
  // afterStatus: function (row, prevStatus, ctx) {},

  /** Ubah DTO yang dihantar ke frontend. Pulangkan dto. */
  // toDTO: function (dto, row, ctx) { return dto; },

  /** Kerja harian (dailyMaintenance). Pulangkan ringkasan. */
  // maintenance: function () { return {}; }
};
`;
}

function schemaEntry(m) {
  const cols = SYSTEM_COLS_HEAD.concat(m.fields.map((f) => f.column), SYSTEM_COLS_TAIL);
  const types = {};
  m.fields.forEach((f) => {
    if (f.type === 'bool') types[f.column] = 'bool';
    if (f.type === 'int' || f.type === 'files') types[f.column] = 'int';
  });
  return '  ' + m.sheet + ': {\n    sheet: \'' + m.sheet + '\', id: \'id\', prefix: \'' + m.prefix + '\', module: \'' + m.key + '\',\n' +
    '    columns: ' + JSON.stringify(cols).replace(/"/g, '\'').replace(/,/g, ', ') + ',\n' +
    '    types: ' + JSON.stringify(types).replace(/"/g, '\'').replace(/,/g, ', ').replace(/:/g, ': ') + '\n  },\n';
}

function migrationEntry(m) {
  const cols = SYSTEM_COLS_HEAD.concat(m.fields.map((f) => f.column), SYSTEM_COLS_TAIL).join(',');
  const hash = crypto.createHash('sha256').update(m.sheet + ':' + cols).digest('hex').slice(0, 8).toUpperCase();
  return '    { id: \'MODULE_' + m.sheet + '_' + hash + '\', description: \'Modul ' + m.label.replace(/'/g, '') + ': sheet ' + m.sheet + ' & lajur\', up: function () { return SheetManager.ensure(\'' + m.sheet + '\'); } },\n';
}

function replaceBlock(src, name, body, file) {
  const re = new RegExp('([ \\t]*(?:\\/\\/|<!--) @generator:' + name + ':start[^\\n]*\\n)([\\s\\S]*?)([ \\t]*(?:\\/\\/|<!--) @generator:' + name + ':end)');
  if (!re.test(src)) throw new Error('Penanda @generator:' + name + ' tiada dalam ' + file);
  return src.replace(re, (_, a, __, c) => a + body + c);
}

function plan() {
  if (!fs.existsSync(MOD_DIR)) fs.mkdirSync(MOD_DIR);
  const files = fs.readdirSync(MOD_DIR).filter((f) => f.endsWith('.json')).sort();
  const mods = files.map((f) => {
    const file = path.join(MOD_DIR, f);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(f + ': JSON tidak sah — ' + e.message); }
    const m = normalize(raw, file);
    if (m.key + '.json' !== f) throw new Error(f + ': nama fail mesti ' + m.key + '.json');
    return m;
  });
  mods.forEach((m) => m.fields.filter((f) => f.type === 'ref').forEach((f) => {
    if (!mods.some((x) => x.key === f.ref)) throw new Error(m.key + '.json: medan "' + f.key + '" merujuk modul "' + f.ref + '" yang tiada');
  }));
  ['key', 'name', 'path', 'sheet', 'prefix'].forEach((k) => {
    const seen = {};
    mods.forEach((m) => { if (seen[m[k]]) throw new Error('"' + k + '" berganda antara modul: ' + m[k]); seen[m[k]] = true; });
  });
  mods.sort((a, b) => (a.nav.order - b.nav.order) || a.key.localeCompare(b.key));

  const out = {}; // path → kandungan (ditulis/semak)
  const once = {}; // dicipta sekali sahaja
  mods.forEach((m) => {
    out[path.join(SRC, 'modules', m.key, m.name + 'Module.gs')] = moduleFile(m);
    once[path.join(SRC, 'modules', m.key, m.name + 'Hooks.gs')] = hooksFile(m);
  });
  out[path.join(SRC, 'modules', 'Registry.gs')] = HEADER('modules/*.json') +
    'const ModuleRegistry = {\n  /** Susunan = nav.order. Diselesaikan semasa panggilan (tiada kebergantungan susunan muat). */\n  list: function () {\n    return [' +
    mods.map((m) => m.name + 'Module').join(', ') + '];\n  }\n};\n';

  const schemaFile = path.join(SRC, 'models', 'Schema.gs');
  out[schemaFile] = replaceBlock(fs.readFileSync(schemaFile, 'utf8'), 'schema', mods.map(schemaEntry).join(''), schemaFile);
  const migFile = path.join(SRC, 'database', 'Migration.gs');
  out[migFile] = replaceBlock(fs.readFileSync(migFile, 'utf8'), 'migrations', mods.map(migrationEntry).join(''), migFile);
  const idxFile = path.join(SRC, 'frontend', 'index.html');
  /* Paparan tersuai: <key>.html dan fail tambahan <key>-<bahagian>.html (dimuat selepas <key>.html) */
  const feDir = path.join(SRC, 'frontend', 'modules');
  const feFiles = fs.existsSync(feDir) ? fs.readdirSync(feDir) : [];
  const custom = [];
  mods.forEach((m) => {
    if (feFiles.indexOf(m.key + '.html') >= 0) custom.push(m.key);
    feFiles.filter((f) => new RegExp('^' + m.key + '-[a-z0-9-]+\\.html$').test(f)).sort().forEach((f) => custom.push(f.replace(/\.html$/, '')));
  });
  out[idxFile] = replaceBlock(fs.readFileSync(idxFile, 'utf8'), 'frontend',
    custom.map((k) => '  <?!= include(\'frontend/modules/' + k + '\'); ?>\n').join(''), idxFile);

  // Folder modul yatim (JSON telah dibuang)
  const orphans = fs.existsSync(path.join(SRC, 'modules')) ? fs.readdirSync(path.join(SRC, 'modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !mods.some((m) => m.key === d.name)).map((d) => d.name) : [];
  return { mods, out, once, orphans };
}

function newModule(key, label) {
  if (!/^[a-z][a-z0-9]{1,19}$/.test(key || '')) throw new Error('Guna: npm run new -- <key> "<Label>"   (key huruf kecil, cth. aduan)');
  const file = path.join(MOD_DIR, key + '.json');
  if (fs.existsSync(file)) throw new Error(path.relative(ROOT, file) + ' sudah wujud');
  const lbl = label || pascal(key);
  const json = {
    key, label: lbl, labelPlural: lbl, icon: 'list', description: 'Penerangan ringkas modul ' + lbl + '.',
    refFormat: key.slice(0, 3).toUpperCase() + '-{YYYY}-{SEQ4}',
    access: { create: 'USER', list: 'OWN', edit: 'OWNER', delete: 'OWNER', ownerEditStatuses: ['BARU'] },
    statuses: [
      { value: 'BARU', label: 'Baharu', tone: 'info' },
      { value: 'DALAM_PROSES', label: 'Dalam proses', tone: 'warn' },
      { value: 'SELESAI', label: 'Selesai', tone: 'success' },
      { value: 'DITOLAK', label: 'Ditolak', tone: 'danger' }
    ],
    notify: { adminsOnCreate: true, ownerOnStatus: true },
    titleField: 'tajuk',
    fields: [
      { key: 'tajuk', label: 'Tajuk', type: 'string', required: true, max: 120, list: true, search: true },
      { key: 'kategori', label: 'Kategori', type: 'category', filter: true, list: true },
      { key: 'keterangan', label: 'Keterangan', type: 'text', max: 2000, search: true },
      { key: 'lampiran', label: 'Lampiran', type: 'files', maxFiles: 3 }
    ]
  };
  fs.mkdirSync(MOD_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log('✔ Dicipta ' + path.relative(ROOT, file) + ' — sunting medan/status, kemudian jalankan: npm run gen');
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'new') return newModule(args[1], args.slice(2).join(' '));
  const check = args.includes('--check');
  const { mods, out, once, orphans } = plan();
  let stale = 0;
  Object.keys(out).forEach((f) => {
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (cur === out[f]) return;
    stale++;
    if (check) { console.error('✘ Tidak terkini: ' + path.relative(ROOT, f)); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, out[f]);
    console.log('✎ ' + path.relative(ROOT, f));
  });
  Object.keys(once).forEach((f) => {
    if (fs.existsSync(f)) return;
    stale++;
    if (check) { console.error('✘ Tiada: ' + path.relative(ROOT, f)); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, once[f]);
    console.log('+ ' + path.relative(ROOT, f));
  });
  orphans.forEach((o) => console.warn('⚠ src/modules/' + o + '/ tiada JSON sepadan — buang folder itu jika modul tidak lagi digunakan (data dalam Sheets kekal).'));
  if (check && stale) { console.error('\nJalankan `npm run gen` dan commit hasilnya.'); process.exit(1); }
  console.log((check ? '✔ Modul terkini: ' : '✔ Dijana: ') + mods.map((m) => m.key + ' (' + m.fields.length + ' medan)').join(', ') || '(tiada modul)');
}

try { main(); } catch (e) { console.error('✘ ' + e.message); process.exit(1); }
