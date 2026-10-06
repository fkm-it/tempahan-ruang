/* Service worker: cache aset statik sahaja.
 * Data aplikasi TIDAK dicache (peribadi & sentiasa daripada pelayan; permintaan API ke Google tidak disentuh).
 * Nama cache & senarai aset diisi oleh tools/build-web.js (pemegang tempat di bawah). */
var CACHE = '__CACHE__';
var ASSETS = __ASSETS__;
var FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

// Lencana pada ikon app (nombor belum dibaca) — didaftar SEBELUM Firebase supaya sentiasa berjalan.
// iPhone (app dipasang) & desktop: nombor pada ikon. Android: pelancar memaparkan titik/nombor
// berdasarkan notifikasi yang masih ada dalam bar notifikasi.
self.addEventListener('push', function (e) {
  var n = NaN;
  try { var p = e.data && e.data.json(); n = parseInt(p && p.data && p.data.badge, 10); } catch (err) { /* bukan JSON */ }
  if (!self.navigator || !self.navigator.setAppBadge) return;
  e.waitUntil((isNaN(n) ? self.navigator.setAppBadge() : n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(function () {}));
});

// Dari app: semua notifikasi telah dibaca → buang notifikasi dari bar & lencana ikon
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'KD_CLEAR_NOTIFICATIONS') return;
  e.waitUntil(self.registration.getNotifications().then(function (list) {
    list.forEach(function (n) { n.close(); });
    if (self.navigator && self.navigator.clearAppBadge) return self.navigator.clearAppBadge().catch(function () {});
  }));
});

// Notifikasi telefon (FCM): aktif hanya jika config.js mempunyai konfigurasi Firebase.
// SDK memaparkan notifikasi latar belakang secara automatik & membuka fcm_options.link apabila diklik.
try { importScripts('config.js'); } catch (e) { /* tiada config */ }
(function () {
  var c = self.APP_CONFIG || {};
  var fb = c.firebase || {};
  if (!(fb.projectId && fb.apiKey && fb.messagingSenderId && fb.appId)) return;
  try {
    importScripts(FIREBASE_SDK + 'firebase-app-compat.js', FIREBASE_SDK + 'firebase-messaging-compat.js');
    firebase.initializeApp(fb);
    firebase.messaging();
  } catch (e) { /* luar talian semasa pemasangan — dicuba semula pada kemas kini seterusnya */ }
})();

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // jangan sentuh permintaan Google
  if (req.mode === 'navigate') {
    // Rangkaian dahulu (sentiasa versi terkini); jika luar talian → halaman offline
    e.respondWith(fetch(req).catch(function () { return caches.match('offline.html'); }));
    return;
  }
  // Aset statik: cache dahulu, kemas kini di latar
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
