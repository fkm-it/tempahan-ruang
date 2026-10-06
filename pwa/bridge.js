/**
 * Jambatan google.script.* untuk versi web statik (GitHub Pages / domain sendiri).
 *
 * Frontend yang sama digunakan dalam Apps Script dan versi web. Dalam Apps Script,
 * `google.script.run.api()` disediakan oleh Google. Di sini, kita sediakan objek yang
 * sama tetapi menghantar permintaan ke doPost() Web App melalui fetch():
 *   - Content-Type text/plain  → tiada CORS preflight
 *   - credentials: 'omit'      → TIADA cookie Google dihantar. Ini yang menyelesaikan isu
 *     "Sorry, unable to open the file" bagi pelayar yang log masuk beberapa akaun Google.
 */
(function () {
  'use strict';
  var cfg = window.APP_CONFIG || {};
  var API = String(cfg.webAppUrl || '');
  var VALID = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(API) ||
    /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/[a-z0-9_-]+$/.test(API) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+\/__api$/.test(API);
  var TIMEOUT_MS = 120000; // muat naik lampiran boleh mengambil masa
  /* Permintaan biasa: had masa meningkat setiap cubaan (meta.attempt) — sambungan yang tersangkut dicuba semula lebih awal.
     Selamat kerana pelayan idempoten (meta.rid). */
  var TIMEOUT_STEPS_MS = [15000, 25000, 40000, 60000];

  function post(request, onOk, onFail) {
    if (!VALID) {
      setTimeout(function () { if (onFail) onFail(new Error('webAppUrl dalam config.js tidak sah')); }, 0);
      return;
    }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var body = JSON.stringify(request);
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, body.length > 100000 ? TIMEOUT_MS : TIMEOUT_STEPS_MS[Math.min((request.meta && request.meta.attempt) || 0, TIMEOUT_STEPS_MS.length - 1)]);
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) {
        if (window.console) console.error('[bridge] respons bukan JSON:', String(text).slice(0, 300));
        throw new Error('bukan JSON');
      }
      clearTimeout(timer);
      if (onOk) onOk(data);
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') err = new Error('tamat masa');
      if (onFail) onFail(err);
    });
  }

  function runner(onOk, onFail) {
    return {
      withSuccessHandler: function (fn) { return runner(fn, onFail); },
      withFailureHandler: function (fn) { return runner(onOk, fn); },
      api: function (request) { post(request, onOk, onFail); }
    };
  }

  window.google = {
    script: {
      run: runner(null, null),
      url: {
        getLocation: function (cb) {
          var parameter = {};
          new URLSearchParams(location.search).forEach(function (v, k) { parameter[k] = v; });
          cb({ hash: '', parameter: parameter });
        }
      },
      // Versi web memiliki URL sendiri; router hash sudah mengemas kini alamat.
      history: { replace: function () {}, push: function () {} }
    }
  };
  window.KD_WEB = { apiConfigured: VALID };

  // Tangkap dialog "Pasang aplikasi" seawal mungkin (sebelum app dimuatkan); KD.pwa menggunakannya kemudian.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__kdInstallPrompt = e;
  });
})();
