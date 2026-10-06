/**
 * @file StringUtils.gs
 * Utiliti teks: normalisasi, sanitasi input, escape output, perlindungan formula Sheets.
 */
const StringUtils = {
  /** Tukar apa-apa nilai kepada string yang ditrim. */
  clean: function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\r\n?/g, '\n')
      // buang aksara kawalan kecuali \n dan \t
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // buang aksara arah bidi yang boleh mengelirukan paparan (Trojan Source)
      .replace(/[‪-‮⁦-⁩]/g, '')
      .trim();
  },

  /** Buang tag HTML (pertahanan berlapis — output tetap di-escape di frontend). */
  stripTags: function (value) {
    return String(value || '').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  },

  /** Teks satu baris: tiada newline, ruang berganda dipadatkan. */
  singleLine: function (value) {
    return StringUtils.clean(value).replace(/\s+/g, ' ');
  },

  /** Escape untuk HTML yang dijana di server (PDF, email). */
  escapeHtml: function (value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Escape + tukar newline kepada <br> untuk paparan HTML server. */
  escapeMultiline: function (value) {
    return StringUtils.escapeHtml(value).replace(/\n/g, '<br>');
  },

  /**
   * Cegah formula/CSV injection dalam Google Sheets.
   * Nilai bermula dengan = + - @ diawali apostrof supaya Sheets simpan sebagai teks.
   */
  sheetSafe: function (value) {
    const s = String(value);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  },

  /** Songsang sheetSafe semasa membaca (jika Sheets menyimpan apostrof secara literal). */
  sheetUnescape: function (value) {
    const s = String(value);
    return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
  },

  truncate: function (value, max) {
    const s = String(value || '');
    return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
  },

  initials: function (name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  },

  normalizeEmail: function (email) {
    return StringUtils.clean(email).toLowerCase();
  },

  /** Topeng email untuk log: an***@domain.com */
  maskEmail: function (email) {
    const s = String(email || '');
    const at = s.indexOf('@');
    if (at < 1) return '***';
    return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
  },

  /** Nama fail selamat untuk Drive. */
  safeFilename: function (name) {
    const base = StringUtils.singleLine(name).replace(/[\\/:*?"<>|#%{}~&]/g, '_').replace(/\.{2,}/g, '.');
    return (base || 'fail').slice(0, 100);
  },

  extension: function (filename) {
    const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  }
};
