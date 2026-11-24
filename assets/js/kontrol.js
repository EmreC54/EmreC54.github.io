// Kontrol Odası (kontrol.js) — bu sitenin kendi telemetrisi: gerçek ölçümler, uyarı kuralları, loglar, /metrics.
// Veri kaynağı site.js'teki oturum telemetrisi ve tarayıcının Performance API'leri. Hiçbir şey dışarı gönderilmez
// (tek istisna: Yayınlar paneli, GitHub'ın herkese açık API'sinden bu deponun son çalıştırmalarını okur).
// v7.1: zaman aralığı seçici, ortak artı imleçli zaman serileri, olay işaretleri, sayfa yükleme şelalesi,
// Graylog sözdizimiyle log arama + histogram, GitHub Actions yayın geçmişi.
(function () {
  'use strict';
  const G = window.GARAGE;
  const $ = (id) => document.getElementById(id);
  if (!$('dash')) return;
  const esc = G.esc;
  const S = { refresh: 5, fps: [], level: 'all', q: '', timer: 0, range: 0, bucket: null, wf: null };
  const RKEY = 'garage-dash-range';
  S.range = [0, 300, 900, 3600].includes(+G.store.sget(RKEY)) ? +G.store.sget(RKEY) : 0;
  // Doğrulanmış renkler (dataviz: koyu yüzey #111217 üzerinde CVD ve kontrast kontrolünden geçti)
  const C = { load: '#3987e5', ttfb: '#d95926', doc: '#3987e5', script: '#d95926', css: '#199e70', media: '#c98500', other: '#5b6170', bar: '#3987e5', surf: '#111217' };

  // ------------------------------------------------------------------ yardımcılar
  const cls = (el, v, good, warn, higherIsBetter) => {
    const p = el.closest('.stat');
    p.classList.remove('warn', 'bad', 'neutral');
    if (v == null) return;
    const ok = higherIsBetter ? v >= good : v <= good, mid = higherIsBetter ? v >= warn : v <= warn;
    if (!ok) p.classList.add(mid ? 'warn' : 'bad');
  };
  const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');
  const short = (u) => { try { const x = new URL(u, location.href); return (x.pathname.split('/').pop() || x.host) + (x.host !== location.host ? ' ↗' : ''); } catch (e) { return u; } };
  const dur = (s) => { s = Math.round(s); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm ' + String(s % 60).padStart(2, '0') + 's'); };
  const nav = () => (performance.getEntriesByType('navigation') || [])[0];
  const locale = () => (G.lang() === 'en' ? 'en-GB' : 'tr-TR');
  const hms = (t) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const hm = (t) => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const fmtN = (n) => Number(n).toLocaleString(locale());
  const niceStep = (span, n) => { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; };
  const niceMax = (v, n) => { const st = niceStep(v || 1, n || 4); return Math.ceil((v || 1) / st) * st; };

  // ------------------------------------------------------------------ zaman aralığı (zaman serilerini, logları ve şelaleyi kapsar)
  function span() {
    const now = Date.now(), start = S.range ? now - S.range * 1000 : G.metrics.since();
    return [Math.min(start, now - 60000), now];
  }
  const TSTEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400].map((s) => s * 1000);
  function timeTicks(t0, t1, px) {
    const want = Math.max(2, Math.min(7, Math.floor(px / 110)));
    const st = TSTEPS.find((s) => (t1 - t0) / s <= want) || TSTEPS[TSTEPS.length - 1];
    const out = []; for (let t = Math.ceil(t0 / st) * st; t <= t1; t += st) out.push(t);
    return { ticks: out, fmt: st < 60000 ? hms : hm };
  }
  // Olay işaretleri: hata logları ve önemli olaylar (devre kesici açıldı, telemetri sıfırlandı, uyarı tetiklendi)
  function annotations(t0, t1) {
    return G.logs().filter((e) => e.ts >= t0 && e.ts <= t1 && (e.level === 'error' || /circuit breaker OPEN|telemetry reset|alert FIRING|deploy/i.test(e.msg)))
      .slice(-40).map((e) => ({ t: e.ts, kind: e.level === 'error' ? 'err' : 'ev', text: e.msg }));
  }
  const annSvg = (anns, x, yTop, yBot) => anns.map((a) => {
    const px = x(a.t).toFixed(1);
    return '<g class="ann ' + a.kind + '"><line x1="' + px + '" x2="' + px + '" y1="' + yTop + '" y2="' + yBot + '"/><path d="M' + px + ' ' + (yBot - 6) + 'l4 6h-8z"/><title>' + esc(hms(a.t) + ' · ' + a.text) + '</title></g>';
  }).join('');

  // Ortak artı imleç: yükleme grafiği ve log histogramı aynı zamanı gösterir
  const XH = { t: null };
  function drawXH() {
    ['loadsChart', 'logHist'].forEach((id) => {
      const svg = $(id), line = svg && svg.querySelector('.xh');
      if (!line) return;
      const ok = XH.t != null && svg._x && XH.t >= svg._t0 && XH.t <= svg._t1;
      if (!ok) { line.setAttribute('visibility', 'hidden'); return; }
      const px = svg._x(XH.t).toFixed(1);
      line.setAttribute('x1', px); line.setAttribute('x2', px); line.setAttribute('visibility', 'visible');
    });
  }
  function showTip(wrap, svg, html, px, py) {
    const tip = wrap.querySelector('.ts-tip'); if (!tip) return;
    tip.innerHTML = html; tip.hidden = false;
    const wr = wrap.getBoundingClientRect(), sr = svg.getBoundingClientRect(), k = sr.width / (svg.viewBox.baseVal.width || sr.width);
    let x = sr.left - wr.left + px * k + 14, y = sr.top - wr.top + py * k - tip.offsetHeight - 10;
    if (x + tip.offsetWidth > wr.width - 4) x = sr.left - wr.left + px * k - tip.offsetWidth - 14;
    if (y < 0) y = sr.top - wr.top + py * k + 14;
    tip.style.left = Math.max(2, x) + 'px'; tip.style.top = Math.max(2, y) + 'px';
  }
  const hideTip = (wrap) => { const tip = wrap && wrap.querySelector('.ts-tip'); if (tip) tip.hidden = true; };
  const tipRow = (val, label, color) => '<p>' + (color ? '<i style="background:' + color + '"></i>' : '') + '<b>' + esc(val) + '</b><span>' + esc(label) + '</span></p>';

  // ------------------------------------------------------------------ canlı FPS
  let frames = 0, last = performance.now(), running = false;
  function loop(t) {
    frames++;
    if (t - last >= 1000) {
      const fps = frames * 1000 / (t - last);
      S.fps.push({ t: Date.now(), v: fps }); if (S.fps.length > 60) S.fps.shift();
      frames = 0; last = t;
      G.metrics.set('garage_fps', null, +fps.toFixed(1));
      renderFps(); renderLive();
    }
    if (!document.hidden) requestAnimationFrame(loop); else running = false;
  }
  function startLoop() { if (!running) { running = true; frames = 0; last = performance.now(); requestAnimationFrame(loop); } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });
  startLoop();

  // ------------------------------------------------------------------ tek değer panelleri
  // Sayı + birim: rakamlar kilometre saati gibi döner (G.odo); birim ayrı <small>
  function setNum(el, text, unit) {
    if (!el) return;
    if (text == null) { el.textContent = '—'; return; }
    let n = el.querySelector('.num');
    if (!n) { el.innerHTML = '<span class="num"></span>' + (unit ? '<small>' + unit + '</small>' : ''); n = el.querySelector('.num'); }
    else { const sm = el.querySelector('small'); if (sm && sm.textContent !== unit) sm.textContent = unit; }
    G.odo(n, String(text));
  }
  function renderStats() {
    const n = nav();
    const load = n && n.loadEventEnd ? n.loadEventEnd - n.startTime : null;
    setNum($('stLoad'), load ? Math.round(load) : null, 'ms');
    $('stLoadSub').textContent = n ? 'TTFB ' + Math.round(n.responseStart - n.requestStart) + ' ms · DOM ' + Math.round(n.domContentLoadedEventEnd - n.startTime) + ' ms' : '—';
    cls($('stLoad'), load, 1000, 2500);
    const v = G.vitals();
    setNum($('stLcp'), v.lcp ? (v.lcp / 1000).toFixed(2) : null, 's');
    $('stLcpSub').textContent = G.t('iyi < 2.5 s', 'good < 2.5 s');
    cls($('stLcp'), v.lcp || null, 2500, 4000);
    setNum($('stInp'), v.inp ? Math.round(v.inp) : null, 'ms');
    $('stInpSub').textContent = v.inp ? G.t('en yavaş etkileşim · iyi < 200 ms', 'slowest interaction · good < 200 ms') : G.t('bir yere tıkla, ölçülsün', 'click anything to measure');
    cls($('stInp'), v.inp || null, 200, 500);
    setNum($('stCls'), v.cls.toFixed(3), '');
    $('stClsSub').textContent = G.t('iyi < 0.1', 'good < 0.1');
    cls($('stCls'), v.cls, 0.1, 0.25);
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((a, r) => a + (r.transferSize || 0), n ? n.transferSize || 0 : 0);
    const kbs = kb(bytes).match(/^(.*?)\s*(KB|MB|B)?$/); setNum($('stNet'), kbs[1], kbs[2] || '');
    $('stNetSub').textContent = (res.length + 1) + G.t(' istek · bu sayfa', ' requests · this page');
    $('stNet').closest('.stat').classList.add('neutral');
  }
  function renderLive() {
    const f = S.fps[S.fps.length - 1];
    if (f) { $('stFps').textContent = Math.round(f.v); cls($('stFps'), f.v, 50, 30, true); }
    const avg = S.fps.length ? S.fps.reduce((a, x) => a + x.v, 0) / S.fps.length : 0;
    $('stFpsSub').textContent = avg ? G.t('ort. ', 'avg ') + avg.toFixed(1) + G.t(' · son ', ' · last ') + S.fps.length + ' s' : G.t('ölçülüyor…', 'measuring…');
    const age = (Date.now() - G.metrics.since()) / 1000;
    $('sessAge').textContent = dur(age) + ' · ' + G.metrics.sum('garage_page_views_total') + G.t(' sayfa · ', ' pages · ') + G.logs().length + G.t(' log', ' logs');
  }

  // ------------------------------------------------------------------ grafikler
  const fit = (svg) => { const W = Math.max(260, Math.round(svg.clientWidth || 600)), H = Math.max(60, Math.round(svg.clientHeight || 200)); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); return [W, H]; };
  function renderFps() {
    const svg = $('fpsChart'), [W, H] = fit(svg), padL = 28, padB = 18, data = S.fps;
    const max = Math.max(70, ...data.map((d) => d.v)) * 1.05;
    const x = (i) => padL + (W - padL) * (i / 59), y = (v) => (H - padB) - (H - padB - 6) * (v / max);
    let s = '<defs><linearGradient id="fpsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FD18B" stop-opacity=".35"/><stop offset="1" stop-color="#4FD18B" stop-opacity="0"/></linearGradient></defs>';
    [0, 30, 60].forEach((v) => { s += '<line class="gridl" x1="' + padL + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="0" y="' + (y(v) + 3) + '">' + v + '</text>'; });
    s += '<line x1="' + padL + '" x2="' + W + '" y1="' + y(30) + '" y2="' + y(30) + '" stroke="#FF6B61" stroke-opacity=".5" stroke-dasharray="4 4"/>';
    if (data.length > 1) {
      const off = 60 - data.length;
      const pts = data.map((d, i) => x(i + off).toFixed(1) + ',' + y(d.v).toFixed(1));
      s += '<polygon fill="url(#fpsg)" points="' + x(off) + ',' + (H - padB) + ' ' + pts.join(' ') + ' ' + x(59) + ',' + (H - padB) + '"/>';
      s += '<polyline fill="none" stroke="#4FD18B" stroke-width="2" stroke-linejoin="round" points="' + pts.join(' ') + '"/>';
    }
    s += '<text class="axis" x="' + padL + '" y="' + (H - 2) + '">-60 s</text><text class="axis" x="' + W + '" y="' + (H - 2) + '" text-anchor="end">' + G.t('şimdi', 'now') + '</text>';
    svg.innerHTML = s;
  }

  // Sayfa yükleme: zaman ekseninde iki seri (yükleme, TTFB), eşik çizgileri, olay işaretleri, artı imleç
  function renderLoads() {
    const svg = $('loadsChart'), wrap = $('loadsWrap'), [W, H] = fit(svg);
    const padL = 42, padR = 70, padT = 12, padB = 20;
    const [t0, t1] = span();
    const views = G.metrics.views().filter((v) => v.t >= t0 && v.t <= t1 + 1000);
    const x = (t) => padL + (W - padL - padR) * (t - t0) / (t1 - t0);
    svg._x = x; svg._t0 = t0; svg._t1 = t1; svg._views = views;
    const max = niceMax(Math.max(1000, ...views.map((v) => v.load)) * 1.08, 4);
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const st = niceStep(max, 4);
    let s = '';
    for (let v = 0; v <= max + 1e-9; v += st) s += '<line class="gridl" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="axis" x="' + (padL - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + (v >= 1000 ? (v / 1000).toLocaleString(locale()) + ' s' : Math.round(v)) + '</text>';
    const tt = timeTicks(t0, t1, W - padL - padR);
    tt.ticks.forEach((t) => { s += '<text class="axis" x="' + x(t).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(tt.fmt(t)) + '</text>'; });
    [[1000, G.t('iyi < 1 s', 'good < 1 s')], [2500, '2.5 s']].forEach(([v, lb]) => { if (v <= max) s += '<line class="thr" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="thr-l" x="' + (W - padR + 6) + '" y="' + (y(v) + 3).toFixed(1) + '">' + esc(lb) + '</text>'; });
    s += annSvg(annotations(t0, t1), x, padT, H - padB);
    if (!views.length) s += '<text class="axis empty" x="' + ((padL + W - padR) / 2) + '" y="' + (H / 2) + '" text-anchor="middle">' + esc(G.t('Bu aralıkta sayfa yüklemesi yok', 'No page loads in this range')) + '</text>';
    const series = [['load', C.load, G.t('yükleme', 'load')], ['ttfb', C.ttfb, 'TTFB']];
    series.forEach(([k, col, name]) => {
      if (!views.length) return;
      const pts = views.map((v) => [x(v.t), y(v[k] || 0)]);
      if (pts.length > 1) s += '<polyline class="ln" stroke="' + col + '" points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>';
      if (pts.length <= 40) s += pts.map((p) => '<circle class="dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + col + '"/>').join('');
      const lp = pts[pts.length - 1];
      s += '<text class="end-l" x="' + (lp[0] + 8).toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '">' + esc(name) + '</text>';
    });
    s += '<line class="xh" y1="' + padT + '" y2="' + (H - padB) + '" visibility="hidden"/>';
    s += '<rect class="hit" x="' + padL + '" y="' + padT + '" width="' + (W - padL - padR) + '" height="' + (H - padT - padB) + '"/>';
    svg.innerHTML = s;
    svg.setAttribute('aria-label', G.t('Sayfa yükleme süreleri, zamana göre: ', 'Page load times over time: ') + views.length + G.t(' yükleme', ' loads'));
    drawXH();
    if (!svg._wired) {
      svg._wired = true;
      const nearest = (t) => { let b = null, bd = Infinity; (svg._views || []).forEach((v) => { const d = Math.abs(v.t - t); if (d < bd) { bd = d; b = v; } }); return b; };
      const at = (clientX) => { const r = svg.getBoundingClientRect(), k = (svg.viewBox.baseVal.width || r.width) / r.width, px = (clientX - r.left) * k; return svg._t0 + (px - padL) / (svg.viewBox.baseVal.width - padL - padR) * (svg._t1 - svg._t0); };
      const show = (v) => {
        if (!v) return;
        XH.t = v.t; drawXH();
        const anns = annotations(svg._t0, svg._t1).filter((a) => Math.abs(a.t - v.t) < (svg._t1 - svg._t0) / 40);
        showTip(wrap, svg, tipRow(v.load + ' ms', G.t('yükleme', 'load'), C.load) + tipRow(v.ttfb + ' ms', 'TTFB', C.ttfb) +
          (v.lcp ? tipRow(v.lcp + ' ms', 'LCP') : '') + '<small>' + esc(v.page + ' · ' + hms(v.t) + (v.type && v.type !== 'navigate' ? ' · ' + v.type : '')) + '</small>' +
          anns.map((a) => '<small class="t-ann ' + a.kind + '">' + esc(hms(a.t) + ' · ' + a.text) + '</small>').join(''), svg._x(v.t), 20);
        hlView(v);
      };
      svg.addEventListener('pointermove', (e) => show(nearest(at(e.clientX))));
      svg.addEventListener('pointerleave', () => { XH.t = null; drawXH(); hideTip(wrap); hlView(null); });
      svg.setAttribute('tabindex', '0');
      let ki = -1;
      svg.addEventListener('keydown', (e) => {
        const vs = svg._views || []; if (!vs.length) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); ki = Math.max(0, Math.min(vs.length - 1, (ki < 0 ? vs.length - 1 : ki) + (e.key === 'ArrowRight' ? 1 : -1))); show(vs[ki]); }
        if (e.key === 'Enter' && ki >= 0) { S.wf = vs[ki].t; renderWaterfall(); $('wfPanel').scrollIntoView({ block: 'nearest', behavior: G.reduce ? 'auto' : 'smooth' }); }
      });
      svg.addEventListener('focus', () => { const vs = svg._views || []; if (vs.length) { ki = vs.length - 1; show(vs[ki]); } });
      svg.addEventListener('blur', () => { XH.t = null; drawXH(); hideTip(wrap); hlView(null); });
      svg.addEventListener('click', (e) => { const v = nearest(at(e.clientX)); if (v && v.res) { S.wf = v.t; renderWaterfall(); } });
    }
  }
  function hlView(v) { const svg = $('loadsChart'); svg.querySelectorAll('.dot').forEach((d) => d.classList.remove('on')); if (!v) return; const px = svg._x(v.t).toFixed(1); svg.querySelectorAll('.dot').forEach((d) => { if (d.getAttribute('cx') === px) d.classList.add('on'); }); }

  // ------------------------------------------------------------------ şelale (bir sayfa görüntülemesinin kaynakları)
  const kindOf = (name, type) => {
    if (type === 'document') return 'doc';
    const ext = (String(name).split('?')[0].split('.').pop() || '').toLowerCase();
    if (/^(js|mjs)$/.test(ext) || type === 'script') return 'script';
    if (ext === 'css') return 'css';
    if (/^(jpe?g|png|webp|avif|gif|svg|ico|woff2?|ttf|otf)$/.test(ext) || type === 'img' || type === 'image') return 'media';
    return 'other';
  };
  const KIND_NAME = { doc: ['belge', 'document'], script: ['betik', 'script'], css: ['stil', 'stylesheet'], media: ['görsel / font', 'image / font'], other: ['diğer', 'other'] };
  function wfViews() { const [t0] = span(); return G.metrics.views().filter((v) => v.res && v.res.length && v.t >= t0); }
  function renderWfPicker() {
    const sel = $('wfView'), vs = wfViews().slice().reverse();
    if (!vs.some((v) => v.t === S.wf)) S.wf = vs.length ? vs[0].t : null;
    sel.innerHTML = vs.length ? vs.map((v) => '<option value="' + v.t + '"' + (v.t === S.wf ? ' selected' : '') + '>' + esc(v.page + ' · ' + hms(v.t) + ' · ' + v.load + ' ms') + '</option>').join('') : '<option>' + esc(G.t('bu aralıkta ölçüm yok', 'no measurements in this range')) + '</option>';
    sel.disabled = !vs.length;
  }
  function renderWaterfall() {
    renderWfPicker();
    const svg = $('wfChart'), wrap = $('wfWrap'), note = $('wfNote');
    const v = G.metrics.views().find((x) => x.t === S.wf);
    if (!v) { svg.innerHTML = ''; svg.setAttribute('height', '40'); note.textContent = G.t('Şelale için bir sayfa görüntülemesi gerekiyor. Son 12 görüntülemenin kaynakları saklanır.', 'The waterfall needs a page view. Resources of the last 12 views are kept.'); return; }
    const all = v.res.slice().sort((a, b) => a[2] - b[2]), MAX = 30, rows = all.slice(0, MAX);
    const W = Math.max(300, Math.round(wrap.clientWidth || 700)), ROW = 20, TOP = 22, H = TOP + rows.length * ROW + 6;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('height', H);
    const labW = Math.min(200, Math.round(W * 0.3)), durW = 56;
    const end = Math.max(v.load || 0, v.lcp || 0, ...rows.map((r) => r[2] + r[3]), 50) * 1.03;
    const x = (ms) => labW + (W - labW - durW) * ms / end;
    let s = '';
    const st = niceStep(end, Math.max(2, Math.floor((W - labW - durW) / 90)));
    for (let ms = 0; ms <= end; ms += st) s += '<line class="gridl" x1="' + x(ms).toFixed(1) + '" x2="' + x(ms).toFixed(1) + '" y1="' + (TOP - 4) + '" y2="' + H + '"/><text class="axis" x="' + x(ms).toFixed(1) + '" y="12" text-anchor="middle">' + (ms >= 1000 ? (ms / 1000).toLocaleString(locale()) + ' s' : Math.round(ms) + ' ms') + '</text>';
    const marks = [['ttfb', v.ttfb, 'TTFB'], ['lcp', v.lcp, 'LCP'], ['load', v.load, 'load']].filter((m) => m[1]);
    marks.forEach(([k, ms]) => { s += '<line class="wf-m ' + k + '" x1="' + x(ms).toFixed(1) + '" x2="' + x(ms).toFixed(1) + '" y1="' + (TOP - 4) + '" y2="' + H + '"/>'; });
    const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
    const maxChars = Math.max(10, Math.floor((labW - 12) / 6.8));
    rows.forEach((r, i) => {
      const yy = TOP + i * ROW, k = kindOf(r[0], r[1]), xa = x(r[2]), w = Math.max(2, x(r[2] + r[3]) - xa);
      s += '<g class="wf-row" data-i="' + i + '"><rect class="hit" x="0" y="' + yy + '" width="' + W + '" height="' + ROW + '"/>' +
        '<text class="wf-n" x="0" y="' + (yy + 14) + '">' + esc(trunc(r[0], maxChars)) + '</text>' +
        '<rect class="wf-b" x="' + xa.toFixed(1) + '" y="' + (yy + 5) + '" width="' + w.toFixed(1) + '" height="10" rx="2" fill="' + C[k] + '"/>' +
        '<text class="wf-d" x="' + (W - 2) + '" y="' + (yy + 14) + '" text-anchor="end">' + r[3] + ' ms</text></g>';
    });
    svg.innerHTML = s;
    svg._rows = rows; svg._x = x;
    const cached = all.filter((r) => !r[4] && r[1] !== 'document').length;
    note.textContent = all.length + G.t(' kaynak', ' resources') + (all.length > MAX ? G.t(' (ilk ' + MAX + ' gösteriliyor)', ' (first ' + MAX + ' shown)') : '') + ' · ' + kb(all.reduce((a, r) => a + (r[4] || 0), 0)) + G.t(' aktarım', ' transferred') + (cached ? ' · ' + cached + G.t(' önbellekten', ' from cache') : '') + ' · load ' + v.load + ' ms' + (v.lcp ? ' · LCP ' + v.lcp + ' ms' : '');
    if (!svg._wired) {
      svg._wired = true;
      const show = (i) => {
        const r = (svg._rows || [])[i]; if (!r) return;
        svg.querySelectorAll('.wf-row').forEach((g) => g.classList.toggle('on', +g.dataset.i === i));
        const k = kindOf(r[0], r[1]);
        showTip(wrap, svg, tipRow(r[3] + ' ms', G.t('süre', 'duration'), C[k]) + tipRow(r[2] + ' ms', G.t('başlangıç', 'start')) + tipRow(r[4] ? kb(r[4]) : G.t('önbellek', 'cache'), G.t('aktarım', 'transfer')) +
          '<small>' + esc(r[0] + ' · ' + G.t(KIND_NAME[k][0], KIND_NAME[k][1])) + '</small>', svg._x(r[2] + r[3]), 22 + i * 20);
      };
      svg.addEventListener('pointermove', (e) => { const g = e.target.closest('.wf-row'); if (g) show(+g.dataset.i); });
      svg.addEventListener('pointerleave', () => { hideTip(wrap); svg.querySelectorAll('.wf-row.on').forEach((g) => g.classList.remove('on')); });
      svg.setAttribute('tabindex', '0');
      let ki = -1;
      svg.addEventListener('keydown', (e) => {
        const n = (svg._rows || []).length; if (!n) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ki = Math.max(0, Math.min(n - 1, ki + (e.key === 'ArrowDown' ? 1 : -1))); show(ki); }
      });
      svg.addEventListener('blur', () => { hideTip(wrap); ki = -1; });
    }
  }
  $('wfView').addEventListener('change', (e) => { S.wf = +e.target.value; renderWaterfall(); });

  // ------------------------------------------------------------------ tablolar
  function renderResources() {
    const res = performance.getEntriesByType('resource').slice().sort((a, b) => b.duration - a.duration).slice(0, 10);
    const max = Math.max(1, ...res.map((r) => r.duration));
    $('resBody').innerHTML = res.map((r) => '<tr><td class="name" title="' + esc(r.name) + '">' + esc(short(r.name)) + '</td><td>' + esc(r.initiatorType) + '</td><td class="num">' + (r.transferSize ? kb(r.transferSize) : (r.decodedBodySize ? 'cache' : '—')) + '</td><td class="num">' + Math.round(r.duration) + ' ms</td><td style="width:28%"><span class="bar" style="width:' + (r.duration / max * 100).toFixed(1) + '%"></span></td></tr>').join('') ||
      '<tr><td colspan="5" class="log-empty">' + G.t('kaynak yok', 'no resources') + '</td></tr>';
  }
  function renderCounters() {
    const m = G.metrics;
    const rows = [
      [G.t('sayfa görüntüleme', 'page views'), m.sum('garage_page_views_total')],
      [G.t('açılan kapı', 'doors opened'), m.sum('garage_doors_opened_total')],
      [G.t('terminal komutu', 'terminal commands'), m.sum('garage_terminal_commands_total')],
      [G.t('veri sorgusu (SQL / Mongo)', 'data queries (SQL / Mongo)'), m.sum('garage_db_queries_total')],
      [G.t('API isteği', 'API requests'), m.sum('garage_api_requests_total')],
      [G.t('komut paleti', 'palette opens'), m.sum('garage_palette_opens_total')],
      [G.t('şema istekleri', 'blueprint requests'), m.sum('garage_sim_http_requests_total')],
      [G.t('önbellek isabet / ıska', 'cache hit / miss'), m.sum('garage_sim_cache_hits_total') + ' / ' + m.sum('garage_sim_cache_misses_total')],
      [G.t('JS hatası', 'JS errors'), m.sum('garage_js_errors_total')],
      [G.t('indirilen (oturum)', 'downloaded (session)'), kb(m.sum('garage_transfer_bytes_total'))]
    ];
    $('counters').innerHTML = rows.map(([a, b]) => '<dt>' + esc(a) + '</dt><dd>' + esc(b) + '</dd>').join('');
  }
  function renderAlerts() {
    const v = G.vitals(), errs = G.metrics.sum('garage_js_errors_total');
    const recent = S.fps.slice(-10), fpsAvg = recent.length ? recent.reduce((a, x) => a + x.v, 0) / recent.length : null;
    const p95 = G.metrics.quantile('garage_sim_request_duration_seconds', 0.95);
    const rules = [
      ['JavaScriptErrors', 'garage_js_errors_total > 0', errs > 0, String(errs)],
      ['SlowLargestPaint', 'garage_lcp_seconds > 2.5', v.lcp > 2500, v.lcp ? (v.lcp / 1000).toFixed(2) + ' s' : '—'],
      ['LowFrameRate', 'avg_over_time(garage_fps[10s]) < 30', fpsAvg != null && recent.length >= 5 && fpsAvg < 30, fpsAvg != null ? fpsAvg.toFixed(1) + ' fps' : '—'],
      ['LayoutShift', 'garage_cls > 0.1', v.cls > 0.1, v.cls.toFixed(3)],
      ['SlowInteraction', 'garage_inp_seconds > 0.2', v.inp > 200, v.inp ? Math.round(v.inp) + ' ms' : '—'],
      ['Offline', 'up == 0', !navigator.onLine, navigator.onLine ? 'online' : 'offline'],
      ['SimHighLatency', 'histogram_quantile(0.95, garage_sim_request_duration_seconds) > 0.25', p95 != null && p95 > 0.25, p95 != null ? Math.round(p95 * 1000) + ' ms' : '—']
    ];
    $('alerts').innerHTML = rules.map(([n, expr, firing, val]) => '<li class="' + (firing ? 'firing' : '') + '" title="' + esc(expr) + '"><span class="st">' + (firing ? 'FIRING' : 'OK') + '</span><span>' + esc(n) + '</span><span class="val">' + esc(val) + '</span></li>').join('');
    const f = rules.filter((r) => r[2]).length;
    $('alertsInfo').textContent = f ? f + G.t(' kural tetiklendi', ' firing') : G.t('hepsi normal', 'all clear');
  }
  function renderProm() {
    const txt = G.metrics.exposition().trim();
    $('prom').innerHTML = txt.split('\n').map((l) => (l.startsWith('#') ? '<span class="m">' + esc(l) + '</span>' : esc(l).replace(/^([a-z_:][\w:]*)(\{[^}]*\})?\s+(.+)$/, '<span class="n">$1</span><span class="l">$2</span> <span class="v">$3</span>'))).join('\n');
    $('promInfo').textContent = txt.split('\n').filter((l) => l && !l.startsWith('#')).length + G.t(' seri', ' series');
  }
  function renderEnv() {
    const c = navigator.connection, rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rows = [
      [G.t('görüntü alanı', 'viewport'), window.innerWidth + '×' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x'],
      [G.t('ekran', 'screen'), screen.width + '×' + screen.height],
      [G.t('işlemci', 'CPU cores'), navigator.hardwareConcurrency || '—'],
      [G.t('bellek', 'memory'), navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '—'],
      [G.t('bağlantı', 'connection'), c ? [c.effectiveType, c.rtt != null ? 'rtt ' + c.rtt + ' ms' : '', c.downlink ? c.downlink + ' Mb/s' : '', c.saveData ? 'save-data' : ''].filter(Boolean).join(' · ') : '—'],
      [G.t('dil', 'language'), navigator.language + ' → ' + G.lang()],
      [G.t('saat dilimi', 'time zone'), Intl.DateTimeFormat().resolvedOptions().timeZone],
      [G.t('garaj zamanı', 'garage time'), G.phaseName(G.phase()) + (G.phaseOverride() ? G.t(' (önizleme)', ' (preview)') : '')],
      [G.t('hareketi azalt', 'reduced motion'), rm ? G.t('açık', 'on') : G.t('kapalı', 'off')],
      [G.t('görsel kalite', 'visual quality'), G.lite() ? G.t('hafif mod', 'lite mode') + (G.liteSource() === 'auto' ? G.t(' (düşük kare hızı, otomatik)', ' (low frame rate, automatic)') : G.t(' (elle)', ' (manual)')) : G.t('tam', 'full')],
      ['service worker', 'serviceWorker' in navigator && navigator.serviceWorker.controller ? G.t('aktif (çevrimdışı hazır)', 'active (offline ready)') : G.t('pasif', 'inactive')],
      [G.t('depolama', 'storage'), '<span id="envStore">…</span>']
    ];
    $('env').innerHTML = rows.map(([a, b]) => '<dt>' + esc(a) + '</dt><dd>' + (String(b).startsWith('<span') ? b : esc(b)) + '</dd>').join('');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { const el = $('envStore'); if (el) el.textContent = kb(e.usage || 0) + ' / ' + (e.quota ? Math.round(e.quota / 1048576) + ' MB' : '?'); }).catch(() => {});
    else { const el = $('envStore'); if (el) el.textContent = '—'; }
  }

  // ------------------------------------------------------------------ log arama (Graylog sözdizimi)
  // level:error  page:sema  msg:"cache miss"  ms:>100  _exists_:trace  "ifade"  GET*  NOT/-  AND (varsayılan)  OR
  function parseQuery(q) {
    const toks = [], s = String(q || '').trim();
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      let neg = false;
      if (s[i] === '-' && s[i + 1] && !/\s/.test(s[i + 1])) { neg = true; i++; }
      const rest = s.slice(i);
      let m = rest.match(/^([A-Za-z_][\w.]*):(>=|<=|>|<)?(?:"([^"]*)"?|([^\s"]+))/);
      if (m) { toks.push({ t: 'term', neg, field: m[1].toLowerCase(), op: m[2] || null, val: m[3] != null ? m[3] : m[4], quoted: m[3] != null }); i += m[0].length; continue; }
      m = rest.match(/^"([^"]*)"?/);
      if (m) { toks.push({ t: 'term', neg, field: null, val: m[1], quoted: true }); i += m[0].length; continue; }
      const w = rest.match(/^\S+/)[0]; i += w.length;
      if (!neg && (w === 'AND' || w === '&&')) toks.push({ t: 'AND' });
      else if (!neg && (w === 'OR' || w === '||')) toks.push({ t: 'OR' });
      else if (!neg && w === 'NOT') toks.push({ t: 'NOT' });
      else toks.push({ t: 'term', neg, field: null, val: w, quoted: false });
    }
    const groups = [[]]; let not = false;
    toks.forEach((k) => {
      if (k.t === 'OR') { groups.push([]); not = false; return; }
      if (k.t === 'AND') return;
      if (k.t === 'NOT') { not = !not; return; }
      if (not) { k.neg = !k.neg; not = false; }
      groups[groups.length - 1].push(k);
    });
    const gs = groups.filter((g) => g.length);
    return { empty: !gs.length, test: (e) => !gs.length || gs.some((g) => g.every((k) => termTest(k, e) !== k.neg)) };
  }
  const lower = (x) => String(x == null ? '' : x).replace(/[İIı]/g, 'i').toLowerCase();
  function fieldOf(e, f) {
    if (f === 'level') return e.level;
    if (f === 'page' || f === 'source') return e.page;
    if (f === 'msg' || f === 'message') return e.msg;
    const fl = e.fields || {};
    if (f in fl) return fl[f];
    const alias = { ms: ['ms', 'load_ms', 'elapsed_ms'], status: ['status'], trace: ['trace', 'trace_id'] }[f];
    if (alias) for (const a of alias) if (a in fl) return fl[a];
    return undefined;
  }
  function termTest(k, e) {
    const val = lower(k.val);
    const wildRe = /[*?]/.test(val) ? new RegExp(val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\S*').replace(/\?/g, '\\S'), 'i') : null;
    if (k.field === '_exists_') return fieldOf(e, lower(k.val)) !== undefined;
    if (!k.field) {
      const hay = lower(e.msg + ' ' + e.level + ' ' + e.page + ' ' + JSON.stringify(e.fields || {}));
      return wildRe ? wildRe.test(hay) : hay.includes(val);
    }
    const fv = fieldOf(e, k.field);
    if (fv === undefined || fv === null) return false;
    if (k.op) { const a = parseFloat(fv), b = parseFloat(k.val); if (isNaN(a) || isNaN(b)) return false; return k.op === '>' ? a > b : k.op === '>=' ? a >= b : k.op === '<' ? a < b : a <= b; }
    const sv = lower(typeof fv === 'object' ? JSON.stringify(fv) : fv);
    if (wildRe) return new RegExp('^' + wildRe.source + '$', 'i').test(sv) || wildRe.test(sv);
    if (k.field === 'msg' || k.field === 'message') return sv.includes(val);
    return sv === val;
  }
  function filteredLogs(useBucket) {
    const [t0, t1] = span(), q = parseQuery(S.q);
    return G.logs().filter((e) => e.ts >= t0 && e.ts <= t1 + 1000 && (S.level === 'all' || e.level === S.level) && q.test(e) &&
      (!useBucket || !S.bucket || (e.ts >= S.bucket[0] && e.ts < S.bucket[1])));
  }
  function renderLogs() {
    const inRange = filteredLogs(false), list = filteredLogs(true).reverse();
    renderHist(inRange);
    $('logInfo').textContent = list.length + ' / ' + G.logs().length;
    const chip = $('logChip');
    if (S.bucket) { chip.hidden = false; chip.innerHTML = '<span class="mono">' + esc(hms(S.bucket[0]) + ' – ' + hms(S.bucket[1])) + '</span><button type="button" id="logChipX" aria-label="' + esc(G.t('Zaman süzgecini kaldır', 'Remove the time filter')) + '">' + G.icon('x') + '</button>'; }
    else chip.hidden = true;
    if (!list.length) { $('logList').innerHTML = '<li class="log-empty">' + G.t('eşleşen kayıt yok', 'no matching entries') + '</li>'; $('logList')._items = []; return; }
    $('logList').innerHTML = list.slice(0, 200).map((e, i) => '<li><button type="button" aria-expanded="false" data-i="' + i + '"><span class="tm">' + new Date(e.ts).toLocaleTimeString('en-GB') + '</span><span class="lv ' + e.level + '">' + e.level.toUpperCase() + '</span><span class="pg">' + esc(e.page) + '</span><span class="msg">' + esc(e.msg) + Object.keys(e.fields || {}).slice(0, 4).map((k) => ' <span class="tm">' + esc(k) + '=</span>' + esc(typeof e.fields[k] === 'object' ? JSON.stringify(e.fields[k]) : e.fields[k])).join('') + '</span></button></li>').join('');
    $('logList')._items = list;
  }
  // Histogram: seçili aralıkta zamana göre log sayısı (tek seri); çubuğa tıklayınca o dilime süzer
  function renderHist(list) {
    const svg = $('logHist'), wrap = $('logHistWrap'), [W, H] = fit(svg);
    const padL = 42, padR = 70, padT = 6, padB = 18;
    const [t0, t1] = span();
    const n = Math.max(10, Math.min(60, Math.floor((W - padL - padR) / 14)));
    const bw = (t1 + 1000 - t0) / n, counts = new Array(n).fill(0);
    list.forEach((e) => { const i = Math.min(n - 1, Math.floor((e.ts - t0) / bw)); if (i >= 0) counts[i]++; });
    const max = niceMax(Math.max(1, ...counts), 2);
    const x = (t) => padL + (W - padL - padR) * (t - t0) / (t1 + 1000 - t0);
    svg._x = x; svg._t0 = t0; svg._t1 = t1 + 1000; svg._counts = counts; svg._bw = bw;
    const y = (v) => padT + (H - padT - padB) * (1 - v / max), slot = (W - padL - padR) / n, bwPx = Math.min(24, Math.max(2, slot - 2));
    let s = '<line class="gridl" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(max) + '" y2="' + y(max) + '"/><text class="axis" x="' + (padL - 6) + '" y="' + (y(max) + 3) + '" text-anchor="end">' + max + '</text>' +
      '<line class="base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '"/><text class="axis" x="' + (padL - 6) + '" y="' + (y(0) + 3) + '" text-anchor="end">0</text>';
    const tt = timeTicks(t0, t1, W - padL - padR);
    tt.ticks.forEach((t) => { s += '<text class="axis" x="' + x(t).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(tt.fmt(t)) + '</text>'; });
    s += annSvg(annotations(t0, t1), x, padT, y(0));
    counts.forEach((c, i) => {
      const cx = padL + slot * i + slot / 2, sel = S.bucket && Math.abs(S.bucket[0] - (t0 + i * bw)) < 1;
      if (c) { const top = y(c), h = y(0) - top, r = Math.min(3, h); s += '<path class="hb' + (sel ? ' sel' : '') + '" d="M' + (cx - bwPx / 2).toFixed(1) + ' ' + y(0) + 'V' + (top + r).toFixed(1) + 'Q' + (cx - bwPx / 2).toFixed(1) + ' ' + top.toFixed(1) + ' ' + (cx - bwPx / 2 + r).toFixed(1) + ' ' + top.toFixed(1) + 'H' + (cx + bwPx / 2 - r).toFixed(1) + 'Q' + (cx + bwPx / 2).toFixed(1) + ' ' + top.toFixed(1) + ' ' + (cx + bwPx / 2).toFixed(1) + ' ' + (top + r).toFixed(1) + 'V' + y(0) + 'Z" fill="' + C.bar + '"/>'; }
      s += '<rect class="hit" data-i="' + i + '" x="' + (padL + slot * i).toFixed(1) + '" y="' + padT + '" width="' + slot.toFixed(1) + '" height="' + (H - padT - padB) + '"/>';
    });
    s += '<line class="xh" y1="' + padT + '" y2="' + y(0) + '" visibility="hidden"/>';
    svg.innerHTML = s;
    drawXH();
    if (!svg._wired) {
      svg._wired = true;
      const show = (i) => {
        const c = svg._counts[i], ta = svg._t0 + i * svg._bw, tb = ta + svg._bw;
        XH.t = ta + svg._bw / 2; drawXH();
        showTip(wrap, svg, tipRow(fmtN(c), G.t(c === 1 ? 'kayıt' : 'kayıt', c === 1 ? 'entry' : 'entries'), C.bar) + '<small>' + esc(hms(ta) + ' – ' + hms(tb)) + '</small><small class="t-hint">' + esc(G.t('tıkla: bu dilime süz', 'click: filter to this slice')) + '</small>', svg._x(XH.t), 8);
      };
      svg.addEventListener('pointermove', (e) => { const h = e.target.closest('.hit'); if (h) show(+h.dataset.i); });
      svg.addEventListener('pointerleave', () => { XH.t = null; drawXH(); hideTip(wrap); });
      svg.addEventListener('click', (e) => {
        const h = e.target.closest('.hit'); if (!h) return;
        const i = +h.dataset.i, ta = svg._t0 + i * svg._bw;
        S.bucket = S.bucket && Math.abs(S.bucket[0] - ta) < 1 ? null : [ta, ta + svg._bw];
        renderLogs();
      });
    }
  }
  let logQ = false;
  document.addEventListener('garage:log', () => { if (!logQ) { logQ = true; requestAnimationFrame(() => { logQ = false; renderLogs(); }); } });
  $('logList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const li = b.parentElement, open = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!open));
    if (open) { const p = li.querySelector('pre'); if (p) p.remove(); return; }
    const it = $('logList')._items[+b.dataset.i];
    const p = document.createElement('pre');
    p.textContent = JSON.stringify({ timestamp: new Date(it.ts).toISOString(), level: it.level, message: it.msg, page: it.page, source: location.host || 'localhost', fields: it.fields }, null, 2);
    li.appendChild(p);
  });
  $('logChip').addEventListener('click', (e) => { if (e.target.closest('#logChipX')) { S.bucket = null; renderLogs(); $('logSearch').focus(); } });
  let qT = 0;
  $('logSearch').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; renderLogs(); G.metrics.inc('garage_log_searches_total', {}); }, 120); });
  $('logLevels').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]'); if (!b) return;
    S.level = b.dataset.l;
    $('logLevels').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderLogs();
  });

  // ------------------------------------------------------------------ yayınlar (GitHub Actions)
  const REPO = (G.giscus && G.giscus.repo) || (() => { const u = String(G.github || '').split('/').pop(); return u ? u + '/' + u + '.github.io' : ''; })();
  const GH_KEY = 'garage-gh-runs';
  const rtf = () => (Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(G.lang() === 'en' ? 'en' : 'tr', { numeric: 'auto' }) : null);
  function ago(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000, f = rtf();
    if (!f) return G.ago(iso);
    const a = Math.abs(s);
    return a < 60 ? f.format(Math.round(s), 'second') : a < 3600 ? f.format(Math.round(s / 60), 'minute') : a < 86400 ? f.format(Math.round(s / 3600), 'hour') : f.format(Math.round(s / 86400), 'day');
  }
  const RUN_STATE = (r) => (r.status !== 'completed' ? ['s-run', 'clock', G.t('sürüyor', 'running')] : r.conclusion === 'success' ? ['s-ok', 'check', G.t('başarılı', 'success')] : r.conclusion === 'failure' || r.conclusion === 'timed_out' ? ['s-bad', 'x', G.t('başarısız', 'failed')] : ['s-skip', 'zap', r.conclusion === 'cancelled' ? G.t('iptal', 'cancelled') : (r.conclusion || '—')]);
  function renderRuns(data, err) {
    const ul = $('ghRuns'), foot = $('ghFoot');
    ul.classList.remove('loading');
    G.build().then((b) => {
      const liveSha = b && b.sha;
      if (data && data.runs && data.runs.length) {
        ul.innerHTML = data.runs.map((r) => {
          const [k, ic, label] = RUN_STATE(r);
          const secs = r.start && r.end ? Math.max(0, (new Date(r.end) - new Date(r.start)) / 1000) : null;
          const live = liveSha && r.sha === liveSha;
          return '<li class="run ' + k + '"><span class="rs">' + G.icon(ic) + '<span>' + esc(label) + '</span></span>' +
            '<span class="rt"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title || r.name || 'run') + '</a>' +
            '<small class="mono">#' + r.n + ' · ' + esc(r.branch || '') + ' · <a href="https://github.com/' + esc(REPO) + '/commit/' + esc(r.sha) + '" target="_blank" rel="noopener">' + esc(String(r.sha || '').slice(0, 7)) + '</a> · ' + esc(r.event || '') + (live ? ' · <b class="live">' + esc(G.t('yayında', 'live')) + '</b>' : '') + '</small></span>' +
            '<span class="rd mono">' + (secs != null ? (secs >= 60 ? Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's' : Math.round(secs) + 's') : '—') + '</span>' +
            '<span class="ra mono" title="' + esc(r.start || '') + '">' + esc(r.start ? ago(r.start) : '') + '</span></li>';
        }).join('');
      } else if (!err) ul.innerHTML = '<li class="log-empty">' + esc(G.t('Henüz çalıştırma yok: ilk push’tan sonra burada görünür.', 'No runs yet: they appear here after the first push.')) + '</li>';
      if (err) {
        const msg = err.kind === 'rate' ? G.t('GitHub API oran sınırına takıldı', 'GitHub API rate limit reached') + (err.reset ? G.t('; yeniden deneme: ', '; retry at ') + hm(err.reset * 1000) : '')
          : err.kind === '404' ? G.t('Depo bulunamadı ya da Actions kapalı', 'Repository not found or Actions disabled')
            : G.t('GitHub’a ulaşılamadı (çevrimdışı ya da engelli)', 'Could not reach GitHub (offline or blocked)');
        if (!data) ul.innerHTML = '<li class="log-empty">' + esc(msg) + '</li>';
        foot.innerHTML = esc(msg) + (data ? esc(G.t(' · önbellekteki liste gösteriliyor', ' · showing the cached list')) : '') + ' · <a href="https://github.com/' + esc(REPO) + '/actions" target="_blank" rel="noopener">Actions ↗</a>';
      } else if (data) foot.innerHTML = esc(REPO) + ' · ' + esc(G.t('son kontrol ', 'checked ') + hm(data.at)) + ' · <a href="https://github.com/' + esc(REPO) + '/actions" target="_blank" rel="noopener">Actions ↗</a>';
    });
  }
  async function loadRuns(force) {
    if (!REPO) { renderRuns(null, { kind: '404' }); return; }
    const cached = G.store.json(GH_KEY, true);
    if (!force && cached && Date.now() - cached.at < 10 * 60000) { renderRuns(cached); return; }
    $('ghRuns').classList.add('loading');
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/actions/runs?per_page=8', { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 403 || r.status === 429) throw { kind: 'rate', reset: +r.headers.get('x-ratelimit-reset') || 0 };
      if (r.status === 404) throw { kind: '404' };
      if (!r.ok) throw { kind: 'http', status: r.status };
      const j = await r.json();
      const data = { at: Date.now(), runs: (j.workflow_runs || []).slice(0, 8).map((w) => ({ n: w.run_number, title: String(w.display_title || (w.head_commit && w.head_commit.message) || '').split('\n')[0], name: w.name, branch: w.head_branch, sha: w.head_sha, status: w.status, conclusion: w.conclusion, event: w.event, start: w.run_started_at || w.created_at, end: w.updated_at, url: w.html_url })) };
      G.store.setJson(GH_KEY, data, true);
      renderRuns(data);
      G.log('info', 'github actions runs fetched', { count: data.runs.length });
    } catch (e) {
      renderRuns(cached, e && e.kind ? e : { kind: 'net' });
      G.log('warn', 'github actions runs unavailable', { kind: (e && e.kind) || 'net' });
    }
  }
  $('ghRefresh').addEventListener('click', () => loadRuns(true));

  // ------------------------------------------------------------------ çubuk
  function setRange(v) {
    S.range = v; S.bucket = null;
    G.store.sset(RKEY, v ? String(v) : null);
    $('dashRange').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.v === v)));
    renderLoads(); renderLogs(); renderWaterfall();
  }
  $('dashRange').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { setRange(+b.dataset.v); G.sfx('click'); } });
  $('dashRefresh').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    S.refresh = +b.dataset.v;
    $('dashRefresh').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    schedule();
  });
  $('dashReset').addEventListener('click', () => {
    G.metrics.reset(); S.fps = []; S.bucket = null;
    G.log('info', 'telemetry reset', {});
    renderAll(); G.toast(G.t('Telemetri sıfırlandı', 'Telemetry reset'), 'refresh');
  });
  $('promCopy').addEventListener('click', () => G.copy(G.metrics.exposition(), '/metrics'));
  $('dashTerm').addEventListener('click', () => G.openTerminal('curl -i /health'));

  function renderAll() { renderStats(); renderLive(); renderLoads(); renderWaterfall(); renderResources(); renderCounters(); renderAlerts(); renderProm(); renderEnv(); renderLogs(); renderFps(); }
  function schedule() { clearInterval(S.timer); if (S.refresh) S.timer = setInterval(() => { if (!document.hidden) { renderStats(); renderLoads(); renderResources(); renderCounters(); renderAlerts(); renderProm(); if (S.range) renderLogs(); } }, S.refresh * 1000); }
  window.addEventListener('load', () => setTimeout(() => { renderAll(); }, 60));
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { renderFps(); renderLoads(); renderLogs(); renderWaterfall(); }, 120); });
  $('dashRange').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.v === S.range)));
  renderAll(); schedule(); loadRuns(false);
  document.addEventListener('garage:lang', () => { renderAll(); const c = G.store.json(GH_KEY, true); if (c) renderRuns(c); });
  let vq = 0;
  document.addEventListener('garage:vitals', () => { clearTimeout(vq); vq = setTimeout(() => { renderStats(); renderAlerts(); }, 120); });
  document.addEventListener('garage:phase', renderEnv);
  document.addEventListener('garage:lite', renderEnv);
  window.addEventListener('online', renderAlerts); window.addEventListener('offline', renderAlerts);
  // Terminal ve diğer sayfalar için: ?q=level:error ile log aramasını önceden doldur
  const pre = new URLSearchParams(location.search).get('q');
  if (pre) { $('logSearch').value = pre; S.q = pre; renderLogs(); }
})();
