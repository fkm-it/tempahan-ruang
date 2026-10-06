/**
 * DIJANA oleh tools/gen.js daripada modules/staf.json — JANGAN sunting dengan tangan.
 * Ubah fail JSON, kemudian jalankan: npm run gen
 */
const StafModule = Object.freeze(Object.assign(
  {
    "key": "staf",
    "name": "Staf",
    "label": "Staf",
    "labelPlural": "Senarai Staf",
    "icon": "users",
    "prefix": "SF",
    "description": "Senarai staf FKM yang layak membuat tempahan (disemak menggunakan No. Staf).",
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
    "subtitleField": "noStaf",
    "nav": {
      "user": false,
      "admin": true,
      "order": 30
    },
    "fields": [
      {
        "key": "noStaf",
        "label": "No. Staf",
        "type": "string",
        "required": true,
        "max": 20,
        "list": true,
        "search": true,
        "column": "no_staf"
      },
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
        "key": "emel",
        "label": "Emel",
        "type": "email",
        "required": true,
        "list": true,
        "search": true,
        "column": "emel"
      },
      {
        "key": "aktif",
        "label": "Aktif",
        "type": "bool",
        "default": true,
        "filter": true,
        "list": true,
        "column": "aktif"
      }
    ],
    "path": "/staf",
    "sheet": "STAF",
    "refFormat": "SF-{YYYY}-{SEQ4}",
    "statuses": [],
    "defaultStatus": "",
    "statusRole": "ADMIN"
  },
  { hooks: function () { return typeof StafHooks !== 'undefined' ? StafHooks : {}; } }
));
