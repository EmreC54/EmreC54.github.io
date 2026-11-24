// Garage — Seyir Defteri motoru (blog.js)
// Yazılar posts/ klasöründe Markdown (.md) dosyaları; listesi posts/index.json'da.
// Dışarıdan kütüphane yok: Markdown çevirici ve kod renklendirici burada.
(function () {
  'use strict';
  const G = window.GARAGE;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ veriler
  let indexP = null;
  const mdCache = {};
  function list() {
    if (!indexP) {
      indexP = fetch('posts/index.json', { cache: 'no-cache' })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((j) => (j.posts || []).filter((p) => !p.draft).sort((a, b) => (a.date < b.date ? 1 : -1)));
    }
    return indexP;
  }
  function source(slug) {
    if (!mdCache[slug]) {
      mdCache[slug] = fetch('posts/' + encodeURIComponent(slug) + '.md', { cache: 'no-cache' })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
    }
    return mdCache[slug];
  }
  function minutes(md) {
    const words = md.replace(/```[\s\S]*?```/g, ' kod ').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }
  function fmtDate(iso) {
    try {
      return new Intl.DateTimeFormat(G.lang() === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(iso + 'T00:00:00Z'));
    } catch (e) { return iso; }
  }

  // ------------------------------------------------------------ kod renklendirme
  const KW = {
    csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while with yield',
    js: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
    sql: 'select from where and or not insert into values update set delete create table index on join left right inner outer group by order having as distinct top limit null is in exists between like primary key foreign references begin commit rollback transaction with',
    bash: 'if then else fi for do done while case esac function return export echo cd sudo',
    json: 'true false null',
    yaml: 'true false null yes no'
  };
  KW.cs = KW['c#'] = KW.csharp; KW.javascript = KW.ts = KW.typescript = KW.js; KW.sh = KW.shell = KW.bash; KW.yml = KW.yaml;
  function highlight(code, lang) {
    lang = (lang || '').toLowerCase();
    const kw = new Set((KW[lang] || '').split(' '));
    const lineComment = lang === 'sql' ? '--' : (lang === 'bash' || lang === 'sh' || lang === 'yaml' || lang === 'yml' ? '#' : '//');
    const re = new RegExp(
      '(\\/\\*[\\s\\S]*?\\*\\/|' + lineComment.replace(/[/]/g, '\\/') + '[^\\n]*)' +   // 1 yorum
      '|("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)' +          // 2 metin
      '|(\\b\\d[\\d_]*(?:\\.\\d+)?[a-zA-Z]?\\b)' +                                          // 3 sayı
      '|([A-Za-z_][\\w]*)', 'g');                                                           // 4 kelime
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += '<span class="tk-c">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tk-s">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tk-n">' + esc(m[3]) + '</span>';
      else if (m[4]) {
        const w = m[4];
        if (kw.has(lang === 'sql' ? w.toLowerCase() : w)) out += '<span class="tk-k">' + w + '</span>';
        else if ((lang === 'csharp' || lang === 'cs' || lang === 'c#') && /^[A-Z]/.test(w)) out += '<span class="tk-t">' + w + '</span>';
        else if (/^\s*\(/.test(code.slice(re.lastIndex))) out += '<span class="tk-f">' + w + '</span>';
        else out += w;
      }
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  // ------------------------------------------------------------ Markdown → HTML
  // Bağlantılarda sadece güvenli adresler: http(s), mailto, sayfa içi ve göreli yollar (javascript: vb. engellenir)
  const safeUrl = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|mailto):/i.test(u) ? '#' : u);
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push('<code>' + esc(c) + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src, title) =>
      '<figure><img src="' + safeUrl(src) + '" alt="' + alt + '" loading="lazy" decoding="async">' + (title ? '<figcaption>' + title + '</figcaption>' : '') + '</figure>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => {
      href = safeUrl(href);
      const ext = /^https?:/.test(href);
      return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + txt + (ext ? ' ↗' : '') + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  }
  const slugify = (t) => t.toLowerCase().replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function render(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const html = [], toc = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,4}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s|---\s*$|\|)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = line.match(/^```\s*([\w#+-]*)\s*(.*)$/))) {                    // kod bloğu
        const lang = m[1], title = m[2]; const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        html.push('<div class="code"><div class="code-bar"><span>' + esc(title || lang || 'code') + '</span><button type="button" class="copy-code">' + G.t('kopyala', 'copy') + '</button></div><pre><code>' + highlight(buf.join('\n'), lang) + '</code></pre></div>');
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {                    // başlık
        // Sayfanın h1'i yazının başlığıdır: # ve ## → h2, ### → h3, #### → h4
        const lvl = Math.min(4, Math.max(2, m[1].length)), text = inline(m[2]), id = slugify(m[2]);
        if (lvl === 2) toc.push({ id, text });
        html.push('<h' + lvl + ' id="' + id + '"><a class="anchor" href="#' + id + '" aria-hidden="true" tabindex="-1">#</a>' + text + '</h' + lvl + '>');
        i++;
      } else if (/^---\s*$/.test(line)) { html.push('<hr>'); i++; }
      else if (/^>\s?/.test(line)) {                                          // alıntı / not
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        let cls = 'quote', first = buf[0] || '';
        const n = first.match(/^\[!(NOT|NOTE|İPUCU|TIP|UYARI|WARNING)\]\s*/i);
        if (n) { cls = 'callout ' + (/(uyar|warn)/i.test(n[1]) ? 'warn' : 'note'); buf[0] = first.slice(n[0].length); }
        html.push('<blockquote class="' + cls + '">' + buf.filter((b) => b.trim()).map((b) => '<p>' + inline(b) + '</p>').join('') + '</blockquote>');
      } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {                            // liste
        const ordered = /^\s*\d+\./.test(line); const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        html.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.map((t) => '<li>' + inline(t.replace(/^\[( |x)\]\s*/i, (x, c) => (c.trim() ? '✓ ' : '☐ '))) + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      } else if (/^\|/.test(line)) {                                           // tablo
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
        const head = cells(rows[0]); const body = rows.slice(/^\|\s*:?-/.test(rows[1] || '') ? 2 : 1);
        html.push('<div class="table"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          body.map((r) => '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      } else {                                                                 // paragraf
        const buf = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
        if (!buf.length) buf.push(lines[i++]);
        html.push('<p>' + inline(buf.join(' ')) + '</p>');
      }
    }
    return { html: html.join('\n'), toc };
  }

  // Kod bloklarındaki "kopyala" düğmeleri
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.copy-code');
    if (!b) return;
    const code = b.closest('.code').querySelector('code').innerText;
    const done = () => { b.textContent = G.t('kopyalandı ✓', 'copied ✓'); setTimeout(() => { b.textContent = G.t('kopyala', 'copy'); }, 1800); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(done, () => G.copy && G.copy(code));
    else if (G.copy) G.copy(code, G.t('Kod', 'Code'));
  });

  G.blog = { list, source, render, minutes, fmtDate, esc, highlight };
})();
