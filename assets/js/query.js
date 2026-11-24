// Garage — sorgu motoru (query.js). Veri Odası ve terminal (sqlcmd, mongosh) aynı motoru kullanır.
// İki dil: SQL (T-SQL'in salt okunur bir alt kümesi) ve MongoDB kabuk sözdizimi (find, aggregate…).
// Veri: sitenin içeriği (config.js, yazılar) + ziyaretçinin bu sekmedeki oturumu (sayfalar, loglar, Şema istekleri, Redis).
// Kullanıcı girdisi asla eval edilmez: iki dil için de küçük, elle yazılmış ayrıştırıcılar var.
(function (root) {
  'use strict';

  // ===================================================================== ORTAK
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp) && !isOid(v);
  const isOid = (v) => v !== null && typeof v === 'object' && typeof v.$oid === 'string';
  // Karşılaştırma için katlama: büyük/küçük harf ve I/İ/ı farkı yok sayılır (SQL Server'ın CI harmanlamasına yakın, Türkçe metinle de güvenli)
  const lower = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const pad2 = (n) => String(n).padStart(2, '0');
  // Tarihler SQL'de Kocaeli saatiyle "YYYY-AA-GG SS:DD:ss" gösterilir
  function sqlDate(d) {
    try {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
      const g = (t) => (p.find((x) => x.type === t) || {}).value;
      return g('year') + '-' + g('month') + '-' + g('day') + ' ' + (g('hour') === '24' ? '00' : g('hour')) + ':' + g('minute') + ':' + g('second');
    } catch (e) { return d.toISOString().replace('T', ' ').slice(0, 19); }
  }
  // Doküman değeri → SQL hücresi
  function toCell(v) {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return sqlDate(v);
    if (Array.isArray(v)) return v.map((x) => (isObj(x) ? JSON.stringify(x) : String(x))).join(',');
    if (isOid(v)) return v.$oid;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isObj(v)) return JSON.stringify(v);
    return v;
  }
  function err(n, level, msg) { const e = new Error(msg); e.sql = { n, level, state: 1, line: 1, msg }; return e; }

  // ===================================================================== SQL — sözcük çözücü
  const KW = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'TOP', 'LIMIT', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'JOIN', 'INNER', 'LEFT', 'OUTER', 'ON', 'CROSS']);
  function lex(src) {
    const toks = []; let i = 0;
    const isIdStart = (c) => /[A-Za-z_@#À-ɏ]/.test(c);
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
        toks.push({ t: 'num', v: parseFloat(src.slice(i, j)), p: i }); i = j; continue;
      }
      if (c === "'" || ((c === 'N' || c === 'n') && src[i + 1] === "'")) {
        let j = c === "'" ? i + 1 : i + 2, s = '';
        for (;;) {
          if (j >= src.length) throw err(105, 15, "Unclosed quotation mark after the character string '" + s + "'.");
          if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue; } break; }
          s += src[j++];
        }
        toks.push({ t: 'str', v: s, p: i }); i = j + 1; continue;
      }
      if (c === '[' || c === '"') {
        const close = c === '[' ? ']' : '"', j = src.indexOf(close, i + 1);
        if (j < 0) throw err(105, 15, 'Unclosed quotation mark after the character string \'' + src.slice(i + 1) + "'.");
        toks.push({ t: 'id', v: src.slice(i + 1, j), q: true, p: i }); i = j + 1; continue;
      }
      if (isIdStart(c)) {
        let j = i; while (j < src.length && /[\w@#$À-ɏ]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), p: i }); i = j; continue;
      }
      const two = src.substr(i, 2);
      if (two === '<>' || two === '!=' || two === '<=' || two === '>=') { toks.push({ t: 'op', v: two === '!=' ? '<>' : two, p: i }); i += 2; continue; }
      if ('=<>+-*/%(),.;'.includes(c)) { toks.push({ t: 'op', v: c, p: i }); i++; continue; }
      throw err(102, 15, "Incorrect syntax near '" + c + "'.");
    }
    return toks;
  }

  // ===================================================================== SQL — ayrıştırıcı
  const AGG = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STRING_AGG']);
  function parseSql(src) {
    const toks = lex(src); let i = 0;
    const peek = (o) => toks[i + (o || 0)];
    const isKw = (t, w) => t && t.t === 'id' && !t.q && t.v.toUpperCase() === w;
    const acceptKw = (w) => { if (isKw(peek(), w)) { i++; return true; } return false; };
    const isOp = (t, v) => t && t.t === 'op' && t.v === v;
    const acceptOp = (v) => { if (isOp(peek(), v)) { i++; return true; } return false; };
    const near = () => { const t = peek(); return t ? (t.t === 'str' ? "'" + t.v + "'" : String(t.v)) : ''; };
    const fail = () => { const t = peek(); if (t && t.t === 'id' && KW.has(t.v.toUpperCase())) throw err(156, 15, "Incorrect syntax near the keyword '" + t.v.toUpperCase() + "'."); throw err(102, 15, "Incorrect syntax near '" + (near() || src.trim().split(/\s+/).pop()) + "'."); };
    const expectKw = (w) => { if (!acceptKw(w)) fail(); };
    const expectOp = (v) => { if (!acceptOp(v)) fail(); };
    const ident = () => { const t = peek(); if (!t || t.t !== 'id' || (!t.q && KW.has(t.v.toUpperCase()))) fail(); i++; return t.v; };

    function primary() {
      const t = peek(); if (!t) fail();
      if (t.t === 'num') { i++; return { k: 'lit', v: t.v }; }
      if (t.t === 'str') { i++; return { k: 'lit', v: t.v }; }
      if (isOp(t, '(')) { i++; const e = expr(); expectOp(')'); return e; }
      if (isOp(t, '-')) { i++; return { k: 'neg', a: primary() }; }
      if (isKw(t, 'NULL')) { i++; return { k: 'lit', v: null }; }
      if (t.t === 'id' && !t.q && /^@@/.test(t.v)) { i++; return { k: 'var', n: t.v.toUpperCase() }; }
      if (t.t === 'id') {
        if (!t.q && KW.has(t.v.toUpperCase())) fail();
        i++;
        const name = t.v;
        if (!t.q && isOp(peek(), '(')) {      // fonksiyon
          i++;
          const fn = name.toUpperCase();
          if (fn === 'CAST') { const a = expr(); expectKw('AS'); const ty = ident(); if (acceptOp('(')) { while (!acceptOp(')')) i++; } expectOp(')'); return { k: 'fn', n: 'CAST', args: [a, { k: 'lit', v: ty.toUpperCase() }] }; }
          if (fn === 'DATEDIFF') { const part = ident(); expectOp(','); const a = expr(); expectOp(','); const b = expr(); expectOp(')'); return { k: 'fn', n: 'DATEDIFF', args: [{ k: 'lit', v: part.toLowerCase() }, a, b] }; }
          if (acceptOp('*')) { expectOp(')'); return { k: 'fn', n: fn, args: [], star: true }; }
          const distinct = acceptKw('DISTINCT');
          const args = [];
          if (!acceptOp(')')) { do { args.push(expr()); } while (acceptOp(',')); expectOp(')'); }
          return { k: 'fn', n: fn, args, distinct };
        }
        if (acceptOp('.')) { if (acceptOp('*')) return { k: 'star', t: name }; const c = ident(); return { k: 'col', t: name, c }; }
        return { k: 'col', t: null, c: name };
      }
      fail();
    }
    function mul() { let a = primary(); for (;;) { const t = peek(); if (t && t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) { i++; a = { k: 'bin', op: t.v, a, b: primary() }; } else return a; } }
    function add() { let a = mul(); for (;;) { const t = peek(); if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) { i++; a = { k: 'bin', op: t.v, a, b: mul() }; } else return a; } }
    function cmp() {
      const a = add();
      const t = peek();
      if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { i++; return { k: 'bin', op: t.v, a, b: add() }; }
      if (isKw(t, 'IS')) { i++; const not = acceptKw('NOT'); expectKw('NULL'); return { k: 'isnull', a, not }; }
      const not = isKw(t, 'NOT') && (isKw(peek(1), 'LIKE') || isKw(peek(1), 'IN') || isKw(peek(1), 'BETWEEN')); if (not) i++;
      if (acceptKw('LIKE')) return { k: 'like', a, pat: add(), not };
      if (acceptKw('IN')) { expectOp('('); const list = []; do { list.push(expr()); } while (acceptOp(',')); expectOp(')'); return { k: 'in', a, list, not }; }
      if (acceptKw('BETWEEN')) { const lo = add(); expectKw('AND'); const hi = add(); return { k: 'between', a, lo, hi, not }; }
      return a;
    }
    function notE() { if (acceptKw('NOT')) return { k: 'not', a: notE() }; return cmp(); }
    function andE() { let a = notE(); while (acceptKw('AND')) a = { k: 'and', a, b: notE() }; return a; }
    function expr() { let a = andE(); while (acceptKw('OR')) a = { k: 'or', a, b: andE() }; return a; }

    function tableRef() {
      let name = ident();
      while (acceptOp('.')) name += '.' + ident();
      let alias = null;
      if (acceptKw('AS')) alias = ident();
      else { const t = peek(); if (t && t.t === 'id' && (t.q || !KW.has(t.v.toUpperCase()))) { alias = t.v; i++; } }
      return { name, alias: alias || name.split('.').pop() };
    }

    expectKw('SELECT');
    const q = { distinct: false, top: null, cols: [], from: null, joins: [], where: null, group: [], having: null, order: [], limit: null };
    q.distinct = acceptKw('DISTINCT');
    if (acceptKw('TOP')) { const paren = acceptOp('('); const t = peek(); if (!t || t.t !== 'num') fail(); i++; q.top = t.v; if (paren) expectOp(')'); }
    do {
      if (acceptOp('*')) { q.cols.push({ star: true }); continue; }
      const e = expr();
      if (e.k === 'star') { q.cols.push({ star: true, t: e.t }); continue; }
      let alias = null;
      if (acceptKw('AS')) { const t = peek(); if (t && t.t === 'str') { i++; alias = t.v; } else alias = ident(); }
      else { const t = peek(); if (t && ((t.t === 'id' && (t.q || !KW.has(t.v.toUpperCase()))) || t.t === 'str')) { i++; alias = t.v; } }
      q.cols.push({ e, alias });
    } while (acceptOp(','));
    if (acceptKw('FROM')) {
      q.from = tableRef();
      for (;;) {
        let type = null;
        if (acceptKw('JOIN')) type = 'inner';
        else if (isKw(peek(), 'INNER') && isKw(peek(1), 'JOIN')) { i += 2; type = 'inner'; }
        else if (isKw(peek(), 'LEFT')) { i++; acceptKw('OUTER'); expectKw('JOIN'); type = 'left'; }
        else if (isKw(peek(), 'CROSS') && isKw(peek(1), 'JOIN')) { i += 2; type = 'cross'; }
        else if (acceptOp(',')) type = 'cross';
        if (!type) break;
        const ref = tableRef();
        let on = null;
        if (type !== 'cross') { expectKw('ON'); on = expr(); }
        q.joins.push({ type, ref, on });
      }
    }
    if (acceptKw('WHERE')) q.where = expr();
    if (isKw(peek(), 'GROUP')) { i++; expectKw('BY'); do { q.group.push(expr()); } while (acceptOp(',')); }
    if (acceptKw('HAVING')) q.having = expr();
    if (isKw(peek(), 'ORDER')) { i++; expectKw('BY'); do { const e = expr(); let desc = false; if (acceptKw('DESC')) desc = true; else acceptKw('ASC'); q.order.push({ e, desc }); } while (acceptOp(',')); }
    if (acceptKw('LIMIT')) { const t = peek(); if (!t || t.t !== 'num') fail(); i++; q.limit = t.v; }
    acceptOp(';');
    if (i < toks.length) fail();
    return q;
  }

  // İfadeyi metne çevir (sütun başlıkları ve GROUP BY eşleştirmesi için)
  function show(e) {
    switch (e.k) {
      case 'lit': return e.v === null ? 'NULL' : typeof e.v === 'string' ? "'" + e.v + "'" : String(e.v);
      case 'col': return (e.t ? e.t + '.' : '') + e.c;
      case 'var': return e.n;
      case 'fn': return e.n + '(' + (e.star ? '*' : (e.distinct ? 'DISTINCT ' : '') + e.args.map(show).join(', ')) + ')';
      case 'bin': return show(e.a) + ' ' + e.op + ' ' + show(e.b);
      case 'neg': return '-' + show(e.a);
      default: return e.k;
    }
  }
  const norm = (e) => lower(show(e)).replace(/\s+/g, '');
  function hasAgg(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.k === 'fn' && AGG.has(e.n)) return true;
    return ['a', 'b', 'pat', 'lo', 'hi'].some((k) => hasAgg(e[k])) || (e.args || []).some(hasAgg) || (e.list || []).some(hasAgg);
  }

  // ===================================================================== SQL — değerlendirme
  const numLike = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(+v));
  function compare(a, b) {
    if (a == null || b == null) return null;
    if (numLike(a) && numLike(b) && (typeof a === 'number' || typeof b === 'number')) return +a - +b;
    const A = lower(a), B = lower(b);
    return A < B ? -1 : A > B ? 1 : 0;
  }
  const truthy = (v) => v === true || (typeof v === 'number' && v !== 0);
  function parseDateLoose(v) {
    if (v == null) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0);
  }
  function scalar(n, args, row) {
    const a = args.map((x) => evalE(x, row));
    switch (n) {
      case 'UPPER': return a[0] == null ? null : String(a[0]).toUpperCase();
      case 'LOWER': return a[0] == null ? null : String(a[0]).replace(/İ/g, 'i').toLowerCase();
      case 'LEN': return a[0] == null ? null : String(a[0]).replace(/\s+$/, '').length;
      case 'TRIM': return a[0] == null ? null : String(a[0]).trim();
      case 'LTRIM': return a[0] == null ? null : String(a[0]).replace(/^\s+/, '');
      case 'RTRIM': return a[0] == null ? null : String(a[0]).replace(/\s+$/, '');
      case 'ABS': return a[0] == null ? null : Math.abs(+a[0]);
      case 'ROUND': { if (a[0] == null) return null; const f = Math.pow(10, +a[1] || 0); return Math.round(+a[0] * f) / f; }
      case 'CEILING': return a[0] == null ? null : Math.ceil(+a[0]);
      case 'FLOOR': return a[0] == null ? null : Math.floor(+a[0]);
      case 'COALESCE': case 'ISNULL': { const v = a.find((x) => x != null); return v === undefined ? null : v; }
      case 'CONCAT': return a.map((x) => (x == null ? '' : String(x))).join('');
      case 'SUBSTRING': return a[0] == null ? null : String(a[0]).substr(Math.max(0, (+a[1] || 1) - 1), +a[2]);
      case 'LEFT': return a[0] == null ? null : String(a[0]).slice(0, +a[1]);
      case 'RIGHT': return a[0] == null ? null : (+a[1] ? String(a[0]).slice(-a[1]) : '');
      case 'REPLACE': return a[0] == null ? null : String(a[0]).split(String(a[1])).join(String(a[2] == null ? '' : a[2]));
      case 'YEAR': case 'MONTH': case 'DAY': { const d = parseDateLoose(a[0]); if (!d) return null; return n === 'YEAR' ? d.getFullYear() : n === 'MONTH' ? d.getMonth() + 1 : d.getDate(); }
      case 'GETDATE': case 'SYSDATETIME': case 'CURRENT_TIMESTAMP': return sqlDate(new Date());
      case 'DATEDIFF': {
        const x = parseDateLoose(a[1]), y = parseDateLoose(a[2]); if (!x || !y) return null;
        const part = a[0];
        if (/^(year|yy|yyyy)$/.test(part)) return y.getFullYear() - x.getFullYear();
        if (/^(month|mm|m)$/.test(part)) return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth();
        if (/^(day|dd|d)$/.test(part)) return Math.round((y - x) / 864e5);
        if (/^(hour|hh)$/.test(part)) return Math.round((y - x) / 36e5);
        if (/^(minute|mi|n)$/.test(part)) return Math.round((y - x) / 6e4);
        throw err(155, 15, "'" + part + "' is not a recognized datediff option.");
      }
      case 'CAST': {
        const v = a[0], ty = a[1];
        if (v == null) return null;
        if (/INT|BIGINT|SMALLINT/.test(ty)) { const x = parseInt(v, 10); if (isNaN(x)) throw err(245, 16, "Conversion failed when converting the varchar value '" + v + "' to data type int."); return x; }
        if (/FLOAT|DECIMAL|NUMERIC|REAL|MONEY/.test(ty)) { const x = parseFloat(v); if (isNaN(x)) throw err(8114, 16, 'Error converting data type varchar to ' + ty.toLowerCase() + '.'); return x; }
        return String(v);
      }
      default: throw err(195, 15, "'" + n + "' is not a recognized built-in function name.");
    }
  }
  function aggregate(e, group) {
    const rows = group.rows;
    if (e.n === 'COUNT' && e.star) return rows.length;
    let vals = rows.map((r) => evalE(e.args[0], r)).filter((v) => v != null);
    if (e.distinct) { const seen = new Set(); vals = vals.filter((v) => { const k = typeof v + ':' + lower(v); if (seen.has(k)) return false; seen.add(k); return true; }); }
    switch (e.n) {
      case 'COUNT': return vals.length;
      case 'SUM': return vals.length ? vals.reduce((s, v) => s + +v, 0) : null;
      case 'AVG': return vals.length ? +(vals.reduce((s, v) => s + +v, 0) / vals.length).toFixed(4) : null;
      case 'MIN': return vals.length ? vals.reduce((m, v) => (compare(v, m) < 0 ? v : m)) : null;
      case 'MAX': return vals.length ? vals.reduce((m, v) => (compare(v, m) > 0 ? v : m)) : null;
      case 'STRING_AGG': { const sep = e.args[1] ? evalE(e.args[1], rows[0] || {}) : ','; return vals.length ? vals.join(sep) : null; }
    }
    return null;
  }
  // row: { env: {alias: obj}, group?: {rows: [...]}, out?: {alias: value} }
  function evalE(e, row) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'var': {
        if (e.n === '@@VERSION') return 'GarageSQL 1.0 (in-browser, read-only) — compatible subset of Microsoft SQL Server T-SQL';
        if (e.n === '@@SERVERNAME') return 'GARAGE\\SQLEXPRESS';
        if (e.n === '@@LANGUAGE') return 'us_english';
        throw err(137, 15, 'Must declare the scalar variable "' + e.n + '".');
      }
      case 'col': return resolveCol(e, row);
      case 'neg': { const v = evalE(e.a, row); return v == null ? null : -v; }
      case 'bin': {
        const a = evalE(e.a, row), b = evalE(e.b, row);
        if (['=', '<>', '<', '>', '<=', '>='].includes(e.op)) {
          const c = compare(a, b); if (c === null) return false;
          return e.op === '=' ? c === 0 : e.op === '<>' ? c !== 0 : e.op === '<' ? c < 0 : e.op === '>' ? c > 0 : e.op === '<=' ? c <= 0 : c >= 0;
        }
        if (a == null || b == null) return null;
        if (e.op === '+') return numLike(a) && numLike(b) && (typeof a === 'number' || typeof b === 'number') ? +a + +b : String(a) + String(b);
        if (!numLike(a) || !numLike(b)) throw err(245, 16, "Conversion failed when converting the varchar value '" + (numLike(a) ? b : a) + "' to data type int.");
        if (e.op === '-') return +a - +b;
        if (e.op === '*') return +a * +b;
        if (e.op === '/') { if (+b === 0) throw err(8134, 16, 'Divide by zero error encountered.'); return Number.isInteger(+a) && Number.isInteger(+b) ? Math.trunc(+a / +b) : +a / +b; }
        if (e.op === '%') return +a % +b;
        return null;
      }
      case 'and': return truthy(evalE(e.a, row)) && truthy(evalE(e.b, row));
      case 'or': return truthy(evalE(e.a, row)) || truthy(evalE(e.b, row));
      case 'not': return !truthy(evalE(e.a, row));
      case 'isnull': { const v = evalE(e.a, row); return e.not ? v != null : v == null; }
      case 'like': {
        const v = evalE(e.a, row), p = evalE(e.pat, row);
        if (v == null || p == null) return false;
        let re = '';
        for (let k = 0; k < p.length; k++) { const ch = p[k]; if (ch === '%') re += '.*'; else if (ch === '_') re += '.'; else if (ch === '[') { const j = p.indexOf(']', k); if (j > k) { re += '[' + p.slice(k + 1, j).replace(/\\/g, '\\\\') + ']'; k = j; } else re += '\\['; } else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        const hit = new RegExp('^' + re + '$', 'is').test(lower(v)) || new RegExp('^' + re + '$', 'is').test(String(v));
        return e.not ? !hit : hit;
      }
      case 'in': { const v = evalE(e.a, row); if (v == null) return false; const hit = e.list.some((x) => compare(v, evalE(x, row)) === 0); return e.not ? !hit : hit; }
      case 'between': { const v = evalE(e.a, row), lo = evalE(e.lo, row), hi = evalE(e.hi, row); const c1 = compare(v, lo), c2 = compare(v, hi); if (c1 === null || c2 === null) return false; const hit = c1 >= 0 && c2 <= 0; return e.not ? !hit : hit; }
      case 'fn':
        if (AGG.has(e.n)) { if (!row.group) throw err(147, 15, 'An aggregate may not appear in the WHERE clause unless it is in a subquery contained in a HAVING clause or a select list.'); return aggregate(e, row.group); }
        return scalar(e.n, e.args, row);
      case 'star': throw err(102, 15, "Incorrect syntax near '*'.");
    }
    return null;
  }
  function resolveCol(e, row) {
    const name = lower(e.c);
    if (!e.t && row.out && Object.prototype.hasOwnProperty.call(row.out, name)) return row.out[name];   // ORDER BY takma ad
    const env = row.env || (row.group && row.group.rows[0] && row.group.rows[0].env) || {};
    if (e.t) {
      const al = Object.keys(env).find((k) => lower(k) === lower(e.t));
      if (!al) throw err(4104, 16, 'The multi-part identifier "' + e.t + '.' + e.c + '" could not be bound.');
      const obj = env[al]; const key = obj && Object.keys(obj).find((k) => lower(k) === name);
      if (key === undefined) { if (obj && obj.__nullRow) return null; throw err(207, 16, "Invalid column name '" + e.c + "'."); }
      return obj[key];
    }
    let found = null, n = 0;
    Object.keys(env).forEach((al) => { const obj = env[al]; const key = Object.keys(obj).find((k) => lower(k) === name); if (key !== undefined) { n++; found = obj[key]; } });
    if (n > 1) throw err(209, 16, "Ambiguous column name '" + e.c + "'.");
    if (!n) throw err(207, 16, "Invalid column name '" + e.c + "'.");
    return found;
  }

  function sqlTable(name, catalog) {
    const n = lower(name).replace(/^dbo\./, '').replace(/^garagedb\.dbo\./, '');
    const t = catalog.tables.find((x) => lower(x.name) === n);
    if (t) return { cols: t.cols.map((c) => c[0]), rows: t.docs.map((d) => { const o = {}; t.cols.forEach(([c]) => { o[c] = toCell(d[c]); }); return o; }) };
    if (n === 'sys.tables' || n === 'information_schema.tables') {
      const rows = catalog.tables.map((x, k) => (n === 'sys.tables' ? { name: x.name, object_id: 1000 + k, type_desc: 'USER_TABLE', rows: x.docs.length } : { TABLE_CATALOG: 'GarageDB', TABLE_SCHEMA: 'dbo', TABLE_NAME: x.name, TABLE_TYPE: 'BASE TABLE' }));
      return { cols: rows.length ? Object.keys(rows[0]) : ['name'], rows };
    }
    if (n === 'information_schema.columns') {
      const rows = [];
      catalog.tables.forEach((x) => x.cols.forEach(([c, ty], k) => rows.push({ TABLE_NAME: x.name, COLUMN_NAME: c, ORDINAL_POSITION: k + 1, DATA_TYPE: ty, IS_NULLABLE: k === 0 ? 'NO' : 'YES' })));
      return { cols: ['TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'DATA_TYPE', 'IS_NULLABLE'], rows };
    }
    throw err(208, 16, "Invalid object name '" + name + "'.");
  }

  function execSelect(q, catalog) {
    // FROM + JOIN
    let envs = [{}], aliases = [];
    if (q.from) {
      const t = sqlTable(q.from.name, catalog);
      aliases.push({ alias: q.from.alias, cols: t.cols });
      envs = t.rows.map((r) => ({ [q.from.alias]: r }));
      q.joins.forEach((j) => {
        const tj = sqlTable(j.ref.name, catalog);
        aliases.push({ alias: j.ref.alias, cols: tj.cols });
        const next = [];
        envs.forEach((env) => {
          let matched = false;
          tj.rows.forEach((r) => {
            const env2 = Object.assign({}, env, { [j.ref.alias]: r });
            if (j.type === 'cross' || truthy(evalE(j.on, { env: env2 }))) { matched = true; next.push(env2); }
          });
          if (!matched && j.type === 'left') { const nul = { __nullRow: true }; tj.cols.forEach((c) => { nul[c] = null; }); next.push(Object.assign({}, env, { [j.ref.alias]: nul })); }
        });
        envs = next;
      });
    }
    if (q.where) {
      if (hasAgg(q.where)) throw err(147, 15, 'An aggregate may not appear in the WHERE clause unless it is in a subquery contained in a HAVING clause or a select list.');
      envs = envs.filter((env) => truthy(evalE(q.where, { env })));
    }
    // Seçim listesi: * genişlet
    const items = [];
    q.cols.forEach((c) => {
      if (c.star) {
        if (!q.from) throw err(263, 16, 'Must specify table to select from.');
        const list = c.t ? aliases.filter((a) => lower(a.alias) === lower(c.t)) : aliases;
        if (c.t && !list.length) throw err(4104, 16, 'The multi-part identifier "' + c.t + '.*" could not be bound.');
        list.forEach((a) => a.cols.forEach((col) => items.push({ e: { k: 'col', t: a.alias, c: col }, name: col })));
      } else items.push({ e: c.e, name: c.alias || (c.e.k === 'col' ? c.e.c : '(No column name)'), alias: c.alias });
    });
    const grouped = q.group.length || items.some((it) => hasAgg(it.e)) || hasAgg(q.having) || q.order.some((o) => hasAgg(o.e));
    let ctxs;
    if (grouped) {
      const gkeys = q.group.map(norm);
      // GROUP BY'da olmayan, toplama dışındaki sütunlar hatadır (Msg 8120)
      const check = (e) => {
        if (!e || typeof e !== 'object') return;
        if (e.k === 'fn' && AGG.has(e.n)) return;
        if (gkeys.includes(norm(e))) return;
        if (e.k === 'col') {
          const tn = e.t || (aliases.find((a) => a.cols.some((c) => lower(c) === lower(e.c))) || {}).alias || (q.from ? q.from.name : '');
          throw err(8120, 16, "Column '" + tn + '.' + e.c + "' is invalid in the select list because it is not contained in either an aggregate function or the GROUP BY clause.");
        }
        ['a', 'b', 'pat', 'lo', 'hi'].forEach((k) => check(e[k])); (e.args || []).forEach(check); (e.list || []).forEach(check);
      };
      items.forEach((it) => check(it.e));
      const map = new Map();
      envs.forEach((env) => {
        const vals = q.group.map((g) => evalE(g, { env }));
        const k = JSON.stringify(vals.map((v) => (typeof v === 'string' ? lower(v) : v)));
        if (!map.has(k)) map.set(k, { rows: [] });
        map.get(k).rows.push({ env });
      });
      let groups = Array.from(map.values());
      if (!q.group.length && !groups.length) groups = [{ rows: [] }];
      ctxs = groups.map((g) => ({ group: g, env: g.rows[0] ? g.rows[0].env : {} }));
      if (q.having) ctxs = ctxs.filter((c) => truthy(evalE(q.having, c)));
    } else ctxs = envs.map((env) => ({ env }));
    // Çıktı satırları
    let out = ctxs.map((c) => {
      const vals = items.map((it) => evalE(it.e, c));
      const named = {}; items.forEach((it, k) => { named[lower(it.name)] = vals[k]; });
      return { vals, ctx: Object.assign({}, c, { out: named }) };
    });
    if (q.distinct) { const seen = new Set(); out = out.filter((r) => { const k = JSON.stringify(r.vals.map((v) => (typeof v === 'string' ? lower(v) : v))); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (q.order.length) {
      const keys = out.map((r) => q.order.map((o) => {
        if (o.e.k === 'lit' && typeof o.e.v === 'number') { const idx = o.e.v - 1; if (idx < 0 || idx >= items.length) throw err(108, 16, 'The ORDER BY position number ' + o.e.v + ' is out of range of the number of items in the select list.'); return r.vals[idx]; }
        return evalE(o.e, r.ctx);
      }));
      const idx = out.map((_, k) => k);
      idx.sort((x, y) => {
        for (let k = 0; k < q.order.length; k++) {
          const a = keys[x][k], b = keys[y][k];
          let c;
          if (a == null && b == null) c = 0; else if (a == null) c = -1; else if (b == null) c = 1; else c = compare(a, b);
          if (c) return q.order[k].desc ? -c : c;
        }
        return x - y;
      });
      out = idx.map((k) => out[k]);
    }
    const n = q.top != null ? q.top : q.limit;
    if (n != null) out = out.slice(0, Math.max(0, Math.floor(n)));
    return { cols: items.map((it) => it.name), rows: out.map((r) => r.vals) };
  }

  // Bir ya da daha fazla ifade (; ya da GO ile ayrılmış). Her biri bir sonuç ya da hata.
  // Yorumlar (-- ve /* */) metin içinde değilse boşlukla değiştirilir; satır sayısı korunur
  function stripSqlComments(p) {
    let s = '', quote = null;
    for (let k = 0; k < p.length; k++) {
      const ch = p[k];
      if (quote) { s += ch; if (ch === quote) quote = null; continue; }
      if (ch === '-' && p[k + 1] === '-') { while (k < p.length && p[k] !== '\n') k++; s += '\n'; continue; }
      if (ch === '/' && p[k + 1] === '*') { const e = p.indexOf('*/', k + 2), end = e < 0 ? p.length : e + 2; s += p.slice(k, end).replace(/[^\n]/g, ' '); k = end - 1; continue; }
      if (ch === "'" || ch === '[' || ch === '"') quote = ch === '[' ? ']' : ch;
      s += ch;
    }
    return s;
  }
  function splitBatches(src) {
    const parts = []; let cur = '', q = null;
    const lines = src.split('\n');
    lines.forEach((line) => { if (/^\s*GO\s*$/i.test(line) && !q) { parts.push(cur); cur = ''; } else cur += line + '\n'; });
    parts.push(cur);
    const out = [];
    parts.map(stripSqlComments).forEach((p) => {
      let s = '', quote = null;
      for (let k = 0; k < p.length; k++) {
        const ch = p[k];
        if (quote) { s += ch; if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '[' || ch === '"') { quote = ch === '[' ? ']' : ch; s += ch; continue; }
        if (ch === ';') { if (s.trim()) out.push(s.trim()); s = ''; continue; }
        s += ch;
      }
      if (s.trim()) out.push(s.trim());
    });
    return out;
  }
  function runSql(src, catalog) {
    const results = [];
    splitBatches(String(src || '')).forEach((stmt) => {
      const t0 = now();
      try {
        const verb = ((stmt.match(/^\s*(\w+)/) || [])[1] || '').toUpperCase();
        if (/^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|GRANT|REVOKE|DENY|BACKUP|RESTORE|SHUTDOWN|DBCC|BULK|DECLARE|SET|USE)$/.test(verb)) {
          if (verb === 'USE') { const db = (stmt.match(/^\s*use\s+\[?(\w+)\]?/i) || [])[1] || ''; if (/^garagedb$/i.test(db)) { results.push({ message: 'Changed database context to \'GarageDB\'.', ms: now() - t0 }); return; } throw err(911, 16, "Database '" + db + "' does not exist. Make sure that the name is entered correctly."); }
          throw err(229, 14, 'The ' + verb + " permission was denied on the database 'GarageDB', schema 'dbo'. (GarageSQL is read-only.)");
        }
        if (/^(EXEC|EXECUTE|SP_HELP)$/.test(verb)) {
          const m = stmt.match(/^\s*(?:exec(?:ute)?\s+)?sp_help\s+'?\[?([\w.]+)\]?'?\s*$/i);
          if (m) { const t = catalog.tables.find((x) => lower(x.name) === lower(m[1])); if (!t) throw err(15009, 16, "The object '" + m[1] + "' does not exist in database 'GarageDB' or is invalid for this operation."); results.push({ cols: ['Column_name', 'Type', 'Nullable'], rows: t.cols.map(([c, ty], k) => [c, ty, k ? 'yes' : 'no']), ms: now() - t0 }); return; }
          const m2 = stmt.match(/^\s*(?:exec(?:ute)?\s+)?sp_tables\s*$/i);
          if (m2) { results.push({ cols: ['TABLE_QUALIFIER', 'TABLE_OWNER', 'TABLE_NAME', 'TABLE_TYPE'], rows: catalog.tables.map((t) => ['GarageDB', 'dbo', t.name, 'TABLE']), ms: now() - t0 }); return; }
          throw err(229, 14, "The EXECUTE permission was denied on the object, database 'GarageDB', schema 'dbo'. (GarageSQL is read-only.)");
        }
        const q = parseSql(stmt);
        const r = execSelect(q, catalog);
        r.ms = now() - t0;
        results.push(r);
      } catch (e) {
        if (e.sql) results.push({ error: e.sql, ms: now() - t0 });
        else results.push({ error: { n: 50000, level: 16, state: 1, line: 1, msg: String(e.message || e) }, ms: now() - t0 });
      }
    });
    return results;
  }

  // ===================================================================== MONGO — değer ayrıştırıcı (gevşek JSON)
  function parseJs(src) {
    let i = 0;
    const ws = () => { for (;;) { while (i < src.length && /\s/.test(src[i])) i++; if (src[i] === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; } break; } };
    const fail = (m) => { const e = new Error(m || ('SyntaxError: Unexpected token' + (src[i] ? " '" + src[i] + "'" : ' (end of input)') + ' (1:' + (i + 1) + ')')); e.mongo = true; throw e; };
    function str() {
      const q = src[i++]; let s = '';
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          i++; const c = src[i++];
          if (c === 'u') { s += String.fromCharCode(parseInt(src.substr(i, 4), 16)); i += 4; }
          else s += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        }
        else s += src[i++];
      }
      if (src[i] !== q) fail('SyntaxError: Unterminated string constant (1:' + (i + 1) + ')');
      i++; return s;
    }
    function ident() { const m = src.slice(i).match(/^[A-Za-z_$][\w$]*/); if (!m) fail(); i += m[0].length; return m[0]; }
    function value() {
      ws(); const c = src[i];
      if (c === '{') {
        i++; const o = {}; ws();
        while (src[i] !== '}') {
          ws(); let k;
          if (src[i] === '"' || src[i] === "'") k = str(); else { const m = src.slice(i).match(/^[A-Za-z_$][\w$.]*/); if (!m) fail(); k = m[0]; i += k.length; }
          ws(); if (src[i] !== ':') fail(); i++;
          o[k] = value(); ws();
          if (src[i] === ',') { i++; ws(); continue; }
          if (src[i] !== '}') fail();
        }
        i++; return o;
      }
      if (c === '[') { i++; const a = []; ws(); while (src[i] !== ']') { a.push(value()); ws(); if (src[i] === ',') { i++; ws(); continue; } if (src[i] !== ']') fail(); } i++; return a; }
      if (c === '"' || c === "'") return str();
      if (c === '/') {
        i++; let body = '', inCls = false;
        while (i < src.length && (src[i] !== '/' || inCls)) { if (src[i] === '\\') { body += src[i] + src[i + 1]; i += 2; continue; } if (src[i] === '[') inCls = true; else if (src[i] === ']') inCls = false; body += src[i++]; }
        if (src[i] !== '/') fail('SyntaxError: Unterminated regular expression (1:' + (i + 1) + ')');
        i++; const fl = (src.slice(i).match(/^[gimsuy]*/) || [''])[0]; i += fl.length;
        try { return new RegExp(body, fl.replace(/g/g, '')); } catch (e) { fail('SyntaxError: Invalid regular expression: /' + body + '/'); }
      }
      if (/[-0-9.]/.test(c)) { const m = src.slice(i).match(/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i); if (!m) fail(); i += m[0].length; return parseFloat(m[0]); }
      if (/[A-Za-z_$]/.test(c)) {
        let w = ident();
        if (w === 'true') return true; if (w === 'false') return false; if (w === 'null') return null; if (w === 'undefined') return undefined;
        if (w === 'new') { ws(); w = ident(); }
        ws();
        if (src[i] === '(') {
          i++; ws(); const args = []; while (src[i] !== ')') { args.push(value()); ws(); if (src[i] === ',') { i++; ws(); } else if (src[i] !== ')') fail(); } i++;
          if (w === 'ISODate' || w === 'Date') { const d = args.length ? new Date(args[0]) : new Date(); if (isNaN(d)) fail('Error: invalid ISO date: ' + args[0]); return d; }
          if (w === 'ObjectId') return { $oid: String(args[0] || '') };
          if (w === 'NumberInt' || w === 'NumberLong' || w === 'NumberDecimal' || w === 'Int32' || w === 'Long' || w === 'Double') return +args[0];
          fail('ReferenceError: ' + w + ' is not defined');
        }
        fail('ReferenceError: ' + w + ' is not defined');
      }
      fail();
    }
    const v = value(); ws();
    return { v, rest: i };
  }
  // "db.posts.find({...}).sort({...}).limit(3)" → { coll, calls: [{name, args}] }
  function parseShell(src) {
    let i = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const fail = (m) => { const e = new Error(m || ('SyntaxError: Unexpected token' + (src[i] ? " '" + src[i] + "'" : ' (end of input)') + ' (1:' + (i + 1) + ')')); e.mongo = true; throw e; };
    const id = () => { ws(); const m = src.slice(i).match(/^[A-Za-z_$][\w$]*/); if (!m) fail(); i += m[0].length; return m[0]; };
    function args() {
      ws(); if (src[i] !== '(') fail(); i++; const out = []; ws();
      while (src[i] !== ')') {
        const sub = parseJs(src.slice(i)); out.push(sub.v); i += sub.rest; ws();
        if (src[i] === ',') { i++; ws(); continue; }
        if (src[i] !== ')') fail();
      }
      i++; return out;
    }
    ws();
    if (id() !== 'db') fail('ReferenceError: ' + src.trim().split(/[.(\s]/)[0] + ' is not defined');
    const res = { coll: null, calls: [] };
    ws();
    if (src[i] !== '.') { ws(); if (i >= src.length) return res; fail(); }
    i++;
    let first = id(); ws();
    if (first === 'getCollection' && src[i] === '(') { const a = args(); res.coll = String(a[0]); }
    else if (src[i] === '(') { res.calls.push({ name: first, args: args(), db: true }); }
    else if (src[i] === '[') { i++; ws(); const sub = parseJs(src.slice(i)); i += sub.rest; ws(); if (src[i] !== ']') fail(); i++; res.coll = String(sub.v); }
    else res.coll = first;
    for (;;) {
      ws(); if (i >= src.length) break;
      if (src[i] === ';') { i++; ws(); if (i < src.length) fail(); break; }
      if (src[i] !== '.') fail();
      i++; const name = id(); ws();
      if (res.coll && !res.calls.length && src[i] !== '(') { res.coll += '.' + name; continue; }   // db.system.users gibi
      res.calls.push({ name, args: args() });
    }
    return res;
  }

  // ===================================================================== MONGO — sorgu eşleme
  function getPath(doc, path) {
    const parts = path.split('.'); let cur = [doc];
    for (const p of parts) {
      const next = [];
      cur.forEach((c) => {
        if (c == null) return;
        if (Array.isArray(c)) { if (/^\d+$/.test(p)) next.push(c[+p]); else c.forEach((x) => { if (isObj(x) && p in x) next.push(x[p]); }); }
        else if (typeof c === 'object' && p in c) next.push(c[p]);
      });
      cur = next;
    }
    return cur;   // eşleşen değerler (dizi açılımıyla)
  }
  const get1 = (doc, path) => { const v = getPath(doc, path); return v.length ? v[0] : undefined; };
  // İfade içindeki alan yolu ('$p.title'): dizi üzerinden geçerken her öğenin alanını toplar (MongoDB davranışı)
  function exprPath(doc, path) {
    let cur = doc;
    for (const p of path.split('.')) {
      if (cur == null) return undefined;
      if (Array.isArray(cur)) cur = /^\d+$/.test(p) ? cur[+p] : cur.map((x) => (isObj(x) && !isOid(x) ? x[p] : undefined)).filter((x) => x !== undefined);
      else if (isObj(cur) && !isOid(cur)) cur = cur[p];
      else return undefined;
    }
    return cur;
  }
  function eq(a, b) {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (isOid(a) && isOid(b)) return a.$oid === b.$oid;
    if (isOid(a) && typeof b === 'string') return a.$oid === b;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => eq(x, b[k]));
    if (isObj(a) && isObj(b)) { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => eq(a[k], b[k])); }
    return a === b;
  }
  const typeRank = (v) => (v == null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : isObj(v) ? 3 : Array.isArray(v) ? 4 : isOid(v) ? 5 : typeof v === 'boolean' ? 6 : v instanceof Date ? 7 : 8);
  function cmpM(a, b) {
    const ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    if (a instanceof Date) return a - b;
    if (typeof a === 'number' || typeof a === 'boolean') return a - b;
    if (typeof a === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (isOid(a)) return a.$oid < b.$oid ? -1 : a.$oid > b.$oid ? 1 : 0;
    return 0;
  }
  const sameType = (a, b) => typeRank(a) === typeRank(b);
  function matchOp(vals, op, arg, doc) {
    // vals: alanın değerleri (dizi açılımı dahil). Bir eleman koşulu sağlarsa yeter (Mongo davranışı).
    const flat = []; vals.forEach((v) => { flat.push(v); if (Array.isArray(v)) v.forEach((x) => flat.push(x)); });
    switch (op) {
      case '$eq': return arg === null ? (!vals.length || vals.some((v) => v == null)) : flat.some((v) => (arg instanceof RegExp ? typeof v === 'string' && arg.test(v) : eq(v, arg)));
      case '$ne': return !matchOp(vals, '$eq', arg, doc);
      case '$gt': return flat.some((v) => v != null && sameType(v, arg) && cmpM(v, arg) > 0);
      case '$gte': return flat.some((v) => v != null && sameType(v, arg) && cmpM(v, arg) >= 0);
      case '$lt': return flat.some((v) => v != null && sameType(v, arg) && cmpM(v, arg) < 0);
      case '$lte': return flat.some((v) => v != null && sameType(v, arg) && cmpM(v, arg) <= 0);
      case '$in': if (!Array.isArray(arg)) throw mErr('$in needs an array'); return arg.some((a) => matchOp(vals, '$eq', a, doc));
      case '$nin': if (!Array.isArray(arg)) throw mErr('$nin needs an array'); return !arg.some((a) => matchOp(vals, '$eq', a, doc));
      case '$exists': return arg ? vals.length > 0 && vals.some((v) => v !== undefined) : !vals.length;
      case '$regex': { const re = arg instanceof RegExp ? arg : new RegExp(String(arg), ''); return flat.some((v) => typeof v === 'string' && re.test(v)); }
      case '$options': return true;
      case '$size': return vals.some((v) => Array.isArray(v) && v.length === arg);
      case '$all': return Array.isArray(arg) && arg.every((a) => matchOp(vals, '$eq', a, doc));
      case '$elemMatch': return vals.some((v) => Array.isArray(v) && v.some((x) => (isObj(x) ? matchDoc(x, arg) : Object.keys(arg).every((k) => matchOp([x], k, arg[k], x)))));
      case '$not': return !(arg instanceof RegExp ? matchOp(vals, '$regex', arg, doc) : condMatch(vals, arg, doc));
      case '$type': { const t = { string: 2, number: 1, double: 1, int: 1, object: 3, array: 4, bool: 6, date: 7, null: 0 }[arg]; return vals.some((v) => typeRank(v) === t); }
      default: throw mErr('unknown operator: ' + op);
    }
  }
  function condMatch(vals, cond, doc) {
    if (cond instanceof RegExp) return matchOp(vals, '$regex', cond, doc);
    if (isObj(cond) && Object.keys(cond).some((k) => k[0] === '$')) {
      const re = cond.$regex !== undefined ? (cond.$regex instanceof RegExp ? cond.$regex : new RegExp(String(cond.$regex), (cond.$options || '').replace(/[^imsx]/g, '').replace('x', ''))) : null;
      return Object.keys(cond).every((op) => (op === '$regex' ? matchOp(vals, '$regex', re, doc) : matchOp(vals, op, cond[op], doc)));
    }
    return matchOp(vals, '$eq', cond, doc);
  }
  function matchDoc(doc, filter) {
    if (!filter || !Object.keys(filter).length) return true;
    return Object.keys(filter).every((k) => {
      const v = filter[k];
      if (k === '$and') return Array.isArray(v) && v.every((f) => matchDoc(doc, f));
      if (k === '$or') return Array.isArray(v) && v.some((f) => matchDoc(doc, f));
      if (k === '$nor') return Array.isArray(v) && !v.some((f) => matchDoc(doc, f));
      if (k === '$expr') return truthyM(exprM(v, doc));
      if (k[0] === '$') throw mErr('unknown top level operator: ' + k);
      return condMatch(getPath(doc, k), v, doc);
    });
  }
  function mErr(m) { const e = new Error('MongoServerError: ' + m); e.mongo = true; return e; }

  // Aggregation ifadeleri: "$alan", sabitler, birkaç operatör
  const truthyM = (v) => !(v === false || v === null || v === undefined || v === 0);
  function exprM(e, doc, vars) {
    if (typeof e === 'string' && e[0] === '$') { if (e[1] === '$') return vars && vars[e.slice(2)]; return exprPath(doc, e.slice(1)); }
    if (Array.isArray(e)) return e.map((x) => exprM(x, doc, vars));
    if (!isObj(e)) return e;
    const keys = Object.keys(e);
    if (keys.length === 1 && keys[0][0] === '$') {
      const op = keys[0], raw = e[op], a = Array.isArray(raw) ? raw.map((x) => exprM(x, doc, vars)) : [exprM(raw, doc, vars)];
      const num = (x) => (typeof x === 'number' ? x : x instanceof Date ? x.getTime() : 0);
      switch (op) {
        case '$concat': return a.some((x) => x == null) ? null : a.join('');
        case '$toUpper': return a[0] == null ? '' : String(a[0]).toUpperCase();
        case '$toLower': return a[0] == null ? '' : String(a[0]).replace(/İ/g, 'i').toLowerCase();
        case '$size': if (!Array.isArray(a[0])) throw mErr("The argument to $size must be an array. Type of the argument: " + (a[0] === undefined ? 'missing' : typeof a[0])); return a[0].length;
        case '$add': return a.reduce((s, x) => s + num(x), 0);
        case '$subtract': return num(a[0]) - num(a[1]);
        case '$multiply': return a.reduce((s, x) => s * num(x), 1);
        case '$divide': if (!num(a[1])) throw mErr("can't $divide by zero"); return num(a[0]) / num(a[1]);
        case '$round': { const f = Math.pow(10, a[1] || 0); return Math.round(num(a[0]) * f) / f; }
        case '$ifNull': return a[0] == null ? a[1] : a[0];
        case '$arrayElemAt': return Array.isArray(a[0]) ? a[0][a[1] < 0 ? a[0].length + a[1] : a[1]] : null;
        case '$first': return Array.isArray(a[0]) ? a[0][0] : null;
        case '$last': return Array.isArray(a[0]) ? a[0][a[0].length - 1] : null;
        case '$substr': case '$substrCP': return a[0] == null ? '' : String(a[0]).substr(a[1], a[2]);
        case '$split': return a[0] == null ? null : String(a[0]).split(String(a[1]));
        case '$year': return a[0] instanceof Date ? a[0].getUTCFullYear() : null;
        case '$month': return a[0] instanceof Date ? a[0].getUTCMonth() + 1 : null;
        case '$eq': return eq(a[0], a[1]);
        case '$ne': return !eq(a[0], a[1]);
        case '$gt': return cmpM(a[0], a[1]) > 0;
        case '$gte': return cmpM(a[0], a[1]) >= 0;
        case '$lt': return cmpM(a[0], a[1]) < 0;
        case '$lte': return cmpM(a[0], a[1]) <= 0;
        case '$and': return a.every(truthyM);
        case '$or': return a.some(truthyM);
        case '$not': return !truthyM(a[0]);
        case '$cond': { const c = Array.isArray(raw) ? raw : [raw.if, raw.then, raw.else]; return truthyM(exprM(c[0], doc, vars)) ? exprM(c[1], doc, vars) : exprM(c[2], doc, vars); }
        case '$literal': return raw;
        case '$toString': return a[0] == null ? null : a[0] instanceof Date ? a[0].toISOString() : String(a[0]);
        case '$dateToString': { const spec = raw || {}; const d = exprM(spec.date, doc, vars); if (!(d instanceof Date)) return null; const f = spec.format || '%Y-%m-%dT%H:%M:%S.%LZ'; return f.replace(/%Y/g, d.getUTCFullYear()).replace(/%m/g, pad2(d.getUTCMonth() + 1)).replace(/%d/g, pad2(d.getUTCDate())).replace(/%H/g, pad2(d.getUTCHours())).replace(/%M/g, pad2(d.getUTCMinutes())).replace(/%S/g, pad2(d.getUTCSeconds())).replace(/%L/g, String(d.getUTCMilliseconds()).padStart(3, '0')); }
        default: throw mErr("Unrecognized expression '" + op + "'");
      }
    }
    const o = {}; keys.forEach((k) => { o[k] = exprM(e[k], doc, vars); }); return o;
  }
  function project(doc, spec) {
    const keys = Object.keys(spec || {});
    if (!keys.length) return doc;
    const incl = keys.filter((k) => k !== '_id').some((k) => spec[k] !== 0 && spec[k] !== false);
    if (incl) {
      const o = {};
      if (spec._id !== 0 && spec._id !== false && doc._id !== undefined) o._id = doc._id;
      keys.forEach((k) => {
        if (k === '_id' && (spec._id === 0 || spec._id === false || spec._id === 1 || spec._id === true)) return;
        const v = spec[k];
        const val = v === 1 || v === true ? get1(doc, k) : exprM(v, doc);
        if (val === undefined) return;
        const parts = k.split('.'); let cur = o;
        parts.slice(0, -1).forEach((p) => { cur = cur[p] = isObj(cur[p]) ? cur[p] : {}; });
        cur[parts[parts.length - 1]] = val;
      });
      return o;
    }
    const copy = clone(doc);   // derin kopya (Date, ObjectId, RegExp korunarak)
    keys.forEach((k) => { const parts = k.split('.'); let cur = copy; parts.slice(0, -1).forEach((p) => { cur = cur && cur[p]; }); if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]]; });
    return copy;
  }
  function clone(v) { if (v instanceof Date) return new Date(v.getTime()); if (v instanceof RegExp) return v; if (Array.isArray(v)) return v.map(clone); if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = clone(v[k]); }); return o; } return v; }
  function sortDocs(docs, spec) {
    const keys = Object.keys(spec || {});
    return docs.slice().sort((a, b) => {
      for (const k of keys) { const c = cmpM(get1(a, k), get1(b, k)); if (c) return spec[k] < 0 ? -c : c; }
      return 0;
    });
  }
  function aggregateDocs(docs, pipeline, catalog) {
    if (!Array.isArray(pipeline)) throw mErr('Pipeline must be an array');
    let cur = docs.map(clone);
    pipeline.forEach((stage) => {
      const keys = Object.keys(stage || {});
      if (keys.length !== 1) throw mErr('A pipeline stage specification object must contain exactly one field.');
      const op = keys[0], arg = stage[op];
      switch (op) {
        case '$match': cur = cur.filter((d) => matchDoc(d, arg)); break;
        case '$project': cur = cur.map((d) => project(d, arg)); break;
        case '$addFields': case '$set': cur = cur.map((d) => { const o = clone(d); Object.keys(arg).forEach((k) => { o[k] = exprM(arg[k], d); }); return o; }); break;
        case '$unset': { const ks = Array.isArray(arg) ? arg : [arg]; cur = cur.map((d) => { const o = clone(d); ks.forEach((k) => delete o[k]); return o; }); break; }
        case '$sort': cur = sortDocs(cur, arg); break;
        case '$limit': cur = cur.slice(0, arg); break;
        case '$skip': cur = cur.slice(arg); break;
        case '$count': cur = cur.length ? [{ [arg]: cur.length }] : []; break;
        case '$unwind': {
          const path = (typeof arg === 'string' ? arg : arg.path).replace(/^\$/, ''), keep = arg && arg.preserveNullAndEmptyArrays;
          const next = [];
          cur.forEach((d) => { const v = get1(d, path); if (Array.isArray(v) && v.length) v.forEach((x) => { const o = clone(d); o[path] = x; next.push(o); }); else if (v != null && !Array.isArray(v)) next.push(d); else if (keep) next.push(d); });
          cur = next; break;
        }
        case '$group': case '$sortByCount': {
          const spec = op === '$sortByCount' ? { _id: arg, count: { $sum: 1 } } : arg;
          if (!('_id' in spec)) throw mErr("a group specification must include an _id");
          const map = new Map();
          cur.forEach((d) => { const id = exprM(spec._id, d); const k = JSON.stringify(id instanceof Date ? id.toISOString() : id); if (!map.has(k)) map.set(k, { id, docs: [] }); map.get(k).docs.push(d); });
          cur = Array.from(map.values()).map((g) => {
            const o = { _id: g.id };
            Object.keys(spec).filter((k) => k !== '_id').forEach((k) => {
              const acc = spec[k], aop = Object.keys(acc || {})[0], ex = acc && acc[aop];
              const vals = g.docs.map((d) => exprM(ex, d));
              const nums = vals.filter((v) => typeof v === 'number');
              switch (aop) {
                case '$sum': o[k] = nums.reduce((s, v) => s + v, 0); break;
                case '$avg': o[k] = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null; break;
                case '$min': o[k] = vals.filter((v) => v != null).reduce((m, v) => (m === undefined || cmpM(v, m) < 0 ? v : m), undefined); break;
                case '$max': o[k] = vals.filter((v) => v != null).reduce((m, v) => (m === undefined || cmpM(v, m) > 0 ? v : m), undefined); break;
                case '$first': o[k] = vals[0]; break;
                case '$last': o[k] = vals[vals.length - 1]; break;
                case '$push': o[k] = vals; break;
                case '$addToSet': o[k] = vals.filter((v, x) => vals.findIndex((w) => eq(w, v)) === x); break;
                case '$count': o[k] = g.docs.length; break;
                default: throw mErr('unknown group operator ' + aop);
              }
            });
            return o;
          });
          if (op === '$sortByCount') cur = sortDocs(cur, { count: -1 });
          break;
        }
        case '$lookup': {
          const from = catalog.tables.find((t) => t.name === arg.from);
          const fdocs = from ? from.docs : [];
          cur = cur.map((d) => { const o = clone(d); const lv = getPath(d, arg.localField); o[arg.as] = fdocs.filter((f) => getPath(f, arg.foreignField).some((x) => lv.some((y) => eq(x, y)))).map(clone); return o; });
          break;
        }
        default: throw mErr("Unrecognized pipeline stage name: '" + op + "'");
      }
    });
    return cur;
  }

  // mongosh girdisi: yorumları atar; üst düzeydeki ';' ya da satır sonunda ifadelere böler.
  // Sonraki satır '.' ile başlıyorsa zincir sürer (db.x.find()⏎  .sort(...)). Metin ve düzenli ifade içindekiler dokunulmaz.
  function splitShell(src) {
    const s = String(src || ''), out = [];
    let cur = '', depth = 0, q = null;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (q) { cur += ch; if (ch === '\\' && k + 1 < s.length) { cur += s[++k]; continue; } if (ch === q) q = null; continue; }
      if (ch === '/' && s[k + 1] === '/') { while (k < s.length && s[k] !== '\n') k++; k--; continue; }
      if (ch === '/' && s[k + 1] === '*') { const e = s.indexOf('*/', k + 2); k = (e < 0 ? s.length : e + 2) - 1; cur += ' '; continue; }
      if (ch === '/') {
        const prev = cur.replace(/\s+$/, '').slice(-1);
        if (!prev || '(,:[=!&|?{};'.includes(prev)) {
          let j = k + 1, cls = false;
          while (j < s.length && s[j] !== '\n') { if (s[j] === '\\') { j += 2; continue; } if (s[j] === '[') cls = true; else if (s[j] === ']') cls = false; else if (s[j] === '/' && !cls) break; j++; }
          if (s[j] === '/') { j++; while (j < s.length && /[a-z]/i.test(s[j])) j++; cur += s.slice(k, j); k = j - 1; continue; }
        }
      }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === ';' || ch === '\n')) {
        if (ch === '\n' && /^\s*\./.test(s.slice(k + 1))) { cur += ch; continue; }
        if (cur.trim()) out.push(cur.trim());
        cur = ''; continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function runMongo(src, catalog, state) {
    const t0 = now();
    state = state || { db: 'garage' };
    const done = (r) => Object.assign(r, { ms: now() - t0 });
    try {
      const s = String(src || '').trim().replace(/;\s*$/, '');
      if (!s) return done({ kind: 'none' });
      let m;
      if (/^show\s+(dbs|databases)$/i.test(s)) return done({ kind: 'lines', lines: ['admin    40.00 KiB', 'config   12.00 KiB', 'garage   ' + (catalog.tables.reduce((n, t) => n + t.docs.length, 0) * 0.4 + 24).toFixed(2) + ' KiB', 'local    40.00 KiB'] });
      if (/^show\s+collections$/i.test(s) || /^show\s+tables$/i.test(s)) return done({ kind: 'lines', lines: catalog.tables.map((t) => t.name) });
      if ((m = s.match(/^use\s+(\w+)$/i))) { state.db = m[1]; return done({ kind: 'lines', lines: ['switched to db ' + m[1]] }); }
      if (/^(db|db\.getName\(\))$/.test(s)) return done({ kind: 'lines', lines: [state.db] });
      if (/^(it|exit|quit|help)$/i.test(s)) return done({ kind: 'cmd', cmd: s.toLowerCase() });
      const p = parseShell(s);
      const tables = state.db === 'garage' ? catalog.tables : [];
      if (!p.coll) {
        const c = p.calls[0];
        if (!c) return done({ kind: 'lines', lines: [state.db] });
        if (c.name === 'getCollectionNames') return done({ kind: 'value', value: tables.map((t) => t.name) });
        if (c.name === 'stats') return done({ kind: 'value', value: { db: state.db, collections: tables.length, objects: tables.reduce((n, t) => n + t.docs.length, 0), ok: 1 } });
        if (c.name === 'dropDatabase' || c.name === 'createCollection') throw mErr('not authorized on ' + state.db + ' to execute command { ' + c.name + ': 1 } (garage is read-only)');
        throw new Error('TypeError: db.' + c.name + ' is not a function');
      }
      const coll = tables.find((t) => t.name === p.coll);
      const docs = coll ? coll.docs : [];
      if (!p.calls.length) return done({ kind: 'lines', lines: [state.db + '.' + p.coll] });
      const first = p.calls[0], rest = p.calls.slice(1);
      const WRITE = /^(insert|insertOne|insertMany|update|updateOne|updateMany|replaceOne|delete|deleteOne|deleteMany|remove|drop|createIndex|dropIndex|renameCollection|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite)$/;
      if (WRITE.test(first.name)) throw mErr('not authorized on ' + state.db + ' to execute command { ' + first.name.replace(/One|Many/, '') + ': "' + p.coll + '" } (garage is read-only)');
      let out;
      switch (first.name) {
        case 'find': case 'findOne': {
          const [filter, proj] = first.args;
          if (filter !== undefined && !isObj(filter)) throw mErr('filter must be an object');
          let res = docs.filter((d) => matchDoc(d, filter || {}));
          let sort = null, limit = first.name === 'findOne' ? 1 : null, skip = 0, count = false;
          rest.forEach((c) => {
            if (c.name === 'sort') sort = c.args[0];
            else if (c.name === 'limit') limit = +c.args[0] || null;
            else if (c.name === 'skip') skip = +c.args[0] || 0;
            else if (c.name === 'count' || c.name === 'size') count = true;
            else if (c.name === 'pretty' || c.name === 'toArray') { /* görünüm */ }
            else if (c.name === 'projection') { /* desteklenmiyor */ }
            else throw new Error('TypeError: ' + c.name + ' is not a function');
          });
          if (sort) res = sortDocs(res, sort);
          res = res.slice(skip, limit ? skip + limit : undefined);
          if (count) return done({ kind: 'value', value: res.length });
          res = res.map((d) => project(d, proj));
          out = first.name === 'findOne' ? { kind: 'value', value: res[0] || null } : { kind: 'docs', docs: res };
          break;
        }
        case 'countDocuments': case 'count': out = { kind: 'value', value: docs.filter((d) => matchDoc(d, first.args[0] || {})).length }; break;
        case 'estimatedDocumentCount': out = { kind: 'value', value: docs.length }; break;
        case 'distinct': {
          const field = String(first.args[0] || ''), vals = [];
          docs.filter((d) => matchDoc(d, first.args[1] || {})).forEach((d) => getPath(d, field).forEach((v) => { (Array.isArray(v) ? v : [v]).forEach((x) => { if (!vals.some((w) => eq(w, x))) vals.push(x); }); }));
          out = { kind: 'value', value: vals.sort(cmpM) };
          break;
        }
        case 'aggregate': {
          let res = aggregateDocs(docs, first.args[0] || [], catalog);
          rest.forEach((c) => { if (c.name === 'toArray' || c.name === 'pretty') return; throw new Error('TypeError: ' + c.name + ' is not a function'); });
          out = { kind: 'docs', docs: res };
          break;
        }
        case 'stats': out = { kind: 'value', value: { ns: state.db + '.' + p.coll, count: docs.length, ok: 1 } }; break;
        case 'getIndexes': out = { kind: 'value', value: [{ v: 2, key: { _id: 1 }, name: '_id_' }] }; break;
        default: throw new Error('TypeError: db.' + p.coll + '.' + first.name + ' is not a function');
      }
      return done(out);
    } catch (e) {
      return done({ kind: 'error', error: String(e.message || e) });
    }
  }

  // mongosh gibi yazdır: { _id: ObjectId('…'), name: 'Redis' }
  function inspect(v, indent, opts) {
    indent = indent || 0; opts = opts || {};
    const sp = '  '.repeat(indent + 1), sp0 = '  '.repeat(indent);
    const S = opts.html ? (cls, s) => '<span class="' + cls + '">' + s + '</span>' : (cls, s) => s;
    const escS = opts.html ? (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) : (s) => String(s);
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? escS(k) : S('g', escS("'" + k.replace(/'/g, "\\'") + "'")));
    const one = (x) => {
      if (x === null) return S('v', 'null');
      if (x === undefined) return S('v', 'undefined');
      if (x instanceof Date) return S('b', "ISODate('" + (isNaN(x) ? 'Invalid' : x.toISOString()) + "')");
      if (isOid(x)) return S('b', "ObjectId('" + escS(x.$oid) + "')");
      if (x instanceof RegExp) return S('r', escS(String(x)));
      if (typeof x === 'string') return S('g', escS("'" + x.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"));
      if (typeof x === 'number') return S('b', Number.isInteger(x) ? String(x) : String(+x.toFixed(6)));
      if (typeof x === 'boolean') return S('v', String(x));
      return null;
    };
    const flat = (x) => {
      const o = one(x); if (o != null) return o;
      if (Array.isArray(x)) return x.length ? '[ ' + x.map(flat).join(', ') + ' ]' : '[]';
      const ks = Object.keys(x); return ks.length ? '{ ' + ks.map((k) => key(k) + ': ' + flat(x[k])).join(', ') + ' }' : '{}';
    };
    const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const o = one(v); if (o != null) return o;
    const f = flat(v);
    if (plain(f).length + indent * 2 <= 72) return f;
    if (Array.isArray(v)) return '[\n' + v.map((x) => sp + inspect(x, indent + 1, opts)).join(',\n') + '\n' + sp0 + ']';
    return '{\n' + Object.keys(v).map((k) => sp + key(k) + ': ' + inspect(v[k], indent + 1, opts)).join(',\n') + '\n' + sp0 + '}';
  }

  // ===================================================================== VERİ KATALOĞU (tarayıcıda, G ile)
  // Her tablo/koleksiyon bir kez doküman olarak tanımlanır; SQL görünümü sütun listesinden türetilir.
  function oid(seed, n) { let h = 2166136261; const s = seed + ':' + n; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return { $oid: (0x65 + (n % 16)).toString(16).padStart(2, '0') + '5f' + (h >>> 0).toString(16).padStart(8, '0') + n.toString(16).padStart(12, '0') }; }
  function withIds(name, docs) { return docs.map((d, k) => Object.assign({ _id: oid(name, k + 1) }, d)); }
  const ROUTE_OF = { hakkimda: 'tanis', 'takim-cantasi': 'tanis', 'seyir-defteri': 'tanis', iletisim: 'tanis', sema: 'kurcala', 'kontrol-odasi': 'kurcala', 'veri-odasi': 'kurcala', api: 'kurcala' };
  function build(G, posts) {
    const tx = (o) => G.tx(o), T = (a, b) => G.t(a, b);
    const tables = [];
    const add = (name, group, desc, cols, docs) => tables.push({ name, group, desc, cols, docs: withIds(name, docs) });
    // ---- İçerik
    add('experience', 'content', T('İş deneyimi (config.js)', 'Work experience (config.js)'), [['id', 'int'], ['role', 'nvarchar'], ['company', 'nvarchar'], ['team', 'nvarchar'], ['start', 'varchar'], ['end', 'varchar'], ['note', 'nvarchar']],
      (G.experience || []).map((e, k) => ({ id: k + 1, role: tx(e.role), company: e.company, team: tx(e.team), start: e.start, end: e.end || null, note: e.note ? tx(e.note) : null })));
    add('education', 'content', T('Eğitim', 'Education'), [['id', 'int'], ['school', 'nvarchar'], ['field', 'nvarchar']],
      (G.education || []).map((e, k) => ({ id: k + 1, school: tx(e.school), field: tx(e.field) })));
    const skills = []; let sid = 1;
    (G.toolbox || []).forEach((d) => d.tools.forEach((t) => skills.push({ id: sid++, name: t.name, category: d.id || tx(d.drawer), drawer: tx(d.drawer), note: tx(t.note) })));
    add('skills', 'content', T('Takım çantasındaki teknolojiler', 'Technologies in the toolbox'), [['id', 'int'], ['name', 'nvarchar'], ['category', 'varchar'], ['drawer', 'nvarchar'], ['note', 'nvarchar']], skills);
    const ps = (posts || []).filter((p) => !p.draft);
    add('posts', 'content', T('Seyir Defteri yazıları', 'Logbook posts'), [['slug', 'varchar'], ['title', 'nvarchar'], ['date', 'date'], ['tags', 'nvarchar'], ['summary', 'nvarchar']],
      ps.map((p) => ({ slug: p.slug, title: p.title, date: p.date, tags: (p.tags || []).slice(), summary: p.summary || '' })));
    const ptags = []; ps.forEach((p) => (p.tags || []).forEach((t) => ptags.push({ slug: p.slug, tag: t })));
    add('post_tags', 'content', T('Yazı–etiket eşleşmeleri (JOIN için)', 'Post–tag pairs (for JOINs)'), [['slug', 'varchar'], ['tag', 'varchar']], ptags);
    const PAGES = [
      ['giris', '/', T('Giriş sahnesi', 'Intro scene'), null], ['garaj', '/garaj.html', T('Garaj', 'Garage'), null],
      ['hakkimda', '/hakkimda.html', T('Hakkımda', 'About'), 'tanis'], ['takim-cantasi', '/takim-cantasi.html', T('Takım Çantası', 'Toolbox'), 'tanis'],
      ['seyir-defteri', '/seyir-defteri.html', T('Seyir Defteri', 'Logbook'), 'tanis'], ['yazi', '/yazi.html', T('Yazı', 'Post'), 'tanis'], ['iletisim', '/iletisim.html', T('İletişim', 'Contact'), 'tanis'],
      ['sema', '/sema.html', T('Şema', 'Blueprint'), 'kurcala'], ['kontrol-odasi', '/kontrol-odasi.html', T('Kontrol Odası', 'Control Room'), 'kurcala'],
      ['veri-odasi', '/veri-odasi.html', T('Veri Odası', 'Data Room'), 'kurcala'], ['api', '/api.html', 'API', 'kurcala'], ['cv', '/cv.html', 'CV', null]
    ];
    add('pages', 'content', T('Sitenin sayfaları ve rotaları', 'Site pages and routes'), [['page', 'varchar'], ['path', 'varchar'], ['title', 'nvarchar'], ['route', 'varchar']],
      PAGES.map(([page, path, title, route]) => ({ page, path, title, route })));
    // ---- Bu oturum (canlı)
    const views = (G.metrics && G.metrics.views ? G.metrics.views() : []);
    add('page_views', 'session', T('Bu sekmede açtığın sayfalar', 'Pages you opened in this tab'), [['id', 'int'], ['page', 'varchar'], ['viewed_at', 'datetime'], ['load_ms', 'int'], ['ttfb_ms', 'int'], ['lcp_ms', 'int'], ['cls', 'float'], ['inp_ms', 'int'], ['transfer_kb', 'float'], ['nav_type', 'varchar']],
      views.map((v, k) => ({ id: k + 1, page: v.page, viewed_at: new Date(v.t), load_ms: v.load, ttfb_ms: v.ttfb, lcp_ms: v.lcp || null, cls: v.cls == null ? null : v.cls, inp_ms: v.inp || null, transfer_kb: v.bytes ? +(v.bytes / 1024).toFixed(1) : 0, nav_type: v.type })));
    const res = []; views.forEach((v, k) => (v.res || []).forEach((r) => res.push({ view_id: k + 1, page: v.page, name: r[0], type: r[1], start_ms: r[2], duration_ms: r[3], size_kb: r[4] ? +(r[4] / 1024).toFixed(1) : 0 })));
    add('resources', 'session', T('Sayfaların yüklediği dosyalar (Resource Timing)', 'Files each page loaded (Resource Timing)'), [['view_id', 'int'], ['page', 'varchar'], ['name', 'varchar'], ['type', 'varchar'], ['start_ms', 'int'], ['duration_ms', 'int'], ['size_kb', 'float']], res);
    const logs = (G.logs ? G.logs() : []);
    add('logs', 'session', T('Sitenin bu oturumdaki logları', 'This session’s site logs'), [['id', 'int'], ['ts', 'datetime'], ['level', 'varchar'], ['page', 'varchar'], ['msg', 'nvarchar'], ['fields', 'nvarchar']],
      logs.map((l, k) => ({ id: k + 1, ts: new Date(l.ts), level: l.level, page: l.page, msg: l.msg, fields: l.fields && Object.keys(l.fields).length ? l.fields : null })));
    const sim = (G.store && G.store.json('garage-sim-req-v1', true)) || [];
    add('sim_requests', 'session', T('Şema’da gönderdiğin istekler', 'Requests you sent on the Blueprint'), [['id', 'int'], ['ts', 'datetime'], ['method', 'varchar'], ['path', 'varchar'], ['route', 'varchar'], ['status', 'int'], ['cache', 'varchar'], ['db', 'varchar'], ['total_ms', 'float'], ['trace_id', 'varchar']],
      sim.map((r, k) => ({ id: k + 1, ts: new Date(r.ts), method: r.method || 'GET', path: r.path, route: r.route, status: r.status, cache: r.cache || null, db: r.db || null, total_ms: r.ms, trace_id: r.trace })));
    const keys = G.redis ? G.redis.entries() : [];
    add('redis_keys', 'session', T('Paylaşılan Redis önbelleğindeki anahtarlar', 'Keys in the shared Redis cache'), [['key', 'varchar'], ['value', 'nvarchar'], ['ttl', 'int']],
      keys.map((e) => ({ key: e.k, value: e.v, ttl: e.ttl > 0 ? Math.ceil(e.ttl / 1000) : -1 })));
    const ms = G.metrics && G.metrics.series ? G.metrics.series() : [];
    add('metrics', 'session', T('Prometheus metrikleri (sayaç ve göstergeler)', 'Prometheus metrics (counters and gauges)'), [['name', 'varchar'], ['type', 'varchar'], ['labels', 'nvarchar'], ['value', 'float']],
      ms.map((m) => ({ name: m.name, type: m.type, labels: m.labels || null, value: m.value })));
    return { tables, builtAt: Date.now() };
  }
  let postsP = null;
  function loadPosts(base) {
    if (!postsP) postsP = (typeof fetch === 'function' ? fetch((base || '') + 'posts/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((j) => j.posts || []) : Promise.resolve([])).catch(() => []);
    return postsP;
  }
  function catalog(G) { return loadPosts((typeof document !== 'undefined' && document.body && document.body.dataset.root) || '').then((posts) => build(G, posts)); }

  // Hata metni (sqlcmd/SSMS biçimi)
  const sqlErrText = (e) => 'Msg ' + e.n + ', Level ' + e.level + ', State ' + (e.state || 1) + ', Line ' + (e.line || 1) + '\n' + e.msg;

  const API = { loadPosts, splitBatches, splitShell, runSql, runMongo, parseSql, parseShell, parseJs: (s) => parseJs(s).v, matchDoc, aggregateDocs, inspect, catalog, build, toCell, sqlErrText, ROUTE_OF };
  root.GarageQuery = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
