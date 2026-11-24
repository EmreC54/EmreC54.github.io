// Garage — API belgesi (api.js)
// api/openapi.json'u okur ve Swagger UI tarzında çizer: etikete göre uçlar, açıklama, "Çalıştır" ile gerçek istek
// (curl satırı, istek adresi, durum, süre, boyut, başlıklar, renklendirilmiş JSON), örnek cevap ve şema görünümü.
// Türkçe metinler belgede x-summary-tr / x-description-tr alanlarında. Dış kütüphane yok.
(function () {
  'use strict';
  const G = window.GARAGE;
  const $ = (id) => document.getElementById(id);
  const opsEl = $('oasOps'), schemasEl = $('oasSchemas'), server = $('oasServer'), curlTop = $('oasCurl'), curlCopy = $('oasCurlCopy');
  if (!G || !opsEl) return;
  const esc = G.esc, T = (tr, en) => G.t(tr, en);
  const ROOT = document.body.dataset.root || '';
  let spec = null, userServer = false;
  const open = new Set(), view = {};   // açık uçlar; cevap bölümünde örnek/şema seçimi
  const last = {};                     // son gerçek cevaplar (operationId → sonuç)

  const tr = (o, key) => (G.lang() === 'tr' && o && o['x-' + key + '-tr']) || (o && o[key]) || '';
  const base = () => server.value;                                   // 'api/' ya da 'api/en/'
  const absUrl = (file) => new URL(ROOT + base() + file, location.href).href;
  const curlOf = (file) => "curl -s '" + absUrl(file) + "' -H 'accept: application/json'";

  // ------------------------------------------------------------------ JSON renklendirme
  function jh(v, ind) {
    ind = ind || '';
    if (v === null || v === undefined) return '<span class="jb">null</span>';
    if (typeof v === 'boolean') return '<span class="jb">' + v + '</span>';
    if (typeof v === 'number') return '<span class="jn">' + v + '</span>';
    if (typeof v === 'string') {
      const q = esc(JSON.stringify(v));
      return /^(https?:\/\/|mailto:)/.test(v) ? '<a class="js" href="' + esc(v) + '" target="_blank" rel="noopener">' + q + '</a>' : '<span class="js">' + q + '</span>';
    }
    const i2 = ind + '  ';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every((x) => x === null || typeof x !== 'object') && JSON.stringify(v).length < 100) return '[' + v.map((x) => jh(x)).join(', ') + ']';
      return '[\n' + v.map((x) => i2 + jh(x, i2)).join(',\n') + '\n' + ind + ']';
    }
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{\n' + ks.map((k) => i2 + '<span class="jk">' + esc(JSON.stringify(k)) + '</span>: ' + jh(v[k], i2)).join(',\n') + '\n' + ind + '}';
  }

  // ------------------------------------------------------------------ şema görünümü
  const refName = (s) => (s && s.$ref ? s.$ref.split('/').pop() : null);
  const deref = (s) => { let g = 0; while (s && s.$ref && g++ < 10) s = spec.components.schemas[refName(s)]; return s || {}; };
  function schemaHtml(s, seen, depth) {
    seen = seen || new Set(); depth = depth || 0;
    const name = refName(s), d = deref(s);
    if (name && (seen.has(name) || depth > 4)) return '<span class="sc-n">' + esc(name) + '</span>';
    const nseen = new Set(seen); if (name) nseen.add(name);
    const tail = (d.nullable ? ' <span class="sc-null">| null</span>' : '') + (d.enum ? ' <span class="sc-enum">' + d.enum.map((x) => esc(JSON.stringify(x))).join(' | ') + '</span>' : '') +
      (d.description && depth ? ' <span class="sc-d">' + esc(tr(d, 'description')) + '</span>' : '');
    if (d.type === 'array') return '<span class="sc-p">[</span>' + schemaHtml(d.items || {}, nseen, depth + 1) + '<span class="sc-p">]</span>' + tail;
    if (d.type === 'object' && d.properties) {
      const req = new Set(d.required || []);
      return (name ? '<span class="sc-n">' + esc(name) + '</span> ' : '') + '<span class="sc-p">{</span><div class="sc-props">' +
        Object.keys(d.properties).map((k) => '<div class="sc-row"><span class="sc-k">' + esc(k) + (req.has(k) ? '<sup title="' + esc(T('zorunlu', 'required')) + '">*</sup>' : '') + '</span><span class="sc-v">' + schemaHtml(d.properties[k], nseen, depth + 1) + '</span></div>').join('') +
        '</div><span class="sc-p">}</span>' + tail;
    }
    if (d.type === 'object' && d.additionalProperties) return '<span class="sc-p">{</span> <span class="sc-k">&lt;' + esc(T('anahtar', 'key')) + '&gt;</span>: ' + schemaHtml(d.additionalProperties, nseen, depth + 1) + ' <span class="sc-p">}</span>' + tail;
    if (d.type === 'object') return (name ? '<span class="sc-n">' + esc(name) + '</span> ' : '') + '<span class="sc-t">object</span>' + tail;
    return '<span class="sc-t">' + esc(d.type || 'any') + (d.format ? '<span class="sc-f">(' + esc(d.format) + ')</span>' : '') + '</span>' + tail +
      (d.example != null ? ' <span class="sc-ex">' + esc(T('örn. ', 'e.g. ') + JSON.stringify(d.example)) + '</span>' : '');
  }

  // ------------------------------------------------------------------ uçlar
  function ops() {
    const order = (spec.tags || []).map((t) => t.name);
    const list = [];
    Object.keys(spec.paths).forEach((p) => Object.keys(spec.paths[p]).forEach((m) => list.push(Object.assign({ path: p, method: m, file: p.replace(/^\//, '') }, spec.paths[p][m]))));
    return list.sort((a, b) => order.indexOf(a.tags[0]) - order.indexOf(b.tags[0]));
  }
  function opHtml(op) {
    const id = op.operationId, isOpen = open.has(id);
    const v = view[id] || 'example';
    const resp = Object.keys(op.responses).map((code) => {
      const r = op.responses[code], c = (r.content || {})['application/json'];
      return '<div class="rs-row"><span class="rs-code mono c' + code[0] + '">' + esc(code) + '</span><div class="rs-body"><p>' + esc(tr(r, 'description')) + '</p>' +
        (c ? '<div class="seg rs-seg" role="group" aria-label="' + esc(T('Cevap görünümü', 'Response view')) + '"><button type="button" data-v="example" data-op="' + id + '" aria-pressed="' + (v === 'example') + '">' + esc(T('Örnek değer', 'Example value')) + '</button><button type="button" data-v="schema" data-op="' + id + '" aria-pressed="' + (v === 'schema') + '">' + esc(T('Şema', 'Schema')) + '</button></div>' +
          (v === 'schema' ? '<div class="sc mono">' + schemaHtml(c.schema) + '</div>' : '<pre class="json mono">' + jh(c.example) + '</pre>') : '') +
        '</div></div>';
    }).join('');
    return '<div class="op' + (isOpen ? ' open' : '') + '" id="' + esc(id) + '">' +
      '<button type="button" class="op-h" aria-expanded="' + isOpen + '" aria-controls="' + esc(id) + '-b" data-op="' + esc(id) + '">' +
        '<span class="m mono">' + esc(op.method.toUpperCase()) + '</span><code class="p">/' + esc(base() + op.file) + '</code><span class="s">' + esc(tr(op, 'summary')) + '</span><span class="chev" aria-hidden="true"></span></button>' +
      '<div class="op-b" id="' + esc(id) + '-b"' + (isOpen ? '' : ' hidden') + '>' +
        '<p class="op-d">' + esc(tr(op, 'description')) + '</p>' +
        '<div class="op-sec"><div class="op-sec-h"><h4>' + esc(T('Parametreler', 'Parameters')) + '</h4><div class="op-acts">' +
          '<button type="button" class="btn btn-sm btn-primary" data-run="' + esc(id) + '">' + G.icon('play') + '<span>' + esc(T('Çalıştır', 'Execute')) + '</span></button>' +
          '<button type="button" class="btn btn-sm" data-term="' + esc(id) + '">' + G.icon('terminal') + '<span>' + esc(T('Terminalde', 'In the terminal')) + '</span></button>' +
        '</div></div><p class="op-none">' + esc(T('Parametre yok. Sunucu seçimi dili belirler.', 'No parameters. The selected server sets the language.')) + '</p></div>' +
        '<div class="op-live" id="' + esc(id) + '-live" aria-live="polite">' + (last[id] ? liveHtml(op, last[id]) : '') + '</div>' +
        '<div class="op-sec"><div class="op-sec-h"><h4>' + esc(T('Cevaplar', 'Responses')) + '</h4><span class="mono muted">application/json</span></div>' + resp + '</div>' +
      '</div></div>';
  }
  function liveHtml(op, r) {
    const sz = r.size < 1024 ? r.size + ' B' : (r.size / 1024).toFixed(1) + ' KB';
    let body = '';
    if (r.error) body = '<pre class="json mono err">' + esc(r.error) + '</pre>';
    else if (r.json !== undefined) body = '<pre class="json mono">' + jh(r.json) + '</pre>';
    else body = '<pre class="json mono">' + esc(r.text.slice(0, 1500)) + (r.text.length > 1500 ? '\n…' : '') + '</pre>';
    return '<div class="op-sec live"><div class="op-sec-h"><h4>' + esc(T('Sunucu cevabı', 'Server response')) + '</h4>' +
        '<button type="button" class="btn btn-sm" data-copy-json="' + esc(op.operationId) + '"' + (r.json === undefined ? ' disabled' : '') + '>' + G.icon('copy') + '<span>' + esc(T('Cevabı kopyala', 'Copy response')) + '</span></button></div>' +
      '<p class="lv-k mono">curl</p><div class="lv-cmd"><code class="mono">' + esc(r.curl) + '</code><button type="button" class="lv-copy" data-copy-curl="' + esc(op.operationId) + '" aria-label="' + esc(T('curl komutunu kopyala', 'Copy the curl command')) + '">' + G.icon('copy') + '</button></div>' +
      '<p class="lv-k mono">' + esc(T('İstek adresi', 'Request URL')) + '</p><div class="lv-cmd"><code class="mono">' + esc(r.url) + '</code></div>' +
      '<div class="lv-meta mono"><span class="rs-code c' + String(r.status || 0)[0] + '">' + (r.status || 'ERR') + '</span><span>' + esc(r.statusText || '') + '</span><span>' + r.ms.toFixed(0) + ' ms</span>' + (r.size ? '<span>' + sz + '</span>' : '') + (r.fromSW ? '<span>' + esc(T('çevrimdışı önbellekten', 'from the offline cache')) + '</span>' : '') + '</div>' +
      body +
      (r.headers && r.headers.length ? '<details class="lv-h"><summary class="mono">' + esc(T('Cevap başlıkları', 'Response headers')) + ' (' + r.headers.length + ')</summary><pre class="mono">' + r.headers.map(([k, v]) => '<span class="jk">' + esc(k) + '</span>: ' + esc(v)).join('\n') + '</pre></details>' : '') +
      '</div>';
  }
  function render() {
    if (!spec) return;
    const groups = {};
    ops().forEach((op) => { (groups[op.tags[0]] = groups[op.tags[0]] || []).push(op); });
    opsEl.classList.remove('is-loading');
    opsEl.innerHTML = (spec.tags || []).filter((t) => groups[t.name]).map((t) =>
      '<section class="oas-tag" aria-label="' + esc(t.name) + '"><h3><span>' + esc(t.name) + '</span><small>' + esc(tr(t, 'description')) + '</small></h3>' + groups[t.name].map(opHtml).join('') + '</section>').join('');
    const sch = spec.components.schemas;
    schemasEl.innerHTML = '<h3>' + esc(T('Şemalar', 'Schemas')) + '</h3>' + Object.keys(sch).map((n) =>
      '<details class="sc-item"><summary><span class="sc-n">' + esc(n) + '</span>' + (sch[n].description ? '<small>' + esc(tr(sch[n], 'description')) + '</small>' : '') + '</summary><div class="sc mono">' + schemaHtml({ $ref: '#/components/schemas/' + n }) + '</div></details>').join('');
    curlTop.textContent = 'curl -s ' + absUrl('emre.json');
    const info = document.querySelector('.oas-d');
    if (info && spec.info) { info.textContent = tr(spec.info, 'description'); }
    const v = document.querySelector('.oas-v'); if (v) v.textContent = spec.info.version;
  }

  // ------------------------------------------------------------------ gerçek istek
  async function execute(id) {
    const op = ops().find((o) => o.operationId === id); if (!op) return;
    const btn = opsEl.querySelector('[data-run="' + id + '"]');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    const url = absUrl(op.file), t0 = performance.now();
    const r = { url, curl: curlOf(op.file) };
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-cache' });
      r.status = res.status; r.statusText = res.statusText || (res.ok ? 'OK' : '');
      r.text = await res.text();
      r.ms = performance.now() - t0;
      r.size = new Blob([r.text]).size;
      r.headers = []; res.headers.forEach((v, k) => r.headers.push([k, v])); r.headers.sort((a, b) => a[0].localeCompare(b[0]));
      if (/json/.test(res.headers.get('content-type') || '') || /^\s*[[{]/.test(r.text)) { try { r.json = JSON.parse(r.text); } catch (e) { /* HTML 404 vb. */ } }
    } catch (e) {
      r.ms = performance.now() - t0; r.error = 'TypeError: ' + (e && e.message ? e.message : 'Failed to fetch') + '\n' + T('Ağ yok ya da sunucuya ulaşılamadı.', 'No network, or the server could not be reached.');
    }
    last[id] = r;
    const live = $(id + '-live'); if (live) live.innerHTML = liveHtml(op, r);
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    G.metrics.inc('garage_api_requests_total', { path: '/' + base() + op.file, status: String(r.status || 0) });
    G.log(r.status && r.status < 400 ? 'info' : 'warn', 'api GET /' + base() + op.file + ' ' + (r.status || 'ERR'), { ms: +r.ms.toFixed(1), bytes: r.size || 0 });
    G.sfx('blip', !!(r.status && r.status < 400));
  }

  // ------------------------------------------------------------------ olaylar
  function toggle(id, force) {
    const isOpen = force != null ? force : !open.has(id);
    isOpen ? open.add(id) : open.delete(id);
    const el = $(id); if (!el) return;
    el.classList.toggle('open', isOpen);
    el.querySelector('.op-h').setAttribute('aria-expanded', String(isOpen));
    $(id + '-b').hidden = !isOpen;
  }
  opsEl.addEventListener('click', (e) => {
    const h = e.target.closest('.op-h'); if (h) { toggle(h.dataset.op); G.sfx('click'); return; }
    const run = e.target.closest('[data-run]'); if (run) { execute(run.dataset.run); return; }
    const term = e.target.closest('[data-term]');
    if (term) { const op = ops().find((o) => o.operationId === term.dataset.term); G.openTerminal('curl /' + base() + op.file); return; }
    const sv = e.target.closest('[data-v]');
    if (sv) { view[sv.dataset.op] = sv.dataset.v; const keep = sv.dataset.v; const op = sv.dataset.op; render(); const b = opsEl.querySelector('[data-v="' + keep + '"][data-op="' + op + '"]'); if (b) b.focus(); return; }
    const cj = e.target.closest('[data-copy-json]'); if (cj && last[cj.dataset.copyJson] && last[cj.dataset.copyJson].json !== undefined) { G.copy(JSON.stringify(last[cj.dataset.copyJson].json, null, 2), 'JSON'); return; }
    const cc = e.target.closest('[data-copy-curl]'); if (cc && last[cc.dataset.copyCurl]) G.copy(last[cc.dataset.copyCurl].curl, 'curl');
  });
  server.addEventListener('change', () => { userServer = true; Object.keys(last).forEach((k) => delete last[k]); render(); G.sfx('click'); });
  curlCopy.addEventListener('click', () => G.copy(curlTop.textContent, 'curl'));
  document.addEventListener('garage:lang', () => {
    if (!userServer) server.value = G.lang() === 'en' ? 'api/en/' : 'api/';
    render();
  });
  const fromHash = () => { const id = decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/').pop() || ''); return spec && ops().some((o) => o.operationId === id) ? id : null; };
  window.addEventListener('hashchange', () => { const id = fromHash(); if (id) { toggle(id, true); $(id).scrollIntoView({ block: 'start', behavior: G.reduce ? 'auto' : 'smooth' }); } });

  // ------------------------------------------------------------------ başlat
  server.value = G.lang() === 'en' ? 'api/en/' : 'api/';
  fetch(ROOT + 'api/openapi.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((j) => {
    spec = j;
    const first = fromHash() || (ops()[0] && ops().find((o) => o.file === 'emre.json') || ops()[0]).operationId;
    open.add(first);
    render();
    if (fromHash()) $(first).scrollIntoView({ block: 'start' });
  }).catch((e) => {
    opsEl.classList.remove('is-loading');
    opsEl.innerHTML = '<p class="oas-err mono">' + esc(T('API belgesi yüklenemedi (' + e.message + '). Yerelde önce “node scripts/build.mjs --write” çalıştır; yayında bu dosyayı GitHub Actions üretir.', 'Could not load the API document (' + e.message + '). Locally, run “node scripts/build.mjs --write” first; in production GitHub Actions generates it.')) + '</p>';
  });
})();
