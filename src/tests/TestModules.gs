/**
 * @file TestModules.gs
 * Ujian enjin modul (CrudEngine) menggunakan modul FIXTURE sendiri — bebas daripada modules/*.json projek,
 * jadi ujian kekal lulus walaupun modul contoh dibuang atau diubah.
 * Fixture meliputi semua jenis medan, aliran status, borang awam, adminOnly/publicOnly, lampiran dan hooks.
 */
const TestFixtures = {
  hookLog: [],

  module: function () {
    const f = function (key, column, type, extra) { return Object.assign({ key: key, column: column, type: type, label: key }, extra || {}); };
    return Object.freeze({
      key: 'tiket', name: 'Tiket', label: 'Tiket', labelPlural: 'Tiket', icon: 'inbox', path: '/tiket', sheet: 'T_TIKET', prefix: 'TK',
      refFormat: 'TK-{YYYY}-{SEQ4}', description: 'Fixture ujian',
      access: { create: 'PUBLIC', list: 'OWN', edit: 'OWNER', delete: 'OWNER', ownerEditStatuses: ['BARU'] },
      statuses: [{ value: 'BARU', label: 'Baharu', tone: 'info' }, { value: 'SELESAI', label: 'Selesai', tone: 'success' }],
      defaultStatus: 'BARU', statusRole: 'ADMIN',
      notify: { adminsOnCreate: true, ownerOnStatus: true },
      titleField: 'tajuk', nav: { user: true, admin: true, order: 1 },
      publicForm: { title: 'Borang', contactEmailField: 'email', nameField: 'nama', rateKeyField: 'telefon' },
      fields: [
        f('nama', 'nama', 'string', { publicOnly: true, max: 80 }),
        f('email', 'email', 'email', { publicOnly: true }),
        f('tajuk', 'tajuk', 'string', { required: true, max: 60, list: true, search: true }),
        f('kategori', 'kategori', 'category', { filter: true }),
        f('jenis', 'jenis', 'enum', { filter: true, default: 'A', options: [{ value: 'A', label: 'Jenis A' }, { value: 'B', label: 'Jenis B' }] }),
        f('jumlah', 'jumlah', 'number', { min: 0, max: 1000, decimals: 2 }),
        f('kuantiti', 'kuantiti', 'int', { min: 1, max: 10 }),
        f('tarikh', 'tarikh', 'date'),
        f('masa', 'masa', 'time'),
        f('segera', 'segera', 'bool', { filter: true }),
        f('telefon', 'telefon', 'phone'),
        f('lokasi', 'lokasi', 'ref', { ref: 'lokasi', filter: true }),
        f('butiran', 'butiran', 'text', { max: 500, search: true }),
        f('fail', 'fail', 'files', { maxFiles: 2, public: false }),
        f('catatanDalaman', 'catatan_dalaman', 'text', { adminOnly: true })
      ],
      hooks: function () { return TestFixtures.hooks; }
    });
  },

  hooks: {
    validate: function (data) {
      if (data.tajuk && /^TOLAK/.test(data.tajuk)) throw Errors.conflict('Tajuk ditolak oleh hook.');
    },
    beforeSave: function (row) { if (row.tajuk) row.tajuk = row.tajuk.replace(/\s+$/, ''); },
    afterCreate: function (row) { TestFixtures.hookLog.push('create:' + row.ref_no); },
    afterStatus: function (row, prev) { TestFixtures.hookLog.push('status:' + prev + '>' + row.status); },
    visible: function (row) { return row.tajuk !== 'TERSEMBUNYI'; },
    beforeStatus: function (row, next) { if (row.tajuk === 'HALANG' && next === 'SELESAI') throw Errors.conflict('Dihalang oleh hook.'); },
    routes: {
      'tiket.ping': { role: 'PUBLIC', fn: function (p) { return { pong: true, echo: String((p && p.x) || '') }; } }
    }
  },

  /** Modul sasaran untuk medan ref. */
  lokasiModule: function () {
    return Object.freeze({
      key: 'lokasi', name: 'Lokasi', label: 'Lokasi', labelPlural: 'Lokasi', icon: 'home', path: '/lokasi', sheet: 'T_LOKASI', prefix: 'LO',
      access: { create: 'ADMIN', list: 'ALL', edit: 'ADMIN', delete: 'ADMIN', ownerEditStatuses: [] },
      statuses: [], defaultStatus: '', statusRole: 'ADMIN', notify: { adminsOnCreate: false, ownerOnStatus: false },
      titleField: 'nama', subtitleField: 'blok', nav: { user: false, admin: true, order: 2 },
      fields: [{ key: 'nama', column: 'nama', type: 'string', label: 'Nama', required: true },
        { key: 'blok', column: 'blok', type: 'string', label: 'Blok' },
        { key: 'aktif', column: 'aktif', type: 'bool', label: 'Aktif', default: true }],
      hooks: function () { return { selectable: function (r) { return r.aktif !== false; } }; }
    });
  },

  /** Pasang fixture: skema + senarai modul. */
  install: function () {
    const def = TestFixtures.module();
    const cols = ['id', 'ref_no', 'owner_user_id', 'owner_name'].concat(def.fields.map(function (x) { return x.column; }),
      ['status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at']);
    SchemaRegistry.extra.T_TIKET = { sheet: 'T_TIKET', id: 'id', prefix: 'TK', module: 'tiket', columns: cols, types: { segera: 'bool', kuantiti: 'int', fail: 'int' } };
    SchemaRegistry.extra.T_LOKASI = { sheet: 'T_LOKASI', id: 'id', prefix: 'LO', module: 'lokasi', types: { aktif: 'bool' },
      columns: ['id', 'ref_no', 'owner_user_id', 'owner_name', 'nama', 'blok', 'aktif', 'status', 'status_note', 'status_changed_at', 'status_changed_by', 'state', 'created_at', 'updated_at', 'deleted_at'] };
    CrudEngine.override = [def, TestFixtures.lokasiModule()];
    Router.routes = null;
    TestFixtures.hookLog = [];
    return def;
  },

  uninstall: function () {
    CrudEngine.override = null;
    Router.routes = null;
    delete SchemaRegistry.extra.T_TIKET;
    delete SchemaRegistry.extra.T_LOKASI;
  }
};

const TestSuiteCrud = {
  name: 'Modul (CrudEngine)',
  tests: [
    ['Cipta: validasi jenis medan, nilai lalai, no. rujukan berjujukan, kategori lalai', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('crud');
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Projektor rosak  ', jumlah: '12.345', kuantiti: 2, tarikh: '2026-10-05', masa: '09:30', segera: true, telefon: '012-345 6789' }));
      t.ok(/^TK-\d{4}-0001$/.test(d.refNo), 'no. rujukan pertama: ' + d.refNo);
      t.eq(d.values.tajuk, 'Projektor rosak');
      t.eq(d.values.jumlah, 12.35);
      t.eq(d.values.kuantiti, 2);
      t.eq(d.values.segera, true);
      t.eq(d.values.jenis, 'A', 'nilai lalai enum');
      t.eq(d.labels.jenis, 'Jenis A');
      t.ok(d.values.kategori && d.labels.kategori === 'Umum', 'kategori lalai apabila hanya satu aktif');
      t.eq(d.status, 'BARU');
      t.ok(d.isMine && d.canEdit && d.canDelete && !d.canSetStatus);
      t.eq(d.values.catatanDalaman, undefined, 'medan adminOnly tidak didedahkan kepada pengguna');
      const d2 = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Kedua' }));
      t.ok(/-0002$/.test(d2.refNo), 'jujukan bertambah: ' + d2.refNo);
      const errs = TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: '', jumlah: 'abc', kuantiti: 99, tarikh: '2026-13-01', masa: '25:00', jenis: 'Z' }), ERROR_CODES.VALIDATION_ERROR).meta.fields;
      ['tajuk', 'jumlah', 'kuantiti', 'tarikh', 'masa', 'jenis'].forEach(function (k) { t.ok(errs[k], 'ralat medan ' + k); });
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiada', tajuk: 'x' }), ERROR_CODES.BAD_REQUEST);
      TestFixtures.uninstall();
    }],
    ['Mass assignment & XSS: lajur sistem/adminOnly diabaikan, tag HTML dibuang', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('crud');
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: '<b>Hai</b><script>x()</script>', status: 'SELESAI', owner_user_id: 'U-0000000000000000', catatanDalaman: 'cuba', ref_no: 'X' }));
      t.eq(d.status, 'BARU');
      t.eq(d.values.tajuk.indexOf('<'), -1);
      const row = Repo.of('T_TIKET').findById(d.id);
      t.eq(row.owner_user_id, u.user.id);
      t.eq(row.catatan_dalaman, '');
      t.ok(row.ref_no !== 'X');
      TestFixtures.uninstall();
    }],
    ['IDOR: pengguna lain tidak boleh baca/ubah/padam; senarai hanya rekod sendiri', function (t) {
      TestFixtures.install();
      const a = TestHelpers.user('a');
      const b = TestHelpers.user('b');
      const d = TestAssert.apiOk(TestHelpers.call(a.token, 'crud.create', { module: 'tiket', tajuk: 'Milik A' }));
      TestAssert.apiFail(TestHelpers.call(b.token, 'crud.get', { module: 'tiket', id: d.id }), ERROR_CODES.NOT_FOUND);
      TestAssert.apiFail(TestHelpers.call(b.token, 'crud.update', { module: 'tiket', id: d.id, tajuk: 'Godam' }), ERROR_CODES.NOT_FOUND);
      TestAssert.apiFail(TestHelpers.call(b.token, 'crud.delete', { module: 'tiket', id: d.id }), ERROR_CODES.NOT_FOUND);
      TestAssert.apiFail(TestHelpers.call(b.token, 'crud.setStatus', { module: 'tiket', id: d.id, status: 'SELESAI' }), ERROR_CODES.NOT_FOUND);
      t.eq(TestAssert.apiOk(TestHelpers.call(b.token, 'crud.list', { module: 'tiket' })).items.length, 0);
      t.eq(TestAssert.apiOk(TestHelpers.call(b.token, 'crud.list', { module: 'tiket', scope: 'ALL' })).items.length, 0, 'scope ALL diabaikan untuk pengguna');
      TestAssert.apiFail(api({ action: 'crud.list', payload: { module: 'tiket' } }), ERROR_CODES.UNAUTHENTICATED);
      TestFixtures.uninstall();
    }],
    ['Aliran status: admin tukar status → pemilik dimaklumkan; pemilik tidak boleh sunting selepas BARU', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('owner');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Aircond' }));
      t.ok(NotificationRepository.byUser(adm.user.id).some(function (n) { return n.type === NOTIF_TYPE.RECORD_CREATED && n.reference_id === d.id; }), 'admin dimaklumkan rekod baharu');
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.setStatus', { module: 'tiket', id: d.id, status: 'SELESAI' }), ERROR_CODES.FORBIDDEN);
      TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tiket', id: d.id, status: 'TIADA' }), ERROR_CODES.VALIDATION_ERROR);
      const s = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tiket', id: d.id, status: 'SELESAI', note: 'Telah dibaiki.' }));
      t.eq(s.status, 'SELESAI');
      t.eq(s.statusNote, 'Telah dibaiki.');
      const n = NotificationRepository.byUser(u.user.id).filter(function (x) { return x.type === NOTIF_TYPE.RECORD_STATUS; });
      t.eq(n.length, 1);
      t.ok(/Selesai/.test(n[0].title) && /dibaiki/.test(n[0].message));
      const again = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.get', { module: 'tiket', id: d.id }));
      t.ok(!again.canEdit && !again.canDelete, 'pemilik dikunci selepas status berubah');
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.update', { module: 'tiket', id: d.id, tajuk: 'Ubah' }), ERROR_CODES.FORBIDDEN);
      t.ok(TestFixtures.hookLog.indexOf('status:BARU>SELESAI') >= 0, 'hook afterStatus');
      t.ok(AuditRepository.all().some(function (l) { return l.action === AUDIT_ACTIONS.RECORD_STATUS && l.reference_id === d.id; }));
      TestFixtures.uninstall();
    }],
    ['Kemas kini: medan pilihan boleh dikosongkan, medan wajib tidak; padam lembut & pulih oleh admin', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('upd');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Asal', butiran: 'Ada butiran', kuantiti: 3 }));
      const e = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.update', { module: 'tiket', id: d.id, butiran: '', kuantiti: '' }));
      t.eq(e.values.butiran, '');
      t.eq(e.values.tajuk, 'Asal', 'medan tidak dihantar kekal');
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.update', { module: 'tiket', id: d.id, tajuk: '' }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiOk(TestHelpers.call(u.token, 'crud.delete', { module: 'tiket', id: d.id }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.get', { module: 'tiket', id: d.id }), ERROR_CODES.NOT_FOUND);
      t.eq(TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.list', { module: 'tiket', deleted: true })).items.filter(function (x) { return x.id === d.id; }).length, 1);
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.restore', { module: 'tiket', id: d.id }), ERROR_CODES.FORBIDDEN);
      TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.restore', { module: 'tiket', id: d.id }));
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.get', { module: 'tiket', id: d.id })).state, 'ACTIVE');
      const adminView = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.update', { module: 'tiket', id: d.id, catatanDalaman: 'Nota admin' }));
      t.eq(adminView.values.catatanDalaman, 'Nota admin', 'admin boleh tulis medan adminOnly');
      TestFixtures.uninstall();
    }],
    ['Senarai: carian, penapis medan, kiraan status, pagination, hook visible, eksport CSV', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('list');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      ['Satu', 'Dua', 'Tiga', 'TERSEMBUNYI'].forEach(function (x, i) {
        TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: x, jenis: i % 2 ? 'B' : 'A', segera: i === 0 }));
      });
      const all = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket' }));
      t.eq(all.meta.total, 3, 'hook visible menyembunyikan rekod daripada pengguna');
      t.eq(all.meta.statusCounts.BARU, 3);
      t.eq(TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.list', { module: 'tiket' })).meta.total >= 4, true, 'admin nampak semua');
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', q: 'dua' })).meta.total, 1);
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', filters: { jenis: 'B' } })).meta.total, 1);
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', filters: { segera: 'true' } })).meta.total, 1);
      const sel = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', status: 'SELESAI' }));
      t.eq(sel.meta.total, 0);
      t.eq(sel.meta.totalAll, 3, 'kiraan status dikira tanpa penapis status');
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', pageSize: 2, page: 2 })).items.length, 1);
      const csv = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.export', { module: 'tiket' }));
      t.eq(csv.rows.length, 4);
      t.eq(csv.rows[0][0], 'No. Rujukan');
      t.ok(csv.rows[0].indexOf('catatanDalaman') < 0, 'medan adminOnly tiada dalam eksport pengguna');
      TestFixtures.uninstall();
    }],
    ['Hook validate menolak; hook afterCreate dipanggil', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('hook');
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'TOLAK ini' }), ERROR_CODES.CONFLICT);
      t.eq(Repo.of('T_TIKET').all().filter(function (r) { return r.tajuk === 'TOLAK ini'; }).length, 0, 'tiada rekod separa');
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'OK' }));
      t.ok(TestFixtures.hookLog.indexOf('create:' + d.refNo) >= 0);
      TestFixtures.uninstall();
    }],
    ['Lampiran: PNG disimpan di Drive peribadi, had bilangan, boleh dibuang, akses pemilik sahaja', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('att');
      const other = TestHelpers.user('other');
      const png = { name: 'gambar.png', mimeType: 'image/png', data: TestHelpers.PNG_1PX };
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Banyak', fail: [png, png, png] }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Palsu', fail: [{ name: 'x.png', mimeType: 'image/png', data: Utilities.base64Encode('bukan png') }] }), ERROR_CODES.VALIDATION_ERROR);
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Dengan gambar', fail: [png] }));
      t.eq(d.values.fail, 1);
      const full = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.get', { module: 'tiket', id: d.id }));
      t.eq(full.attachments.length, 1);
      const att = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.attachment', { id: full.attachments[0].id }));
      t.eq(att.data.replace(/=+$/, ''), TestHelpers.PNG_1PX.replace(/=+$/, ''));
      TestAssert.apiFail(TestHelpers.call(other.token, 'crud.attachment', { id: full.attachments[0].id }), ERROR_CODES.NOT_FOUND);
      const e = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.update', { module: 'tiket', id: d.id, removeAttachmentIds: [full.attachments[0].id] }));
      t.eq(e.attachments.length, 0);
      t.eq(e.values.fail, 0);
      TestFixtures.uninstall();
    }],
    ['Borang awam: token wajib, honeypot, nama pengadu, email status, hidden fields', function (t) {
      TestFixtures.install();
      const adm = TestHelpers.admin(ROLES.ADMIN);
      const form = TestAssert.apiOk(api({ action: 'crud.publicForm', payload: { module: 'tiket' } }));
      t.ok(form.formToken && form.module.fields.every(function (f) { return f.type !== 'files' && !f.adminOnly; }), 'medan files/adminOnly tiada dalam borang awam');
      TestAssert.apiFail(api({ action: 'crud.publicCreate', payload: { module: 'tiket', tajuk: 'Awam', formToken: form.formToken } }), ERROR_CODES.VALIDATION_ERROR); // terlalu cepat
      const bot = TestAssert.apiOk(api({ action: 'crud.publicCreate', payload: { module: 'tiket', tajuk: 'Bot', website: 'http://spam', formToken: SecurityUtils.signFormToken('crud:tiket', Date.now() - 5000) } }));
      t.eq(bot.refNo, '');
      t.eq(Repo.of('T_TIKET').all().filter(function (r) { return r.tajuk === 'Bot'; }).length, 0);
      const ok = TestAssert.apiOk(api({ action: 'crud.publicCreate', payload: { module: 'tiket', tajuk: 'Awam', nama: 'Pak Ali', email: 'ali@test.local', catatanDalaman: 'cuba', formToken: SecurityUtils.signFormToken('crud:tiket', Date.now() - 5000) } }));
      t.ok(/^TK-/.test(ok.refNo));
      const row = Repo.of('T_TIKET').findOne(function (r) { return r.ref_no === ok.refNo; });
      t.eq(row.owner_user_id, '');
      t.eq(row.owner_name, 'Pak Ali (awam)');
      t.eq(row.catatan_dalaman, '');
      if (typeof __mails !== 'undefined') {
        const before = __mails.length;
        TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { NOTIFY_EMAIL_ENABLED: true } }));
        TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tiket', id: row.id, status: 'SELESAI' }));
        const m = __mails.slice(before).filter(function (x) { return x.to === 'ali@test.local'; });
        t.eq(m.length, 1, 'pengadu awam dimaklumkan melalui email');
        t.ok(m[0].htmlBody.indexOf(ok.refNo) >= 0);
        TestAssert.apiOk(TestHelpers.call(adm.token, 'admin.settings.update', { changes: { NOTIFY_EMAIL_ENABLED: false } }));
      }
      TestFixtures.uninstall();
    }, { nodeOnly: true }],
    ['Ringkasan, meta & statistik admin', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('sum');
      const s = TestHelpers.admin(ROLES.SUPER_ADMIN);
      TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Satu' }));
      const meta = TestAssert.apiOk(api({ action: 'crud.meta' }));
      t.eq(meta.length, 2);
      t.ok(meta[0].fields.every(function (f) { return f.column === undefined; }), 'nama lajur tidak didedahkan');
      t.eq(meta[0].hooks, undefined);
      const sum = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.summary'));
      t.eq(sum.modules[0].total, 1);
      t.eq(sum.recent.length, 1);
      AppCache.remove('stats:admin');
      const st = TestAssert.apiOk(TestHelpers.call(s.token, 'admin.stats'));
      t.ok(st.modules[0].total >= 1 && st.modules[0].byDay.length === 14 && st.kpi.totalRecords >= 1);
      t.ok(TestAssert.apiOk(TestHelpers.call(s.token, 'admin.users', {})).items.some(function (x) { return x.recordCount >= 1; }));
      TestFixtures.uninstall();
    }]
    ,
    ['Medan ref: pilihan (selectable), validasi, label, penapis; laluan modul; beforeStatus; rateKeyField', function (t) {
      TestFixtures.install();
      const u = TestHelpers.user('ref');
      const adm = TestHelpers.admin(ROLES.ADMIN);
      const a = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'lokasi', nama: 'Dewan B', blok: 'C23', aktif: true }));
      const b = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'lokasi', nama: 'Bilik A', blok: 'E07', aktif: true }));
      const off = TestAssert.apiOk(TestHelpers.call(adm.token, 'crud.create', { module: 'lokasi', nama: 'Ditutup', aktif: false }));
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'lokasi', nama: 'X' }), ERROR_CODES.FORBIDDEN);
      const opts = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.refOptions', { module: 'tiket', field: 'lokasi' }));
      t.eq(opts.map(function (o) { return o.label; }).join(','), 'Bilik A,Dewan B', 'tersusun & tanpa lokasi tidak aktif');
      t.eq(opts[0].hint, 'E07');
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.refOptions', { module: 'tiket', field: 'tajuk' }), ERROR_CODES.BAD_REQUEST);
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'X', lokasi: off.id }), ERROR_CODES.VALIDATION_ERROR);
      TestAssert.apiFail(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'X', lokasi: 'bukan-id' }), ERROR_CODES.VALIDATION_ERROR);
      const d = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Lampu', lokasi: a.id }));
      t.eq(d.labels.lokasi, 'Dewan B');
      TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'Kipas', lokasi: b.id }));
      t.eq(TestAssert.apiOk(TestHelpers.call(u.token, 'crud.list', { module: 'tiket', filters: { lokasi: a.id } })).meta.total, 1);
      const pf = TestAssert.apiOk(api({ action: 'crud.publicForm', payload: { module: 'tiket' } }));
      t.eq(pf.refOptions.lokasi.length, 2, 'pilihan ref dalam borang awam');
      t.eq(TestAssert.apiOk(api({ action: 'tiket.ping', payload: { x: 'ok' } })).echo, 'ok', 'laluan modul daripada hooks');
      const h = TestAssert.apiOk(TestHelpers.call(u.token, 'crud.create', { module: 'tiket', tajuk: 'HALANG' }));
      TestAssert.apiFail(TestHelpers.call(adm.token, 'crud.setStatus', { module: 'tiket', id: h.id, status: 'SELESAI' }), ERROR_CODES.CONFLICT);
      t.eq(Repo.of('T_TIKET').findById(h.id).status, 'BARU', 'status tidak berubah');
      TestFixtures.uninstall();
      TestAssert.apiFail(api({ action: 'tiket.ping' }), ERROR_CODES.BAD_REQUEST);
    }]
  ]
};
