# CHANGELOG

## 1.2.0 — 2026-10-06
- Isolat sejuk memuat semua data teras dalam satu perjalanan pangkalan data; panggilan pekerja dipaksa ke wilayah Singapura (`x-region`).
- Data dipindahkan (pindahKeSupabase); laman web kini memanggil Supabase terus (`backend.json` webUsesEdge).
- **Backend berpindah ke Supabase** (Postgres, Singapura) untuk kelajuan & kebolehpercayaan. Kod Apps Script yang SAMA dijalankan dalam Supabase Edge Function (`supabase/functions/api`): `tools/build-edge.js` menghimpun `src/**/*.gs` menjadi satu modul; `runtime.mjs` membekalkan SpreadsheetApp/CacheService/PropertiesService/MailApp di atas Postgres. Semua 86 ujian GAS lulus dalam himpunan itu.
- Konkurensi optimistik (versi setiap sheet + kunci nasihat): dua tempahan serentak untuk slot sama → hanya satu berjaya (diuji). Idempotensi `meta.rid` disimpan dalam transaksi yang sama dengan tulisan.
- Apps Script kini **pekerja**: `workerTick` (setiap minit) menghantar email yang dibaris gilir, mencetus penyelenggaraan (peringatan, auto-selesai), dan membuat sandaran harian ke Google Sheets. Pelayan "mengejut" pekerja selepas setiap tindakan yang menghasilkan email.
- `pindahKeSupabase()` (sekali, dari editor): pindah semua data + Script Properties (kata laluan kekal sah). Sebelum itu, pelayan Supabase meneruskan permintaan ke Apps Script; selepas itu, URL `/exec` lama meneruskan ke Supabase.
- CI: ujian himpunan Edge, ujian integrasi Postgres, deploy fungsi (`SUPABASE_ACCESS_TOKEN`).

## 1.1.5 — 2026-10-06
- **Mod `/exec` (dihos terus oleh Apps Script) dibaiki.** HtmlService merosakkan satu komen dalam `ui.html` (komen dengan `/*` bersarang) → `SyntaxError` dan app tidak dimuat. Kini `tools/build-gas.js` membuang semua komen daripada skrip frontend sebelum `clasp push` (CI menolak `build/gas`), dan `npm run check` melarang `/*` bersarang dalam komen.
- Web GitHub Pages juga dihantar tanpa komen skrip (muatan lebih kecil).

## 1.1.4 — 2026-10-06
- Sambungan tersangkut dicuba semula lebih awal: had masa setiap cubaan 15 s → 25 s → 40 s → 60 s (sebelum ini 40 s sekali), sehingga 4 cubaan. Selamat kerana pelayan idempoten.


## 1.1.3 — 2026-10-06
- **Idempotensi semua tindakan** (`meta.rid`): Google kadangkala tidak menghantar jawapan walaupun skrip telah siap (HTTP 404 pada URL `…/echo`, atau tamat masa). Klien kini mencuba semula SEMUA tindakan (termasuk hantar tempahan, lulus, batal) dengan ID permintaan yang sama; pelayan memulangkan jawapan asal tanpa menjalankan tindakan dua kali.


## 1.1.2 — 2026-10-06
- Log masuk turut dicuba semula automatik jika sambungan gagal.
- Mesej "Sambungan ke pelayan gagal" kini menyertakan punca ringkas (cth. `HTTP 500`, `bukan JSON`, `tamat masa`, `Failed to fetch`) untuk diagnosis.


## 1.1.1 — 2026-10-06
Prestasi & kebolehpercayaan.
- App dibuka dengan **satu** panggilan pelayan (`public.bootstrap`, sebelum ini dua), dan lawatan seterusnya dipapar serta-merta daripada salinan simpanan pelayar (dikemas kini di latar).
- Kalendar & papan paparan **dicache di pelayan**; cache dibatalkan serta-merta apabila tempahan/ruang berubah (versi data per sheet).
- Permintaan baca **dicuba semula automatik** (2 kali) jika sambungan ke Apps Script gagal; had masa permintaan biasa 45 saat (bukan 120).


## 1.1.0 — 2026-10-06
Ciri sistem lama yang diputuskan untuk dikekalkan (hasil tally sistem lama vs baharu).
- **Slip tempahan**: cetak / simpan PDF dari "Semak / batal" (pemohon) dan halaman butiran tempahan (admin), untuk tempahan Diluluskan/Selesai.
- **Bahasa Inggeris**: butang BM/EN di halaman awam (landing, borang, kalendar, semak, slip, papan); bahasa pemohon disimpan dan semua emel kepada pemohon dihantar dalam bahasa itu. Panel admin kekal BM.
- **Peringatan beberapa jam sebelum** slot bermula (setiap hari bagi tempahan berbilang hari), selain peringatan sehari sebelum. Tetapan `PERINGATAN_JAM` (lalai 2; 0 = tutup). Pencetus setiap jam dipasang automatik selepas deploy.
- **Papan paparan** `#/papan` untuk TV/lobi: tempahan diluluskan hari ini (sedang berlangsung & seterusnya), jam, kemas kini setiap minit, penapis `?blok=E07`. Tujuan dipapar (tetapan `PAPAN_TUNJUK_TUJUAN`), nama pemohon tidak pernah dipapar.
- Landing: butang utama "Mohon tempahan" & "Kalendar" (pemohon tidak perlu log masuk).
- Import data lama: lajur Bahasa dan Peringatan Jam Dihantar kini dipetakan.


## 1.0.0 — 2026-10-06 · Sistem Tempahan Ruang & Fasiliti FKM
Dibina semula di atas templat `gas-pwa-starter` 0.2.0 (menggantikan sistem lama berasaskan spreadsheet).

- **Borang tempahan awam tanpa akaun**: pemohon isi No. Staf; nama & emel diambil daripada senarai staf (tidak boleh dipalsukan). No. rujukan `TP-YYYY-NNNN`.
- **Peraturan**: tiada pertindihan masa (disemak semula semasa lulus), peserta ≤ kapasiti, tarikh tidak lepas, waktu 07:00–23:00, maksimum 14 hari berturut, sehingga 365 hari ke hadapan.
- **Aliran**: Menunggu → Diluluskan / Ditolak (sebab) / Dibatalkan → Selesai (automatik). Permohonan yang tidak diproses sebelum tarikhnya dibatalkan automatik.
- **Emel**: pengesahan permohonan, keputusan (lulus/tolak/batal), PIC ruang dimaklumkan apabila diluluskan/dibatalkan, peringatan sehari sebelum.
- **Kalendar ketersediaan** awam & admin: ikut tarikh (semua ruang, dikumpul ikut blok) atau ikut ruang (14 hari); klik slot kosong untuk borang yang diisi awal. Data peribadi tidak dipaparkan kepada awam.
- **Semak / batal** oleh pemohon dengan No. Rujukan + No. Staf (+ emel untuk batal).
- Modul **Ruang** dan **Senarai Staf** (admin sahaja).
- **`importLegacyData()`**: import Ruang, Staf dan Tempahan daripada spreadsheet lama (idempoten).
- Pendaftaran akaun ditutup secara lalai (hanya pentadbir); emel notifikasi dihidupkan secara lalai.

### Penambahbaikan generik (juga dipindahkan ke templat)
- Pendaftaran Super Admin pertama dibenarkan walaupun pendaftaran ditutup (`SETUP_PENDING`); pautan "Daftar" disembunyikan apabila ditutup.
- Warna jenama dalam emel (`CONFIG.BRAND_COLOR`, diset oleh `npm run init`).
- Suite ujian domain projek (`AppTests` → `runTestsPart5`); seed demo & E2E menyokong pendaftaran ditutup; `tools/e2e-values.json`; E2E menyemak halaman awam tersuai pada 360px.
- `publicForm.successLink`; menu Kategori disembunyikan jika tiada modul menggunakan medan kategori; nama pendek pada pengepala awam telefon.


## 0.2.0 — 2026-10-06
- Jenis medan **`ref`** (rujuk rekod modul lain, cth. ruang/peralatan): pilihan dalam borang dalaman & awam, label, penapis, validasi (hook `selectable`).
- Hook **`beforeStatus`** (halang perubahan status — cth. semak semula pertindihan semasa lulus) dan **`routes`** (laluan API khusus modul tanpa mengubah Router).
- `publicForm.rateKeyField` — had kadar borang awam per pemohon.
- Frontend: `KD.extraRoutes`, `KD.extraNav`, `KD.landingCards` untuk halaman tersuai; borang diisi awal daripada query URL.
- Data demo khusus melalui `tools/seed-custom.js`.

## 0.1.1 — 2026-10-06
- Storan pelayar (sesi, token push, pilihan) diasingkan mengikut `APP_SLUG` — beberapa sistem boleh dihoskan di bawah `<org>.github.io` yang sama tanpa sesi bertindih.
- DEPLOYMENT.md §0: pilihan hosting (organisasi, repo, domain sendiri).

## 0.1.0 — 2026-10-05
Versi pertama templat, diekstrak daripada Kirim Doa 1.6.1.

- **Enjin modul generik** (`CrudEngine`): modul ditakrif dalam `modules/*.json`; CRUD, aliran status, borang awam, lampiran Drive, no. rujukan, eksport CSV, notifikasi (app/telefon/email), hooks domain.
- **Penjana** `npm run gen` / `npm run new` dengan validasi JSON yang menerangkan kesilapan; `--check` untuk CI.
- **Jenama** `npm run init`: nama, slogan, warna (palet + semakan kontras), ikon PWA dijana tanpa kebergantungan.
- **Frontend dipacu metadata**: laluan, menu, navigasi telefon, dashboard, senarai/butiran/borang dijana pada masa larian; paparan tersuai pilihan per modul.
- **Migrasi automatik selepas deploy** (`Migration.autoRun`).
- **CI/CD GitHub Actions**: ujian (2 susunan muat) + E2E generik + semakan telefon 360px → `clasp push` + `update-deployment` → GitHub Pages; `DeployInfo.gs` (URL awam, commit).
- **Imbasan rahsia** (`tools/scan-secrets.js`).
- Teras dikekalkan daripada Kirim Doa: auth PBKDF2+pepper, sesi, RBAC, audit, tetapan runtime, kesihatan sistem, sandaran harian, push FCM v1 + lencana ikon, PWA + pasang, binaan GitHub Pages dengan CSP ketat.
