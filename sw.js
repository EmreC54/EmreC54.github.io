// Garage — service worker: çevrimdışı açılış ve hızlı tekrar ziyaret.
// Sayfalar, CSS ve JS önce ağdan istenir (her zaman güncel); ağ yoksa önbellekten gelir.
// Fontlar ve görseller önce önbellekten gelir. VERSION, yayında scripts/build.mjs tarafından
// dosya içeriklerinin özetiyle değiştirilir; değişince eski önbellek silinir.
const VERSION = 'garage-dev';
const CORE = [
  '/', '/garaj.html', '/offline.html', '/manifest.webmanifest', '/config.js', '/assets/js/icerik.js',
  '/assets/css/base.css', '/assets/css/site.css', '/assets/css/intro.css',
  '/assets/js/site.js', '/assets/js/ui.js', '/assets/js/fx.js', '/assets/js/page.js', '/assets/js/garaj.js', '/assets/js/intro.js', '/assets/js/blog.js', '/assets/js/plan.js', '/assets/js/xray.js',
  '/assets/fonts/Inter-Regular.woff', '/assets/fonts/Inter-Medium.woff', '/assets/fonts/Inter-SemiBold.woff',
  '/assets/fonts/BigShoulders-Regular.woff', '/assets/fonts/BigShoulders-Bold.woff', '/assets/fonts/JetBrainsMono-Regular.woff', '/assets/fonts/JetBrainsMono-Bold.woff',
  '/assets/img/garage-scene.avif', '/assets/img/garage-blur.jpg', '/assets/img/garage-focus.jpg', '/assets/screen/boot.webp', '/assets/img/icons/favicon.svg'
];
const STATIC = /\/assets\/(fonts|img|screen)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('garage-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.searchParams.has('ping')) return;
  const put = (res) => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
    return;
  }
  e.respondWith(fetch(req).then(put).catch(() =>
    caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))));
});
