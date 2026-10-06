/**
 * DIJANA oleh tools/gen.js daripada modules/*.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const ModuleRegistry = {
  /** Susunan = nav.order. Diselesaikan semasa panggilan (tiada kebergantungan susunan muat). */
  list: function () {
    return [TempahanModule, RuangModule, StafModule];
  }
};
