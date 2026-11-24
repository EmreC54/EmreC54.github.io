// Garage by Emre Çuhadar — gerçekçi giriş sahnesi
// Açılışta ışıklar yanar, kavisli ekran açılır; fare ile kamera hafifçe kayar (derinlik),
// monitöre tıklayınca kamera ekrana dalar ve siteye geçer.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const wrap = $('sceneWrap'), scene = $('scene'), zoom = $('zoom');
  const curved = $('screen'), fx = $('screenFx'), hit = $('enter'), btn = $('enterBtn'), blackout = $('blackout');
  const TARGET = 'garaj.html';
  const reduce = window.GarageFX ? window.GarageFX.reduce : false;
  const W = 1408, H = 768, MONITOR_W = 790;

  // ======================================================================
  //  KAVİSLİ EKRAN
  //  Görseldeki monitör içe kavisli: ekran kenarlarda ortadan ~%4 daha uzun.
  //  Ekranı N dikey şeride bölüp her şeridi perspektifte doğru derinliğe (Z) koyuyoruz;
  //  kenar şeritleri izleyiciye daha yakın → daha büyük görünür → gerçek kavis + paralaks.
  // ======================================================================
  const P = 1800, OX = 704, OY = 384;                // perspektif mesafesi ve kaçış noktası (scene-wrap)
  const S = { cx: 703.5, hw: 374.5, cy: 333.5, hh: 205.5, edge: 1.0414 }; // görselden ölçülen ekran
  const N = 48, THETA = 22 * Math.PI / 180;           // şerit sayısı, kavis açısı (kenar)
  const fOf = (nx) => 1 + (S.edge - 1) * nx * nx;     // kenara doğru büyüme
  const uOf = (nx) => 0.5 + 0.5 * Math.asin(nx * Math.sin(THETA)) / THETA;  // yay uzunluğuna göre doku

  function buildScreen() {
    const frag = document.createDocumentFragment();
    const wt = (2 * S.hw) / N;
    for (let i = 0; i < N; i++) {
      const n0 = -1 + 2 * i / N, n1 = -1 + 2 * (i + 1) / N, nc = (n0 + n1) / 2;
      const f = fOf(nc);
      const z = P * (1 - 1 / f);
      const xt = S.cx + nc * S.hw;
      const preW = wt / f, preH = 2 * S.hh;
      const preCx = OX + (xt - OX) / f, preCy = OY + (S.cy - OY) / f;
      const u0 = uOf(n0), u1 = uOf(n1);
      const bw = preW / (u1 - u0);
      const glare = 0.075 * Math.exp(-Math.pow((nc + 0.62) / 0.12, 2)) + 0.035 * Math.exp(-Math.pow((nc - 0.66) / 0.16, 2));
      const shade = 0.16 * nc * nc;
      const el = document.createElement('div');
      el.className = 'strip' + (i === 0 ? ' first' : i === N - 1 ? ' last' : '');
      el.style.cssText =
        'left:' + (preCx - preW / 2 - 0.6).toFixed(2) + 'px;top:' + (preCy - preH / 2).toFixed(2) + 'px;' +
        'width:' + (preW + 1.2).toFixed(2) + 'px;height:' + preH + 'px;' +
        'transform:translateZ(' + z.toFixed(2) + 'px);' +
        '--bw:' + bw.toFixed(2) + 'px;--bx:' + (-u0 * bw + 0.6).toFixed(2) + 'px;' +
        '--gl:' + glare.toFixed(3) + ';--sh:' + shade.toFixed(3);
      frag.appendChild(el);
    }
    curved.appendChild(frag);

    // Efekt katmanı: ekranın biraz önünde, kavisli kenarlara göre kırpılmış
    const zf = 80, ff = P / (P - zf);
    const boxW = 2 * S.hw, boxH = 2 * S.hh * S.edge;
    const preW = boxW / ff, preH = boxH / ff;
    const preCx = OX + (S.cx - OX) / ff, preCy = OY + (S.cy - OY) / ff;
    fx.style.cssText = 'left:' + (preCx - preW / 2) + 'px;top:' + (preCy - preH / 2) + 'px;width:' + preW + 'px;height:' + preH + 'px;transform:translateZ(' + zf + 'px)';
    const pts = [], K = 16;
    for (let k = 0; k <= K; k++) { const nx = -1 + 2 * k / K; pts.push(((k / K) * 100).toFixed(2) + '% ' + ((0.5 - 0.5 * fOf(nx) / S.edge) * 100).toFixed(2) + '%'); }
    for (let k = K; k >= 0; k--) { const nx = -1 + 2 * k / K; pts.push(((k / K) * 100).toFixed(2) + '% ' + ((0.5 + 0.5 * fOf(nx) / S.edge) * 100).toFixed(2) + '%'); }
    fx.style.clipPath = 'polygon(' + pts.join(',') + ')';
  }
  buildScreen();

  // Ekran görüntüleri: açılış + her bölmenin açık hali; iki katman arasında yumuşak geçiş
  const G = window.GARAGE;
  const framesFor = (l) => [1, 2, 3, 4].map((n) => 'assets/screen/' + (l === 'en' ? 'en/' : '') + 'bay' + n + '.webp');
  let FRAMES = framesFor(G.lang());
  // Ekranda sadece yüklenmiş kareler döner: yavaş bağlantıda ya da çevrimdışıyken monitör boş kalmaz, açılış ekranında bekler
  const ready = new Set();
  const preload = (list) => list.forEach((src) => { if (ready.has(src)) return; const im = new Image(); im.onload = () => ready.add(src); im.src = src; });
  preload(FRAMES);
  document.addEventListener('garage:lang', (e) => { FRAMES = framesFor(e.detail); preload(FRAMES); clock(); renderPhaseChip(); });
  // CSS değişkenindeki göreli adres, değişkeni kullanan stil dosyasına göre çözülür: mutlak adres ver
  const cssUrl = (p) => 'url("' + new URL(p, document.baseURI).href + '")';
  curved.style.setProperty('--shotA', cssUrl('assets/screen/boot.webp'));
  let showingB = false, fi = -1, frameTimer = 0;
  function nextFrame() {
    const list = FRAMES.filter((f) => ready.has(f));
    if (!list.length) return;
    fi = (fi + 1) % list.length;
    const url = cssUrl(list[fi]);
    if (showingB) { curved.style.setProperty('--shotA', url); curved.style.setProperty('--bOn', '0'); }
    else { curved.style.setProperty('--shotB', url); curved.style.setProperty('--bOn', '1'); }
    showingB = !showingB;
  }
  function screenOn() {
    nextFrame();
    if (!reduce) frameTimer = setInterval(nextFrame, 2600);
  }

  // ---- Ölçek: ekranı kapla ama telefonda monitör sığsın.
  // Üst bar, köşe düğmeleri ve alt düğmeler sahnedeki tabelanın ya da monitörün üstüne binecekse
  // sahne biraz küçülür ve iki arayüz şeridinin arasına ortalanır (tablet, yatay telefon, dar pencere).
  const BANNER = { l: 355, r: 1050, t: 36 }, MON_B = 550;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cover = Math.max(vw / W, vh / H) * 1.03;
    const monitorFit = (vw * 0.95) / MONITOR_W;
    let s = Math.min(cover, Math.max(monitorFit, vw / W)), oy = 0;
    const topBar = document.querySelector('.intro-ui.top'), corner = document.querySelector('.intro-ui.corner'), bottomUi = document.querySelector('.intro-ui.bottom');
    if (topBar && bottomUi) {
      let top = topBar.getBoundingClientRect().bottom, bottom = vh;
      const cr = corner && corner.getBoundingClientRect();
      const cornerTop = !!(cr && cr.height && cr.top < vh / 2);
      if (cornerTop) top = Math.max(top, cr.bottom);
      bottomUi.querySelectorAll(':scope > *, .quick').forEach((el) => { const r = el.getBoundingClientRect(); if (r.height && r.top > vh / 2) bottom = Math.min(bottom, r.top); });
      top += 6; bottom -= 6;
      const brand = topBar.querySelector('.brand'), skip = topBar.querySelector('.skip');
      const bl = vw / 2 + (BANNER.l - 704) * s, br = vw / 2 + (BANNER.r - 704) * s;
      const hitsTop = cornerTop || (brand && bl < brand.getBoundingClientRect().right + 12) || (skip && br > skip.getBoundingClientRect().left - 12);
      const bTop = vh / 2 + (BANNER.t - 384) * s, mBot = vh / 2 + (MON_B - 384) * s;
      // tabela üst arayüzle çakışmıyor ama ekranın üstünden taşıyorsa (yatay telefon) sahne biraz aşağı kayar
      const clipTop = !hitsTop && bTop < 6;
      if ((hitsTop && bTop < top) || clipTop || mBot > bottom) {
        const t0 = hitsTop ? top : 6;
        s = Math.min(s, Math.max(0.3, (bottom - t0) / (MON_B - BANNER.t)));
        oy = (t0 + bottom) / 2 - (vh / 2 + ((BANNER.t + MON_B) / 2 - 384) * s);
      }
    }
    wrap.style.setProperty('--s', s.toFixed(4));
    wrap.style.setProperty('--oy', oy.toFixed(1) + 'px');
  }
  fit();
  document.addEventListener('DOMContentLoaded', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fit, 120); });

  // ---- Toz
  const dust = window.GarageFX ? window.GarageFX.dust($('dust'), { count: window.innerWidth < 700 ? 40 : 90 }) : null;

  // ---- Paralaks kamera (doğrudan transform: kare başına stil yeniden hesaplaması yok)
  let tx = 0, ty = 0, cx = 0, cy = 0, lastMove = -1e9, entering = false, hovering = false, push = 0, running = false;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
    lastMove = performance.now();
  }, { passive: true });
  function tick(t) {
    if (entering || !running) return;
    if (performance.now() - lastMove > 5000 && !document.documentElement.classList.contains('lite')) {
      tx = Math.sin(t / 5200) * 0.22;
      ty = Math.cos(t / 6800) * 0.12;
    }
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    push += ((hovering ? 1 : 0) - push) * 0.07;
    scene.style.transform =
      'translate3d(' + (-cx * 26).toFixed(2) + 'px,' + (-cy * 16).toFixed(2) + 'px,' + (push * 40).toFixed(2) + 'px) ' +
      'rotateY(' + (cx * 3.4).toFixed(3) + 'deg) rotateX(' + (-cy * 2.2).toFixed(3) + 'deg)';
    if (dust) dust.setOffset(-cx, -cy);
    requestAnimationFrame(tick);
  }
  function startCam() { if (!running && !reduce && !entering) { running = true; requestAnimationFrame(tick); } }
  function stopCam() { running = false; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); else startCam(); });
  startCam();

  // ---- Açılış: ışıklar yanar, ekran açılır, tabela yazılır
  function typeLine() {
    const el = $('typeline');
    const text = el.textContent;
    if (reduce) return;
    el.textContent = ''; el.classList.add('typing');
    let i = 0;
    const iv = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(iv); setTimeout(() => el.classList.remove('typing'), 1200); }
    }, 38);
  }
  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    setTimeout(() => body.classList.remove('booting'), reduce ? 0 : 250);
    setTimeout(screenOn, reduce ? 0 : 1500);
    setTimeout(typeLine, reduce ? 0 : 1100);
  }
  const plate = scene.querySelector('.plate');
  if (plate.complete) boot(); else { plate.addEventListener('load', boot); plate.addEventListener('error', boot); setTimeout(boot, 2500); }

  // ---- Tabela: atölye durumu + Kocaeli saati
  function clock() {
    const w = G.workshopStatus();
    $('clock').textContent = w.text + ' · ' + G.city + ' ' + G.localTime();
    $('wsDot').classList.toggle('closed', !w.open);
  }
  clock(); setInterval(clock, 20000);

  // ---- Gün döngüsü: zaman düğmesi (tıklayınca dilimleri önizler) + dilime özel görsel
  const PH_ICON = {
    morning: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.8 1.4M18.4 10.6l-1.8 1.4"/>',
    day: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    evening: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 9V6M9.5 7.5L12 5l2.5 2.5"/>',
    night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'
  };
  const chip = $('phaseChip');
  function renderPhaseChip() {
    const ph = G.phase(), pv = !!G.phaseOverride();
    chip.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PH_ICON[ph] + '</svg>' +
      '<span class="lbl">' + G.phaseName(ph) + '</span>' + (pv ? '<span class="pv">' + G.t('önizleme', 'preview') + '</span>' : '');
    chip.setAttribute('aria-label', G.t('Garajın zamanı: ', 'Garage time: ') + G.phaseName(ph) + (pv ? G.t(' (önizleme). Tıkla: sonraki dilim.', ' (preview). Click for the next one.') : G.t(' (Kocaeli saatine göre). Tıkla: diğer dilimleri önizle.', ' (Kocaeli time). Click to preview the others.')));
    chip.title = chip.getAttribute('aria-label');
  }
  function applyPhaseImage() {
    const src = (G.sceneImages || {})[G.phase()];
    const plateEl = scene.querySelector('.plate');
    document.documentElement.classList.toggle('has-phase-image', !!src);
    const want = src || 'assets/img/garage-scene.jpg';
    // <picture> içindeki AVIF/WebP kaynakları sadece ana görsel içindir; dilim görseli varsa devre dışı kalır
    const pic = plateEl.parentElement && plateEl.parentElement.tagName === 'PICTURE' ? plateEl.parentElement : null;
    if (pic) pic.querySelectorAll('source').forEach((so) => {
      if (!so.dataset.srcset) so.dataset.srcset = so.getAttribute('srcset') || '';
      if (src) so.removeAttribute('srcset'); else if (so.getAttribute('srcset') !== so.dataset.srcset) so.setAttribute('srcset', so.dataset.srcset);
    });
    if (!plateEl.getAttribute('src').endsWith(want)) plateEl.setAttribute('src', want);
  }
  function nextPhase() {
    const ov = G.cyclePhase(); G.sfx('click');
    G.toast(G.t('Garaj zamanı: ', 'Garage time: ') + G.phaseName(G.phase()) + (ov ? G.t(' (önizleme)', ' (preview)') : G.t(' (Kocaeli saati)', ' (Kocaeli time)')), { morning: 'sunrise', day: 'sun', evening: 'sunset', night: 'moon' }[G.phase()]);
  }
  const bulbTitle = $('bulbTitle');
  const renderBulb = () => { if (bulbTitle) bulbTitle.textContent = G.t('ZAMAN: ', 'TIME: ') + G.phaseName(G.phase()).toLocaleUpperCase(G.lang() === 'en' ? 'en' : 'tr'); };
  chip.addEventListener('click', nextPhase);
  document.addEventListener('garage:phase', () => { renderPhaseChip(); applyPhaseImage(); renderBulb(); });
  document.addEventListener('garage:lang', renderBulb);
  renderPhaseChip(); applyPhaseImage(); renderBulb();

  // ---- Sahnedeki nesneler: üzerine gelince etrafı bulanıklaşır (odak), etiket belirir; tıklayınca o nesneye dalınır
  const HS = {   // sahne koordinatlarında odak merkezi ve yarıçapı
    sema: { c: [323, 698], r: [270, 100] },
    canta: { c: [178, 635], r: [175, 105] },
    kontrol: { c: [1255, 360], r: [120, 125] },
    klavye: { c: [703, 700], r: [280, 75] },
    ampul: { c: [118, 190], r: [120, 105] },
    veri: { c: [1147, 362], r: [95, 110] },
    api: { c: [242, 370], r: [125, 95] },
    defter: { c: [202, 520], r: [78, 66] },
    isik: { c: [233, 285], r: [110, 48] }
  };
  // Floresan: garajın ışıkları (garaj sayfasıyla aynı tercih, bu sekme boyunca)
  const lightsOff = () => G.store.sget('garage-lights') === 'off';
  function applyLights() { body.classList.toggle('lights-off', lightsOff()); }
  function toggleLights() {
    G.store.sset('garage-lights', lightsOff() ? null : 'off');
    applyLights(); G.sfx('click');
    G.metrics.inc('garage_light_switch_total', { page: 'giris' });
    G.toast(lightsOff() ? G.t('Işıklar kapandı: ekran tek ışık kaynağı', 'Lights off: the screen is the only light') : G.t('Işıklar açıldı', 'Lights on'), 'bulb');
  }
  applyLights();
  const blurEl = $('focusBlur');
  const labels = {};
  document.querySelectorAll('.hs-label').forEach((l) => { labels[l.dataset.for] = l; });
  let unfocusT = 0;
  function focusOn(id) {
    const h = HS[id]; if (!h || entering) return;
    clearTimeout(unfocusT);
    blurEl.style.setProperty('--cx', h.c[0] + 'px'); blurEl.style.setProperty('--cy', h.c[1] + 'px');
    blurEl.style.setProperty('--rx', h.r[0] + 'px'); blurEl.style.setProperty('--ry', h.r[1] + 'px');
    body.classList.add('focusing');
    Object.keys(labels).forEach((k) => labels[k].classList.toggle('on', k === id));
  }
  function unfocus() {
    clearTimeout(unfocusT);
    unfocusT = setTimeout(() => { body.classList.remove('focusing'); Object.keys(labels).forEach((k) => labels[k].classList.remove('on')); }, 80);
  }
  function diveTo(el, href) {   // nesneye doğru kısa kamera hareketi, sonra sayfa
    if (entering) return;
    entering = true; clearInterval(frameTimer);
    body.classList.add('entering', 'diving');
    G.sfx('dive');
    const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.max(1.8, Math.min(3.4, Math.min(vw / r.width, vh / r.height) * 0.6));
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    zoom.style.transition = 'transform 1s cubic-bezier(.6, 0, .2, 1)';
    zoom.style.transform = 'translate(' + (vw / 2 - s * cx).toFixed(1) + 'px,' + (vh / 2 - s * cy).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
    setTimeout(() => blackout.classList.add('on'), 640);
    setTimeout(() => { location.href = href; }, 960);
  }
  document.querySelectorAll('.hs').forEach((a) => {
    const id = a.dataset.hs;
    a.addEventListener('mouseenter', () => focusOn(id));
    a.addEventListener('mouseleave', unfocus);
    a.addEventListener('focus', () => focusOn(id));
    a.addEventListener('blur', unfocus);
    a.addEventListener('click', (e) => {
      if (id === 'ampul') { e.preventDefault(); nextPhase(); return; }
      if (id === 'isik') { e.preventDefault(); toggleLights(); return; }
      if (a.hasAttribute('data-terminal')) { unfocus(); return; }       // ui.js terminali açar
      if (reduce || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      diveTo(a, a.getAttribute('href'));
    });
    a.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Spacebar') return;
      if (id === 'ampul') { e.preventDefault(); nextPhase(); }
      else if (id === 'isik') { e.preventDefault(); toggleLights(); }
    });
  });

  // ---- Keşif ipucu: fare bir süre dolaşıp hiçbir nesneye gelmediyse nesneler sırayla kısa bir an parlar (oturumda bir kez)
  const hsSvg = document.querySelector('.hotspots');
  if (hsSvg && !reduce && !G.touch && !G.store.sget('garage-discovered')) {
    let touched = false, t = 0;
    const arm = () => { clearTimeout(t); t = setTimeout(() => {
      if (touched || entering || body.classList.contains('focusing') || G.topLayer()) return arm();
      G.store.sset('garage-discovered', '1');
      hsSvg.querySelectorAll('.hs').forEach((a, k) => a.style.setProperty('--k', k));
      hsSvg.classList.add('discover');
      setTimeout(() => hsSvg.classList.remove('discover'), 4200);
    }, 6500); };
    document.querySelectorAll('.hs').forEach((a) => a.addEventListener('mouseenter', () => { touched = true; G.store.sset('garage-discovered', '1'); }, { once: true }));
    arm();
  }

  // ---- Monitör üzerine gelme: ekran hafifçe aydınlanır, kamera yaklaşır
  const on = () => { hovering = true; body.classList.add('hovering'); curved.style.setProperty('--hov', '1'); };
  const off = () => { hovering = false; body.classList.remove('hovering'); curved.style.setProperty('--hov', '0'); };
  hit.addEventListener('mouseenter', on);
  hit.addEventListener('mouseleave', off);
  hit.addEventListener('focus', on);
  hit.addEventListener('blur', off);

  // ---- Tıklanan noktadan ekrana yayılan ışık halkası
  function ripple(e) {
    const r = hit.getBoundingClientRect();
    const hasPoint = e && e.clientX && e.target === hit;
    const x = hasPoint ? (e.clientX - r.left) / r.width : 0.5;
    const y = hasPoint ? (e.clientY - r.top) / r.height : 0.5;
    const flash = $('flash');
    flash.style.setProperty('--cx', (x * 100).toFixed(1) + '%');
    flash.style.setProperty('--cy', (y * 100).toFixed(1) + '%');
    flash.classList.add('go');
    ['r1', 'r2'].forEach((c) => {
      const el = document.createElement('span');
      el.className = 'ripple ' + c;
      el.style.left = (x * fx.offsetWidth) + 'px';
      el.style.top = (y * fx.offsetHeight) + 'px';
      fx.appendChild(el);
    });
  }

  // ---- İçeri gir: kamerayı düzle, ekrana dal, siteye geç
  function enter(e) {
    if (entering) return;
    try { sessionStorage.setItem('garage-from-intro', '1'); } catch (err) { /* önemli değil */ }
    if (reduce) { window.location.href = TARGET; return; }
    ripple(e);
    G.sfx('dive');
    entering = true;
    clearInterval(frameTimer);
    body.classList.add('entering');
    scene.style.transition = 'transform .55s ease-out';
    scene.style.transform = 'translate3d(0,0,0) rotateY(0deg) rotateX(0deg)';
    setTimeout(() => {
      const r = hit.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const s = Math.max(vw / r.width, vh / r.height) * 1.06;
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      zoom.style.transform = 'translate(' + (vw / 2 - s * c.x) + 'px,' + (vh / 2 - s * c.y) + 'px) scale(' + s + ')';
      off();
      setTimeout(() => blackout.classList.add('on'), 1300);
      setTimeout(() => { window.location.href = TARGET; }, 1650);
    }, 580);
  }
  hit.addEventListener('click', enter);
  btn.addEventListener('click', enter);

  // ---- Geri tuşuyla dönülürse sahneyi sıfırla
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    entering = false;
    body.classList.remove('entering', 'diving', 'focusing');
    Object.keys(labels).forEach((k) => labels[k].classList.remove('on'));
    blackout.classList.remove('on');
    $('flash').classList.remove('go');
    fx.querySelectorAll('.ripple').forEach((el) => el.remove());
    zoom.style.transition = 'none'; zoom.style.transform = '';
    scene.style.transition = '';
    requestAnimationFrame(() => { zoom.style.transition = ''; startCam(); if (!reduce) frameTimer = setInterval(nextFrame, 2600); });
  });
})();
