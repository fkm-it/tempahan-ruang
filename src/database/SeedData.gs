/**
 * @file SeedData.gs
 * Data awal: kategori & tetapan lalai. Idempoten — hanya menambah yang tiada.
 * Ubah CATEGORIES mengikut domain sistem (cth. jenis aduan, jenis ruang, jabatan).
 */
const SeedData = {
  DEFAULT_CATEGORY: 'Umum',
  /** [nama BM, nama EN, ikon] — ikon mesti dalam CATEGORY_ICONS. */
  CATEGORIES: [
    ['Umum', 'General', 'grid']
  ],

  /** @return {number} bilangan kategori ditambah */
  categories: function () {
    const existing = {};
    CategoryRepository.base().all().forEach(function (c) { existing[c.name_ms.toLowerCase()] = true; });
    const now = DateUtils.nowIso();
    const rows = [];
    SeedData.CATEGORIES.forEach(function (c, i) {
      if (existing[c[0].toLowerCase()]) return;
      rows.push({
        category_id: IdUtils.generate('C'),
        name_ms: c[0], name_en: c[1], description: '', icon: c[2],
        sort_order: (i + 1) * 10, status: CATEGORY_STATUS.ACTIVE, created_at: now, updated_at: now
      });
    });
    CategoryRepository.insertMany(rows);
    return rows.length;
  },

  /** @return {number} bilangan tetapan ditambah */
  settings: function () {
    const existing = {};
    SettingsRepository.rows().forEach(function (r) { existing[r.setting_key] = true; });
    const values = {};
    const desc = {};
    Object.keys(SETTINGS_DEFS).forEach(function (k) {
      if (existing[k]) return;
      values[k] = SettingModel.serialize(SETTINGS_DEFS[k], SETTINGS_DEFS[k].default);
      desc[k] = SETTINGS_DEFS[k].description;
    });
    if (Object.keys(values).length) SettingsRepository.setMany(values, 'SYSTEM', desc);
    return Object.keys(values).length;
  }
};
