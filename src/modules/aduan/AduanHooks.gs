/**
 * @file AduanHooks.gs
 * Logik khusus modul "Aduan". Fail ini dicipta SEKALI oleh tools/gen.js — selamat disunting.
 * Semua hook pilihan; buang yang tidak digunakan. Rujuk modules/CrudEngine.gs untuk butiran.
 */
const AduanHooks = {
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
