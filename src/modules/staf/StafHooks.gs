/**
 * @file StafHooks.gs
 * Senarai staf FKM yang layak memohon (borang awam menyemak No. Staf di sini).
 * Data peribadi: hanya pentadbir boleh melihat; JANGAN commit data staf sebenar ke repo.
 */
const StafHooks = {
  /** No. staf seragam: buang ruang, akhiran ".0" (import Excel) dan huruf besar. */
  norm: function (v) {
    return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').replace(/\.0+$/, '').toUpperCase();
  },

  /** Rekod staf aktif (state) mengikut No. Staf, atau null. */
  findByNo: function (noStaf) {
    const n = StafHooks.norm(noStaf);
    if (!n) return null;
    return Repo.of('STAF').findOne(function (r) { return r.state === RECORD_STATE.ACTIVE && StafHooks.norm(r.no_staf) === n; }) || null;
  },

  validate: function (data, info) {
    if (data.noStaf === undefined) return;
    const n = StafHooks.norm(data.noStaf);
    if (!/^[A-Z0-9\-\/]{1,20}$/.test(n)) throw Errors.validation('No. Staf tidak sah.', { noStaf: 'Huruf dan nombor sahaja.' });
    const dup = StafHooks.findByNo(n);
    if (dup && (!info.current || dup.id !== info.current.id)) throw Errors.conflict('No. Staf ' + n + ' sudah wujud (' + dup.nama + ').');
  },

  beforeSave: function (row) {
    if (row.no_staf !== undefined && row.no_staf !== '') row.no_staf = StafHooks.norm(row.no_staf);
  }
};
