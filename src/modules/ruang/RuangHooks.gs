/**
 * @file RuangHooks.gs
 * Ruang/fasiliti yang boleh ditempah. Ruang tidak aktif tidak muncul dalam pilihan borang tempahan atau kalendar.
 */
const RuangHooks = {
  /** Hanya ruang aktif boleh dipilih dalam medan `ruang` modul tempahan. */
  selectable: function (row) { return row.aktif !== false; },

  validate: function (data) {
    if (data.kodRuang && !/^[A-Za-z0-9 .\-\/]{1,40}$/.test(data.kodRuang)) {
      throw Errors.validation('Kod ruang hanya boleh mengandungi huruf, nombor, titik, sengkang dan garis miring.', { kodRuang: 'Format tidak sah.' });
    }
  }
};
