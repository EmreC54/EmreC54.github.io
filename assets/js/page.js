// Garage — bölme sayfaları (page.js): Hakkımda, Takım Çantası, Seyir Defteri (liste + yazı),
// İletişim, Şema ve Kontrol Odası için ortak davranışlar.
(function () {
  'use strict';
  const G = window.GARAGE;
  const $ = (id) => document.getElementById(id);
  const esc = G.esc;
  const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
  const mark = (text, q) => {   // aramada eşleşen kısmı vurgula (Türkçe harfler katlanarak)
    if (!q) return esc(text);
    const i = norm(text).indexOf(q);
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };

  // Kepenk sesi (ses açıksa ve tarayıcı izin verirse)
  if (document.querySelector('.door-curtain') && !G.reduce) setTimeout(() => G.sfx('door', document.documentElement.classList.contains('curtain-quick') ? 0.6 : 1.15), 150);

  // =================================================================== DERİNLİK: toz + arka plan paralaksı
  const bg = document.querySelector('.bg-scene'), canvas = $('dust');
  const dust = canvas && window.GarageFX ? window.GarageFX.dust(canvas, { count: window.innerWidth < 700 ? 25 : 55 }) : null;
  let q = false, mx = 0, my = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = 0.5 - e.clientX / window.innerWidth; my = 0.5 - e.clientY / window.innerHeight;
    if (q) return; q = true;
    requestAnimationFrame(() => {
      q = false;
      if (dust) dust.setOffset(mx, my);
      if (bg && !G.reduce && !G.lite()) bg.style.transform = 'translate3d(' + (mx * 22).toFixed(1) + 'px,' + (my * 14).toFixed(1) + 'px,0)';
    });
  }, { passive: true });

  // =================================================================== SAAT + ATÖLYE (Kocaeli)
  function tick() {
    const t = $('local-time'); if (t) t.textContent = G.localTime();
    const w = $('ws-text'); if (w) { const s = G.workshopStatus(); w.textContent = s.text + ' · ' + s.detail; }
  }
  tick(); setInterval(tick, 20000);

  // 404 ve çevrimdışı sayfaları: istenen adres
  const lp = $('lockedPath');
  if (lp) {
    const off = G.page() === 'offline';
    lp.innerHTML = 'GET ' + esc(decodeURIComponent(location.pathname)) + ' → <span class="c">' + (off ? 'net::ERR_INTERNET_DISCONNECTED' : '404 Not Found') + '</span>';
    if (!off) G.log('warn', 'GET ' + location.pathname + ' 404', { referrer: document.referrer ? new URL(document.referrer).pathname : '' });
  }

  // =================================================================== TAKIM ÇANTASI
  // Her alet için "terminalde dene" kısayolu: alanımla ilgili gerçek bir komut ya da sayfa
  const TRY = {
    'C#': { cmd: 'curl /api/emre', t: ['bir C# servisinin JSON yanıtı', 'JSON from a C# service'] },
    '.NET': { cmd: 'curl -i /health', t: ['ASP.NET Core sağlık kontrolü', 'an ASP.NET Core health check'] },
    'ASP.NET': { cmd: 'curl -i /api/olmayan', t: ['404 ProblemDetails yanıtı', 'a 404 ProblemDetails response'] },
    MSSQL: { cmd: 'sql SELECT name, category FROM skills ORDER BY name', t: ['salt okunur bir SQL sorgusu', 'a read-only SQL query'] },
    MongoDB: { href: 'sema.html', t: ['Şema’daki feed rotası', 'the feed route on the Blueprint'] },
    Redis: { cmd: 'redis-cli KEYS *', t: ['paylaşılan önbellek', 'the shared cache'] },
    Graylog: { cmd: 'logs', t: ['bu oturumun logları', 'this session’s logs'] },
    Grafana: { href: 'kontrol-odasi.html', t: ['Kontrol Odası panosu', 'the Control Room dashboard'] },
    Prometheus: { cmd: 'curl /metrics', t: ['/metrics çıktısı', 'the /metrics output'] }
  };
  const toolbox = $('toolbox'), info = $('toolInfo');
  let pickedTool = null;
  function showTool(tool) {
    const tr = TRY[tool.name];
    info.innerHTML = '<b>' + esc(tool.name) + '</b> — ' + esc(G.tx(tool.note)) +
      (tr ? '<span class="try">' + (tr.cmd
        ? '<button type="button" class="try-btn" data-terminal="' + esc(tr.cmd) + '">' + G.icon('terminal') + '<code>' + esc(tr.cmd) + '</code></button>'
        : '<a class="try-btn" href="' + tr.href + '">' + G.icon('arrow') + '<span>' + esc(G.tx({ tr: tr.t[0], en: tr.t[1] })) + '</span></a>') +
        '<small>' + (tr.cmd ? G.t('terminalde dene: ', 'try it in the terminal: ') + esc(G.tx({ tr: tr.t[0], en: tr.t[1] })) : G.t('canlı örnek', 'live example')) + '</small></span>' : '');
  }
  function renderToolbox() {
    if (!toolbox) return;
    const openSet = new Set(Array.from(toolbox.querySelectorAll('.drawer.open')).map((d) => d.dataset.i));
    toolbox.innerHTML = G.toolboxHtml(openSet, pickedTool);
    const p = pickedTool && G.toolbox.flatMap((d) => d.tools).find((t) => t.name === pickedTool);
    if (p) showTool(p); else info.textContent = G.t('// bir alet seç', '// pick a tool');
  }
  if (toolbox) {
    toolbox.addEventListener('click', (e) => {
      const tag = e.target.closest('.tool-tag');
      if (tag) {
        const tool = G.toolbox[+tag.dataset.d].tools[+tag.dataset.t];
        pickedTool = tool.name;
        toolbox.querySelectorAll('.tool-tag').forEach((x) => x.setAttribute('aria-pressed', String(x === tag)));
        showTool(tool); G.sfx('key');
        return;
      }
      const front = e.target.closest('.drawer-front');
      if (front) {
        const open = front.parentElement.classList.toggle('open');
        front.setAttribute('aria-expanded', String(open));
        G.sfx('click');
      }
    });
    if (!toolbox.children.length) renderToolbox();
  }

  // =================================================================== SEYİR DEFTERİ: LİSTE
  const listEl = $('postList'), filterEl = $('tagFilter'), searchEl = $('postSearch'), countEl = $('postCount');
  let activeTag = new URLSearchParams(location.search).get('tag'), query = '', enriched = null;
  const loadEnriched = () => enriched || (enriched = G.blog.list().then((posts) => Promise.all(posts.map((p) =>
    G.blog.source(p.slug).then((md) => Object.assign({ min: G.blog.minutes(md), body: md }, p)).catch(() => p)))));
  function renderList() {
    if (!listEl || !G.blog) return;
    loadEnriched().then((posts) => {
      listEl.classList.remove('is-loading');
      const tags = Array.from(new Set(posts.flatMap((p) => p.tags || []))).sort((a, b) => a.localeCompare(b, 'tr'));
      if (activeTag && !tags.includes(activeTag)) activeTag = null;
      filterEl.innerHTML = tags.length ? '<button type="button" class="tag" data-tag="" aria-pressed="' + !activeTag + '">' + G.t('tümü', 'all') + '</button>' +
        tags.map((t) => '<button type="button" class="tag" data-tag="' + esc(t) + '" aria-pressed="' + (activeTag === t) + '">#' + esc(t) + '</button>').join('') : '';
      const nq = norm(query.trim());
      const shown = posts.filter((p) => (!activeTag || (p.tags || []).includes(activeTag)) &&
        (!nq || norm([p.title, p.summary, (p.tags || []).join(' '), p.body].join(' ')).includes(nq)));
      if (countEl) countEl.textContent = posts.length ? shown.length + ' / ' + posts.length + G.t(' kayıt', ' entries') : '';
      if (!posts.length) { listEl.innerHTML = '<div class="empty-log mono">' + G.t('henüz kayıt yok — ilk not yolda', 'no entries yet — the first note is on its way') + '<span class="caret"></span></div>'; return; }
      if (!shown.length) {
        listEl.innerHTML = '<div class="empty-log mono">grep: ' + esc(query || '#' + activeTag) + G.t(' — eşleşen kayıt yok. ', ' — no matching entries. ') + '<button type="button" class="linkish" id="clearFilters">' + G.t('filtreleri temizle', 'clear filters') + '</button></div>';
        return;
      }
      const latestSlug = posts[0].slug;
      listEl.innerHTML = shown.map((p) =>
        '<a class="post-card' + (p.slug === latestSlug && !nq && !activeTag ? ' latest' : '') + '" href="' + G.postUrl(p.slug) + '">' +
          '<span class="pc-meta mono"><span>' + G.blog.fmtDate(p.date) + '</span>' + (p.min ? '<span>· ' + p.min + ' ' + G.t('dk okuma', 'min read') + '</span>' : '') +
          (p.slug === latestSlug ? '<span class="pc-new">' + G.t('son kayıt', 'latest') + '</span>' : '') + '</span>' +
          '<span class="pc-title">' + mark(p.title, nq) + '</span>' +
          (p.summary ? '<span class="pc-sum">' + mark(p.summary, nq) + '</span>' : '') +
          '<span class="pc-tags mono">' + (p.tags || []).map((t) => '#' + esc(t)).join(' ') + '</span>' +
        '</a>').join('');
    }).catch(() => { listEl.classList.remove('is-loading'); listEl.innerHTML = '<div class="empty-log mono">' + G.t('defter okunamadı. Sayfayı yenilemeyi dene.', 'could not read the logbook. Try reloading.') + '</div>'; });
  }
  if (listEl) {
    filterEl.addEventListener('click', (e) => {
      const b = e.target.closest('.tag'); if (!b) return;
      activeTag = b.dataset.tag || null;
      history.replaceState(null, '', activeTag ? '?tag=' + encodeURIComponent(activeTag) : location.pathname);
      renderList();
    });
    let st = 0;
    if (searchEl) searchEl.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => { query = searchEl.value; renderList(); }, 120); });
    listEl.addEventListener('click', (e) => {
      if (!e.target.closest('#clearFilters')) return;
      query = ''; activeTag = null; if (searchEl) searchEl.value = '';
      history.replaceState(null, '', location.pathname); renderList();
    });
    renderList();
  }

  // =================================================================== TEK YAZI
  // İki biçimde açılır: yazi/<slug>.html (statik, scripts/build.mjs önceden çizer) ya da yazi.html#<slug> (eski bağlantılar, taslaklar).
  const postEl = $('post'), bar = document.querySelector('.read-progress');
  const STATIC_SLUG = document.body.dataset.slug || '';
  function setMeta(name, value) { const m = document.querySelector('meta[name="' + name + '"]'); if (m) m.setAttribute('content', value); }
  function postReady(slug) {
    mountGiscus('yazi-' + slug, $('postComments'));
    G.log('info', 'read post', { slug: slug, page: STATIC_SLUG ? 'static' : 'hash' });
    progress();
  }
  let redirectChecked = false;
  function renderPost() {
    if (!postEl || !G.blog) return;
    const slug = STATIC_SLUG || decodeURIComponent((location.hash || '').slice(1)).split('/')[0];
    if (!slug) { location.replace('seyir-defteri.html'); return; }
    // Statik sayfa zaten bu dilde çizilmişse yeniden çizme: sadece yorumları ve ilerlemeyi bağla
    if (STATIC_SLUG && postEl.dataset.lang === G.lang()) { postReady(slug); return; }
    G.blog.list().then((posts) => {
      const idx = posts.findIndex((p) => p.slug === slug);
      if (idx < 0) throw new Error('404');
      const p = posts[idx];
      // Eski yazi.html#slug bağlantısı: yazının statik sayfası varsa oraya geç (yoksa burada çiz — döngü olmaz)
      if (!STATIC_SLUG && !redirectChecked) {
        redirectChecked = true;
        return fetch(G.postUrl(p.slug), { method: 'HEAD', cache: 'no-cache' }).then((r) => { if (r.ok) location.replace(G.postUrl(p.slug)); else renderPost(); }, () => renderPost());
      }
      return G.blog.source(p.slug).then((md) => {
        const r = G.blog.render(md);
        document.title = p.title + ' — ' + G.t('Seyir Defteri', 'Logbook') + ' · Emre Çuhadar';
        if (p.summary) setMeta('description', p.summary);
        const url = (G.site || location.origin) + '/' + G.postUrl(p.slug);
        const toc = r.toc.length >= 3 ? '<nav class="toc mono" aria-label="' + G.t('İçindekiler', 'Contents') + '"><span>' + G.t('içindekiler', 'contents') + '</span>' + r.toc.map((t) => '<a href="#' + t.id + '">' + t.text + '</a>').join('') + '</nav>' : '';
        postEl.innerHTML =
          '<header class="post-head">' +
            '<p class="kicker">$ cat ' + esc(p.slug) + '.md</p>' +
            '<h1>' + esc(p.title) + '</h1>' +
            '<p class="post-meta mono"><span>' + G.blog.fmtDate(p.date) + '</span><span>· ' + G.blog.minutes(md) + ' ' + G.t('dk okuma', 'min read') + '</span>' +
            (p.tags || []).map((t) => '<a class="t" href="seyir-defteri.html?tag=' + encodeURIComponent(t) + '">#' + esc(t) + '</a>').join('') + '</p>' +
            (G.lang() === 'en' ? '<p class="post-lang mono">This entry is written in Turkish.</p>' : '') +
            '<div class="share">' +
              '<button type="button" class="btn btn-sm" data-copy="url">' + G.icon('link') + G.t('Bağlantıyı kopyala', 'Copy link') + '</button>' +
              '<a class="btn btn-sm" href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url) + '" target="_blank" rel="noopener">' + G.icon('linkedin') + G.t('LinkedIn’de paylaş', 'Share on LinkedIn') + '</a>' +
              '<button type="button" class="btn btn-sm" data-print>' + G.icon('printer') + G.t('Yazdır', 'Print') + '</button>' +
            '</div>' +
          '</header>' + toc + '<div class="prose">' + r.html + '</div>';
        postEl.dataset.lang = G.lang();
        const prev = posts[idx + 1], next = posts[idx - 1];
        $('postNav').innerHTML =
          (prev ? '<a href="' + G.postUrl(prev.slug) + '"><small class="mono">← ' + G.t('önceki', 'previous') + '</small><b>' + esc(prev.title) + '</b></a>' : '<span></span>') +
          (next ? '<a href="' + G.postUrl(next.slug) + '"><small class="mono">' + G.t('sonraki', 'next') + ' →</small><b>' + esc(next.title) + '</b></a>' : '<span></span>');
        postReady(p.slug);
      });
    }).catch(() => {
      document.title = '404 — ' + G.t('Seyir Defteri', 'Logbook');
      postEl.innerHTML = '<div class="empty-log mono">GET /yazi/' + esc(slug || '') + ' → <span class="c">404</span><br>' + G.t('Bu kayıt defterde yok.', 'This entry is not in the logbook.') + ' <a href="seyir-defteri.html">' + G.t('Tüm kayıtlar →', 'All entries →') + '</a></div>';
      $('postNav').innerHTML = '';
    });
  }
  // Okuma ilerlemesi: yazının neresindesin (sadece transform)
  let pq = false;
  function progress() {
    if (!bar || !postEl) return;
    const r = postEl.getBoundingClientRect(), total = r.height - window.innerHeight * 0.6;
    const k = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1;
    bar.style.transform = 'scaleX(' + k.toFixed(4) + ')';
  }
  if (postEl) {
    renderPost();
    if (!STATIC_SLUG) window.addEventListener('hashchange', () => { redirectChecked = true; renderPost(); window.scrollTo(0, 0); });
    window.addEventListener('scroll', () => { if (!pq) { pq = true; requestAnimationFrame(() => { pq = false; progress(); }); } }, { passive: true });
    window.addEventListener('resize', progress);
    // Başlık bağlantıları adresi değiştirmeden kaydırır (adres #yazi-adi olarak kalır)
    postEl.addEventListener('click', (e) => {
      const a = e.target.closest('.toc a, .anchor');
      if (!a) return;
      e.preventDefault();
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) el.scrollIntoView({ behavior: G.reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // =================================================================== ZİYARETÇİ DEFTERİ (giscus)
  let giscusFrame = null;
  function mountGiscus(term, section) {
    const box = section ? section.querySelector('#guestbook') : $('guestbook');
    if (!box) return;
    const c = G.giscus || {};
    if (!c.repoId || !c.categoryId) {
      if (section) return;     // yazı sayfasında kurulum yoksa yorum alanı hiç görünmez
      box.innerHTML = '<div class="gb-soon"><span class="gb-stamp mono">' + G.t('YAKINDA', 'SOON') + '</span>' +
        '<p>' + G.t('Defterin sayfaları hazırlanıyor. Çok yakında buraya not bırakabileceksin.', 'The guestbook is being set up. You’ll be able to leave a note here very soon.') + '</p>' +
        '<p class="mono muted">' + G.t('O zamana kadar: ', 'Until then: ') + '<a href="mailto:' + G.email + '">' + G.email + '</a></p></div>';
      return;
    }
    if (section) section.hidden = false;
    box.innerHTML = '';
    const s = document.createElement('script');
    s.src = 'https://giscus.app/client.js';
    s.async = true; s.crossOrigin = 'anonymous';
    const theme = location.protocol === 'https:' ? location.origin + '/assets/css/giscus-theme.css' : 'dark_dimmed';
    Object.entries({
      'data-repo': c.repo, 'data-repo-id': c.repoId, 'data-category': c.category, 'data-category-id': c.categoryId,
      'data-mapping': 'specific', 'data-term': term || 'ziyaretci-defteri', 'data-strict': '1',
      'data-reactions-enabled': '1', 'data-emit-metadata': '0', 'data-input-position': 'top',
      'data-theme': theme, 'data-lang': G.lang(), 'data-loading': 'lazy'
    }).forEach(([k, v]) => s.setAttribute(k, v));
    box.appendChild(s);
    giscusFrame = () => box.querySelector('iframe.giscus-frame');
  }
  if ($('guestbook') && !postEl) mountGiscus('ziyaretci-defteri');

  // =================================================================== DİL DEĞİŞİNCE
  document.addEventListener('garage:lang', () => {
    tick(); renderToolbox(); renderList(); if (postEl) renderPost();
    const f = giscusFrame && giscusFrame();
    if (f) f.contentWindow.postMessage({ giscus: { setConfig: { lang: G.lang() } } }, 'https://giscus.app');
    else if ($('guestbook') && !postEl) mountGiscus('ziyaretci-defteri');
  });
})();
