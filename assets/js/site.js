// Garage — çekirdek (site.js). Her sayfada config.js'ten hemen sonra, <head> içinde yüklenir.
// İçerik: depolama · dil (TR/EN) · Kocaeli saati ve gün döngüsü · ses · telemetri (metrik + log)
//         · paylaşılan mini Redis · ikonlar · service worker kaydı · build bilgisi
(function () {
  'use strict';
  const G = window.GARAGE;
  const WS = G.workshop && G.workshop.days ? G.workshop : { days: [1, 2, 3, 4, 5], open: 9, close: 18 };
  G.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  G.touch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  // ===================================================================== DEPOLAMA
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const store = {
    get: (k) => safe(() => localStorage.getItem(k), null),
    set: (k, v) => safe(() => localStorage.setItem(k, v)),
    sget: (k) => safe(() => sessionStorage.getItem(k), null),
    sset: (k, v) => safe(() => (v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v))),
    json: (k, session) => safe(() => JSON.parse((session ? sessionStorage : localStorage).getItem(k)), null),
    setJson: (k, v, session) => safe(() => (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)))
  };
  G.store = store;
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent('garage:' + name, { detail }));
  G.emit = emit;

  // Sayfanın kısa adı (telemetri ve menüler için)
  G.page = function () {
    const b = document.body && document.body.dataset.page;
    if (b) return b;
    const f = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    return f === 'index' || f === '' ? 'giris' : f;
  };

  // Bölme sayfalarında kepenk animasyonu: oturumdaki ilk girişte tam, sonrakilerde hızlı
  if (store.sget('garage-curtain')) document.documentElement.classList.add('curtain-quick');

  // ===================================================================== DİL
  // HTML'de Türkçe yazılır, İngilizcesi data-en özniteliğine konur.
  // data-en-label → aria-label, data-en-title → title, data-en-placeholder → placeholder, data-en-content → content
  const saved = store.get('garage-lang');
  let lang = saved || ((navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en');
  // İngilizce seçiliyse sayfa çevrilene kadar gövde gizli kalır (CSS, 1,2 sn sonra her durumda gösterir)
  if (lang === 'en') document.documentElement.classList.add('i18n-pending');
  G.lang = () => lang;
  G.t = (tr, en) => (lang === 'en' && en != null ? en : tr);
  G.tx = (obj) => (obj && typeof obj === 'object' ? (obj[lang] || obj.tr) : obj);
  const ATTRS = [['label', 'aria-label'], ['title', 'title'], ['placeholder', 'placeholder'], ['content', 'content'], ['alt', 'alt']];
  function applyLang(root) {
    const scope = root || document;
    document.documentElement.lang = lang;
    document.documentElement.classList.remove('i18n-pending');
    scope.querySelectorAll('[data-en]').forEach((el) => {
      if (el.dataset.tr == null) el.dataset.tr = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.tr;
    });
    ATTRS.forEach(([key, attr]) => {
      const cap = key[0].toUpperCase() + key.slice(1);
      scope.querySelectorAll('[data-en-' + key + ']').forEach((el) => {
        if (el.dataset['tr' + cap] == null) el.dataset['tr' + cap] = el.getAttribute(attr) || '';
        el.setAttribute(attr, lang === 'en' ? el.dataset['en' + cap] : el.dataset['tr' + cap]);
      });
    });
  }
  G.applyLang = applyLang;
  G.setLang = function (l) {
    lang = l === 'en' ? 'en' : 'tr';
    store.set('garage-lang', lang);
    applyLang();
    renderControls();
    G.metrics.inc('garage_lang_switches_total', { to: lang });
    G.log('info', 'language changed', { lang });
    emit('lang', lang);
  };

  // ===================================================================== SAAT, GÜN DÖNGÜSÜ, ATÖLYE
  function parts(d) {
    try {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: G.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false }).formatToParts(d || new Date());
      const get = (t) => (p.find((x) => x.type === t) || {}).value;
      const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get('weekday')] || 1;
      return { h: parseInt(get('hour'), 10) % 24, m: parseInt(get('minute'), 10), s: parseInt(get('second'), 10), wd };
    } catch (e) { const n = d || new Date(); return { h: n.getHours(), m: n.getMinutes(), s: n.getSeconds(), wd: n.getDay() || 7 }; }
  }
  G.timeParts = parts;
  const pad = (n) => String(n).padStart(2, '0');
  G.localTime = function (withSec) { const p = parts(); return pad(p.h) + ':' + pad(p.m) + (withSec ? ':' + pad(p.s) : ''); };

  const PHASES = ['morning', 'day', 'evening', 'night'];
  const PHASE_NAMES = { morning: { tr: 'sabah', en: 'morning' }, day: { tr: 'gündüz', en: 'daytime' }, evening: { tr: 'akşam', en: 'evening' }, night: { tr: 'gece', en: 'night' } };
  G.PHASES = PHASES;
  G.phaseName = (ph) => G.tx(PHASE_NAMES[ph]);
  G.realPhase = function () {
    const h = parts().h, b = G.phases;
    if (h >= b.night || h < b.morning) return 'night';
    if (h >= b.evening) return 'evening';
    if (h >= b.day) return 'day';
    return 'morning';
  };
  G.phaseOverride = () => { const v = store.sget('garage-phase'); return PHASES.includes(v) ? v : null; };
  G.phase = () => G.phaseOverride() || G.realPhase();
  G.setPhase = function (ph) { store.sset('garage-phase', PHASES.includes(ph) ? ph : null); applyPhase(); };
  G.cyclePhase = function () {
    const order = [null, ...PHASES];
    const next = order[(order.indexOf(G.phaseOverride()) + 1) % order.length];
    G.setPhase(next);
    return next;
  };
  function applyPhase() {
    const ph = G.phase();
    PHASES.forEach((p) => document.documentElement.classList.toggle('phase-' + p, p === ph));
    document.documentElement.classList.toggle('phase-preview', !!G.phaseOverride());
    emit('phase', ph);
  }
  G.applyPhase = applyPhase;

  // Türkçe saat eki: 09:00’da, 08:00’de, 13:00’te (saatin okunuşuna göre)
  const HOUR_SUFFIX = ['da', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da', 'da', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da', 'de', 'de', 'de', 'te'];
  const DAY_SHORT = { tr: ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'], en: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
  G.workshopStatus = function () {
    const p = parts();
    const isDay = WS.days.includes(p.wd);
    const open = isDay && p.h >= WS.open && p.h < WS.close;
    const hh = (h) => pad(h) + ':00';
    if (open) return { open: true, text: G.t('atölye açık', 'workshop open'), detail: G.t('kapanış ' + hh(WS.close), 'closes ' + hh(WS.close)) };
    let wd = p.wd;
    const today = isDay && p.h < WS.open;
    if (!today) { for (let i = 1; i <= 7; i++) { const d = ((p.wd - 1 + i) % 7) + 1; if (WS.days.includes(d)) { wd = d; break; } } }
    const when = today ? G.t('bugün', 'today') : (wd === (p.wd % 7) + 1 ? G.t('yarın', 'tomorrow') : DAY_SHORT[lang][wd]);
    return { open: false, text: G.t('atölye kapalı', 'workshop closed'), detail: G.t(when + ' ' + hh(WS.open) + '’' + HOUR_SUFFIX[WS.open % 24] + ' açılır', 'opens ' + when + ' ' + hh(WS.open)) };
  };

  // ===================================================================== TELEMETRİ
  // Tamamen bu sekmede kalır (sessionStorage); hiçbir sunucuya gönderilmez.
  // Metrikler Prometheus'un metin biçiminde dışa verilebilir; loglar Graylog benzeri yapılandırılmış kayıtlardır.
  const TKEY = 'garage-telemetry-v1';
  const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  const META = {
    garage_page_views_total: ['counter', 'Sayfa görüntüleme sayısı', 'Page views'],
    garage_page_load_seconds: ['histogram', 'Gezinmeden load olayına kadar geçen süre', 'Time from navigation to the load event'],
    garage_ttfb_seconds: ['gauge', 'İlk bayta kadar geçen süre (son sayfa)', 'Time to first byte (last page)'],
    garage_lcp_seconds: ['gauge', 'Largest Contentful Paint (son sayfa)', 'Largest Contentful Paint (last page)'],
    garage_cls: ['gauge', 'Cumulative Layout Shift (son sayfa)', 'Cumulative Layout Shift (last page)'],
    garage_inp_seconds: ['gauge', 'Interaction to Next Paint: en yavaş etkileşim (son sayfa)', 'Interaction to Next Paint: slowest interaction (last page)'],
    garage_transfer_bytes_total: ['counter', 'Ağdan indirilen bayt', 'Bytes transferred'],
    garage_doors_opened_total: ['counter', 'Açılan garaj kapısı', 'Garage doors opened'],
    garage_terminal_commands_total: ['counter', 'Terminal komutu', 'Terminal commands'],
    garage_palette_opens_total: ['counter', 'Komut paleti açılışı', 'Command palette opens'],
    garage_lang_switches_total: ['counter', 'Dil değişimi', 'Language switches'],
    garage_light_toggles_total: ['counter', 'Işık şalteri', 'Light switch toggles'],
    garage_js_errors_total: ['counter', 'Yakalanan JavaScript hatası', 'Uncaught JavaScript errors'],
    garage_session_seconds: ['gauge', 'Oturum süresi', 'Session age'],
    garage_fps: ['gauge', 'Son ölçülen kare hızı', 'Last measured frame rate'],
    garage_quality: ['gauge', 'Görsel kalite: 1 tam, 0 hafif mod', 'Visual quality: 1 full, 0 lite mode'],
    garage_sim_http_requests_total: ['counter', 'Şema simülasyonu: HTTP istekleri', 'Blueprint simulation: HTTP requests'],
    garage_sim_cache_hits_total: ['counter', 'Şema simülasyonu: önbellek isabeti', 'Blueprint simulation: cache hits'],
    garage_sim_cache_misses_total: ['counter', 'Şema simülasyonu: önbellek ıskası', 'Blueprint simulation: cache misses'],
    garage_sim_request_duration_seconds: ['histogram', 'Şema simülasyonu: istek süresi', 'Blueprint simulation: request duration'],
    garage_sim_breaker_open_total: ['counter', 'Şema simülasyonu: devre kesicinin açılma sayısı', 'Blueprint simulation: circuit breaker trips']
  };
  let T = store.json(TKEY, true);
  if (!T || !T.c) T = { since: Date.now(), c: {}, g: {}, h: {}, logs: [], views: [] };
  let saveTimer = 0;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.setJson(TKEY, T, true), 400); };
  const lkey = (name, labels) => {
    const ks = labels ? Object.keys(labels).sort() : [];
    return name + (ks.length ? '{' + ks.map((k) => k + '="' + String(labels[k]).replace(/["\\\n]/g, '_') + '"').join(',') + '}' : '');
  };
  G.metrics = {
    inc(name, labels, v) { const k = lkey(name, labels); T.c[k] = (T.c[k] || 0) + (v == null ? 1 : v); persist(); emit('metric', name); },
    set(name, labels, v) { T.g[lkey(name, labels)] = v; persist(); emit('metric', name); },
    observe(name, labels, v) {
      const k = lkey(name, labels);
      const h = T.h[k] || (T.h[k] = { b: BUCKETS.map(() => 0), sum: 0, count: 0 });
      BUCKETS.forEach((le, i) => { if (v <= le) h.b[i]++; });
      h.sum += v; h.count++;
      persist(); emit('metric', name);
    },
    value(name, labels) { const k = lkey(name, labels); return T.c[k] != null ? T.c[k] : T.g[k]; },
    sum(name) { let s = 0; Object.keys(T.c).forEach((k) => { if (k === name || k.startsWith(name + '{')) s += T.c[k]; }); return s; },
    hist(name) { return Object.keys(T.h).filter((k) => k === name || k.startsWith(name + '{')).map((k) => Object.assign({ key: k }, T.h[k])); },
    quantile(name, q) {   // histogram kovalarından yaklaşık yüzdelik (Prometheus histogram_quantile mantığı)
      const hs = this.hist(name); if (!hs.length) return null;
      const b = BUCKETS.map((_, i) => hs.reduce((a, h) => a + h.b[i], 0)); const count = hs.reduce((a, h) => a + h.count, 0);
      if (!count) return null;
      const rank = q * count; let prevLe = 0, prevC = 0;
      for (let i = 0; i < BUCKETS.length; i++) { if (b[i] >= rank) { const span = b[i] - prevC || 1; return prevLe + (BUCKETS[i] - prevLe) * ((rank - prevC) / span); } prevLe = BUCKETS[i]; prevC = b[i]; }
      return BUCKETS[BUCKETS.length - 1];
    },
    since: () => T.since,
    views: () => T.views.slice(),
    series() {   // sayaç + gösterge + histogram özetleri, düz liste (Veri Odası ve terminal için)
      const out = [];
      const split = (k) => { const i = k.indexOf('{'); return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1, -1)]; };
      Object.keys(T.c).forEach((k) => { const [n, l] = split(k); out.push({ name: n, type: 'counter', labels: l, value: T.c[k] }); });
      Object.keys(T.g).forEach((k) => { const [n, l] = split(k); out.push({ name: n, type: 'gauge', labels: l, value: T.g[k] }); });
      Object.keys(T.h).forEach((k) => { const [n, l] = split(k); out.push({ name: n + '_count', type: 'histogram', labels: l, value: T.h[k].count }, { name: n + '_sum', type: 'histogram', labels: l, value: +T.h[k].sum.toFixed(6) }); });
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    exposition() {
      T.g.garage_session_seconds = Math.round((Date.now() - T.since) / 1000);
      const out = [], names = new Set();
      [T.c, T.g].forEach((m) => Object.keys(m).forEach((k) => names.add(k.split('{')[0])));
      Object.keys(T.h).forEach((k) => names.add(k.split('{')[0]));
      Array.from(names).sort().forEach((n) => {
        const meta = META[n] || ['untyped', n, n];
        out.push('# HELP ' + n + ' ' + (lang === 'en' ? meta[2] : meta[1]), '# TYPE ' + n + ' ' + meta[0]);
        if (meta[0] === 'histogram') {
          Object.keys(T.h).filter((k) => k.split('{')[0] === n).forEach((k) => {
            const h = T.h[k], lab = k.includes('{') ? k.slice(k.indexOf('{') + 1, -1) : '';
            const join = (extra) => '{' + (lab ? lab + ',' : '') + extra + '}';
            BUCKETS.forEach((le, i) => out.push(n + '_bucket' + join('le="' + le + '"') + ' ' + h.b[i]));
            out.push(n + '_bucket' + join('le="+Inf"') + ' ' + h.count);
            out.push(n + '_sum' + (lab ? '{' + lab + '}' : '') + ' ' + +h.sum.toFixed(6), n + '_count' + (lab ? '{' + lab + '}' : '') + ' ' + h.count);
          });
        } else {
          [T.c, T.g].forEach((m) => Object.keys(m).filter((k) => k.split('{')[0] === n).forEach((k) => out.push(k + ' ' + (typeof m[k] === 'number' ? +m[k].toFixed(6) : m[k]))));
        }
      });
      return out.join('\n') + '\n';
    },
    reset() { T = { since: Date.now(), c: {}, g: {}, h: {}, logs: [], views: [] }; store.setJson(TKEY, T, true); emit('metric', '*'); emit('log', null); }
  };
  G.log = function (level, msg, fields) {
    const e = { ts: Date.now(), level: level || 'info', msg: String(msg), page: G.page(), fields: fields || {} };
    T.logs.push(e);
    if (T.logs.length > 400) T.logs.splice(0, T.logs.length - 400);
    persist();
    emit('log', e);
    return e;
  };
  G.logs = () => T.logs.slice();
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); store.setJson(TKEY, T, true); });

  // Hatalar: yakala, say, logla (kendi siteni izlemenin en kolay yolu)
  window.addEventListener('error', (e) => {
    G.metrics.inc('garage_js_errors_total', { page: G.page() });
    G.log('error', e.message || 'resource error', { source: (e.filename || (e.target && (e.target.src || e.target.href)) || '').split('/').pop(), line: e.lineno || 0 });
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    G.metrics.inc('garage_js_errors_total', { page: G.page() });
    G.log('error', 'unhandled rejection: ' + ((e.reason && e.reason.message) || e.reason), {});
  });

  // Sayfa performansı: Navigation Timing + LCP + CLS (Web Vitals ile aynı kaynaklar)
  let lcp = 0, cls = 0;
  try { new PerformanceObserver((l) => { const es = l.getEntries(); if (es.length) lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) { /* desteklenmiyor */ }
  try { new PerformanceObserver((l) => { l.getEntries().forEach((x) => { if (!x.hadRecentInput) cls += x.value; }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* desteklenmiyor */ }
  // INP (Interaction to Next Paint): tıklama/tuş ile ekranın tepki vermesi arasındaki en uzun süre
  let inp = 0;
  try { new PerformanceObserver((l) => { l.getEntries().forEach((x) => { if (x.interactionId && x.duration > inp) { inp = x.duration; emit('vitals', null); } }); }).observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch (e) { /* desteklenmiyor */ }
  G.vitals = () => ({ lcp, cls, inp });
  window.addEventListener('load', () => setTimeout(() => {
    const page = G.page();
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
    const loadMs = nav && nav.loadEventEnd ? nav.loadEventEnd - nav.startTime : performance.now();
    const ttfb = nav ? nav.responseStart - nav.requestStart : 0;
    const bytes = (performance.getEntriesByType('resource') || []).reduce((a, r) => a + (r.transferSize || 0), nav ? nav.transferSize || 0 : 0);
    G.metrics.inc('garage_page_views_total', { page });
    G.metrics.observe('garage_page_load_seconds', { page }, loadMs / 1000);
    G.metrics.set('garage_ttfb_seconds', null, +(ttfb / 1000).toFixed(4));
    if (bytes) G.metrics.inc('garage_transfer_bytes_total', null, bytes);
    const res = (performance.getEntriesByType('resource') || []).slice(0, 45).map((r) => [
      (r.name.split('?')[0].split('/').pop() || r.name).slice(0, 60), r.initiatorType || 'other', Math.round(r.startTime), Math.round(r.duration), r.transferSize || 0
    ]);
    if (nav) res.unshift([(location.pathname.split('/').pop() || 'index.html'), 'document', 0, Math.round(nav.responseEnd - nav.startTime), nav.transferSize || 0]);
    T.views.push({ page, t: Date.now(), load: Math.round(loadMs), ttfb: Math.round(ttfb), bytes, type: nav ? nav.type : 'navigate', res });
    if (T.views.length > 60) T.views.shift();
    T.views.slice(0, -12).forEach((v) => { delete v.res; });
    G.log('info', 'GET /' + (page === 'giris' ? '' : page + '.html') + ' 200', { load_ms: Math.round(loadMs), ttfb_ms: Math.round(ttfb), transfer_kb: +(bytes / 1024).toFixed(1), nav: nav ? nav.type : 'navigate' });
  }, 0));
  const flushVitals = () => {
    if (lcp) G.metrics.set('garage_lcp_seconds', null, +(lcp / 1000).toFixed(3));
    G.metrics.set('garage_cls', null, +cls.toFixed(4));
    if (inp) G.metrics.set('garage_inp_seconds', null, +(inp / 1000).toFixed(3));
    const v = T.views[T.views.length - 1];
    if (v && v.page === G.page()) { v.lcp = Math.round(lcp); v.cls = +cls.toFixed(4); if (inp) v.inp = Math.round(inp); }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushVitals(); store.setJson(TKEY, T, true); } });
  window.addEventListener('pagehide', flushVitals);

  // ===================================================================== MİNİ REDIS (paylaşılan önbellek)
  // Şema simülasyonu ve terminaldeki redis-cli aynı anahtar alanını kullanır. Süre (TTL) gerçek zamanlıdır.
  const RKEY = 'garage-redis-v1';
  let R = store.json(RKEY, true) || {};
  const rsave = () => { store.setJson(RKEY, R, true); emit('redis', null); };
  const alive = (k) => { const e = R[k]; if (!e) return null; if (e.x && e.x <= Date.now()) { delete R[k]; rsave(); return null; } return e; };
  const glob = (p) => new RegExp('^' + p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  G.redis = {
    set(k, v, ttlSec) { R[k] = { v: String(v), x: ttlSec ? Date.now() + ttlSec * 1000 : 0, t: Date.now() }; rsave(); return 'OK'; },
    get(k) { const e = alive(k); return e ? e.v : null; },
    del(...ks) { let n = 0; ks.forEach((k) => { if (alive(k)) { delete R[k]; n++; } }); if (n) rsave(); return n; },
    exists(k) { return alive(k) ? 1 : 0; },
    ttl(k) { const e = alive(k); if (!e) return -2; if (!e.x) return -1; return Math.max(0, Math.ceil((e.x - Date.now()) / 1000)); },
    pttl(k) { const e = alive(k); if (!e) return -2; if (!e.x) return -1; return Math.max(0, e.x - Date.now()); },
    expire(k, s) { const e = alive(k); if (!e) return 0; e.x = Date.now() + s * 1000; rsave(); return 1; },
    persist(k) { const e = alive(k); if (!e || !e.x) return 0; e.x = 0; rsave(); return 1; },
    incr(k, by) { const e = alive(k); const n = (e ? parseInt(e.v, 10) || 0 : 0) + (by || 1); R[k] = { v: String(n), x: e ? e.x : 0, t: Date.now() }; rsave(); return n; },
    keys(p) { const re = glob(p || '*'); return Object.keys(R).filter((k) => alive(k) && re.test(k)).sort(); },
    dbsize() { return this.keys('*').length; },
    flushall() { R = {}; rsave(); return 'OK'; },
    entries() { return this.keys('*').map((k) => ({ k, v: R[k].v, ttl: this.pttl(k), max: R[k].x ? R[k].x - R[k].t : 0 })); }
  };

  // ===================================================================== SES (Web Audio; dosya yok, varsayılan kapalı)
  let ctx = null, soundOn = store.get('garage-sound') === 'on';
  G.soundOn = () => soundOn;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function noise(c, sec) { const b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  const env = (c, t, a, peak, d) => { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; };
  const sfx = {
    door(dur) {   // seksiyonel kapı: makara tıkırtısı + motor uğultusu + tok duruş
      const c = ac(); if (!c || c.state !== 'running') return;
      const t = c.currentTime, len = dur || 0.95;
      const src = c.createBufferSource(); src.buffer = noise(c, len + 0.2);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
      const rattle = c.createGain(); rattle.gain.value = 0;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(18, t); lfo.frequency.linearRampToValueAtTime(30, t + len);
      const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(rattle.gain);
      const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.16, t + 0.08); e.gain.setValueAtTime(0.16, t + len - 0.15); e.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(bp).connect(rattle).connect(e).connect(c.destination);
      const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.setValueAtTime(52, t); hum.frequency.linearRampToValueAtTime(64, t + len);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      hum.connect(lp).connect(env(c, t, 0.1, 0.09, len - 0.1)).connect(c.destination);
      const thud = c.createOscillator(); thud.frequency.setValueAtTime(110, t + len - 0.05); thud.frequency.exponentialRampToValueAtTime(45, t + len + 0.15);
      thud.connect(env(c, t + len - 0.05, 0.02, 0.25, 0.2)).connect(c.destination);
      [src, lfo, hum, thud].forEach((n) => { n.start(t); n.stop(t + len + 0.3); });
    },
    click() {   // elektrik şalteri
      const c = ac(); if (!c || c.state !== 'running') return;
      const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = noise(c, 0.05);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      src.connect(hp).connect(env(c, t, 0.002, 0.35, 0.04)).connect(c.destination); src.start(t);
      const o = c.createOscillator(); o.frequency.value = 1900; o.connect(env(c, t, 0.002, 0.08, 0.03)).connect(c.destination); o.start(t); o.stop(t + 0.06);
    },
    dive() {    // monitöre dalış
      const c = ac(); if (!c || c.state !== 'running') return;
      const t = c.currentTime;
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(1100, t + 1.2);
      o.connect(env(c, t, 0.3, 0.12, 1.1)).connect(c.destination); o.start(t); o.stop(t + 1.5);
      const src = c.createBufferSource(); src.buffer = noise(c, 1.5);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 1.3);
      src.connect(bp).connect(env(c, t, 0.9, 0.18, 0.55)).connect(c.destination); src.start(t);
    },
    key() {     // klavye tuşu
      const c = ac(); if (!c || c.state !== 'running') return;
      const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = noise(c, 0.03);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000 + Math.random() * 600;
      src.connect(bp).connect(env(c, t, 0.002, 0.12, 0.025)).connect(c.destination); src.start(t);
    },
    blip(ok) {  // simülasyon: istek tamamlandı (isabet tiz, ıska pes)
      const c = ac(); if (!c || c.state !== 'running') return;
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = ok === false ? 220 : ok === 'hit' ? 1320 : 880;
      o.connect(env(c, t, 0.005, 0.05, 0.09)).connect(c.destination); o.start(t); o.stop(t + 0.12);
    }
  };
  G.sfx = (name, arg) => { if (soundOn && sfx[name]) { try { sfx[name](arg); } catch (e) { /* ses yoksa sorun değil */ } } };
  G.setSound = function (on) {
    soundOn = !!on;
    store.set('garage-sound', soundOn ? 'on' : 'off');
    if (soundOn) { ac(); setTimeout(() => G.sfx('click'), 60); }
    renderControls();
    emit('sound', soundOn);
  };

  // ===================================================================== İKONLAR (24x24, çizgi)
  const I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
    garage: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-7h10v7M7 16h10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>',
    toolbox: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V5h8v3M3 13h18M10 13v2h4v-2"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    intercom: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="8" r="2.2"/><path d="M9 14h6M9 17h6"/>',
    blueprint: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 9h4v4H7zM14 8h3M14 11h3M7 16h10M11 11h3"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6M8 18h8"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    sunrise: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.8 1.4M18.4 10.6l-1.8 1.4"/>',
    sunset: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 9V5M9.5 7.5L12 10l2.5-2.5"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    rss: '<path d="M5 19a1 1 0 1 0 0-.01M5 11a8 8 0 0 1 8 8M5 4a15 15 0 0 1 15 15"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    zap: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 7v10M11 7v10M15 7v10M5 17v3M19 17v3M5 4v3M19 4v3"/>',
    logs: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-5 3 3 5-6"/>',
    flame: '<path d="M12 21c-4 0-6-2.6-6-6 0-3.3 3-5.5 3.5-9 2 1.5 3 3.5 2.8 5.5 1-.8 1.6-2 1.7-3.2C16.5 10 18 12.5 18 15c0 3.4-2 6-6 6z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8M20 3v5h-5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
    github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7h.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
    printer: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18.5 14H20M14 18.5V20M17 17h3v3h-3z"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M15 10h3M15 13h3"/>',
    map: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h5M11 10h10M8 4v6M14 4v6M3 14.5h18M9 14.5V20M15 14.5V20"/>',
    api: '<path d="M8 4H7a2 2 0 0 0-2 2v3.5A1.5 1.5 0 0 1 3.5 11H3v2h.5A1.5 1.5 0 0 1 5 14.5V18a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3.5a1.5 1.5 0 0 0 1.5 1.5h.5v2h-.5a1.5 1.5 0 0 0-1.5 1.5V18a2 2 0 0 1-2 2h-1"/><path d="M10 12h.01M14 12h.01"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 9v11"/>',
    xray: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8M12 8v8"/>',
    steam: '<path d="M8 3c-1 1.5 1 2.5 0 4M12 3c-1 1.5 1 2.5 0 4M16 3c-1 1.5 1 2.5 0 4"/><path d="M5 10h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M18 12h1a2 2 0 0 1 0 4h-1.5"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'
  };
  G.icon = (name, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (I[name] || '') + '</svg>';

  // Takım çantası çekmeceleri — sayfa ayrıştırılırken (satır içi) çizilir ki ilk boyamada yer tutsun (CLS 0)
  G.toolboxHtml = (openSet, picked) => {
    const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return (G.toolbox || []).map((d, di) => {
      const isOpen = openSet && openSet.size ? openSet.has(String(di)) : true;
      const trayId = 'tray-' + di;
      return '<div class="drawer' + (isOpen ? ' open' : '') + '" data-i="' + di + '"><button type="button" class="drawer-front" aria-expanded="' + isOpen + '" aria-controls="' + trayId + '"><span>' + e(G.tx(d.drawer)) + ' <small>(' + d.tools.length + ')</small></span><span class="pull" aria-hidden="true"></span></button>' +
        '<div class="drawer-tray" id="' + trayId + '"><div><div class="tools-row">' +
        d.tools.map((t, ti) => '<button type="button" class="tool-tag" aria-pressed="' + (picked === t.name) + '" data-d="' + di + '" data-t="' + ti + '">' + e(t.name) + '</button>').join('') +
        '</div></div></div></div>';
    }).join('');
  };

  // ===================================================================== DİL + SES DÜĞMELERİ ([data-controls] içine)
  function renderControls() {
    document.querySelectorAll('[data-controls]').forEach((box) => {
      let wrap = box.querySelector('.ctrl-set');
      if (!wrap) {
        wrap = document.createElement('div'); wrap.className = 'ctrl-set';
        wrap.innerHTML = '<button type="button" class="icon-btn lang-btn"></button><button type="button" class="icon-btn sound-btn" role="switch"></button>';
        const anchor = box.querySelector('[data-palette]');
        if (anchor) anchor.after(wrap); else box.prepend(wrap);
        wrap.querySelector('.lang-btn').addEventListener('click', () => G.setLang(lang === 'tr' ? 'en' : 'tr'));
        wrap.querySelector('.sound-btn').addEventListener('click', () => G.setSound(!soundOn));
      }
      const lb = wrap.querySelector('.lang-btn');
      lb.innerHTML = '<span class="' + (lang === 'tr' ? 'on' : '') + '">TR</span><span class="sep">/</span><span class="' + (lang === 'en' ? 'on' : '') + '">EN</span>';
      lb.setAttribute('aria-label', lang === 'tr' ? 'Switch to English' : 'Türkçeye geç');
      lb.title = lb.getAttribute('aria-label');
      const sb = wrap.querySelector('.sound-btn');
      sb.innerHTML = G.icon(soundOn ? 'volume' : 'mute');
      sb.setAttribute('aria-checked', String(soundOn));
      sb.setAttribute('aria-label', G.t('Ses efektleri', 'Sound effects'));
      sb.title = G.t(soundOn ? 'Sesi kapat' : 'Sesi aç', soundOn ? 'Mute' : 'Unmute');
    });
  }
  G.renderControls = renderControls;

  // ===================================================================== UYARLANIR KALİTE (hafif mod)
  // Kare hızı uzun süre düşükse (zayıf cihaz, pil tasarrufu) ağır efektler kapanır: <html class="lite">.
  // Ziyaretçinin elle yaptığı seçim (komut paletinden) her zaman otomatik karardan önce gelir.
  const LITE = 'garage-lite';
  const litePref = store.get(LITE);
  G.lite = () => document.documentElement.classList.contains('lite');
  // Yazı adresi: her yazının statik sayfası (scripts/build.mjs üretir). <base> olan sayfalarda da doğru çözülür.
  G.postUrl = (slug) => 'yazi/' + encodeURIComponent(slug) + '.html';
  // <base href> kullanan sayfalarda (404, yazi/<slug>.html) "#bolum" bağlantıları köke gitmesin: aynı sayfada kaydır
  if (document.querySelector('base[href]')) document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute('href').slice(1)), el = id ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ behavior: G.reduce ? 'auto' : 'smooth', block: 'start' });
      if (el.tagName === 'MAIN') { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    }
    history.replaceState(null, '', location.pathname + location.search + (id ? '#' + id : ''));
  });
  // Sayfalar arası geçiş (View Transitions, site.css): hafif modda atla
  const skipVT = (e) => { if (e.viewTransition && G.lite()) e.viewTransition.skipTransition(); };
  window.addEventListener('pageswap', skipVT);
  window.addEventListener('pagereveal', skipVT);
  G.liteSource = () => (litePref || store.get(LITE) ? 'manual' : store.sget('garage-lite-auto') ? 'auto' : null);
  G.setLite = function (on, manual) {
    document.documentElement.classList.toggle('lite', !!on);
    if (manual) store.set(LITE, on ? 'on' : 'off');
    G.metrics.set('garage_quality', null, on ? 0 : 1);
    emit('lite', !!on);
  };
  if (litePref === 'on' || (!litePref && store.sget('garage-lite-auto'))) document.documentElement.classList.add('lite');
  G.metrics.set('garage_quality', null, G.lite() ? 0 : 1);
  // Ölçüm: 2,5 sn boyunca kare say; düşükse 2 sn daha ölç (tek seferlik takılmalar yanıltmasın).
  // Sekme gizlenirse ya da arada 0,5 sn'den uzun boşluk olursa ölçüm iptal edilir.
  function sampleFps(ms, done) {
    let n = 0, t0 = 0, last = 0, dead = false;
    const kill = () => { dead = true; };
    document.addEventListener('visibilitychange', kill, { once: true });
    const f = (t) => {
      if (dead) return;
      if (!t0) { t0 = last = t; return requestAnimationFrame(f); }
      if (t - last > 500) { dead = true; return; }
      n++; last = t;
      if (t - t0 < ms) return requestAnimationFrame(f);
      document.removeEventListener('visibilitychange', kill);
      done(n * 1000 / (t - t0));
    };
    requestAnimationFrame(f);
  }
  function autoLite() {
    if (litePref || G.lite() || G.reduce || document.hidden) return;
    sampleFps(2500, (a) => {
      if (a >= 24) return;
      sampleFps(2000, (b) => {
        if (b >= 24 || G.lite()) return;
        store.sset('garage-lite-auto', '1'); G.setLite(true);
        G.log('warn', 'low frame rate, lite mode on', { fps: +Math.max(a, b).toFixed(1) });
        if (G.toast) G.toast(G.t('Cihaz zorlanıyor gibi, ağır efektleri kapattım. Komut paletinden geri açabilirsin.', 'Your device seems to struggle, so heavy effects are off. Turn them back on from the command palette.'), 'zap');
      });
    });
  }
  window.addEventListener('load', () => setTimeout(autoLite, 1500));

  // ===================================================================== BUILD BİLGİSİ (CI üretir; yoksa sessizce yok sayılır)
  let buildP = null;
  G.build = () => buildP || (buildP = fetch(((document.body && document.body.dataset.root) || '') + 'build.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  G.ago = function (iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    const u = [[86400, 'gün', 'day'], [3600, 'saat', 'hour'], [60, 'dakika', 'minute']].find(([n]) => s >= n);
    if (!u) return G.t('az önce', 'just now');
    const n = Math.floor(s / u[0]);
    return G.t(n + ' ' + u[1] + ' önce', n + ' ' + u[2] + (n > 1 ? 's' : '') + ' ago');
  };

  // ===================================================================== SERVICE WORKER (çevrimdışı açılış; sadece yayında)
  if ('serviceWorker' in navigator && /(^|\.)github\.io$|^localhost$/.test(location.hostname) && location.protocol !== 'file:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* engellendiyse sorun değil */ }); });
  }

  // ===================================================================== ROTALAR, ZİYARETLER, ANLATIM
  // İki rota: seni tanımak isteyenler (Tanış) ve sistemi kurcalamak isteyenler (Kurcala)
  G.ROUTES = {
    tanis: { name: { tr: 'Tanış', en: 'Meet' }, color: 'amber', stops: ['hakkimda', 'takim-cantasi', 'seyir-defteri', 'iletisim'] },
    kurcala: { name: { tr: 'Kurcala', en: 'Tinker' }, color: 'blue', stops: ['sema', 'kontrol-odasi', 'veri-odasi', 'api'] }
  };
  G.routeOf = function (page) {
    page = page || G.page();
    if (page === 'yazi') page = 'seyir-defteri';
    for (const id of Object.keys(G.ROUTES)) {
      const r = G.ROUTES[id], i = r.stops.indexOf(page);
      if (i >= 0) return { id, route: r, index: i, total: r.stops.length, prev: r.stops[i - 1] || null, next: r.stops[i + 1] || null };
    }
    return null;
  };
  const VKEY = 'garage-visited';
  G.visited = () => new Set(store.json(VKEY, true) || []);
  G.markVisited = function (page) {
    const v = G.visited(); if (v.has(page)) return;
    v.add(page); store.setJson(VKEY, Array.from(v), true); emit('visited', page);
  };
  // Anlatım düzeyi: teknik (varsayılan) ya da basit. Teknik odalardaki açıklamalar buna göre değişir.
  const explainSaved = store.get('garage-explain');
  document.documentElement.dataset.explain = explainSaved === 'basit' ? 'basit' : 'teknik';
  G.explain = () => document.documentElement.dataset.explain;
  G.setExplain = function (m) {
    document.documentElement.dataset.explain = m === 'basit' ? 'basit' : 'teknik';
    store.set('garage-explain', G.explain());
    emit('explain', G.explain());
  };

  // ===================================================================== BAŞLAT
  function init() {
    applyLang(); applyPhase(); renderControls();
    G.markVisited(G.page() === 'yazi' ? 'seyir-defteri' : G.page());
    if (document.querySelector('.door-curtain')) store.sset('garage-curtain', '1');
  }
  applyPhase();                                  // ilk boyamadan önce doğru zaman dilimi sınıfı
  let inited = false;
  const initOnce = () => { if (!inited) { inited = true; init(); } };
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') initOnce(); });
    document.addEventListener('DOMContentLoaded', initOnce);
  } else initOnce();
  let lastPhase = G.phase();
  setInterval(() => { const ph = G.phase(); if (ph !== lastPhase) { lastPhase = ph; applyPhase(); } }, 60000);
})();
