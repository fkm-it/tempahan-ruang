"""
e2e.py — ujian hujung-ke-hujung GENERIK (Playwright) ke atas dev server.
Membaca metadata modul daripada API, jadi ia menguji modul ANDA tanpa perlu diubah.

  npm run dev            (terminal 1 — http://localhost:8080 dengan data demo)
  npm run e2e            (terminal 2)

Pemboleh ubah: KD_BASE (URL halaman, lalai http://localhost:8080/), KD_API (lalai KD_BASE + __api)
Tangkapan skrin telefon (360px) disimpan ke e2e-shots/ untuk semakan visual.
"""
from playwright.sync_api import sync_playwright
import json, os, urllib.request, base64

B = os.environ.get('KD_BASE', 'http://localhost:8080/')
API = os.environ.get('KD_API', B.rstrip('/') + '/__api')
SHOTS = os.environ.get('KD_SHOTS', 'e2e-shots')
os.makedirs(SHOTS, exist_ok=True)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
open('/tmp/e2e.png', 'wb').write(PNG)

def api(action, payload=None):
    req = urllib.request.Request(API, data=json.dumps({'action': action, 'payload': payload or {}}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['data']

MODS = api('crud.meta')
assert MODS, 'Tiada modul — cipta modules/*.json dan jalankan npm run gen'
USER_MOD = next((m for m in MODS if m['access']['create'] != 'ADMIN'), None)
PUB_MOD = next((m for m in MODS if m.get('publicForm')), None)

CFG = api('public.config')
REG_OPEN = CFG.get('ALLOW_REGISTRATION') is not False
# Nilai khusus projek (pilihan): tools/e2e-values.json = { "<modul>": { "<medan>": "nilai", "public": { "<medan>": "nilai" } } }
_vals = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e-values.json')
VALUES = json.load(open(_vals)) if os.path.exists(_vals) else {}

SAMPLE = {'string': 'Ujian E2E', 'text': 'Ini ialah ujian hujung-ke-hujung automatik untuk modul.', 'email': 'e2e@demo.local',
          'phone': '012-345 6789', 'int': '3', 'number': '12.5', 'date': '2026-12-01', 'time': '10:30'}

def fill(pg, m, prefix, public=False):
    nth = {}
    for f in m['fields']:
        if f.get('adminOnly') or f.get('readonly'): continue
        if public and f.get('public') is False: continue
        if not public and f.get('publicOnly'): continue
        sel = '#' + prefix + f['key']
        if pg.locator(sel).count() == 0: continue
        t = f['type']
        mv = VALUES.get(m['key'], {})
        over = (mv.get('public', {}) if public else {}).get(f['key'], mv.get(f['key']))
        if over is not None:
            if t in ('enum', 'category', 'ref'): pg.select_option(sel, str(over))
            else: pg.fill(sel, str(over))
            continue
        nth[t] = nth.get(t, 0) + 1
        if t == 'time': pg.fill(sel, '%02d:00' % (19 + nth[t])); continue   # mula < tamat, elak bertindih dengan data demo
        if t == 'date': pg.fill(sel, '2027-01-%02d' % (10 + nth[t])); continue
        if t == 'files':
            if not public: pg.set_input_files(sel, '/tmp/e2e.png')
        elif t == 'bool': pg.check(sel)
        elif t in ('enum', 'category', 'ref'):
            if pg.locator(sel + ' option').count() > 1: pg.select_option(sel, index=1)
        else:
            v = SAMPLE.get(t, 'Ujian')
            if f.get('max') and t in ('string', 'text'): v = v[:f['max']]
            if f.get('min') and t == 'text' and len(v) < f['min']: v = (v + ' ') * (f['min'] // len(v) + 1)
            pg.fill(sel, v)

errs, ok = [], []
def step(n): ok.append(n); print('✔', n)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 860})
    pg.route('https://fonts.**', lambda r: r.abort())
    pg.on('pageerror', lambda e: errs.append(str(e)))

    if REG_OPEN:
        pg.goto(B + '#/daftar'); pg.wait_for_selector('#f-fullName')
        pg.fill('#f-fullName', 'Ujian E2E'); pg.fill('#f-email', 'e2e@demo.local'); pg.fill('#f-password', 'lemah')
        pg.click('button[type=submit]'); pg.wait_for_selector('.field-error'); step('validasi kata laluan dipaparkan pada medan')
        pg.fill('#f-password', 'Kuat12345'); pg.click('button[type=submit]'); pg.wait_for_selector('.welcome'); step('daftar → papan pemuka')
        BLOCK_Q = 'e2e'
    else:
        pg.goto(B + '#/daftar'); pg.wait_for_selector('.auth-card'); assert 'ditutup' in pg.inner_text('.auth-card'); step('pendaftaran ditutup dipaparkan')
        pg.goto(B + '#/log-masuk'); pg.wait_for_selector('#f-email'); pg.fill('#f-email', 'user@demo.local'); pg.fill('#f-password', 'Demo1234')
        pg.click('button[type=submit]'); pg.wait_for_selector('.welcome'); step('log masuk pengguna demo → papan pemuka')
        BLOCK_Q = 'Siti'

    rec_url = None
    if USER_MOD:
        pg.goto(B + '#' + USER_MOD['path'] + '/baru'); pg.wait_for_selector('[data-crud-form]')
        pg.click('[data-crud-form] button[type=submit]')
        if any(f.get('required') and not f.get('publicOnly') and f['type'] not in ('files', 'category', 'bool') for f in USER_MOD['fields']):
            pg.wait_for_selector('.field-error'); step('validasi medan wajib (' + USER_MOD['label'] + ')')
        fill(pg, USER_MOD, 'f-')
        pg.click('[data-crud-form] button[type=submit]'); pg.wait_for_selector('.rec-detail__meta'); rec_url = pg.url
        step('cipta ' + USER_MOD['label'] + ' → butiran')
        if pg.locator('[data-att]').count():
            pg.click('[data-att]'); pg.wait_for_selector('.att-preview img'); step('pratonton lampiran')
        pg.goto(B + '#' + USER_MOD['path']); pg.wait_for_selector('.rec-item'); step('senarai ' + USER_MOD['label'])
        pg.fill('[data-q]', 'tiada-padanan-xyz'); pg.wait_for_selector('.empty'); step('carian tanpa padanan')

    if PUB_MOD:
        p2 = b.new_page(); p2.route('https://fonts.**', lambda r: r.abort())
        p2.goto(B + '#/borang/' + PUB_MOD['key']); p2.wait_for_selector('[data-public-form]')
        p2.wait_for_timeout(3200); fill(p2, PUB_MOD, 'pf-', public=True)
        p2.click('[data-public-form] button[type=submit]'); p2.wait_for_selector('.success-card .rec-ref'); step('borang awam ' + PUB_MOD['label'] + ' → no. rujukan')
        p2.close()

    pg.goto(B + '#/admin'); pg.wait_for_timeout(800); assert '#/utama' in pg.url; step('pengguna biasa dihalang dari /admin')

    # ---- admin
    pg.evaluate('localStorage.clear();sessionStorage.clear()'); pg.goto(B); pg.reload(); pg.goto(B + '#/log-masuk'); pg.wait_for_selector('#f-email')
    pg.fill('#f-email', 'super@demo.local'); pg.fill('#f-password', 'Demo1234'); pg.click('button[type=submit]'); pg.wait_for_selector('.stat')
    step('admin log masuk → dashboard')
    if USER_MOD and USER_MOD['statuses'] and rec_url:
        rid = rec_url.split('/')[-1]
        pg.goto(B + '#/admin' + USER_MOD['path'] + '/' + rid); pg.wait_for_selector('[data-act=status]')
        pg.click('[data-act=status]'); pg.select_option('#st-status', index=1); pg.fill('#st-note', 'Diuruskan oleh E2E')
        pg.click('[data-save]'); pg.wait_for_timeout(800); assert 'Diuruskan oleh E2E' in pg.inner_text('.status-note'); step('admin tukar status + catatan')
    pg.goto(B + '#/admin/pengguna'); pg.fill('[data-f=q]', BLOCK_Q); pg.wait_for_timeout(1200); pg.click('[data-manage]'); pg.click('[data-status=BLOCKED]')
    pg.fill('#cf-reason', 'Ujian'); pg.click('[data-ok]'); pg.wait_for_timeout(1000); assert 'Disekat' in pg.inner_text('[data-box]'); step('admin sekat pengguna')
    pg.goto(B + '#/admin/tetapan'); pg.wait_for_selector('#s-SYSTEM_TAGLINE'); pg.fill('#s-SYSTEM_TAGLINE', 'Slogan E2E'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1000)
    assert 'disimpan' in pg.inner_text('#toasts'); step('admin simpan tetapan')
    pg.goto(B + '#/admin/audit'); pg.wait_for_selector('table'); assert 'Pengguna disekat' in pg.inner_text('table'); step('audit merekod sekatan')

    # ---- semakan visual telefon (360px): tiada skrol mendatar
    m = b.new_page(viewport={'width': 360, 'height': 780}); m.route('https://fonts.**', lambda r: r.abort())
    m.goto(B + '#/log-masuk'); m.wait_for_selector('#f-email'); m.fill('#f-email', 'user@demo.local'); m.fill('#f-password', 'Demo1234'); m.click('button[type=submit]')
    m.wait_for_selector('.welcome')
    routes = ['/utama', '/notifikasi', '/profil'] + [x['path'] for x in MODS if x['nav'].get('user', True)]
    if USER_MOD: routes.append(USER_MOD['path'] + '/baru')
    for r in routes:
        m.goto(B + '#' + r); m.wait_for_timeout(700)
        over = m.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        m.screenshot(path=os.path.join(SHOTS, 'm' + r.replace('/', '_') + '.png'), full_page=True)
        assert over <= 1, 'skrol mendatar %dpx di %s' % (over, r)
    step('paparan telefon 360px tanpa skrol mendatar (' + str(len(routes)) + ' halaman, tangkapan di ' + SHOTS + '/)')
    # Halaman awam tambahan daripada paparan modul tersuai (KD.extraRoutes) + landing + borang awam
    m.evaluate('localStorage.clear();sessionStorage.clear()'); m.goto(B + '#/'); m.reload(); m.wait_for_timeout(800)
    extra = m.evaluate("(KD.extraRoutes || []).filter(function (r) { return r.access === 'public' && r.path.indexOf(':') < 0; }).map(function (r) { return r.path; })")
    pub = ['/'] + extra + (['/borang/' + PUB_MOD['key']] if PUB_MOD else [])
    for r in pub:
        m.goto(B + '#' + r); m.wait_for_timeout(900)
        over = m.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        m.screenshot(path=os.path.join(SHOTS, 'p' + (r.replace('/', '_') if r != '/' else '_landing') + '.png'), full_page=True)
        assert over <= 1, 'skrol mendatar %dpx di %s' % (over, r)
    step('halaman awam 360px tanpa skrol mendatar (' + ', '.join(pub) + ')')
    b.close()

print('\n%d langkah lulus.' % len(ok))
if errs:
    print('Ralat JavaScript:', errs); raise SystemExit(1)
