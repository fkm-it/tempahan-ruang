# SECURITY

Keutamaan projek: **Security → Maintainability → Data Integrity → Performance → UX → Visual Design**.

## 1. Model ancaman ringkas

| Aset | Ancaman | Kawalan |
|---|---|---|
| Rekod modul (peribadi) | Dibaca orang lain (IDOR), kebocoran sheet | Semakan pemilikan setiap akses, NOT_FOUND seragam, sheet tidak dikongsi |
| Kata laluan | Kecurian, brute force | PBKDF2+pepper+garam, sheet berasingan & dilindungi, had kadar, kunci akaun |
| Sesi | Kecurian token, sesi kekal selepas disekat | Token 256-bit, hanya hash disimpan, pembatalan serta-merta |
| Sistem | Peningkatan keistimewaan | RBAC server-side, ADMIN tidak boleh urus admin lain, peranan hanya oleh SUPER_ADMIN |
| Borang awam | Spam, bot | Token borang HMAC (min 3 s, maks 6 j), honeypot, had kadar per-modul/email + global |
| Lampiran | Fail berbahaya (SVG/HTML/EXE) | Senarai putih MIME + sambungan + **magic bytes**, had saiz, Drive peribadi |
| Spreadsheet | Formula injection | Semua nilai `= + - @` dilarikan; format teks |

## 2. Kawalan yang dilaksanakan

**Pengesahan & sesi**
- PBKDF2-HMAC-SHA256 (lalai 20,000 lelaran, boleh dinaikkan melalui `benchmarkPassword()`; rehash automatik). Gelung dalaman SHA-256 dilaksana dalam JavaScript tulen (tiada ~1 ms overhead panggilan Utilities setiap lelaran) dengan pepper (`AUTH_PEPPER`) dan garam 16 bait. Tiada kata laluan plaintext di mana-mana.
- Token sesi rawak 256-bit; server menyimpan `SHA-256(token)` sahaja.
- Sekat / nyahaktif / tukar peranan / tukar atau set semula kata laluan → sesi dibatalkan serta-merta.
- 5 cubaan gagal → kunci 15 minit; mesej ralat tidak membezakan "email tiada" dan "kata laluan salah"; masa respons diseimbangkan.
- Kod set semula: 6 digit, HMAC dalam cache, 15 minit, maks 5 cubaan, sekali guna.

**Kebenaran**
- Setiap tindakan dalam `Router.table()` mengisytiharkan peranan minimum; disemak sebelum pengawal.
- Kebenaran modul (cipta/lihat/sunting/padam/status) dikuatkuasa SATU tempat — `CrudEngine` — mengikut `access` dalam `modules/*.json`; pemilikan disemak setiap akses, lampiran melalui rekod induk.
- Medan `adminOnly` tidak pernah dihantar kepada / diterima daripada bukan-admin; lajur sistem (owner, status, ref_no) tidak boleh ditulis melalui payload.
- Tetapan kritikal (pendaftaran, borang awam, penyelenggaraan, lampiran, ADMIN_EMAIL) hanya SUPER_ADMIN.
- Sekurang-kurangnya seorang SUPER_ADMIN aktif sentiasa dikekalkan.
- Fungsi operasi Apps Script dilindungi `requireOwner_()` (google.script.run boleh memanggil fungsi global).

**Input & output**
- `Validator.validate()` berasaskan skema: medan tidak diisytihar dibuang (anti mass-assignment), panjang, jenis, enum, corak.
- Teks: aksara kawalan & aksara bidi dibuang, tag HTML dibuang (pertahanan berlapis).
- Frontend: semua HTML dinamik melalui templat `html``…`` yang **auto-escape**; `tools/check-frontend.js` menolak penyambungan string ke `innerHTML`.
- HTML server (email) melalui `StringUtils.escapeHtml`.
- CSV eksport melarikan formula.

**CSRF**
- Token sesi dihantar dalam payload, bukan cookie; permintaan silang-tapak tidak membawa kelayakan secara automatik.

**Clickjacking**
- Lalai: `XFrameOptionsMode.DEFAULT` (tidak boleh dibenam). Versi web tidak menggunakan iframe, jadi `ALLOW_IFRAME_EMBED` kekal `false`.

### Notifikasi telefon / FCM
- Kunci akaun servis hanya dalam Script Property `FCM_SERVICE_ACCOUNT` (import dari Drive; fail dibuang). JWT RS256 ditandatangani dalam GAS; token akses dicache 55 minit.
- Token peranti hanya didaftar oleh pengguna log masuk; peranti dikongsi → token dipindah milik; token tidak sah dibatalkan automatik.
- Kandungan notifikasi ringkas (tajuk + status); butiran penuh hanya selepas log masuk.

### CI/CD
- `CLASPRC_JSON` hanya sebagai GitHub **Secret**; ditulis ke `$HOME` dalam runner dan dipadam selepas guna. Nilai Firebase web & ID deployment ialah awam (Variables).
- `tools/scan-secrets.js` menggagalkan CI jika kunci PEM, JSON akaun servis, refresh token atau `.clasprc.json` dikesan dalam repo.
- Lindungi cawangan `main` (Settings → Branches) jika lebih daripada seorang menyumbang — push ke main = deploy produksi.

### Versi web statik + `doPost`
- `doPost` menghala ke `Router.dispatch` yang sama (RBAC, had kadar, validasi, saiz maksimum) — tiada laluan pintas.
- `fetch` dengan `credentials: 'omit'` + token dalam badan JSON: tiada cookie → tiada CSRF, tiada kebocoran sesi Google.
- CSP: `script-src 'self'` (tiada skrip sebaris; binaan menolak `onclick=`), `connect-src` hanya `script.google.com`/`script.googleusercontent.com`, `frame-src 'none'`, `object-src 'none'`.
- Token sesi disimpan dalam `localStorage` dengan awalan `APP_SLUG` (sistem lain di origin sama tidak bertindih). Semua repo GitHub Pages di bawah `<org>.github.io` tetap berkongsi origin — jangan hos laman pihak ketiga/tidak dipercayai dalam organisasi yang sama; untuk data sensitif guna organisasi atau domain berasingan.

**Penyalahgunaan & integriti**
- Had kadar (CacheService) untuk log masuk, daftar, reset, cipta rekod, borang awam, maklum balas, lampiran, notifikasi ujian.
- Idempotensi melalui `requestId` (klik berganda / cubaan semula rangkaian → satu rekod).
- `LockService` untuk semua tulisan; lokasi baris dicari semula di dalam kunci.
- Soft delete untuk rekod modul (admin boleh pulihkan); audit untuk setiap tindakan sensitif & admin.

**Rahsia & log**
- Rahsia dalam Script Properties sahaja; tiada rahsia/API key dalam frontend.
- Log developer diredaksi (`password`, `token`, `secret`, `hash`, `code`, `data`…). Audit tidak menyimpan kata laluan, token atau kandungan rekod.
- Pengguna hanya melihat mesej generik + ID ralat; jejak penuh dalam `SYSTEM_LOGS` (SUPER_ADMIN).

**Drive**
- Folder & fail ditetapkan `PRIVATE`; pengguna mengakses lampiran melalui backend selepas semakan akses (tiada pautan Drive awam).
- Kesihatan Sistem memaparkan amaran jika folder lampiran dikongsi.

## 3. Batasan yang diketahui (risiko diterima)

1. **Tiada IP klien dalam GAS** — had kadar per-email/per-pengguna/global, bukan per-IP. Penyerang dengan banyak email boleh mendaftar lebih banyak akaun (dihadkan global 100/jam).
2. **CacheService tidak atomik** — kiraan had kadar boleh terlepas sedikit di bawah serangan serentak.
3. **PBKDF2 dengan lelaran terhad** (prestasi GAS) — lebih lemah daripada argon2/bcrypt; dikompensasi oleh pepper yang tidak berada dalam spreadsheet.
4. **Token dalam localStorage/sessionStorage** — terdedah jika berlaku XSS. Dikurangkan oleh auto-escape menyeluruh dan ketiadaan skrip pihak ketiga (kecuali Google Fonts CSS).
5. **Pentadbir boleh membaca semua rekod modul** (termasuk `access.list = OWN`). Nyatakan dalam notis privasi.
6. **Execute as: Me** — semua data dimiliki akaun pemilik; lindungi akaun ini dengan 2FA.

## 4. Senarai semak operasi

- [ ] Akaun pemilik skrip menggunakan 2FA
- [ ] Spreadsheet & folder tidak dikongsi dengan sesiapa (atau hanya pentadbir teknikal dengan keperluan)
- [ ] `AUTH_PEPPER` disandarkan di luar Google; jangan sesekali dikongsi
- [ ] `BOOTSTRAP_SUPER_ADMIN_EMAIL` dikosongkan selepas Super Admin pertama dicipta
- [ ] Semak Audit Log mingguan (LOGIN_FAILED berulang, USER_ROLE_CHANGED, SETTINGS_UPDATED)
- [ ] Semak Kesihatan Sistem: sandaran < 3 hari, Drive "Peribadi", tiada ralat berulang
- [ ] Notis privasi dipaparkan kepada pengguna (akta PDPA 2010)

## 5. Melaporkan isu keselamatan
Hubungi pentadbir sistem (tetapan `ADMIN_EMAIL`). Jangan dedahkan butiran secara awam sebelum dibaiki.
