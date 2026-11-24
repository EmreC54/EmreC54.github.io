# Garage by Emre Çuhadar

Kişisel site: https://emrec54.github.io — framework yok; düz HTML, CSS ve JavaScript.

## Klasörler
- `index.html` giriş sahnesi (masa, kavisli monitör, tıklanabilir nesneler: şema, takım çantası, sunucu dolabı, klavye, ampuller, floresan, veritabanı sunucusu, işleme tezgâhı, arşiv kutuları)
- `garaj.html` dört kapılı ana sayfa ve iki rota (Tanış / Kurcala) · `hakkimda`, `takim-cantasi`, `seyir-defteri`, `iletisim` bölmeler
- `yazi/<slug>.html` her yazının statik sayfası (yayında üretilir; arama motoru ve paylaşım önizlemesi için başlık, özet, canonical, JSON-LD) · `yazi.html#slug` eski bağlantılar ve taslaklar için
- `sema.html` bir isteğin API → Redis → MSSQL/MongoDB yolculuğu (Graylog / Prometheus / Grafana simülasyonu; kaos: yavaş / kapalı / dalgalı veritabanı; Polly tarzı yeniden deneme ve devre kesici, tek uçuş, token bucket hız sınırı; PUT ile önbellek geçersiz kılma ve önbellek fırtınası senaryoları; her isteğin iz (trace) zaman çizelgesi)
- `kontrol-odasi.html` sitenin kendi canlı metrikleri: zaman aralığı seçici, ortak artı imleçli grafikler, olay işaretleri, sayfa yükleme şelalesi (Resource Timing), Graylog sözdizimiyle log arama + histogram, GitHub Actions yayın geçmişi, `/metrics` çıktısı
- `veri-odasi.html` sitenin içeriği ve bu ziyaretin ölçümleri üzerinde salt okunur **SQL** (T-SQL alt kümesi) ve **MongoDB** konsolu
- `api.html` gerçek JSON uçlarının Swagger tarzı belgesi (`api/openapi.json`)
- `config.js` kişisel bilgiler, atölye saatleri, takım çantası, giscus ayarları — API de buradan üretilir
- `posts/` Seyir Defteri yazıları (nasıl yazı ekleneceği: `posts/README.md`)
- `assets/` CSS, JS, fontlar, görseller · `sw.js` + `manifest.webmanifest` çevrimdışı çalışma
- `assets/js/query.js` Veri Odası ve terminalin ortak sorgu motoru (elle yazılmış SQL ve mongosh ayrıştırıcıları; `eval` yok)
- `assets/js/plan.js` garajın kat planı (`M` tuşu) · `assets/js/xray.js` röntgen modu (`X` tuşu: bölümleri yapan dosyalar, GitHub bağlantılarıyla)
- `scripts/build.mjs` yayın öncesi kontrol (kırık bağlantı, yazı listesi) + RSS, site haritası, **API dosyaları**, **yazı sayfaları**
- `scripts/smoke.mjs` duman testi: yayındaki siteyi gerçekten dolaşır (sayfalar, API, RSS, 404, sürüm tutarlılığı)
- `assets/js/qr.js` bağımlılıksız QR kod üreticisi (paylaş penceresi ve CV'deki kod)

## API
`scripts/build.mjs` her yayında `config.js` ve `posts/index.json`'dan şu dosyaları üretir (Türkçe `api/`, İngilizce `api/en/`):
`index.json`, `emre.json`, `stack.json`, `experience.json`, `posts.json`, `cv.json` (JSON Resume v1.0.0), `health.json` ve `api/openapi.json`.
Yerelde önizlerken (ve her yeni yazıdan sonra) bir kez `node scripts/build.mjs --write` çalıştır; API dosyaları ve `yazi/<slug>.html` sayfaları kök klasöre yazılır. Yayında GitHub Actions hep tazesini üretir.

```
curl -s https://emrec54.github.io/api/emre.json
```

## Yayın (GitHub Pages)
1. Bütün dosyaları `EmreC54/EmreC54.github.io` deposunun köküne yükle. Gizli `.github` klasörü ve `.nojekyll` dosyası da yüklenmeli.
2. Ayarlar → Pages → Source: **GitHub Actions**.
3. Her push'ta `.github/workflows/deploy.yml` siteyi kontrol eder ve yayınlar. Hata varsa Actions sekmesinde Türkçe açıklamasıyla görünür.

4. Yayından sonra `.github/workflows/smoke.yml` canlı siteyi dolaşır (her pazartesi de). Yayını engellemez; sorun bulursa iş kırmızı olur ve GitHub e-posta atar. Sonuç tablosu: Actions → Duman testi → Summary.

Yerelde kontrol: `node scripts/build.mjs --check` · canlı siteyi test: `node scripts/smoke.mjs`

## Kısayollar
`Ctrl/⌘ K` komut paleti · `M` garaj planı · `X` röntgen · `"` veya `` ` `` terminal · garajda `1–4` kapılar, `L` ışıklar · Şema'da `R` istek, `B` yük testi · Veri Odası'nda `Ctrl/⌘ Enter` çalıştır · `?` liste

## Terminal
`help` tüm komutlar, `man <komut>` ayrıntı. Borular desteklenir:
```
curl /api/stack.json | jq '.drawers[].name'
logs | grep -ic info
sql SELECT category, COUNT(*) AS n FROM skills GROUP BY category
mongosh --eval "db.posts.find({}, { _id: 0, title: 1 })"
map · route · plan
```

## Küçük ayrıntılar
- İki rota: **Tanış** (Hakkımda → Takım Çantası → Seyir Defteri → İletişim) ve **Kurcala** (Şema → Kontrol Odası → Veri Odası → API). Her odanın altında rota çubuğu, üst barda "buradasın" mini planı var; gezilen odalar işaretlenir.
- Teknik odalarda **Basit / Teknik** anlatım düğmesi: seçim hatırlanır.
- Alt bilgideki **Paylaş · QR** ve İletişim'deki tuşlar: QR kod, bağlantıyı kopyala, rehbere ekle (vCard, `config.js`'ten üretilir).
- Sayfalar arası geçişler yumuşak (View Transitions; destekleyen tarayıcılarda, hareket azaltılmışsa ve hafif modda kapalı). Kartlarda imleci izleyen hafif ışık (sadece fare). Kontrol Odası'ndaki ve garaj tabelasındaki sayılar kilometre saati gibi döner.
- Garaj tabelasında atölye durumu (açıkken buharı tüten kupa, gece ay) ve Kocaeli'nin anlık havası: **Open-Meteo**'dan gelir, anahtar ve çerez yok, 30 dakika sekmede saklanır. İstek ziyaretçinin tarayıcısından gider; istemezsen `config.js` → `weather.enabled: false`.
- Gezilen bölmelerin kepenk şeridinde küçük yeşil durum ışığı yanar.
- Kare hızı uzun süre 24'ün altında kalırsa **hafif mod** kendiliğinden açılır (toz, ışık animasyonları, yansıma ve bulanıklık kapanır). Komut paletinde "hafif" ya da "efekt" yazarak elle açıp kapatılır; elle yapılan seçim hatırlanır.

## Ziyaretçi defteri
https://giscus.app üzerinden `repoId` ve `categoryId` değerlerini alıp `config.js` → `giscus` bölümüne yaz.
