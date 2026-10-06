# Rujukan Modul (`modules/*.json`)

Satu fail JSON = satu modul lengkap. Selepas mengubah JSON, jalankan `npm run gen`, kemudian `npm test`.

Apa yang dijana daripada satu modul:

- sheet dengan lajur (dicipta automatik selepas deploy)
- API: senarai, butiran, cipta, sunting, padam, status, lampiran, eksport, borang awam
- menu pengguna dan pentadbir
- paparan senarai, butiran dan borang
- kad dashboard dan carta admin
- pintasan app telefon
- notifikasi

## Contoh minimum

```json
{
  "key": "tempahan",
  "label": "Tempahan",
  "fields": [
    { "key": "tajuk", "label": "Tujuan", "type": "string", "required": true, "list": true, "search": true }
  ]
}
```

## Medan peringkat modul

| Kunci | Lalai | Keterangan |
|---|---|---|
| `key` | **wajib** | huruf kecil/nombor, 2–20 aksara. Nama fail mesti `<key>.json` |
| `name` | PascalCase(key) | Nama kod (`TempahanModule`, `TempahanHooks`) |
| `label` / `labelPlural` | name | Teks UI ("Tempahan") |
| `icon` | `list` | `home send list grid user users bell heart book pdf star settings shield chart activity database link clip mail lock inbox archive calendar clock feedback briefcase info sparkle` |
| `path` | `/<key>` | Laluan URL (`#/tempahan`, admin: `#/admin/tempahan`) |
| `sheet` | KEY | Nama sheet (HURUF_BESAR) |
| `prefix` | 2 huruf pertama | Awalan ID rekod (1–3 huruf). Dikhaskan: `U C A K N L S B E R` |
| `refFormat` | `<PREFIX>-{YYYY}-{SEQ4}` | No. rujukan manusia. Token: `{YYYY}` `{MM}` `{SEQ3..6}` (jujukan bermula semula setiap awalan) |
| `description` | — | Dipaparkan di kepala senarai, borang dan kad landing |
| `access.create` | `USER` | `PUBLIC` (borang awam + pengguna), `USER`, `ADMIN` |
| `access.list` | `OWN` | `OWN`: pengguna nampak rekod sendiri (admin nampak semua). `ALL`: semua pengguna log masuk nampak semua (cth. pengumuman, direktori) |
| `access.edit` / `access.delete` | `OWNER` | `OWNER` (pemilik + admin) atau `ADMIN` sahaja |
| `access.ownerEditStatuses` | `[]` | Pemilik hanya boleh sunting/padam semasa status ini (cth. `["BARU"]`). Kosong = sentiasa |
| `statuses` | `[]` | `[{ "value": "BARU", "label": "Baharu", "tone": "info" }]`. Tone: `info success warn danger muted brand` |
| `defaultStatus` | status pertama | Status rekod baharu |
| `statusRole` | `ADMIN` | Peranan minimum untuk menukar status (`USER` = sesiapa yang boleh melihat rekod) |
| `notify.adminsOnCreate` | `true` | Notifikasi (app + telefon) kepada semua admin + email `ADMIN_EMAIL` |
| `notify.ownerOnStatus` | `true` | Pemilik dimaklumkan apabila status berubah (app + telefon + email jika dihidupkan) |
| `titleField` | medan string pertama | Tajuk rekod dalam senarai/notifikasi |
| `subtitleField` | — | Sub-tajuk (cth. kategori) |
| `nav.user` / `nav.admin` | `true` | Papar dalam menu pengguna/admin |
| `nav.order` | `50` | Susunan menu (kecil dahulu). Modul pertama mengisi butang tengah navigasi telefon |
| `publicForm` | — | Hanya jika `access.create = PUBLIC`: `title`, `intro`, `successMessage`, `contactEmailField` (email untuk makluman status), `nameField` (nama pemohon dipaparkan kepada admin), `rateKeyField` (medan untuk had kadar per pemohon; lalai `contactEmailField`), `successLink` (`{ "href": "#/semak?ref={refNo}", "label": "Semak status" }`: butang pada halaman berjaya) |

## Medan (`fields[]`)

| Jenis | Input | Simpanan | Pilihan khusus |
|---|---|---|---|
| `string` | teks satu baris | teks | `min`, `max` (lalai 200) |
| `text` | textarea | teks | `min`, `max` (lalai 5000) |
| `email` | email | huruf kecil | — |
| `phone` | tel | teks | — |
| `int` | nombor bulat | int | `min`, `max` |
| `number` | perpuluhan | teks → nombor | `min`, `max`, `decimals` |
| `date` | tarikh | `YYYY-MM-DD` | — |
| `time` | masa | `HH:MM` | — |
| `bool` | kotak semak | TRUE/FALSE | — |
| `enum` | pilihan | nilai | `options: [{value,label}]` atau `["A","B"]` |
| `category` | pilihan kategori (Panel → Kategori) | ID kategori | Disembunyikan & diisi automatik jika hanya satu kategori aktif |
| `ref` | pilihan rekod modul lain (cth. ruang, peralatan) | ID rekod | `ref: "<key modul sasaran>"`. Pilihan = rekod aktif modul sasaran yang lulus hook `selectable` (atau `visible`); label = `titleField`, petunjuk = `subtitleField` sasaran. Boleh `filter`. Juga dalam borang awam |
| `files` | muat naik | bilangan (fail di Drive peribadi) | `maxFiles` (lalai 3). Jenis/saiz: Tetapan admin |

Pilihan umum setiap medan:

| Kunci | Kesan |
|---|---|
| `key` | camelCase (lajur sheet = snake_case automatik: `tarikhMula` → `tarikh_mula`) |
| `label`, `hint`, `placeholder` | Teks UI |
| `required` | Wajib semasa cipta; tidak boleh dikosongkan semasa sunting |
| `default` | Nilai lalai rekod baharu |
| `list` | Papar dalam baris senarai |
| `search` | Termasuk dalam carian teks |
| `filter` | Penapis dropdown (enum / category / bool sahaja) |
| `adminOnly` | Hanya admin boleh baca/tulis (cth. catatan dalaman). `visibleToOwner: true` membenarkan pemilik membaca sahaja |
| `publicOnly` | Hanya dalam borang awam (cth. nama/email pemohon tanpa akaun). Pengguna log masuk sudah dikenali |
| `public: false` | Tiada dalam borang awam (wajib untuk `files`) |
| `lockAfterCreate` | Pemilik tidak boleh mengubahnya selepas dicipta (admin boleh) |
| `readonly` | Tiada dalam borang; diisi oleh hook sahaja |

Lajur sistem setiap rekod: `id, ref_no, owner_user_id, owner_name, status, status_note, status_changed_at, status_changed_by, state (ACTIVE/DELETED), created_at, updated_at, deleted_at`.

## Hooks: logik khusus domain

`src/modules/<key>/<Name>Hooks.gs` dicipta sekali oleh `npm run gen` dan selamat disunting. Semua hook adalah pilihan.

| Hook | Bila | Kegunaan |
|---|---|---|
| `validate(data, {ctx, mode, current})` | Sebelum simpan (cipta/sunting/awam) | Peraturan perniagaan: lontar `Errors.validation(msg, {medan: msg})` atau `Errors.conflict(msg)` |
| `beforeSave(row, {ctx, mode, current})` | Sebelum simpan | Kira medan terbitan (lajur snake_case) |
| `afterCreate(row, ctx)` | Selepas cipta | Email pengesahan, notifikasi tambahan |
| `afterStatus(row, prevStatus, ctx)` | Selepas status berubah | Tindakan lanjut (cth. kemas kini stok) |
| `visible(row, ctx)` | Senarai bukan-admin | `false` = sembunyi (cth. pengumuman tamat) |
| `selectable(row)` | Pilihan medan `ref` modul lain | `false` = tidak boleh dipilih (cth. ruang tidak aktif) |
| `beforeStatus(row, newStatus, ctx)` | Sebelum status berubah | Lontar ralat untuk menghalang (cth. semak semula pertindihan semasa lulus) |
| `routes` | — | Laluan API khusus: `{ '<key>.nama': { role: 'PUBLIC'\|'USER'\|'ADMIN', fn: function (payload, ctx) {…} } }` — nama mesti berawalan key modul |
| `toDTO(dto, row, ctx)` | Sebelum dihantar ke frontend | Tambah medan kiraan |
| `maintenance()` | Harian (~02:00) | Auto-tutup rekod lama, peringatan |

### Contoh: tempahan tidak boleh bertindih

```js
const TempahanHooks = {
  validate: function (data, info) {
    const cur = info.current || {};
    const ruang = data.ruang || cur.ruang, tarikh = data.tarikh || cur.tarikh;
    const mula = data.masaMula || cur.masa_mula, tamat = data.masaTamat || cur.masa_tamat;
    if (!ruang || !tarikh || !mula || !tamat) return;
    if (mula >= tamat) throw Errors.validation('Masa tamat mesti selepas masa mula.', { masaTamat: 'Mesti selepas masa mula.' });
    const clash = CrudEngine.repo(CrudEngine.get('tempahan')).all().some(function (r) {
      return r.state === 'ACTIVE' && r.id !== cur.id && r.ruang === ruang && r.tarikh === tarikh &&
        ['DITOLAK', 'DIBATALKAN'].indexOf(r.status) < 0 && r.masa_mula < tamat && mula < r.masa_tamat;
    });
    if (clash) throw Errors.conflict('Ruang telah ditempah pada masa tersebut.');
  }
};
```

### Contoh: auto-tutup selepas 30 hari

```js
maintenance: function () {
  const cutoff = DateUtils.addDays(new Date(), -30).toISOString();
  const patch = {};
  CrudEngine.repo(CrudEngine.get('aduan')).all().forEach(function (r) {
    if (r.state === 'ACTIVE' && r.status === 'SELESAI' && r.updated_at < cutoff) patch[r.id] = { status: 'DITUTUP' };
  });
  return { closed: CrudEngine.repo(CrudEngine.get('aduan')).updateMany(patch) };
}
```

## Paparan tersuai (jika generik tidak mencukupi)

Cipta `src/frontend/modules/<key>.html` (akan dimasukkan oleh `npm run gen`) dan daftar paparan yang mahu diganti:

```html
<script>
(function (KD) {
  'use strict';
  const { html } = KD.utils;
  /* Ganti paparan senarai modul "tempahan" dengan kalendar — pembantu KD.crud.* boleh diguna semula */
  KD.views['crudList:tempahan'] = {
    async render(el) {
      const res = await KD.api.list('tempahan', { pageSize: 100 });
      el.innerHTML = html`<div class="page-head"><h1>Kalendar tempahan</h1></div>${res.items.map((d) => KD.crud.item(KD.moduleOf('tempahan'), d, null))}`.s;
    }
  };
})(window.KD);
</script>
```

Nama yang boleh diganti: `crudList:<key>`, `crudDetail:<key>`, `crudForm:<key>`.

Halaman baharu (cth. kalendar awam) & menu:

```js
KD.extraRoutes.push({ path: '/jadual', view: 'jadual', access: 'public', layout: 'public', title: 'Jadual' }); /* access: public | user | admin */
KD.extraNav.user.push(['/jadual', 'calendar', 'Jadual']);      /* juga KD.extraNav.admin */
KD.landingCards.push({ href: '/jadual', icon: 'calendar', title: 'Semak ketersediaan', text: '…' });
KD.views.jadual = { async render(el, params, query) { … } };
```

Borang (awam/dalaman) boleh diisi awal melalui query URL: `#/borang/tempahan?ruang=<id>&tarikh=2026-10-12`.

Data demo khusus: cipta `tools/seed-custom.js` (`module.exports = function ({ api, ok, sup, user, others, SecurityUtils }) {…}`) — menggantikan seed generik.

> Peraturan Apps Script: dalam `<script>` fail HTML, **jangan tulis `//`** (komen baris atau URL literal). Apps Script membuang teks selepasnya. Guna `/* … */`. Ini disemak oleh `npm run check`.

## Contoh modul lengkap

**Pinjaman peralatan** (stok, tarikh pulang, kelulusan):

```json
{
  "key": "pinjaman", "label": "Pinjaman", "icon": "briefcase", "refFormat": "PJM-{YYYY}-{SEQ4}",
  "description": "Mohon pinjaman peralatan AV dan jejak kelulusan.",
  "access": { "create": "USER", "list": "OWN", "edit": "OWNER", "delete": "OWNER", "ownerEditStatuses": ["DIMOHON"] },
  "statuses": [
    { "value": "DIMOHON", "label": "Dimohon", "tone": "info" },
    { "value": "DILULUS", "label": "Diluluskan", "tone": "success" },
    { "value": "DIPINJAM", "label": "Sedang dipinjam", "tone": "warn" },
    { "value": "DIPULANG", "label": "Dipulangkan", "tone": "muted" },
    { "value": "DITOLAK", "label": "Ditolak", "tone": "danger" }
  ],
  "titleField": "peralatan", "subtitleField": "tarikhPinjam",
  "fields": [
    { "key": "peralatan", "label": "Peralatan", "type": "enum", "required": true, "list": true, "filter": true,
      "options": ["Projektor", "Mikrofon wayarles", "Kamera", "Skrin mudah alih"] },
    { "key": "kuantiti", "label": "Kuantiti", "type": "int", "required": true, "min": 1, "max": 10, "default": 1 },
    { "key": "tarikhPinjam", "label": "Tarikh pinjam", "type": "date", "required": true, "list": true },
    { "key": "tarikhPulang", "label": "Tarikh pulang", "type": "date", "required": true },
    { "key": "tujuan", "label": "Tujuan", "type": "text", "required": true, "max": 500, "search": true },
    { "key": "catatanUnit", "label": "Catatan unit", "type": "text", "adminOnly": true, "visibleToOwner": true }
  ]
}
```

**Direktori kakitangan** (semua boleh lihat, admin sahaja urus):

```json
{
  "key": "direktori", "label": "Kakitangan", "labelPlural": "Direktori", "icon": "users",
  "access": { "create": "ADMIN", "list": "ALL", "edit": "ADMIN", "delete": "ADMIN" },
  "notify": { "adminsOnCreate": false, "ownerOnStatus": false },
  "fields": [
    { "key": "nama", "label": "Nama", "type": "string", "required": true, "list": true, "search": true },
    { "key": "jawatan", "label": "Jawatan", "type": "string", "list": true, "search": true },
    { "key": "unit", "label": "Unit", "type": "category", "filter": true, "list": true },
    { "key": "telefon", "label": "Sambungan", "type": "phone" },
    { "key": "email", "label": "Email", "type": "email" }
  ]
}
```
