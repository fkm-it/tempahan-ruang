/**
 * @file IdUtils.gs
 * Penjana ID unik. Rekod TIDAK bergantung pada nombor baris Sheets.
 * Sumber rawak: Utilities.getUuid() (java.util.UUID.randomUUID → SecureRandom).
 */
const IdUtils = {
  /** cth. generate('D') → 'D-7F3A9C21B04E5D18' (64-bit rawak). */
  generate: function (prefix) {
    const hex = Utilities.getUuid().replace(/-/g, '').toUpperCase();
    // ambil 16 aksara heks rawak (elak nibble versi UUID di kedudukan 12)
    return prefix + '-' + hex.slice(0, 12) + hex.slice(13, 17);
  },

  /** Kod kongsi pendek tanpa aksara mengelirukan (0/O, 1/I/L). */
  shareCode: function (length) {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = SecurityUtils.randomBytes(length || 8);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[(bytes[i] & 0xff) % alphabet.length];
    return out;
  },

  /** ID ralat untuk rujukan admin: E-202610031530-AB12CD */
  errorId: function () {
    const stamp = Utilities.formatDate(new Date(), DateUtils.tz(), 'yyyyMMddHHmm');
    return 'E-' + stamp + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  },

  /** Kod angka (cth. kod reset 6 digit). */
  numericCode: function (digits) {
    const bytes = SecurityUtils.randomBytes(digits);
    let out = '';
    for (let i = 0; i < digits; i++) out += String((bytes[i] & 0xff) % 10);
    return out;
  },

  isValid: function (id, prefix) {
    return typeof id === 'string' && new RegExp('^' + prefix + '-[0-9A-F]{16}$').test(id);
  }
};
