// Garage — ortak arayüz (ui.js): komut paleti (Ctrl/⌘ K), kısayollar (?), bildirimler,
// kopyalama, build bilgisi ve terminalin ihtiyaç anında yüklenmesi.
(function () {
  'use strict';
  const G = window.GARAGE;
  const BASE = (document.currentScript && document.currentScript.src.replace(/ui\.js(\?.*)?$/, '')) || 'assets/js/';
  const VQ = (document.currentScript && (document.currentScript.src.match(/\?v=[\w-]+/) || [''])[0]) || '';   // yayındaki sürüm etiketi: gerekince yüklenen dosyalar da taze gelsin
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  G.esc = esc;
  const typingIn = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // =================================================================== BİLDİRİM
  let toastBox = null;
  G.toast = function (msg, icon) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = G.icon(icon || 'check') + '<span>' + esc(msg) + '</span>';
    toastBox.appendChild(t);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2400);
  };

  // =================================================================== KOPYALA
  G.copy = function (text, what) {
    const done = () => G.toast((what ? what + ' ' : '') + G.t('kopyalandı', 'copied'), 'copy');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* */ }
      ta.remove();
      ok ? done() : G.toast(text, 'copy');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    const what = b.dataset.copy;
    if (what === 'email') G.copy(G.email, G.t('E-posta adresi', 'Email address'));
    else if (what === 'url') { const c = document.querySelector('link[rel="canonical"]'); G.copy(c ? c.href : location.href.split('#')[0], G.t('Bağlantı', 'Link')); }
    else G.copy(what);
  });

  // =================================================================== SAYAÇ (kilometre saati gibi dönen rakamlar)
  // Ekran okuyucu gerçek değeri okur (.vh); dönen şeritler aria-hidden. Hareket azaltılmışsa ya da hafif modda düz metin.
  G.odo = function (el, text) {
    if (!el) return;
    text = String(text);
    if (G.reduce || G.lite() || !/\d/.test(text)) { if (el.textContent !== text || el.firstElementChild) el.textContent = text; return; }
    const shape = text.replace(/\d/g, '0');
    let o = el.firstElementChild;
    const fresh = !o || !o.classList.contains('odo') || o.dataset.shape !== shape;
    if (fresh) {
      el.innerHTML = '<span class="odo" aria-hidden="true" data-shape="' + esc(shape) + '">' + Array.from(text).map((c) => (/\d/.test(c)
        ? '<span class="odo-d"><span class="odo-s">' + '0123456789'.split('').map((d) => '<span>' + d + '</span>').join('') + '</span></span>'
        : '<span class="odo-c">' + esc(c) + '</span>')).join('') + '</span><span class="vh"></span>';
      o = el.firstElementChild;
    }
    el.lastElementChild.textContent = text;
    const digits = Array.from(text).filter((c) => /\d/.test(c));
    const strips = o.querySelectorAll('.odo-s');
    const apply = () => strips.forEach((st, i) => { st.style.transform = 'translateY(' + (-digits[i] * 10) + '%)'; });
    if (fresh) requestAnimationFrame(() => requestAnimationFrame(apply)); else apply();
  };

  // =================================================================== İMLEÇ IŞIĞI (kartlarda imleci izleyen hafif ışık)
  // Sadece fare + ince imleçte; dokunmatikte, hafif modda ve hareket azaltılmışsa kapalı. Yalnızca CSS değişkeni yazılır.
  const GLOW_SEL = '.tool-card, .route-tape, .tile, .card, .post-card, .callout-link';
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  function setGlow() { document.documentElement.classList.toggle('glow-on', finePointer.matches && !G.reduce && !G.lite()); }
  setGlow();
  if (finePointer.addEventListener) finePointer.addEventListener('change', setGlow);
  document.addEventListener('garage:lite', setGlow);
  let glowQ = 0, glowEl = null, glowX = 0, glowY = 0;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !document.documentElement.classList.contains('glow-on')) return;
    const el = e.target && e.target.closest ? e.target.closest(GLOW_SEL) : null;
    if (!el) return;
    glowEl = el; glowX = e.clientX; glowY = e.clientY;
    if (!glowQ) glowQ = requestAnimationFrame(() => {
      glowQ = 0;
      const r = glowEl.getBoundingClientRect();
      glowEl.style.setProperty('--mx', Math.round(glowX - r.left) + 'px');
      glowEl.style.setProperty('--my', Math.round(glowY - r.top) + 'px');
    });
  }, { passive: true });

  // =================================================================== ORTAK KATMAN (odak tuzağı + Esc)
  const layers = [];
  function openLayer(el, focusEl) {
    const prev = document.activeElement;
    el.hidden = false;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const layer = { el, prev };
    layers.push(layer);
    setTimeout(() => (focusEl || el.querySelector('input, button, [href]') || el).focus(), 30);
    return layer;
  }
  function closeLayer(el) {
    const i = layers.findIndex((l) => l.el === el);
    if (i < 0) return;
    const [layer] = layers.splice(i, 1);
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, G.reduce ? 0 : 220);
    // odak, katmanı açan öğeye döner; öyle bir öğe yoksa (kısayolla açıldıysa) gizlenen katmanda kalmasın
    const back = layer.prev && layer.prev !== document.body && document.contains(layer.prev) ? layer.prev : null;
    if (back && back.focus) back.focus({ preventScroll: true });
    else if (el.contains(document.activeElement)) document.activeElement.blur();
  }
  G.openLayer = openLayer; G.closeLayer = closeLayer;
  G.topLayer = () => (layers.length ? layers[layers.length - 1].el : null);
  document.addEventListener('keydown', (e) => {
    const top = G.topLayer();
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLayer(top); return; }
    if (e.key === 'Tab') {      // odak katmanın içinde kalsın
      const f = Array.from(top.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  function overlay(cls, label) {
    const o = document.createElement('div');
    o.className = 'overlay ' + (cls || '');
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', label);
    o.hidden = true;
    o.addEventListener('mousedown', (e) => { if (e.target === o) closeLayer(o); });
    return o;
  }

  // =================================================================== KOMUT PALETİ
  const PAGES = [
    { id: 'garaj', href: 'garaj.html', icon: 'garage', t: ['Garaj', 'Garage'], s: ['Dört kapı, ana sayfa', 'Four doors, main page'], k: 'ana home kapi door' },
    { id: 'hakkimda', href: 'hakkimda.html', icon: 'user', t: ['Hakkımda', 'About'], s: ['Kim olduğum, deneyim, eğitim', 'Who I am, experience, education'], k: 'about whoami deneyim egitim' },
    { id: 'takim-cantasi', href: 'takim-cantasi.html', icon: 'toolbox', t: ['Takım Çantası', 'Toolbox'], s: ['Kullandığım teknolojiler', 'Technologies I use'], k: 'skills yetenek stack dotnet redis' },
    { id: 'sema', href: 'sema.html', icon: 'blueprint', t: ['Şema: bir isteğin yolculuğu', 'Blueprint: a request’s journey'], s: ['Önbellek, veritabanı ve izleme simülasyonu', 'Cache, database and observability simulation'], k: 'mimari architecture cache onbellek simulasyon redis mssql mongo' },
    { id: 'seyir-defteri', href: 'seyir-defteri.html', icon: 'book', t: ['Seyir Defteri', 'Logbook'], s: ['Notlar ve yazılar', 'Notes and posts'], k: 'blog yazi post' },
    { id: 'iletisim', href: 'iletisim.html', icon: 'intercom', t: ['İletişim', 'Contact'], s: ['E-posta, GitHub, LinkedIn, ziyaretçi defteri', 'Email, GitHub, LinkedIn, guestbook'], k: 'mail contact guestbook ziyaretci' },
    { id: 'kontrol-odasi', href: 'kontrol-odasi.html', icon: 'gauge', t: ['Kontrol Odası', 'Control Room'], s: ['Bu sitenin canlı metrikleri ve logları', 'Live metrics and logs of this site'], k: 'metrics metrik grafana prometheus graylog log telemetri' },
    { id: 'veri-odasi', href: 'veri-odasi.html', icon: 'db', t: ['Veri Odası: SQL ve MongoDB', 'Data Room: SQL and MongoDB'], s: ['Sitenin verisini sorgula', 'Query the site’s data'], k: 'veri data sql mongo mongodb sorgu query veritabani database select join aggregate' },
    { id: 'api', href: 'api.html', icon: 'api', t: ['API: gerçek JSON uçları', 'API: real JSON endpoints'], s: ['Swagger tarzı belge, dene düğmesi', 'Swagger-style docs, try it'], k: 'api json swagger openapi rest curl endpoint uc' },
    { id: 'cv', href: 'cv.html', icon: 'file', t: ['CV', 'CV / Résumé'], s: ['Tek sayfa, yazdırılabilir', 'One page, printable'], k: 'ozgecmis resume pdf' },
    { id: 'giris', href: 'index.html', icon: 'eye', t: ['Giriş sahnesi', 'Intro scene'], s: ['Masadaki bilgisayar', 'The computer on the desk'], k: 'intro masa desk 3d' }
  ];
  function actions() {
    const A = [
      { icon: 'map', t: ['Garaj planı', 'Garage plan'], s: ['Neredesin, nereye gidebilirsin', 'Where you are and where to go'], hint: 'M', k: 'plan harita map kat floor nerede where rota route', run: () => G.openPlan() },
      { icon: 'route', t: ['Tanış rotası: Emre’yi tanı', 'Meet route: get to know Emre'], s: ['Hakkımda → Takım Çantası → Seyir Defteri → İletişim', 'About → Toolbox → Logbook → Contact'], k: 'rota route tanis meet tur tour', run: () => { location.href = 'hakkimda.html'; } },
      { icon: 'route', t: ['Kurcala rotası: sistemi kurcala', 'Tinker route: tinker with the system'], s: ['Şema → Kontrol Odası → Veri Odası → API', 'Blueprint → Control Room → Data Room → API'], k: 'rota route kurcala tinker tur tour teknik', run: () => { location.href = 'sema.html'; } },
      { icon: 'terminal', t: ['Terminali aç', 'Open terminal'], s: ['Komut satırından gez', 'Browse from the command line'], hint: '"', k: 'terminal cli komut shell', run: () => G.openTerminal() },
      { icon: 'xray', t: ['Röntgen modu', 'X-ray mode'], s: ['Bölümleri, onları yapan dosyalarla etiketle', 'Label sections with the files that build them'], hint: 'X', k: 'rontgen xray kaynak source kod code github dosya file nasil yapildi', run: () => G.xray() },
      { icon: 'book', t: G.explain() === 'basit' ? ['Anlatım: teknik', 'Explanations: technical'] : ['Anlatım: basit', 'Explanations: simple'], s: ['Teknik odalardaki açıklamaların düzeyi', 'Level of the explanations in the technical rooms'], k: 'anlatim explain basit simple teknik technical aciklama', run: () => { G.setExplain(G.explain() === 'basit' ? 'teknik' : 'basit'); G.toast(G.explain() === 'basit' ? G.t('Anlatım: basit', 'Explanations: simple') : G.t('Anlatım: teknik', 'Explanations: technical'), 'book'); } },
      { icon: 'globe', t: [G.lang() === 'tr' ? 'Switch to English' : 'Türkçeye geç', G.lang() === 'tr' ? 'Switch to English' : 'Türkçeye geç'], s: ['Dil: TR / EN', 'Language: TR / EN'], k: 'dil language english turkce ingilizce', run: () => G.setLang(G.lang() === 'tr' ? 'en' : 'tr') },
      { icon: G.soundOn() ? 'mute' : 'volume', t: G.soundOn() ? ['Sesi kapat', 'Mute sound'] : ['Sesi aç', 'Turn sound on'], s: ['Kapı, şalter ve terminal sesleri', 'Door, switch and terminal sounds'], k: 'ses sound audio', run: () => G.setSound(!G.soundOn()) },
      { icon: 'copy', t: ['E-posta adresini kopyala', 'Copy email address'], s: [G.email, G.email], k: 'mail eposta email kopyala', run: () => G.copy(G.email, G.t('E-posta adresi', 'Email address')) },
      { icon: 'qr', t: ['Siteyi paylaş · QR kod', 'Share the site · QR code'], s: ['Telefonla okutulacak kod, bağlantı ve kişi kartı', 'A scannable code, the link and a contact card'], k: 'paylas share qr karekod kod telefon tanit', run: () => G.openShare() },
      { icon: 'card', t: ['Rehbere ekle (vCard)', 'Add to contacts (vCard)'], s: ['Kişi kartını indir', 'Download the contact card'], k: 'vcard rehber kisi kart contact telefon', run: () => G.vcard() },
      { icon: 'link', t: ['Bu sayfanın bağlantısını kopyala', 'Copy link to this page'], s: [location.href.split('#')[0], location.href.split('#')[0]], k: 'link url baglanti paylas share', run: () => G.copy(location.href, G.t('Bağlantı', 'Link')) },
      { icon: 'github', t: ['GitHub profilini aç', 'Open GitHub profile'], s: ['github.com/EmreC54', 'github.com/EmreC54'], k: 'github kod code', run: () => window.open(G.github, '_blank', 'noopener') },
      { icon: 'linkedin', t: ['LinkedIn profilini aç', 'Open LinkedIn profile'], s: ['linkedin.com/in/emre-çuhadar', 'linkedin.com/in/emre-çuhadar'], k: 'linkedin is job', run: () => window.open(G.linkedin, '_blank', 'noopener') },
      { icon: 'zap', t: G.lite() ? ['Efektleri aç (tam kalite)', 'Turn effects on (full quality)'] : ['Hafif mod: ağır efektleri kapat', 'Lite mode: turn off heavy effects'], s: G.lite() ? ['Toz, ışık animasyonları ve yansımalar geri gelir', 'Dust, light animations and reflections come back'] : ['Zayıf cihaz ya da pil tasarrufu için', 'For slower devices or to save battery'], k: 'hafif lite performans performance efekt effect pil battery kalite quality', run: () => { G.setLite(!G.lite(), true); G.toast(G.lite() ? G.t('Hafif mod açık', 'Lite mode on') : G.t('Tam kalite', 'Full quality'), 'zap'); } },
      { icon: 'keyboard', t: ['Klavye kısayolları', 'Keyboard shortcuts'], s: ['Tüm kısayolların listesi', 'List of all shortcuts'], hint: '?', k: 'kisayol shortcut keyboard help yardim', run: () => openKeys() }
    ];
    if (document.getElementById('lightSwitch')) A.splice(3, 0, { icon: 'bulb', t: ['Işıkları aç / kapat', 'Toggle the lights'], s: ['Kapalıyken fare bir el feneri', 'With lights off, your cursor is a flashlight'], hint: 'L', k: 'isik light fener flashlight dark', run: () => document.getElementById('lightSwitch').click() });
    const ph = { morning: 'sunrise', day: 'sun', evening: 'sunset', night: 'moon' };
    G.PHASES.forEach((p) => A.push({ icon: ph[p], t: [G.tx({ tr: 'Garaj zamanı: ', en: 'Garage time: ' }) + G.phaseName(p), G.tx({ tr: 'Garaj zamanı: ', en: 'Garage time: ' }) + G.phaseName(p)], s: ['Bu dilimi önizle', 'Preview this time of day'], k: 'zaman gun dilimi phase time sabah gunduz aksam gece morning day evening night tema theme ' + p, run: () => { G.setPhase(p); G.toast(G.t('Zaman: ', 'Time: ') + G.phaseName(p), ph[p]); } }));
    A.push({ icon: 'clock', t: ['Garaj zamanı: otomatik', 'Garage time: automatic'], s: ['Kocaeli saatine göre', 'Follows Kocaeli time'], k: 'zaman otomatik auto phase time kocaeli', run: () => { G.setPhase(null); G.toast(G.t('Zaman: Kocaeli saati', 'Time: Kocaeli clock'), 'clock'); } });
    return A;
  }
  let postsCache = null;
  function loadPosts() {
    if (postsCache) return Promise.resolve(postsCache);
    const src = G.blog ? G.blog.list() : fetch('posts/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => (j.posts || []).filter((p) => !p.draft).sort((a, b) => (a.date < b.date ? 1 : -1)));
    return src.then((p) => (postsCache = p)).catch(() => (postsCache = []));
  }
  const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Harf sırası eşleşmesi (kntrl → kontrol): eşleşen harfler birbirine ne kadar yakınsa puan o kadar yüksek
  const subseq = (s, q) => { let i = 0, gaps = 0, last = -1; for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { if (last >= 0) gaps += j - last - 1; last = j; i++; } return i === q.length ? gaps : -1; };
  function score(item, q) {
    if (!q) return 1;
    const title = norm(item.title), hay = norm(item.title + ' ' + item.sub + ' ' + (item.k || ''));
    if (title.startsWith(q)) return 100;
    if (title.split(/[\s:/·-]+/).some((w) => w.startsWith(q))) return 80;
    if (title.includes(q)) return 60;
    if (hay.split(/[\s:/·,-]+/).some((w) => w.startsWith(q))) return 45;
    if (hay.includes(q)) return 40;
    const g = subseq(title, q);
    if (g >= 0) return Math.max(12, 32 - g);
    return subseq(hay, q) >= 0 && q.length >= 3 ? 6 : 0;
  }
  function highlight(text, q) {
    if (!q) return esc(text);
    const n = norm(text), i = n.indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  let pal = null, palState = null;
  function buildPalette() {
    pal = overlay('pal-overlay', G.t('Komut paleti', 'Command palette'));
    pal.innerHTML =
      '<div class="panel">' +
        '<div class="pal-head">' + G.icon('search') +
          '<input class="pal-input" type="text" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" autocomplete="off" spellcheck="false">' +
          '<kbd>Esc</kbd></div>' +
        '<ul class="pal-list" id="palList" role="listbox"></ul>' +
        '<div class="pal-foot"></div>' +
      '</div>';
    const input = pal.querySelector('.pal-input'), list = pal.querySelector('.pal-list');
    input.addEventListener('input', () => renderPalette());
    input.addEventListener('keydown', (e) => {
      const n = palState.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); select(n ? (palState.sel + 1) % n : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(n ? (palState.sel - 1 + n) % n : 0); }
      else if (e.key === 'Home') { e.preventDefault(); select(0); }
      else if (e.key === 'End') { e.preventDefault(); select(n - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(palState.items[palState.sel]); }
    });
    list.addEventListener('mousemove', (e) => { const li = e.target.closest('.pal-item'); if (li) select(+li.dataset.i, true); });
    list.addEventListener('click', (e) => { const li = e.target.closest('.pal-item'); if (li) runItem(palState.items[+li.dataset.i]); });
  }
  function select(i, noScroll) {
    if (!palState.items.length) return;
    palState.sel = i;
    pal.querySelectorAll('.pal-item').forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === i)));
    const cur = pal.querySelector('#pal-opt-' + i);
    pal.querySelector('.pal-input').setAttribute('aria-activedescendant', cur ? cur.id : '');
    if (cur && !noScroll) cur.scrollIntoView({ block: 'nearest' });
  }
  function runItem(it) {
    if (!it) return;
    closeLayer(pal);
    if (it.run) setTimeout(it.run, 40);
    else if (it.href) {
      const here = (location.pathname.split('/').pop() || 'index.html');
      if (it.href.split('#')[0] === here && !it.href.includes('#')) return;
      location.href = it.href;
    }
  }
  function renderPalette() {
    const q = norm(pal.querySelector('.pal-input').value.trim());
    const here = G.page();
    const pages = PAGES.map((p) => ({ group: 'p', icon: p.icon, title: G.tx({ tr: p.t[0], en: p.t[1] }), sub: G.tx({ tr: p.s[0], en: p.s[1] }), k: p.k + ' ' + p.id, href: p.href, hint: p.id === here ? G.t('buradasın', 'you are here') : '' }));
    const acts = actions().map((a) => ({ group: 'a', icon: a.icon, title: G.tx({ tr: a.t[0], en: a.t[1] }), sub: G.tx({ tr: a.s[0], en: a.s[1] }), k: a.k, run: a.run, hint: a.hint || '' }));
    const posts = (postsCache || []).map((p) => ({ group: 'y', icon: 'book', title: p.title, sub: (G.blog ? G.blog.fmtDate(p.date) : p.date) + (p.tags && p.tags.length ? ' · #' + p.tags.join(' #') : ''), k: (p.summary || '') + ' ' + (p.tags || []).join(' '), href: G.postUrl(p.slug) }));
    let all = [];
    if (!q) all = pages.concat(acts.slice(0, 6), posts.slice(0, 3));
    else all = pages.concat(acts, posts).map((it) => Object.assign(it, { sc: score(it, q) })).filter((it) => it.sc > 0).sort((a, b) => b.sc - a.sc);
    const order = { p: 0, a: 1, y: 2 };
    if (!q) all.sort((a, b) => order[a.group] - order[b.group]);
    palState = { items: all, sel: 0 };
    const names = { p: G.t('Sayfalar', 'Pages'), a: G.t('Eylemler', 'Actions'), y: G.t('Seyir Defteri', 'Logbook') };
    let html = '', lastGroup = null;
    all.forEach((it, i) => {
      if (!q && it.group !== lastGroup) { html += '<li class="pal-group" role="presentation">' + names[it.group] + '</li>'; lastGroup = it.group; }
      html += '<li class="pal-item" role="option" id="pal-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === 0) + '">' +
        '<span class="pi-ico">' + G.icon(it.icon) + '</span>' +
        '<span class="pi-main"><span class="pi-title">' + highlight(it.title, q) + '</span><span class="pi-sub">' + esc(it.sub) + '</span></span>' +
        (it.hint ? '<span class="pi-hint">' + esc(it.hint) + '</span>' : '') + '</li>';
    });
    const list = pal.querySelector('.pal-list');
    list.innerHTML = html || '<li class="pal-empty" role="presentation">' + G.t('Sonuç yok. Başka bir şey dene: “redis”, “cv”, “gece”…', 'No results. Try “redis”, “cv”, “night”…') + '</li>';
    select(0, true);
    list.scrollTop = 0;
  }
  G.openPalette = function (q) {
    if (!pal) buildPalette();
    if (G.topLayer() === pal) return;
    pal.setAttribute('aria-label', G.t('Komut paleti', 'Command palette'));
    const input = pal.querySelector('.pal-input');
    input.placeholder = G.t('Sayfa, yazı ya da eylem ara…', 'Search pages, posts or actions…');
    input.value = q || '';
    pal.querySelector('.pal-foot').innerHTML =
      '<span><kbd>↑</kbd><kbd>↓</kbd> ' + G.t('gez', 'move') + '</span><span><kbd>↵</kbd> ' + G.t('aç', 'open') + '</span><span><kbd>Esc</kbd> ' + G.t('kapat', 'close') + '</span><span><kbd>' + (isMac ? '⌘' : 'Ctrl') + '</kbd><kbd>K</kbd> ' + G.t('palet', 'palette') + '</span>';
    renderPalette();
    openLayer(pal, input);
    G.metrics.inc('garage_palette_opens_total');
    G.sfx('click');
    loadPosts().then(() => { if (G.topLayer() === pal) renderPalette(); });
  };

  // =================================================================== KISAYOLLAR
  let keysEl = null;
  function openKeys() {
    if (keysEl) keysEl.remove();
    keysEl = overlay('keys-overlay', G.t('Klavye kısayolları', 'Keyboard shortcuts'));
    const mod = isMac ? '⌘' : 'Ctrl';
    const rows = [
      [[mod, 'K'], G.t('Komut paleti: sayfa, yazı, eylem ara', 'Command palette: search pages, posts, actions')],
      [['/'], G.t('Komut paleti (kısa yol)', 'Command palette (shortcut)')],
      [['"'], G.t('Terminali aç (Türkçe klavye)', 'Open the terminal (Turkish keyboard)')],
      [['`'], G.t('Terminali aç (İngilizce klavye)', 'Open the terminal (US keyboard)')],
      [['M'], G.t('Garaj planı: neredesin, nereye gidebilirsin', 'Garage plan: where you are, where to go')],
      [['X'], G.t('Röntgen: bu sayfayı hangi dosyalar yapıyor', 'X-ray: which files build this page')],
      [['1', '–', '4'], G.t('Garajda: o numaralı kapıyı aç', 'In the garage: open that door')],
      [['L'], G.t('Garajda: ışıkları aç / kapat', 'In the garage: toggle the lights')],
      [['R'], G.t('Şema’da: istek gönder', 'On the Blueprint: send a request')],
      [['B'], G.t('Şema’da: ×20 yük testi', 'On the Blueprint: ×20 load test')],
      [['Esc'], G.t('Açık pencereyi ya da kapıyı kapat', 'Close the open window or door')],
      [['?'], G.t('Bu liste', 'This list')]
    ];
    keysEl.innerHTML = '<div class="panel"><div class="panel-title"><h2>' + G.t('Kısayollar', 'Shortcuts') + '</h2><button class="term-x" type="button" aria-label="' + G.t('Kapat', 'Close') + '">' + G.icon('x') + '</button></div><ul class="keys-list">' +
      rows.map(([ks, d]) => '<li><span>' + d + '</span><span class="k">' + ks.map((k) => (k === '–' ? '<span class="muted">–</span>' : '<kbd>' + esc(k) + '</kbd>')).join('') + '</span></li>').join('') + '</ul></div>';
    keysEl.querySelector('.term-x').addEventListener('click', () => closeLayer(keysEl));
    openLayer(keysEl);
  }
  G.openKeys = openKeys;

  // =================================================================== İHTİYAÇ ANINDA YÜKLENEN BETİKLER
  const loading = {};
  G.loadScript = (file) => loading[file] || (loading[file] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = BASE + file + VQ; s.onload = res;
    s.onerror = () => { delete loading[file]; rej(new Error(file)); };
    document.head.appendChild(s);
  }));

  // =================================================================== KAT PLANI (plan.js ihtiyaç anında)
  G.makeOverlay = overlay;
  G.xray = function () {
    if (window.GarageXray) { window.GarageXray.toggle(); return; }
    G.loadScript('xray.js').then(() => window.GarageXray && window.GarageXray.open()).catch(() => G.toast(G.t('Röntgen yüklenemedi', 'Could not load X-ray'), 'x'));
  };
  G.openPlan = function () {
    if (window.GaragePlan) { window.GaragePlan.open(); return; }
    G.loadScript('plan.js').then(() => window.GaragePlan && window.GaragePlan.open()).catch(() => { location.href = 'garaj.html'; });
  };
  // Üst bardaki küçük "buradasın" planı: üstte dört bölme, altta dört atölye odası
  const MP = { top: ['hakkimda', 'takim-cantasi', 'seyir-defteri', 'iletisim'], bottom: ['sema', 'kontrol-odasi', 'veri-odasi', 'api'] };
  function miniPlan() {
    const here = G.page() === 'yazi' ? 'seyir-defteri' : G.page(), seen = G.visited();
    const cell = (id, x, y) => '<rect x="' + x + '" y="' + y + '" width="3.6" height="4" rx=".6" class="' + (id === here ? 'here' : seen.has(id) ? 'seen' : '') + '"/>';
    let r = '<svg class="mp" viewBox="0 0 24 18" aria-hidden="true"><path class="wall" d="M1 1h22v16H1zM1 7.6v2.8"/>';
    MP.top.forEach((id, k) => { r += cell(id, 3 + k * 5, 2.6); });
    MP.bottom.forEach((id, k) => { r += cell(id, 3 + k * 5, 11.4); });
    if (here === 'garaj') r += '<rect x="3" y="7.6" width="18.6" height="2.8" rx=".6" class="here"/>';
    return r + '</svg>';
  }
  function renderMini() { document.querySelectorAll('.plan-btn .mini-plan').forEach((el) => { el.innerHTML = miniPlan(); }); }
  // Rota çubuğundaki noktalar ve garajdaki rota kartları: gezilen duraklar işaretlenir
  function renderRoutes() {
    const seen = G.visited();
    document.querySelectorAll('.rn-dots li[data-p]').forEach((li) => li.classList.toggle('visited', seen.has(li.dataset.p) && !li.classList.contains('cur')));
    document.querySelectorAll('[data-route-card]').forEach((card) => {
      const r = G.ROUTES[card.dataset.routeCard]; if (!r) return;
      const n = r.stops.filter((p) => seen.has(p)).length, prog = card.querySelector('.rt-prog');
      if (prog && n) prog.textContent = n + '/' + r.stops.length + G.t(' gezildi', ' visited');
      const first = r.stops.find((p) => !seen.has(p));
      if (first && n) card.setAttribute('href', first + '.html');
    });
  }
  // Anlatım düğmeleri
  function renderExplain() { document.querySelectorAll('[data-explain-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.explainSet === G.explain()))); }
  document.addEventListener('garage:explain', renderExplain);
  document.addEventListener('garage:visited', () => { renderMini(); renderRoutes(); });
  document.addEventListener('garage:lang', renderRoutes);

  // =================================================================== TERMİNAL
  G.openTerminal = function (cmd) {
    if (window.GarageTerminal) { window.GarageTerminal.open(cmd); return; }
    G.loadScript('terminal.js').then(() => window.GarageTerminal && window.GarageTerminal.open(cmd)).catch(() => G.toast(G.t('Terminal yüklenemedi', 'Could not load the terminal'), 'x'));
  };

  // =================================================================== KİŞİ KARTI (vCard) — config.js'ten üretilir, hep güncel
  G.vcard = function () {
    const v = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const names = String(G.name || '').trim().split(/\s+/), last = names.pop() || '', first = names.join(' ');
    const p = G.profile || {};
    const stack = (G.toolbox || []).flatMap((d) => d.tools.map((t) => t.name)).join(', ');
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + v(last) + ';' + v(first) + ';;;', 'FN:' + v(G.name),
      'TITLE:' + v(G.tx(p.role)), 'ORG:' + v(p.company) + (p.team ? ';' + v(G.tx(p.team)) : ''),
      'EMAIL;TYPE=INTERNET:' + G.email, 'URL:' + G.site, 'X-SOCIALPROFILE;TYPE=linkedin:' + G.linkedin, 'X-SOCIALPROFILE;TYPE=github:' + G.github,
      'ADR;TYPE=WORK:;;;' + v(G.city) + ';;;' + v('Türkiye'), 'NOTE:' + v(G.t('Backend: ', 'Backend: ') + stack), 'END:VCARD'];
    const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/vcard;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = (G.name || 'kisi').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '-') + '.vcf';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    G.toast(G.t('Kişi kartı indirildi — açınca rehbere eklenir', 'Contact card downloaded — open it to add to contacts'), 'card');
    G.log('info', 'vcard downloaded', {});
  };

  // =================================================================== PAYLAŞ: QR kod + bağlantı + kişi kartı
  let shareEl = null;
  G.openShare = function () {
    G.loadScript('qr.js').then(() => {
      if (shareEl) shareEl.remove();
      shareEl = overlay('share-overlay', G.t('Siteyi paylaş', 'Share the site'));
      const url = G.site || location.origin, host = url.replace(/^https?:\/\//, '');
      let qr = '';
      try { qr = window.GarageQR.svg(url, { ecc: 'Q', border: 3, label: G.t('QR kod: ', 'QR code: ') + host }); } catch (e) { qr = ''; }
      shareEl.innerHTML = '<div class="panel share-panel"><div class="panel-title"><h2>' + G.t('Siteyi paylaş', 'Share the site') + '</h2><button class="term-x" type="button" aria-label="' + G.t('Kapat', 'Close') + '">' + G.icon('x') + '</button></div>' +
        '<div class="share-body"><div class="qr-card">' + qr + '</div><div class="share-side">' +
          '<p>' + G.t('Telefonun kamerasıyla okut; site doğrudan açılır.', 'Point a phone camera at it; the site opens directly.') + '</p>' +
          '<code class="share-url">' + esc(host) + '</code>' +
          '<div class="share-actions">' +
            (navigator.share ? '<button class="btn btn-primary" type="button" data-act="native">' + G.icon('share') + '<span>' + G.t('Paylaş…', 'Share…') + '</span></button>' : '') +
            '<button class="btn" type="button" data-act="copy">' + G.icon('link') + '<span>' + G.t('Bağlantıyı kopyala', 'Copy link') + '</span></button>' +
            '<button class="btn" type="button" data-act="vcard">' + G.icon('card') + '<span>' + G.t('Rehbere ekle (vCard)', 'Add to contacts (vCard)') + '</span></button>' +
          '</div></div></div></div>';
      shareEl.querySelector('.term-x').addEventListener('click', () => closeLayer(shareEl));
      shareEl.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        if (b.dataset.act === 'copy') G.copy(url, G.t('Bağlantı', 'Link'));
        else if (b.dataset.act === 'vcard') G.vcard();
        else if (b.dataset.act === 'native') navigator.share({ title: G.name + ' — Garage', text: G.t('Emre Çuhadar’ın garajına uğra:', 'Drop by Emre Çuhadar’s garage:'), url }).catch(() => {});
      });
      openLayer(shareEl, shareEl.querySelector('.share-actions button'));
      G.log('info', 'share opened', {});
    }).catch(() => G.copy(G.site || location.origin, G.t('Bağlantı', 'Link')));
  };

  // =================================================================== KLAVYE
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); pal && G.topLayer() === pal ? closeLayer(pal) : G.openPalette(); return; }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || G.topLayer()) return;
    if (e.key === '/') { e.preventDefault(); G.openPalette(); }
    else if (e.key === '?') { e.preventDefault(); openKeys(); }
    else if ((e.key === 'm' || e.key === 'M') && !e.shiftKey) { e.preventDefault(); G.openPlan(); }
    else if ((e.key === 'x' || e.key === 'X') && !e.shiftKey && (!G.topLayer || !G.topLayer())) { e.preventDefault(); G.xray(); }
    else if (e.key === '"' || e.key === '`') { e.preventDefault(); G.openTerminal(); }
  });
  document.addEventListener('click', (e) => {
    const p = e.target.closest && e.target.closest('[data-palette]');
    if (p) { e.preventDefault(); G.openPalette(); return; }
    const t = e.target.closest && e.target.closest('[data-terminal]');
    if (t) { e.preventDefault(); G.openTerminal(t.dataset.terminal || ''); return; }
    if (e.target.closest && e.target.closest('[data-keys]')) { e.preventDefault(); openKeys(); return; }
    if (e.target.closest && e.target.closest('[data-share]')) { e.preventDefault(); G.openShare(); return; }
    if (e.target.closest && e.target.closest('[data-vcard]')) { e.preventDefault(); G.vcard(); return; }
    if (e.target.closest && e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
    if (e.target.closest && e.target.closest('[data-plan]')) { e.preventDefault(); G.openPlan(); return; }
    const ex = e.target.closest && e.target.closest('[data-explain-set]');
    if (ex) { G.setExplain(ex.dataset.explainSet); G.sfx('click'); return; }
  });
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.nav-drop[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('details.nav-drop[open]').forEach((d) => { d.open = false; const s = d.querySelector('summary'); if (d.contains(document.activeElement) && s) s.focus(); });
  });

  // =================================================================== SAYFA HAZIR
  function fillIcons(root) { (root || document).querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = G.icon(el.dataset.icon); }); }
  G.fillIcons = fillIcons;
  function ready() {
    fillIcons();
    renderMini(); renderRoutes(); renderExplain();
    document.querySelectorAll('.pal-btn kbd').forEach((k) => { k.textContent = (isMac ? '⌘' : 'Ctrl') + ' K'; });
    // Alt bilgideki build bilgisi (CI üretir)
    const bi = document.querySelector('[data-build]');
    if (bi) G.build().then((b) => {
      if (!b || !b.sha) return;
      const repo = (G.giscus && G.giscus.repo) || 'EmreC54/EmreC54.github.io';
      bi.innerHTML = G.icon('commit') + ' build #' + esc(b.run || '?') + ' · <a href="https://github.com/' + repo + '/commit/' + esc(b.sha) + '" target="_blank" rel="noopener">' + esc(String(b.sha).slice(0, 7)) + '</a> · ' + esc(G.ago(b.time));
      bi.hidden = false;
    });
    if (location.hash === '#terminal') { history.replaceState(null, '', location.pathname + location.search); G.openTerminal(); }
    // [data-qr] öğelerine QR kod çiz (ör. CV'nin köşesi): değer yoksa sitenin adresi
    const qrs = document.querySelectorAll('[data-qr]');
    if (qrs.length) G.loadScript('qr.js').then(() => qrs.forEach((el) => {
      const url = el.dataset.qr || G.site || location.origin;
      try { el.innerHTML = window.GarageQR.svg(url, { ecc: 'Q', border: 0, label: G.t('QR kod: ', 'QR code: ') + url.replace(/^https?:\/\//, '') }); } catch (e) { /* çizilemezse boş kalır */ }
    })).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
