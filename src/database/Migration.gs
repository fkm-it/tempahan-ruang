/**
 * @file Migration.gs
 * Migrasi berversi, idempoten, direkod dalam sheet MIGRATIONS.
 *
 * Menambah migrasi baharu:
 *   1. Tambah objek { id:'MIGRATION_00N', description, up: function(){...} } di hujung LIST.
 *   2. `up` MESTI idempoten (selamat jika dijalankan semula) dan TIDAK menulis ganti data sedia ada.
 *   3. Jalankan runMigration({dryRun:true}) dahulu, kemudian runMigration().
 */
const Migration = {
  LIST: [
    {
      id: 'MIGRATION_001',
      description: 'Cipta semua sheet & header asas',
      up: function () {
        return Object.keys(SCHEMA).map(function (k) { return SheetManager.ensure(k); });
      }
    },
    {
      id: 'MIGRATION_002',
      description: 'Seed kategori lalai',
      up: function () { return { added: SeedData.categories() }; }
    },
    {
      id: 'MIGRATION_003',
      description: 'Seed tetapan lalai',
      up: function () { return { added: SeedData.settings() }; }
    },
    // Migrasi modul (cipta sheet / tambah lajur) — DIJANA oleh `npm run gen`. ID berubah apabila medan berubah.
    // @generator:migrations:start
    { id: 'MODULE_TEMPAHAN_575F87E4', description: 'Modul Tempahan: sheet TEMPAHAN & lajur', up: function () { return SheetManager.ensure('TEMPAHAN'); } },
    { id: 'MODULE_TUGASAN_9B7D2DB1', description: 'Modul Tugasan: sheet TUGASAN & lajur', up: function () { return SheetManager.ensure('TUGASAN'); } },
    { id: 'MODULE_RUANG_8829E45D', description: 'Modul Ruang: sheet RUANG & lajur', up: function () { return SheetManager.ensure('RUANG'); } },
    { id: 'MODULE_PEMBANTU_AA64F78E', description: 'Modul Pembantu Operasi: sheet PEMBANTU & lajur', up: function () { return SheetManager.ensure('PEMBANTU'); } },
    { id: 'MODULE_STAF_7A3C3D95', description: 'Modul Staf: sheet STAF & lajur', up: function () { return SheetManager.ensure('STAF'); } },
    // @generator:migrations:end
    // Migrasi tulisan tangan (data) — tambah di bawah dengan ID MIGRATION_00N.
    {
      id: 'MIGRATION_004',
      description: 'Tutup pendaftaran akaun awam (v1.4.2) — Super Admin boleh membukanya semula di Tetapan',
      up: function () { SettingsRepository.setMany({ ALLOW_REGISTRATION: 'FALSE' }, 'MIGRATION_004'); return { ALLOW_REGISTRATION: false }; }
    }
  ],

  applied: function () {
    const ss = Database.open();
    if (!ss.getSheetByName(SCHEMA.MIGRATIONS.sheet)) return {};
    const out = {};
    Repo.of('MIGRATIONS').all().forEach(function (m) { out[m.migration_id] = m; });
    return out;
  },

  status: function () {
    try {
      const applied = Migration.applied();
      return Migration.LIST.map(function (m) {
        return { id: m.id, description: m.description, appliedAt: applied[m.id] ? applied[m.id].applied_at : '' };
      });
    } catch (e) {
      return [];
    }
  },

  /**
   * @param {{dryRun?:boolean}} options
   * @return {{applied:string[], pending:string[], log:Object[]}}
   */
  run: function (options) {
    const dryRun = !!(options && options.dryRun);
    // MIGRATIONS sheet sendiri mesti wujud dahulu
    if (!dryRun) SheetManager.ensure('MIGRATIONS');
    const done = Migration.applied();
    const pending = Migration.LIST.filter(function (m) { return !done[m.id]; });
    const log = [];
    if (dryRun) {
      return { applied: [], pending: pending.map(function (m) { return m.id; }), log: log, dryRun: true };
    }
    const actor = Migration.actor();
    const appliedIds = [];
    pending.forEach(function (m) {
      const started = Date.now();
      const result = Database.withLock(function () {
        Database.resetRequestCache(); // header mungkin berubah
        return m.up();
      });
      Repo.of('MIGRATIONS').insert({ migration_id: m.id, description: m.description, applied_at: DateUtils.nowIso(), applied_by: actor });
      log.push({ id: m.id, ms: Date.now() - started, result: result });
      AppLogger.info('Migrasi digunakan', { id: m.id, ms: Date.now() - started });
      AuditService.log({ role: 'SYSTEM' }, AUDIT_ACTIONS.MIGRATION_APPLIED, 'DATABASE', m.id, m.description);
      appliedIds.push(m.id);
    });
    // Sentiasa pastikan skema terkini (lajur baharu) walaupun tiada migrasi tertunda
    if (!pending.length) Object.keys(SCHEMA).forEach(function (k) { SheetManager.ensure(k); });
    Database.resetRequestCache();
    return { applied: appliedIds, pending: [], log: log };
  },

  /**
   * Migrasi automatik selepas deploy (CI): dipanggil pada setiap permintaan API, tetapi kos hampir sifar —
   * hanya membandingkan tandatangan senarai migrasi dengan Script Property MIGRATED_FOR (dicache).
   * Jika berbeza, migrasi tertunda dijalankan SEKALI di bawah kunci. Tiada langkah manual selepas `clasp push`.
   * Dilangkau jika pangkalan data belum disediakan (setupDatabase belum dijalankan).
   */
  autoRun: function () {
    const sig = CONFIG.VERSION + ':' + Migration.LIST.map(function (m) { return m.id; }).join(',');
    const hash = SecurityUtils.shortHash(sig);
    if (Env.get('MIGRATED_FOR') === hash || !Env.get('SPREADSHEET_ID')) return null;
    return Database.withLock(function () {
      Env.reset();
      if (Env.get('MIGRATED_FOR') === hash) return null; // proses lain telah menjalankannya
      const r = Migration.run({});
      Env.set('MIGRATED_FOR', hash);
      try { MaintenanceService.ensureTriggers(); } catch (e) { AppLogger.warn('Pencetus tidak dapat dipasang automatik', { error: String(e) }); }
      if (r.applied.length) AppLogger.info('Migrasi automatik selepas deploy', { applied: r.applied });
      return r;
    });
  },

  actor: function () {
    try { return Session.getEffectiveUser().getEmail() || 'SYSTEM'; } catch (e) { return 'SYSTEM'; }
  }
};
