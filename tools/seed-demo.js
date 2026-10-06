/**
 * seed-demo.js — Data contoh untuk dev server & E2E (BUKAN untuk produksi).
 * Dijana secara generik daripada modul yang wujud: setiap modul mendapat beberapa rekod contoh
 * menggunakan nilai palsu mengikut jenis medan (sunting SAMPLE untuk data yang lebih realistik).
 */
'use strict';
const SAMPLE = {
  string: ['Lampu bilik mesyuarat rosak', 'Penyaman udara tidak sejuk', 'Permohonan akses WiFi', 'Projektor tidak berfungsi'],
  text: ['Masalah berlaku sejak pagi tadi. Mohon tindakan segera.', 'Sila semak dan maklumkan tarikh pembaikan. Terima kasih.'],
  email: ['pemohon@demo.local'], phone: ['012-345 6789']
};

function sampleValue(f, i, nth) {
  const pad = (n) => String(n).padStart(2, '0');
  if (f.type === 'time') return pad(8 + 3 * i + (nth || 0)) + ':00'; /* medan masa ke-n: masa mula < masa tamat */
  if (f.type === 'date') return new Date(Date.now() + (i + (nth || 0)) * 86400000).toISOString().slice(0, 10);
  if (f.type === 'enum') return f.options[i % f.options.length].value || f.options[i % f.options.length];
  if (f.type === 'bool') return i % 2 === 0;
  if (f.type === 'int') return (i + 1) * 2;
  if (f.type === 'number') return (i + 1) * 12.5;
  if (f.type === 'category' || f.type === 'files') return undefined;
  const list = SAMPLE[f.type] || SAMPLE.string;
  let v = list[i % list.length];
  if (f.max && v.length > f.max) v = v.slice(0, f.max);
  return v;
}

module.exports = function seedDemo(ctx) {
  const api = ctx.api;
  const ok = (r) => { if (!r.success) throw new Error(r.code + ': ' + r.message); return r.data; };
  const reg = (fullName, email) => ok(api({ action: 'auth.register', payload: { fullName, email, password: 'Demo1234' } }));

  const sup = reg('Pentadbir Sistem', 'super@demo.local');
  const user = reg('Nur Aisyah binti Ahmad', 'user@demo.local');
  const others = ['Ahmad Faiz', 'Siti Hajar'].map((n, i) => reg(n, 'user' + i + '@demo.local'));

  const mods = ok(api({ action: 'crud.meta' }));
  const SecurityUtils = require('vm').runInContext('SecurityUtils', ctx);
  mods.forEach((m) => {
    const token = m.access.create === 'ADMIN' ? sup.token : user.token;
    const fields = m.fields.filter((f) => !f.adminOnly && !f.publicOnly);
    const values = (list, i) => {
      const p = {};
      const nth = {};
      list.forEach((f) => { nth[f.type] = (nth[f.type] || 0) + 1; const v = sampleValue(f, i, nth[f.type] - 1); if (v !== undefined) p[f.key] = v; });
      return p;
    };
    /* Data contoh generik mungkin melanggar peraturan hook domain — rekod itu dilangkau (sunting SAMPLE / fungsi ini jika perlu) */
    const tryOk = (r, what) => { if (r.success) return r.data; console.warn('⚠ seed ' + m.key + ' (' + what + ') dilangkau: ' + r.message); return null; };
    for (let i = 0; i < 3; i++) {
      const rec = tryOk(api({ action: 'crud.create', token: i === 2 && m.access.create !== 'ADMIN' ? others[0].token : token, payload: Object.assign({ module: m.key }, values(fields, i)) }), 'rekod ' + (i + 1));
      if (rec && i === 0 && m.statuses.length > 1) ok(api({ action: 'crud.setStatus', token: sup.token, payload: { module: m.key, id: rec.id, status: m.statuses[1].value, note: 'Sedang diuruskan oleh unit berkaitan.' } }));
    }
    if (m.publicForm) {
      const p = Object.assign({ module: m.key, formToken: SecurityUtils.signFormToken('crud:' + m.key, Date.now() - 5000) },
        values(m.fields.filter((f) => f.public !== false && !f.adminOnly), 4));
      tryOk(api({ action: 'crud.publicCreate', payload: p }), 'borang awam');
    }
  });
  ok(api({ action: 'public.feedback', payload: { name: 'Hasnah', email: 'hasnah@demo.local', message: 'Sistem yang sangat membantu. Boleh tambah eksport PDF?' } }));
  console.log('Data demo: super@demo.local / Demo1234 (SUPER_ADMIN), user@demo.local / Demo1234 (USER)');
  return { sup, user };
};
