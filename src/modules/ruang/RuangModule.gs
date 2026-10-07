/**
 * DIJANA oleh tools/gen.js daripada modules/ruang.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const RuangModule = Object.freeze(Object.assign(
  {
    "key": "ruang",
    "name": "Ruang",
    "label": "Ruang",
    "labelPlural": "Ruang",
    "icon": "home",
    "prefix": "RU",
    "description": "Senarai ruang & fasiliti yang boleh ditempah (kapasiti, lokasi, PIC).",
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
    "titleField": "nama",
    "subtitleField": "blok",
    "nav": {
      "user": false,
      "admin": true,
      "order": 20
    },
    "fields": [
      {
        "key": "nama",
        "label": "Nama ruang",
        "type": "string",
        "required": true,
        "max": 80,
        "list": true,
        "search": true,
        "placeholder": "cth. Dewan Kuliah 1 (E07)",
        "column": "nama"
      },
      {
        "key": "blok",
        "label": "Blok",
        "type": "string",
        "required": true,
        "max": 20,
        "list": true,
        "search": true,
        "placeholder": "cth. E07",
        "column": "blok"
      },
      {
        "key": "jenis",
        "label": "Jenis ruang",
        "type": "string",
        "max": 40,
        "list": true,
        "search": true,
        "placeholder": "cth. Dewan Kuliah, Makmal",
        "column": "jenis"
      },
      {
        "key": "aras",
        "label": "Aras",
        "type": "string",
        "max": 20,
        "column": "aras"
      },
      {
        "key": "kodRuang",
        "label": "Kod ruang",
        "type": "string",
        "max": 40,
        "search": true,
        "column": "kod_ruang"
      },
      {
        "key": "kapasiti",
        "label": "Kapasiti",
        "type": "int",
        "min": 0,
        "max": 2000,
        "list": true,
        "column": "kapasiti"
      },
      {
        "key": "pic",
        "label": "PIC (pegawai bertanggungjawab)",
        "type": "string",
        "max": 80,
        "column": "pic"
      },
      {
        "key": "emelPic",
        "label": "Emel PIC",
        "type": "email",
        "hint": "Dimaklumkan apabila tempahan ruang ini diluluskan atau dibatalkan.",
        "column": "emel_pic"
      },
      {
        "key": "pembantu",
        "label": "Pembantu operasi (buka ruang)",
        "type": "ref",
        "ref": "pembantu",
        "hint": "Dicadangkan secara automatik semasa meluluskan tempahan ruang ini.",
        "column": "pembantu"
      },
      {
        "key": "aktif",
        "label": "Boleh ditempah",
        "type": "bool",
        "default": true,
        "filter": true,
        "list": true,
        "column": "aktif"
      },
      {
        "key": "catatan",
        "label": "Catatan",
        "type": "text",
        "max": 1000,
        "column": "catatan"
      }
    ],
    "path": "/ruang",
    "sheet": "RUANG",
    "refFormat": "RU-{YYYY}-{SEQ4}",
    "statuses": [],
    "defaultStatus": "",
    "statusRole": "ADMIN"
  },
  { hooks: function () { return typeof RuangHooks !== 'undefined' ? RuangHooks : {}; } }
));
