# CHANGELOG

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
