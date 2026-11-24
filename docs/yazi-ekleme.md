# Seyir Defteri — yazı ekleme

## En kolay yol: yönetim paneli
1. https://emrec54.github.io/admin/ adresini aç, **Sign In with Token** ile gir (anahtarı nasıl alacağın README.md → Yönetim paneli).
2. **Seyir Defteri → New Yazı**: başlık, tarih, özet, etiketler ve metni yaz.
3. **Save** (Kaydet). 1-2 dakika sonra yazı sitede, RSS'te ve site haritasında olur.

- Yazıyı gizlemek için **Taslak** kutusunu işaretle.
- Görsel eklemek için metin editöründeki görsel düğmesini kullan; dosya `assets/img/yazi/` klasörüne yüklenir.

## Elle (GitHub'da ya da bilgisayarında)
1. `posts/` klasörüne `yazi-adi.md` adında bir dosya oluştur (küçük harf, boşluk yerine tire).
2. En üste başlık bölümünü yaz, altına metni. Örnek: `docs/yazi-sablonu.md`.

```
---
title: "Yazının başlığı"
date: 2026-12-01
summary: "Listede görünecek bir iki cümlelik özet."
tags:
  - redis
  - dotnet
---

Metin buradan başlar.
```

- `posts/index.json` yayında bu başlıklardan **otomatik üretilir**; elle değiştirme.
- Gizlemek için başlık bölümüne `draft: true`, sonradan güncellediğinde `updated: 2026-12-05` ekle.
- Okuma süresi otomatik hesaplanır; yazılar tarihe göre en yeniden eskiye sıralanır.
- Kod blokları için dil adı yaz: `csharp`, `sql`, `json`, `js`, `bash`, `yaml`. Dil adından sonra dosya adı da yazabilirsin: ```` ```csharp Program.cs ````
- Yerelde önizlemek için `node scripts/build.mjs --write`.
