// Şema — bir isteğin yolculuğu (sema.js)
// Cache-aside deseninin canlı simülasyonu: İstemci → API → Redis (isabet/ıska) → MSSQL / MongoDB,
// loglar Graylog'a itilir, metrikler Prometheus tarafından çekilir ve Grafana'da çizilir.
// Süreler temsilidir; önbellek terminaldeki redis-cli ile ortaktır (G.redis), metrikler /metrics'te görünür.
(function () {
  'use strict';
  const G = window.GARAGE;
  const $ = (s, r) => (r || document).querySelector(s);
  const bp = $('#bp'); if (!bp) return;
  const grid = $('.bp-grid', bp), svg = $('.bp-svg', bp);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = G.esc;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rid = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (ms) => (ms >= 100 ? Math.round(ms) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2)) + ' ms';

  // ------------------------------------------------------------------ düğümler
  const NODES = {
    client: { icon: 'phone', name: { tr: 'Mobil uygulama', en: 'Mobile app' }, role: { tr: 'İsteği başlatan istemci', en: 'Starts the request' },
      desc: { tr: 'Kullanıcının telefonundaki uygulama. Bir ekran açıldığında API’ye HTTP isteği gönderir ve yanıtı bekler. Kullanıcının hissettiği süre, buradan çıkıp buraya dönen toplam süredir.', en: 'The app on the user’s phone. Opening a screen sends an HTTP request to the API and waits. What the user feels is the full round trip from here and back.' } },
    api: { icon: 'server', name: { tr: 'API', en: 'API' }, role: { tr: 'ASP.NET Core · C#', en: 'ASP.NET Core · C#' },
      desc: { tr: 'İsteği karşılayan .NET servisi. Cache-aside deseniyle önce Redis’e bakar; yoksa veritabanından okur ve sonucu TTL ile önbelleğe yazar. Her istek için yapılandırılmış bir log üretir, sayaçlarını /metrics ucunda yayımlar. Devre kesici açıksa (Polly), veritabanı art arda hata verdiğinde bir süre ona hiç istek göndermez; kullanıcı 1 saniye beklemek yerine hemen hata alır, veritabanı da toparlanmak için nefes alır.', en: 'The .NET service that handles the request. With the cache-aside pattern it checks Redis first; on a miss it reads the database and writes the result back with a TTL. Every request emits a structured log and updates counters on /metrics. With the circuit breaker on (Polly), repeated database failures make it stop calling the database for a while: users get an instant error instead of a 1-second wait, and the database gets room to recover.' } },
    redis: { icon: 'memory', name: { tr: 'Redis', en: 'Redis' }, role: { tr: 'Önbellek', en: 'Cache' },
      desc: { tr: 'Sık okunan veriyi bellekte tutar; okuma milisaniyenin altındadır. Her anahtarın bir yaşam süresi (TTL) vardır: süre dolunca anahtar silinir, sonraki istek yeniden veritabanına gider. Aşağıdaki listede süreleri canlı izleyebilirsin.', en: 'Keeps frequently read data in memory; reads take well under a millisecond. Every key has a time-to-live: when it expires the key is removed and the next request goes back to the database. Watch the TTLs live in the list below.' } },
    mssql: { icon: 'db', name: { tr: 'MSSQL', en: 'MSSQL' }, role: { tr: 'İlişkisel veritabanı', en: 'Relational database' },
      desc: { tr: 'Kullanıcı gibi yapılı veriler tablolarda durur. Önbellekte bulunmayan istekler buraya düşer; sorgu ve disk maliyeti yüzünden önbellekten onlarca kat yavaştır. “DB yavaş” ve “DB kapalı” ile kötü bir günü dene.', en: 'Structured data such as users lives in tables. Requests that miss the cache land here; query and disk cost make it tens of times slower than the cache. Try a bad day with “DB slow” and “DB down”.' } },
    mongo: { icon: 'db', name: { tr: 'MongoDB', en: 'MongoDB' }, role: { tr: 'Doküman veritabanı', en: 'Document database' },
      desc: { tr: 'Akış (feed) gibi esnek şemalı veriler JSON benzeri dokümanlar olarak tutulur. “feed” rotası buradan okur.', en: 'Flexible data such as a feed is stored as JSON-like documents. The “feed” route reads from here.' } },
    graylog: { icon: 'logs', name: { tr: 'Graylog', en: 'Graylog' }, role: { tr: 'Log toplama ve arama', en: 'Log aggregation & search' },
      desc: { tr: 'API her isteği yapılandırılmış bir log olarak iter (GELF). Aşağıdaki akışta bir kayda tıklayıp tüm alanlarını görebilir, trace_id ile tek bir isteğin izini sürebilirsin.', en: 'The API pushes every request as a structured log (GELF). Click an entry in the stream below to see all fields and follow a single request by its trace_id.' } },
    grafana: { icon: 'chart', name: { tr: 'Grafana', en: 'Grafana' }, role: { tr: 'Pano ve uyarılar', en: 'Dashboards & alerts' },
      desc: { tr: 'Prometheus’taki metrikleri çizer. Son 20 isteğin p95 süresi 250 ms’yi aşarsa uyarı kırmızıya döner; “DB yavaş” açıkken yük testi yap ve izle.', en: 'Charts the metrics stored in Prometheus. If the p95 of the last 20 requests exceeds 250 ms the alert turns red; switch on “DB slow”, run a load test and watch.' } },
    prometheus: { icon: 'flame', name: { tr: 'Prometheus', en: 'Prometheus' }, role: { tr: 'Metrik toplama (pull)', en: 'Metric collection (pull)' },
      desc: { tr: 'Loglar itilirken metrikler çekilir: Prometheus belirli aralıklarla API’nin /metrics ucunu kazır (scrape). Burada her 2 saniyede bir; gerçekte genellikle 15–30 saniye. Grafana’daki sayılar bu yüzden ancak bir sonraki kazımada güncellenir.', en: 'Logs are pushed, metrics are pulled: Prometheus scrapes the API’s /metrics endpoint on an interval. Here every 2 seconds; in production typically 15–30 seconds, which is why Grafana only updates on the next scrape.' } }
  };
  const ROUTES = {
    users: { db: 'mssql', edge: 'api-mssql', path: (id) => '/api/users/' + id, key: (id) => 'cache:user:' + id,
      query: (id) => 'SELECT Id, Name FROM Users WHERE Id = ' + id, write: (id) => 'UPDATE Users SET Name = @name WHERE Id = ' + id, value: (id) => JSON.stringify({ id, name: 'user-' + id }) },
    feed: { db: 'mongo', edge: 'api-mongo', path: (id) => '/api/feed/' + id, key: (id) => 'cache:feed:' + id,
      query: (id) => 'db.feed.find({ userId: ' + id + ' }).limit(20)', write: (id) => 'db.feed.updateOne({ userId: ' + id + ' }, { $set: … })', value: (id) => JSON.stringify({ userId: id, items: 20 }) }
  };
  const EDGES = [
    { id: 'client-api', a: 'client', b: 'api' },
    { id: 'api-redis', a: 'api', b: 'redis' },
    { id: 'api-mssql', a: 'api', b: 'mssql' },
    { id: 'api-mongo', a: 'api', b: 'mongo' },
    { id: 'api-graylog', a: 'api', b: 'graylog', obs: true, label: 'GELF' },
    { id: 'prom-api', a: 'prometheus', b: 'api', obs: true, label: 'scrape /metrics' },
    { id: 'prom-grafana', a: 'prometheus', b: 'grafana', obs: true, label: 'PromQL' }
  ];

  // Devre kesici (Polly tarzı): 3 ardışık hatada açılır, 6 sn veritabanına gidilmez, sonra tek deneme isteği
  const CB_LIMIT = 3, CB_OPEN_MS = 6000;
  const newBreaker = () => ({ state: 'closed', fails: 0, until: 0, trial: false });
  // Yeniden deneme (Polly): geçici hatada en çok 3 kez, üstel geri çekilme + jitter. Hız sınırı: token bucket (10 jeton, saniyede 2).
  const RETRY = { max: 3, base: 80 }, RL = { cap: 10, rate: 2 };
  const S = {
    method: 'GET', flaky: false, retry: false, sf: false, rl: false, flights: {}, traces: [], pinned: null, bucket: { tokens: RL.cap, at: Date.now() },
    cb: false, br: { mssql: newBreaker(), mongo: newBreaker() },
    route: 'users', idMode: 'fixed', ttl: 30, slow: false, down: false, selected: 'api',
    lat: [], counts: { req: 0, hit: 0, miss: 0, err: 0, mssql: 0, mongo: 0, mssqlMs: 0, mongoMs: 0, logs: 0, retries: 0, coalesced: 0, limited: 0 },
    scrape: { at: 0, snap: null }, alert: false, last: null, gl: [], inflight: 0
  };

  // ------------------------------------------------------------------ DOM: düğümler
  const nodeEl = {};
  Object.keys(NODES).forEach((k) => {
    const n = NODES[k];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'node n-' + k; b.dataset.node = k;
    b.setAttribute('aria-pressed', String(k === S.selected));
    b.innerHTML = '<span class="node-top">' + G.icon(n.icon) + '<span class="node-name"></span><span class="node-badge" hidden></span></span><span class="node-role"></span><span class="node-stat"></span>';
    b.addEventListener('click', () => { S.selected = k; Object.values(nodeEl).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderInspector(); });
    grid.appendChild(b); nodeEl[k] = b;
  });
  function labelNodes() {
    Object.keys(NODES).forEach((k) => {
      const n = NODES[k], b = nodeEl[k];
      const nm = $('.node-name', b); nm.textContent = G.tx(n.name); nm.lang = k === 'client' ? G.lang() : 'en';   // REDIS, REDİS değil
      $('.node-role', b).textContent = G.tx(n.role);
      b.setAttribute('aria-label', G.tx(n.name) + ' — ' + G.tx(n.role));
    });
  }

  // ------------------------------------------------------------------ SVG: bağlantı rotaları
  const edgeEl = {}, edgeLive = {};
  EDGES.forEach((e) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'bp-edge' + (e.obs ? ' obs' : ''));
    svg.appendChild(p); edgeEl[e.id] = p; edgeLive[e.id] = 0;
    if (e.label) { const t = document.createElementNS(NS, 'text'); t.setAttribute('class', 'bp-edge-label'); t.textContent = e.label; svg.appendChild(t); e.labelEl = t; }
  });
  function rects() {
    // SVG, .bp'nin dolgu kutusuna yerleşir: kenarlık kalınlığı kadar kaydır
    const o = bp.getBoundingClientRect(), ox = o.left + bp.clientLeft, oy = o.top + bp.clientTop, r = {};
    Object.keys(nodeEl).forEach((k) => {
      const b = nodeEl[k].getBoundingClientRect();
      r[k] = { l: b.left - ox, t: b.top - oy, r: b.right - ox, b: b.bottom - oy, w: b.width, h: b.height };
      r[k].cx = r[k].l + r[k].w / 2; r[k].cy = r[k].t + r[k].h / 2;
    });
    r.W = bp.clientWidth; r.H = bp.clientHeight;
    return r;
  }
  function dPath(pts, rad) {
    const P = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
    let d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
    for (let i = 1; i < P.length - 1; i++) {
      const [x0, y0] = P[i - 1], [x1, y1] = P[i], [x2, y2] = P[i + 1];
      const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1), rr = Math.min(rad, d1 / 2, d2 / 2);
      d += ' L' + (x1 - (x1 - x0) / d1 * rr).toFixed(1) + ' ' + (y1 - (y1 - y0) / d1 * rr).toFixed(1) + ' Q' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x1 + (x2 - x1) / d2 * rr).toFixed(1) + ' ' + (y1 + (y2 - y1) / d2 * rr).toFixed(1);
    }
    const L = P[P.length - 1];
    return d + ' L' + L[0].toFixed(1) + ' ' + L[1].toFixed(1);
  }
  function layout() {
    const r = rects();
    svg.setAttribute('viewBox', '0 0 ' + r.W + ' ' + r.H);
    const stacked = Math.abs(r.client.cx - r.api.cx) < 20;   // dar ekran: alt alta
    const c = r.client, a = r.api, R = {};
    if (!stacked) {
      const mx = (a.r + r.mssql.l) / 2, laneT = Math.min(r.redis.t, r.graylog.t) - 24, laneB = Math.max(r.mongo.b, r.prometheus.b) + 18;
      R['client-api'] = [[c.r, a.cy], [a.l, a.cy]];
      R['api-redis'] = [[a.r, a.cy - 18], [mx - 8, a.cy - 18], [mx - 8, r.redis.cy], [r.redis.l, r.redis.cy]];
      R['api-mssql'] = [[a.r, a.cy], [mx, a.cy], [mx, r.mssql.cy], [r.mssql.l, r.mssql.cy]];
      R['api-mongo'] = [[a.r, a.cy + 18], [mx + 8, a.cy + 18], [mx + 8, r.mongo.cy], [r.mongo.l, r.mongo.cy]];
      R['api-graylog'] = [[a.cx, a.t], [a.cx, laneT], [r.graylog.cx, laneT], [r.graylog.cx, r.graylog.t]];
      R['prom-api'] = [[r.prometheus.cx, r.prometheus.b], [r.prometheus.cx, laneB], [a.cx, laneB], [a.cx, a.b]];
      R['prom-grafana'] = [[r.prometheus.cx, r.prometheus.t], [r.grafana.cx, r.grafana.b]];
    } else {
      const laneS = (a.b + r.mssql.t) / 2, x0 = 6, x1 = r.W - 6, laneO = (r.mssql.b + r.grafana.t) / 2;
      R['client-api'] = [[c.cx, c.b], [a.cx, a.t]];
      R['api-redis'] = [[a.cx - 14, a.b], [a.cx - 14, laneS], [r.redis.cx, laneS], [r.redis.cx, r.redis.t]];
      R['api-mssql'] = [[a.cx, a.b], [r.mssql.cx, r.mssql.t]];
      R['api-mongo'] = [[a.cx + 14, a.b], [a.cx + 14, laneS], [r.mongo.cx, laneS], [r.mongo.cx, r.mongo.t]];
      R['api-graylog'] = [[a.l, a.cy], [x0, a.cy], [x0, laneO], [r.graylog.cx, laneO], [r.graylog.cx, r.graylog.t]];
      R['prom-api'] = [[r.prometheus.cx, r.prometheus.t], [r.prometheus.cx, laneO + 8], [x1, laneO + 8], [x1, a.cy], [a.r, a.cy]];
      R['prom-grafana'] = [[r.prometheus.l, r.prometheus.cy], [r.grafana.r, r.grafana.cy]];
    }
    EDGES.forEach((e) => {
      edgeEl[e.id].setAttribute('d', dPath(R[e.id], 10));
      if (e.labelEl) {   // etiket: sığdığı en uzun yatay parçanın ortasına; dikey bir bağlantıda çizginin sağına; yer yoksa gizli
        const pts = R[e.id], tw = e.label.length * 6.3 + 10;
        let best = null, bl = -1;
        for (let i = 1; i < pts.length; i++) { const l = Math.abs(pts[i][0] - pts[i - 1][0]); if (l > bl && l >= tw && Math.abs(pts[i][1] - pts[i - 1][1]) < 1) { bl = l; best = [pts[i - 1], pts[i]]; } }
        const a = pts[0], b = pts[pts.length - 1], vertical = pts.length === 2 && Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) > 24;
        let x = null, y = null;
        if (best) { x = (best[0][0] + best[1][0]) / 2 - (tw - 10) / 2; y = (best[0][1] + best[1][1]) / 2 - 6; }
        else if (vertical) { x = a[0] + 8; y = (a[1] + b[1]) / 2 + 3; }
        if (x == null || x < 2 || x + tw - 10 > r.W - 2) { e.labelEl.style.display = 'none'; }
        else { e.labelEl.style.display = ''; e.labelEl.setAttribute('x', x.toFixed(1)); e.labelEl.setAttribute('y', y.toFixed(1)); }
      }
    });
  }

  // ------------------------------------------------------------------ paket animasyonu
  function travel(id, reverse, cls, dur) {
    return new Promise((res) => {
      if (G.reduce || dur <= 0) return res();
      const path = edgeEl[id], L = path.getTotalLength();
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'pkt ' + (cls || ''));
      g.innerHTML = '<circle class="pkt-halo" r="9"/><circle class="pkt-core" r="4"/>';
      svg.appendChild(g);
      edgeLive[id]++; path.classList.add('live'); if (cls === 'err') path.classList.add('err');
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const p = path.getPointAtLength((reverse ? 1 - e : e) * L);
        g.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
        if (k < 1) requestAnimationFrame(step);
        else { g.remove(); if (--edgeLive[id] <= 0) { edgeLive[id] = 0; path.classList.remove('live', 'err'); } res(); }
      };
      requestAnimationFrame(step);
    });
  }
  let burstScale = 1;
  const vis = (ms) => Math.max(200, Math.min(1000, 210 + ms * 5)) * burstScale;
  function ping(k, cls) { const el = nodeEl[k]; el.classList.add(cls || 'ping'); setTimeout(() => el.classList.remove(cls || 'ping'), 420); }
  function badge(k, kind, txt) {
    const b = $('.node-badge', nodeEl[k]); b.className = 'node-badge ' + kind; b.textContent = txt; b.hidden = false;
    clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true; }, 1600);
  }

  // ------------------------------------------------------------------ bir istek
  const DBN = { mssql: 'MSSQL', mongo: 'MongoDB' };
  function takeToken() {   // token bucket: zamanla dolar, her istek bir jeton harcar
    const now = Date.now(), b = S.bucket;
    b.tokens = Math.min(RL.cap, b.tokens + (now - b.at) / 1000 * RL.rate); b.at = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }
  const retryAfter = () => Math.max(1, Math.ceil((1 - S.bucket.tokens) / RL.rate));
  async function request(id, opts) {
    opts = opts || {};
    const route = ROUTES[S.route], method = opts.method || S.method;
    if (id == null) id = S.idMode === 'random' ? 1 + Math.floor(Math.random() * 8) : 42;
    const key = route.key(id), trace = rid(16), path = route.path(id);
    const t = { net: rnd(8, 16), cache: rnd(0.3, 1.2), api: rnd(0.8, 2.5), set: rnd(0.3, 0.9) };
    const dbMs = () => (route.db === 'mssql' ? rnd(18, 46) : rnd(10, 30)) * (S.slow ? rnd(7, 11) : 1) * (method === 'PUT' ? 1.4 : 1);
    const steps = [], spans = [];
    let clock = 0, status = method === 'PUT' ? 204 : 200, hit = false, fastFail = false, coalesced = false, retries = 0, attempts = 0;
    const sp = (name, svc, ms, extra) => { const x = Object.assign({ name, svc, start: clock, ms }, extra || {}); spans.push(x); clock += ms; return x; };
    S.inflight++; S.counts.req++; updateStats();
    ping('client');
    await travel('client-api', false, '', vis(t.net)); sp(method + ' ' + path, 'net', t.net);
    steps.push({ k: 'net', ms: t.net, method });
    ping('api');

    // Veritabanı çağrısı: devre kesici kapısı, kaos (yavaş / kapalı / dalgalı), Polly yeniden deneme
    async function dbCall(kind) {
      const db = route.db, br = S.br[db], edge = route.edge, max = S.retry ? 1 + RETRY.max : 1;
      for (let attempt = 1; attempt <= max; attempt++) {
        const now = Date.now();
        if (S.cb && ((br.state === 'open' && now < br.until) || (br.state === 'half' && br.trial))) {
          ping('api', 'fail'); badge(db, 'err', 'CB OPEN');
          const ff = rnd(0.6, 1.8); fastFail = true;
          steps.push({ k: 'cb', ms: ff, db, left: Math.max(0, br.until - now) }); sp('circuit open → ' + DBN[db], 'api', ff, { err: true });
          return false;
        }
        let trial = false;
        if (S.cb && br.state === 'open') { br.state = 'half'; br.trial = true; trial = true; breakerLog(db, 'half'); }
        attempts++;
        const q = kind === 'write' ? route.write(id) : route.query(id);
        let fail = null, ms;
        if (S.down) {
          await travel(edge, false, 'err', vis(60)); ping(db, 'fail'); badge(db, 'err', 'TIMEOUT');
          await sleep(G.reduce ? 0 : 500 * burstScale); ms = 1000; fail = 'timeout';
        } else if (S.flaky && Math.random() < 0.5) {
          ms = rnd(25, 60);
          await travel(edge, false, 'err', vis(ms / 2)); ping(db, 'fail'); badge(db, 'err', 'ERR'); await travel(edge, true, 'err', vis(ms / 2));
          fail = 'transient';
        } else {
          ms = dbMs();
          await travel(edge, false, '', vis(ms / 2)); ping(db); await travel(edge, true, 'db', vis(ms / 2));
          S.counts[db]++; S.counts[db + 'Ms'] += ms;
        }
        G.metrics.inc('garage_sim_db_queries_total', { db, op: kind, result: fail ? 'error' : 'ok' });
        steps.push({ k: kind === 'write' ? 'write' : 'db', ms, db, q, trial, fail, attempt, max });
        sp((attempt > 1 ? '#' + attempt + ' ' : '') + q, 'db', ms, { err: !!fail, db });
        if (!fail) {
          if (S.cb) { if (trial) { br.trial = false; br.state = 'closed'; breakerLog(db, 'closed'); steps.push({ k: 'cbclosed', db }); } if (br.state === 'closed') br.fails = 0; }
          return true;
        }
        if (S.cb) {
          if (trial) { br.trial = false; openBreaker(db); steps.push({ k: 'cbopen', db, trial: true }); return false; }
          if (br.state === 'closed' && ++br.fails >= CB_LIMIT) { openBreaker(db); steps.push({ k: 'cbopen', db }); return false; }
        }
        if (attempt < max) {   // üstel geri çekilme + jitter: 80, 160, 320 ms (+ 0–80 ms rastgele)
          const wait = RETRY.base * Math.pow(2, attempt - 1) + Math.random() * RETRY.base;
          retries++; S.counts.retries++;
          steps.push({ k: 'backoff', ms: wait, attempt });
          sp('retry backoff #' + attempt, 'wait', wait);
          G.metrics.inc('garage_sim_retries_total', { db });
          await sleep(G.reduce ? 0 : Math.min(650, wait * 2) * burstScale);
        }
      }
      return false;
    }

    if (S.rl && !takeToken()) {
      // 1) hız sınırı: jeton yok → 429, ne önbelleğe ne veritabanına gidilir
      status = 429; S.counts.limited++;
      const ra = retryAfter();
      ping('api', 'fail'); badge('api', 'err', '429');
      steps.push({ k: 'rl', ms: 0.4, retryAfter: ra }); sp('rate limit: 429', 'api', 0.4, { err: true });
      G.metrics.inc('garage_sim_rate_limited_total', {});
    } else if (method === 'PUT') {
      // 2) yazma: önce veritabanı, sonra önbellekteki kopya silinir (cache invalidation)
      const ok = await dbCall('write');
      if (ok) {
        await travel('api-redis', false, '', vis(t.set));
        const existed = G.redis.del(key) > 0;
        ping('redis'); badge('redis', 'miss', 'DEL');
        steps.push({ k: 'del', ms: t.set, key, existed }); sp('DEL ' + key, 'redis', t.set);
      } else status = 503;
    } else {
      // 3) okuma: cache-aside
      await travel('api-redis', false, '', vis(t.cache));
      hit = G.redis.get(key) != null;
      ping('redis'); badge('redis', hit ? 'hit' : 'miss', hit ? 'HIT' : 'MISS');
      await travel('api-redis', true, hit ? 'hit' : '', vis(t.cache));
      steps.push({ k: 'cache', ms: t.cache, hit, key }); sp('GET ' + key + (hit ? ' → HIT' : ' → MISS'), 'redis', t.cache, { hit });
      if (hit) { S.counts.hit++; G.metrics.inc('garage_sim_cache_hits_total', { route: S.route }); }
      else {
        S.counts.miss++; G.metrics.inc('garage_sim_cache_misses_total', { route: S.route });
        if (S.sf && S.flights[key]) {
          // tek uçuş (request coalescing): aynı anahtar için yoldaki sorgunun sonucunu bekle
          coalesced = true; S.counts.coalesced++;
          const res = await S.flights[key];
          const waited = Math.max(1, res.ms * rnd(0.35, 0.8));
          steps.push({ k: 'sf', ms: waited, key, ok: res.ok }); sp('single-flight wait: ' + key, 'wait', waited);
          G.metrics.inc('garage_sim_coalesced_total', {});
          if (!res.ok) status = 503;
        } else {
          let done = null;
          if (S.sf) { const f = new Promise((r) => { done = r; }); S.flights[key] = f; }
          const c0 = clock, ok = await dbCall('read');
          if (ok) {
            G.redis.set(key, route.value(id), S.ttl);
            travel('api-redis', false, 'db', vis(t.set) * 0.8);
            steps.push({ k: 'set', ms: t.set, key, ttl: S.ttl }); sp('SET ' + key + ' EX ' + S.ttl, 'redis', t.set);
          } else status = 503;
          if (done) { done({ ok, ms: clock - c0 }); delete S.flights[key]; }
        }
      }
    }
    sp(G.t('işleyici (controller)', 'handler (controller)'), 'api', t.api);
    await travel('client-api', true, status >= 500 || status === 429 ? 'err' : hit ? 'hit' : 'db', vis(t.net)); sp(status + ' → ' + G.t('istemci', 'client'), 'net', t.net);
    const total = clock;
    ping('client', status >= 500 || status === 429 ? 'fail' : 'ping');
    steps.push({ k: 'resp', ms: total, status, method });
    if (status >= 500) S.counts.err++;
    S.inflight--;
    // gözlem: log Graylog'a itilir, metrikler sayılır
    travel('api-graylog', false, 'obs', 420).then(() => ping('graylog'));
    const level = status >= 500 ? 'ERROR' : status === 429 || total > 250 ? 'WARN' : 'INFO';
    const gelf = { version: '1.1', host: 'api-01', short_message: method + ' ' + path + ' ' + status + ' ' + total.toFixed(1) + 'ms', timestamp: +(Date.now() / 1000).toFixed(3), level: { INFO: 6, WARN: 4, ERROR: 3 }[level],
      _trace_id: trace, _method: method, _route: route.path('{id}'), _status: status, _elapsed_ms: +total.toFixed(2), _cache: method === 'PUT' ? 'DEL' : status === 429 ? null : hit ? 'HIT' : coalesced ? 'COALESCED' : 'MISS', _db: hit || status === 429 ? null : route.db };
    if (attempts > 1) gelf._attempts = attempts;
    if (retries) gelf._retries = retries;
    if (status === 429) gelf._retry_after = steps.find((x) => x.k === 'rl').retryAfter;
    if (status >= 500) gelf.full_message = (fastFail ? 'Polly.CircuitBreaker.BrokenCircuitException: The circuit is now open and is not allowing calls.' : S.flaky && !S.down ? (route.db === 'mssql' ? 'Microsoft.Data.SqlClient.SqlException: A transport-level error has occurred.' : 'MongoDB.Driver.MongoConnectionException: An exception occurred while receiving a message from the server.') + (S.retry ? ' Retries exhausted.' : '') : route.db === 'mssql' ? 'Microsoft.Data.SqlClient.SqlException: Execution Timeout Expired.' : 'MongoDB.Driver.MongoConnectionException: An exception occurred while opening a connection.') + ' (simulated)';
    if (fastFail) gelf._circuit = 'open';
    pushLog(level, gelf);
    G.metrics.inc('garage_sim_http_requests_total', { route: route.path('{id}'), method, status: String(status) });
    G.metrics.observe('garage_sim_request_duration_seconds', { route: route.path('{id}') }, total / 1000);
    G.log(level.toLowerCase(), 'sim ' + method + ' ' + path + ' ' + status, { ms: +total.toFixed(1), cache: gelf._cache, trace: trace.slice(0, 8), retries: retries || undefined });
    S.lat.push({ ms: total, hit, status }); if (S.lat.length > 40) S.lat.shift();
    S.last = { path, steps, total, status, hit, route: S.route, method, coalesced, retries };
    // Veri Odası için: bu sekmede gönderilen istekler (sim_requests tablosu / koleksiyonu)
    const rec = G.store.json('garage-sim-req-v1', true) || [];
    rec.push({ ts: Date.now(), method, path, route: route.path('{id}'), status, cache: gelf._cache, db: gelf._db, ms: +total.toFixed(2), trace });
    if (rec.length > 300) rec.splice(0, rec.length - 300);
    G.store.setJson('garage-sim-req-v1', rec, true);
    // iz (trace): son 30 istek
    S.traces.unshift({ id: trace, method, path, status, total, spans, at: Date.now(), hit, coalesced, retries });
    if (S.traces.length > 30) S.traces.pop();
    renderTrace();
    G.sfx('blip', status >= 500 || status === 429 ? false : hit ? 'hit' : true);
    announce(status + ' · ' + fmt(total) + ' · ' + (status === 429 ? G.t('hız sınırı', 'rate limited') : hit ? G.t('önbellek isabeti', 'cache hit') : status >= 500 ? G.t('hata', 'error') : method === 'PUT' ? G.t('yazıldı, önbellek silindi', 'written, cache invalidated') : G.t('veritabanından', 'from the database')));
    renderStory(); updateStats();
    return { status, hit, coalesced, total };
  }
  function breakerLog(db, state) {
    const DB = { mssql: 'MSSQL', mongo: 'MongoDB' }[db];
    const msg = { open: 'circuit breaker OPEN for ' + DB + ' — calls blocked for ' + CB_OPEN_MS / 1000 + 's', half: 'circuit breaker HALF-OPEN for ' + DB + ' — sending one trial request', closed: 'circuit breaker CLOSED for ' + DB + ' — traffic back to normal' }[state];
    pushLog(state === 'open' ? 'WARN' : 'INFO', { version: '1.1', host: 'api-01', short_message: msg, timestamp: +(Date.now() / 1000).toFixed(3), level: state === 'open' ? 4 : 6, _breaker: db, _state: state });
    G.log(state === 'open' ? 'warn' : 'info', 'sim ' + msg, {});
    updateStats();
  }
  function openBreaker(db) {
    const br = S.br[db];
    br.state = 'open'; br.until = Date.now() + CB_OPEN_MS; br.fails = 0; br.trial = false;
    G.metrics.inc('garage_sim_breaker_open_total', { db });
    breakerLog(db, 'open');
  }
  async function burst(n) {   // yük testi: 1–8 arası rastgele kullanıcılar, kısa aralıklarla
    burstScale = 0.6;
    const jobs = [];
    for (let i = 0; i < n; i++) { jobs.push(request(1 + Math.floor(Math.random() * 8), { method: 'GET' })); await sleep(G.reduce ? 0 : 110); }
    const rs = await Promise.all(jobs); burstScale = 1;
    const lim = rs.filter((r) => r.status === 429).length;
    if (lim) G.toast(G.t(n + ' isteğin ' + lim + ' tanesi hız sınırına takıldı (429)', lim + ' of ' + n + ' requests were rate limited (429)'), 'shield');
  }
  // Önbellek fırtınası: soğuk bir anahtara aynı anda 20 istek. Tek uçuş kapalıysa hepsi veritabanına gider.
  async function stampede(n) {
    const route = ROUTES[S.route], key = route.key(42), db = route.db;
    G.redis.del(key);
    const before = S.counts[db], coal = S.counts.coalesced;
    pushLog('WARN', { version: '1.1', host: 'loadgen', short_message: 'stampede: ' + n + ' concurrent GET ' + route.path(42) + ' on a cold key', timestamp: +(Date.now() / 1000).toFixed(3), level: 4, _single_flight: S.sf });
    burstScale = 0.6;
    await Promise.all(Array.from({ length: n }, (_, i) => sleep(G.reduce ? 0 : i * 6).then(() => request(42, { method: 'GET' }))));
    burstScale = 1;
    const q = S.counts[db] - before, c = S.counts.coalesced - coal;
    G.toast(S.sf ? G.t(n + ' istek → ' + q + ' veritabanı sorgusu, ' + c + ' istek bekleyip aynı sonucu aldı (tek uçuş)', n + ' requests → ' + q + ' database queries, ' + c + ' waited for the same result (single-flight)')
      : G.t(n + ' istek → ' + q + ' veritabanı sorgusu: önbellek fırtınası. “Tek uçuş”u açıp tekrar dene.', n + ' requests → ' + q + ' database queries: a cache stampede. Turn on “single-flight” and try again.'), 'zap');
  }
  // Geçersiz kılma: GET (ıska/isabet) → GET (isabet) → PUT (yaz + DEL) → GET (yine ıska)
  async function invalidation() {
    const seq = ['GET', 'GET', 'PUT', 'GET'];
    for (const m of seq) { await request(42, { method: m }); await sleep(G.reduce ? 0 : 350); }
    G.toast(G.t('PUT veriyi değiştirdi ve önbellekteki eski kopyayı sildi; sonraki GET yeniden veritabanına gitti.', 'The PUT changed the data and deleted the stale cached copy; the next GET went back to the database.'), 'refresh');
  }

  // ------------------------------------------------------------------ Prometheus kazıması → Grafana
  async function scrape() {
    if (document.hidden) return;
    await travel('prom-api', false, 'obs', 360); ping('api');
    await travel('prom-api', true, 'obs', 360); ping('prometheus');
    S.scrape = { at: Date.now(), snap: { lat: S.lat.slice(), counts: Object.assign({}, S.counts) } };
    await travel('prom-grafana', false, 'obs', 300); ping('grafana');
    renderGrafana();
  }
  setInterval(scrape, 2000);

  // ------------------------------------------------------------------ paneller
  const live = $('#bpLive');
  const announce = (m) => { if (live) live.textContent = m; };
  function p95(list) { if (!list.length) return 0; const s = list.map((x) => x.ms).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; }
  function updateStats() {
    const c = S.counts, total = c.hit + c.miss, ratio = total ? Math.round(c.hit / total * 100) : 0, p = p95(S.lat.slice(-20));
    const set = (k, v) => { $('.node-stat', nodeEl[k]).textContent = v; };
    set('client', G.t('istek: ', 'requests: ') + c.req);
    set('api', (S.inflight ? G.t('işlemde: ', 'in flight: ') + S.inflight + ' · ' : '') + 'p95 ' + (p ? fmt(p) : '—'));
    set('redis', G.t('anahtar: ', 'keys: ') + G.redis.keys('cache:*').length + ' · ' + G.t('isabet %' + ratio, 'hit ' + ratio + '%'));
    ['mssql', 'mongo'].forEach((db) => {
      const br = S.br[db], open = S.cb && br.state === 'open' && Date.now() < br.until;
      const cb = !S.cb ? '' : 'CB\u00a0' + (open ? G.t('AÇIK ', 'OPEN ') + Math.ceil((br.until - Date.now()) / 1000) + G.t('\u00a0sn', 's') : br.state === 'half' || (br.state === 'open') ? G.t('YARI\u00a0AÇIK', 'HALF-OPEN') : G.t('kapalı', 'closed'));
      const main = S.down ? G.t('KAPALI', 'DOWN') : G.t('sorgu: ', 'queries: ') + c[db] + (c[db] ? ' · ' + G.t('ort ', 'avg ') + fmt(c[db + 'Ms'] / c[db]) : '');
      const st = $('.node-stat', nodeEl[db]);
      // dar ekranda CB durumu kendi satırına iner (CSS: .node-stat .cb)
      if (cb) st.innerHTML = esc(main) + '<span class="cb"><span class="sep"> · </span>' + esc(cb) + '</span>'; else st.textContent = main;
      edgeEl['api-' + db].classList.toggle('cut', open);
      nodeEl[db].classList.toggle('tripped', open);
    });
    set('graylog', G.t('kayıt: ', 'entries: ') + S.gl.length);
    set('prometheus', S.scrape.at ? G.t('son kazıma: ', 'last scrape: ') + ((Date.now() - S.scrape.at) / 1000).toFixed(1) + G.t(' sn', 's') : 'scrape: 2s');
    set('grafana', S.alert ? 'ALERT · p95 ' + fmt(p) : 'p95 ' + (p ? fmt(p) : '—'));
    nodeEl.mssql.classList.toggle('down', S.down); nodeEl.mongo.classList.toggle('down', S.down);
    if (S.selected) renderInspectorStats();
  }
  setInterval(() => { if (!document.hidden) updateStats(); }, 500);

  function renderGrafana() {
    const snap = S.scrape.snap || { lat: [], counts: S.counts };
    const L = snap.lat, c = snap.counts, tot = c.hit + c.miss;
    const p = p95(L.slice(-20)), errs = c.err;
    $('#gReq').textContent = c.req;
    $('#gHit').textContent = tot ? Math.round(c.hit / tot * 100) + '%' : '—';
    $('#gP95').textContent = p ? Math.round(p) + ' ms' : '—';
    $('#gErr').textContent = errs;
    $('#gErr').parentElement.classList.toggle('warn', errs > 0);
    $('#gP95').parentElement.classList.toggle('warn', p > 250);
    // grafik: son 40 isteğin süresi (çubuk) + p95 çizgisi
    const svg = $('#gChart'), W = Math.max(240, Math.round(svg.clientWidth || 400)), H = Math.max(110, Math.round(svg.clientHeight || 150));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const pad = 22, max = Math.max(120, ...L.map((x) => x.ms)) * 1.1, bw = (W - pad) / 40;
    let s = '';
    [0.25, 0.5, 0.75, 1].forEach((f) => { const y = H - 14 - (H - 24) * f; s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="rgba(255,255,255,.06)"/><text x="0" y="' + (y + 3) + '" fill="#7d838c" font-size="9" font-family="JetBrains Mono">' + Math.round(max * f) + '</text>'; });
    L.forEach((x, i) => {
      const h = Math.max(2, (H - 24) * (x.ms / max)), xx = pad + i * bw + 1, y = H - 14 - h;
      const col = x.status >= 500 ? '#FF6B61' : x.status === 429 ? '#F2B33D' : x.hit ? '#4FD18B' : '#6CB6FF';
      s += '<rect x="' + xx.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + col + '" opacity=".9"/>';
    });
    if (!L.length) s += '<text x="' + ((W + pad) / 2) + '" y="' + (H / 2 - 4) + '" text-anchor="middle" fill="#7d838c" font-size="11" font-family="JetBrains Mono">' + G.t('veri yok — bir istek gönder', 'no data — send a request') + '</text>';
    if (p) { const y = H - 14 - (H - 24) * (p / max); s += '<line x1="' + pad + '" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#F2B33D" stroke-dasharray="4 4"/><text x="' + (W - 2) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end" fill="#F2B33D" font-size="10" font-family="JetBrains Mono">p95 ' + Math.round(p) + ' ms</text>'; }
    s += '<text x="' + pad + '" y="' + (H - 2) + '" fill="#7d838c" font-size="9" font-family="JetBrains Mono">' + G.t('son 40 istek · ms', 'last 40 requests · ms') + '</text>';
    svg.innerHTML = s;
    // uyarı kuralı: p95(son 20) > 250 ms
    const firing = L.length >= 5 && p > 250;
    if (firing !== S.alert) {
      S.alert = firing;
      $('#gAlert').classList.toggle('on', firing);
      nodeEl.grafana.classList.toggle('fail', firing);
      const msg = firing ? 'alert FIRING: HighLatency p95=' + Math.round(p) + 'ms > 250ms' : 'alert RESOLVED: HighLatency';
      pushLog(firing ? 'WARN' : 'INFO', { version: '1.1', host: 'grafana', short_message: msg, timestamp: +(Date.now() / 1000).toFixed(3), level: firing ? 4 : 6, _rule: 'HighLatency', _expr: 'histogram_quantile(0.95, …) > 0.25' });
      G.log(firing ? 'warn' : 'info', 'sim ' + msg, {});
    }
    $('#gAgo').textContent = G.t('son kazıma: az önce', 'last scrape: just now');
  }

  const glList = $('#glList'), glSearch = $('#glSearch');
  function pushLog(level, gelf) {
    S.gl.unshift({ level, gelf, t: new Date() });
    if (S.gl.length > 80) S.gl.pop();
    renderGraylog();
  }
  function renderGraylog() {
    const q = (glSearch.value || '').toLowerCase();
    const items = S.gl.filter((x) => !q || (x.level + ' ' + JSON.stringify(x.gelf)).toLowerCase().includes(q));
    if (!items.length) { glList.innerHTML = '<li class="redis-empty" style="border:0">' + (S.gl.length ? G.t('eşleşen kayıt yok', 'no matching entries') : G.t('henüz kayıt yok — bir istek gönder', 'no entries yet — send a request')) + '</li>'; return; }
    glList.innerHTML = items.slice(0, 50).map((x, i) => '<li><button type="button" aria-expanded="false" data-i="' + i + '"><span class="tm">' + x.t.toLocaleTimeString('en-GB') + '</span><span class="lv ' + x.level + '">' + x.level + '</span><span>' + esc(x.gelf.short_message) + '</span></button></li>').join('');
    glList._items = items;
  }
  glSearch.addEventListener('input', renderGraylog);
  glList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const li = b.parentElement, open = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!open));
    const pre = li.querySelector('pre');
    if (open && pre) pre.remove();
    else if (!open) { const p = document.createElement('pre'); p.textContent = JSON.stringify(glList._items[+b.dataset.i].gelf, null, 2); li.appendChild(p); }
  });

  const redisList = $('#redisList');
  function renderRedis() {
    const es = G.redis.entries().filter((x) => x.k.startsWith('cache:'));
    if (!es.length) { redisList.innerHTML = '<li class="redis-empty">' + G.t('Önbellek boş. İlk istek her zaman veritabanına gider (ıska).', 'The cache is empty. The first request always goes to the database (miss).') + '</li>'; return; }
    redisList.innerHTML = es.map((x) => '<li><span class="k">' + esc(x.k) + '</span><span class="t">' + (x.ttl > 0 ? (x.ttl / 1000).toFixed(1) + 's' : '∞') + '</span><span class="bar"><i style="transform:scaleX(' + (x.max ? Math.max(0, x.ttl / x.max) : 1).toFixed(3) + ')"></i></span></li>').join('');
  }
  setInterval(() => { if (!document.hidden) renderRedis(); }, 200);

  function renderStory() {
    const box = $('#story');
    const L = S.last;
    if (!L) {
      box.innerHTML = '<li>' + G.t('Bir istek gönder: mobil uygulama API’ye <code>GET /api/users/42</code> der.', 'Send a request: the mobile app calls <code>GET /api/users/42</code> on the API.') + '</li><li>' +
        G.t('API önce Redis’e bakar. İlk seferde anahtar yoktur: <span class="tag-miss">ISKA</span>.', 'The API checks Redis first. The first time the key is missing: <span class="tag-miss">MISS</span>.') + '</li><li>' +
        G.t('Veri veritabanından okunur ve TTL ile önbelleğe yazılır. Aynı isteği tekrar gönder: <span class="tag-hit">İSABET</span>, veritabanına hiç gidilmez.', 'Data is read from the database and cached with a TTL. Send the same request again: <span class="tag-hit">HIT</span>, the database is never touched.') + '</li>';
      return;
    }
    const DB = { mssql: 'MSSQL', mongo: 'MongoDB' };
    box.innerHTML = L.steps.map((s) => {
      if (s.k === 'net') return '<li>' + G.t('İstemci → API: ', 'Client → API: ') + '<code>' + esc((s.method || 'GET') + ' ' + L.path) + '</code> <span class="ms">' + fmt(s.ms) + G.t(' ağ', ' network') + '</span></li>';
      if (s.k === 'rl') return '<li><span class="tag-err">429 Too Many Requests</span> — ' + G.t('hız sınırı: jeton kovası boş (10 istek, saniyede 2 dolum). İstek önbelleğe de veritabanına da gitmedi; ', 'rate limit: the token bucket is empty (10 requests, refills 2 per second). The request reached neither the cache nor the database; ') + '<code>Retry-After: ' + s.retryAfter + '</code></li>';
      if (s.k === 'write') return '<li>' + (s.max > 1 ? '<span class="tag-miss">' + G.t('Deneme ', 'Attempt ') + s.attempt + '/' + s.max + '</span> ' : '') + G.t('API → ', 'API → ') + DB[s.db] + ' ' + G.t('(yazma)', '(write)') + ': <code>' + esc(s.q) + '</code> ' + (s.fail ? '→ <span class="tag-err">' + (s.fail === 'timeout' ? G.t('1000 ms zaman aşımı', '1000 ms timeout') : G.t('geçici hata', 'transient error')) + '</span>' : '<span class="ms">' + fmt(s.ms) + '</span>') + '</li>';
      if (s.k === 'del') return '<li>' + G.t('API → Redis: ', 'API → Redis: ') + '<code>DEL ' + esc(s.key) + '</code> — ' + (s.existed ? G.t('eski kopya silindi; sonraki okuma veritabanından taze gelecek.', 'the stale copy was deleted; the next read will come fresh from the database.') : G.t('önbellekte kopya yoktu, silinecek bir şey çıkmadı.', 'there was no cached copy to delete.')) + ' <span class="ms">' + fmt(s.ms) + '</span></li>';
      if (s.k === 'sf') return '<li><span class="tag-hit">' + G.t('Tek uçuş', 'Single-flight') + '</span>: ' + G.t('aynı anahtar için yolda bir sorgu vardı; bu istek veritabanına gitmeden onun sonucunu bekledi.', 'a query for the same key was already in flight; this request waited for its result instead of hitting the database.') + ' <span class="ms">' + fmt(s.ms) + '</span></li>';
      if (s.k === 'backoff') return '<li>' + G.t('Polly yeniden deneme: ', 'Polly retry: ') + '<span class="ms">' + fmt(s.ms) + G.t(' bekle (üstel geri çekilme + jitter)', ' wait (exponential backoff + jitter)') + '</span></li>';
      if (s.k === 'cache') return '<li>' + G.t('API → Redis: ', 'API → Redis: ') + '<code>GET ' + esc(s.key) + '</code> → ' + (s.hit ? '<span class="tag-hit">' + G.t('İSABET', 'HIT') + '</span>' : '<span class="tag-miss">' + G.t('ISKA', 'MISS') + '</span>') + ' <span class="ms">' + fmt(s.ms) + '</span></li>';
      if (s.k === 'db') return '<li>' + (s.trial ? '<span class="tag-miss">' + G.t('Deneme isteği (yarı açık)', 'Trial request (half-open)') + '</span> ' : s.max > 1 ? '<span class="tag-miss">' + G.t('Deneme ', 'Attempt ') + s.attempt + '/' + s.max + '</span> ' : '') + G.t('API → ', 'API → ') + DB[s.db] + ': <code>' + esc(s.q) + '</code> ' + (s.fail ? '→ <span class="tag-err">' + (s.fail === 'timeout' ? G.t('1000 ms zaman aşımı', '1000 ms timeout') : G.t('geçici hata (bağlantı koptu)', 'transient error (connection dropped)')) + '</span> <span class="ms">' + fmt(s.ms) + '</span>' : '<span class="ms">' + fmt(s.ms) + '</span>') + '</li>';
      if (s.k === 'set') return '<li>' + G.t('API → Redis: ', 'API → Redis: ') + '<code>SET ' + esc(s.key) + ' … EX ' + s.ttl + '</code> <span class="ms">' + fmt(s.ms) + '</span></li>';
      if (s.k === 'cb') return '<li>' + G.t('API → ', 'API → ') + DB[s.db] + ': <span class="tag-err">' + G.t('devre kesici AÇIK', 'circuit breaker OPEN') + '</span> — ' + G.t('istek veritabanına hiç gönderilmedi, hemen hata döndü', 'the request never reached the database; it failed fast') + ' <span class="ms">' + fmt(s.ms) + G.t(' · kalan ', ' · ') + (s.left / 1000).toFixed(1) + G.t(' sn', ' s left') + '</span></li>';
      if (s.k === 'cbopen') return '<li><span class="tag-err">' + G.t('Devre kesici AÇILDI', 'Circuit breaker OPENED') + '</span>: ' + (s.trial ? G.t('deneme isteği de başarısız oldu. ', 'the trial request failed too. ') : G.t('üst üste ' + CB_LIMIT + '. hata. ', CB_LIMIT + ' failures in a row. ')) + G.t(CB_OPEN_MS / 1000 + ' sn boyunca ' + DB[s.db] + '’e istek gönderilmeyecek.', 'No calls to ' + DB[s.db] + ' for ' + CB_OPEN_MS / 1000 + ' s.') + '</li>';
      if (s.k === 'cbclosed') return '<li><span class="tag-hit">' + G.t('Devre kesici KAPANDI', 'Circuit breaker CLOSED') + '</span>: ' + G.t('deneme isteği başarılı, trafik normale döndü.', 'the trial request succeeded; traffic is back to normal.') + '</li>';
      return '<li>' + G.t('API → İstemci: ', 'API → Client: ') + '<code>' + s.status + ' ' + ({ 200: 'OK', 204: 'No Content', 429: 'Too Many Requests', 503: 'Service Unavailable' }[s.status] || '') + '</code> — ' + G.t('toplam ', 'total ') + '<b>' + fmt(L.total) + '</b>' +
        (L.hit ? G.t('. Veritabanına hiç gidilmedi.', '. The database was never touched.') : L.coalesced ? G.t('. Veritabanına bu istek için ayrıca gidilmedi.', '. No extra database call for this request.') : '') + (L.retries ? G.t(' · ' + L.retries + ' yeniden deneme', ' · ' + L.retries + (L.retries === 1 ? ' retry' : ' retries')) : '') + '</li>';
    }).join('') + '<li>' + G.t('Log Graylog’a itildi; sayaçlar bir sonraki Prometheus kazımasında Grafana’ya yansır.', 'The log was pushed to Graylog; counters reach Grafana on the next Prometheus scrape.') + '</li>';
  }

  // ------------------------------------------------------------------ iz (trace) zaman çizelgesi — Jaeger / Tempo görünümü
  const TR_COL = { api: '#3987e5', redis: '#d95926', db: '#199e70', wait: '#c98500', net: '#5b6170' };
  const traceSel = $('#traceSel'), traceSvg = $('#traceSvg'), traceWrap = $('#traceWrap');
  const niceStep = (span, n) => { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; };
  const svcName = (r) => (r.root ? 'api-01' : r.svc === 'db' ? (r.db || ROUTES[S.route].db) : r.svc === 'redis' ? 'redis-01' : r.svc === 'wait' ? 'polly' : r.svc === 'net' ? 'http' : 'api-01');
  function renderTraceSel() {
    if (!traceSel) return;
    traceSel.innerHTML = '<option value="">' + esc(G.t('son istek (canlı)', 'latest request (live)')) + '</option>' +
      S.traces.map((x) => '<option value="' + x.id + '"' + (x.id === S.pinned ? ' selected' : '') + '>' + esc(new Date(x.at).toLocaleTimeString('en-GB') + ' · ' + x.method + ' ' + x.path + ' · ' + x.status + ' · ' + Math.round(x.total) + ' ms') + '</option>').join('');
    traceSel.disabled = !S.traces.length;
  }
  function renderTrace() {
    if (!traceSvg) return;
    renderTraceSel();
    const tr = (S.pinned && S.traces.find((x) => x.id === S.pinned)) || S.traces[0], meta = $('#traceMeta');
    if (!tr) { traceSvg.setAttribute('viewBox', '0 0 600 40'); traceSvg.setAttribute('height', '40'); traceSvg.innerHTML = ''; meta.textContent = G.t('Bir istek gönder: her adımı burada zaman çizelgesinde göreceksin.', 'Send a request: every step shows up here on a timeline.'); return; }
    meta.textContent = 'trace_id ' + tr.id + ' · ' + tr.method + ' ' + tr.path + ' · ' + tr.status + ' · ' + fmt(tr.total);
    const rows = [{ name: tr.method + ' ' + tr.path, svc: 'api', start: 0, ms: tr.total, root: true, err: tr.status >= 500 || tr.status === 429 }].concat(tr.spans);
    const W = Math.max(320, Math.round(traceWrap.clientWidth || 700)), ROW = 24, TOP = 22, H = TOP + rows.length * ROW + 4;
    traceSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); traceSvg.setAttribute('height', H);
    const labW = Math.min(260, Math.round(W * 0.38)), durW = 64;
    const x = (ms) => labW + (W - labW - durW) * ms / tr.total;
    let h = '';
    const st = niceStep(tr.total, Math.max(2, Math.floor((W - labW - durW) / 90)));
    for (let ms = 0; ms <= tr.total + 1e-9; ms += st) h += '<line class="tr-g" x1="' + x(ms).toFixed(1) + '" x2="' + x(ms).toFixed(1) + '" y1="' + (TOP - 4) + '" y2="' + H + '"/><text class="tr-ax" x="' + x(ms).toFixed(1) + '" y="12" text-anchor="middle">' + (st % 1 ? ms.toFixed(1) : Math.round(ms)) + ' ms</text>';
    const maxC = Math.max(10, Math.floor((labW - 20) / 6.6));
    rows.forEach((r, i) => {
      const y = TOP + i * ROW, xa = x(r.start), w = Math.max(2, x(r.start + r.ms) - xa), ind = r.root ? 0 : 14;
      const label = svcName(r) + ' · ' + r.name, txt = label.length > maxC - (ind ? 2 : 0) ? label.slice(0, maxC - (ind ? 3 : 1)) + '…' : label;
      h += '<g class="tr-row' + (r.err ? ' err' : '') + '" data-i="' + i + '"><rect class="hit" x="0" y="' + y + '" width="' + W + '" height="' + ROW + '"/>' +
        (ind ? '<path class="tr-tree" d="M6 ' + (y - 4) + 'V' + (y + 12) + 'H12"/>' : '') +
        '<text class="tr-n" x="' + ind + '" y="' + (y + 16) + '">' + (r.err ? '✕ ' : '') + esc(txt) + '</text>' +
        '<rect class="tr-b" x="' + xa.toFixed(1) + '" y="' + (y + 6) + '" width="' + w.toFixed(1) + '" height="12" rx="2" fill="' + TR_COL[r.svc] + '"/>' +
        '<text class="tr-d" x="' + (W - 2) + '" y="' + (y + 16) + '" text-anchor="end">' + fmt(r.ms) + '</text></g>';
    });
    traceSvg.innerHTML = h;
    traceSvg._rows = rows; traceSvg._x = x; traceSvg._tr = tr;
    traceSvg.setAttribute('aria-label', G.t('İz ', 'Trace ') + tr.id + ': ' + rows.length + G.t(' adım, toplam ', ' spans, total ') + fmt(tr.total));
  }
  function traceTip(i) {
    const r = (traceSvg._rows || [])[i]; if (!r) return;
    traceSvg.querySelectorAll('.tr-row').forEach((g) => g.classList.toggle('on', +g.dataset.i === i));
    const tip = traceWrap.querySelector('.ts-tip'); if (!tip) return;
    tip.innerHTML = '<p><i style="background:' + TR_COL[r.svc] + '"></i><b>' + esc(fmt(r.ms)) + '</b><span>' + esc(G.t('süre', 'duration')) + '</span></p><p><b>' + esc(fmt(r.start)) + '</b><span>' + esc(G.t('başlangıç', 'start offset')) + '</span></p><small>' + esc(svcName(r) + ' · ' + r.name) + (r.err ? ' · ' + G.t('hata', 'error') : '') + '</small>';
    tip.hidden = false;
    const wr = traceWrap.getBoundingClientRect(), sr = traceSvg.getBoundingClientRect(), k = sr.width / traceSvg.viewBox.baseVal.width;
    let px = sr.left - wr.left + traceSvg._x(r.start + r.ms) * k + 12, py = sr.top - wr.top + (22 + i * 24) * k - tip.offsetHeight - 6;
    if (px + tip.offsetWidth > wr.width - 4) px = sr.left - wr.left + traceSvg._x(r.start) * k - tip.offsetWidth - 12;
    if (py < 0) py = sr.top - wr.top + (22 + (i + 1) * 24) * k + 6;
    tip.style.left = Math.max(2, px) + 'px'; tip.style.top = Math.max(2, py) + 'px';
  }
  const traceUntip = () => { const tip = traceWrap && traceWrap.querySelector('.ts-tip'); if (tip) tip.hidden = true; traceSvg.querySelectorAll('.tr-row.on').forEach((g) => g.classList.remove('on')); };
  if (traceSvg) {
    traceSvg.setAttribute('tabindex', '0');
    let ki = -1;
    traceSvg.addEventListener('pointermove', (e) => { const g = e.target.closest('.tr-row'); if (g) traceTip(+g.dataset.i); });
    traceSvg.addEventListener('pointerleave', traceUntip);
    traceSvg.addEventListener('keydown', (e) => { const n = (traceSvg._rows || []).length; if (!n) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ki = Math.max(0, Math.min(n - 1, ki + (e.key === 'ArrowDown' ? 1 : -1))); traceTip(ki); } });
    traceSvg.addEventListener('blur', () => { traceUntip(); ki = -1; });
  }
  if (traceSel) traceSel.addEventListener('change', () => { S.pinned = traceSel.value || null; renderTrace(); });

  function renderInspector() {
    const n = NODES[S.selected];
    $('#inspTitle').textContent = G.tx(n.name);
    $('#inspDesc').textContent = G.tx(n.desc);
    renderInspectorStats();
  }
  function renderInspectorStats() {
    const c = S.counts, k = S.selected, kv = [];
    const tot = c.hit + c.miss;
    if (k === 'client') kv.push([G.t('istek', 'requests'), c.req], [G.t('hata', 'errors'), c.err]);
    if (k === 'api') kv.push(['p95 (20)', p95(S.lat.slice(-20)) ? fmt(p95(S.lat.slice(-20))) : '—'], [G.t('işlemde', 'in flight'), S.inflight], [G.t('rota', 'route'), ROUTES[S.route].path('{id}')]);
    if (k === 'redis') kv.push([G.t('anahtar', 'keys'), G.redis.keys('cache:*').length], [G.t('isabet oranı', 'hit ratio'), tot ? Math.round(c.hit / tot * 100) + '%' : '—'], ['TTL', S.ttl + ' s']);
    if (k === 'mssql' || k === 'mongo') {
      kv.push([G.t('sorgu', 'queries'), c[k]], [G.t('ortalama', 'average'), c[k] ? fmt(c[k + 'Ms'] / c[k]) : '—'], [G.t('durum', 'state'), S.down ? G.t('kapalı', 'down') : S.slow ? G.t('yavaş', 'slow') : G.t('sağlıklı', 'healthy')]);
      if (S.cb) kv.push([G.t('devre kesici', 'circuit breaker'), { closed: G.t('kapalı (normal)', 'closed (normal)'), open: G.t('açık (istek gitmiyor)', 'open (calls blocked)'), half: G.t('yarı açık (deneme)', 'half-open (trial)') }[S.br[k].state] + ' · ' + G.t('hata ', 'failures ') + S.br[k].fails + '/' + CB_LIMIT]);
    }
    if (k === 'api') {
      const pol = [];
      if (S.retry) pol.push('retry ×' + RETRY.max + G.t(' (üstel + jitter)', ' (exponential + jitter)'));
      if (S.cb) pol.push('circuit breaker (' + CB_LIMIT + ' → ' + CB_OPEN_MS / 1000 + G.t(' sn', ' s') + ')');
      if (S.sf) pol.push('single-flight');
      if (S.rl) pol.push('rate limit ' + RL.cap + ' / ' + RL.rate + G.t('·sn', '/s'));
      if (pol.length) kv.push([G.t('politikalar', 'policies'), pol.join(' · ')]);
      if (S.counts.retries || S.counts.coalesced || S.counts.limited) kv.push([G.t('yeniden deneme / birleşen / 429', 'retries / coalesced / 429'), S.counts.retries + ' / ' + S.counts.coalesced + ' / ' + S.counts.limited]);
    }
    if (k === 'graylog') kv.push([G.t('kayıt', 'entries'), S.gl.length], ['ERROR', S.gl.filter((x) => x.level === 'ERROR').length]);
    if (k === 'prometheus') kv.push([G.t('aralık', 'interval'), '2 s'], [G.t('son kazıma', 'last scrape'), S.scrape.at ? ((Date.now() - S.scrape.at) / 1000).toFixed(1) + ' s' : '—']);
    if (k === 'grafana') kv.push([G.t('uyarı', 'alert'), S.alert ? 'FIRING' : 'OK'], [G.t('kural', 'rule'), 'p95(20) > 250 ms']);
    $('#inspKv').innerHTML = kv.map(([a, b]) => '<dt>' + esc(a) + '</dt><dd>' + esc(b) + '</dd>').join('');
  }

  // ------------------------------------------------------------------ kontroller
  function seg(id, key, cast) {
    const box = $('#' + id); if (!box) return;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      S[key] = cast ? cast(b.dataset.v) : b.dataset.v;
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      G.sfx('click'); updateStats(); renderInspectorStats();
    });
  }
  seg('segRoute', 'route'); seg('segId', 'idMode'); seg('segTtl', 'ttl', Number); seg('segMethod', 'method');
  $('#btnSend').addEventListener('click', () => request());
  $('#btnBurst').addEventListener('click', (e) => { const b = e.currentTarget; b.disabled = true; burst(20).then(() => { b.disabled = false; }); });
  $('#btnFlush').addEventListener('click', () => { G.redis.keys('cache:*').forEach((k) => G.redis.del(k)); pushLog('WARN', { version: '1.1', host: 'redis-01', short_message: 'FLUSH cache:* (manual)', timestamp: +(Date.now() / 1000).toFixed(3), level: 4 }); renderRedis(); updateStats(); G.toast(G.t('Önbellek boşaltıldı', 'Cache flushed'), 'trash'); });
  ['Slow', 'Down', 'Flaky'].forEach((n) => {
    const b = $('#chaos' + n); if (!b) return;
    b.addEventListener('click', () => {
      const k = n.toLowerCase(), v = !S[k]; S[k] = v; b.setAttribute('aria-pressed', String(v));
      if (v) ['slow', 'down', 'flaky'].filter((o) => o !== k).forEach((o) => { S[o] = false; const ob = $('#chaos' + o[0].toUpperCase() + o.slice(1)); if (ob) ob.setAttribute('aria-pressed', 'false'); });
      pushLog(v ? 'WARN' : 'INFO', { version: '1.1', host: 'chaos', short_message: (v ? 'injected: ' : 'cleared: ') + ({ slow: 'database latency ×8', down: 'database unreachable', flaky: 'database flaky (50% transient errors)' }[k]), timestamp: +(Date.now() / 1000).toFixed(3), level: v ? 4 : 6 });
      updateStats(); G.sfx('click');
    });
  });
  const POLICY = {
    retry: ['retryToggle', 'retry ×' + RETRY.max + ' with exponential backoff + jitter', ['Yeniden deneme açık: geçici hatalarda en çok 3 kez, artan aralıklarla tekrar dener', 'Retry on: up to 3 attempts on transient errors, with growing waits']],
    sf: ['sfToggle', 'single-flight (request coalescing)', ['Tek uçuş açık: aynı anahtara gelen eşzamanlı ıskalar tek sorguda birleşir', 'Single-flight on: concurrent misses for the same key share one query']],
    rl: ['rlToggle', 'rate limit ' + RL.cap + ' req, ' + RL.rate + '/s refill (token bucket)', ['Hız sınırı açık: 10 jetonluk kova, saniyede 2 dolar; fazlası 429 alır', 'Rate limit on: a 10-token bucket refilling 2 per second; the rest get 429']]
  };
  Object.keys(POLICY).forEach((k) => {
    const [id, desc, msg] = POLICY[k], b = $('#' + id); if (!b) return;
    b.addEventListener('click', () => {
      S[k] = !S[k]; b.setAttribute('aria-pressed', String(S[k]));
      if (k === 'rl') S.bucket = { tokens: RL.cap, at: Date.now() };
      pushLog('INFO', { version: '1.1', host: 'api-01', short_message: 'resilience policy ' + (S[k] ? 'enabled: ' : 'disabled: ') + desc, timestamp: +(Date.now() / 1000).toFixed(3), level: 6 });
      G.toast(S[k] ? G.t(msg[0], msg[1]) : G.t('Kapatıldı', 'Turned off'), 'shield');
      updateStats(); renderInspectorStats(); G.sfx('click');
    });
  });
  const scnBtn = (id, fn) => { const b = $('#' + id); if (b) b.addEventListener('click', () => { b.disabled = true; fn().then(() => { b.disabled = false; }); }); };
  scnBtn('scnStampede', () => stampede(20));
  scnBtn('scnInvalidate', invalidation);
  const cbBtn = $('#cbToggle');
  if (cbBtn) cbBtn.addEventListener('click', () => {
    S.cb = !S.cb; S.br = { mssql: newBreaker(), mongo: newBreaker() };
    cbBtn.setAttribute('aria-pressed', String(S.cb));
    pushLog('INFO', { version: '1.1', host: 'api-01', short_message: 'resilience policy ' + (S.cb ? 'enabled: circuit breaker (' + CB_LIMIT + ' failures → break ' + CB_OPEN_MS / 1000 + 's)' : 'disabled'), timestamp: +(Date.now() / 1000).toFixed(3), level: 6 });
    G.toast(S.cb ? G.t('Devre kesici açık: veritabanı çökerse istekler beklemeden hata döner', 'Circuit breaker on: if the database fails, requests fail fast instead of waiting') : G.t('Devre kesici kapalı', 'Circuit breaker off'), 'shield');
    updateStats(); renderInspectorStats(); G.sfx('click');
  });
  const term = $('#btnRedisCli');
  if (term) term.addEventListener('click', () => G.openTerminal('redis-cli KEYS cache:*'));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (G.topLayer && G.topLayer()) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); request(); }
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); $('#btnBurst').click(); }
  });

  // ------------------------------------------------------------------ başlat
  labelNodes(); renderInspector(); renderStory(); renderRedis(); renderGraylog(); renderGrafana(); updateStats(); renderTrace();
  requestAnimationFrame(layout);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); renderGrafana(); renderTrace(); }, 80); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  if ('ResizeObserver' in window) new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(layout, 60); }).observe(bp);
  document.addEventListener('garage:lang', () => { labelNodes(); renderInspector(); renderStory(); renderRedis(); renderGraylog(); renderGrafana(); updateStats(); renderTrace(); setTimeout(layout, 30); });
  document.addEventListener('garage:redis', () => { renderRedis(); });
})();
