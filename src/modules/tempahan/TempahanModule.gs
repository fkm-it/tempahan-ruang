/**
 * DIJANA oleh tools/gen.js daripada modules/tempahan.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const TempahanModule = Object.freeze(Object.assign(
  {
    "key": "tempahan",
    "name": "Tempahan",
    "label": "Tempahan",
    "labelPlural": "Tempahan",
    "icon": "calendar",
    "prefix": "TP",
    "refFormat": "TP-{YYYY}-{SEQ4}",
    "description": "Permohonan tempahan ruang kuliah, makmal dan studio FKM.",
    "access": {
      "create": "PUBLIC",
      "list": "OWN",
      "edit": "ADMIN",
      "delete": "ADMIN",
      "ownerEditStatuses": []
    },
    "statuses": [
      {
        "value": "MENUNGGU",
        "label": "Menunggu kelulusan",
        "tone": "warn"
      },
      {
        "value": "DILULUSKAN",
        "label": "Diluluskan",
        "tone": "success"
      },
      {
        "value": "DITOLAK",
        "label": "Ditolak",
        "tone": "danger"
      },
      {
        "value": "DIBATALKAN",
        "label": "Dibatalkan",
        "tone": "muted"
      },
      {
        "value": "SELESAI",
        "label": "Selesai",
        "tone": "info"
      }
    ],
    "statusRole": "ADMIN",
    "notify": {
      "adminsOnCreate": true,
      "ownerOnStatus": false
    },
    "titleField": "tujuan",
    "subtitleField": "ruang",
    "nav": {
      "user": true,
      "admin": true,
      "order": 10
    },
    "publicForm": {
      "title": "Borang Tempahan Ruang",
      "intro": "Semak kekosongan di Kalendar dahulu. Staf: nama & emel diambil automatik daripada senarai staf berdasarkan No. Staf. Pelajar: isi No. Matrik, nama dan emel UTM.",
      "successMessage": "Permohonan anda telah diterima dan sedang menunggu kelulusan. Pengesahan & keputusan akan dihantar ke emel anda. Simpan No. Rujukan untuk semakan atau pembatalan.",
      "contactEmailField": "emel",
      "nameField": "nama",
      "rateKeyField": "noStaf",
      "successLink": {
        "href": "#/semak?ref={refNo}",
        "label": "Semak status"
      }
    },
    "fields": [
      {
        "key": "jenisPemohon",
        "label": "Kategori pemohon",
        "type": "enum",
        "default": "STAF",
        "filter": true,
        "options": [
          {
            "value": "STAF",
            "label": "Staf FKM"
          },
          {
            "value": "PELAJAR",
            "label": "Pelajar"
          },
          {
            "value": "LUAR",
            "label": "Pihak luar"
          }
        ],
        "column": "jenis_pemohon"
      },
      {
        "key": "noStaf",
        "label": "No. Staf / No. Matrik",
        "type": "string",
        "required": false,
        "max": 20,
        "search": true,
        "lockAfterCreate": true,
        "placeholder": "cth. 9515",
        "hint": "Staf: No. Staf. Pelajar: No. Matrik.",
        "column": "no_staf"
      },
      {
        "key": "nama",
        "label": "Nama pemohon",
        "type": "string",
        "list": true,
        "search": true,
        "max": 120,
        "column": "nama"
      },
      {
        "key": "emel",
        "label": "Emel",
        "type": "email",
        "search": true,
        "column": "emel"
      },
      {
        "key": "noTelefon",
        "label": "No. telefon",
        "type": "phone",
        "required": true,
        "placeholder": "cth. 012-345 6789",
        "column": "no_telefon"
      },
      {
        "key": "ruang",
        "label": "Ruang",
        "type": "ref",
        "ref": "ruang",
        "required": true,
        "filter": true,
        "list": true,
        "column": "ruang"
      },
      {
        "key": "tarikh",
        "label": "Tarikh",
        "type": "date",
        "required": true,
        "list": true,
        "column": "tarikh"
      },
      {
        "key": "tarikhTamat",
        "label": "Hingga tarikh",
        "type": "date",
        "hint": "Untuk tempahan berbilang hari (maksimum 14 hari). Kosongkan jika sehari sahaja.",
        "column": "tarikh_tamat"
      },
      {
        "key": "masaMula",
        "label": "Masa mula",
        "type": "time",
        "required": true,
        "list": true,
        "column": "masa_mula"
      },
      {
        "key": "masaTamat",
        "label": "Masa tamat",
        "type": "time",
        "required": true,
        "list": true,
        "column": "masa_tamat"
      },
      {
        "key": "bilanganPeserta",
        "label": "Bilangan peserta",
        "type": "int",
        "min": 1,
        "max": 2000,
        "column": "bilangan_peserta"
      },
      {
        "key": "tujuan",
        "label": "Tujuan / aktiviti",
        "type": "text",
        "required": true,
        "min": 3,
        "max": 500,
        "search": true,
        "column": "tujuan"
      },
      {
        "key": "peringatanDihantar",
        "label": "Peringatan dihantar",
        "type": "string",
        "readonly": true,
        "adminOnly": true,
        "column": "peringatan_dihantar"
      },
      {
        "key": "bahasa",
        "label": "Bahasa emel",
        "type": "enum",
        "readonly": true,
        "default": "ms",
        "options": [
          {
            "value": "ms",
            "label": "Bahasa Melayu"
          },
          {
            "value": "en",
            "label": "English"
          }
        ],
        "column": "bahasa"
      },
      {
        "key": "peringatanJamDihantar",
        "label": "Peringatan jam dihantar",
        "type": "string",
        "readonly": true,
        "adminOnly": true,
        "column": "peringatan_jam_dihantar"
      },
      {
        "key": "peringatanPagiDihantar",
        "label": "Peringatan pagi dihantar",
        "type": "string",
        "readonly": true,
        "adminOnly": true,
        "column": "peringatan_pagi_dihantar"
      }
    ],
    "path": "/tempahan",
    "sheet": "TEMPAHAN",
    "defaultStatus": "MENUNGGU"
  },
  { hooks: function () { return typeof TempahanHooks !== 'undefined' ? TempahanHooks : {}; } }
));
