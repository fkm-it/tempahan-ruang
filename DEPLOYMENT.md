# DEPLOYMENT

Selepas persediaan **sekali sahaja** di bawah (±20 minit setiap sistem), setiap `git push` ke `main` akan menjalankan perkara berikut secara automatik:

1. ujian, semakan dan E2E
2. `clasp push`
3. kemas kini deployment Web App (URL `/exec` kekal sama)
4. binaan dan penerbitan GitHub Pages (web + PWA)
5. migrasi pangkalan data pada permintaan pertama

## 0. Di mana sistem dihoskan?

Tidak perlu akaun GitHub baharu. Satu akaun boleh memiliki banyak **organisasi** (percuma), dan setiap sistem ialah satu repo:

| Pilihan | URL | Bila |
|---|---|---|
| Repo dalam organisasi sedia ada | `https://<org>.github.io/<repo>/` (cth. `kirimdoa.github.io/tempahan-ruang/`) | Paling mudah |
| Organisasi baharu untuk satu kumpulan sistem | `https://fkm-it.github.io/tempahan-ruang/` | Jenama sesuai (cth. semua sistem FKM) |
| Repo `<org>.github.io` | `https://<org>.github.io/` (URL terpendek) | Satu sistem utama setiap organisasi |
| Domain sendiri | `https://tempahan.contoh.my/` | Perlu akses DNS (`PUBLIC_BASE_URL` + fail CNAME) |

Sistem di bawah origin yang sama (`<org>.github.io`) berkongsi storan pelayar. Templat ini mengasingkan storan mengikut `APP_SLUG` supaya sesi tidak bertindih, tetapi untuk data sensitif sebaiknya guna organisasi atau domain berasingan.

## 1. Persediaan sekali sahaja

Langkah di bawah memerlukan manusia, kerana Google dan GitHub mewajibkan persetujuan pemilik akaun.

### 1.1 Akaun Google (sekali untuk SEMUA sistem)
1. Hidupkan Apps Script API: <https://script.google.com/home/usersettings> → **Google Apps Script API: On**.
2. Di PC anda, dalam folder projek:
   ```bash
   npx @google/clasp@3 login
   ```
   Fail `~/.clasprc.json` (Windows: `C:\Users\<nama>\.clasprc.json`) dicipta. **Ini rahsia.** Kandungannya disalin ke GitHub Secret pada langkah 1.4, dan tidak boleh dicommit. Fail yang sama boleh digunakan untuk semua sistem anda.

### 1.2 Projek Apps Script
```bash
npx @google/clasp@3 create-script --type webapp --title "Nama Sistem" --rootDir src
npx @google/clasp@3 push --force
```
`.clasp.json` mengandungi **Script ID** (atau lihat editor → ⚙ Project Settings → Script ID).

### 1.3 Pangkalan data & deployment pertama
1. `npx @google/clasp@3 open-script`, kemudian **Project Settings → Script Properties**, dan tambah `BOOTSTRAP_SUPER_ADMIN_EMAIL` = email anda.
2. Dalam editor, pilih `Code.gs` → **setupDatabase** → **Run**, kemudian benarkan kebenaran OAuth. Langkah ini mencipta spreadsheet, folder Drive peribadi, `AUTH_PEPPER` dan `FORM_SECRET`.
   > ⚠ **Sandarkan nilai `AUTH_PEPPER`** (Script Properties) dalam pengurus kata laluan. Jika hilang, semua kata laluan tidak lagi sah.
3. Jalankan **installTriggers** sekali (penyelenggaraan dan sandaran harian ~02:00).
4. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Salin **Deployment ID** (`AKfy…`). URL Web App ialah `https://script.google.com/macros/s/<ID>/exec`.

### 1.4 GitHub
1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions**:

   | Jenis | Nama | Nilai |
   |---|---|---|
   | Secret | `CLASPRC_JSON` | Kandungan penuh `~/.clasprc.json` |
   | Variable | `SCRIPT_ID` | Script ID (1.2) |
   | Variable | `DEPLOYMENT_ID` | Deployment ID (1.3) |
   | Variable | `PUBLIC_BASE_URL` | (pilihan) domain sendiri. Lalai: `https://<org>.github.io/<repo>/` |
   | Variable | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_VAPID_KEY` | (pilihan) notifikasi telefon, lihat §3 |

3. Push ke `main` (atau buka **Actions → Deploy → Run workflow**).

### 1.5 Super Admin
Buka URL GitHub Pages, kemudian **Daftar** dengan email `BOOTSTRAP_SUPER_ADMIN_EMAIL`. Akaun itu menjadi Super Admin. Selepas itu, kosongkan property `BOOTSTRAP_SUPER_ADMIN_EMAIL`.

## 2. Selepas persediaan

| Perubahan | Tindakan |
|---|---|
| Kod, modul, UI | `git push` (atau Claude push). Semua berlaku automatik |
| Skema (medan/modul baharu) | Automatik: sheet/lajur dicipta, migrasi berjalan pada permintaan pertama |
| Migrasi data | Tambah `MIGRATION_00N` dalam `src/database/Migration.gs`, kemudian push |
| Nama, slogan, mesej landing | Panel pentadbir → Tetapan (tanpa deploy) |
| Skop OAuth baharu (cth. `UrlFetchApp` kali pertama) | Buka editor dan jalankan mana-mana fungsi sekali untuk memberi kebenaran (satu-satunya langkah manual selepas deploy) |

Status deploy: tab **Actions**. Versi dan commit yang sedang berjalan: Panel → Kesihatan Sistem.

## 3. Notifikasi telefon (Firebase Cloud Messaging), pilihan dan percuma

1. <https://console.firebase.google.com>: cipta projek, kemudian **Add app → Web**. Salin nilai `firebaseConfig` ke GitHub Variables `FIREBASE_*`.
2. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**, kemudian simpan dalam `FIREBASE_VAPID_KEY`.
3. **Project settings → Service accounts → Generate new private key**. Fail JSON ini ialah **RAHSIA**:
   - muat naik fail itu ke Google Drive akaun pemilik skrip
   - jalankan **importFcmKeyFromDrive** dalam editor; fail akan disimpan ke Script Property `FCM_SERVICE_ACCOUNT` dan dibuang ke Trash
   - kosongkan Trash, dan padam salinan di PC
4. Push semula (untuk membina web dengan Firebase), kemudian buka Profil pada telefon dan tekan **Hidupkan notifikasi**.

Jangan sesekali letak fail akaun servis dalam repo atau dalam chat. `scan-secrets` menggagalkan CI jika fail itu dikesan.

## 4. Email
Panel → Tetapan → `NOTIFY_EMAIL_ENABLED` (rekod baharu kepada `ADMIN_EMAIL`, perubahan status kepada pemohon). Kuota MailApp: 100/hari (akaun biasa) atau 1,500/hari (Workspace).

## 5. Tanpa CI (manual)
```bash
npm run push                                   # ujian + clasp push
npx clasp update-deployment <DEPLOYMENT_ID>    # URL kekal
npm run build:web -- --api https://script.google.com/macros/s/<ID>/exec
# muat naik KANDUNGAN folder web/ ke repo GitHub Pages
```

## 6. Penyelesaian masalah

| Gejala | Punca & penyelesaian |
|---|---|
| Actions: `CLASPRC_JSON belum ditetapkan` | Tambah secret (1.4) |
| Actions: `invalid_grant` / `401` semasa clasp | Token clasp tamat atau dibatalkan. Jalankan `clasp login` semula di PC dan kemas kini secret `CLASPRC_JSON` |
| Actions: `User has not enabled the Apps Script API` | Langkah 1.1.1 |
| Pages tidak dideploy | Variable `DEPLOYMENT_ID` belum diisi, atau Pages Source bukan "GitHub Actions" |
| "Sorry, unable to open the file" (Chrome, banyak akaun Google) | Guna URL GitHub Pages, bukan URL `/exec` |
| Data tidak dikemas kini selepas deploy | Muat semula dua kali (service worker), atau tutup dan buka semula app |
| Notifikasi telefon tidak sampai | Jalankan `testPushConfig` dalam editor. Pastikan app dipasang melalui **Chrome**/**Safari**, bukan Brave |
| `Konfigurasi sistem belum lengkap` | `setupDatabase` belum dijalankan |
| Ralat dengan ID `E-…` | Panel → Kesihatan Sistem / Pangkalan Data → log sistem |

## 7. Senarai semak sebelum produksi
- [ ] Script Property `APP_ENV` = `PRODUCTION`
- [ ] `AUTH_PEPPER` disandarkan di luar Google
- [ ] `BOOTSTRAP_SUPER_ADMIN_EMAIL` dikosongkan
- [ ] Akaun pemilik skrip menggunakan 2FA
- [ ] `runTestsPart1..4` dalam editor lulus (data sementara, produksi tidak disentuh)
- [ ] Kesihatan Sistem hijau (sandaran, Drive peribadi, pencetus)
- [ ] Notis privasi (PDPA 2010) dipaparkan jika data peribadi dikumpul
