/**
 * DIJANA oleh tools/gen.js daripada modules/pengumuman.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const PengumumanModule = Object.freeze(Object.assign(
  {
    "key": "pengumuman",
    "name": "Pengumuman",
    "label": "Pengumuman",
    "labelPlural": "Pengumuman",
    "icon": "bell",
    "description": "Makluman rasmi daripada pentadbir kepada semua pengguna.",
    "access": {
      "create": "ADMIN",
      "list": "ALL",
      "edit": "ADMIN",
      "delete": "ADMIN",
      "ownerEditStatuses": []
    },
    "notify": {
      "adminsOnCreate": false,
      "ownerOnStatus": false
    },
    "titleField": "tajuk",
    "nav": {
      "user": true,
      "admin": true,
      "order": 20
    },
    "fields": [
      {
        "key": "tajuk",
        "label": "Tajuk",
        "type": "string",
        "required": true,
        "max": 120,
        "list": true,
        "search": true,
        "column": "tajuk"
      },
      {
        "key": "isi",
        "label": "Isi pengumuman",
        "type": "text",
        "required": true,
        "max": 4000,
        "search": true,
        "column": "isi"
      },
      {
        "key": "tarikhTamat",
        "label": "Papar hingga",
        "type": "date",
        "list": true,
        "hint": "Kosongkan untuk dipaparkan tanpa had.",
        "column": "tarikh_tamat"
      },
      {
        "key": "penting",
        "label": "Penting",
        "type": "bool",
        "list": true,
        "filter": true,
        "column": "penting"
      }
    ],
    "path": "/pengumuman",
    "sheet": "PENGUMUMAN",
    "prefix": "PE",
    "refFormat": "PE-{YYYY}-{SEQ4}",
    "statuses": [],
    "defaultStatus": "",
    "statusRole": "ADMIN"
  },
  { hooks: function () { return typeof PengumumanHooks !== 'undefined' ? PengumumanHooks : {}; } }
));
