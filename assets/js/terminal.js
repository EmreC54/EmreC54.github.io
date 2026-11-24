// Garage — terminal (terminal.js). ui.js tarafından ilk açılışta yüklenir.
// Kabuk (gsh) + redis-cli, sqlcmd ve mongosh modları. Komutlar gerçek verilerle çalışır:
// telemetri (site.js), paylaşılan mini Redis (site.js), profil ve takım çantası (config.js),
// gerçek JSON uçları (/api/*.json) ve Veri Odası'yla aynı sorgu motoru (query.js).
// Borular: curl /api/stack.json | jq '.drawers[].name' · logs | grep -i warn | wc -l
(function () {
  'use strict';
  const G = window.GARAGE;
  const esc = G.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const tx = (o) => G.tx(o);
  const T = (tr, en) => G.t(tr, en);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].length)); };

  let root, out, input, label, chips, mode = 'sh', busy = false, abort = null, follow = null, greeted = false;
  let capture = null;   // boru (|): komutun çıktısı ekrana değil buraya toplanır, sonra filtrelerden geçer
  let mbuf = '';        // mongosh: parantezi kapanmamış çok satırlı girdi
  let hist = G.store.json('garage-term-history') || [];
  let hIdx = hist.length;

  // =================================================================== ÇIKTI
  function print(lines, cls) {
    if (capture) { (Array.isArray(lines) ? lines : [lines]).forEach((l) => capture.push(l)); return; }
    (Array.isArray(lines) ? lines : [lines]).forEach((l) => {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      div.innerHTML = l === '' ? '&nbsp;' : l;
      out.appendChild(div);
    });
    while (out.children.length > 600) out.firstChild.remove();
    out.scrollTop = out.scrollHeight;
  }
  const text = (s, cls) => print(esc(s), cls);
  const stderr = (html, cls) => { const c = capture; capture = null; print(html, cls); capture = c; };   // boruya girmez
  const promptText = () => (mode === 'redis' ? '127.0.0.1:6379>' : mode === 'sql' ? '1>' : mode === 'mongo' ? (mbuf ? '...' : 'garage>') : 'emre@garage:~$');
  function setMode(m) {
    mode = m;
    label.textContent = promptText();
    root.querySelector('.term-title').textContent = m === 'redis' ? 'redis-cli — 127.0.0.1:6379' : m === 'sql' ? 'sqlcmd — GarageSQL' : m === 'mongo' ? 'mongosh — mongodb://garage' : 'emre@garage: ~';
    renderChips();
  }
  const colorJson = (escaped) => escaped.replace(/(&quot;(?:\\.|(?!&quot;).)*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/g,
    (m, str, colon, kw, num) => (str ? (colon ? '<span class="c">' + str + '</span>' + colon : '<span class="g">' + str + '</span>') : kw ? '<span class="v">' + kw + '</span>' : '<span class="b">' + num + '</span>'));
  function json(obj) { return colorJson(esc(JSON.stringify(obj, null, 2))); }   // renkli JSON
  const clip = (v) => { const a = [...(v == null ? 'NULL' : String(v))]; return a.length > 60 ? a.slice(0, 59).join('') + '…' : a.join(''); };
  function table(cols, rows, opts) {   // düz metin tablo (sqlcmd biçimi)
    const w = cols.map((c, i) => Math.max([...String(c)].length, ...rows.map((r) => [...clip(r[i])].length)));
    const line = (r) => r.map((v, i) => pad(clip(v), w[i])).join(' ');
    const head = '<span class="c">' + esc(line(cols)) + '</span>';
    const dash = '<span class="m">' + w.map((n) => '-'.repeat(n)).join(' ') + '</span>';
    const n = opts && opts.total != null ? opts.total : rows.length;
    return [head, dash].concat(rows.map((r) => esc(line(r)))).concat(opts && opts.footer === false ? [] : ['', '<span class="m">(' + n + (n === 1 ? ' row' : ' rows') + ' affected)</span>']);
  }
  const tokenize = (s) => { const o = []; let cur = '', q = null, had = false; for (const ch of s) { if (q) { if (ch === q) q = null; else cur += ch; } else if (ch === '"' || ch === "'") { q = ch; had = true; } else if (/\s/.test(ch)) { if (cur || had) { o.push(cur); cur = ''; had = false; } } else cur += ch; } if (cur || had) o.push(cur); return o; };

  // =================================================================== VERİ
  const fmtYM = (s) => s || T('devam', 'present');
  function profileJson() {
    const p = G.profile || {};
    return {
      name: G.name, role: tx(p.role), team: tx(p.team), company: p.company, since: p.since, location: tx(p.location),
      experience: (G.experience || []).map((e) => ({ role: tx(e.role), company: e.company, team: tx(e.team), start: e.start, end: e.end || null })),
      education: (G.education || []).map((e) => ({ school: tx(e.school), field: tx(e.field) })),
      stack: (G.toolbox || []).flatMap((d) => d.tools.map((t) => t.name)),
      links: { github: G.github, linkedin: decodeURI(G.linkedin), email: G.email }
    };
  }
  let posts = null;
  const loadPosts = () => (posts ? Promise.resolve(posts) : fetch(ROOT() + 'posts/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => (posts = (j.posts || []).filter((p) => !p.draft).sort((a, b) => (a.date < b.date ? 1 : -1)))).catch(() => (posts = [])));

  // =================================================================== HEDEFLER (open / cd)
  const TARGETS = {
    garaj: 'garaj.html', garage: 'garaj.html', home: 'garaj.html',
    hakkimda: 'hakkimda.html', about: 'hakkimda.html',
    canta: 'takim-cantasi.html', 'takim-cantasi': 'takim-cantasi.html', toolbox: 'takim-cantasi.html',
    sema: 'sema.html', blueprint: 'sema.html',
    defter: 'seyir-defteri.html', 'seyir-defteri': 'seyir-defteri.html', blog: 'seyir-defteri.html', logbook: 'seyir-defteri.html',
    iletisim: 'iletisim.html', contact: 'iletisim.html',
    kontrol: 'kontrol-odasi.html', 'kontrol-odasi': 'kontrol-odasi.html', control: 'kontrol-odasi.html', metrics: 'kontrol-odasi.html',
    veri: 'veri-odasi.html', 'veri-odasi': 'veri-odasi.html', data: 'veri-odasi.html', db: 'veri-odasi.html',
    api: 'api.html', swagger: 'api.html', openapi: 'api.html',
    cv: 'cv.html', giris: 'index.html', intro: 'index.html'
  };
  const NAMES = () => ({ hakkimda: T('Hakkımda', 'About'), 'takim-cantasi': T('Takım Çantası', 'Toolbox'), 'seyir-defteri': T('Seyir Defteri', 'Logbook'), iletisim: T('İletişim', 'Contact'),
    sema: T('Şema', 'Blueprint'), 'kontrol-odasi': T('Kontrol Odası', 'Control Room'), 'veri-odasi': T('Veri Odası', 'Data Room'), api: 'API', garaj: T('Garaj', 'Garage'), cv: 'CV', giris: T('Giriş', 'Intro') });
  const normKey = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/\.html$|\/$/g, '');
  function go(target) {
    const k = normKey(target);
    if (/^[1-4]$/.test(k)) {
      if (G.openBay) { close(); G.openBay(+k); return true; }
      location.href = 'garaj.html#bay-0' + k; return true;
    }
    const href = TARGETS[k];
    if (!href) return false;
    text(T('→ ', '→ ') + href, 'm');
    setTimeout(() => { location.href = href; }, 220);
    return true;
  }

  // =================================================================== KABUK KOMUTLARI
  const CMDS = {
    help: { d: ['komutlar', 'commands'], run() {
      const g = (title, items) => '<span class="c">' + pad(title, 12) + '</span>' + items.map((i) => '<span class="hl">' + i + '</span>').join('  ');
      print([
        T('<span class="m">Gezinme, bilgi, sistem ve veri komutları. Tab ile tamamla, ↑↓ ile geçmiş.</span>', '<span class="m">Navigation, info, system and data commands. Tab completes, ↑↓ history.</span>'), '',
        g(T('gezinme', 'navigate'), ['open &lt;sayfa|1-4&gt;', 'map', 'route', 'plan', 'xray', 'ls', 'palette']),
        g(T('bilgi', 'info'), ['whoami', T('deneyim', 'experience'), T('egitim', 'education'), 'stack', T('iletisim', 'contact'), 'blog', 'cat &lt;dosya&gt;']),
        g(T('sistem', 'system'), ['curl &lt;yol&gt;', 'ping', 'top', 'logs [-f]', 'metrics', 'build', 'uptime', 'date']),
        g(T('veri', 'data'), ['redis-cli', 'sqlcmd', 'sql &lt;sorgu&gt;', 'mongosh']),
        g(T('boru', 'pipes'), ['| grep', '| jq', '| wc', '| head', '| tail', '| sort', '| uniq', '| cut']),
        g(T('garaj', 'garage'), ['lights', 'phase &lt;sabah|gunduz|aksam|gece|auto&gt;', 'sound', 'lang']),
        g(T('diğer', 'other'), ['man &lt;komut&gt;', 'neofetch', 'history', 'echo', 'clear', 'exit']), '',
        T('<span class="m">Örnekler:</span>', '<span class="m">Try:</span>'),
        '  curl /api/stack.json | jq \'.drawers[].name\'',
        '  logs | grep -ic info',
        '  sql SELECT category, COUNT(*) AS n FROM skills GROUP BY category',
        '  mongosh --eval "db.posts.find({}, { _id: 0, title: 1 })"',
        T('<span class="m">Bir komutun ayrıntısı için </span>man curl<span class="m">, </span>man jq<span class="m"> …</span>', '<span class="m">Details for a command: </span>man curl<span class="m">, </span>man jq<span class="m"> …</span>'),
      ]);
    } },
    whoami: { d: ['kim olduğum', 'who I am'], run() { const p = G.profile; print(['<span class="hl">' + esc(G.name) + '</span> — ' + esc(tx(p.role)), esc(tx(p.team)) + ' @ ' + esc(p.company) + ' · ' + esc(tx(p.location))]); } },
    deneyim: { d: ['iş geçmişi', 'work history'], run() { print(table([T('rol', 'role'), T('şirket', 'company'), T('ekip', 'team'), T('başlangıç', 'start'), T('bitiş', 'end')], G.experience.map((e) => [tx(e.role) + (e.note ? ' (' + tx(e.note) + ')' : ''), e.company, tx(e.team), e.start, fmtYM(e.end)]), { footer: false })); } },
    egitim: { d: ['eğitim', 'education'], run() { G.education.forEach((e) => print('<span class="hl">' + esc(tx(e.school)) + '</span> — ' + esc(tx(e.field)))); } },
    stack: { d: ['teknolojiler', 'technologies'], run() { G.toolbox.forEach((d) => print('<span class="c">' + pad(tx(d.drawer), 22) + '</span>' + d.tools.map((t) => esc(t.name)).join('  '))); } },
    iletisim: { d: ['bağlantılar', 'links'], run() { print([pad(T('e-posta', 'email'), 10) + '<a href="mailto:' + G.email + '">' + G.email + '</a>', pad('github', 10) + '<a href="' + G.github + '" target="_blank" rel="noopener">github.com/EmreC54</a>', pad('linkedin', 10) + '<a href="' + G.linkedin + '" target="_blank" rel="noopener">linkedin.com/in/emre-çuhadar</a>']); } },
    blog: { d: ['son yazılar', 'latest posts'], async run() { const ps = await loadPosts(); if (!ps.length) return text(T('henüz kayıt yok.', 'no entries yet.'), 'm'); print(ps.slice(0, 8).map((p) => '<span class="m">' + p.date + '</span>  <a href="' + G.postUrl(p.slug) + '">' + esc(p.title) + '</a>')); } },
    ls: { d: ['dosyalar', 'files'], async run() {
      const ps = await loadPosts();
      print([
        '<span class="m">drwxr-xr-x</span>  <span class="b">garaj/</span>',
        '<span class="m">-rw-r--r--</span>  hakkimda.md',
        '<span class="m">drwxr-xr-x</span>  <span class="b">takim-cantasi/</span>',
        '<span class="m">-rw-r--r--</span>  sema.svg',
        '<span class="m">drwxr-xr-x</span>  <span class="b">seyir-defteri/</span>  <span class="m">(' + ps.length + T(' kayıt', ' entries') + ')</span>',
        '<span class="m">-rw-r--r--</span>  iletisim.txt',
        '<span class="m">drwxr-xr-x</span>  <span class="b">kontrol-odasi/</span>',
        '<span class="m">drwxr-xr-x</span>  <span class="b">veri-odasi/</span>  <span class="m">(sqlcmd, mongosh)</span>',
        '<span class="m">drwxr-xr-x</span>  <span class="b">api/</span>  <span class="m">(curl /api/index.json)</span>',
        '<span class="m">-r--r--r--</span>  cv.pdf'
      ]);
    } },
    cat: { d: ['dosya oku', 'read a file'], async run(a) {
      const f = normKey(a[0]);
      if (!f) return text('cat: ' + T('dosya adı gerekli', 'missing file operand'), 'r');
      if (f === 'hakkimda.md' || f === 'about.md' || f === 'hakkimda') { const p = G.profile; return print(['<span class="c"># ' + esc(G.name) + '</span>', '', esc(T(tx(p.role) + ', ' + p.company + ' ' + tx(p.team) + ' biriminde. ' + tx(p.location) + '.', tx(p.role) + ' at ' + p.company + ', ' + tx(p.team) + '. ' + tx(p.location) + '.')), '', T('Daha fazlası: ', 'More: ') + '<a href="hakkimda.html">hakkimda.html</a>']); }
      if (f === 'iletisim.txt' || f === 'contact.txt') return CMDS.iletisim.run();
      if (f === 'cv.pdf') return print('cat: cv.pdf: ' + T('ikili dosya. Bunun yerine <span class="hl">open cv</span> dene.', 'binary file. Try <span class="hl">open cv</span> instead.'));
      if (/^\/?api\//.test(a[0]) || /\.(json|xml|txt|webmanifest)$/i.test(a[0])) return curl([a[0].startsWith('/') ? a[0] : '/' + a[0]]);
      const ps = await loadPosts();
      const slug = f.replace(/^(seyir-defteri|posts)\//, '').replace(/\.md$/, '');
      const p = ps.find((x) => x.slug === slug);
      if (!p) return text('cat: ' + a[0] + ': ' + T('böyle bir dosya yok', 'No such file or directory'), 'r');
      const md = await fetch(ROOT() + 'posts/' + p.slug + '.md').then((r) => r.text()).catch(() => '');
      const lines = md.split('\n');
      print(lines.slice(0, 30).map(esc).concat(lines.length > 30 ? ['<span class="m">… (' + (lines.length - 30) + T(' satır daha) ', ' more lines) ') + '<a href="' + G.postUrl(p.slug) + '">' + T('tamamını oku', 'read it all') + '</a></span>'] : []));
    } },
    open: { d: ['sayfa aç', 'open a page'], run(a) {
      if (!a[0]) return print(T('kullanım: open &lt;garaj|hakkimda|canta|defter|iletisim|sema|kontrol|veri|api|cv|giris|1-4&gt;', 'usage: open &lt;garage|about|toolbox|logbook|contact|blueprint|control|data|api|cv|intro|1-4&gt;'), 'm');
      if (!go(a[0])) text(T('open: bulunamadı: ', 'open: not found: ') + a[0], 'r');
    } },
    curl: { d: ['gerçek HTTP istekleri', 'real HTTP requests'], run: curl },
    mongosh: { d: ['MongoDB kabuğu', 'MongoDB shell'], async run(a, raw) {
      const m = raw.match(/(?:--eval|-e)\s+([\s\S]+)$/);
      try { await ensureQ(); } catch (e) { return text(T('mongosh: sorgu motoru yüklenemedi', 'mongosh: could not load the query engine'), 'r'); }
      if (m) { let code = m[1].trim(); if (/^(["']).*\1$/s.test(code)) code = code.slice(1, -1); return mongo(code); }
      print([
        '<span class="m">Current Mongosh Log ID:</span> ' + rid(24),
        '<span class="m">Connecting to:</span>          <span class="g">mongodb://garage/?directConnection=true&amp;appName=mongosh</span>',
        '<span class="m">Using MongoDB:</span>          7.0 <span class="m">(' + T('tarayıcıda, salt okunur', 'in the browser, read-only') + ')</span>',
        '<span class="m">Using Mongosh:</span>          2.3', '',
        T('<span class="m">Koleksiyonlar: </span>show collections<span class="m"> · yardım: </span>help<span class="m"> · çıkış: </span>exit<span class="m">. Veri Odası’yla aynı veri.</span>', '<span class="m">Collections: </span>show collections<span class="m"> · help: </span>help<span class="m"> · leave: </span>exit<span class="m">. Same data as the Data Room.</span>')
      ]);
      setMode('mongo');
    } },
    man: { d: ['komut kılavuzu', 'manual'], run(a) { manPage(a[0]); } },
    map: { d: ['kat planı (ASCII)', 'floor plan (ASCII)'], run() { asciiMap(); } },
    plan: { d: ['görsel kat planı', 'visual floor plan'], run() { close(); setTimeout(() => G.openPlan(), 80); } },
    xray: { d: ['röntgen: sayfayı yapan dosyalar', 'X-ray: the files behind the page'], run() { close(); setTimeout(() => G.xray(), 80); } },
    route: { d: ['rotalar', 'routes'], run(a) { route(a); } },
    ping: { d: ['gerçek gecikme ölçümü', 'real latency'], run: ping },
    top: { d: ['canlı sistem bilgisi', 'live system info'], run: top },
    logs: { d: ['oturum logları', 'session logs'], run: logs },
    metrics: { d: ['Prometheus metrikleri', 'Prometheus metrics'], run() { printMetrics(G.metrics.exposition()); } },
    build: { d: ['yayın bilgisi', 'deploy info'], async run() {
      const b = await G.build();
      if (!b || !b.sha) return print(T('<span class="m">build.json yok — site henüz CI ile yayınlanmamış (yerel ya da önizleme).</span>', '<span class="m">no build.json — not deployed by CI yet (local or preview).</span>'));
      print(json(b));
    } },
    uptime: { d: ['oturum süresi', 'session age'], run() {
      const s = Math.round((Date.now() - G.metrics.since()) / 1000), p = Math.round(performance.now() / 1000);
      const f = (x) => (x >= 3600 ? Math.floor(x / 3600) + 'h ' : '') + Math.floor((x % 3600) / 60) + 'm ' + (x % 60) + 's';
      text(G.localTime(true) + ' up ' + f(s) + T(' (oturum), bu sayfa ', ' (session), this page ') + f(p) + ', ' + G.metrics.sum('garage_page_views_total') + T(' sayfa görüntüleme', ' page views'));
    } },
    date: { d: ['yerel saat', 'local time'], run() { const w = G.workshopStatus(); text(G.city + ' ' + G.localTime(true) + ' · ' + G.phaseName(G.realPhase()) + ' · ' + w.text + ' (' + w.detail + ')'); } },
    lights: { d: ['ışık aç/kapat', 'toggle lights'], run() {
      const sw = document.getElementById('lightSwitch');
      if (!sw) return text(T('lights: şalter sadece garajda. open garaj', 'lights: the switch is in the garage. open garage'), 'm');
      sw.click(); text(document.body.classList.contains('lights-off') ? T('ışıklar kapandı. fareyle fener tut.', 'lights off. your cursor is a flashlight.') : T('ışıklar açıldı.', 'lights on.'));
    } },
    phase: { d: ['gün dilimi', 'time of day'], run(a) {
      const m = { sabah: 'morning', morning: 'morning', gunduz: 'day', 'gündüz': 'day', day: 'day', aksam: 'evening', 'akşam': 'evening', evening: 'evening', gece: 'night', night: 'night', auto: null, otomatik: null };
      const k = (a[0] || '').toLocaleLowerCase('tr');
      if (!(k in m)) return text(T('kullanım: phase sabah|gunduz|aksam|gece|auto  (şu an: ', 'usage: phase morning|day|evening|night|auto  (now: ') + G.phaseName(G.phase()) + ')', 'm');
      G.setPhase(m[k]); text(T('garaj zamanı: ', 'garage time: ') + G.phaseName(G.phase()) + (m[k] ? '' : T(' (Kocaeli saati)', ' (Kocaeli time)')));
    } },
    sound: { d: ['ses aç/kapat', 'toggle sound'], run(a) { const v = a[0] === 'on' ? true : a[0] === 'off' ? false : !G.soundOn(); G.setSound(v); text(v ? T('ses efektleri açık.', 'sound effects on.') : T('ses efektleri kapalı.', 'sound effects off.')); } },
    lang: { d: ['dil', 'language'], run(a) { const v = a[0] === 'tr' || a[0] === 'en' ? a[0] : (G.lang() === 'tr' ? 'en' : 'tr'); G.setLang(v); text(v === 'en' ? 'language: English' : 'dil: Türkçe'); renderChips(); } },
    'redis-cli': { d: ['Redis istemcisi', 'Redis client'], run(a) {
      if (a.length) return redis(a);
      print([T('<span class="m">Paylaşılan önbelleğe bağlandın. Şema sayfasındaki istekler buraya anahtar yazar. HELP, QUIT.</span>', '<span class="m">Connected to the shared cache. Requests on the Blueprint page write keys here. HELP, QUIT.</span>')]);
      setMode('redis');
    } },
    sqlcmd: { d: ['SQL istemcisi', 'SQL client'], async run(a) {
      const qi = a.indexOf('-Q');
      if (qi >= 0 && a[qi + 1]) return sql(a.slice(qi + 1).join(' '));
      try { await ensureQ(); } catch (e) { return text(T('sqlcmd: sorgu motoru yüklenemedi', 'sqlcmd: could not load the query engine'), 'r'); }
      const names = qcat().tables.map((t) => t.name).join(', ');
      print([T('<span class="m">GarageSQL (salt okunur, Veri Odası’yla aynı motor). Tablolar: ' + names + '. Sorguyu yaz, Enter. QUIT ile çık.</span>', '<span class="m">GarageSQL (read-only, the same engine as the Data Room). Tables: ' + names + '. Type a query, Enter. QUIT to leave.</span>')]);
      setMode('sql');
    } },
    sql: { d: ['tek SQL sorgusu', 'one-off SQL query'], async run(a, raw) { const q = raw.replace(/^\s*sql\b\s*/i, ''); if (!q) return text(T('kullanım: sql SELECT … FROM …', 'usage: sql SELECT … FROM …'), 'm'); await sql(q); } },
    neofetch: { d: ['sistem kartı', 'system card'], run: neofetch },
    history: { d: ['komut geçmişi', 'command history'], run() { print(hist.slice(-20).map((h, i) => '<span class="m">' + pad(hist.length - Math.min(20, hist.length) + i + 1, 4) + '</span>' + esc(h))); } },
    echo: { d: ['yazdır', 'print'], run(a) { text(a.join(' ')); } },
    pwd: { d: ['konum', 'location'], run() { const p = G.page(); text('/home/emre/garaj' + (p === 'garaj' ? '' : '/' + (p === 'giris' ? 'masa' : p))); } },
    clear: { d: ['ekranı temizle', 'clear'], run() { out.innerHTML = ''; } },
    palette: { d: ['komut paleti', 'command palette'], run() { close(); setTimeout(() => G.openPalette(), 60); } },
    exit: { d: ['kapat', 'close'], run() { close(); } }
  };
  // Takma adlar
  Object.assign(CMDS, { experience: CMDS.deneyim, education: CMDS.egitim, contact: CMDS.iletisim, cd: CMDS.open, get: CMDS.curl, GET: CMDS.curl, quit: CMDS.exit, zaman: CMDS.phase, theme: CMDS.phase, posts: CMDS.blog, cls: CMDS.clear, harita: CMDS.map, rota: CMDS.route });
  const EXTRA = () => G.commands || {};

  // =================================================================== curl (gerçek istekler)
  // /api/*.json, /posts/index.json, /feed.xml … gibi dosyalar sunucudan gerçekten istenir (fetch). /health, /metrics ve
  // /build sayfanın içinde hesaplanan sanal uçlardır. Kısa yollar (/api/emre) /api/emre.json'a gider.
  const ROOT = () => (document.body && document.body.dataset.root) || '';
  function curlFallback(file) {   // ağ yoksa ya da yerelde API dosyaları üretilmemişse: config.js'ten
    const m = file.match(/^api\/(?:en\/)?(emre|stack|experience|posts)\.json$/); if (!m) return null;
    const pj = profileJson();
    if (m[1] === 'emre') return pj;
    if (m[1] === 'stack') return { drawers: G.toolbox.map((d) => ({ id: d.id, name: tx(d.drawer), tools: d.tools.map((t) => ({ name: t.name, note: tx(t.note) })) })) };
    if (m[1] === 'experience') return { experience: pj.experience, education: pj.education };
    return { posts: (posts || []).map((x) => ({ slug: x.slug, title: x.title, date: x.date, tags: x.tags || [] })) };
  }
  async function virtualEndpoint(p, t0) {
    if (p === '/health' || p === '/healthz') {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
      const sw = !!(reg && reg.active);
      const entries = {
        telemetry: { status: 'Healthy', data: { pageViews: G.metrics.sum('garage_page_views_total'), logs: G.logs().length } },
        cache: { status: 'Healthy', data: { keys: G.redis.dbsize() } },
        network: { status: navigator.onLine ? 'Healthy' : 'Unhealthy', description: navigator.onLine ? 'online' : 'offline' },
        offline: { status: sw ? 'Healthy' : 'Degraded', description: sw ? (navigator.serviceWorker.controller ? 'service worker active' : 'service worker installed; controls the next page load') : 'service worker not available (preview, private mode or blocked)' }
      };
      const overall = Object.values(entries).some((e) => e.status === 'Unhealthy') ? 'Unhealthy' : Object.values(entries).some((e) => e.status === 'Degraded') ? 'Degraded' : 'Healthy';
      return { status: overall === 'Unhealthy' ? 503 : 200, type: 'application/json; charset=utf-8', body: { status: overall, totalDuration: '00:00:00.' + String(Math.round((performance.now() - t0) * 10000)).padStart(7, '0'), entries } };
    }
    if (p === '/metrics') return { status: 200, type: 'text/plain; version=0.0.4; charset=utf-8', body: G.metrics.exposition() };
    if (p === '/build') { const b = await G.build(); return b ? { status: 200, type: 'application/json; charset=utf-8', body: b } : { status: 404, type: 'application/problem+json; charset=utf-8', body: { title: 'Not Found', status: 404, detail: 'build.json yok: site henüz CI ile yayınlanmamış' } }; }
    return null;
  }
  async function curl(a) {
    const flags = a.filter((x) => /^-/.test(x)).join('');
    const include = /i/.test(flags), headOnly = /I/.test(flags) || a.includes('--head');
    let path = (a.find((x) => !x.startsWith('-')) || '').replace(/^https?:\/\/[^/]+/, '');
    if (!path) return print(T('kullanım: curl [-i] [-I] &lt;yol&gt; · örn. /api/emre.json, /api/en/stack.json, /api/openapi.json, /health, /metrics, /feed.xml', 'usage: curl [-i] [-I] &lt;path&gt; · e.g. /api/emre.json, /api/en/stack.json, /api/openapi.json, /health, /metrics, /feed.xml'), 'm');
    if (!path.startsWith('/')) path = '/' + path;
    const t0 = performance.now();
    const p = path.replace(/\/+$/, '').toLowerCase() || '/';
    const statusLine = (st) => '<span class="' + (st < 400 ? 'g' : 'r') + '">HTTP/2 ' + st + '</span>';
    const v = await virtualEndpoint(p.replace(/\.json$/, '') === '/build' ? '/build' : p, t0);
    if (v) {
      G.log(v.status < 400 ? 'info' : 'warn', 'curl ' + path + ' ' + v.status, { ms: +(performance.now() - t0).toFixed(2) });
      if (include || headOnly) print([statusLine(v.status), '<span class="m">content-type:</span> ' + esc(v.type), '<span class="m">x-garage-source:</span> ' + T('sayfa içi (sanal uç)', 'in-page (virtual endpoint)')].concat(headOnly ? [] : ['']));
      if (headOnly) return;
      return typeof v.body === 'string' ? printMetrics(v.body) : print(json(v.body));
    }
    let file = path.replace(/^\/+/, '').split('#')[0];
    if (/^api\/(en\/)?[a-z]+$/i.test(file)) file += '.json';   // eski kısa yollar
    let res = null, body = '';
    try {
      res = await fetch(ROOT() + file, { method: headOnly ? 'HEAD' : 'GET', cache: 'no-cache', headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8' } });
      if (!headOnly) body = await res.text();
    } catch (e) { res = null; }
    const ms = performance.now() - t0;
    if (!res || (res.status === 404 && curlFallback(file))) {
      const fb = curlFallback(file);
      if (fb) {
        if (/^api\/(?:en\/)?posts\.json$/.test(file)) await loadPosts();
        G.log('warn', 'curl ' + path + ' fallback', { ms: +ms.toFixed(1) });
        if (include || headOnly) print([statusLine(200), '<span class="m">content-type:</span> application/json; charset=utf-8', '<span class="m">x-garage-source:</span> ' + T('config.js (dosya bulunamadı; yerelde önce node scripts/build.mjs --write)', 'config.js (file not found; locally run node scripts/build.mjs --write first)')].concat(headOnly ? [] : ['']));
        if (!headOnly) print(json(curlFallback(file)));
        return;
      }
      return stderr(esc('curl: (7) ' + T('Sunucuya bağlanılamadı', 'Failed to connect to the server') + ' (' + (location.host || 'localhost') + ')'), 'r');
    }
    G.log(res.ok ? 'info' : 'warn', 'curl ' + path + ' ' + res.status, { ms: +ms.toFixed(1), bytes: body.length });
    G.metrics.inc('garage_terminal_http_total', { status: String(res.status) });
    if (include || headOnly) {
      const hs = []; res.headers.forEach((val, k) => hs.push('<span class="m">' + esc(k) + ':</span> ' + esc(val)));
      print([statusLine(res.status)].concat(hs.sort()).concat(headOnly ? [] : ['']));
    }
    if (headOnly) return;
    const ct = res.headers.get('content-type') || '';
    if (/json/.test(ct) || /^\s*[[{]/.test(body)) { try { return print(json(JSON.parse(body))); } catch (e) { /* düz metin olarak devam */ } }
    if (/html/.test(ct) && !res.ok) return print('<span class="r">HTTP ' + res.status + '</span> <span class="m">' + T('(HTML hata sayfası, ' + body.length + ' bayt)', '(HTML error page, ' + body.length + ' bytes)') + '</span>');
    const lines = body.replace(/\s+$/, '').split('\n');
    print(lines.slice(0, 200).map(esc).concat(lines.length > 200 ? ['<span class="m">… ' + (lines.length - 200) + T(' satır daha', ' more lines') + '</span>'] : []));
  }

  // =================================================================== sorgu motoru (query.js: Veri Odası'yla ortak)
  let Qp = null, qposts = [];
  const ensureQ = () => Qp || (Qp = (window.GarageQuery ? Promise.resolve() : G.loadScript('query.js'))
    .then(() => window.GarageQuery.loadPosts(ROOT()))
    .then((ps) => { qposts = ps || []; return window.GarageQuery; })
    .catch((e) => { Qp = null; throw e; }));
  const qcat = () => window.GarageQuery.build(G, qposts);

  const rid = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  function printMetrics(s) {
    print(s.trim().split('\n').map((l) => (l.startsWith('#') ? '<span class="m">' + esc(l) + '</span>' : esc(l).replace(/^([a-z_:][\w:]*)(\{[^}]*\})?\s+(.+)$/, '<span class="c">$1</span><span class="m">$2</span> <span class="b">$3</span>'))));
  }

  // =================================================================== ping (gerçek ölçüm)
  async function ping() {
    const host = location.host || 'localhost';
    text('PING ' + host + ' (HTTP HEAD ' + (location.pathname || '/') + ')');
    const times = [];
    for (let i = 1; i <= 4; i++) {
      if (abort && abort.stop) break;
      const t0 = performance.now();
      try {
        const r = await fetch(location.pathname + '?ping=' + Date.now() + '-' + i, { method: 'HEAD', cache: 'no-store' });
        const dt = performance.now() - t0; times.push(dt);
        print('<span class="m">' + r.status + ' from</span> ' + esc(host) + ': seq=' + i + ' time=<span class="hl">' + dt.toFixed(1) + ' ms</span>');
      } catch (e) { print('seq=' + i + ' <span class="r">timeout</span>'); }
      await sleep(350);
    }
    if (!times.length) return text(T('ağa ulaşılamadı.', 'network unreachable.'), 'r');
    const min = Math.min(...times), max = Math.max(...times), avg = times.reduce((x, y) => x + y, 0) / times.length;
    print(['', '--- ' + esc(host) + ' ping ' + T('istatistikleri', 'statistics') + ' ---', '4 ' + T('istek', 'requests') + ', ' + times.length + T(' yanıt', ' received') + ', ' + Math.round((1 - times.length / 4) * 100) + '% ' + T('kayıp', 'loss'), 'rtt min/avg/max = ' + min.toFixed(1) + '/' + avg.toFixed(1) + '/' + max.toFixed(1) + ' ms']);
  }

  // =================================================================== top (canlı ölçüm)
  async function top() {
    text(T('1 saniye ölçülüyor…', 'sampling for 1 second…'), 'm');
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const fps = frames * 1000 / (performance.now() - t0);
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const kb = res.reduce((x, r) => x + (r.transferSize || 0), nav ? nav.transferSize || 0 : 0) / 1024;
    const v = G.vitals();
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/a';
    const conn = navigator.connection ? (navigator.connection.effectiveType || '?') + (navigator.connection.rtt ? ', rtt ' + navigator.connection.rtt + 'ms' : '') : 'n/a';
    const row = (k, v2, cls) => '<span class="c">' + pad(k, 18) + '</span><span class="' + (cls || 'hl') + '">' + v2 + '</span>';
    print([
      row('fps', fps.toFixed(1), fps >= 50 ? 'g' : fps >= 30 ? 'c' : 'r'),
      row(T('sayfa yükleme', 'page load'), nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd - nav.startTime) + ' ms' : '—'),
      row('LCP', v.lcp ? Math.round(v.lcp) + ' ms' : '—', v.lcp && v.lcp < 2500 ? 'g' : 'c'),
      row('CLS', v.cls.toFixed(3), v.cls < 0.1 ? 'g' : 'c'),
      row('INP', v.inp ? Math.round(v.inp) + ' ms' : '—', !v.inp || v.inp < 200 ? 'g' : 'c'),
      row(T('istekler', 'requests'), (res.length + 1) + ' · ' + kb.toFixed(0) + ' KB'),
      row('JS heap', mem),
      row('DOM', document.getElementsByTagName('*').length + T(' düğüm', ' nodes')),
      row(T('bağlantı', 'connection'), conn),
      row('service worker', 'serviceWorker' in navigator && navigator.serviceWorker.controller ? T('aktif', 'active') : T('pasif', 'inactive')),
      row(T('oturum', 'session'), Math.round((Date.now() - G.metrics.since()) / 60000) + ' min · ' + G.metrics.sum('garage_page_views_total') + ' views · ' + G.logs().length + ' logs')
    ]);
  }

  // =================================================================== logs
  const LV = { debug: 'm', info: 'b', warn: 'c', error: 'r' };
  const fmtLog = (e) => { const d = new Date(e.ts); return '<span class="m">' + d.toLocaleTimeString('en-GB') + '</span> <span class="' + (LV[e.level] || '') + '">' + pad(e.level.toUpperCase(), 5) + '</span> <span class="v">[' + esc(e.page) + ']</span> ' + esc(e.msg) + Object.keys(e.fields || {}).map((k) => ' <span class="m">' + esc(k) + '=</span>' + esc(e.fields[k])).join(''); };
  function logs(a) {
    const lvl = a.find((x) => /^(debug|info|warn|error)$/i.test(x));
    const list = G.logs().filter((e) => !lvl || e.level === lvl.toLowerCase());
    if (!list.length) text(T('kayıt yok.', 'no logs.'), 'm'); else print(list.slice(-15).map(fmtLog));
    if (a.includes('-f')) {
      text(T('canlı izleniyor… (Ctrl+C ile durdur)', 'following… (Ctrl+C to stop)'), 'm');
      follow = (ev) => { if (ev.detail && (!lvl || ev.detail.level === lvl.toLowerCase())) print(fmtLog(ev.detail)); };
      document.addEventListener('garage:log', follow);
      return 'follow';
    }
  }
  function stopFollow() { if (follow) { document.removeEventListener('garage:log', follow); follow = null; text('^C', 'm'); } }

  // =================================================================== neofetch
  function neofetch() {
    const ua = navigator.userAgent;
    const br = (ua.match(/(Edg|OPR|Chrome|Firefox|Version)\/([\d]+)/) || [])[0] || 'browser';
    const logo = [
      '<span class="c">   ▄▄▄▄▄▄▄▄▄▄▄▄   </span>',
      '<span class="c">  ▟██████████████▙ </span>',
      '<span class="m">  ▐▀▀▀▀▀▀▀▀▀▀▀▀▀▀▌ </span>',
      '<span class="m">  ▐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▌ </span>',
      '<span class="m">  ▐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▌ </span>',
      '<span class="m">  ▐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▌ </span>',
      '<span class="m">  ▐▬▬▬▬▬▬▬▬▬▬▬▬▬▬▌ </span>',
      '<span class="c">  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ </span>'
    ];
    const s = Math.round((Date.now() - G.metrics.since()) / 60000);
    const info = [
      '<span class="hl">emre</span>@<span class="hl">garage</span>', '<span class="m">-------------</span>',
      '<span class="c">OS</span>: GarageOS 1.0 (web)', '<span class="c">Host</span>: ' + esc(location.host || 'localhost'),
      '<span class="c">Shell</span>: gsh 1.0', '<span class="c">Browser</span>: ' + esc(br.replace('/', ' ').replace('Version', 'Safari')),
      '<span class="c">Display</span>: ' + screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x',
      '<span class="c">Locale</span>: ' + G.lang() + ' · ' + esc(G.city) + ' ' + G.localTime(),
      '<span class="c">Stack</span>: ' + G.toolbox.flatMap((d) => d.tools.map((t) => t.name)).slice(0, 5).join(', ') + '…',
      '<span class="c">Uptime</span>: ' + s + ' min',
      '<span style="color:#F2B33D">███</span><span style="color:#4FD18B">███</span><span style="color:#6CB6FF">███</span><span style="color:#FF6B61">███</span><span style="color:#C9A2FF">███</span>'
    ];
    const n = Math.max(logo.length, info.length);
    print(Array.from({ length: n }, (_, i) => (logo[i] || ' '.repeat(19)) + '  ' + (info[i] || '')));
  }

  // =================================================================== redis-cli
  function redis(a) {
    const R = G.redis, cmd = (a[0] || '').toUpperCase(), q = (v) => '"' + esc(v) + '"';
    const int = (n) => print('(integer) ' + n);
    const err = (m) => print('<span class="r">(error) ' + esc(m) + '</span>');
    const need = (n) => { if (a.length - 1 < n) { err("ERR wrong number of arguments for '" + a[0].toLowerCase() + "' command"); return false; } return true; };
    switch (cmd) {
      case 'PING': return print(a[1] ? q(a[1]) : 'PONG');
      case 'ECHO': return need(1) && print(q(a[1]));
      case 'SET': {
        if (!need(2)) return;
        let ttl = 0; const ex = a.findIndex((x, i) => i > 2 && /^(EX|PX)$/i.test(x));
        if (ex > 0) { const n = parseInt(a[ex + 1], 10); if (!(n > 0)) return err('ERR invalid expire time in \'set\' command'); ttl = /^PX$/i.test(a[ex]) ? n / 1000 : n; }
        R.set(a[1], a[2], ttl); return print('OK');
      }
      case 'GET': { if (!need(1)) return; const v = R.get(a[1]); return print(v == null ? '(nil)' : q(v)); }
      case 'DEL': return need(1) && int(R.del(...a.slice(1)));
      case 'EXISTS': return need(1) && int(a.slice(1).reduce((n, k) => n + R.exists(k), 0));
      case 'TTL': return need(1) && int(R.ttl(a[1]));
      case 'PTTL': return need(1) && int(R.pttl(a[1]));
      case 'EXPIRE': return need(2) && int(R.expire(a[1], parseInt(a[2], 10) || 0));
      case 'PERSIST': return need(1) && int(R.persist(a[1]));
      case 'INCR': return need(1) && int(R.incr(a[1], 1));
      case 'DECR': return need(1) && int(R.incr(a[1], -1));
      case 'INCRBY': return need(2) && int(R.incr(a[1], parseInt(a[2], 10) || 0));
      case 'TYPE': return need(1) && print(R.exists(a[1]) ? 'string' : 'none');
      case 'KEYS': { const ks = R.keys(a[1] || '*'); return print(ks.length ? ks.map((k, i) => (i + 1) + ') ' + q(k)) : ['(empty array)']); }
      case 'DBSIZE': return int(R.dbsize());
      case 'FLUSHALL': case 'FLUSHDB': R.flushall(); G.log('warn', 'redis FLUSHALL', {}); return print('OK');
      case 'INFO': return print(['# Server', 'redis_version:garage-1.0 (in-browser)', 'uptime_in_seconds:' + Math.round((Date.now() - G.metrics.since()) / 1000), '', '# Keyspace', 'db0:keys=' + R.dbsize() + ',expires=' + R.entries().filter((e) => e.ttl > 0).length].map(esc));
      case 'HELP': return print(['SET key value [EX s|PX ms] · GET · DEL · EXISTS · TTL · PTTL · EXPIRE · PERSIST', 'INCR · DECR · INCRBY · KEYS pattern · DBSIZE · FLUSHALL · TYPE · INFO · PING · QUIT'].map((l) => '<span class="m">' + esc(l) + '</span>'));
      case 'QUIT': case 'EXIT': setMode('sh'); return;
      case '': return;
      default: return err("ERR unknown command '" + a[0] + "', with args beginning with: " + a.slice(1, 3).map((x) => "'" + x + "'").join(' '));
    }
  }

  // =================================================================== sqlcmd (GarageSQL — query.js)
  async function sql(q) {
    q = q.trim().replace(/\s+GO\s*$/i, '');
    if (!q || /^go$/i.test(q)) return;
    if (/^(quit|exit|:quit|:exit)$/i.test(q)) { setMode('sh'); return; }
    let Q; try { Q = await ensureQ(); } catch (e) { return text(T('sqlcmd: sorgu motoru yüklenemedi', 'sqlcmd: could not load the query engine'), 'r'); }
    G.log('info', 'sql ' + q.slice(0, 80), {});
    const rs = Q.runSql(q, qcat());
    rs.forEach((r, k) => {
      if (k) print('');
      if (r.error) print(Q.sqlErrText(r.error).split('\n').map((l, i) => (i ? esc(l) : '<span class="r">' + esc(l) + '</span>')));
      else if (r.message) text(r.message);
      else print(table(r.cols.map((c) => c || ''), r.rows.slice(0, 200), { total: r.rows.length }).concat(r.rows.length > 200 ? ['<span class="m">' + T('(ilk 200 satır gösterildi)', '(first 200 rows shown)') + '</span>'] : []));
    });
    G.metrics.inc('garage_db_queries_total', { lang: 'sql', status: rs.some((r) => r.error) ? 'error' : 'ok' });
  }

  // =================================================================== mongosh (query.js)
  const mstate = { db: 'garage' };
  let mcursor = null;
  const MONGO_HELP = () => [
    '<span class="c">' + T('Kabuk', 'Shell') + '</span>',
    '  show collections · show dbs · use garage · db · it · exit',
    '<span class="c">' + T('Okuma', 'Reading') + '</span>',
    '  db.&lt;c&gt;.find(' + T('filtre, projeksiyon', 'filter, projection') + ').sort({ … }).limit(n).skip(n)',
    '  db.&lt;c&gt;.findOne(…) · countDocuments(…) · distinct(\'' + T('alan', 'field') + '\') · getIndexes()',
    '  db.&lt;c&gt;.aggregate([ { $match }, { $group }, { $project }, { $sort }, { $unwind }, { $lookup }, { $sortByCount } ])',
    '<span class="m">' + T('Yazma işlemleri kapalı: veritabanı salt okunur.', 'Writes are disabled: the database is read-only.') + '</span>'
  ];
  function mdocs(docs) {
    const page = docs.splice(0, 20);
    print(window.GarageQuery.inspect(page, 0, { html: true }).split('\n'));
    mcursor = docs.length ? docs : null;
    if (mcursor) print('<span class="m">' + T('Devamı için "it" yaz (' + mcursor.length + ' belge kaldı)', 'Type "it" for more (' + mcursor.length + ' documents left)') + '</span>');
  }
  function mprint(r) {
    if (r.kind === 'error') return text(r.error, 'r');
    if (r.kind === 'lines') return print(r.lines.map(esc));
    if (r.kind === 'value') return print(window.GarageQuery.inspect(r.value, 0, { html: true }).split('\n'));
    if (r.kind === 'docs') return r.docs.length ? mdocs(r.docs.slice()) : undefined;
    if (r.kind === 'cmd') {
      if (r.cmd === 'help') return print(MONGO_HELP());
      if (r.cmd === 'it') return mcursor ? mdocs(mcursor) : text('no cursor', 'm');
      if (r.cmd === 'exit' || r.cmd === 'quit') setMode('sh');
    }
  }
  const depthOf = (src) => { let d = 0, q = null; for (let k = 0; k < src.length; k++) { const ch = src[k]; if (q) { if (ch === '\\') k++; else if (ch === q) q = null; } else if (ch === '"' || ch === "'" || ch === '`') q = ch; else if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; } return d; };
  async function mongo(line) {
    let Q; try { Q = await ensureQ(); } catch (e) { return text(T('mongosh: sorgu motoru yüklenemedi', 'mongosh: could not load the query engine'), 'r'); }
    mbuf += (mbuf ? '\n' : '') + line;
    if (depthOf(mbuf) > 0 && mode === 'mongo') { label.textContent = promptText(); return; }
    const src = mbuf; mbuf = '';
    if (label) label.textContent = promptText();
    const cat = qcat();
    let errs = 0;
    for (const stmt of Q.splitShell(src)) {
      const r = Q.runMongo(stmt, cat, mstate);
      if (r.kind === 'error') errs++;
      mprint(r);
      if (mode === 'sh' && r.kind === 'cmd') break;
    }
    G.log(errs ? 'warn' : 'info', 'mongosh ' + src.replace(/\s+/g, ' ').slice(0, 80), {});
    G.metrics.inc('garage_db_queries_total', { lang: 'mongo', status: errs ? 'error' : 'ok' });
  }

  // =================================================================== man
  const MAN = {
    curl: { syn: 'curl [-i] [-I] <path>', tr: 'Sitenin dosyalarına gerçek HTTP isteği atar. /api/*.json gerçek JSON uçlarıdır; /health, /metrics ve /build sayfanın içinde hesaplanır. -i başlıkları da gösterir, -I yalnız başlıkları ister (HEAD).', en: 'Sends a real HTTP request for the site’s files. /api/*.json are real JSON endpoints; /health, /metrics and /build are computed in the page. -i includes the headers, -I asks for the headers only (HEAD).', ex: ['curl /api/emre.json', 'curl -i /api/en/stack.json', 'curl -I /feed.xml', 'curl /health'] },
    jq: { syn: "<cmd> | jq [-r] [-c] '<filter>'", tr: "JSON süzgeci: .alan, .dizi[], .dizi[0], keys, length, type, map(f), select(.a == \"x\"), first, last, sort, unique, join(\", \"), {ad, rol} ve [ … ] destekler. -r metinleri tırnaksız, -c tek satır yazar.", en: "JSON filter: supports .field, .array[], .array[0], keys, length, type, map(f), select(.a == \"x\"), first, last, sort, unique, join(\", \"), {name, role} and [ … ]. -r prints raw strings, -c compact output.", ex: ["curl /api/stack.json | jq '.drawers[].name'", "curl /api/emre.json | jq -r '.stack | join(\", \")'", "curl /api/posts.json | jq '.posts[] | {title, date}'"] },
    grep: { syn: '<cmd> | grep [-i] [-v] [-c] [-n] <pattern>', tr: 'Satırları bir desene (düzenli ifade) göre süzer. -i büyük/küçük harf ayırmaz, -v eşleşmeyenleri, -c sayıyı, -n satır numarasını verir.', en: 'Filters lines by a pattern (regular expression). -i ignores case, -v inverts, -c counts, -n numbers the lines.', ex: ['logs | grep -i warn', 'metrics | grep -c garage_', 'help | grep -n sql'] },
    wc: { syn: '<cmd> | wc [-l] [-w] [-c]', tr: 'Satır, sözcük ve karakter sayar.', en: 'Counts lines, words and characters.', ex: ['logs | wc -l'] },
    head: { syn: '<cmd> | head [-n N]', tr: 'İlk N satır (varsayılan 10). tail son N satırı verir.', en: 'First N lines (default 10). tail gives the last N.', ex: ['metrics | head -n 5', 'logs | tail -3'] },
    sort: { syn: '<cmd> | sort [-r] [-n] [-u]', tr: 'Satırları sıralar: -r ters, -n sayısal, -u tekrarları atar. uniq [-c] ardışık tekrarları birleştirir.', en: 'Sorts lines: -r reverse, -n numeric, -u unique. uniq [-c] collapses adjacent duplicates.', ex: ["logs | cut -d ' ' -f 2 | sort | uniq -c"] },
    cut: { syn: "<cmd> | cut -d '<sep>' -f N[,M]", tr: 'Her satırı ayraçla böler ve istenen alanları verir.', en: 'Splits each line by a delimiter and keeps the given fields.', ex: ["metrics | grep -v '#' | cut -d ' ' -f 1"] },
    sqlcmd: { syn: 'sqlcmd [-Q "<query>"] · sql <query>', tr: 'GarageSQL: T-SQL’in salt okunur alt kümesi. JOIN, GROUP BY/HAVING, TOP, DISTINCT, fonksiyonlar, INFORMATION_SCHEMA. Tablolar sitenin içeriği ve bu ziyaretin ölçümleri; Veri Odası’yla aynı motor.', en: 'GarageSQL: a read-only subset of T-SQL. JOIN, GROUP BY/HAVING, TOP, DISTINCT, functions, INFORMATION_SCHEMA. Tables hold the site’s content and this visit’s measurements; the same engine as the Data Room.', ex: ['sql SELECT TOP 5 page, load_ms FROM page_views ORDER BY load_ms DESC', 'sqlcmd -Q "SELECT * FROM INFORMATION_SCHEMA.TABLES"'] },
    mongosh: { syn: 'mongosh [--eval "<code>"]', tr: 'MongoDB kabuğu: find, sort/limit/skip, aggregate ($match, $group, $unwind, $lookup…), countDocuments, distinct. Salt okunur.', en: 'MongoDB shell: find, sort/limit/skip, aggregate ($match, $group, $unwind, $lookup…), countDocuments, distinct. Read-only.', ex: ['mongosh', 'mongosh --eval "db.skills.find({ category: \'data\' }, { _id: 0, name: 1 })"'] },
    'redis-cli': { syn: 'redis-cli [command]', tr: 'Şema sayfasının da kullandığı paylaşılan önbellek: SET/GET/DEL, TTL, EXPIRE, INCR, KEYS, DBSIZE, INFO.', en: 'The shared cache the Blueprint page uses too: SET/GET/DEL, TTL, EXPIRE, INCR, KEYS, DBSIZE, INFO.', ex: ['redis-cli KEYS *', 'redis-cli SET demo hello EX 30'] },
    logs: { syn: 'logs [info|warn|error] [-f]', tr: 'Bu oturumun yapılandırılmış logları; -f canlı izler (Ctrl+C durdurur).', en: 'This session’s structured logs; -f follows live (Ctrl+C stops).', ex: ['logs warn', 'logs -f', 'logs | grep -ic info'] },
    open: { syn: 'open <page|1-4>', tr: 'Bir odaya gider. Takma adlar: garaj, hakkimda, canta, defter, iletisim, sema, kontrol, veri, api, cv, giris; 1–4 garajdaki kapılar.', en: 'Walks to a room. Aliases: garage, about, toolbox, logbook, contact, blueprint, control, data, api, cv, intro; 1–4 are the garage doors.', ex: ['open veri', 'open 2'] },
    map: { syn: 'map · plan', tr: 'map garajın planını burada çizer (buradasın ve gezilen odalar işaretli); plan görsel planı açar (M tuşu).', en: 'map draws the garage plan right here (you-are-here and visited rooms marked); plan opens the visual plan (M key).', ex: ['map', 'plan'] },
    route: { syn: 'route [tanis|kurcala|next]', tr: 'İki rota var. Tanış: Hakkımda → Takım Çantası → Seyir Defteri → İletişim. Kurcala: Şema → Kontrol Odası → Veri Odası → API. route next rotadaki sonraki durağa gider.', en: 'There are two routes. Meet: About → Toolbox → Logbook → Contact. Tinker: Blueprint → Control Room → Data Room → API. route next goes to the next stop.', ex: ['route', 'route kurcala', 'route next'] }
  };
  Object.assign(MAN, { tail: MAN.head, uniq: MAN.sort, sql: MAN.sqlcmd, plan: MAN.map, rota: MAN.route });
  function manPage(name) {
    const k = String(name || '').toLowerCase();
    if (!k) return print(['<span class="c">' + T('Kılavuzu olan komutlar:', 'Commands with a manual:') + '</span>', '  ' + Object.keys(MAN).join('  '), '<span class="m">' + T('örn. ', 'e.g. ') + 'man curl</span>']);
    const m = MAN[k];
    if (!m) { if (CMDS[k]) return print('<span class="hl">' + esc(k) + '</span> — ' + esc(T(CMDS[k].d[0], CMDS[k].d[1]))); return text(T('man: ' + k + ' için kılavuz yok', 'No manual entry for ' + k), 'r'); }
    const H = (t) => '<span class="c">' + t + '</span>';
    print([H(T('AD', 'NAME')), '    <span class="hl">' + esc(k) + '</span>' + (CMDS[k] ? ' — ' + esc(T(CMDS[k].d[0], CMDS[k].d[1])) : ''), H(T('KULLANIM', 'SYNOPSIS')), '    ' + esc(m.syn), H(T('AÇIKLAMA', 'DESCRIPTION')), '    ' + esc(T(m.tr, m.en)), H(T('ÖRNEKLER', 'EXAMPLES'))]
      .concat(m.ex.map((x) => '    <span class="m">$</span> ' + esc(x))));
  }

  // =================================================================== map (ASCII kat planı) ve route
  function asciiMap() {
    const here = G.page() === 'yazi' ? 'seyir-defteri' : G.page(), seen = G.visited(), N = NAMES();
    const SHORT = { hakkimda: T('Hakkımda', 'About'), 'takim-cantasi': T('Çanta', 'Toolbox'), 'seyir-defteri': T('Defter', 'Logbook'), iletisim: T('İletişim', 'Contact'), sema: T('Şema', 'Blueprint'), 'kontrol-odasi': T('Kontrol', 'Control'), 'veri-odasi': T('Veri', 'Data'), api: 'API' };
    const cell = (id) => { const nm = esc(pad(SHORT[id], 9)); return id === here ? '<span class="c">●</span><span class="hl">' + nm + '</span>' : seen.has(id) ? '<span class="g">✓</span>' + nm : ' ' + nm; };
    const B = (x) => '<span class="m">' + x + '</span>';
    const row = (ids) => B('│') + ids.map(cell).join(B('│')) + B('│');
    const top = ['hakkimda', 'takim-cantasi', 'seyir-defteri', 'iletisim'], bottom = ['sema', 'kontrol-odasi', 'veri-odasi', 'api'];
    const corr = Array(45).fill('═');
    [...T('GİRİŞ', 'ENTRY')].forEach((ch, k) => { corr[k] = ch; }); corr[5] = ' ';
    [6, 17, 28, 39].forEach((k) => { corr[k] = '╪'; });
    const hub = (here === 'garaj' ? '●' : ' ') + T('GARAJ', 'GARAGE') + ' ';
    [...hub].forEach((ch, k) => { corr[19 + k] = ch; });
    corr[41] = ' '; corr[42] = ' '; corr[43] = 'C'; corr[44] = 'V';
    const corrHtml = esc(corr.join('')).replace(/[═╪]+/g, (x) => B(x)).replace('●', '<span class="c">●</span>').replace(/(GİRİŞ|ENTRY|GARAJ|GARAGE|CV)/g, '<span class="hl">$1</span>');
    const rooms = top.concat(bottom, ['garaj']), n = rooms.filter((id) => seen.has(id) || id === here).length;
    const where = here === 'giris' ? T('giriş sahnesi', 'intro scene') : N[here] || here;
    print([
      '<span class="m">┌──────────┬──────────┬──────────┬──────────┐</span>',
      row(top),
      '<span class="m">└─────┬────┴─────┬────┴─────┬────┴─────┬────┘</span>',
      corrHtml,
      '<span class="m">┌─────┴────┬─────┴────┬─────┴────┬─────┴────┐</span>',
      row(bottom),
      '<span class="m">└──────────┴──────────┴──────────┴──────────┘</span>',
      '<span class="c">●</span> ' + esc(T('buradasın: ', 'you are here: ') + where) + '   <span class="g">✓</span> ' + esc(T('gezildi', 'visited')) + ' <span class="m">· ' + n + '/' + rooms.length + '</span>',
      '<span class="m">' + T('üst sıra: Tanış rotası · alt sıra: Kurcala rotası · görsel plan: ', 'top row: Meet route · bottom row: Tinker route · visual plan: ') + '</span>plan'
    ]);
  }
  function route(a) {
    const seen = G.visited(), N = NAMES(), R = G.ROUTES, k = normKey(a[0] || '');
    const show = (id) => {
      const r = R[id], n = r.stops.filter((p) => seen.has(p)).length;
      return '<span class="' + (id === 'tanis' ? 'c' : 'b') + '">' + esc(pad(G.tx(r.name), 9)) + '</span>' + r.stops.map((p) => (seen.has(p) ? '<span class="g">✓</span> ' : '<span class="m">·</span> ') + esc(N[p])).join(' <span class="m">→</span> ') + '  <span class="m">' + n + '/' + r.stops.length + '</span>';
    };
    if (!k) return print([show('tanis'), show('kurcala'), '', '<span class="m">' + T('başlat: ', 'start: ') + '</span>route tanis<span class="m"> | </span>route kurcala<span class="m"> · ' + T('sıradaki durak: ', 'next stop: ') + '</span>route next']);
    if (k === 'next' || k === 'sonraki') {
      const cur = G.routeOf(G.page());
      if (!cur) return text(T('Şu an bir rotada değilsin: route tanis ya da route kurcala.', 'You are not on a route: route meet or route tinker.'), 'm');
      if (!cur.next) return text(T('Rotanın son durağındasın. Diğer rota: route ', 'This is the last stop. The other route: route ') + (cur.id === 'tanis' ? 'kurcala' : 'tanis'), 'm');
      text('→ ' + cur.next + '.html', 'm'); setTimeout(() => { location.href = cur.next + '.html'; }, 220); return;
    }
    const id = { tanis: 'tanis', meet: 'tanis', kurcala: 'kurcala', tinker: 'kurcala' }[k];
    if (!id) return text(T('kullanım: route [tanis|kurcala|next]', 'usage: route [meet|tinker|next]'), 'r');
    const first = R[id].stops.find((p) => !seen.has(p)) || R[id].stops[0];
    text('→ ' + first + '.html', 'm'); setTimeout(() => { location.href = first + '.html'; }, 220);
  }

  // =================================================================== boru filtreleri ve jq
  const plainEl = document.createElement('div');
  const plain = (html) => { plainEl.innerHTML = html; return plainEl.textContent.replace(/ /g, ' '); };
  const nArg = (a, d) => { let n = d; a.forEach((x, k) => { if (/^-\d+$/.test(x)) n = +x.slice(1); else if (x === '-n' && a[k + 1]) n = parseInt(a[k + 1], 10); else if (/^-n\d+$/.test(x)) n = +x.slice(2); }); return isNaN(n) ? d : Math.max(0, n); };
  const FILTERS = {
    grep(lines, a) {
      let fl = '', pat = null;
      a.forEach((x) => { if (/^-[ivcnE]+$/.test(x) && pat == null) fl += x; else if (pat == null) pat = x; });
      if (pat == null) return { error: T('kullanım: grep [-i] [-v] [-c] [-n] desen', 'usage: grep [-i] [-v] [-c] [-n] pattern') };
      let re; try { re = new RegExp(pat, fl.includes('i') ? 'i' : ''); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), fl.includes('i') ? 'i' : ''); }
      const o = []; lines.forEach((l, k) => { if (re.test(l) !== fl.includes('v')) o.push((fl.includes('n') ? (k + 1) + ':' : '') + l); });
      return fl.includes('c') ? { lines: [String(o.length)] } : { lines: o, mark: fl.includes('v') ? null : re };
    },
    wc(lines, a) {
      const l = lines.length, w = lines.join(' ').split(/\s+/).filter(Boolean).length, c = lines.reduce((n, x) => n + [...x].length + 1, 0);
      if (a.includes('-l')) return { lines: [String(l)] }; if (a.includes('-w')) return { lines: [String(w)] }; if (a.includes('-c') || a.includes('-m')) return { lines: [String(c)] };
      return { lines: [String(l).padStart(7) + String(w).padStart(8) + String(c).padStart(8)] };
    },
    head: (lines, a) => ({ lines: lines.slice(0, nArg(a, 10)) }),
    tail: (lines, a) => { const n = nArg(a, 10); return { lines: n ? lines.slice(-n) : [] }; },
    sort(lines, a) {
      const f = a.filter((x) => x.startsWith('-')).join('');
      let o = lines.slice().sort((x, y) => (f.includes('n') ? (parseFloat(x.trim()) || 0) - (parseFloat(y.trim()) || 0) : x.localeCompare(y, G.lang())));
      if (f.includes('r')) o.reverse();
      if (f.includes('u')) o = o.filter((x, k) => o.indexOf(x) === k);
      return { lines: o };
    },
    uniq(lines, a) { const o = []; lines.forEach((l) => { const last = o[o.length - 1]; if (last && last.v === l) last.n++; else o.push({ v: l, n: 1 }); }); return { lines: o.map((x) => (a.includes('-c') ? String(x.n).padStart(7) + ' ' : '') + x.v) }; },
    cut(lines, a) {
      let d = '\t', f = null;
      a.forEach((x, k) => { if (x === '-d') d = a[k + 1] == null ? d : a[k + 1]; else if (/^-d./.test(x)) d = x.slice(2); else if (x === '-f') f = a[k + 1]; else if (/^-f/.test(x)) f = x.slice(2); });
      if (!f) return { error: T("kullanım: cut -d ' ' -f 1,3", "usage: cut -d ' ' -f 1,3") };
      const idx = f.split(',').map((n) => parseInt(n, 10) - 1).filter((n) => n >= 0);
      return { lines: lines.map((l) => { const p = l.split(d || ' '); return idx.map((i) => p[i] == null ? '' : p[i]).join(d || ' '); }) };
    },
    jq(lines, a) {
      const fl = a.filter((x) => /^-[rcM]+$/.test(x)).join(''), filter = a.filter((x) => !/^-[rcM]+$/.test(x))[0] || '.';
      let src = lines.join('\n'); const st = src.search(/[[{]/); if (st > 0) src = src.slice(st);
      let data; try { data = JSON.parse(src); } catch (e) { return { error: T('girdi geçerli JSON değil', 'input is not valid JSON') }; }
      let res; try { res = jqRun(filter, [data]); } catch (e) { return { error: e.message }; }
      const o = [];
      res.forEach((v) => { if (fl.includes('r') && typeof v === 'string') o.push(v); else (fl.includes('c') ? [JSON.stringify(v)] : JSON.stringify(v, null, 2).split('\n')).forEach((l) => o.push(l)); });
      return { lines: o, json: !fl.includes('r') };
    },
    cat: (lines) => ({ lines }), less: (lines) => ({ lines }), more: (lines) => ({ lines })
  };
  // ---- mini jq: yol ifadeleri, | , keys, length, type, map(), select(), first, last, sort, unique, reverse, join(), tostring, {…}, […]
  function splitTop(src, sepCh) {
    const parts = []; let cur = '', d = 0, q = null;
    for (let k = 0; k < src.length; k++) {
      const ch = src[k];
      if (q) { cur += ch; if (ch === '\\') { cur += src[++k] || ''; continue; } if (ch === q) q = null; continue; }
      if (ch === '"') { q = ch; cur += ch; continue; }
      if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--;
      if (d === 0 && ch === sepCh) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts.map((x) => x.trim());
  }
  function jqRun(filter, inputs) {
    let vals = inputs;
    for (const stage of splitTop(filter, '|')) {
      const alts = splitTop(stage, ',');
      vals = vals.flatMap((v) => alts.flatMap((alt) => jqOne(alt, v)));
    }
    return vals;
  }
  const jqErr = (m) => { throw new Error('jq: ' + m); };
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  function jqOne(f, v) {
    f = f.trim();
    if (f === '' || f === '.') return [v];
    if (/^".*"$/.test(f)) return [JSON.parse(f)];
    if (/^-?\d+(\.\d+)?$/.test(f)) return [+f];
    if (f === 'true' || f === 'false' || f === 'null') return [JSON.parse(f)];
    if (f.startsWith('(') && f.endsWith(')') && splitTop(f.slice(1, -1), '|').length >= 1 && depthOk(f)) return jqRun(f.slice(1, -1), [v]);
    if (f === 'keys') return [Array.isArray(v) ? v.map((x, i) => i) : v && typeof v === 'object' ? Object.keys(v).sort() : jqErr(typeOf(v) + ' has no keys')];
    if (f === 'length') return [v == null ? 0 : typeof v === 'number' ? Math.abs(v) : Array.isArray(v) || typeof v === 'string' ? v.length : typeof v === 'object' ? Object.keys(v).length : jqErr(typeOf(v) + ' has no length')];
    if (f === 'type') return [typeOf(v)];
    if (f === 'first') return [Array.isArray(v) ? (v[0] === undefined ? null : v[0]) : jqErr('cannot index ' + typeOf(v))];
    if (f === 'last') return [Array.isArray(v) ? (v.length ? v[v.length - 1] : null) : jqErr('cannot index ' + typeOf(v))];
    if (f === 'sort') return [Array.isArray(v) ? v.slice().sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))) : jqErr('cannot sort ' + typeOf(v))];
    if (f === 'unique') return [Array.isArray(v) ? v.filter((x, i) => v.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i).sort((a, b) => String(a).localeCompare(String(b))) : jqErr('cannot unique ' + typeOf(v))];
    if (f === 'reverse') return [Array.isArray(v) ? v.slice().reverse() : typeof v === 'string' ? [...v].reverse().join('') : jqErr('cannot reverse ' + typeOf(v))];
    if (f === 'tostring') return [typeof v === 'string' ? v : JSON.stringify(v)];
    if (f === 'add') return [Array.isArray(v) ? v.reduce((a, b) => (a == null ? b : typeof a === 'number' ? a + b : Array.isArray(a) ? a.concat(b) : typeof a === 'string' ? a + b : Object.assign({}, a, b)), null) : jqErr('cannot add ' + typeOf(v))];
    if (f === 'to_entries') return [v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).map((k) => ({ key: k, value: v[k] })) : jqErr('cannot to_entries ' + typeOf(v))];
    let m;
    if ((m = f.match(/^map\(([\s\S]*)\)$/))) return [Array.isArray(v) ? v.flatMap((x) => jqRun(m[1], [x])) : jqErr('cannot iterate over ' + typeOf(v))];
    if ((m = f.match(/^select\(([\s\S]*)\)$/))) return jqCond(m[1], v) ? [v] : [];
    if ((m = f.match(/^join\(\s*("(?:[^"\\]|\\.)*")\s*\)$/))) return [Array.isArray(v) ? v.map((x) => (x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(JSON.parse(m[1])) : jqErr('cannot join ' + typeOf(v))];
    if ((m = f.match(/^test\(\s*("(?:[^"\\]|\\.)*")\s*\)$/))) return [new RegExp(JSON.parse(m[1])).test(String(v))];
    if ((m = f.match(/^has\(\s*("(?:[^"\\]|\\.)*")\s*\)$/))) return [!!(v && typeof v === 'object' && JSON.parse(m[1]) in v)];
    if (f.startsWith('{') && f.endsWith('}')) {
      const obj = {};
      splitTop(f.slice(1, -1), ',').filter(Boolean).forEach((ent) => {
        const parts = splitTop(ent, ':');
        const key = parts[0].replace(/^"|"$/g, '');
        obj[key] = parts.length > 1 ? (jqRun(parts.slice(1).join(':'), [v])[0] ?? null) : (v && typeof v === 'object' ? (v[key] ?? null) : null);
      });
      return [obj];
    }
    if (f.startsWith('[') && f.endsWith(']')) return [f.length === 2 ? [] : jqRun(f.slice(1, -1), [v])];
    if (f.startsWith('.')) return jqPath(f, v);
    return jqErr(T('desteklenmeyen ifade: ', 'unsupported expression: ') + f);
  }
  const depthOk = (f) => { let d = 0; for (let k = 0; k < f.length - 1; k++) { if (f[k] === '(') d++; else if (f[k] === ')') d--; if (d === 0) return false; } return true; };
  function jqCond(c, v) {
    const ops = ['==', '!=', '>=', '<=', '>', '<'];
    for (const op of ops) {
      const i = topIndex(c, op);
      if (i > 0) {
        const L = jqRun(c.slice(0, i), [v])[0], R = jqRun(c.slice(i + op.length), [v])[0];
        switch (op) { case '==': return JSON.stringify(L) === JSON.stringify(R); case '!=': return JSON.stringify(L) !== JSON.stringify(R); case '>=': return L >= R; case '<=': return L <= R; case '>': return L > R; default: return L < R; }
      }
    }
    const r = jqRun(c, [v])[0];
    return r !== false && r != null;
  }
  function topIndex(src, op) { let d = 0, q = false; for (let k = 0; k < src.length; k++) { const ch = src[k]; if (q) { if (ch === '\\') k++; else if (ch === '"') q = false; continue; } if (ch === '"') q = true; else if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; else if (d === 0 && src.startsWith(op, k) && !(op.length === 1 && (src[k + 1] === '=' || src[k - 1] === '!' || src[k - 1] === '=' || src[k - 1] === '<' || src[k - 1] === '>'))) return k; } return -1; }
  function jqPath(f, v) {
    const re = /\.(?:([A-Za-z_][\w]*)|"((?:[^"\\]|\\.)*)")?|\[(\s*-?\d+\s*)?\]|\[\s*"((?:[^"\\]|\\.)*)"\s*\]|\?/gy;
    let cur = [v], m, i = 0;
    while (i < f.length) {
      re.lastIndex = i; m = re.exec(f);
      if (!m || m[0] === '') jqErr(T('yol çözülemedi: ', 'cannot parse path: ') + f.slice(i));
      i = re.lastIndex;
      if (m[0] === '?') continue;
      const key = m[1] != null ? m[1] : m[2] != null ? JSON.parse('"' + m[2] + '"') : m[4] != null ? JSON.parse('"' + m[4] + '"') : null;
      if (key != null) cur = cur.map((x) => (x == null ? null : typeof x === 'object' && !Array.isArray(x) ? (x[key] === undefined ? null : x[key]) : jqErr('cannot index ' + typeOf(x) + ' with "' + key + '"')));
      else if (m[3] != null) { const n = parseInt(m[3], 10); cur = cur.map((x) => (x == null ? null : Array.isArray(x) ? (x[n < 0 ? x.length + n : n] === undefined ? null : x[n < 0 ? x.length + n : n]) : jqErr('cannot index ' + typeOf(x) + ' with number'))); }
      else if (m[0].startsWith('[')) cur = cur.flatMap((x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : jqErr('cannot iterate over ' + typeOf(x))));
      // tek başına '.' (kimlik) → değişiklik yok
    }
    return cur;
  }
  function splitPipes(line) {
    const parts = []; let cur = '', q = null;
    for (const ch of line) { if (q) { cur += ch; if (ch === q) q = null; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === '|') { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    return parts.map((x) => x.trim());
  }
  async function pipe(segs) {
    if (segs.some((x) => !x)) return text(T("gsh: '|' yakınında sözdizimi hatası", "gsh: syntax error near unexpected token '|'"), 'r');
    const head = tokenize(segs[0]);
    if ((head[0] || '').toLowerCase() === 'logs' && head.includes('-f')) return text(T('logs -f boruyla kullanılamaz (sonsuz akış)', 'logs -f cannot be piped (endless stream)'), 'r');
    capture = [];
    let got;
    try { await exec(segs[0]); } finally { got = capture; capture = null; }
    let lines = got.flatMap((h) => plain(h).split('\n')).map((l) => l.replace(/\s+$/, ''));
    let mark = null, isJson = false;
    for (const seg of segs.slice(1)) {
      const a = tokenize(seg), name = (a.shift() || '').toLowerCase(), fn = FILTERS[name];
      if (!fn) return print(esc(name) + T(': boruda kullanılamaz. Filtreler: ', ': not usable in a pipe. Filters: ') + Object.keys(FILTERS).join(', '), 'r');
      const r = fn(lines, a);
      if (r.error) return text(name + ': ' + r.error, 'r');
      lines = r.lines; mark = r.mark || (name === 'grep' ? null : mark); isJson = !!r.json;
    }
    if (!lines.length) return;
    const show = (l) => { let h = esc(l); if (isJson) h = colorJson(h); else if (mark) { const g = new RegExp(mark.source, mark.flags.includes('i') ? 'gi' : 'g'); h = esc(l).replace(g, (x) => (x ? '<span class="hl">' + x + '</span>' : x)); } return h; };
    print(lines.slice(0, 400).map(show).concat(lines.length > 400 ? ['<span class="m">… ' + (lines.length - 400) + T(' satır daha', ' more lines') + '</span>'] : []));
  }

  // =================================================================== TAMAMLAMA
  const REDIS_CMDS = ['SET', 'GET', 'DEL', 'EXISTS', 'TTL', 'PTTL', 'EXPIRE', 'PERSIST', 'INCR', 'DECR', 'INCRBY', 'KEYS', 'DBSIZE', 'FLUSHALL', 'TYPE', 'INFO', 'PING', 'ECHO', 'HELP', 'QUIT'];
  const SQL_WORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'TOP', 'DISTINCT', 'JOIN', 'LEFT JOIN', 'ON', 'LIKE', 'IN', 'BETWEEN', 'IS NULL', 'AND', 'OR', 'AS', 'DESC',
    'COUNT(*)', 'SUM(', 'AVG(', 'MIN(', 'MAX(', 'STRING_AGG(', 'ROUND(', 'ISNULL(', 'UPPER(', 'LEN(',
    'experience', 'education', 'skills', 'posts', 'post_tags', 'pages', 'page_views', 'resources', 'logs', 'sim_requests', 'redis_keys', 'metrics', 'INFORMATION_SCHEMA.TABLES', 'INFORMATION_SCHEMA.COLUMNS', 'QUIT'];
  const COLLS = ['experience', 'education', 'skills', 'posts', 'post_tags', 'pages', 'page_views', 'resources', 'logs', 'sim_requests', 'redis_keys', 'metrics'];
  function mongoWords(last) {
    let m;
    if ((m = last.match(/^db\.(\w+)\.\w*$/))) return ['find(', 'findOne(', 'aggregate([', 'countDocuments()', 'distinct(\'', 'getIndexes()'].map((x) => 'db.' + m[1] + '.' + x);
    if (/^db\.\w*$/.test(last)) return COLLS.map((c) => 'db.' + c + '.').concat(['db.getCollectionNames()']);
    if (/\)\.\w*$/.test(last)) { const pre = last.slice(0, last.lastIndexOf('.') + 1); return ['sort({ ', 'limit(', 'skip(', 'count()', 'pretty()', 'toArray()'].map((x) => pre + x); }
    return ['db.', 'show collections', 'show dbs', 'use garage', 'help', 'it', 'exit'];
  }
  const ARG_HINTS = {
    open: Object.keys(TARGETS).concat(['1', '2', '3', '4']), cd: Object.keys(TARGETS),
    curl: ['/api/emre.json', '/api/stack.json', '/api/experience.json', '/api/posts.json', '/api/cv.json', '/api/health.json', '/api/index.json', '/api/openapi.json', '/api/en/emre.json', '/health', '/metrics', '/build.json', '/feed.xml', '-i', '-I'], get: ['/api/emre.json', '/health', '/metrics'],
    man: [], route: ['tanis', 'kurcala', 'next'], mongosh: ['--eval'], sqlcmd: ['-Q'],
    phase: ['sabah', 'gunduz', 'aksam', 'gece', 'auto'], logs: ['-f', 'info', 'warn', 'error'], lang: ['tr', 'en'], sound: ['on', 'off'],
    cat: ['hakkimda.md', 'iletisim.txt', 'cv.pdf', 'api/emre.json'], 'redis-cli': REDIS_CMDS
  };
  const FILTER_HINTS = { grep: ['-i', '-v', '-c', '-n'], wc: ['-l', '-w', '-c'], head: ['-n'], tail: ['-n'], sort: ['-r', '-n', '-u'], uniq: ['-c'], cut: ['-d', '-f'], jq: ["'.'", "'keys'", "'length'", '-r', '-c'] };
  function complete() {
    const v = input.value;
    const segStart = mode === 'sh' ? v.lastIndexOf('|') + 1 : 0;
    const seg = v.slice(segStart).replace(/^\s+/, ''), parts = seg.split(/\s+/), last = parts[parts.length - 1], first = parts.length === 1, piped = segStart > 0;
    let pool;
    if (mode === 'redis') pool = first ? REDIS_CMDS : [];
    else if (mode === 'sql') pool = SQL_WORDS;
    else if (mode === 'mongo') pool = mongoWords(last);
    else if (piped) pool = first ? Object.keys(FILTERS) : (FILTER_HINTS[parts[0].toLowerCase()] || []);
    else pool = first ? Object.keys(CMDS).concat(Object.keys(EXTRA())).filter((k, i, a) => a.indexOf(k) === i && k !== 'GET') : parts[0].toLowerCase() === 'man' ? Object.keys(MAN) : (ARG_HINTS[parts[0].toLowerCase()] || []);
    const hits = pool.filter((x) => x.toLowerCase().startsWith(last.toLowerCase()));
    const base = v.slice(0, v.length - last.length);
    if (hits.length === 1) input.value = base + hits[0] + (/[.(\[{' ]$/.test(hits[0]) ? '' : ' ');
    else if (hits.length > 1) {
      let pre = hits[0]; hits.forEach((h) => { while (!h.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1); });
      if (pre.length > last.length) input.value = base + pre;
      else print('<span class="m">' + hits.slice(0, 30).map(esc).join('  ') + '</span>');
    }
  }

  // =================================================================== ÇALIŞTIR
  async function run(raw) {
    const line = raw.trim();
    print('<span class="g">' + esc(promptText()) + '</span> ' + esc(raw));
    if (!line) return;
    if (!hist.length || hist[hist.length - 1] !== line) { hist.push(line); if (hist.length > 80) hist = hist.slice(-80); G.store.setJson('garage-term-history', hist); }
    hIdx = hist.length;
    G.metrics.inc('garage_terminal_commands_total', { mode });
    if (mode === 'redis') { redis(tokenize(line)); return; }
    if (mode === 'sql') { await sql(line); return; }
    if (mode === 'mongo') { await mongo(raw); return; }
    const segs = splitPipes(line);
    if (segs.length > 1) { busy = true; abort = {}; try { await pipe(segs); } catch (e) { capture = null; text(String(e.message || e), 'r'); } busy = false; return; }
    await exec(line);
  }
  async function exec(line) {
    const args = tokenize(line);
    const name = args.shift();
    const key = name.toLowerCase();
    const cmd = CMDS[name] || CMDS[key];
    G.log('debug', '$ ' + line.slice(0, 80), {});
    if (/^rm$/i.test(key) && /-rf?\s*\/?/.test(line)) return text(T('rm: garaj korumalı bir dosya sistemi. Güzel deneme.', 'rm: this garage is a protected filesystem. Nice try.'), 'c');
    if (cmd) {
      busy = true; abort = {};
      try { const r = await cmd.run(args, line); if (r !== 'follow') busy = false; }
      catch (e) { stderr(esc(String(e.message || e)), 'r'); G.log('error', 'terminal: ' + (e.message || e), { cmd: key }); busy = false; }
      return;
    }
    const extra = EXTRA()[key];
    if (extra) { print(extra(G.lang(), args)); return; }
    stderr(esc(name) + T(': komut bulunamadı. <span class="hl">help</span> yaz.', ': command not found. Type <span class="hl">help</span>.'), 'm');
  }

  // =================================================================== ARAYÜZ
  function renderChips() {
    if (!chips) return;
    const sets = {
      sh: ['help', 'map', 'whoami', "curl /api/stack.json | jq '.drawers[].name'", 'logs | grep -c info', 'sqlcmd', 'mongosh', 'redis-cli', 'top', 'neofetch'],
      redis: ['KEYS *', 'DBSIZE', 'SET demo merhaba EX 30', 'TTL demo', 'INFO', 'QUIT'],
      sql: ['SELECT * FROM skills', "SELECT name, note FROM skills WHERE category = 'data'", 'SELECT category, COUNT(*) AS n FROM skills GROUP BY category', 'SELECT TOP 5 page, load_ms FROM page_views ORDER BY load_ms DESC', 'SELECT * FROM INFORMATION_SCHEMA.TABLES', 'QUIT'],
      mongo: ['show collections', "db.skills.find({ category: 'data' }, { _id: 0, name: 1 })", "db.posts.aggregate([{ $unwind: '$tags' }, { $sortByCount: '$tags' }])", 'db.page_views.countDocuments()', 'help', 'exit']
    };
    chips.innerHTML = sets[mode].map((c) => '<button type="button" class="term-chip">' + esc(c) + '</button>').join('');
  }
  function build() {
    root = document.createElement('div');
    root.className = 'overlay term-overlay';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Terminal');
    root.hidden = true;
    root.innerHTML =
      '<div class="term-window">' +
        '<div class="term-bar"><span class="tl r"></span><span class="tl y"></span><span class="tl g"></span><span class="term-title">emre@garage: ~</span>' +
        '<button class="term-x" type="button" aria-label="' + T('Terminali kapat', 'Close terminal') + '">' + G.icon('x') + '</button></div>' +
        '<div class="term-out" aria-live="polite"></div>' +
        '<div class="term-chips"></div>' +
        '<form class="term-form" autocomplete="off"><label for="termIn">emre@garage:~$</label><input id="termIn" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" enterkeyhint="go"></form>' +
      '</div>';
    out = root.querySelector('.term-out'); input = root.querySelector('input'); label = root.querySelector('label'); chips = root.querySelector('.term-chips');
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.querySelector('.term-x').addEventListener('click', close);
    root.querySelector('.term-out').addEventListener('mouseup', () => { if (!window.getSelection().toString()) input.focus(); });
    chips.addEventListener('click', (e) => { const b = e.target.closest('.term-chip'); if (!b) return; input.value = b.textContent; submit(); });
    root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    input.addEventListener('input', () => G.sfx('key'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); complete(); }
      else if (e.key === 'ArrowUp') { if (hIdx > 0) { hIdx--; input.value = hist[hIdx]; } e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hIdx = Math.min(hist.length, hIdx + 1); input.value = hist[hIdx] || ''; e.preventDefault(); }
      else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); out.innerHTML = ''; }
      else if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !window.getSelection().toString()) { e.preventDefault(); if (abort) abort.stop = true; stopFollow(); busy = false; input.value = ''; }
      else if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); input.value = ''; }
    });
    renderChips();
  }
  function submit() { const v = input.value; input.value = ''; if (follow) stopFollow(); run(v); }
  function open(cmd) {
    if (!root) build();
    if (G.topLayer && G.topLayer() === root) { input.focus(); if (cmd) { input.value = cmd; submit(); } return; }
    G.openLayer(root, input);
    G.sfx('click');
    if (!greeted) {
      greeted = true;
      const d = new Date();
      print([
        '<span class="c">GarageOS 1.0</span> — emre@garage (tty1)',
        '<span class="m">' + T('Son giriş: ', 'Last login: ') + d.toLocaleDateString(G.lang() === 'en' ? 'en-GB' : 'tr-TR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + G.localTime() + ' · ' + esc(G.city) + '</span>',
        T('Komutlar için <span class="hl">help</span> yaz. Tab tamamlar, ↑↓ geçmiş, Ctrl+L temizler.', 'Type <span class="hl">help</span> for commands. Tab completes, ↑↓ history, Ctrl+L clears.'), ''
      ]);
    }
    if (cmd) { input.value = cmd; submit(); }
  }
  function close() { stopFollow(); if (root) G.closeLayer(root); }
  document.addEventListener('garage:lang', renderChips);

  window.GarageTerminal = { open, close, run };
})();
