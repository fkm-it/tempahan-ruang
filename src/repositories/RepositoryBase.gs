/**
 * @file RepositoryBase.gs
 * Akses data generik untuk satu sheet.
 *
 * Prinsip:
 *  - Kunci utama = lajur ID (bukan nombor baris). Lokasi baris dicari semula DI DALAM kunci sebelum menulis.
 *  - Bacaan: satu getRange().getValues() per sheet per eksekusi (cache permintaan).
 *  - Tulisan: batch setValues() di bawah LockService.
 *  - Lajur dipetakan mengikut NAMA header, jadi susunan lajur dalam sheet tidak penting
 *    dan lajur tambahan yang dicipta admin dikekalkan.
 */
class RepositoryBase {
  /** @param {string} schemaKey kunci dalam SCHEMA */
  constructor(schemaKey) {
    this.key = schemaKey;
    this.def = SchemaRegistry.get(schemaKey);
    if (!this.def) throw new Error('Skema tidak wujud: ' + schemaKey);
    this.types = this.def.types || {};
  }

  sheet() {
    try {
      return Database.sheet(this.def.sheet);
    } catch (e) {
      // Sheet baharu daripada kemas kini aplikasi → cipta automatik (idempoten; tidak menyentuh sheet lain)
      if (!(e && e.details && e.details.missingSheet)) throw e;
      const key = this.key;
      Database.withLock(function () { SheetManager.ensure(key); });
      AppLogger.info('Sheet baharu dicipta automatik', { sheet: this.def.sheet });
      return Database.sheet(this.def.sheet);
    }
  }

  /** Header sebenar sheet (cache permintaan). */
  layout() {
    const ck = 'layout:' + this.def.sheet;
    const hit = Database.cacheGet(ck);
    if (hit) return hit;
    let idx = SheetManager.headerIndex(this.sheet());
    let missing = this.def.columns.filter(function (c) { return idx.map[c] === undefined; });
    if (missing.length && idx.header[0] === this.def.id) {
      // Lajur baharu daripada kemas kini aplikasi → tambah automatik di hujung (tidak menyentuh data sedia ada).
      const key = this.key;
      Database.withLock(function () { SheetManager.ensure(key); });
      AppLogger.info('Lajur baharu ditambah automatik', { sheet: this.def.sheet, columns: missing });
      idx = SheetManager.headerIndex(this.sheet());
      missing = this.def.columns.filter(function (c) { return idx.map[c] === undefined; });
    }
    if (missing.length) {
      throw new AppError(ERROR_CODES.CONFIG_ERROR, 'Struktur sheet tidak lengkap. Jalankan runMigration().', { sheet: this.def.sheet, missing: missing });
    }
    idx.width = idx.header.length;
    idx.idIndex = idx.map[this.def.id];
    return Database.cacheSet(ck, idx);
  }

  /** Baris mentah → objek bertaip. */
  fromRow(row, layout) {
    const obj = {};
    const types = this.types;
    this.def.columns.forEach(function (col) {
      obj[col] = RepositoryBase.decode(row[layout.map[col]], types[col]);
    });
    return obj;
  }

  /** Objek → baris mentah. `base` mengekalkan nilai lajur tambahan yang tidak dikenali. */
  toRow(obj, layout, base) {
    const row = base ? base.slice() : new Array(layout.width).fill('');
    const self = this;
    this.def.columns.forEach(function (col) {
      row[layout.map[col]] = RepositoryBase.encode(obj[col], self.types[col]);
    });
    return row;
  }

  static decode(v, type) {
    if (v instanceof Date) v = v.toISOString();
    if (type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
    if (type === 'int') {
      const n = parseInt(v, 10);
      return isFinite(n) ? n : 0;
    }
    if (v === null || v === undefined) return '';
    return StringUtils.sheetUnescape(String(v));
  }

  static encode(v, type) {
    if (type === 'bool') return v ? 'TRUE' : 'FALSE';
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) return v.toISOString();
    return StringUtils.sheetSafe(String(v));
  }

  rowsCacheKey() {
    return 'rows:' + this.def.sheet;
  }

  invalidate() {
    Database.invalidate(this.rowsCacheKey());
    AppCache.bump(this.def.sheet); // cache AppCache.rememberFor yang bergantung pada sheet ini menjadi lapuk
  }

  /** Semua rekod (cache permintaan). Anggap READ-ONLY — salin sebelum mengubah. */
  all() {
    const ck = this.rowsCacheKey();
    const hit = Database.cacheGet(ck);
    if (hit) return hit;
    const layout = this.layout();
    const sh = this.sheet();
    const last = sh.getLastRow();
    if (last < 2) return Database.cacheSet(ck, []);
    const values = sh.getRange(2, 1, last - 1, layout.width).getValues();
    const self = this;
    const rows = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i][layout.idIndex] === '' || values[i][layout.idIndex] === null) continue;
      rows.push(self.fromRow(values[i], layout));
    }
    return Database.cacheSet(ck, rows);
  }

  find(predicate) {
    return this.all().filter(predicate);
  }

  findOne(predicate) {
    const rows = this.all();
    for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
    return null;
  }

  findById(id) {
    if (!id) return null;
    const idCol = this.def.id;
    return this.findOne(function (r) { return r[idCol] === id; });
  }

  /** Bilangan baris data (anggaran pantas, termasuk soft-deleted). */
  count() {
    return Math.max(0, this.sheet().getLastRow() - 1);
  }

  insert(obj) {
    return this.insertMany([obj])[0];
  }

  /** Sisip berkelompok — satu setValues(). */
  insertMany(objs) {
    if (!objs || !objs.length) return [];
    const self = this;
    return Database.withLock(function () {
      const sh = self.sheet();
      const layout = self.layout();
      const rows = objs.map(function (o) { return self.toRow(o, layout); });
      const start = sh.getLastRow() + 1;
      RepositoryBase.ensureCapacity(sh, start + rows.length - 1);
      sh.getRange(start, 1, rows.length, layout.width).setValues(rows);
      self.invalidate();
      return objs.map(function (o) { return Object.assign({}, o); });
    });
  }

  /** Cari nombor baris (1-based) bagi ID — dibaca SEGAR daripada sheet. Mesti dipanggil dalam kunci. */
  locateRow(id) {
    const sh = this.sheet();
    const layout = this.layout();
    const last = sh.getLastRow();
    if (last < 2) return -1;
    const ids = sh.getRange(2, layout.idIndex + 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) return i + 2;
    }
    return -1;
  }

  /**
   * Kemas kini satu rekod (merge). ID tidak boleh diubah.
   * @return {Object} rekod selepas kemas kini
   */
  update(id, patch) {
    const self = this;
    return Database.withLock(function () {
      const rowNum = self.locateRow(id);
      if (rowNum < 0) throw Errors.notFound();
      const sh = self.sheet();
      const layout = self.layout();
      const range = sh.getRange(rowNum, 1, 1, layout.width);
      const raw = range.getValues()[0];
      const current = self.fromRow(raw, layout);
      const merged = Object.assign({}, current, patch);
      merged[self.def.id] = id;
      range.setValues([self.toRow(merged, layout, raw)]);
      self.invalidate();
      return merged;
    });
  }

  /**
   * Kemas kini banyak rekod sekaligus: baca blok penuh → ubah dalam memori → satu setValues().
   * @param {Object<string,Object>} patchById
   * @return {number} bilangan dikemas kini
   */
  updateMany(patchById) {
    const ids = Object.keys(patchById || {});
    if (!ids.length) return 0;
    const self = this;
    return Database.withLock(function () {
      const sh = self.sheet();
      const layout = self.layout();
      const last = sh.getLastRow();
      if (last < 2) return 0;
      const range = sh.getRange(2, 1, last - 1, layout.width);
      const values = range.getValues();
      let n = 0;
      for (let i = 0; i < values.length; i++) {
        const id = String(values[i][layout.idIndex]);
        if (!patchById[id]) continue;
        const merged = Object.assign(self.fromRow(values[i], layout), patchById[id]);
        merged[self.def.id] = id;
        values[i] = self.toRow(merged, layout, values[i]);
        n++;
      }
      if (n) range.setValues(values);
      self.invalidate();
      return n;
    });
  }

  /** Padam baris secara kekal (hanya untuk data bukan-kritikal: kegemaran, sesi). */
  hardDelete(id) {
    const self = this;
    return Database.withLock(function () {
      const rowNum = self.locateRow(id);
      if (rowNum < 0) return false;
      self.sheet().deleteRow(rowNum);
      self.invalidate();
      return true;
    });
  }

  /** Padam semua baris yang memenuhi predikat (penyelenggaraan). @return {number} */
  deleteWhere(predicate) {
    const self = this;
    return Database.withLock(function () {
      const sh = self.sheet();
      const layout = self.layout();
      const last = sh.getLastRow();
      if (last < 2) return 0;
      const range = sh.getRange(2, 1, last - 1, layout.width);
      const values = range.getValues();
      const keep = values.filter(function (row) { return !predicate(self.fromRow(row, layout)); });
      const removed = values.length - keep.length;
      if (!removed) return 0;
      range.clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, layout.width).setValues(keep);
      self.invalidate();
      return removed;
    });
  }

  /**
   * Tambah baris jika grid tidak cukup (elak ralat "out of bounds").
   * Baris baharu ditambah 500 sekaligus & diformat teks — jadi sisipan biasa hanya perlu satu setValues().
   */
  static ensureCapacity(sh, lastNeededRow) {
    const max = sh.getMaxRows();
    if (lastNeededRow <= max) return;
    const add = lastNeededRow - max + 500;
    sh.insertRowsAfter(max, add);
    sh.getRange(max + 1, 1, add, Math.max(1, sh.getMaxColumns())).setNumberFormat('@');
  }
}

/** Daftar instans repository (dicipta secara malas — tiada kebergantungan susunan muat). */
const Repo = {
  instances: {},
  of: function (key) {
    if (!Repo.instances[key]) Repo.instances[key] = new RepositoryBase(key);
    return Repo.instances[key];
  }
};
