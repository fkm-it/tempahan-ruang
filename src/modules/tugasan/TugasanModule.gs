/**
 * DIJANA oleh tools/gen.js daripada modules/tugasan.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const TugasanModule = Object.freeze(Object.assign(
  {
    "key": "tugasan",
    "name": "Tugasan",
    "label": "Tugasan",
    "labelPlural": "Log Kerja",
    "icon": "briefcase",
    "path": "/log-kerja",
    "prefix": "TG",
    "refFormat": "TG-{YYYY}-{SEQ4}",
    "description": "Log kerja pembantu operasi: tugasan membuka / menyediakan ruang bagi tempahan yang diluluskan.",
    "access": {
      "create": "ADMIN",
      "list": "OWN",
      "edit": "ADMIN",
      "delete": "ADMIN",
      "ownerEditStatuses": []
    },
    "statuses": [
      {
        "value": "DITUGASKAN",
        "label": "Ditugaskan",
        "tone": "warn"
      },
      {
        "value": "SELESAI",
        "label": "Selesai",
        "tone": "success"
      },
      {
        "value": "DIBATALKAN",
        "label": "Dibatalkan",
        "tone": "muted"
      }
    ],
    "transitions": {
      "DITUGASKAN": [
        "SELESAI",
        "DIBATALKAN"
      ],
      "SELESAI": [
        "DITUGASKAN"
      ],
      "DIBATALKAN": [
        "DITUGASKAN"
      ]
    },
    "notify": {
      "adminsOnCreate": false,
      "ownerOnStatus": false
    },
    "titleField": "tajuk",
    "subtitleField": "pembantu",
    "nav": {
      "user": false,
      "admin": true,
      "order": 15
    },
    "fields": [
      {
        "key": "tajuk",
        "label": "Tugasan",
        "type": "string",
        "max": 160,
        "list": true,
        "search": true,
        "placeholder": "Kosongkan untuk dijana automatik",
        "column": "tajuk"
      },
      {
        "key": "jenis",
        "label": "Jenis tugasan",
        "type": "enum",
        "default": "BUKA",
        "filter": true,
        "options": [
          {
            "value": "BUKA",
            "label": "Buka ruang"
          },
          {
            "value": "TUTUP",
            "label": "Tutup / kunci ruang"
          },
          {
            "value": "SEDIA",
            "label": "Sediakan ruang / peralatan"
          },
          {
            "value": "LAIN",
            "label": "Lain-lain"
          }
        ],
        "column": "jenis"
      },
      {
        "key": "pembantu",
        "label": "PIC (pembantu operasi)",
        "type": "ref",
        "ref": "pembantu",
        "required": true,
        "filter": true,
        "list": true,
        "column": "pembantu"
      },
      {
        "key": "ruang",
        "label": "Ruang",
        "type": "ref",
        "ref": "ruang",
        "filter": true,
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
        "hint": "Untuk tempahan berbilang hari: tugasan diulang setiap hari.",
        "column": "tarikh_tamat"
      },
      {
        "key": "masa",
        "label": "Sebelum jam",
        "type": "time",
        "list": true,
        "column": "masa"
      },
      {
        "key": "arahan",
        "label": "Arahan",
        "type": "text",
        "max": 500,
        "search": true,
        "column": "arahan"
      },
      {
        "key": "tempahan",
        "label": "Tempahan",
        "type": "ref",
        "ref": "tempahan",
        "readonly": true,
        "column": "tempahan"
      },
      {
        "key": "ditugaskanOleh",
        "label": "Ditugaskan oleh",
        "type": "string",
        "readonly": true,
        "column": "ditugaskan_oleh"
      },
      {
        "key": "disahkanPada",
        "label": "Disahkan pada",
        "type": "string",
        "readonly": true,
        "column": "disahkan_pada"
      },
      {
        "key": "disahkanOleh",
        "label": "Disahkan oleh",
        "type": "string",
        "readonly": true,
        "column": "disahkan_oleh"
      },
      {
        "key": "catatanPic",
        "label": "Catatan PIC",
        "type": "text",
        "max": 300,
        "readonly": true,
        "column": "catatan_pic"
      },
      {
        "key": "emelDihantar",
        "label": "Emel kepada PIC",
        "type": "string",
        "readonly": true,
        "adminOnly": true,
        "column": "emel_dihantar"
      },
      {
        "key": "peringatanDihantar",
        "label": "Peringatan PIC dihantar",
        "type": "string",
        "readonly": true,
        "adminOnly": true,
        "column": "peringatan_dihantar"
      },
      {
        "key": "kod",
        "label": "Kod pautan PIC",
        "type": "string",
        "max": 40,
        "readonly": true,
        "adminOnly": true,
        "column": "kod"
      }
    ],
    "sheet": "TUGASAN",
    "defaultStatus": "DITUGASKAN",
    "statusRole": "ADMIN"
  },
  { hooks: function () { return typeof TugasanHooks !== 'undefined' ? TugasanHooks : {}; } }
));
