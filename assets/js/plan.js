// Garage — kat planı (plan.js). ui.js ilk açılışta yükler: M tuşu, üst bardaki Plan düğmesi, mobilde alt menü.
// Garajın kuşbakışı planı: üstte dört bölme (Tanış rotası), altta dört atölye odası (Kurcala rotası),
// ortada garaj; solda giriş (masa), sağda CV dolabı. Buradasın işareti ve gezilen odalar.
(function () {
  'use strict';
  const G = window.GARAGE;
  const esc = G.esc;
  const T = (tr, en) => G.t(tr, en);

  const ROOMS = [
    // id, dosya, satır, sütun, rozet, ad, alt satır
    { id: 'hakkimda', href: 'hakkimda.html', row: 0, col: 0, tag: 'BAY 01', name: ['Hakkımda', 'About'], sub: ['kim olduğum', 'who I am'] },
    { id: 'takim-cantasi', href: 'takim-cantasi.html', row: 0, col: 1, tag: 'BAY 02', name: ['Takım Çantası', 'Toolbox'], sub: ['kullandığım araçlar', 'the tools I use'] },
    { id: 'seyir-defteri', href: 'seyir-defteri.html', row: 0, col: 2, tag: 'BAY 03', name: ['Seyir Defteri', 'Logbook'], sub: ['notlar ve yazılar', 'notes and posts'] },
    { id: 'iletisim', href: 'iletisim.html', row: 0, col: 3, tag: 'BAY 04', name: ['İletişim', 'Contact'], sub: ['e-posta, QR, defter', 'email, QR, guestbook'] },
    { id: 'sema', href: 'sema.html', row: 1, col: 0, tag: ['ATÖLYE', 'WORKSHOP'], name: ['Şema', 'Blueprint'], sub: ['bir isteğin yolculuğu', 'a request’s journey'] },
    { id: 'kontrol-odasi', href: 'kontrol-odasi.html', row: 1, col: 1, tag: ['ATÖLYE', 'WORKSHOP'], name: ['Kontrol Odası', 'Control Room'], sub: ['sitenin metrikleri', 'the site’s metrics'] },
    { id: 'veri-odasi', href: 'veri-odasi.html', row: 1, col: 2, tag: ['ATÖLYE', 'WORKSHOP'], name: ['Veri Odası', 'Data Room'], sub: ['SQL ve MongoDB', 'SQL and MongoDB'] },
    { id: 'api', href: 'api.html', row: 1, col: 3, tag: ['ATÖLYE', 'WORKSHOP'], name: ['API', 'API'], sub: ['gerçek JSON uçları', 'real JSON endpoints'] }
  ];
  const tx = (v) => (Array.isArray(v) ? T(v[0], v[1]) : v);
  // Plan geometrisi (viewBox 1000 × 600)
  const W0 = 92, W1 = 908, TOP = 40, BOT = 560, RW = 188, RH = 150, GAP = 14;
  const rx = (col) => W0 + 12 + col * (RW + GAP);
  const ry = (row) => (row === 0 ? TOP + 12 : BOT - 12 - RH);
  const TANIS_Y = 236, KURCALA_Y = 364;

  function svg(here, seen) {
    const rooms = ROOMS.map((r) => {
      const x = rx(r.col), y = ry(r.row), isHere = r.id === here, wasSeen = seen.has(r.id);
      const doorY = r.row === 0 ? y + RH : y;
      return '<a class="pl-room' + (isHere ? ' here' : '') + (wasSeen ? ' seen' : '') + ' r-' + (r.row ? 'kurcala' : 'tanis') + '" href="' + r.href + '" aria-label="' + esc(tx(r.name) + ' — ' + tx(r.sub)) + (isHere ? esc(T(' (buradasın)', ' (you are here)')) : wasSeen ? esc(T(' (gezildi)', ' (visited)')) : '') + '">' +
        '<rect class="pl-fill" x="' + x + '" y="' + y + '" width="' + RW + '" height="' + RH + '" rx="6"/>' +
        '<line class="pl-door" x1="' + (x + 26) + '" y1="' + doorY + '" x2="' + (x + RW - 26) + '" y2="' + doorY + '"/>' +
        '<text class="pl-tag" x="' + (x + 16) + '" y="' + (y + 26) + '">' + esc(tx(r.tag)) + '</text>' +
        '<text class="pl-name" x="' + (x + 16) + '" y="' + (y + 66) + '">' + esc(tx(r.name)) + '</text>' +
        '<text class="pl-sub" x="' + (x + 16) + '" y="' + (y + 90) + '">' + esc(tx(r.sub)) + '</text>' +
        (wasSeen && !isHere ? '<g class="pl-check" transform="translate(' + (x + RW - 26) + ',' + (y + 22) + ')"><circle r="10"/><path d="M-4.5 0l3 3 6-6"/></g>' : '') +
        (isHere ? '<g class="pl-pin" transform="translate(' + (x + 24) + ',' + (y + RH - 26) + ')"><circle class="pl-ping" r="8"/><circle r="5"/><text x="12" y="4">' + esc(T('BURADASIN', 'YOU ARE HERE')) + '</text></g>' : '') +
        '</a>';
    }).join('');
    const tick = (row) => [0, 1, 2, 3].map((c) => { const cx = rx(c) + RW / 2; return row === 0 ? 'M' + cx + ' ' + TANIS_Y + 'V' + (ry(0) + RH + 4) : 'M' + cx + ' ' + KURCALA_Y + 'V' + (ry(1) - 4); }).join('');
    const gHere = here === 'garaj', dHere = here === 'giris', cvHere = here === 'cv';
    return '<svg class="pl-svg" viewBox="0 0 1000 600" role="group" aria-label="' + esc(T('Garajın kuşbakışı planı', 'Bird’s-eye plan of the garage')) + '">' +
      '<defs><pattern id="plGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(140,180,255,.07)" stroke-width="1"/></pattern></defs>' +
      '<rect x="0" y="0" width="1000" height="600" fill="url(#plGrid)"/>' +
      // garaj zemini (merkez)
      '<a class="pl-hub' + (gHere ? ' here' : '') + '" href="garaj.html" aria-label="' + esc(T('Garaj: ana sayfa', 'Garage: home')) + (gHere ? esc(T(' (buradasın)', ' (you are here)')) : '') + '">' +
        '<rect class="pl-floor" x="' + (W0 + 12) + '" y="' + (ry(0) + RH + 10) + '" width="' + (W1 - W0 - 24) + '" height="' + (ry(1) - ry(0) - RH - 20) + '" rx="6"/>' +
        '<text class="pl-hubname" x="500" y="318" text-anchor="middle">' + esc(T('GARAJ', 'GARAGE')) + '</text>' +
        (gHere ? '<g class="pl-pin" transform="translate(500,338)"><circle class="pl-ping" r="8"/><circle r="5"/><text x="12" y="4">' + esc(T('BURADASIN', 'YOU ARE HERE')) + '</text></g>' : '') +
      '</a>' +
      // rota şeritleri
      '<path class="pl-route tanis" d="M' + W0 + ' 300H128V' + TANIS_Y + 'H' + (W1 - 14) + tick(0) + '"/>' +
      '<path class="pl-route kurcala" d="M' + W0 + ' 300H128V' + KURCALA_Y + 'H' + (W1 - 14) + tick(1) + '"/>' +
      '<text class="pl-rlabel tanis" x="140" y="' + (TANIS_Y + 20) + '">' + esc(T('TANIŞ ROTASI', 'MEET ROUTE')) + ' →</text>' +
      '<text class="pl-rlabel kurcala" x="140" y="' + (KURCALA_Y - 10) + '">' + esc(T('KURCALA ROTASI', 'TINKER ROUTE')) + ' →</text>' +
      rooms +
      // duvarlar: solda giriş, sağda CV dolabına geçiş
      '<path class="pl-wall" d="M' + W0 + ' 268V' + TOP + 'H' + W1 + 'V268M' + W1 + ' 332V' + BOT + 'H' + W0 + 'V332"/>' +
      '<a class="pl-ext' + (dHere ? ' here' : '') + '" href="index.html" aria-label="' + esc(T('Giriş: masadaki bilgisayar', 'Entrance: the computer on the desk')) + '"><rect class="pl-fill" x="10" y="262" width="74" height="76" rx="6"/><text class="pl-tag" x="47" y="292" text-anchor="middle">' + esc(T('GİRİŞ', 'ENTRY')) + '</text><text class="pl-sub" x="47" y="314" text-anchor="middle">' + esc(T('masa', 'desk')) + '</text>' + (dHere ? '<circle class="pl-dot" cx="47" cy="328" r="4"/>' : '') + '</a>' +
      '<a class="pl-ext' + (cvHere ? ' here' : '') + '" href="cv.html" aria-label="' + esc(T('CV: tek sayfa özgeçmiş', 'CV: one-page résumé')) + '"><rect class="pl-fill" x="916" y="262" width="74" height="76" rx="6"/><text class="pl-tag" x="953" y="292" text-anchor="middle">CV</text><text class="pl-sub" x="953" y="314" text-anchor="middle">' + esc(T('dolap', 'cabinet')) + '</text>' + (cvHere ? '<circle class="pl-dot" cx="953" cy="328" r="4"/>' : '') + '</a>' +
      '</svg>';
  }
  // Dar ekranlar için aynı plan, liste olarak
  function list(here, seen) {
    const item = (r) => '<a class="pll-item' + (r.id === here ? ' here' : '') + '" href="' + r.href + '"><span class="pll-tag mono">' + esc(tx(r.tag)) + '</span><b>' + esc(tx(r.name)) + '</b><small>' + esc(tx(r.sub)) + '</small>' +
      (r.id === here ? '<span class="pll-badge here">' + esc(T('buradasın', 'you are here')) + '</span>' : seen.has(r.id) ? '<span class="pll-badge">✓ ' + esc(T('gezildi', 'visited')) + '</span>' : '') + '</a>';
    const group = (row, name, cls) => '<div class="pll-group"><p class="pll-head mono"><span class="tape ' + cls + '" aria-hidden="true"></span>' + esc(name) + '</p>' + ROOMS.filter((r) => r.row === row).map(item).join('') + '</div>';
    const extra = [{ id: 'garaj', href: 'garaj.html', tag: T('MERKEZ', 'HUB'), name: T('Garaj', 'Garage'), sub: T('iki kat, sekiz kapı', 'two floors, eight doors') }, { id: 'cv', href: 'cv.html', tag: 'CV', name: 'CV', sub: T('tek sayfa özgeçmiş', 'one-page résumé') }, { id: 'giris', href: 'index.html', tag: T('GİRİŞ', 'ENTRY'), name: T('Masa', 'The desk'), sub: T('giriş sahnesi', 'intro scene') }];
    return '<div class="pll">' + group(0, T('Tanış rotası', 'Meet route'), 'tanis') + group(1, T('Kurcala rotası', 'Tinker route'), 'kurcala') +
      '<div class="pll-group"><p class="pll-head mono">' + esc(T('Diğer', 'Other')) + '</p>' + extra.map(item).join('') + '</div></div>';
  }

  let el = null;
  function open() {
    if (el && G.topLayer && G.topLayer() === el) return;
    if (el) el.remove();
    const here = G.page() === 'yazi' ? 'seyir-defteri' : G.page(), seen = G.visited();
    const all = ROOMS.map((r) => r.id).concat(['garaj']);
    const n = all.filter((id) => seen.has(id) || id === here).length;
    const route = G.routeOf(here);
    const where = route
      ? T('Buradasın: ', 'You are here: ') + tx(ROOMS.find((r) => r.id === here).name) + ' · ' + T('rota ', 'route ') + G.tx(route.route.name) + ' ' + (route.index + 1) + '/' + route.total
      : T('Buradasın: ', 'You are here: ') + ({ garaj: T('Garaj', 'Garage'), giris: T('Giriş sahnesi', 'Intro scene'), cv: 'CV' }[here] || T('garaj', 'garage'));
    el = G.makeOverlay('plan-overlay', T('Garaj planı', 'Garage plan'));
    el.innerHTML = '<div class="panel plan-panel">' +
      '<div class="panel-title"><div><h2>' + esc(T('Garaj planı', 'Garage plan')) + '</h2><p class="plan-where mono">' + esc(where) + '</p></div>' +
      '<button class="term-x" type="button" aria-label="' + esc(T('Kapat', 'Close')) + '">' + G.icon('x') + '</button></div>' +
      '<div class="plan-body">' + svg(here, seen) + list(here, seen) + '</div>' +
      '<div class="plan-foot">' +
        '<p class="plan-legend mono"><span><span class="tape tanis" aria-hidden="true"></span>' + esc(T('Tanış: seni tanımak isteyenler', 'Meet: for getting to know me')) + '</span>' +
        '<span><span class="tape kurcala" aria-hidden="true"></span>' + esc(T('Kurcala: sistemi incelemek isteyenler', 'Tinker: for exploring the system')) + '</span>' +
        '<span class="pl-count">' + esc(T('Bu ziyarette ' + n + '/' + all.length + ' oda gezildi', n + '/' + all.length + ' rooms visited this visit')) + '</span></p>' +
        '<div class="plan-actions">' +
          '<a class="btn btn-sm" href="hakkimda.html">' + G.icon('route') + '<span>' + esc(T('Tanış rotası', 'Meet route')) + '</span></a>' +
          '<a class="btn btn-sm" href="sema.html">' + G.icon('route') + '<span>' + esc(T('Kurcala rotası', 'Tinker route')) + '</span></a>' +
          '<button class="btn btn-sm" type="button" data-act="search">' + G.icon('search') + '<span>' + esc(T('Ara', 'Search')) + '</span> <kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl') + ' K</kbd></button>' +
          '<button class="btn btn-sm" type="button" data-act="term">' + G.icon('terminal') + '<span>Terminal</span></button>' +
        '</div></div></div>';
    el.querySelector('.term-x').addEventListener('click', () => G.closeLayer(el));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      G.closeLayer(el);
      setTimeout(() => (b.dataset.act === 'search' ? G.openPalette() : G.openTerminal()), 60);
    });
    const narrow = matchMedia('(max-width: 720px)').matches;
    G.openLayer(el, narrow ? (el.querySelector('.pll-item.here') || el.querySelector('.pll-item')) : (el.querySelector('.pl-room.here, .pl-hub.here, .pl-ext.here') || el.querySelector('.pl-room')));
    G.sfx('click');
    G.metrics.inc('garage_plan_opened_total', { page: here });
    G.log('info', 'plan opened', { here });
  }
  window.GaragePlan = { open };
})();
