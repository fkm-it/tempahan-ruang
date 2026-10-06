# Seni Bina

## 1. Gambaran

```
 Pelayar / App PWA (GitHub Pages)                 Google Apps Script (Execute as: Me)                Google
┌──────────────────────────────┐   fetch POST    ┌──────────────────────────────────────────┐     ┌──────────────┐
│ index.html + assets (CSP)    │  text/plain,    │ doPost → Router.dispatch                  │     │ Sheets (DB)  │
│ KD.api ─ bridge.js ──────────┼─ tanpa cookie ─▶│   ├ Migration.autoRun (selepas deploy)    │────▶│ Drive (fail, │
│ sw.js (cache aset, push)     │                 │   ├ sesi → RBAC → mod penyelenggaraan     │     │  sandaran)   │
│ Firebase SDK (token peranti) │                 │   └ Controller → Service → Repository     │     │ MailApp      │
└──────────────────────────────┘                 │ CrudEngine ◀── ModuleRegistry ◀── modules/*.json  │ FCM v1       │
         ▲ notifikasi telefon ◀──────────────────┤ PushService (JWT RS256 → OAuth → FCM)     │────▶└──────────────┘
                                                 └──────────────────────────────────────────┘
```

- **Satu pintu API:** `doPost`/`api()` → `Router.dispatch`. Setiap laluan mengisytiharkan peranan minimum, dan ralat diseragamkan (pengguna menerima mesej generik dengan `errorId`).
- **Enjin modul:** semua modul berkongsi satu pelaksanaan (`CrudEngine`). Kod per modul hanyalah definisi (dijana daripada JSON) dan hooks pilihan.
- **Frontend:** SPA vanilla JS dipacu metadata (`crud.meta`). Laluan, menu, borang dan senarai dijana pada masa larian. Frontend yang sama dihidangkan oleh `doGet` (iframe GAS) dan GitHub Pages (`build-web.js` + `bridge.js`).

## 2. Lapisan backend

| Lapisan | Fail | Tanggungjawab |
|---|---|---|
| Titik masuk | `Code.gs` | `doGet`, `doPost`, `api`, fungsi operasi pemilik (`requireOwner_`) |
| Router | `controllers/Router.gs` | Bentuk permintaan, saiz, sesi, RBAC, mod penyelenggaraan, autoRun migrasi |
| Pengawal | `controllers/Controllers.gs` | Nipis: payload → service |
| Modul | `modules/CrudEngine.gs` | CRUD, validasi medan, kebenaran, status, lampiran, borang awam, notifikasi, statistik |
| Servis | `services/*` | Auth, User, Notification, Push, Settings, Security (had kadar, idempoten, fail), Drive, Dashboard, System |
| Repository | `repositories/RepositoryBase.gs` | Lajur ikut nama header, cache permintaan, tulis berkelompok di bawah `LockService`, auto-tambah lajur/sheet |
| Pangkalan data | `database/*` | `SheetManager.ensure` (header, format teks, lindung), `Migration` (berversi, idempoten), `SeedData` |

## 3. Data

Sheet teras:

- `USERS`
- `CREDENTIALS` (tersembunyi, dilindungi)
- `SESSIONS` (hash token)
- `CATEGORIES`
- `ATTACHMENTS` (semua modul)
- `PUSH_TOKENS`
- `NOTIFICATIONS`
- `AUDIT_LOGS`
- `SETTINGS`
- `SYSTEM_LOGS`
- `FEEDBACK`
- `MIGRATIONS`

Satu sheet bagi setiap modul, dengan lajur sistem `id, ref_no, owner_user_id, owner_name, …medan…, status, status_note, status_changed_at, status_changed_by, state, created_at, updated_at, deleted_at`.

Semua sel disimpan sebagai teks. Nilai yang bermula dengan `= + - @` dilarikan (formula injection). ID ialah rawak 64-bit (`AD-7F3A…`), tidak bergantung pada nombor baris. No. rujukan manusia (`ADU-2026-0001`) dijana di bawah kunci.

## 4. Kitaran hayat perubahan

```
modules/x.json ─ npm run gen ─▶ XModule.gs + blok Schema.gs + migrasi MODULE_X_<hash>
git push main ─ CI ─▶ clasp push ─▶ update-deployment ─▶ permintaan pertama: Migration.autoRun()
                                                          └─ SheetManager.ensure: cipta sheet / tambah lajur (data sedia ada tidak disentuh)
```

## 5. Had Google Apps Script & mitigasi

| Had | Kesan | Mitigasi |
|---|---|---|
| 6 minit / eksekusi | Ujian dalam editor | Ujian dipecah kepada `runTestsPart1..4` |
| ~30 permintaan serentak | Trafik puncak | Cache permintaan, tulis berkelompok, `BUSY` dengan cubaan semula UI |
| Sheets ~10 juta sel | Volum data | Sesuai untuk ≤ ~50k rekod setiap modul. Jika lebih, arkib tahunan (hook `maintenance`) atau berpindah ke Supabase/PostgreSQL |
| MailApp 100/1,500 sehari | Email | Email adalah pilihan; notifikasi dalam app dan telefon tiada had praktikal |
| UrlFetch 20k/hari | Push FCM | Satu panggilan bagi setiap peranti (fetchAll), token akses dicache |
| Tiada IP klien | Had kadar | Had per-email, per-pengguna dan global |
| Execute as: Me | Pemilik data tunggal | 2FA pada akaun pemilik; data tidak dikongsi |
