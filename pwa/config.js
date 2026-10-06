/**
 * Tetapan versi web (GitHub Pages / domain sendiri). BUKAN rahsia — semua nilai di sini memang awam.
 * Fail ini dimuatkan oleh halaman DAN service worker (sebab itu guna `self`, bukan `window`).
 */
self.APP_CONFIG = {
  // URL Web App (Deploy → Manage deployments) yang berakhir dengan /exec
  webAppUrl: 'https://script.google.com/macros/s/GANTIKAN_DENGAN_DEPLOYMENT_ID/exec',

  // Notifikasi telefon (pilihan). Firebase console → ⚙ Project settings → General → Your apps → Web app → "SDK setup and configuration" (Config).
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    messagingSenderId: '',
    appId: ''
  },
  // Firebase console → ⚙ Project settings → Cloud Messaging → Web Push certificates → "Key pair"
  vapidKey: ''
};
