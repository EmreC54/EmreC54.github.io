// Garage — duman testi (smoke test): yayındaki siteyi gerçekten dolaşır.
//   node scripts/smoke.mjs                         → https://emrec54.github.io
//   node scripts/smoke.mjs http://localhost:8000   → yerel kopya (önce: node scripts/build.mjs && npx serve _site gibi)
// GitHub Actions'ta her yayından sonra çalışır (.github/workflows/smoke.yml). Yayını engellemez;
// bir sorun bulursa iş kırmızı olur ve GitHub sana e-posta atar.
// Kontroller: site haritasındaki her sayfa 200 ve <title> var · API uçları geçerli JSON · health "Healthy" ·
// build.json, health.json ve sw.js aynı sürümü söylüyor · RSS'teki her yazı açılıyor · yazı sayfalarında
// canonical + JSON-LD var · olmayan bir adres 404 sayfasını döndürüyor · yavaş yanıtlar uyarı olarak yazılır.
// Sadece Node.js'in kendisi (18+): npm install gerekmez.
import { appendFileSync } from 'node:fs';

const BASE = (process.argv[2] || process.env.SITE_URL || 'https://emrec54.github.io').replace(/\/+$/, '');
const SLOW_MS = 2500;
const stamp = Date.now();
const bust = (u) => u + (u.includes('?') ? '&' : '?') + 'smoke=' + stamp;   // CDN önbelleğini atla
const results = [];
const errors = [], warnings = [];

async function get(path, { expect = 200, type } = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  const t0 = performance.now();
  let res, body = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(bust(url), { redirect: 'follow', headers: { 'user-agent': 'garage-smoke/1.0' }, signal: AbortSignal.timeout(15000) });
      body = await res.text();
      if (res.status < 500) break;
    } catch (e) {
      if (attempt === 3) { errors.push(`${path}: istek başarısız (${e.message})`); results.push({ path, status: 'ERR', ms: Math.round(performance.now() - t0) }); return null; }
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  const ms = Math.round(performance.now() - t0);
  results.push({ path, status: res.status, ms });
  if (res.status !== expect) errors.push(`${path}: HTTP ${res.status} (beklenen ${expect})`);
  if (type && !(res.headers.get('content-type') || '').includes(type)) errors.push(`${path}: içerik türü ${res.headers.get('content-type')} (beklenen ${type})`);
  if (ms > SLOW_MS) warnings.push(`${path}: yavaş yanıt (${ms} ms)`);
  return { res, body, ms };
}
const json = (r, path) => { try { return JSON.parse(r.body); } catch (e) { errors.push(`${path}: geçerli JSON değil (${e.message})`); return null; } };

// 1) Site haritasındaki sayfalar
const sm = await get('/sitemap.xml', { type: 'xml' });
const pages = sm ? [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, '') || '/') : [];
if (sm && !pages.length) errors.push('sitemap.xml: hiç <loc> yok');
for (const p of pages) {
  const r = await get(p, { type: 'text/html' });
  if (!r) continue;
  if (!/<title[^>]*>[^<]{3,}<\/title>/.test(r.body)) errors.push(`${p}: <title> boş ya da yok`);
  if (p.startsWith('/yazi/')) {
    if (!r.body.includes('rel="canonical"')) errors.push(`${p}: canonical bağlantısı yok`);
    if (!r.body.includes('application/ld+json')) errors.push(`${p}: JSON-LD (BlogPosting) yok`);
    if (!r.body.includes('class="prose"')) errors.push(`${p}: yazı içeriği önceden çizilmemiş`);
  }
}

// 2) API
const idx = await get('/api/index.json', { type: 'json' });
const index = idx && json(idx, '/api/index.json');
for (const ep of (index && index.endpoints) || []) { const r = await get(ep.path, { type: 'json' }); if (r) json(r, ep.path); }
const en = await get('/api/en/index.json', { type: 'json' }); if (en) json(en, '/api/en/index.json');
const oas = await get('/api/openapi.json', { type: 'json' });
const spec = oas && json(oas, '/api/openapi.json');
if (spec && !String(spec.openapi || '').startsWith('3.')) errors.push('/api/openapi.json: "openapi": "3.x" değil');
const hr = await get('/api/health.json', { type: 'json' });
const health = hr && json(hr, '/api/health.json');
if (health && health.status !== 'Healthy') errors.push(`/api/health.json: status "${health.status}"`);

// 3) Sürüm tutarlılığı: build.json (CI'da yazılır) = health.json = sw.js
const br = await get('/build.json');
const build = br && json(br, '/build.json');
const sw = await get('/sw.js');
const swVersion = sw && (sw.body.match(/const VERSION = '([^']+)'/) || [])[1];
if (build && build.cache) {
  if (health && health.version !== build.cache) errors.push(`sürüm uyuşmuyor: build.json ${build.cache} ≠ health.json ${health.version}`);
  if (swVersion && swVersion !== build.cache) errors.push(`sürüm uyuşmuyor: build.json ${build.cache} ≠ sw.js ${swVersion}`);
} else if (swVersion === 'garage-dev') warnings.push('sw.js sürümü "garage-dev": yayın build.mjs ile hazırlanmamış görünüyor');

// 4) RSS ve yazılar
const feed = await get('/feed.xml', { type: 'xml' });
if (feed) {
  if (!feed.body.includes('<rss')) errors.push('/feed.xml: RSS değil');
  for (const m of feed.body.matchAll(/<link>([^<]+)<\/link>/g)) {
    const path = m[1].replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/yazi/') && !pages.includes(path)) await get(path, { type: 'text/html' });
  }
}

// 5) 404
const nf = await get('/bu-adres-yok-' + stamp, { expect: 404 });
if (nf && !/404/.test(nf.body)) errors.push('404 sayfası beklenen içeriği döndürmedi');

// ------------------------------------------------------------------ rapor
const pad = (s, n) => String(s).padEnd(n);
console.log(`Duman testi → ${BASE}\n`);
for (const r of results) console.log(`${pad(r.status, 4)} ${pad(r.ms + ' ms', 9)} ${r.path}`);
warnings.forEach((w) => console.log('uyarı: ' + w));
errors.forEach((e) => console.error('HATA:  ' + e));
const avg = results.length ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length) : 0;
console.log(`\n${results.length} istek · ortalama ${avg} ms · ${errors.length} hata · ${warnings.length} uyarı`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Duman testi ${errors.length ? '❌' : '✅'}\n\n${BASE} · ${results.length} istek · ortalama ${avg} ms\n\n` +
    (errors.length ? '### Hatalar\n' + errors.map((e) => '- ' + e).join('\n') + '\n\n' : '') +
    (warnings.length ? '### Uyarılar\n' + warnings.map((w) => '- ' + w).join('\n') + '\n\n' : '') +
    '| Durum | Süre | Adres |\n|---|---|---|\n' + results.map((r) => `| ${r.status} | ${r.ms} ms | \`${r.path}\` |`).join('\n') + '\n');
}
process.exit(errors.length ? 1 : 0);
