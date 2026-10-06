/**
 * @file DateUtils.gs
 * Semua tarikh disimpan sebagai ISO-8601 UTC (string) dalam Sheets.
 * Paparan/pengumpulan harian menggunakan zon waktu skrip (Asia/Kuala_Lumpur).
 */
const DateUtils = {
  tz: function () {
    try {
      return Session.getScriptTimeZone() || CONFIG.TIMEZONE_FALLBACK;
    } catch (e) {
      return CONFIG.TIMEZONE_FALLBACK;
    }
  },

  now: function () {
    return new Date();
  },

  nowIso: function () {
    return new Date().toISOString();
  },

  /** Tukar Date/string/number kepada ISO, atau '' jika tidak sah. */
  toIso: function (value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  },

  parse: function (value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  },

  addMinutes: function (date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  },

  addDays: function (date, days) {
    return new Date(date.getTime() + days * 86400000);
  },

  /** 'yyyy-MM-dd' dalam zon waktu skrip. */
  dayKey: function (value) {
    const d = DateUtils.parse(value);
    return d ? Utilities.formatDate(d, DateUtils.tz(), 'yyyy-MM-dd') : '';
  },

  /** 'yyyy-MM' dalam zon waktu skrip. */
  monthKey: function (value) {
    const d = DateUtils.parse(value);
    return d ? Utilities.formatDate(d, DateUtils.tz(), 'yyyy-MM') : '';
  },

  format: function (value, pattern) {
    const d = DateUtils.parse(value);
    return d ? Utilities.formatDate(d, DateUtils.tz(), pattern || 'dd/MM/yyyy HH:mm') : '';
  },

  /** Senarai kunci hari terakhir N hari (termasuk hari ini), menaik. */
  lastNDays: function (n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) out.push(DateUtils.dayKey(DateUtils.addDays(now, -i)));
    return out;
  },

  /** Senarai kunci bulan terakhir N bulan (termasuk bulan ini), menaik. */
  lastNMonths: function (n) {
    const out = [];
    const tzNow = DateUtils.monthKey(new Date()).split('-');
    let y = Number(tzNow[0]);
    let m = Number(tzNow[1]);
    for (let i = 0; i < n; i++) {
      out.unshift(y + '-' + (m < 10 ? '0' + m : String(m)));
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
    return out;
  },

  /** Banding dua ISO: dalam julat [from, to] mengikut hari (inklusif). from/to = 'yyyy-MM-dd'. */
  inDayRange: function (iso, from, to) {
    const k = DateUtils.dayKey(iso);
    if (!k) return false;
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  }
};
