# CLAUDE.md: cara membina sistem dengan templat ini

Pengguna (Za) biasanya hanya memberi **penerangan atau mockup**, contohnya "Saya nak sistem tempahan dewan" berserta gambar. Tugas anda ialah menyerahkan sistem lengkap yang **telah diuji** dan dideploy, dengan campur tangan manusia yang minimum. Berkomunikasi dalam Bahasa Melayu santai. Jawapan ringkas; jangan menceritakan setiap langkah.

## Aliran kerja

1. **Fahami.** Daripada penerangan atau mockup, senaraikan:
   - entiti (setiap satu menjadi modul)
   - medan
   - status dan siapa yang boleh menukarnya
   - siapa boleh mencipta: awam, pengguna atau admin
   - siapa boleh melihat: sendiri atau semua
   - peraturan perniagaan, seperti pertindihan, had dan tarikh

   Tanya **sekali sahaja** (AskUserQuestion) jika ada keputusan yang mahal untuk diubah kemudian. Selainnya, pilih lalai yang munasabah dan nyatakannya.
2. **Jenamakan.** Jalankan `npm run init -- --name "…" --short "…" --tagline "…" --color "#……"`. Ambil warna daripada mockup jika ada, dan pastikan kontras teks putih ≥ 4.5:1 (init akan memberi amaran).
3. **Modul.** Buang contoh yang tidak berkaitan (`modules/aduan.json`, `modules/pengumuman.json` dan folder `src/modules/<key>/` masing-masing), kemudian tulis `modules/<key>.json` mengikut [docs/MODULES.md](docs/MODULES.md). Jalankan `npm run gen`.
4. **Logik domain.** Letakkan dalam `src/modules/<key>/<Name>Hooks.gs` (validate, beforeSave, afterCreate, afterStatus, visible, toDTO, maintenance). **Jangan ubah `CrudEngine.gs`** untuk keperluan satu modul. Jika enjin benar-benar perlu ciri baharu, tambah secara generik dan sertakan ujian dalam `src/tests/TestModules.gs`.
5. **Kategori lalai.** Ubah `SeedData.CATEGORIES` jika domain memerlukannya (cth. jenis ruang, unit). Jika hanya satu kategori aktif, medan kategori disembunyikan.
6. **Paparan tersuai.** Hanya buat jika mockup memerlukan sesuatu yang tidak dapat dihasilkan secara generik (kalendar, papan Kanban, cetakan). Gunakan `src/frontend/modules/<key>.html` (lihat MODULES.md) dan guna semula `KD.crud.*` serta `KD.ui.*`.
7. **Ujian.** Tambah ujian untuk setiap hook atau peraturan perniagaan dalam `src/tests/AppTests.gs` (`const AppTests = { suites: () => [TestSuiteX] }`; dijalankan oleh `npm test` dan `runTestsPart5`). Nilai medan khusus untuk E2E (cth. No. Staf demo) dalam `tools/e2e-values.json`. Kemudian jalankan:
   - `npm test`: mesti 0 gagal dalam kedua-dua susunan muat
   - `npm run check`
   - `npm run dev` dalam latar, kemudian `npm run e2e`: semakan telefon 360px termasuk
   - lihat sendiri tangkapan skrin dalam `e2e-shots/`
8. **Versi.** Naikkan `CONFIG.VERSION` dan `package.json`, kemudian kemas kini `CHANGELOG.md`.
9. **Serah.**
   - Jika repo GitHub disambungkan: commit dan push ke `main`. `deploy.yml` akan menguji, menjalankan `clasp push`, mengemas kini deployment (URL kekal) dan menerbitkan GitHub Pages. Pantau status Actions, kemudian sahkan URL live.
   - Jika repo tidak disambungkan: hantar zip beserta langkah ringkas.
   - Langkah manual sekali sahaja ada dalam [DEPLOYMENT.md](DEPLOYMENT.md) §1. Ingatkan pengguna hanya jika belum dibuat.

## Peraturan wajib (pepijat sebenar yang pernah berlaku)

- **Apps Script membuang teks selepas `//` dalam `<script>` HTML**, termasuk dalam string. Guna komen `/* */`, dan bina URL dengan `'https:' + '\/\/…'`. `npm run check` mengesan perkara ini.
- **Tiada rujukan silang semasa fail dimuat.** Semua `.gs` berkongsi satu skop global dengan susunan muat yang tidak dijamin. Jangan rujuk `CONFIG`, `SCHEMA` atau objek lain di peringkat atas fail; rujuk di dalam fungsi sahaja. Ujian dijalankan dalam dua susunan untuk membuktikannya.
- `HtmlService.addMetaTag` hanya menerima `viewport`, `apple-mobile-web-app-capable`, `mobile-web-app-capable` dan `google-site-verification`.
- Semua HTML dinamik mesti melalui `html\`…\`` (auto-escape). Jangan sambung string ke `innerHTML`.
- Validasi berasaskan skema di pelayan. Medan yang tidak diisytihar dibuang. Semakan pemilikan dibuat di pelayan dan memulangkan NOT_FOUND seragam (IDOR).
- **Rahsia** (`FCM_SERVICE_ACCOUNT`, `AUTH_PEPPER`, `FORM_SECRET`, `.clasprc.json`) tidak boleh berada dalam repo atau `pwa/`. Simpan dalam Script Properties atau GitHub Secrets. `tools/scan-secrets.js` menggagalkan CI jika rahsia dikesan.
- **Jangan padam** Script Properties `AUTH_PEPPER`, `FORM_SECRET` atau `SPREADSHEET_ID`. Jika `AUTH_PEPPER` hilang, semua kata laluan tidak lagi sah.
- Perubahan skema tidak memerlukan langkah manual. `Migration.autoRun()` dijalankan pada permintaan pertama selepas deploy, dan repository menambah lajur atau sheet yang hilang secara automatik. Migrasi data perlu ditambah sebagai `MIGRATION_00N` (idempoten) dalam `Migration.gs`.
- Paparan telefon mesti diuji pada 360px tanpa skrol mendatar. Butang dalam modal tidak boleh terpotong.
- PWA: pasang melalui **Chrome** (Android) atau **Safari** (iPhone). Pemasangan melalui Brave atau pelayar lain hanya mencipta pintasan, dan lencana ikon tidak berfungsi.

## Rujukan pantas

- Tambah laluan API khusus: tambah ke `Router.table()` (isytiharkan peranan) dan pengawal nipis dalam `Controllers.gs`. Logik diletakkan dalam service.
- Tetapan yang boleh diubah admin: `SETTINGS_DEFS` (`src/models/SettingModel.gs`).
- Notifikasi: `NotificationService.notify(userId, NOTIF_TYPE.X, title, message, refId, '#/path')` menghantar notifikasi dalam app, ke telefon (jika jenis dalam `PushService.PUSH_TYPES`) dan memaparkan lencana. Email: `NotificationService.email(to, subject, lines, {path})` (ikut tetapan `NOTIFY_EMAIL_ENABLED`).
- Fungsi operasi pemilik (jalankan dari editor Apps Script): `setupDatabase`, `installTriggers`, `importFcmKeyFromDrive`, `testPushConfig`, `healthCheck`, `runBackup`, `runTestsPart1..5`, `promoteBootstrapAdmin`.

## Definisi siap

- [ ] `npm test`, `npm run check` dan `npm run e2e` lulus
- [ ] Tangkapan skrin telefon telah disemak sendiri
- [ ] Mockup dipadankan: medan, label, aliran dan warna
- [ ] Peraturan perniagaan diuji
- [ ] VERSION dan CHANGELOG dikemas kini
- [ ] Dideploy, dan URL live disahkan (log masuk, cipta rekod, tukar status, notifikasi)
- [ ] Pengguna diberitahu apa yang perlu dibuat secara manual (jika ada) dalam satu senarai pendek
