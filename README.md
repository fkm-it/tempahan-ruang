# Sistem Tempahan Ruang & Fasiliti FKM

Tempahan ruang kuliah, makmal dan studio Fakulti Kejuruteraan Mekanikal, UTM. Laman web + app telefon (PWA) + panel pentadbir di atas **Google Apps Script + Sheets**, dibina daripada templat [`gas-pwa-starter`](https://github.com/kirimdoa/gas-pwa-starter).

## Siapa buat apa

| Peranan | Boleh |
|---|---|
| Staf FKM (tanpa akaun) | Lihat kalendar ketersediaan · mohon tempahan dengan No. Staf · semak status / batal dengan No. Rujukan |
| Pentadbir | Lulus / tolak / batal tempahan · urus Ruang & Senarai Staf · kalendar dengan butiran pemohon · eksport CSV · tetapan |

## Peraturan tempahan
- No. Staf mesti ada dalam **Senarai Staf** (aktif). Nama & emel diambil dari situ.
- Tiada pertindihan masa pada ruang yang sama (Menunggu/Diluluskan); disemak semula semasa admin lulus.
- Waktu 07:00–23:00, tarikh tidak lepas, maksimum 14 hari berturut (slot masa sama setiap hari), peserta ≤ kapasiti ruang.
- Status: **Menunggu → Diluluskan / Ditolak / Dibatalkan → Selesai** (automatik selepas tarikh tamat). Permohonan yang belum diproses apabila tarikhnya tiba dibatalkan automatik.
- Emel: pengesahan, keputusan, PIC ruang (lulus/batal), peringatan sehari sebelum.

Logik domain: `src/modules/tempahan/TempahanHooks.gs`. Paparan kalendar & semak: `src/frontend/modules/tempahan.html`. Ujian: `src/tests/AppTests.gs`.

## Pembangunan

```bash
npm test          # ujian backend (2 susunan muat)
npm run check     # sintaks frontend, XSS, rahsia
npm run dev       # http://localhost:8080  (super@demo.local / Demo1234; staf demo D1001–D1005)
npm run e2e       # E2E pelayar (dev server mesti berjalan)
```

Setiap `git push` ke `main` → ujian → Apps Script → GitHub Pages (lihat [DEPLOYMENT.md](DEPLOYMENT.md)).

## Import data sistem lama
1. Script Properties → `LEGACY_SPREADSHEET_ID` = ID spreadsheet lama.
2. Editor Apps Script → jalankan **importLegacyData**. Selamat diulang (rekod sedia ada dilangkau).

> **Data staf ialah data peribadi.** Jangan letak dalam repo ini (repo awam). Ia hanya disimpan dalam spreadsheet sistem.

Dokumentasi templat: [CLAUDE.md](CLAUDE.md) · [docs/MODULES.md](docs/MODULES.md) · [SECURITY.md](SECURITY.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
