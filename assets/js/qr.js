// Garage — QR kod üretici (qr.js). Dış kütüphane yok; ISO/IEC 18004 standardının bayt kipi, sürüm 1–6.
// Kullanım: GarageQR.svg('https://emrec54.github.io', { ecc: 'Q', border: 4 }) → <svg> metni
// Adımlar: veri → Reed-Solomon hata düzeltme kodları → bloklara bölüp iç içe dizme → matris (bulucu,
// zamanlama ve hizalama desenleri) → zikzak yerleşim → 8 maskeden en iyisi → biçim bitleri.
(function () {
  'use strict';
  // ------------------------------------------------------------------ GF(256) aritmetiği (ilkel polinom 0x11D)
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function rsGenerator(deg) {           // ∏ (x − α^i), en yüksek dereceden başlayarak katsayılar
    let p = [1];
    for (let i = 0; i < deg; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= mul(p[j], EXP[i]); }
      p = q;
    }
    return p;
  }
  function rsRemainder(data, deg) {
    const g = rsGenerator(deg), r = new Array(deg).fill(0);
    for (const d of data) {
      const f = d ^ r[0];
      r.shift(); r.push(0);
      for (let i = 0; i < deg; i++) r[i] ^= mul(g[i + 1], f);
    }
    return r;
  }

  // ------------------------------------------------------------------ tablolar (sürüm 1–6)
  const ECC_PER_BLOCK = { L: [0, 7, 10, 15, 20, 26, 18], M: [0, 10, 16, 26, 18, 24, 16], Q: [0, 13, 22, 18, 26, 18, 24], H: [0, 17, 28, 22, 16, 22, 28] };
  const NUM_BLOCKS = { L: [0, 1, 1, 1, 1, 1, 2], M: [0, 1, 1, 1, 2, 2, 4], Q: [0, 1, 1, 2, 2, 4, 4], H: [0, 1, 1, 2, 4, 4, 4] };
  const FORMAT = { L: 1, M: 0, Q: 3, H: 2 };
  const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; } return r; };
  const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[e][v] * NUM_BLOCKS[e][v];
  const alignPositions = (v) => (v === 1 ? [] : [6, v * 4 + 10]);   // sürüm 2–6: iki konum

  function encode(text, ecc) {
    ecc = ecc || 'M';
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    while (ver <= 6 && 4 + 8 + bytes.length * 8 > dataCodewords(ver, ecc) * 8) ver++;
    if (ver > 6) throw new Error('QR: metin çok uzun');
    const cap = dataCodewords(ver, ecc);
    // ---- veri bitleri: kip (0100 = bayt) + uzunluk + baytlar + sonlandırıcı + dolgu
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, 8); bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, cap * 8 - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
    // ---- bloklar + hata düzeltme + iç içe dizme
    const nb = NUM_BLOCKS[ecc][ver], eLen = ECC_PER_BLOCK[ecc][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dl = shortLen - eLen + (i < nShort ? 0 : 1);
      const dat = data.slice(k, k + dl); k += dl;
      const blk = dat.concat(rsRemainder(dat, eLen));
      if (i < nShort) blk.splice(dl, 0, -1);           // kısa bloklarda hizalama için yer tutucu
      blocks.push(blk);
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b) => { if (b[i] !== -1) all.push(b[i]); });

    // ---- matris
    const size = ver * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const F = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = (x, y, dark) => { M[y][x] = dark; F[y][x] = true; };
    for (let i = 0; i < size; i++) { fn(6, i, i % 2 === 0); fn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) fn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPositions(ver);
    ap.forEach((ax, i) => ap.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
      const d = (FORMAT[ecc] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) fn(8, i, bit(i));
      fn(8, 7, bit(6)); fn(8, 8, bit(7)); fn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) fn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) fn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) fn(8, size - 15 + i, bit(i));
      fn(8, size - 8, true);                            // her zaman koyu modül
    };
    drawFormat(0);                                       // yer ayır
    // ---- zikzak yerleşim
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!F[y][x] && bi < all.length * 8) { M[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
      }
    }
    // ---- maske seçimi (basitleştirilmiş ceza puanı: uzun diziler, 2x2 bloklar, koyu oranı)
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let a = 0; a < 2; a++) for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          const c = a ? M[j][i] : M[i][j], prev = a ? M[j - 1][i] : M[i][j - 1];
          if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M[y][x]) dark++;
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const s = penalty(); if (s < bestScore) { bestScore = s; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return { size, modules: M, version: ver, ecc, mask: best };
  }

  function svg(text, opts) {
    opts = opts || {};
    const q = encode(text, opts.ecc || 'Q'), b = opts.border == null ? 4 : opts.border, n = q.size + b * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + b) + ' ' + (y + b) + 'h1v1h-1z';
    return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' +
      String(opts.label || text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="' + (opts.light || '#fff') + '"/><path d="' + d + '" fill="' + (opts.dark || '#000') + '"/></svg>';
  }
  window.GarageQR = { encode, svg };
})();
