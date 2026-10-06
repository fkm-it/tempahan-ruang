/**
 * seed-custom.js — Data demo SINTETIK untuk Sistem Tempahan Ruang (dev server & E2E sahaja).
 * Tiada data staf sebenar di sini (repo awam). Data sebenar diimport dalam produksi melalui importLegacyData().
 */
'use strict';

module.exports = function seedTempahan({ api, ok, sup }) {
  const admin = (action, payload) => ok(api({ action, token: sup.token, payload }));
  const create = (module, p) => admin('crud.create', Object.assign({ module }, p));
  const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  const ROOMS = [
    ['Dewan Kuliah 1 (E07)', 'E07', 'Dewan Kuliah', '1', 'E07 - 01.02.01', 150],
    ['Dewan Kuliah 2 (E07)', 'E07', 'Dewan Kuliah', '1', 'E07 - 01.03.01', 120],
    ['Bilik Kuliah 3 (E07)', 'E07', 'Bilik Kuliah', '3', 'E07 - 03.04.01', 60],
    ['Bilik Studio 1 (E07)', 'E07', 'Studio', '2', 'E07 - 02.10.01', 30],
    ['Dewan Kuliah 1 (C23)', 'C23', 'Dewan Kuliah', '1', 'C23 - 107-01', 200],
    ['Bilik Kuliah 1 (C24)', 'C24', 'Bilik Kuliah', '1', 'C24 - 108-01', 60],
    ['Makmal Komputer 1 (C24)', 'C24', 'Makmal Komputer', '2', 'C24 - 201-01', 40],
    ['Bilik Kuliah 5 (C25)', 'C25', 'Bilik Kuliah', '1', 'C25 - 105-01', 50]
  ];
  const rooms = ROOMS.map(([nama, blok, jenis, aras, kodRuang, kapasiti], i) => create('ruang', {
    nama, blok, jenis, aras, kodRuang, kapasiti, pic: i % 2 ? 'Encik Pegawai Fasiliti' : '', emelPic: i % 2 ? 'fasiliti@demo.local' : '', aktif: true
  }));
  create('ruang', { nama: 'Bilik Seminar Lama (C25)', blok: 'C25', jenis: 'Bilik Seminar', aras: '2', kapasiti: 25, aktif: false, catatan: 'Dalam pengubahsuaian' });

  const STAF = [['D1001', 'Ahmad bin Demo'], ['D1002', 'Siti binti Contoh'], ['D1003', 'Lim Ujian'], ['D1004', 'Kumar a/l Sampel'], ['D1005', 'Nurul binti Rekaan']];
  STAF.forEach(([noStaf, nama], i) => create('staf', { noStaf, nama, emel: 'staf' + (i + 1) + '@demo.local', aktif: true }));

  /* Dicipta oleh admin (masa lepas hari ini dibenarkan); borang awam diuji oleh E2E */
  const status = (id, s, note) => admin('crud.setStatus', { module: 'tempahan', id, status: s, note: note || '' });

  const B = [
    ['D1001', 0, 0, '08:00', '10:00', 'Kuliah SKMM 1013 Termodinamik', 'DILULUSKAN', 80],
    ['D1002', 0, 0, '14:00', '17:00', 'Bengkel penulisan tesis', 'MENUNGGU', 60],
    ['D1003', 1, 1, '09:00', '12:00', 'Peperiksaan ulangan', 'DILULUSKAN', 100],
    ['D1004', 4, 1, '08:00', '18:00', 'Seminar penyelidikan fakulti', 'DILULUSKAN', 180, 2],
    ['D1005', 6, 2, '10:00', '11:30', 'Mesyuarat kumpulan projek', 'MENUNGGU', 20],
    ['D1001', 5, 3, '13:00', '15:00', 'Kelas tambahan', 'DITOLAK', 25, 0, 'Ruang digunakan untuk peperiksaan.'],
    ['D1002', 3, 5, '20:00', '22:00', 'Latihan pembentangan', 'DILULUSKAN', 30],
    ['D1003', 2, 0, '16:00', '18:00', 'Taklimat pelajar baharu', 'MENUNGGU', 50]
  ];
  B.forEach(([noStaf, r, d, masaMula, masaTamat, tujuan, st, peserta, span, note]) => {
    const rec = create('tempahan', { noStaf, noTelefon: '012-345 6789', ruang: rooms[r].id, tarikh: day(d), tarikhTamat: span ? day(d + span) : '', masaMula, masaTamat, tujuan, bilanganPeserta: peserta });
    if (st !== 'MENUNGGU') status(rec.id, st, note);
  });
  console.log('Data demo tempahan: ' + rooms.length + ' ruang aktif, ' + STAF.length + ' staf sintetik (D1001–D1005), ' + B.length + ' tempahan.');
};
