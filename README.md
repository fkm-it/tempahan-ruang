# GAS PWA Starter

Templat untuk membina **sistem lengkap**: laman web, app telefon (PWA) dan panel pentadbir, di atas **Google Apps Script + Sheets + Drive**. Modul ditakrif dalam fail JSON, dan deploy berjalan automatik melalui GitHub Actions.

Teras templat ini diekstrak daripada sistem produksi *Kirim Doa*: auth, RBAC, migrasi, push FCM, PWA dan binaan GitHub Pages telah teruji di lapangan.

```
modules/aduan.json  ──npm run gen──▶  backend (Sheets, API, RBAC, aliran status, notifikasi)
                                      frontend (senarai, butiran, borang, borang awam, menu, dashboard)
git push main       ──GitHub Actions─▶ ujian → Apps Script (clasp) → GitHub Pages (web + PWA)
```

## Apa yang anda dapat tanpa menulis kod

| Bahagian | Butiran |
|---|---|
| Akaun | Daftar, log masuk, lupa kata laluan (kod email), profil, tukar kata laluan, kunci akaun, sesi boleh dibatalkan |
| Peranan | USER / ADMIN / SUPER_ADMIN, dikuatkuasa di pelayan |
| Modul (JSON) | Senarai + carian + penapis + cip status + pagination, butiran, borang cipta/sunting, eksport CSV, lampiran Drive, no. rujukan `ADU-2026-0001`, padam lembut + pulih |
| Aliran kerja | Status dengan warna, catatan status, siapa boleh tukar, pemilik dikunci selepas diproses |
| Borang awam | Tanpa log masuk, anti-bot (token HMAC + honeypot + had kadar), email status kepada pemohon |
| Notifikasi | Dalam app, telefon (FCM, dengan lencana pada ikon app) dan email (pilihan) |
| Pentadbir | Dashboard per modul, pengguna, kategori, hebahan, maklum balas, audit log, tetapan runtime, kesihatan sistem, sandaran harian |
| App telefon | PWA boleh dipasang (Android/iPhone), pintasan modul, halaman luar talian, ikon dijana mengikut warna jenama |
| Kualiti | 65 ujian backend (2 susunan muat), E2E pelayar generik + semakan telefon 360px, imbasan rahsia |

## Mula pantas

```bash
# 1. Cipta repo daripada templat ini (GitHub → "Use this template"), kemudian:
npm run init -- --name "Sistem Tempahan Dewan" --short "Tempahan" --tagline "Tempah dewan dengan mudah" --color "#0F766E"

# 2. Takrif modul (atau sunting modules/aduan.json sedia ada)
npm run new -- tempahan "Tempahan"     # cipta modules/tempahan.json
npm run gen                            # jana kod daripada JSON

# 3. Uji & lihat
npm test                               # ujian backend
npm run dev                            # http://localhost:8080  (super@demo.local / Demo1234)
npm run e2e                            # E2E pelayar (dev server mesti berjalan)

# 4. Deploy: sediakan SEKALI (DEPLOYMENT.md), kemudian setiap `git push` ke main dideploy automatik.
```

## Arahan

| Arahan | Fungsi |
|---|---|
| `npm run init -- --name … --color …` | Jenamakan sistem (nama, slogan, warna, ikon PWA) |
| `npm run new -- <key> "<Label>"` | Cipta templat JSON modul baharu |
| `npm run gen` | Jana modul daripada `modules/*.json` (`--check` dalam CI) |
| `npm test` | Semak modul terkini + ujian backend (susunan muat abjad & terbalik) |
| `npm run check` | Sintaks frontend, kebocoran API server, risiko XSS, imbasan rahsia |
| `npm run dev` | Dev server dengan backend sebenar atas mock Google + data demo |
| `npm run e2e` | Ujian E2E Playwright generik (membaca modul anda) |
| `npm run build:web` | Binaan GitHub Pages (`web/`) |
| `npm run push` | Ujian, kemudian `clasp push` (manual, tanpa CI) |

## Dokumentasi

- [CLAUDE.md](CLAUDE.md): aliran kerja untuk Claude (dan manusia) apabila membina sistem baharu daripada penerangan atau mockup
- [docs/MODULES.md](docs/MODULES.md): rujukan penuh JSON modul, hooks dan contoh (tempahan, pinjaman, pendaftaran)
- [DEPLOYMENT.md](DEPLOYMENT.md): persediaan sekali sahaja, CI/CD, Firebase, penyelesaian masalah
- [SECURITY.md](SECURITY.md): model ancaman, kawalan, senarai semak operasi
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): seni bina, aliran data, had GAS

## Struktur

```
modules/            ← takrifan modul (JSON) — SATU-SATUNYA tempat untuk menambah/ubah modul
src/
  Code.gs           doGet / doPost / api + fungsi operasi pemilik (setupDatabase, installTriggers, …)
  config/           Config (nama, versi, had), Constants, Environment (Script Properties), DeployInfo (CI)
  controllers/      Router (RBAC, satu pintu API) + pengawal nipis
  modules/          CrudEngine (enjin generik) + <key>/<Name>Module.gs (dijana) + <Name>Hooks.gs (logik anda)
  services/         Auth, User, Notification, Push (FCM), Settings, Security, Drive, Dashboard, System
  repositories/     Akses Sheets (kunci, cache permintaan, auto-tambah lajur)
  database/         Schema → SheetManager, Migration (+ autoRun selepas deploy), SeedData
  frontend/         SPA vanilla JS: css/ (tokens jenama), js/ (app, api, ui, crud, pwa), views/
  tests/            Ujian (berjalan dalam Node DAN Apps Script)
pwa/                bridge.js, sw.js, manifest, ikon, offline.html, config.js (nilai awam)
tools/              gen, init, build-web, dev-server, run-tests, e2e, scan-secrets, check-frontend
.github/workflows/  ci.yml (ujian + E2E) · deploy.yml (Apps Script + GitHub Pages)
```
