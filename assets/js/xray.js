// Garage — röntgen modu (xray.js). ui.js ilk kullanımda yükler: X tuşu ya da komut paleti.
// Sayfanın bölümlerini, onları oluşturan dosyalarla etiketler; her etiket GitHub'daki kaynağa gider.
// Bir geliştirici "bu nasıl yapılmış?" diye merak ettiğinde doğrudan doğru dosyaya ulaşsın diye.
(function () {
  'use strict';
  const G = window.GARAGE;
  const esc = G.esc, T = (tr, en) => G.t(tr, en);
  const REPO = (G.giscus && G.giscus.repo) || (() => { const u = String(G.github || '').split('/').pop(); return u ? u + '/' + u + '.github.io' : ''; })();
  const SRC = (f) => 'https://github.com/' + REPO + '/blob/main/' + f;
  const PAGE = () => { const p = location.pathname.split('/').pop() || 'index.html'; return /\.html$/.test(p) ? p : 'index.html'; };

  // seçici → [kaynak dosyalar, kısa açıklama]
  const MAP = [
    ['.site-header', ['assets/js/ui.js', 'assets/css/site.css'], ['üst bar · Atölye menüsü · plan · arama', 'top bar · workshop menu · plan · search']],
    ['.scene .hotspots', ['assets/js/intro.js', 'assets/css/intro.css', 'index.html'], ['tıklanabilir nesneler · kamera · odak', 'clickable objects · camera · focus']],
    ['.curved', ['assets/js/intro.js', 'assets/screen/'], ['kavisli monitör · ekran kareleri', 'curved monitor · screen frames']],
    ['.intro-ui.corner', ['assets/js/intro.js', 'assets/js/site.js'], ['garaj zamanı · ses · dil', 'garage time · sound · language']],
    ['.garage-stage, .bays', ['assets/js/garaj.js', 'assets/css/site.css'], ['iki kat, sekiz kapı · ışıklar · klavye 1–8 · asansör paneli', 'two floors, eight doors · lights · keys 1–8 · lift panel']],
    ['.routes', ['assets/js/site.js', 'assets/js/ui.js'], ['rotalar (G.ROUTES) · gezilen duraklar', 'routes (G.ROUTES) · visited stops']],
    ['.bench', ['assets/js/garaj.js'], ['tezgâh: terminal ve CV', 'bench: terminal and CV']],
    ['.sub-hero', [PAGE(), 'assets/css/site.css'], ['sayfa başlığı · anlatım düğmesi', 'page header · explanation switch']],
    ['.explain', ['assets/js/site.js', 'assets/js/ui.js'], ['Basit / Teknik (localStorage)', 'Simple / Technical (localStorage)']],
    ['#bp', ['assets/js/sema.js', 'assets/css/sema.css'], ['cache-aside simülasyonu · Polly · tek uçuş · 429', 'cache-aside simulation · Polly · single-flight · 429']],
    ['.bp-panels', ['assets/js/sema.js'], ['Redis TTL · Grafana · Graylog (GELF)', 'Redis TTL · Grafana · Graylog (GELF)']],
    ['#trace', ['assets/js/sema.js'], ['iz zaman çizelgesi (span’ler)', 'trace timeline (spans)']],
    ['#dash .dgrid.stats', ['assets/js/kontrol.js', 'assets/js/site.js'], ['Web Vitals · Navigation Timing', 'Web Vitals · Navigation Timing']],
    ['#wfPanel', ['assets/js/kontrol.js'], ['Resource Timing şelalesi', 'Resource Timing waterfall']],
    ['.dgrid.logs', ['assets/js/kontrol.js', 'assets/js/site.js'], ['Graylog sözdizimi ayrıştırıcısı · histogram', 'Graylog query parser · histogram']],
    ['#deploys', ['assets/js/kontrol.js', '.github/workflows/deploy.yml'], ['GitHub Actions API', 'GitHub Actions API']],
    ['#db', ['assets/js/veri.js', 'assets/js/query.js'], ['SQL ve mongosh ayrıştırıcıları (eval yok)', 'SQL and mongosh parsers (no eval)']],
    ['#oas', ['assets/js/api.js', 'scripts/build.mjs'], ['OpenAPI belgesi derlemede üretilir', 'the OpenAPI document is generated at build time']],
    ['.about-top', ['hakkimda.html', 'config.js', 'assets/js/page.js'], ['profil kartı · deneyim config.js’ten', 'profile card · experience from config.js']],
    ['.about-main .api', ['assets/js/page.js', 'config.js'], ['canlı JSON görünümü', 'live JSON view']],
    ['#tezgah', ['hakkimda.html', 'config.js'], ['şu an tezgâhta', 'on the bench now']],
    ['.workbench', ['assets/js/page.js', 'config.js'], ['takım çantası verisi config.js’te', 'toolbox data lives in config.js']],
    ['.intercom', ['assets/js/page.js', 'assets/js/qr.js'], ['diyafon · QR · vCard', 'intercom · QR · vCard']],
    ['.guestbook', ['assets/js/page.js', 'config.js'], ['giscus ziyaretçi defteri', 'giscus guestbook']],
    ['.blog', ['posts/index.json', 'assets/js/blog.js'], ['yazı listesi · etiket süzgeci', 'post list · tag filter']],
    ['#post', ['assets/js/blog.js', 'posts/', 'scripts/build.mjs'], ['Markdown işleyici · sayfa yayında önceden çizilir (yazi/<slug>.html)', 'Markdown renderer · pre-rendered at deploy (yazi/<slug>.html)']],
    ['.sheet', ['cv.html', 'config.js', 'assets/js/qr.js'], ['tek sayfa CV · QR', 'one-page CV · QR']],
    ['.route-nav', ['assets/js/ui.js', 'assets/js/site.js'], ['rota çubuğu', 'route bar']],
    ['.site-footer', ['assets/js/site.js', 'scripts/build.mjs'], ['sürüm bilgisi (build.json)', 'build info (build.json)']],
    ['.dock', ['assets/js/ui.js'], ['mobil alt menü', 'mobile dock']],
    ['.term-window', ['assets/js/terminal.js', 'assets/js/query.js'], ['terminal · borular · jq · mongosh', 'terminal · pipes · jq · mongosh']],
    ['.plan-panel', ['assets/js/plan.js'], ['kat planı (SVG)', 'floor plan (SVG)']]
  ];

  let on = false, layer = null, banner = null, raf = 0;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
  function targets() {
    const out = [], seen = new Set();
    MAP.forEach(([sel, files, note]) => {
      let els = [];
      try { els = [...document.querySelectorAll(sel)]; } catch (e) { els = []; }
      els.filter((el) => !seen.has(el) && !el.closest('.xray-layer') && el.getClientRects().length).slice(0, 1).forEach((el) => { seen.add(el); out.push({ el, files, note }); });
    });
    return out;
  }
  function draw() {
    raf = 0;
    if (!on) return;
    const items = targets().filter((t) => visible(t.el));
    const placed = [];
    layer.innerHTML = items.map((t, i) => {
      const r = t.el.getBoundingClientRect();
      const x = Math.max(4, r.left), y = Math.max(4, r.top), w = Math.min(innerWidth - 8, r.right) - x, h = Math.min(innerHeight - 8, r.bottom) - y;
      // etiketler üst üste binmesin: çakışırsa aşağı kaydır
      let ty = y + 6;
      for (let k = 0; k < 12 && placed.some((p) => Math.abs(p.x - (x + 6)) < 260 && Math.abs(p.y - ty) < 30); k++) ty += 30;
      placed.push({ x: x + 6, y: ty });
      return '<div class="xr-box" style="left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px"></div>' +
        '<div class="xr-tag" style="left:' + (x + 6) + 'px;top:' + ty + 'px">' +
          t.files.map((f) => '<a href="' + esc(SRC(f)) + '" target="_blank" rel="noopener">' + esc(f) + '</a>').join('<span>+</span>') +
          '<small>' + esc(T(t.note[0], t.note[1])) + '</small></div>';
    }).join('');
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function stats() {
    const res = performance.getEntriesByType('resource');
    const js = res.filter((r) => /\.m?js(\?|$)/.test(r.name)).length, css = res.filter((r) => /\.css(\?|$)/.test(r.name)).length;
    const nav = (performance.getEntriesByType('navigation') || [])[0];
    const bytes = res.reduce((a, r) => a + (r.transferSize || 0), nav ? nav.transferSize || 0 : 0);
    return T(PAGE() + ' · ' + js + ' JS · ' + css + ' CSS · ' + document.getElementsByTagName('*').length + ' DOM düğümü · ' + Math.round(bytes / 1024) + ' KB aktarım',
      PAGE() + ' · ' + js + ' JS · ' + css + ' CSS · ' + document.getElementsByTagName('*').length + ' DOM nodes · ' + Math.round(bytes / 1024) + ' KB transferred');
  }
  function open() {
    if (on) return;
    on = true;
    document.documentElement.classList.add('xray');
    layer = document.createElement('div'); layer.className = 'xray-layer'; layer.setAttribute('aria-hidden', 'false');
    banner = document.createElement('div'); banner.className = 'xr-banner'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', T('Röntgen modu', 'X-ray mode'));
    banner.innerHTML = '<b>' + esc(T('RÖNTGEN', 'X-RAY')) + '</b><span class="mono">' + esc(stats()) + '</span>' +
      '<a class="mono" href="https://github.com/' + esc(REPO) + '" target="_blank" rel="noopener">' + esc(REPO) + ' ↗</a>' +
      '<button type="button" class="xr-x">' + esc(T('Kapat', 'Close')) + ' <kbd>X</kbd></button>';
    document.body.appendChild(layer); document.body.appendChild(banner);
    banner.querySelector('.xr-x').addEventListener('click', close);
    addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule);
    draw();
    G.metrics.inc('garage_xray_toggles_total', { state: 'on' });
    G.log('info', 'xray on', { page: G.page() });
    banner.querySelector('.xr-x').focus({ preventScroll: true });
  }
  function close() {
    if (!on) return;
    on = false;
    document.documentElement.classList.remove('xray');
    removeEventListener('scroll', schedule); removeEventListener('resize', schedule);
    if (layer) layer.remove(); if (banner) banner.remove();
    layer = banner = null;
    G.metrics.inc('garage_xray_toggles_total', { state: 'off' });
  }
  document.addEventListener('keydown', (e) => { if (on && e.key === 'Escape') close(); });
  document.addEventListener('garage:lang', () => { if (on) { close(); open(); } });
  window.GarageXray = { toggle: () => (on ? close() : open()), open, close, isOn: () => on };
})();
