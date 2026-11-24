// Garage — Veri Odası (veri.js)
// Sitenin içeriği ve bu ziyaretin ölçümleri üzerinde salt okunur iki dil: GarageSQL (T-SQL alt kümesi) ve mongosh.
// Motor query.js'te (window.GarageQuery; eval yok, elle yazılmış ayrıştırıcılar). Bu dosyada: renklendirmeli
// düzenleyici, satır numaraları, otomatik tamamlama, nesne gezgini, sonuç ızgarası, mesajlar, grafik,
// örnek sorgular ve paylaşılabilir bağlantı (#sql=… / #mongo=…).
(function () {
  'use strict';
  const G = window.GARAGE, Q = window.GarageQuery;
  const $ = (id) => document.getElementById(id);
  const root = $('db');
  if (!G || !Q || !root) return;
  const esc = G.esc, T = (tr, en) => G.t(tr, en);
  const input = $('dbInput'), hlCode = $('dbHl'), gutter = $('dbGutter'), acEl = $('dbAc');
  const pane = $('dbPane'), statusEl = $('dbStatus'), tree = $('dbTree'), treeBtn = $('dbTreeBtn'), treeCount = $('dbTreeCount');
  const runBtn = $('dbRun'), exBtn = $('dbExBtn'), exMenu = $('dbExMenu'), chartBtn = $('dbChartBtn'), connEl = $('dbConn'), linkBtn = $('dbLink');
  const langBtns = [...root.querySelectorAll('.db-lang [data-lang]')];
  const tabBtns = [...root.querySelectorAll('.db-tabs [data-tab]')];
  const copyBtns = [...root.querySelectorAll('[data-copy-res]')];
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const MOD = MAC ? '⌘' : 'Ctrl';
  const locale = () => (G.lang() === 'en' ? 'en-US' : 'tr-TR');
  const fmtN = (n) => Number(n).toLocaleString(locale(), { maximumFractionDigits: 2 });
  const fmtMs = (ms) => (ms < 1 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : String(Math.round(ms))) + ' ms';
  const fold = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase();
  const pick = (v) => (Array.isArray(v) ? T(v[0], v[1]) : v);

  // =================================================================== ÖRNEKLER
  const EX = {
    sql: [
      { t: ['Takım çantası: çekmeceye göre', 'Toolbox: by drawer'], s: 'GROUP BY · STRING_AGG', q: "SELECT category, COUNT(*) AS tools, STRING_AGG(name, ', ') AS names\nFROM skills\nGROUP BY category\nORDER BY tools DESC;" },
      { t: ['İş deneyimi', 'Work experience'], s: 'ISNULL · [end]', q: ["SELECT role, company, team, start, ISNULL([end], 'devam ediyor') AS [end]\nFROM experience;", "SELECT role, company, team, start, ISNULL([end], 'ongoing') AS [end]\nFROM experience;"] },
      { t: ['Bu ziyarette en yavaş sayfalar', 'Slowest pages this visit'], s: 'TOP · ORDER BY', q: 'SELECT TOP 5 page, load_ms, ttfb_ms, transfer_kb\nFROM page_views\nORDER BY load_ms DESC;' },
      { t: ['Gezdiğin sayfalar ve rotaları', 'Pages you visited and their routes'], s: 'JOIN · AVG', q: 'SELECT p.title, p.route, COUNT(*) AS views, AVG(v.load_ms) AS avg_load_ms\nFROM page_views v\nJOIN pages p ON p.page = v.page\nGROUP BY p.title, p.route\nORDER BY views DESC;' },
      { t: ['En ağır dosyalar', 'Heaviest files'], s: 'Resource Timing · MAX', q: 'SELECT TOP 10 name, type, MAX(size_kb) AS size_kb\nFROM resources\nGROUP BY name, type\nORDER BY size_kb DESC;' },
      { t: ['Şema: önbellek isabeti', 'Blueprint: cache hits'], s: 'GROUP BY · ROUND', q: 'SELECT cache, COUNT(*) AS requests, ROUND(AVG(total_ms), 1) AS avg_ms\nFROM sim_requests\nGROUP BY cache\nORDER BY requests DESC;' },
      { t: ['Şema: hata veren istekler', 'Blueprint: failed requests'], s: 'WHERE status >= 500', q: 'SELECT ts, method, path, status, total_ms\nFROM sim_requests\nWHERE status >= 500\nORDER BY ts DESC;' },
      { t: ['Son uyarı ve hata logları', 'Latest warnings and errors'], s: "IN ('warn', 'error')", q: "SELECT TOP 20 ts, level, page, msg\nFROM logs\nWHERE level IN ('warn', 'error')\nORDER BY ts DESC;" },
      { t: ['Etiketlere göre yazılar', 'Posts by tag'], s: 'post_tags · GROUP BY', q: 'SELECT tag, COUNT(*) AS posts\nFROM post_tags\nGROUP BY tag\nORDER BY posts DESC, tag;' },
      { t: ['Veritabanını keşfet', 'Explore the database'], s: 'INFORMATION_SCHEMA', q: 'SELECT TABLE_NAME, COUNT(*) AS columns\nFROM INFORMATION_SCHEMA.COLUMNS\nGROUP BY TABLE_NAME\nORDER BY TABLE_NAME;' }
    ],
    mongo: [
      { t: ['Takım çantası: veri çekmecesi', 'Toolbox: the data drawer'], s: 'find · projection', q: "db.skills.find({ category: 'data' }, { _id: 0, name: 1, note: 1 })" },
      { t: ['Yavaş açılan sayfalar', 'Slow page loads'], s: '$gt · sort', q: 'db.page_views.find({ load_ms: { $gt: 300 } }, { _id: 0, page: 1, load_ms: 1, viewed_at: 1 })\n  .sort({ load_ms: -1 })' },
      { t: ['Şema istekleri: duruma göre', 'Blueprint requests by status'], s: '$group · $avg', q: "db.sim_requests.aggregate([\n  { $group: { _id: '$status', requests: { $sum: 1 }, avg_ms: { $avg: '$total_ms' } } },\n  { $sort: { requests: -1 } }\n])" },
      { t: ['Uyarı ve hata logları', 'Warning and error logs'], s: '$in · limit', q: "db.logs.find({ level: { $in: ['warn', 'error'] } }, { _id: 0, ts: 1, level: 1, page: 1, msg: 1 })\n  .sort({ ts: -1 })\n  .limit(10)" },
      { t: ['Etiket sayıları', 'Tag counts'], s: '$unwind · $sortByCount', q: "db.posts.aggregate([\n  { $unwind: '$tags' },\n  { $sortByCount: '$tags' }\n])" },
      { t: ['Görüntülemeler ve sayfa adları', 'Views with page titles'], s: '$lookup · $first', q: "db.page_views.aggregate([\n  { $lookup: { from: 'pages', localField: 'page', foreignField: 'page', as: 'p' } },\n  { $project: { _id: 0, title: { $first: '$p.title' }, load_ms: 1, viewed_at: 1 } },\n  { $sort: { viewed_at: -1 } },\n  { $limit: 10 }\n])" },
      { t: ['Yazılar', 'Posts'], s: 'find · sort', q: 'db.posts.find({}, { _id: 0, title: 1, date: 1, tags: 1 }).sort({ date: -1 })' },
      { t: ['Adında “net” geçen teknolojiler', 'Technologies with “net” in the name'], s: 'regex /net/i', q: 'db.skills.find({ name: /net/i }, { _id: 0, name: 1, drawer: 1 })' },
      { t: ['Prometheus sayaçları', 'Prometheus counters'], s: "type: 'counter'", q: "db.metrics.find({ type: 'counter' }, { _id: 0, name: 1, labels: 1, value: 1 })\n  .sort({ value: -1 })" },
      { t: ['Koleksiyonlar', 'Collections'], s: 'show collections', q: 'show collections' }
    ]
  };
  const DEF = {
    sql: () => T('-- Veri Odası · GarageSQL (salt okunur)\n-- Çalıştır: ' + MOD + '+Enter · tablolar solda, örnekler yukarıda\n', '-- Data Room · GarageSQL (read-only)\n-- Run: ' + MOD + '+Enter · tables on the left, examples above\n') + EX.sql[0].q,
    mongo: () => T('// Veri Odası · mongosh (salt okunur)\n// Çalıştır: ' + MOD + '+Enter · koleksiyonlar solda, örnekler yukarıda\n', '// Data Room · mongosh (read-only)\n// Run: ' + MOD + '+Enter · collections on the left, examples above\n') +
      'db.page_views.find({}, { _id: 0, page: 1, load_ms: 1, viewed_at: 1 })\n  .sort({ viewed_at: -1 })\n  .limit(10)'
  };

  // =================================================================== DURUM
  let lang = 'sql';
  let posts = [], catalog = null;
  let out = null;            // son çalıştırma
  let tab = 'grid', docView = 'docs', chartMeasure = null;
  const mstate = { db: 'garage' };
  const openTables = new Set();
  const qKey = (l) => 'garage-db-q-' + l;
  const rebuild = () => { catalog = Q.build(G, posts); return catalog; };

  // =================================================================== RENKLENDİRME
  const SQL_KW = new Set('SELECT FROM WHERE GROUP BY HAVING ORDER ASC DESC TOP LIMIT DISTINCT AS AND OR NOT IN IS NULL LIKE BETWEEN JOIN INNER LEFT RIGHT FULL OUTER ON CROSS USE GO EXEC EXECUTE INSERT UPDATE DELETE INTO VALUES SET DROP CREATE ALTER TABLE TRUNCATE CASE WHEN THEN ELSE END UNION ALL WITH OFFSET FETCH NEXT ROWS ONLY'.split(' '));
  const SQL_FN = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG', 'UPPER', 'LOWER', 'LEN', 'TRIM', 'LTRIM', 'RTRIM', 'ABS', 'ROUND', 'CEILING', 'FLOOR', 'COALESCE', 'ISNULL', 'CONCAT', 'SUBSTRING', 'LEFT', 'RIGHT', 'REPLACE', 'YEAR', 'MONTH', 'DAY', 'GETDATE', 'SYSDATETIME', 'DATEDIFF', 'CAST'];
  const SQL_FNS = new Set(SQL_FN);
  const span = (c, s) => '<span class="' + c + '">' + esc(s) + '</span>';
  const isTable = (w) => catalog && catalog.tables.some((t) => fold(t.name) === fold(w));
  function hlSql(src) {
    const re = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|(\[[^\]\n]*\]?)|(\b\d+(?:\.\d+)?\b)|(@@?[\w]+)|([A-Za-z_À-ɏ][\wÀ-ɏ]*)|([\s\S])/g;
    let o = '', m;
    while ((m = re.exec(src))) {
      if (m[1]) o += span('c', m[1]);
      else if (m[2]) o += span('s', m[2]);
      else if (m[3]) o += esc(m[3]);
      else if (m[4]) o += span('n', m[4]);
      else if (m[5]) o += span('b', m[5]);
      else if (m[6]) {
        const w = m[6], up = w.toUpperCase();
        if (SQL_FNS.has(up) && /^\s*\(/.test(src.slice(re.lastIndex))) o += span('f', w);
        else if (SQL_KW.has(up)) o += span('k', w);
        else if (/^(sp_help|sp_tables|INFORMATION_SCHEMA|sys)$/i.test(w)) o += span('b', w);
        else if (isTable(w)) o += span('t', w);
        else o += esc(w);
      } else o += esc(m[7]);
    }
    return o;
  }
  const M_METHODS = ['find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'getIndexes', 'stats', 'sort', 'limit', 'skip', 'count', 'pretty', 'toArray', 'getCollectionNames', 'getName', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'drop'];
  const M_SET = new Set(M_METHODS);
  function hlMongo(src) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?)|(\/(?![*/\s])(?:[^/\\\n[]|\\.|\[[^\]\n]*\])+\/[gimsuy]*)|(\$\$?[A-Za-z_][\w.]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|([\s\S])/g;
    let o = '', m, prevDb = false;
    while ((m = re.exec(src))) {
      if (m[1]) o += span('c', m[1]);
      else if (m[2]) o += span('s', m[2]);
      else if (m[3]) o += span('r', m[3]);
      else if (m[4]) o += span('o', m[4]);
      else if (m[5]) o += span('n', m[5]);
      else if (m[6]) {
        const w = m[6], after = src.slice(re.lastIndex);
        if (w === 'db') { o += span('k', w); prevDb = true; continue; }
        if (/^(true|false|null|undefined)$/.test(w)) o += span('v', w);
        else if (/^(ISODate|ObjectId|NumberInt|NumberLong|Date|new|show|use)$/.test(w)) o += span('b', w);
        else if (M_SET.has(w) && /^\s*\(/.test(after)) o += span('f', w);
        else if (prevDb && isTable(w)) o += span('t', w);
        else o += esc(w);
      } else o += esc(m[7]);
      if (!m[7] || m[7] !== '.') prevDb = false;
    }
    return o;
  }

  // =================================================================== DÜZENLEYİCİ
  const gIn = document.createElement('div');
  gIn.className = 'g-in';
  gutter.textContent = '';
  gutter.appendChild(gIn);
  let lineCount = 0, metrics = null;
  function em() {   // satır yüksekliği, dolgu, karakter genişliği (eş aralıklı yazı)
    if (metrics) return metrics;
    const cs = getComputedStyle(input);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    metrics = { lh: parseFloat(cs.lineHeight) || 21, pt: parseFloat(cs.paddingTop) || 12, pl: parseFloat(cs.paddingLeft) || 14, cw: c.measureText('MMMMMMMMMM').width / 10 || 8 };
    return metrics;
  }
  const remeasure = () => { metrics = null; lineCount = 0; sync(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  matchMedia('(max-width: 600px)').addEventListener('change', remeasure);
  function sync() {
    const v = input.value;
    hlCode.innerHTML = (lang === 'sql' ? hlSql(v) : hlMongo(v)) + '\n';
    const n = v.split('\n').length;
    if (n !== lineCount) {
      lineCount = n;
      let h = ''; for (let k = 1; k <= n; k++) h += '<span>' + k + '</span>';
      gIn.innerHTML = h;
      const m = em();
      input.style.height = Math.round(Math.min(18, Math.max(7, n)) * m.lh + m.pt * 2 + 14) + 'px';
    }
    markLine();
    syncScroll();
  }
  function syncScroll() {
    hlCode.style.transform = 'translate(' + -input.scrollLeft + 'px,' + -input.scrollTop + 'px)';
    gIn.style.transform = 'translateY(' + -input.scrollTop + 'px)';
  }
  let curLine = -1;
  function markLine() {
    const ln = input.value.slice(0, input.selectionStart).split('\n').length - 1;
    if (ln === curLine && gIn.children[ln] && gIn.children[ln].classList.contains('on')) return;
    if (gIn.children[curLine]) gIn.children[curLine].classList.remove('on');
    curLine = ln;
    if (gIn.children[ln]) gIn.children[ln].classList.add('on');
  }
  // Geri alınabilir ekleme (execCommand tarayıcının geri al yığınını korur)
  function insertText(text, from, to) {
    input.focus();
    if (from != null) input.setSelectionRange(from, to);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) { input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end'); sync(); }
  }
  function setCode(text, keepUndo) {
    if (keepUndo) { insertText(text, 0, input.value.length); }
    else { input.value = text; sync(); }
    input.scrollTop = 0; input.scrollLeft = 0; syncScroll();
  }

  // =================================================================== OTOMATİK TAMAMLAMA
  const AC = { open: false, items: [], idx: 0, from: 0, to: 0 };
  const KIND = { k: 'K', f: 'ƒ', t: 'T', c: 'C', m: 'm', o: '$', p: '•', b: 'B' };
  const KIND_NAME = { k: ['anahtar sözcük', 'keyword'], f: ['fonksiyon', 'function'], t: ['tablo', 'table'], c: ['sütun', 'column'], m: ['metot', 'method'], o: ['operatör', 'operator'], p: ['alan', 'field'], b: ['yerleşik', 'built-in'] };
  const M_OPS = [
    ['$match', 'stage'], ['$group', 'stage'], ['$project', 'stage'], ['$sort', 'stage'], ['$limit', 'stage'], ['$skip', 'stage'], ['$unwind', 'stage'], ['$lookup', 'stage'], ['$count', 'stage'], ['$sortByCount', 'stage'], ['$addFields', 'stage'], ['$set', 'stage'], ['$unset', 'stage'],
    ['$eq', 'query'], ['$ne', 'query'], ['$gt', 'query'], ['$gte', 'query'], ['$lt', 'query'], ['$lte', 'query'], ['$in', 'query'], ['$nin', 'query'], ['$exists', 'query'], ['$regex', 'query'], ['$options', 'query'], ['$size', 'query'], ['$all', 'query'], ['$elemMatch', 'query'], ['$not', 'query'], ['$type', 'query'], ['$and', 'query'], ['$or', 'query'], ['$nor', 'query'], ['$expr', 'query'],
    ['$sum', 'acc'], ['$avg', 'acc'], ['$min', 'acc'], ['$max', 'acc'], ['$first', 'acc'], ['$last', 'acc'], ['$push', 'acc'], ['$addToSet', 'acc'],
    ['$concat', 'expr'], ['$toUpper', 'expr'], ['$toLower', 'expr'], ['$add', 'expr'], ['$subtract', 'expr'], ['$multiply', 'expr'], ['$divide', 'expr'], ['$round', 'expr'], ['$ifNull', 'expr'], ['$arrayElemAt', 'expr'], ['$substr', 'expr'], ['$split', 'expr'], ['$year', 'expr'], ['$month', 'expr'], ['$cond', 'expr'], ['$toString', 'expr'], ['$dateToString', 'expr'], ['$literal', 'expr']
  ];
  const OP_NAME = { stage: ['aşama', 'stage'], query: ['sorgu', 'query'], acc: ['toplayıcı', 'accumulator'], expr: ['ifade', 'expression'] };
  function inStrOrComment(before) {
    // Satırdaki konum: yorum ya da kapanmamış metin içinde mi?
    let q = null;
    for (let k = 0; k < before.length; k++) {
      const ch = before[k];
      if (q) { if (ch === '\\' && lang === 'mongo') { k++; continue; } if (ch === q) q = null; continue; }
      if (lang === 'sql' && ch === '-' && before[k + 1] === '-') { const e = before.indexOf('\n', k); if (e < 0) return 'c'; k = e; continue; }
      if (lang === 'mongo' && ch === '/' && before[k + 1] === '/') { const e = before.indexOf('\n', k); if (e < 0) return 'c'; k = e; continue; }
      if (ch === '/' && before[k + 1] === '*') { const e = before.indexOf('*/', k + 2); if (e < 0) return 'c'; k = e + 1; continue; }
      if (ch === "'" || (lang === 'mongo' && ch === '"')) q = ch;
    }
    return q ? 's' : null;
  }
  function aliasMap(text) {
    const map = {};
    const re = /\b(?:FROM|JOIN)\s+([\w.]+)(?:\s+(?:AS\s+)?(?!(?:ON|WHERE|JOIN|INNER|LEFT|CROSS|GROUP|ORDER|HAVING|LIMIT)\b)([A-Za-z_]\w*))?/gi;
    let m;
    while ((m = re.exec(text))) { const t = tableOf(m[1]); if (t) { map[fold(t.name)] = t; if (m[2]) map[fold(m[2])] = t; } }
    return map;
  }
  const tableOf = (name) => catalog && catalog.tables.find((t) => fold(t.name) === fold(String(name).replace(/^dbo\./i, '')));
  const colItems = (t) => t.cols.map(([n, ty]) => ({ label: n, kind: 'c', detail: t.name + ' · ' + ty }));
  function sqlCtx(before) {
    const m = before.match(/(?:([\wÀ-ɏ]+)\.)?([\wÀ-ɏ@#]*)$/);
    const qual = m[1], prefix = m[2];
    if (qual) {
      if (/^information_schema$/i.test(qual)) return { prefix, trigger: true, items: [{ label: 'TABLES', kind: 'b', detail: 'view' }, { label: 'COLUMNS', kind: 'b', detail: 'view' }] };
      if (/^sys$/i.test(qual)) return { prefix, trigger: true, items: [{ label: 'tables', kind: 'b', detail: 'view' }] };
      const t = aliasMap(input.value)[fold(qual)] || tableOf(qual);
      return t ? { prefix, trigger: true, items: colItems(t) } : null;
    }
    const head = before.slice(0, before.length - prefix.length);
    const tables = catalog.tables.map((t) => ({ label: t.name, kind: 't', detail: t.desc }));
    if (/\b(FROM|JOIN)\s+$/i.test(head) || /\bsp_help\s+$/i.test(head)) return { prefix, trigger: /\s$/.test(head) && !prefix ? false : true, items: tables.concat([{ label: 'INFORMATION_SCHEMA', kind: 'b', detail: 'schema' }]) };
    if (!prefix) return null;
    const used = Object.values(aliasMap(input.value)).filter((t, k, a) => a.indexOf(t) === k);
    const cols = (used.length ? used : catalog.tables).reduce((a, t) => a.concat(colItems(t)), []);
    const fns = SQL_FN.map((f) => ({ label: f, kind: 'f', insert: f + '(', detail: T('fonksiyon', 'function') }));
    const kws = [...SQL_KW].filter((k) => k.length > 2).map((k) => ({ label: k, kind: 'k', insert: k, detail: T('anahtar sözcük', 'keyword') }));
    return { prefix, items: cols.concat(fns, kws, tables) };
  }
  function collOf(text) { const all = [...text.matchAll(/\bdb\.(\w+)/g)].map((x) => x[1]).filter((n) => tableOf(n)); return all.length ? tableOf(all[all.length - 1]) : null; }
  function mongoFields(t) { return ['_id'].concat(t.cols.map((c) => c[0])); }
  function mongoCtx(before, where) {
    let m;
    const stmt = before.slice(Math.max(before.lastIndexOf('\ndb.'), 0));
    if (where === 's') {
      if ((m = before.match(/(['"])(\$[\w.]*)$/))) { const t = collOf(stmt) || collOf(before); if (!t) return null; return { prefix: m[2], trigger: true, items: mongoFields(t).map((f) => ({ label: '$' + f, kind: 'p', detail: t.name })) }; }
      return null;
    }
    if ((m = before.match(/\bdb\.(\w+)\.(\w*)$/)) && tableOf(m[1])) return { prefix: m[2], trigger: true, items: ['find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'getIndexes', 'stats'].map((x) => ({ label: x, kind: 'm', insert: x + (x === 'aggregate' ? '([' : '('), detail: T('koleksiyon', 'collection') })) };
    if ((m = before.match(/\bdb\.(\w*)$/))) return { prefix: m[1], trigger: true, items: catalog.tables.map((t) => ({ label: t.name, kind: 't', detail: fmtN(t.docs.length) + T(' belge', ' docs') })).concat(['getCollectionNames', 'getName'].map((x) => ({ label: x, kind: 'm', insert: x + '()', detail: 'db' }))) };
    if ((m = before.match(/\)\s*\.(\w*)$/))) return { prefix: m[1], trigger: true, items: ['sort', 'limit', 'skip', 'count', 'pretty', 'toArray'].map((x) => ({ label: x, kind: 'm', insert: x + (x === 'sort' ? '({ ' : '('), detail: T('imleç', 'cursor') })) };
    if ((m = before.match(/(?:^|[^\w$])(\$\w*)$/))) {
      const agg = /aggregate\(\s*\[/.test(stmt) && !/\]\s*\)/.test(stmt.slice(stmt.lastIndexOf('aggregate(')));
      const order = agg ? ['stage', 'acc', 'expr', 'query'] : ['query', 'expr', 'stage', 'acc'];
      const ops = M_OPS.slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]));
      return { prefix: m[1], trigger: true, items: ops.map(([op, k]) => ({ label: op, kind: 'o', detail: T(OP_NAME[k][0], OP_NAME[k][1]) })) };
    }
    if ((m = before.match(/([{,]\s*)(\w+)$/)) && m[2]) {
      const t = collOf(stmt) || collOf(before); if (!t) return null;
      return { prefix: m[2], items: mongoFields(t).map((f) => ({ label: f, kind: 'p', detail: t.name })) };
    }
    if ((m = before.match(/(?:^|\n)\s*(\w+)$/)) && m[1]) return { prefix: m[1], items: [{ label: 'db', kind: 'k', insert: 'db.', detail: 'garage' }, { label: 'show collections', kind: 'b', detail: 'shell' }, { label: 'show dbs', kind: 'b', detail: 'shell' }, { label: 'use garage', kind: 'b', detail: 'shell' }] };
    return null;
  }
  function acUpdate(force) {
    if (input.selectionStart !== input.selectionEnd || !catalog) return acClose();
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    const where = inStrOrComment(before);
    if (where === 'c' || (where === 's' && lang === 'sql')) return acClose();
    const ctx = lang === 'sql' ? sqlCtx(before) : mongoCtx(before, where);
    if (!ctx || (!force && !ctx.prefix && !ctx.trigger)) return acClose();
    const p = fold(ctx.prefix);
    const seen = new Set();
    const items = ctx.items.filter((it) => { const k = it.kind + it.label; if (seen.has(k) || !fold(it.label).startsWith(p)) return false; seen.add(k); return true; }).slice(0, 8);
    if (!items.length || (!force && items.length === 1 && fold(items[0].label) === p)) return acClose();
    Object.assign(AC, { open: true, items, idx: 0, from: pos - ctx.prefix.length, to: pos });
    acEl.innerHTML = items.map((it, k) => '<li role="option" id="dbAc' + k + '" data-k="' + k + '" aria-selected="' + (k === 0) + '"><span class="ak ' + it.kind + '" title="' + esc(T(KIND_NAME[it.kind][0], KIND_NAME[it.kind][1])) + '">' + KIND[it.kind] + '</span><b>' + esc(it.label) + '</b><small>' + esc(it.detail || '') + '</small></li>').join('');
    acEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', 'dbAc0');
    // İmlecin altına yerleştir
    const lines = before.split('\n'), ln = lines.length - 1, col = lines[ln].length - ctx.prefix.length;
    const m = em(), boxW = input.clientWidth;
    const w = Math.min(acEl.offsetWidth || 280, boxW - 8);
    const x = Math.max(4, Math.min(m.pl + col * m.cw - input.scrollLeft, boxW - w - 4));
    const y = m.pt + (ln + 1) * m.lh - input.scrollTop + 2;
    acEl.style.left = x + 'px';
    acEl.style.top = Math.max(4, y) + 'px';
  }
  function acMove(d) {
    if (!AC.open) return;
    const lis = acEl.children;
    lis[AC.idx].setAttribute('aria-selected', 'false');
    AC.idx = (AC.idx + d + AC.items.length) % AC.items.length;
    lis[AC.idx].setAttribute('aria-selected', 'true');
    lis[AC.idx].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', 'dbAc' + AC.idx);
  }
  function acAccept(k) {
    const it = AC.items[k == null ? AC.idx : k]; if (!it) return;
    const from = AC.from, to = AC.to;
    acClose();
    insertText(it.insert || it.label, from, to);
  }
  function acClose() {
    if (!AC.open && acEl.hidden) return;
    AC.open = false; acEl.hidden = true; acEl.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  acEl.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (!li) return; e.preventDefault(); acAccept(+li.dataset.k); });

  // Klavye: çalıştır, girinti, öneri, odaktan çıkış
  let tabEscape = false;
  input.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if ((mod && e.key === 'Enter') || e.key === 'F5') { e.preventDefault(); acClose(); run(); return; }
    if (mod && (e.key === ' ' || e.code === 'Space')) { e.preventDefault(); acUpdate(true); return; }
    if (AC.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acClose(); tabEscape = true; return; }
    }
    if (e.key === 'Escape') { tabEscape = true; e.stopPropagation(); return; }
    if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey) {
      if (tabEscape) { tabEscape = false; return; }   // Esc sonrası Tab: odaktan çık
      e.preventDefault(); insertText('  '); return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey) {
      const pos = input.selectionStart, line = input.value.slice(0, pos).split('\n').pop();
      const ind = (line.match(/^\s*/) || [''])[0] + (/[{[(]\s*$/.test(line) ? '  ' : '');
      e.preventDefault(); insertText('\n' + ind); return;
    }
    tabEscape = false;
  });
  input.addEventListener('input', () => { sync(); acUpdate(false); });
  input.addEventListener('scroll', () => { syncScroll(); if (AC.open) acClose(); });
  ['keyup', 'click', 'select'].forEach((ev) => input.addEventListener(ev, (e) => { markLine(); if (ev === 'click') acClose(); if (ev === 'keyup' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) acClose(); }));
  input.addEventListener('blur', () => setTimeout(acClose, 120));
  let saveT = 0;
  input.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => G.store.sset(qKey(lang), input.value), 400); });

  // =================================================================== NESNE GEZGİNİ
  function mongoType(t, name) {
    const d = t.docs.find((x) => x[name] != null); const v = d ? d[name] : null;
    if (v == null) return 'null';
    if (v instanceof Date) return 'date';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
    if (typeof v === 'object') return v.$oid ? 'ObjectId' : 'object';
    return typeof v;
  }
  function renderTree() {
    if (!catalog) return;
    const mongo = lang === 'mongo';
    const total = catalog.tables.reduce((n, t) => n + t.docs.length, 0);
    const group = (g, title, live) => '<div class="dt-g"><p class="dt-gh mono">' + (live ? '<span class="live" aria-hidden="true"></span>' : '') + esc(title) + '</p><ul class="dt-list">' +
      catalog.tables.filter((t) => t.group === g).map((t) => {
        const open = openTables.has(t.name);
        const cols = (mongo ? [['_id', 'ObjectId']].concat(t.cols.map((c) => [c[0], mongoType(t, c[0])])) : t.cols);
        return '<li class="dt-t' + (open ? ' open' : '') + '" data-t="' + esc(t.name) + '">' +
          '<div class="dt-row">' +
            '<button type="button" class="dt-name" aria-expanded="' + open + '"><span class="tw" aria-hidden="true"></span>' + G.icon(mongo ? 'file' : 'table') + '<span class="nm">' + esc(t.name) + '</span><small class="mono">' + fmtN(t.docs.length) + '</small></button>' +
            '<button type="button" class="dt-top" data-top="' + esc(t.name) + '" aria-label="' + esc(mongo ? T(t.name + ': ilk 20 belgeyi getir', t.name + ': fetch the first 20 documents') : T(t.name + ': ilk 100 satırı getir', t.name + ': select the top 100 rows')) + '" title="' + esc(mongo ? 'find().limit(20)' : 'SELECT TOP 100 *') + '">' + G.icon('play') + '</button>' +
          '</div>' +
          '<div class="dt-more"' + (open ? '' : ' hidden') + '><p class="dt-desc">' + esc(t.desc) + '</p><ul class="dt-cols">' +
            cols.map(([n, ty]) => '<li><button type="button" class="dt-col" data-col="' + esc(n) + '" title="' + esc(T('Sorguya ekle', 'Insert into the query')) + '"><span>' + esc(n) + '</span><small class="mono">' + esc(ty) + '</small></button></li>').join('') +
          '</ul></div></li>';
      }).join('') + '</ul></div>';
    tree.innerHTML = '<div class="dt-head mono">' + G.icon('db') + '<b>' + (mongo ? 'garage' : 'GarageDB') + '</b><span>' + catalog.tables.length + (mongo ? T(' koleksiyon', ' collections') : T(' tablo', ' tables')) + ' · ' + fmtN(total) + (mongo ? T(' belge', ' docs') : T(' satır', ' rows')) + '</span>' +
      '<button type="button" class="dt-refresh" aria-label="' + esc(T('Yenile: canlı verileri yeniden oku', 'Refresh: re-read the live data')) + '" title="' + esc(T('Yenile', 'Refresh')) + '">' + G.icon('refresh') + '</button></div>' +
      group('content', T('İçerik', 'Content'), false) + group('session', T('Bu ziyaret · canlı', 'This visit · live'), true);
    if (treeCount) treeCount.textContent = catalog.tables.length;
  }
  tree.addEventListener('click', (e) => {
    const nm = e.target.closest('.dt-name');
    if (nm) {
      const li = nm.closest('.dt-t'), name = li.dataset.t, open = !openTables.has(name);
      open ? openTables.add(name) : openTables.delete(name);
      li.classList.toggle('open', open); nm.setAttribute('aria-expanded', String(open));
      li.querySelector('.dt-more').hidden = !open;
      return;
    }
    const top = e.target.closest('[data-top]');
    if (top) {
      const n = top.dataset.top;
      setCode(lang === 'sql' ? 'SELECT TOP 100 *\nFROM ' + n + ';' : 'db.' + n + '.find().limit(20)', true);
      run();
      if (matchMedia('(max-width: 860px)').matches) toggleTree(false);
      return;
    }
    const col = e.target.closest('[data-col]');
    if (col) { insertText(col.dataset.col); return; }
    if (e.target.closest('.dt-refresh')) { rebuild(); renderTree(); G.toast(T('Canlı veriler yenilendi', 'Live data refreshed'), 'refresh'); }
  });
  function toggleTree(open) {
    const o = open == null ? treeBtn.getAttribute('aria-expanded') !== 'true' : open;
    treeBtn.setAttribute('aria-expanded', String(o));
    root.classList.toggle('tree-open', o);
  }
  if (treeBtn) treeBtn.addEventListener('click', () => toggleTree());

  // =================================================================== ÇALIŞTIR
  function run() {
    if (!catalog) return;
    let src = input.value, partial = false;
    const a = input.selectionStart, b = input.selectionEnd;
    if (b > a && b - a < input.value.length && input.value.slice(a, b).trim()) { src = input.value.slice(a, b); partial = true; }
    rebuild();
    const t0 = performance.now();
    if (lang === 'sql') {
      const results = Q.runSql(src, catalog);
      out = { lang: 'sql', results, sets: results.filter((r) => r.cols), errors: results.filter((r) => r.error).length, partial, at: new Date(), ms: performance.now() - t0 };
    } else {
      const blocks = Q.splitShell(src).map((stmt) => ({ src: stmt, r: Q.runMongo(stmt, catalog, mstate) }));
      const sets = blocks.filter((x) => x.r.kind === 'docs').map((x) => docsToSet(x.r.docs, x.r.ms));
      out = { lang: 'mongo', blocks, sets, errors: blocks.filter((x) => x.r.kind === 'error').length, partial, at: new Date(), ms: performance.now() - t0 };
    }
    out.empty = lang === 'sql' ? !out.results.length : !out.blocks.length;
    const rows = out.sets.reduce((n, s) => n + s.rows.length, 0);
    chartMeasure = null;
    if (out.errors && !out.sets.length) tab = 'msg';
    else if (tab === 'msg' && out.sets.length && !out.errors) tab = 'grid';
    else if (tab === 'chart' && !chartable()) tab = 'grid';
    render();
    renderTree();
    G.store.sset(qKey(lang), input.value);
    G.store.sset('garage-db-last', JSON.stringify({ lang, q: src.replace(/(--|\/\/)[^\n]*\n?/g, '').trim().slice(0, 120), rows, errors: out.errors, at: Date.now() }));
    G.metrics.inc('garage_db_queries_total', { lang, status: out.errors ? 'error' : 'ok' });
    G.metrics.observe('garage_db_query_duration_ms', { lang }, out.ms);
    G.log(out.errors ? 'warn' : 'info', 'db query ' + lang + (out.errors ? ' with errors' : ''), { rows, ms: +out.ms.toFixed(2) });
    G.sfx('key');
  }
  // Mongo belgeleri → tablo (üst düzey alanlar; diziler virgülle, nesneler JSON)
  function docsToSet(docs, ms) {
    const cols = [];
    docs.forEach((d) => Object.keys(d).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    return { cols, rows: docs.map((d) => cols.map((c) => Q.toCell(d[c]))), ms, docs };
  }

  // =================================================================== GÖRÜNTÜLEME
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  function cell(v) {
    if (v === null || v === undefined) return '<td class="nul">NULL</td>';
    if (isNum(v)) return '<td class="num">' + esc(String(Number.isInteger(v) ? v : +v.toFixed(4))) + '</td>';
    const s = String(v);
    return '<td' + (s.length > 48 ? ' title="' + esc(s.slice(0, 600)) + '"' : '') + '>' + esc(s.length > 160 ? s.slice(0, 160) + '…' : s) + '</td>';
  }
  function grid(set, k, many) {
    const MAX = 500, rows = set.rows.slice(0, MAX);
    return '<div class="db-set">' + (many ? '<p class="db-set-h mono">' + esc(T('Sonuç ' + (k + 1), 'Result ' + (k + 1))) + ' · ' + fmtN(set.rows.length) + T(' satır', ' rows') + '</p>' : '') +
      '<div class="db-scroll"><table class="db-grid"><thead><tr><th class="rn" scope="col"><span class="vh">#</span></th>' + set.cols.map((c) => '<th scope="col">' + esc(c || T('(Sütun adı yok)', '(No column name)')) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r, i) => '<tr><th class="rn" scope="row">' + (i + 1) + '</th>' + r.map(cell).join('') + '</tr>').join('') +
      (set.rows.length > MAX ? '<tr><td class="more" colspan="' + (set.cols.length + 1) + '">' + esc(T('… ' + fmtN(set.rows.length - MAX) + ' satır daha (TOP ya da WHERE ile daralt)', '… ' + fmtN(set.rows.length - MAX) + ' more rows (narrow it with TOP or WHERE)')) + '</td></tr>' : '') +
      (!set.rows.length ? '<tr><td class="empty" colspan="' + (set.cols.length + 1) + '">' + esc(T('(0 satır)', '(0 rows)')) + '</td></tr>' : '') +
      '</tbody></table></div></div>';
  }
  function completion(at) {
    const p = (n, l) => String(n).padStart(l || 2, '0'), off = -at.getTimezoneOffset(), sg = off >= 0 ? '+' : '-';
    return at.getFullYear() + '-' + p(at.getMonth() + 1) + '-' + p(at.getDate()) + 'T' + p(at.getHours()) + ':' + p(at.getMinutes()) + ':' + p(at.getSeconds()) + '.' + p(at.getMilliseconds(), 3) + '0000' + sg + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60);
  }
  function messagesHtml() {
    if (!out) return '';
    let h = '';
    if (out.lang === 'sql') {
      out.results.forEach((r) => {
        if (r.error) h += '<pre class="m-err">' + esc(Q.sqlErrText(r.error)) + '</pre>';
        else if (r.message) h += '<pre>' + esc(r.message) + '</pre>';
        else h += '<pre>' + esc(T('(' + fmtN(r.rows.length) + ' satır etkilendi)', '(' + fmtN(r.rows.length) + (r.rows.length === 1 ? ' row' : ' rows') + ' affected)')) + '</pre>';
      });
      if (!out.results.length) h += '<pre>' + esc(T('Komutlar başarıyla tamamlandı.', 'Commands completed successfully.')) + '</pre>';
      h += '<pre class="m-dim">' + esc(T('Tamamlanma zamanı: ', 'Completion time: ') + completion(out.at)) + '</pre>';
    } else {
      out.blocks.forEach((x) => {
        h += '<pre class="m-dim">garage&gt; ' + esc(x.src.split('\n')[0] + (x.src.includes('\n') ? ' …' : '')) + '</pre>';
        if (x.r.kind === 'error') h += '<pre class="m-err">' + esc(x.r.error) + '</pre>';
        else if (x.r.kind === 'docs') h += '<pre>' + esc(T(fmtN(x.r.docs.length) + ' belge döndü · ' + fmtMs(x.r.ms), fmtN(x.r.docs.length) + ' documents returned · ' + fmtMs(x.r.ms))) + '</pre>';
        else h += '<pre>' + esc(T('tamam · ', 'ok · ') + fmtMs(x.r.ms || 0)) + '</pre>';
      });
      if (!out.blocks.length) h += '<pre class="m-dim">' + esc(T('Çalıştırılacak ifade yok.', 'Nothing to run.')) + '</pre>';
    }
    return '<div class="db-msgs mono">' + h + '</div>';
  }
  const MONGO_HELP = () => [
    T('  Kabuk komutları', '  Shell commands'),
    '    show collections        ' + T('koleksiyonları listeler', 'lists the collections'),
    '    show dbs · use garage   ' + T('veritabanları', 'databases'),
    '    db.<c>.find(filtre, projeksiyon).sort().limit().skip()'.replace('filtre, projeksiyon', T('filtre, projeksiyon', 'filter, projection')),
    '    db.<c>.aggregate([...])  $match $group $project $sort $unwind $lookup $sortByCount …',
    '    db.<c>.countDocuments() · distinct(\'alan\') · findOne()'.replace("'alan'", T("'alan'", "'field'")),
    T('  Yazma işlemleri kapalı: veritabanı salt okunur.', '  Writes are disabled: the database is read-only.')
  ].join('\n');
  function mongoHtml() {
    if (!out.blocks.length) return empty(T('Çalıştırılacak ifade yok. Örneklerden birini dene.', 'Nothing to run. Try one of the examples.'));
    const showTable = docView === 'table';
    let h = '<div class="db-shell mono">';
    out.blocks.forEach((x) => {
      const r = x.r;
      h += '<p class="sh-in"><span class="pr">garage&gt;</span> ' + esc(x.src.length > 220 ? x.src.slice(0, 220) + '…' : x.src) + '</p>';
      if (r.kind === 'error') h += '<pre class="sh-err">' + esc(r.error) + '</pre>';
      else if (r.kind === 'docs') {
        if (!r.docs.length) h += '<pre class="sh-out m-dim">[]</pre>';
        else if (showTable) h += grid(docsToSet(r.docs, r.ms), 0, false);
        else {
          const MAX = 50, shown = r.docs.slice(0, MAX);
          h += '<pre class="sh-out">' + Q.inspect(shown, 0, { html: true }) + '</pre>';
          if (r.docs.length > MAX) h += '<p class="sh-more">' + esc(T('… ' + fmtN(r.docs.length - MAX) + ' belge daha: tablo görünümünde hepsi var', '… ' + fmtN(r.docs.length - MAX) + ' more documents: the table view shows them all')) + '</p>';
        }
      } else if (r.kind === 'value') h += '<pre class="sh-out">' + Q.inspect(r.value, 0, { html: true }) + '</pre>';
      else if (r.kind === 'lines') h += '<pre class="sh-out">' + esc(r.lines.join('\n')) + '</pre>';
      else if (r.kind === 'cmd') h += '<pre class="sh-out m-dim">' + esc(r.cmd === 'help' ? MONGO_HELP() : r.cmd === 'it' ? 'no cursor' : T('Bu kabuk sayfaya gömülü; çıkmak için başka bir odaya geç.', 'This shell is part of the page; to leave, walk into another room.')) + '</pre>';
    });
    return h + '</div>';
  }
  const empty = (msg) => '<div class="db-empty"><p>' + esc(msg) + '</p></div>';
  let spec = null;
  function render() {
    tabBtns.forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    pane.setAttribute('aria-labelledby', 'dbTab-' + tab);
    spec = chartSpec();
    const can = !!spec;
    chartBtn.disabled = !can;
    copyBtns.forEach((b) => { b.disabled = !(out && out.sets.length); });
    pane.classList.toggle('is-chart', tab === 'chart');
    if (!out) { pane.innerHTML = empty(T('Bir sorgu yaz ya da örneklerden birini seç, sonra Çalıştır’a bas.', 'Write a query or pick an example, then press Run.')); status(); return; }
    if (tab === 'msg') pane.innerHTML = messagesHtml();
    else if (tab === 'chart') pane.innerHTML = can ? chartHtml(spec) : empty(T('Grafik için sonuçta bir metin ya da tarih sütunu ve bir sayı sütunu olmalı (en çok 60 satır). Örnek: SELECT page, load_ms FROM page_views', 'A chart needs a text or date column and a number column in the result (60 rows at most). Example: SELECT page, load_ms FROM page_views'));
    else if (out.lang === 'mongo') pane.innerHTML = viewSwitch() + mongoHtml();
    else if (!out.sets.length) pane.innerHTML = empty(out.errors ? T('Sorgu hata verdi: ayrıntı Mesajlar sekmesinde.', 'The query failed: details are on the Messages tab.') : T('Sonuç kümesi yok; ayrıntı Mesajlar sekmesinde.', 'No result set; see the Messages tab.'));
    else pane.innerHTML = out.sets.map((s, k) => grid(s, k, out.sets.length > 1)).join('');
    if (tab === 'chart' && can) wireChart(spec);
    status();
  }
  function viewSwitch() {
    if (!out.sets.length) return '';
    return '<div class="db-view seg" role="group" aria-label="' + esc(T('Belge görünümü', 'Document view')) + '">' +
      '<button type="button" data-view="docs" aria-pressed="' + (docView === 'docs') + '">' + esc(T('Belge', 'Documents')) + '</button>' +
      '<button type="button" data-view="table" aria-pressed="' + (docView === 'table') + '">' + esc(T('Tablo', 'Table')) + '</button></div>';
  }
  function status() {
    if (!out) { statusEl.innerHTML = '<span class="st">' + G.icon('db') + esc(T('Hazır', 'Ready')) + '</span><span class="grow"></span><span>' + esc(lang === 'sql' ? 'GarageDB · guest' : 'mongodb://garage') + '</span>'; return; }
    const rows = out.sets.reduce((n, s) => n + s.rows.length, 0);
    const ok = !out.errors;
    const msg = out.empty ? T('Çalıştırılacak bir şey yok', 'Nothing to run')
      : ok ? (out.lang === 'sql' ? T('Sorgu başarıyla yürütüldü.', 'Query executed successfully.') : T('Komut tamamlandı.', 'Command completed.'))
        : T('Sorgu hatalarla tamamlandı.', 'Query completed with errors.');
    statusEl.innerHTML = '<span class="st ' + (ok ? 'ok' : 'bad') + '">' + G.icon(ok ? 'check' : 'zap') + esc(msg) + (out.partial ? ' <em>' + esc(T('(yalnız seçim)', '(selection only)')) + '</em>' : '') + '</span><span class="grow"></span>' +
      '<span>' + esc(out.lang === 'sql' ? 'GarageDB · guest' : 'mongodb://' + mstate.db) + '</span><span>' + fmtMs(out.ms) + '</span><span>' + fmtN(rows) + (out.lang === 'sql' ? T(' satır', rows === 1 ? ' row' : ' rows') : T(' belge', rows === 1 ? ' doc' : ' docs')) + '</span>';
  }

  // =================================================================== GRAFİK
  // Tek seri, tek renk (oda rengi). Kategoriler için yatay çubuk, zaman için çizgi; her işaretin üstünde ipucu.
  const parseTime = (v) => {
    if (v instanceof Date) return +v;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return NaN;
    const t = Date.parse(v.length > 10 ? v.replace(' ', 'T') : v + 'T00:00:00');
    return isNaN(t) ? NaN : t;
  };
  function chartSpec() {
    if (!out || !out.sets.length) return null;
    const set = out.sets[0];
    if (!set.rows.length || set.rows.length > 60) return null;
    const ci = set.cols.map((c, k) => k);
    const numeric = ci.filter((k) => set.rows.some((r) => isNum(r[k])) && set.rows.every((r) => r[k] == null || isNum(r[k])) && set.cols[k] !== 'id' && !/(^|_)id$/.test(set.cols[k]));
    const label = ci.find((k) => !numeric.includes(k) && set.rows.every((r) => r[k] == null || typeof r[k] === 'string' || typeof r[k] === 'number'));
    if (!numeric.length) return null;
    const lk = label == null ? (out.lang === 'mongo' && set.cols[0] === '_id' ? 0 : -1) : label;
    if (lk === -1 && set.rows.length < 2) return null;
    let mk = numeric.includes(chartMeasure) ? chartMeasure : numeric.find((k) => k !== lk);
    if (mk == null) return null;
    const time = lk >= 0 && set.rows.length >= 3 && set.rows.every((r) => !isNaN(parseTime(r[lk])));
    return { set, lk, mk, numeric: numeric.filter((k) => k !== lk), time };
  }
  const chartable = () => !!chartSpec();
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
  }
  const fmtAxis = (v) => (Math.abs(v) >= 10000 ? (v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) + 'K' : v.toLocaleString(locale(), { maximumFractionDigits: 2 }));
  let measureCtx = null;
  function textW(s, px) { if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d'); measureCtx.font = px + 'px "JetBrains Mono", monospace'; return measureCtx.measureText(s).width; }
  function chartHtml(sp) {
    const set = sp.set;
    const W = Math.max(300, Math.floor(pane.clientWidth - 32));
    const measure = set.cols[sp.mk], labelName = sp.lk >= 0 ? set.cols[sp.lk] : '#';
    const pickM = sp.numeric.length > 1 ? '<label class="db-measure mono">' + esc(T('Ölçü', 'Measure')) + ' <select id="dbMeasure">' + sp.numeric.map((k) => '<option value="' + k + '"' + (k === sp.mk ? ' selected' : '') + '>' + esc(set.cols[k]) + '</option>').join('') + '</select></label>' : '';
    const head = '<div class="db-ch-h"><div><p class="db-ch-t">' + esc(measure) + ' <span>' + esc(T('· ' + labelName + ' başına', 'by ' + labelName)) + '</span></p><p class="db-ch-s mono">' + esc(fmtN(set.rows.length) + T(' satır · ilk sonuç kümesi', ' rows · first result set')) + '</p></div>' + pickM + '</div>';
    return '<div class="db-chart">' + head + (sp.time ? lineSvg(sp, W) : barSvg(sp, W)) + '<div class="db-tip" id="dbTip" hidden></div></div>';
  }
  function barSvg(sp, W) {
    const set = sp.set, rows = set.rows.map((r, i) => ({ label: sp.lk >= 0 ? (r[sp.lk] == null ? 'NULL' : String(r[sp.lk])) : String(i + 1), v: r[sp.mk] == null ? 0 : r[sp.mk], nil: r[sp.mk] == null }));
    const FS = 12, BAND = 30, BAR = 18;
    const labW = Math.min(Math.max(...rows.map((r) => textW(r.label, FS))) + 14, W * 0.38);
    const vals = rows.map((r) => r.v), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const showVals = rows.length <= 25;   // çok çubukta değerler ipucunda ve tabloda kalır
    const valW = showVals ? Math.max(...rows.map((r) => textW(fmtAxis(r.v), FS))) + 10 : 8;
    const x0 = labW, x1 = W - valW - (lo < 0 ? valW : 0);
    const step = niceStep((hi - lo) || 1, Math.max(2, Math.floor((x1 - x0) / 90)));
    const dlo = Math.floor(lo / step) * step, dhi = Math.ceil(hi / step) * step || step;
    const sx = (v) => x0 + (v - dlo) / (dhi - dlo) * (x1 - x0);
    const H = rows.length * BAND + 26, base = sx(0);
    const trunc = (s) => { let t = s; if (textW(t, FS) <= labW - 14) return t; while (t.length > 1 && textW(t + '…', FS) > labW - 14) t = t.slice(0, -1); return t + '…'; };
    let g = '';
    for (let v = dlo; v <= dhi + 1e-9; v += step) { const x = sx(v); g += '<line class="gl" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="0" y2="' + (H - 22) + '"/><text class="ax" x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(fmtAxis(+v.toFixed(10))) + '</text>'; }
    const bars = rows.map((r, i) => {
      const y = i * BAND + (BAND - BAR) / 2, xa = Math.min(base, sx(r.v)), xb = Math.max(base, sx(r.v)), w = xb - xa, rr = Math.min(4, w);
      const pos = r.v >= 0;
      const path = w < 0.5 ? '' : pos
        ? 'M' + xa.toFixed(1) + ' ' + y + 'H' + (xb - rr).toFixed(1) + 'Q' + xb.toFixed(1) + ' ' + y + ' ' + xb.toFixed(1) + ' ' + (y + rr) + 'V' + (y + BAR - rr) + 'Q' + xb.toFixed(1) + ' ' + (y + BAR) + ' ' + (xb - rr).toFixed(1) + ' ' + (y + BAR) + 'H' + xa.toFixed(1) + 'Z'
        : 'M' + xb.toFixed(1) + ' ' + y + 'H' + (xa + rr).toFixed(1) + 'Q' + xa.toFixed(1) + ' ' + y + ' ' + xa.toFixed(1) + ' ' + (y + rr) + 'V' + (y + BAR - rr) + 'Q' + xa.toFixed(1) + ' ' + (y + BAR) + ' ' + (xa + rr).toFixed(1) + ' ' + (y + BAR) + 'H' + xb.toFixed(1) + 'Z';
      const vx = pos ? xb + 6 : xa - 6;
      return '<g class="bar" tabindex="0" role="listitem" data-i="' + i + '" aria-label="' + esc(r.label + ': ' + (r.nil ? 'NULL' : fmtN(r.v))) + '">' +
        '<rect class="hit" x="0" y="' + (i * BAND) + '" width="' + W + '" height="' + BAND + '"/>' +
        '<text class="lb" x="' + (labW - 10) + '" y="' + (y + BAR / 2 + 4) + '" text-anchor="end">' + esc(trunc(r.label)) + '</text>' +
        (path ? '<path class="mk" d="' + path + '"/>' : '') +
        (showVals ? '<text class="vl" x="' + vx.toFixed(1) + '" y="' + (y + BAR / 2 + 4) + '"' + (pos ? '' : ' text-anchor="end"') + '>' + esc(r.nil ? 'NULL' : fmtAxis(r.v)) + '</text>' : '') + '</g>';
    }).join('');
    sp.points = rows;
    return '<svg class="db-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="list" aria-label="' + esc(sp.set.cols[sp.mk]) + '">' + g + '<line class="base" x1="' + base.toFixed(1) + '" x2="' + base.toFixed(1) + '" y1="0" y2="' + (H - 22) + '"/>' + bars + '</svg>';
  }
  function lineSvg(sp, W) {
    const set = sp.set;
    const pts = set.rows.map((r) => ({ t: parseTime(r[sp.lk]), v: r[sp.mk], raw: r[sp.lk] })).filter((p) => isNum(p.v)).sort((a, b) => a.t - b.t);
    const H = 240, L = 8, R = 12, TOP = 14, B = 28;
    const yw = Math.max(...pts.map((p) => textW(fmtAxis(p.v), 11))) + 10;
    const x0 = L + yw, x1 = W - R, y0 = TOP, y1 = H - B;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const hi = Math.max(...pts.map((p) => p.v)), lo = Math.min(0, ...pts.map((p) => p.v));
    const step = niceStep((hi - lo) || 1, 4), dhi = Math.ceil(hi / step) * step || step, dlo = Math.floor(lo / step) * step;
    const sx = (t) => x0 + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (x1 - x0), sy = (v) => y1 - (v - dlo) / (dhi - dlo) * (y1 - y0);
    let g = '';
    for (let v = dlo; v <= dhi + 1e-9; v += step) { const y = sy(v); g += '<line class="gl" x1="' + x0 + '" x2="' + x1 + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (x0 - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + esc(fmtAxis(+v.toFixed(10))) + '</text>'; }
    const span = t1 - t0, fmtT = (t) => { const d = new Date(t); return span > 2 * 864e5 ? d.toLocaleDateString(locale(), { day: '2-digit', month: 'short' }) : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: span < 3e5 ? '2-digit' : undefined }); };
    [0, 0.5, 1].forEach((f) => { const t = t0 + span * f; g += '<text class="ax" x="' + sx(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '">' + esc(fmtT(t)) + '</text>'; });
    const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p.t).toFixed(1) + ' ' + sy(p.v).toFixed(1)).join('');
    const area = d + 'L' + sx(pts[pts.length - 1].t).toFixed(1) + ' ' + sy(Math.max(0, dlo)).toFixed(1) + 'L' + sx(pts[0].t).toFixed(1) + ' ' + sy(Math.max(0, dlo)).toFixed(1) + 'Z';
    const dots = pts.length <= 40 ? pts.map((p) => '<circle class="dot" cx="' + sx(p.t).toFixed(1) + '" cy="' + sy(p.v).toFixed(1) + '" r="4"/>').join('') : '';
    sp.points = pts.map((p) => ({ x: sx(p.t), y: sy(p.v), v: p.v, label: typeof p.raw === 'string' ? p.raw : fmtT(p.t) }));
    sp.box = { x0, x1, y0, y1 };
    return '<svg class="db-svg line" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" tabindex="0" role="img" aria-label="' + esc(set.cols[sp.mk] + T(' zamana göre; ' + pts.length + ' nokta. Ok tuşlarıyla gez.', ' over time; ' + pts.length + ' points. Use the arrow keys.')) + '">' + g +
      '<path class="area" d="' + area + '"/><path class="ln" d="' + d + '"/>' + dots +
      '<line class="xh" x1="0" x2="0" y1="' + y0 + '" y2="' + y1 + '" hidden/><circle class="xhd" r="5" hidden/>' +
      '<rect class="hit" x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '"/></svg>';
  }
  function wireChart(sp) {
    // chartHtml çizerken noktaları sp.points'e yazar; ipuçları aynı noktaları kullanır
    const svg = pane.querySelector('.db-svg'), tip = $('dbTip'), wrap = pane.querySelector('.db-chart');
    const sel = $('dbMeasure');
    if (sel) sel.addEventListener('change', () => { chartMeasure = +sel.value; render(); const s2 = $('dbMeasure'); if (s2) s2.focus(); });
    if (!svg || !tip) return;
    const showTip = (html, px, py) => {
      tip.innerHTML = html; tip.hidden = false;
      const wr = wrap.getBoundingClientRect(), sr = svg.getBoundingClientRect(), scale = sr.width / svg.viewBox.baseVal.width;
      let x = sr.left - wr.left + px * scale + 12, y = sr.top - wr.top + py * scale - tip.offsetHeight - 8;
      x = Math.min(x, wr.width - tip.offsetWidth - 4); if (y < 0) y = sr.top - wr.top + py * scale + 14;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = y + 'px';
    };
    const hide = () => { tip.hidden = true; };
    const label = (s) => esc(s.length > 60 ? s.slice(0, 60) + '…' : s);
    if (!svg.classList.contains('line')) {
      const vb = svg.viewBox.baseVal;
      svg.querySelectorAll('.bar').forEach((b) => {
        const i = +b.dataset.i, r = sp.set.rows[i];
        const lv = sp.lk >= 0 ? String(r[sp.lk] == null ? 'NULL' : r[sp.lk]) : '#' + (i + 1), v = r[sp.mk];
        const html = '<b>' + esc(v == null ? 'NULL' : fmtN(v)) + '</b><span>' + label(lv) + ' · ' + esc(sp.set.cols[sp.mk]) + '</span>';
        const at = () => { const m = b.querySelector('.mk'), bb = m ? m.getBBox() : b.querySelector('.lb').getBBox(); showTip(html, Math.min(bb.x + bb.width, vb.width - 40), bb.y); };
        b.addEventListener('pointerenter', at); b.addEventListener('focus', at);
        b.addEventListener('pointerleave', hide); b.addEventListener('blur', hide);
      });
      return;
    }
    // Çizgi: artı imleç en yakın noktaya oturur
    const xh = svg.querySelector('.xh'), xd = svg.querySelector('.xhd');
    const pts = sp.points;
    let cur = -1;
    const show = (i) => {
      if (!pts || !pts[i]) return; cur = i;
      const p = pts[i];
      xh.setAttribute('x1', p.x); xh.setAttribute('x2', p.x); xh.removeAttribute('hidden');
      xd.setAttribute('cx', p.x); xd.setAttribute('cy', p.y); xd.removeAttribute('hidden');
      showTip('<b>' + esc(fmtN(p.v)) + '</b><span>' + label(p.label) + ' · ' + esc(sp.set.cols[sp.mk]) + '</span>', p.x, p.y);
    };
    const nearest = (e) => {
      const sr = svg.getBoundingClientRect(), x = (e.clientX - sr.left) / (sr.width / svg.viewBox.baseVal.width);
      let best = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } }); return best;
    };
    const off = () => { xh.setAttribute('hidden', ''); xd.setAttribute('hidden', ''); hide(); cur = -1; };
    svg.addEventListener('pointermove', (e) => show(nearest(e)));
    svg.addEventListener('pointerleave', off);
    svg.addEventListener('blur', off);
    svg.addEventListener('focus', () => show(cur < 0 ? pts.length - 1 : cur));
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, Math.min(pts.length - 1, (cur < 0 ? pts.length - 1 : cur) + (e.key === 'ArrowRight' ? 1 : -1)))); }
      if (e.key === 'Home') { e.preventDefault(); show(0); } if (e.key === 'End') { e.preventDefault(); show(pts.length - 1); }
    });
  }
  let rT = 0;
  window.addEventListener('resize', () => { if (tab !== 'chart' || !out) return; clearTimeout(rT); rT = setTimeout(render, 150); });

  // =================================================================== DIŞA AKTAR, BAĞLANTI
  function copyResult(kind) {
    if (!out || !out.sets.length) return;
    const set = out.sets[0];
    if (kind === 'json') {
      const data = out.lang === 'mongo' && set.docs ? set.docs : set.rows.map((r) => Object.fromEntries(set.cols.map((c, k) => [c, r[k]])));
      G.copy(JSON.stringify(data, (k, v) => (v && typeof v === 'object' && v.$oid ? { $oid: v.$oid } : v), 2), 'JSON');
    } else {
      const clean = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
      G.copy([set.cols.join('\t')].concat(set.rows.map((r) => r.map(clean).join('\t'))).join('\n'), 'TSV');
    }
    G.metrics.inc('garage_db_exports_total', { kind });
  }
  copyBtns.forEach((b) => b.addEventListener('click', () => copyResult(b.dataset.copyRes)));
  if (linkBtn) linkBtn.addEventListener('click', () => {
    const url = location.origin + location.pathname + '#' + lang + '=' + encodeURIComponent(input.value);
    if (url.length > 6000) { G.toast(T('Sorgu bağlantı için çok uzun', 'The query is too long for a link'), 'link'); return; }
    G.copy(url, T('Sorgu bağlantısı', 'Query link'));
  });

  // =================================================================== ÖRNEKLER MENÜSÜ
  function renderEx() {
    exMenu.innerHTML = '<p class="dbx-h mono">' + esc((lang === 'sql' ? 'GarageSQL' : 'mongosh') + T(' · örnek sorgular', ' · example queries')) + '</p>' +
      EX[lang].map((e, k) => '<button type="button" role="menuitem" data-ex="' + k + '"><b>' + esc(pick(e.t)) + '</b><small class="mono">' + esc(e.s) + '</small></button>').join('');
  }
  const exItems = () => [...exMenu.querySelectorAll('[data-ex]')];
  function exOpen(focusFirst) { renderEx(); exMenu.hidden = false; exBtn.setAttribute('aria-expanded', 'true'); if (focusFirst) exItems()[0].focus(); }
  function exClose(focusBtn) { if (exMenu.hidden) return; exMenu.hidden = true; exBtn.setAttribute('aria-expanded', 'false'); if (focusBtn) exBtn.focus(); }
  exBtn.addEventListener('click', () => (exMenu.hidden ? exOpen(false) : exClose()));
  exBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); exOpen(true); } });
  exMenu.addEventListener('keydown', (e) => {
    const items = exItems(), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exClose(true); }
    else if (e.key === 'Tab') exClose();
  });
  exMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]'); if (!b) return;
    const ex = EX[lang][+b.dataset.ex];
    exClose();
    setCode(pick(ex.q), true);
    run();
    G.metrics.inc('garage_db_examples_total', { lang });
  });
  document.addEventListener('click', (e) => { if (!exMenu.hidden && !e.target.closest('.db-ex')) exClose(); });

  // =================================================================== DİL, SEKMELER, DÜĞMELER
  function setLang(l, opts) {
    opts = opts || {};
    if (l !== 'sql' && l !== 'mongo') l = 'sql';
    if (catalog && lang !== l && !opts.init) G.store.sset(qKey(lang), input.value);
    lang = l;
    G.store.sset('garage-db-lang', l);
    root.dataset.lang = l;
    langBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
    connEl.textContent = l === 'sql' ? 'GarageDB' : 'mongodb://' + mstate.db;
    const tl = treeBtn && treeBtn.querySelector('span[data-en]');
    if (tl) { tl.dataset.tr = l === 'sql' ? 'Tablolar ve sütunlar' : 'Koleksiyonlar ve alanlar'; tl.dataset.en = l === 'sql' ? 'Tables and columns' : 'Collections and fields'; tl.textContent = G.lang() === 'en' ? tl.dataset.en : tl.dataset.tr; }
    if (!opts.keepCode) setCode(G.store.sget(qKey(l)) || DEF[l]());
    acClose(); exClose();
    out = null; tab = 'grid';
    renderTree(); render();
  }
  langBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.lang !== lang) { setLang(b.dataset.lang); G.sfx('click'); input.focus(); } }));
  tabBtns.forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  root.querySelector('.db-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabBtns.findIndex((b) => b.dataset.tab === tab), n = tabBtns[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabBtns.length) % tabBtns.length];
    tab = n.dataset.tab; render(); n.focus();
  });
  pane.addEventListener('click', (e) => { const v = e.target.closest('[data-view]'); if (v) { docView = v.dataset.view; render(); const b = pane.querySelector('[data-view="' + docView + '"]'); if (b) b.focus(); } });
  runBtn.addEventListener('click', () => { run(); });
  chartBtn.addEventListener('click', () => { if (chartable()) { tab = 'chart'; render(); } });
  const kRun = runBtn.querySelector('.k-run'); if (kRun) kRun.textContent = MOD + ' ↵';
  document.addEventListener('garage:lang', () => { renderTree(); render(); if (!exMenu.hidden) renderEx(); });

  // =================================================================== BAŞLAT
  function fromHash() {
    const m = location.hash.match(/^#(sql|mongo)=([\s\S]*)$/);
    if (!m) return null;
    try { return { lang: m[1], q: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  }
  const h = fromHash();
  setLang(h ? h.lang : G.store.sget('garage-db-lang') === 'mongo' ? 'mongo' : 'sql', { init: true });
  if (h) setCode(h.q);
  render();
  Q.loadPosts(document.body.dataset.root || '').then((p) => {
    posts = p || [];
    rebuild(); renderTree(); sync();
    if (h) { run(); history.replaceState(null, '', location.pathname + location.search); }
  });
  window.addEventListener('hashchange', () => { const x = fromHash(); if (x && catalog) { setLang(x.lang, { keepCode: true }); setCode(x.q); run(); history.replaceState(null, '', location.pathname + location.search); } });
})();
