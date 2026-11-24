// Garage — kontrol ve yayın betiği. GitHub Actions her push'ta çalıştırır; yerelde de çalışır:
//   node scripts/build.mjs           → kontrol et + _site/ klasörüne yayın kopyasını hazırla
//   node scripts/build.mjs --check   → sadece kontrol et (hiçbir dosya yazmaz)
//   node scripts/build.mjs --write   → ayrıca feed.xml, sitemap.xml, robots.txt, api/ ve yazi/<slug>.html'yi kök klasöre yaz
// Yaptıkları: posts/index.json'u doğrular, sayfalardaki iç bağlantıları kontrol eder, RSS beslemesi ve
// site haritası üretir, build.json (commit, çalıştırma no, zaman) yazar, sw.js önbellek sürümünü günceller.
// Bir hata bulursa çıkış kodu 1 ile durur: bozuk bir sürüm yayına çıkmaz.
// Sadece Node.js'in kendi modüllerini kullanır (npm install gerekmez).
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = process.cwd();
const OUT = join(ROOT, '_site');
const SITE = 'https://emrec54.github.io';
const flags = new Set(process.argv.slice(2));
const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const EXCLUDE = new Set(['_site', '.git', '.github', 'scripts', 'node_modules', 'README.md', 'posts/_sablon.md', 'posts/README.md', '.DS_Store']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name), rel = relative(ROOT, abs).split(sep).join('/');
    if (EXCLUDE.has(rel) || EXCLUDE.has(name)) continue;
    if (statSync(abs).isDirectory()) walk(abs, out); else out.push(rel);
  }
  return out;
}

// ------------------------------------------------------------------ 1. Seyir Defteri
let posts = [];
try {
  const idx = JSON.parse(readFileSync('posts/index.json', 'utf8'));
  posts = Array.isArray(idx.posts) ? idx.posts : (err('posts/index.json: "posts" bir liste olmalı'), []);
} catch (e) { err('posts/index.json okunamadı ya da geçerli JSON değil: ' + e.message); }
const slugs = new Set();
posts.forEach((p, i) => {
  const at = `posts/index.json → posts[${i}]${p && p.slug ? ' (' + p.slug + ')' : ''}`;
  if (!p.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) err(`${at}: slug sadece küçük harf, rakam ve tire içermeli (Türkçe karakter, boşluk yok)`);
  else if (slugs.has(p.slug)) err(`${at}: bu slug iki kez kullanılmış`);
  slugs.add(p.slug);
  if (!p.title) err(`${at}: title eksik`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || Number.isNaN(Date.parse(p.date))) err(`${at}: date YYYY-AA-GG biçiminde olmalı (ör. 2026-12-01)`);
  if (p.tags != null && !Array.isArray(p.tags)) err(`${at}: tags bir liste olmalı, ör. ["redis", "dotnet"]`);
  if (p.updated != null && (!/^\d{4}-\d{2}-\d{2}$/.test(p.updated) || Number.isNaN(Date.parse(p.updated)))) err(`${at}: updated YYYY-AA-GG biçiminde olmalı`);
  if (p.slug && !existsSync(join('posts', p.slug + '.md'))) err(`${at}: posts/${p.slug}.md dosyası bulunamadı`);
  if (!p.summary) warn(`${at}: summary yok — listede ve RSS'te özet görünmez`);
});
const live = posts.filter((p) => !p.draft && p.slug && p.date).sort((a, b) => (a.date < b.date ? 1 : -1));

// ------------------------------------------------------------------ 2. İç bağlantılar
const files = walk(ROOT);
const fileSet = new Set(files);
const exists = (p) => fileSet.has(p) || existsSync(join(ROOT, p));
const pages = files.filter((f) => f.endsWith('.html'));
const API_FILES = ['index', 'emre', 'stack', 'experience', 'posts', 'cv', 'health'].flatMap((n) => ['api/' + n + '.json', 'api/en/' + n + '.json']).concat(['api/openapi.json']);
const POST_FILES = live.map((p) => 'yazi/' + p.slug + '.html');   // her yazının statik sayfası (bkz. 5)
const GENERATED = new Set(['feed.xml', 'sitemap.xml', 'robots.txt', ...API_FILES, ...POST_FILES]);   // build.json: depodaki yer tutucu, CI'da gerçek bilgiyle değişir
for (const f of pages) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue;
    const path = decodeURIComponent(raw.split('#')[0].split('?')[0]).replace(/^\//, '');
    if (!path || GENERATED.has(path)) continue;
    if (!exists(path)) err(`${f}: kırık bağlantı → ${raw}`);
  }
}
for (const f of files.filter((x) => x.startsWith('assets/css/') && x.endsWith('.css'))) {
  const css = readFileSync(f, 'utf8');
  for (const m of css.matchAll(/url\((?!["']?data:)["']?([^"')]+)["']?\)/g)) {
    if (/^(https?:|#|%23)/i.test(m[1])) continue;
    const target = join(dirname(f), m[1]).split(sep).join('/');
    if (!exists(target)) err(`${f}: bulunamayan dosya → ${m[1]}`);
  }
}
for (const f of files.filter((x) => x.startsWith('assets/js/') && x.endsWith('.js'))) {   // menü ve terminaldeki sayfa adları
  const js = readFileSync(f, 'utf8');
  for (const m of js.matchAll(/'([a-z0-9-]+\.html)(?:#[^']*)?'/g)) if (!exists(m[1])) err(`${f}: bulunamayan sayfa → ${m[1]}`);
}

// ------------------------------------------------------------------ 3. Üretilen dosyalar
const rfc822 = (d) => new Date(d + 'T09:00:00+03:00').toUTCString();
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Seyir Defteri — Emre Çuhadar</title>
    <link>${SITE}/seyir-defteri.html</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Backend, önbellekleme, loglama ve izleme üzerine notlar.</description>
    <language>tr</language>
${live.length ? `    <lastBuildDate>${rfc822(live[0].date)}</lastBuildDate>\n` : ''}${live.map((p) => `    <item>
      <title>${xml(p.title)}</title>
      <link>${SITE}/yazi/${p.slug}.html</link>
      <guid isPermaLink="false">${SITE}/posts/${p.slug}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
${(p.tags || []).map((t) => `      <category>${xml(t)}</category>\n`).join('')}      <description>${xml(p.summary || '')}</description>
    </item>
`).join('')}  </channel>
</rss>
`;
const gitDate = (f) => { try { return execSync(`git log -1 --format=%cs -- "${f}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
const today = new Date().toISOString().slice(0, 10);
const listed = pages.filter((f) => !/^(404|offline|yazi)\.html$/.test(f) && !f.startsWith('yazi/')).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${listed.map((f) => `  <url><loc>${SITE}/${f === 'index.html' ? '' : f}</loc><lastmod>${gitDate(f) || today}</lastmod><priority>${f === 'index.html' ? '1.0' : f === 'garaj.html' ? '0.9' : '0.7'}</priority></url>`).join('\n')}
${live.map((p) => `  <url><loc>${SITE}/yazi/${p.slug}.html</loc><lastmod>${p.updated || gitDate('posts/' + p.slug + '.md') || p.date}</lastmod><priority>0.6</priority></url>`).join('\n')}
</urlset>
`;
const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;

// ------------------------------------------------------------------ 4. API: config.js ve yazılardan statik JSON uçları
// /api/*.json (Türkçe) ve /api/en/*.json (İngilizce) + /api/openapi.json (OpenAPI 3.0.3). GitHub Pages bunları
// application/json ve "Access-Control-Allow-Origin: *" ile sunar; api.html sayfası bu belgeden çizilir.
let cfg = null;
try {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('config.js', 'utf8'), ctx, { filename: 'config.js', timeout: 1000 });
  cfg = ctx.window.GARAGE || null;
  if (!cfg) err('config.js: window.GARAGE bulunamadı');
} catch (e) { err('config.js çalıştırılamadı: ' + e.message); }
const api = {};
const health = (version) => ({ status: 'Healthy', version, commit: process.env.GITHUB_SHA || null, run: Number(process.env.GITHUB_RUN_NUMBER) || null, built: new Date().toISOString(), checks: { pages: 'Healthy', posts: live.length ? 'Healthy' : 'Empty', config: cfg ? 'Healthy' : 'Unhealthy' } });
if (cfg) {
  const L = (o, l) => (o && typeof o === 'object' ? (o[l] || o.tr) : o);
  const need = (v, what) => { if (v == null || v === '') err('config.js: ' + what + ' eksik (API için gerekli)'); return v; };
  need(cfg.name, 'name'); need(cfg.profile && cfg.profile.company, 'profile.company');
  for (const l of ['tr', 'en']) {
    const base = l === 'tr' ? 'api/' : 'api/en/', url = (n) => SITE + '/' + base + n + '.json';
    const p = cfg.profile || {};
    const stack = (cfg.toolbox || []).map((d) => ({ id: d.id || null, name: L(d.drawer, l), tools: (d.tools || []).map((t) => ({ name: t.name, note: L(t.note, l) || null })) }));
    const tools = stack.flatMap((d) => d.tools.map((t) => t.name));
    const jobs = (cfg.experience || []).map((e) => ({ role: L(e.role, l), company: e.company, team: L(e.team, l) || null, start: e.start, end: e.end || null, current: !e.end, note: e.note ? L(e.note, l) : null }));
    const schools = (cfg.education || []).map((e) => ({ school: L(e.school, l), field: L(e.field, l) }));
    const links = { site: cfg.site || SITE, github: cfg.github || null, linkedin: cfg.linkedin || null, email: cfg.email ? 'mailto:' + cfg.email : null };
    const role = L(p.role, l), team = L(p.team, l);
    const summary = l === 'tr'
      ? `${role} · ${p.company}${team ? ' (' + team + ')' : ''}. Araçlar: ${tools.join(', ')}.`
      : `${role} at ${p.company}${team ? ' (' + team + ')' : ''}. Tools: ${tools.join(', ')}.`;
    const nav = { self: null, profile: url('emre'), stack: url('stack'), experience: url('experience'), posts: url('posts'), cv: url('cv'), health: url('health'), openapi: SITE + '/api/openapi.json', docs: SITE + '/api.html' };
    const withLinks = (name, body) => Object.assign(body, { _links: Object.assign({}, nav, { self: url(name) }) });
    api[base + 'emre.json'] = withLinks('emre', { name: cfg.name, role, company: p.company || null, team: team || null, since: p.since || null, location: L(p.location, l) || cfg.city || null, timeZone: cfg.timeZone || null, summary, stack: tools, links });
    api[base + 'stack.json'] = withLinks('stack', { count: tools.length, drawers: stack });
    api[base + 'experience.json'] = withLinks('experience', { experience: jobs, education: schools });
    api[base + 'posts.json'] = withLinks('posts', { count: live.length, posts: live.map((x) => ({ slug: x.slug, title: x.title, date: x.date, tags: x.tags || [], summary: x.summary || '', url: SITE + '/yazi/' + x.slug + '.html', markdown: SITE + '/posts/' + x.slug + '.md' })) });
    api[base + 'cv.json'] = {
      $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
      basics: { name: cfg.name, label: role, email: cfg.email || undefined, url: cfg.site || SITE, summary,
        location: { city: cfg.city || undefined, countryCode: 'TR' },
        profiles: [cfg.github && { network: 'GitHub', username: cfg.github.split('/').pop(), url: cfg.github }, cfg.linkedin && { network: 'LinkedIn', url: cfg.linkedin }].filter(Boolean) },
      work: jobs.map((j) => ({ name: j.company, position: j.role, startDate: j.start, endDate: j.end || undefined, summary: [j.team, j.note].filter(Boolean).join(' · ') || undefined })),
      education: schools.map((s) => ({ institution: s.school, area: s.field })),
      skills: stack.map((d) => ({ name: d.name, keywords: d.tools.map((t) => t.name) })),
      meta: { canonical: url('cv'), version: 'v1.0.0', lastModified: today }
    };
    api[base + 'index.json'] = withLinks('index', { name: 'Emre API', version: '1.0.0', language: l, endpoints: ['emre', 'stack', 'experience', 'posts', 'cv', 'health'].map((n) => ({ path: '/' + base + n + '.json', url: url(n) })) });
  }
  // OpenAPI 3.0.3 — örnekler gerçek cevaplardan alınır; Türkçe metinler x-*-tr alanlarında
  const ex = (n) => (n === 'health' ? Object.assign(health('garage-3f9c0a1b2d4e'), { commit: '9b1e2c7d4a…', run: 42, built: '2026-11-23T09:41:00.000Z' }) : api['api/' + n + '.json']);
  const op = (n, tag, sum, sumTr, desc, descTr, schema) => ({ get: { tags: [tag], operationId: 'get' + n[0].toUpperCase() + n.slice(1), summary: sum, 'x-summary-tr': sumTr, description: desc, 'x-description-tr': descTr,
    responses: { 200: { description: 'OK', 'x-description-tr': 'Başarılı', headers: { 'Access-Control-Allow-Origin': { schema: { type: 'string', example: '*' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/' + schema }, example: ex(n) } } },
      404: { description: 'Not found (GitHub Pages returns its HTML 404 page)', 'x-description-tr': 'Bulunamadı (GitHub Pages HTML 404 sayfasını döner)' } } } });
  const str = { type: 'string' }, strN = { type: 'string', nullable: true }, links = { type: 'object', additionalProperties: { type: 'string', format: 'uri', nullable: true } };
  api['api/openapi.json'] = {
    openapi: '3.0.3',
    info: { title: 'Emre API', version: '1.0.0', description: 'Read-only JSON endpoints for Emre Çuhadar’s site, generated from config.js on every deploy. No authentication; CORS enabled.', 'x-description-tr': 'Emre Çuhadar’ın sitesinin salt okunur JSON uçları; her yayında config.js’ten üretilir. Kimlik doğrulama yok; CORS açık.', contact: { name: cfg.name, email: cfg.email, url: cfg.site || SITE } },
    servers: [{ url: SITE + '/api', description: 'Türkçe' }, { url: SITE + '/api/en', description: 'English' }],
    tags: [{ name: 'profile', description: 'Who I am', 'x-description-tr': 'Ben kimim' }, { name: 'content', description: 'Posts', 'x-description-tr': 'Yazılar' }, { name: 'system', description: 'Index and health', 'x-description-tr': 'Dizin ve sağlık' }],
    paths: {
      '/index.json': op('index', 'system', 'API index', 'API dizini', 'Lists every endpoint with its absolute URL.', 'Tüm uçları tam adresleriyle listeler.', 'Index'),
      '/emre.json': op('emre', 'profile', 'Profile', 'Profil', 'Name, role, company, location, stack and links.', 'Ad, rol, şirket, konum, araçlar ve bağlantılar.', 'Profile'),
      '/stack.json': op('stack', 'profile', 'Toolbox', 'Takım çantası', 'Technologies grouped by drawer, each with a short note.', 'Çekmecelere göre teknolojiler ve kısa notları.', 'Stack'),
      '/experience.json': op('experience', 'profile', 'Experience and education', 'Deneyim ve eğitim', 'Jobs (newest first; end: null means current) and education.', 'İşler (en yeni en üstte; end: null hâlâ devam ediyor demek) ve eğitim.', 'Experience'),
      '/posts.json': op('posts', 'content', 'Logbook posts', 'Seyir Defteri yazıları', 'Published posts, newest first, with links to the page and the Markdown source.', 'Yayımlanmış yazılar, en yeni en üstte; sayfa ve Markdown kaynağı bağlantılarıyla.', 'PostList'),
      '/cv.json': op('cv', 'profile', 'Résumé (JSON Resume)', 'Özgeçmiş (JSON Resume)', 'The CV in the open JSON Resume v1.0.0 format; any JSON Resume theme can render it.', 'Açık JSON Resume v1.0.0 biçiminde özgeçmiş; herhangi bir JSON Resume temasıyla çizilebilir.', 'Resume'),
      '/health.json': op('health', 'system', 'Health', 'Sağlık', 'Build status: version, commit and build time of the deployed site.', 'Yayındaki sitenin sürümü, commit’i ve derlenme zamanı.', 'Health')
    },
    components: { schemas: {
      Links: links,
      Index: { type: 'object', required: ['name', 'version', 'endpoints'], properties: { name: str, version: str, language: { type: 'string', enum: ['tr', 'en'] }, endpoints: { type: 'array', items: { type: 'object', properties: { path: str, url: { type: 'string', format: 'uri' } } } }, _links: { $ref: '#/components/schemas/Links' } } },
      Profile: { type: 'object', required: ['name', 'role', 'company'], properties: { name: str, role: str, company: str, team: strN, since: { type: 'string', example: '2026-10', nullable: true }, location: strN, timeZone: strN, summary: str, stack: { type: 'array', items: str }, links: links, _links: { $ref: '#/components/schemas/Links' } } },
      Tool: { type: 'object', required: ['name'], properties: { name: str, note: strN } },
      Drawer: { type: 'object', required: ['name', 'tools'], properties: { id: strN, name: str, tools: { type: 'array', items: { $ref: '#/components/schemas/Tool' } } } },
      Stack: { type: 'object', required: ['count', 'drawers'], properties: { count: { type: 'integer' }, drawers: { type: 'array', items: { $ref: '#/components/schemas/Drawer' } }, _links: { $ref: '#/components/schemas/Links' } } },
      Job: { type: 'object', required: ['role', 'company', 'start'], properties: { role: str, company: str, team: strN, start: str, end: strN, current: { type: 'boolean' }, note: strN } },
      School: { type: 'object', required: ['school'], properties: { school: str, field: str } },
      Experience: { type: 'object', properties: { experience: { type: 'array', items: { $ref: '#/components/schemas/Job' } }, education: { type: 'array', items: { $ref: '#/components/schemas/School' } }, _links: { $ref: '#/components/schemas/Links' } } },
      Post: { type: 'object', required: ['slug', 'title', 'date'], properties: { slug: str, title: str, date: { type: 'string', format: 'date' }, tags: { type: 'array', items: str }, summary: str, url: { type: 'string', format: 'uri' }, markdown: { type: 'string', format: 'uri' } } },
      PostList: { type: 'object', properties: { count: { type: 'integer' }, posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } }, _links: { $ref: '#/components/schemas/Links' } } },
      Resume: { type: 'object', description: 'JSON Resume v1.0.0 (https://jsonresume.org/schema)', 'x-description-tr': 'JSON Resume v1.0.0 (https://jsonresume.org/schema)', properties: { basics: { type: 'object' }, work: { type: 'array', items: { type: 'object' } }, education: { type: 'array', items: { type: 'object' } }, skills: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      Health: { type: 'object', required: ['status', 'version'], properties: { status: { type: 'string', enum: ['Healthy'] }, version: str, commit: strN, run: { type: 'integer', nullable: true }, built: { type: 'string', format: 'date-time' }, checks: { type: 'object', additionalProperties: str } } }
    } }
  };
}
const writeApi = (dir, version) => {
  const h = health(version);
  const all = Object.assign({}, api, { 'api/health.json': Object.assign(h, { _links: api['api/emre.json'] ? Object.assign({}, api['api/emre.json']._links, { self: SITE + '/api/health.json' }) : undefined }), 'api/en/health.json': Object.assign({}, h, { _links: api['api/en/emre.json'] ? Object.assign({}, api['api/en/emre.json']._links, { self: SITE + '/api/en/health.json' }) : undefined }) });
  for (const [f, body] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), JSON.stringify(body, null, 2) + '\n'); }
  return Object.keys(all).length;
};
// openapi.json'daki her yol için iki dilde de dosya üretildi mi?
if (cfg) for (const path of Object.keys(api['api/openapi.json'].paths)) for (const b of ['api', 'api/en']) if (path !== '/health.json' && !api[b + path]) err('API: ' + b + path + ' üretilemedi');

// ------------------------------------------------------------------ 5. Yazı sayfaları: yazi/<slug>.html
// Her yazı için arama motorlarının okuyabileceği, paylaşılınca başlığı ve özeti görünen statik bir sayfa.
// Şablon yazi.html; içerik blog.js'in kendi Markdown çeviricisiyle (Node'da, vm içinde) önceden çizilir.
// Sayfa bir alt klasörde olduğu için <base href="../"> kullanılır: tüm göreli adresler köke göre çözülür.
const htmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const postPages = {};
(() => {
  if (!existsSync('yazi.html') || !existsSync('assets/js/blog.js')) { if (live.length) err('yazi.html ya da assets/js/blog.js yok — yazı sayfaları üretilemedi'); return; }
  const box = { window: {}, document: { addEventListener() {} }, navigator: {}, console };
  box.window.GARAGE = { lang: () => 'tr', t: (tr) => tr };
  try { vm.createContext(box); vm.runInContext(readFileSync('assets/js/blog.js', 'utf8'), box, { filename: 'assets/js/blog.js', timeout: 2000 }); }
  catch (e) { err('blog.js Node içinde çalıştırılamadı: ' + e.message); return; }
  const blog = box.window.GARAGE.blog;
  const siteJs = existsSync('assets/js/site.js') ? readFileSync('assets/js/site.js', 'utf8') : '';
  const icon = (n) => { const m = siteJs.match(new RegExp('^\\s*' + n + ":\\s*'([^']*)'", 'm')); return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (m ? m[1] : '') + '</svg>'; };
  const tpl = readFileSync('yazi.html', 'utf8');
  const replaceOnce = (html, re, to, what) => { if (!re.test(html)) { err('yazi.html şablonunda bulunamadı: ' + what); return html; } return html.replace(re, to); };
  live.forEach((p, i) => {
    let md = '';
    try { md = readFileSync(join('posts', p.slug + '.md'), 'utf8'); } catch (e) { return; }
    const url = `${SITE}/yazi/${p.slug}.html`, self = `yazi/${p.slug}.html`;
    const r = blog.render(md);
    const desc = p.summary || (r.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155));
    const toc = r.toc.length >= 3 ? '<nav class="toc mono" aria-label="İçindekiler"><span>içindekiler</span>' + r.toc.map((t) => '<a href="#' + t.id + '">' + t.text + '</a>').join('') + '</nav>' : '';
    const article =
      '<header class="post-head">' +
        '<p class="kicker">$ cat ' + htmlEsc(p.slug) + '.md</p>' +
        '<h1>' + htmlEsc(p.title) + '</h1>' +
        '<p class="post-meta mono"><span>' + blog.fmtDate(p.date) + '</span><span>· ' + blog.minutes(md) + ' dk okuma</span>' +
        (p.tags || []).map((t) => '<a class="t" href="seyir-defteri.html?tag=' + encodeURIComponent(t) + '">#' + htmlEsc(t) + '</a>').join('') + '</p>' +
        '<div class="share">' +
          '<button type="button" class="btn btn-sm" data-copy="url">' + icon('link') + 'Bağlantıyı kopyala</button>' +
          '<a class="btn btn-sm" href="https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url) + '" target="_blank" rel="noopener">' + icon('linkedin') + 'LinkedIn’de paylaş</a>' +
          '<button type="button" class="btn btn-sm" data-print>' + icon('printer') + 'Yazdır</button>' +
        '</div>' +
      '</header>' + toc + '<div class="prose">' + r.html + '</div>';
    const prev = live[i + 1], next = live[i - 1];
    const nav = (prev ? '<a href="yazi/' + prev.slug + '.html"><small class="mono">← önceki</small><b>' + htmlEsc(prev.title) + '</b></a>' : '<span></span>') +
      (next ? '<a href="yazi/' + next.slug + '.html"><small class="mono">sonraki →</small><b>' + htmlEsc(next.title) + '</b></a>' : '<span></span>');
    const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: desc, datePublished: p.date, dateModified: p.updated || p.date,
      inLanguage: 'tr', url, mainEntityOfPage: url, image: SITE + '/assets/img/og.jpg', keywords: (p.tags || []).join(', ') || undefined,
      author: { '@type': 'Person', name: 'Emre Çuhadar', url: SITE + '/' }, publisher: { '@type': 'Person', name: 'Emre Çuhadar', url: SITE + '/' } };
    let h = tpl;
    h = replaceOnce(h, /<meta charset="utf-8">/, '<meta charset="utf-8">\n  <base href="../">', 'charset');
    h = replaceOnce(h, /<title[^>]*>[\s\S]*?<\/title>/, '<title>' + htmlEsc(p.title) + ' — Seyir Defteri · Emre Çuhadar</title>', '<title>');
    h = replaceOnce(h, /<meta name="description"[^>]*>/, '<meta name="description" content="' + htmlEsc(desc) + '">', 'description');
    h = replaceOnce(h, /<meta name="robots"[^>]*>/, '<meta name="robots" content="index, follow">\n  <link rel="canonical" href="' + url + '">', 'robots');
    h = replaceOnce(h, /<meta property="og:title"[^>]*>/, '<meta property="og:title" content="' + htmlEsc(p.title) + '">', 'og:title');
    h = replaceOnce(h, /<meta property="og:description"[^>]*>/, '<meta property="og:description" content="' + htmlEsc(desc) + '">', 'og:description');
    h = replaceOnce(h, /<meta property="og:url"[^>]*>/, '<meta property="og:url" content="' + url + '">\n  <meta property="article:published_time" content="' + p.date + '">' +
      (p.tags || []).map((t) => '\n  <meta property="article:tag" content="' + htmlEsc(t) + '">').join(''), 'og:url');
    h = replaceOnce(h, /<\/head>/, '  <script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>\n</head>', '</head>');
    h = replaceOnce(h, /<body([^>]*)data-page="yazi"/, '<body$1data-page="yazi" data-slug="' + p.slug + '"', 'body data-page');
    h = h.replace(/href="#([^"]*)"/g, 'href="' + self + '#$1"');      // sayfa içi bağlantılar <base> yüzünden köke gitmesin
    h = replaceOnce(h, /<article class="post" id="post">[\s\S]*?<\/article>/, '<article class="post" id="post" data-lang="tr">' + article + '</article>', '#post');
    h = replaceOnce(h, /(<nav class="post-nav" id="postNav"[^>]*>)<\/nav>/, '$1' + nav + '</nav>', '#postNav');
    postPages[self] = h;
  });
})();

// ------------------------------------------------------------------ Sonuç
warnings.forEach((w) => console.log('uyarı: ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('HATA:  ' + e));
  console.error(`\n${errors.length} hata bulundu — yayın durduruldu.`);
  process.exit(1);
}
console.log(`✓ ${posts.length} kayıt, ${pages.length} sayfa ve ${files.length} dosya kontrol edildi; kırık bağlantı yok.`);
if (flags.has('--check')) process.exit(0);

if (flags.has('--write')) {
  writeFileSync('feed.xml', feed); writeFileSync('sitemap.xml', sitemap); writeFileSync('robots.txt', robots);
  const n = writeApi(ROOT, 'local');
  mkdirSync('yazi', { recursive: true });
  for (const f of readdirSync('yazi')) if (f.endsWith('.html') && !postPages['yazi/' + f]) rmSync(join('yazi', f));   // silinen/taslağa alınan yazılar
  for (const [f, h] of Object.entries(postPages)) writeFileSync(f, h);
  console.log('✓ feed.xml, sitemap.xml, robots.txt, ' + n + ' API dosyası (api/) ve ' + Object.keys(postPages).length + ' yazı sayfası (yazi/) kök klasöre yazıldı.');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const hash = createHash('sha256');
for (const f of files.sort()) {
  if (GENERATED.has(f) || /^yazi\/[^/]+\.html$/.test(f)) continue;   // yazı sayfaları her yayında yeniden üretilir (taslağa alınan yazının eski sayfası yayına çıkmaz)
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  cpSync(join(ROOT, f), join(OUT, f));
  if (f !== 'sw.js') hash.update(f).update(readFileSync(f));
}
writeFileSync(join(OUT, 'feed.xml'), feed);
writeFileSync(join(OUT, 'sitemap.xml'), sitemap);
writeFileSync(join(OUT, 'robots.txt'), robots);
writeFileSync(join(OUT, '.nojekyll'), '');
for (const [f, h] of Object.entries(postPages)) { mkdirSync(dirname(join(OUT, f)), { recursive: true }); writeFileSync(join(OUT, f), h); }
const version = 'garage-' + hash.digest('hex').slice(0, 12);
writeApi(OUT, version);
if (existsSync(join(OUT, 'sw.js'))) writeFileSync(join(OUT, 'sw.js'), readFileSync(join(OUT, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
if (process.env.GITHUB_SHA) {
  writeFileSync(join(OUT, 'build.json'), JSON.stringify({ sha: process.env.GITHUB_SHA, run: Number(process.env.GITHUB_RUN_NUMBER) || null, ref: process.env.GITHUB_REF_NAME || null, time: new Date().toISOString(), cache: version }, null, 2));
}
console.log(`✓ _site/ hazır (${files.length} dosya, önbellek sürümü ${version}).`);
