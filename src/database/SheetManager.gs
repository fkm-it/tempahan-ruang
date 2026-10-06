/**
 * @file SheetManager.gs
 * Cipta/semak sheet berdasarkan SCHEMA. Idempoten — selamat dijalankan berulang kali.
 */
const SheetManager = {
  HEADER_BG: '#4B1027',
  HEADER_FG: '#FFFFFF',

  /**
   * Pastikan sheet wujud dengan header betul.
   * - Sheet tiada → cipta.
   * - Header kosong → tulis.
   * - Lajur baharu dalam SCHEMA → tambah di hujung (tidak memadam lajur sedia ada).
   * @return {{name:string, created:boolean, addedColumns:string[]}}
   */
  ensure: function (schemaKey, ss) {
    const def = SchemaRegistry.get(schemaKey);
    ss = ss || Database.open();
    let sh = ss.getSheetByName(def.sheet);
    let created = false;
    if (!sh) {
      sh = ss.insertSheet(def.sheet);
      created = true;
    }

    const added = [];
    const lastCol = sh.getLastColumn();
    if (lastCol === 0) {
      sh.getRange(1, 1, 1, def.columns.length).setValues([def.columns]);
    } else {
      const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
      // Lajur pertama mesti ID — jika tidak, jangan sentuh (elak rosakkan data).
      if (existing[0] !== def.columns[0]) {
        throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Header sheet ' + def.sheet + ' tidak sepadan. Semak secara manual.');
      }
      def.columns.forEach(function (col) {
        if (existing.indexOf(col) < 0) added.push(col);
      });
      if (added.length) sh.getRange(1, lastCol + 1, 1, added.length).setValues([added]);
    }

    const width = Math.max(sh.getLastColumn(), def.columns.length);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(SheetManager.HEADER_BG).setFontColor(SheetManager.HEADER_FG);
    sh.setFrozenRows(1);
    // Simpan semua sebagai teks biasa
    sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');

    if (def.hidden && !sh.isSheetHidden()) sh.hideSheet();
    if (def.protect) SheetManager.protect(sh);
    return { name: def.sheet, created: created, addedColumns: added };
  },

  /** Hadkan suntingan manual kepada pemilik skrip sahaja. */
  protect: function (sh) {
    try {
      const existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if (existing && existing.length) return;
      const p = sh.protect().setDescription(CONFIG.APP_NAME + ' — data sensitif. Jangan sunting manual.');
      const me = Session.getEffectiveUser();
      p.addEditor(me);
      p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } catch (e) {
      AppLogger.warn('Perlindungan sheet gagal', { sheet: sh.getName(), error: String(e) });
    }
  },

  /** Pemetaan nama lajur → indeks (0-based) berdasarkan header sebenar dalam sheet. */
  headerIndex: function (sh) {
    const lastCol = sh.getLastColumn();
    const header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    const map = {};
    header.forEach(function (h, i) { if (h) map[h] = i; });
    return { header: header, map: map };
  },

  /** Laporan kesihatan setiap sheet. */
  health: function () {
    const ss = Database.open();
    return Object.keys(SCHEMA).map(function (key) {
      const def = SCHEMA[key];
      const sh = ss.getSheetByName(def.sheet);
      if (!sh) return { sheet: def.sheet, exists: false, headersOk: false, rows: 0 };
      const idx = SheetManager.headerIndex(sh);
      const missing = def.columns.filter(function (c) { return idx.map[c] === undefined; });
      return { sheet: def.sheet, exists: true, headersOk: missing.length === 0, missing: missing, rows: Math.max(0, sh.getLastRow() - 1) };
    });
  }
};
