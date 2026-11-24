# Seyir Defteri — yazı ekleme

1. Bu klasöre `yazi-adi.md` adında bir dosya oluştur (Türkçe karakter ve boşluk kullanma). Biçim için `_sablon.md` dosyasına bak.
2. `index.json` dosyasındaki `posts` listesine şunu ekle:

```json
{
  "slug": "yazi-adi",
  "title": "Yazının başlığı",
  "date": "2026-12-01",
  "summary": "Listede görünecek bir iki cümlelik özet.",
  "tags": ["redis", "dotnet"]
}
```

- Yazıyı geçici olarak gizlemek için `"draft": true` ekle.
- Okuma süresi otomatik hesaplanır; yazılar tarihe göre en yeniden eskiye sıralanır.
- Kod blokları için dil adı yaz: `csharp`, `sql`, `json`, `js`, `bash`, `yaml`. Dil adından sonra dosya adı da yazabilirsin: ```` ```csharp Program.cs ````
3. Yerelde önizlemek için `node scripts/build.mjs --write` çalıştır: yazının statik sayfası `yazi/yazi-adi.html` olarak üretilir. Yayında (GitHub Actions) bu adım kendiliğinden yapılır; sayfa site haritasına ve RSS'e de girer.

- Yazıyı güncellediğinde `index.json`'a `"updated": "2026-12-05"` ekleyebilirsin: site haritası ve arama motorları için "son değişiklik" tarihi olur.
- Paylaşırken `https://emrec54.github.io/yazi/yazi-adi.html` adresini kullan: LinkedIn önizlemesinde başlık ve özet görünür.
