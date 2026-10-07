/**
 * DIJANA oleh tools/gen.js daripada modules/pembantu.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const PembantuModule = Object.freeze(Object.assign(
  {
    "key": "pembantu",
    "name": "Pembantu",
    "label": "Pembantu Operasi",
    "labelPlural": "Pembantu Operasi",
    "icon": "users",
    "prefix": "PO",
    "description": "PIC yang ditugaskan membuka / menyediakan ruang (pembantu operasi). Dimaklumkan melalui emel dan WhatsApp.",
    "access": {
      "create": "ADMIN",
      "list": "OWN",
      "edit": "ADMIN",
      "delete": "ADMIN",
      "ownerEditStatuses": []
    },
    "notify": {
      "adminsOnCreate": false,
      "ownerOnStatus": false
    },
    "titleField": "nama",
    "subtitleField": "noTelefon",
    "nav": {
      "user": false,
      "admin": true,
      "order": 25
    },
    "fields": [
      {
        "key": "nama",
        "label": "Nama",
        "type": "string",
        "required": true,
        "max": 120,
        "list": true,
        "search": true,
        "column": "nama"
      },
      {
        "key": "noTelefon",
        "label": "No. telefon (WhatsApp)",
        "type": "phone",
        "required": true,
        "list": true,
        "search": true,
        "placeholder": "cth. 012-345 6789",
        "column": "no_telefon"
      },
      {
        "key": "emel",
        "label": "Emel",
        "type": "email",
        "search": true,
        "hint": "Tugasan dan pautan pengesahan dihantar ke emel ini.",
        "column": "emel"
      },
      {
        "key": "jawatan",
        "label": "Jawatan",
        "type": "string",
        "max": 80,
        "default": "Pembantu Operasi",
        "column": "jawatan"
      },
      {
        "key": "aktif",
        "label": "Aktif",
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
        "max": 500,
        "column": "catatan"
      }
    ],
    "path": "/pembantu",
    "sheet": "PEMBANTU",
    "refFormat": "PO-{YYYY}-{SEQ4}",
    "statuses": [],
    "defaultStatus": "",
    "statusRole": "ADMIN"
  },
  { hooks: function () { return typeof PembantuHooks !== 'undefined' ? PembantuHooks : {}; } }
));
