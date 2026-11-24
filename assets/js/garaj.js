// Garaj (garaj.js) — kapılar, mobilde kaydırılan kapı dizisi, ışık şalteri ve el feneri,
// fareyle eğilen cephe (derinlik), tabeladaki canlı durum ve tezgâhtaki canlı veriler.
(function () {
  'use strict';
  const G = window.GARAGE;
  const $ = (id) => document.getElementById(id);
  const bays = Array.from(document.querySelectorAll('.bay'));
  if (!bays.length) return;
  // İki kat: zemin (garaj) ve alt kat (atölye). Her katın kendi kapı dizisi ve (mobilde) noktaları var.
  const garages = Array.from(document.querySelectorAll('.garage'));
  const FLOORS = Array.from(document.querySelectorAll('.garage-stage')).map((st) => ({ track: st.querySelector('.bays'), dots: st.querySelector('.bay-dots'), bays: Array.from(st.querySelectorAll('.bay')) }));
  const floorOf = (bay) => FLOORS.find((f) => f.bays.includes(bay));
  const openLabel = $('open-label'), live = $('bayLive');
  const mqMobile = window.matchMedia('(max-width: 760px)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const bayName = (b) => G.tx({ tr: b.dataset.name, en: b.dataset.nameEn });
  const bayLabel = (b) => (G.lang() === 'en' && b.dataset.labelEn) || b.dataset.label;
  const typingIn = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // =================================================================== KAPILAR
  let current = null, holdFocusOpen = false;
  function setOpen(bay, quiet) {
    if (bay === current) return;
    current = bay;
    bays.forEach((b) => {
      const on = b === bay;
      b.classList.toggle('is-open', on);
      b.querySelector('.door').setAttribute('aria-expanded', String(on));
    });
    if (openLabel) openLabel.textContent = bay ? bayLabel(bay) : G.t('yok', 'none');
    if (bay && !quiet) {
      G.sfx('door');
      G.metrics.inc('garage_doors_opened_total', { bay: bay.id });
      if (live) live.textContent = G.t('Kapı açıldı: ', 'Door open: ') + bayName(bay);
    }
    renderDots();
  }
  G.openBay = function (n, fromKeyboard) {
    const bay = bays[n - 1];
    if (!bay) return;
    if (mqMobile.matches) scrollToBay(bay);
    const r = bay.getBoundingClientRect();   // sadece dikeyde kaydır (yatay dizi ayrıca ortalanır)
    if (r.top < 70 || r.bottom > window.innerHeight) window.scrollTo({ top: window.scrollY + r.top - Math.max(80, (window.innerHeight - r.height) / 2), behavior: G.reduce ? 'auto' : 'smooth' });
    setOpen(bay);
    if (fromKeyboard) setTimeout(() => { const cta = bay.querySelector('.cta'); if (cta) cta.focus({ preventScroll: true }); }, G.reduce ? 0 : 450);
  };

  bays.forEach((bay) => {
    const door = bay.querySelector('.door');
    door.addEventListener('click', () => { if (mqMobile.matches) scrollToBay(bay); setOpen(bay); });
    bay.addEventListener('focusin', () => { if (!holdFocusOpen) setOpen(bay); });
    bay.addEventListener('mouseenter', () => { if (finePointer.matches) setOpen(bay); });
    // Metal kapıda ışık yansıması fareyi izler (kare başına bir kez)
    let q = false, px = 0, py = 0;
    door.addEventListener('pointermove', (e) => {
      px = e.clientX; py = e.clientY;
      if (q) return; q = true;
      requestAnimationFrame(() => {
        q = false;
        const r = door.getBoundingClientRect();
        door.style.setProperty('--mx', ((px - r.left) / r.width * 100).toFixed(1) + '%');
        door.style.setProperty('--my', ((py - r.top) / r.height * 100).toFixed(1) + '%');
      });
    });
  });
  // Garajın dışına tıklanınca (masaüstünde) açık kapı kapanır
  document.addEventListener('click', (e) => {
    if (mqMobile.matches || !current || e.target.closest('.bay, .overlay, .site-header, .bay-dots')) return;
    setOpen(null);
  });

  // Bölüme girerken: kapı tamamen açılsın, sonra sayfaya geç (orada kepenk kalkar)
  document.querySelectorAll('.bay .cta[href]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (G.reduce || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      setOpen(a.closest('.bay'), true);
      document.body.classList.add('leaving');
      setTimeout(() => { location.href = a.getAttribute('href'); }, 360);
    });
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) document.body.classList.remove('leaving'); });

  function fromHash() {
    const bay = bays.find((b) => '#' + b.id === location.hash);
    if (!bay) return false;
    if (mqMobile.matches) scrollToBay(bay, true);
    setOpen(bay, true);
    return true;
  }
  window.addEventListener('hashchange', fromHash);

  // =================================================================== MOBİL: KAYDIRILAN KAPILAR
  // Ortadaki kapı kendiliğinden açılır; alttaki noktalar hangi kapıda olduğunu gösterir.
  function scrollToBay(bay, instant) {
    const f = floorOf(bay);
    if (!f || !f.track) return;
    const left = bay.offsetLeft - (f.track.clientWidth - bay.clientWidth) / 2;
    f.track.scrollTo({ left, behavior: instant || G.reduce ? 'auto' : 'smooth' });
  }
  function centered(f) {
    const mid = f.track.scrollLeft + f.track.clientWidth / 2;
    let best = f.bays[0], d = Infinity;
    f.bays.forEach((b) => { const c = b.offsetLeft + b.clientWidth / 2, dd = Math.abs(c - mid); if (dd < d) { d = dd; best = b; } });
    return best;
  }
  function renderDots() {
    FLOORS.forEach((f) => {
      if (!f.dots) return;
      const active = current && f.bays.includes(current) ? current : (mqMobile.matches && f.track ? centered(f) : null);
      f.dots.querySelectorAll('button').forEach((btn, i) => btn.setAttribute('aria-current', String(f.bays[i] === active)));
    });
  }
  FLOORS.forEach((f) => {
    if (f.dots) {
      f.dots.innerHTML = f.bays.map((b, i) => '<button type="button" tabindex="-1" aria-label="' + G.esc(bayName(b)) + '" data-i="' + i + '"></button>').join('');
      f.dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { scrollToBay(f.bays[+b.dataset.i]); setOpen(f.bays[+b.dataset.i]); } });
    }
    let st = 0;
    if (f.track) f.track.addEventListener('scroll', () => {
      if (!mqMobile.matches) return;
      clearTimeout(st);
      st = setTimeout(() => setOpen(centered(f)), 110);
    }, { passive: true });
  });

  // =================================================================== KATLAR (asansör paneli)
  const lift = document.querySelector('.lift'), floorEls = Array.from(document.querySelectorAll('.floor[data-floor]'));
  function goFloor(n) {
    const el = floorEls.find((f) => f.dataset.floor === String(n));
    if (!el) return;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 76, behavior: G.reduce ? 'auto' : 'smooth' });
    G.sfx('click');
    G.metrics.inc('garage_floor_changes_total', { floor: String(n) });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-floor-go], .lift a[data-floor]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    goFloor(a.dataset.floorGo || a.dataset.floor);
  });
  if (lift && 'IntersectionObserver' in window) {
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => seen.set(en.target.dataset.floor, en.intersectionRatio));
      let best = '0', r = -1;
      seen.forEach((v, k) => { if (v > r) { r = v; best = k; } });
      lift.querySelectorAll('a[data-floor]').forEach((a) => { if (a.dataset.floor === best) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      lift.classList.toggle('show', r > 0);
    }, { threshold: [0, .15, .3, .5, .7, 1] });
    floorEls.forEach((f) => io.observe(f));
  }

  // =================================================================== KLAVYE
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || (G.topLayer && G.topLayer())) return;
    if (/^[1-8]$/.test(e.key) && bays[+e.key - 1]) { e.preventDefault(); G.openBay(+e.key, true); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setLights(document.body.classList.contains('lights-off')); }
    else if (e.key === 'Escape' && current && !mqMobile.matches) {
      const f = document.activeElement, inBay = f && f.closest && f.closest('.bay');
      setOpen(null);
      if (inBay) { holdFocusOpen = true; inBay.querySelector('.door').focus({ preventScroll: true }); holdFocusOpen = false; }
    }
  });

  // =================================================================== IŞIK ŞALTERİ + EL FENERİ
  const sw = $('lightSwitch'), flash = document.querySelector('.flashlight');
  function setLights(on, quiet) {
    document.body.classList.toggle('lights-off', !on);
    if (sw) sw.setAttribute('aria-checked', String(on));
    G.store.sset('garage-lights', on ? null : 'off');
    if (!quiet) {
      G.sfx('click');
      G.metrics.inc('garage_light_toggles_total', { to: on ? 'on' : 'off' });
      G.toast(on ? G.t('Işıklar açık', 'Lights on') : G.t('Işıklar kapalı — imleç artık bir el feneri', 'Lights off — your cursor is a flashlight'), 'bulb');
    }
    if (!on) moveFlash(lastX, lastY);
  }
  if (sw) sw.addEventListener('click', () => setLights(document.body.classList.contains('lights-off')));
  let lastX = window.innerWidth / 2, lastY = window.innerHeight * 0.45;
  function moveFlash(x, y) {   // sadece transform: kare başına yeniden boyama yok
    lastX = x; lastY = y;
    if (flash && document.body.classList.contains('lights-off')) flash.style.transform = 'translate3d(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px,0)';
  }
  window.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) moveFlash(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) moveFlash(t.clientX, t.clientY); }, { passive: true });
  if (G.store.sget('garage-lights') === 'off') setLights(false, true);

  // =================================================================== DERİNLİK: toz + eğilen cephe
  const dust = window.GarageFX ? window.GarageFX.dust($('dust'), { count: window.innerWidth < 700 ? 30 : 70 }) : null;
  let pending = false, px = 0, py = 0, mouse = false;
  window.addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY; mouse = e.pointerType === 'mouse';
    if (!pending) { pending = true; requestAnimationFrame(applyPointer); }
  }, { passive: true });
  function applyPointer() {
    pending = false;
    const mx = px / window.innerWidth - 0.5, my = py / window.innerHeight - 0.5;
    if (dust) dust.setOffset(-mx, -my);
    moveFlash(px, py);
    if (garages.length && !G.reduce && mouse && !mqMobile.matches && !G.lite()) garages.forEach((g) => { g.style.transform = 'rotateX(' + (-my * 4).toFixed(2) + 'deg) rotateY(' + (mx * 6).toFixed(2) + 'deg)'; });
  }
  mqMobile.addEventListener('change', () => { garages.forEach((g) => { g.style.transform = ''; }); setOpen(null, true); renderDots(); });

  // =================================================================== TABELA: saat, atölye, yükleme süresi
  const timeEl = $('local-time'), wsIco = $('ws-ico'), wsText = $('ws-text'), wsDetail = $('ws-detail');
  // Atölye simgesi: açıkken buharı tüten kupa, kapalıyken soğumuş kupa, gece ay
  const MOON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"/></svg>';
  const MUG = wsIco ? wsIco.innerHTML : '';
  function tick() {
    if (timeEl) timeEl.textContent = G.localTime();
    const w = G.workshopStatus();
    if (wsText) {
      wsText.textContent = w.text; wsDetail.textContent = w.detail;
      const night = !w.open && G.realPhase() === 'night';
      const mode = w.open ? 'open' : (night ? 'night' : 'closed');
      if (wsIco.dataset.mode !== mode) { wsIco.dataset.mode = mode; wsIco.innerHTML = night ? MOON : MUG; wsIco.className = 'ws-ico ' + mode; }
    }
  }
  tick(); setInterval(tick, 20000);

  // Hava durumu (Open-Meteo): anahtar yok, çerez yok; 30 dk sekmede saklanır. config.js → weather.enabled
  const wxEl = $('wx');
  const WX_KEY = 'garage-wx', WX_TTL = 30 * 60 * 1000;
  const WX = [
    [[0], 'sun', 'açık', 'clear'], [[1], 'sun', 'az bulutlu', 'mainly clear'], [[2], 'cloudsun', 'parçalı bulutlu', 'partly cloudy'], [[3], 'cloud', 'kapalı', 'overcast'],
    [[45, 48], 'fog', 'sisli', 'fog'], [[51, 53, 55], 'rain', 'çisenti', 'drizzle'], [[56, 57], 'rain', 'dondurucu çisenti', 'freezing drizzle'],
    [[61, 63, 65], 'rain', 'yağmurlu', 'rain'], [[66, 67], 'rain', 'dondurucu yağmur', 'freezing rain'], [[71, 73, 75, 77], 'snow', 'karlı', 'snow'],
    [[80, 81, 82], 'rain', 'sağanak', 'showers'], [[85, 86], 'snow', 'kar sağanağı', 'snow showers'], [[95], 'storm', 'gök gürültülü', 'thunderstorm'], [[96, 99], 'storm', 'dolulu fırtına', 'hailstorm']
  ];
  const WX_ICO = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"/>',
    cloudsun: '<path d="M8 2.5v1.5M3.2 4.7l1 1M12.8 4.7l-1 1M2 9.5h1.5"/><path d="M5.3 11.6a3.5 3.5 0 0 1 6.2-3.4"/><path d="M8.5 20h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8.5 20z"/>',
    cloud: '<path d="M7 19h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 19z"/>',
    fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
    rain: '<path d="M7 15h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    snow: '<path d="M7 15h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/>',
    storm: '<path d="M7 15h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'
  };
  let wxData = null;
  function renderWx() {
    if (!wxEl || !wxData) return;
    const c = wxData.current || {};
    const row = WX.find((r) => r[0].includes(c.weather_code)) || [[], 'cloud', '', ''];
    const ico = c.is_day === 0 ? (row[1] === 'sun' ? 'moon' : row[1] === 'cloudsun' ? 'cloud' : row[1]) : row[1];   // gece güneş çizme
    const t = Math.round(c.temperature_2m);
    const label = G.t(row[2], row[3]);
    wxEl.innerHTML = ' · <svg class="ico wx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + WX_ICO[ico] + '</svg><strong>' + t + '°C</strong><span class="vh"> ' + G.esc(label) + '</span>';
    wxEl.title = label + (c.wind_speed_10m != null ? G.t(' · rüzgâr ', ' · wind ') + Math.round(c.wind_speed_10m) + ' km/h' : '') + ' · Open-Meteo';
    wxEl.hidden = false;
  }
  function loadWx() {
    const cfg = G.weather || {};
    if (!wxEl || !cfg.enabled || (navigator.connection && navigator.connection.saveData)) return;   // veri tasarrufu açıksa hiç istemez
    const cached = G.store.json(WX_KEY, true);
    if (cached && Date.now() - cached.at < WX_TTL) { wxData = cached.d; renderWx(); return; }
    if (!navigator.onLine) return;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.latitude + '&longitude=' + cfg.longitude +
      '&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=' + encodeURIComponent(G.timeZone || 'Europe/Istanbul');
    const t0 = performance.now();
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 6000);
    fetch(url, ctl ? { signal: ctl.signal } : {}).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((d) => {
      clearTimeout(to);
      if (!d || !d.current || typeof d.current.temperature_2m !== 'number') throw new Error('bad payload');
      wxData = { current: d.current };
      G.store.setJson(WX_KEY, { at: Date.now(), d: wxData }, true);
      G.log('info', 'GET api.open-meteo.com/v1/forecast 200', { ms: Math.round(performance.now() - t0), code: d.current.weather_code });
      renderWx();
    }).catch((e) => { clearTimeout(to); G.log('warn', 'weather unavailable', { error: String(e && e.message || e) }); });
  }
  if ('requestIdleCallback' in window) requestIdleCallback(loadWx, { timeout: 2500 }); else setTimeout(loadWx, 1200);

  // Gezilen bölmeler: kepenk şeridinde küçük yeşil durum ışığı
  function markSeen() {
    const v = G.visited();
    document.querySelectorAll('.bay').forEach((bay) => {
      const a = bay.querySelector('a.cta'); if (!a) return;
      const id = (a.getAttribute('href') || '').replace(/\.html.*$/, '');
      bay.classList.toggle('seen', v.has(id));
    });
  }
  markSeen();
  document.addEventListener('garage:visited', markSeen);

  // Seyir Defteri kapısının arkasında son kayıt
  const latestEl = $('latestPost');
  function showLatest() {
    if (!latestEl || !G.blog) return;
    G.blog.list().then((posts) => {
      if (!posts.length) { latestEl.textContent = ''; return; }
      const p = posts[0];
      latestEl.innerHTML = '<span>' + G.t('son kayıt', 'latest') + ' · ' + G.blog.fmtDate(p.date) + '</span><br><a href="' + G.postUrl(p.slug) + '">' + G.esc(p.title) + '</a>';
    }).catch(() => { latestEl.textContent = ''; });
  }
  showLatest();

  // =================================================================== TEZGÂH: canlı veriler
  function spark(values, w, h) {
    if (values.length < 2) return '';
    const max = Math.max(...values) * 1.15 || 1, min = 0, step = w / (values.length - 1);
    const pts = values.map((v, i) => (i * step).toFixed(1) + ',' + (h - 2 - (h - 4) * (v - min) / (max - min)).toFixed(1));
    return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#4FD18B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<polygon points="0,' + h + ' ' + pts.join(' ') + ' ' + w + ',' + h + '" fill="rgba(79,209,139,.12)"/>' +
      '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="3" fill="#4FD18B"/>';
  }
  function renderBench() {
    const views = G.metrics.views();
    const loads = views.map((v) => v.load).slice(-24);
    const svg = $('tcSpark');
    if (svg) {
      svg.innerHTML = '<line class="grid" x1="0" x2="240" y1="20" y2="20"/><line class="grid" x1="0" x2="240" y1="50" y2="50"/>' +
        (loads.length >= 2 ? spark(loads, 240, 70) : spark([620, 540, 580, 470, 510, 430, 460, 420], 240, 70));
    }
    const lt = $('tcLoads');
    if (lt) {
      const last = views[views.length - 1];
      lt.textContent = last ? G.t('bu oturum: ', 'this session: ') + views.length + G.t(' sayfa · son yükleme ', ' pages · last load ') + last.load + ' ms' : G.t('ölçülüyor…', 'measuring…');
    }
    const ct = $('tcCache');
    if (ct) {
      const keys = G.redis.keys('cache:*').length, hit = G.metrics.sum('garage_sim_cache_hits_total'), miss = G.metrics.sum('garage_sim_cache_misses_total');
      ct.textContent = hit + miss ? G.t('önbellek: ', 'cache: ') + keys + G.t(' anahtar · isabet %', ' keys · hit ') + Math.round(hit / (hit + miss) * 100) + G.t('', '%') : G.t('henüz istek yok — ilkini sen gönder', 'no requests yet — send the first one');
    }
    const db = $('tcDb');
    if (db) {
      const last = G.store.json('garage-db-last', true);
      db.textContent = last && last.q ? G.t('son sorgu: ', 'last query: ') + last.q.replace(/\s+/g, ' ').slice(0, 42) + (last.q.length > 42 ? '…' : '') + ' · ' + (last.errors ? G.t('hata', 'error') : last.rows + G.t(' satır', ' rows'))
        : G.t('12 tablo · içerik + bu ziyaret', '12 tables · content + this visit');
    }
    const lm = $('loadMs');
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (lm && nav && nav.loadEventEnd) G.odo(lm, String(Math.round(nav.loadEventEnd - nav.startTime)));
  }
  window.addEventListener('load', () => setTimeout(renderBench, 120));
  document.addEventListener('garage:redis', renderBench);

  // Terminal kartındaki ekran: örnek komutlar yazılır (görünürken)
  const typed = $('tcTyped');
  if (typed && !G.reduce && 'IntersectionObserver' in window) {
    const cmds = ['curl -i /health', "curl /api/stack.json | jq '.drawers[].name'", 'redis-cli KEYS cache:*', 'sql SELECT name FROM skills', 'mongosh', 'map'];
    let ci = 0, timer = 0, visible = false;
    const type = () => {
      const c = cmds[ci++ % cmds.length]; let i = 0;
      clearInterval(timer);
      timer = setInterval(() => { typed.textContent = c.slice(0, ++i); if (i >= c.length) { clearInterval(timer); timer = setTimeout(() => { if (visible) type(); }, 2200); } }, 70);
    };
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) type(); else { clearInterval(timer); clearTimeout(timer); } }).observe(typed);
  }

  // =================================================================== GEÇİŞLER VE BAŞLANGIÇ
  if (G.store.sget('garage-from-intro')) { G.store.sset('garage-from-intro', null); document.body.classList.add('from-intro'); }
  document.addEventListener('garage:lang', () => { tick(); showLatest(); renderBench(); renderWx(); if (openLabel) openLabel.textContent = current ? bayLabel(current) : G.t('yok', 'none'); FLOORS.forEach((f) => { if (f.dots) f.dots.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-label', bayName(f.bays[i]))); }); });
  if (!fromHash() && mqMobile.matches) setTimeout(() => { if (!current) setOpen(centered(FLOORS[0]), true); }, G.reduce ? 0 : 700);
  renderDots();
})();
