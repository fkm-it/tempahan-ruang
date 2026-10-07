/**
 * @file PembantuHooks.gs
 * Pembantu operasi (PIC buka ruang). Tiada akaun log masuk: dimaklumkan melalui emel + WhatsApp (wa.me) dan
 * mengesahkan tugasan melalui pautan selamat (lihat TugasanHooks).
 * Data peribadi: hanya pentadbir boleh melihat; JANGAN commit data sebenar ke repo.
 */
const PembantuHooks = {
  /** Hanya pembantu aktif boleh dipilih (medan `pembantu` dalam Ruang & Tugasan). */
  selectable: function (row) { return row.aktif !== false; },

  validate: function (data) {
    if (data.noTelefon !== undefined && data.noTelefon !== '') Validator.waPhone(data.noTelefon, 'noTelefon');
  }
};
