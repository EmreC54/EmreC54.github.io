// Garage — ortak efektler: ışıkta uçuşan toz parçacıkları
// Performans: parıltı bir kez küçük bir tuvale çizilir, her karede sadece kopyalanır.
// Sekme görünmezken durur. Kullanım: GarageFX.dust(canvas, { count }) → { setOffset(x, y), stop() }
window.GarageFX = (function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeSprite() {
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,230,190,1)');
    g.addColorStop(0.35, 'rgba(255,205,140,.45)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    return s;
  }

  function dust(canvas, opts) {
    const o = Object.assign({ count: 80 }, opts || {});
    const ctx = canvas.getContext('2d');
    const sprite = makeSprite();
    let w = 0, h = 0, raf = 0, ox = 0, oy = 0, running = false;
    const parts = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
    }
    function spawn(p, anywhere) {
      p.z = Math.random();
      p.x = Math.random() * w;
      p.y = anywhere ? Math.random() * h : h + 10;
      p.s = 2 + p.z * 9;                                   // parıltı boyutu
      p.vx = (Math.random() - 0.5) * 0.12;
      p.vy = -(0.04 + Math.random() * 0.18) * (0.4 + p.z);
      p.a = 0.12 + Math.random() * 0.4;
      p.tw = Math.random() * Math.PI * 2;
      return p;
    }
    resize();
    for (let i = 0; i < o.count; i++) parts.push(spawn({}, true));
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); });

    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx + Math.sin(t / 2600 + p.tw) * 0.06;
        p.y += p.vy;
        if (p.y < -12 || p.x < -20 || p.x > w + 20) spawn(p, false);
        const px = p.x + ox * (6 + p.z * 34);              // yakın parçacık daha çok kayar → derinlik
        const py = p.y + oy * (4 + p.z * 22);
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t / 900 + p.tw));
        ctx.drawImage(sprite, px - p.s / 2, py - p.s / 2, p.s, p.s);
      }
      raf = requestAnimationFrame(frame);
    }
    const lite = () => document.documentElement.classList.contains('lite');
    function start() { if (!running && !reduce && !lite()) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    document.addEventListener('garage:lite', (e) => { if (e.detail) { stop(); ctx.clearRect(0, 0, w, h); } else start(); });
    start();
    return { setOffset(x, y) { ox = x; oy = y; }, stop };
  }

  return { dust, reduce };
})();
