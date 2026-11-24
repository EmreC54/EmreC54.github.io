---
title: "Garaj açıldı: Bu siteyi nasıl kurdum?"
date: 2026-11-20
summary: "Framework kullanmadan, düz HTML, CSS ve JavaScript ile 3B bir garaj kurmak: kavisli monitör, katlanan kepenkler ve akıcılık için verdiğim kararlar."
tags:
  - frontend
  - css-3d
  - performans
  - github-pages
---

Kişisel bir site yapmaya karar verdiğimde iki şey istedim: sıradan bir özgeçmiş sayfası gibi durmasın ve her parçasını kendim anlayabileyim. Sonuç, kapıları açılan bir garaj oldu. Bu ilk kayıtta siteyi nasıl kurduğumu ve yol boyunca öğrendiklerimi not ediyorum.

## Neden framework yok?

Site GitHub Pages üzerinde, yani sunucu yok; her şey statik dosya. React ya da Vue gibi bir framework kullanmak yerine düz HTML, CSS ve JavaScript seçtim. Sebepleri basit:

- **Derleme adımı yok.** Dosyayı değiştirip depoya göndermek yeterli.
- **Ne yüklendiğini biliyorum.** Sayfa açılırken gereksiz bir paket inmiyor.
- **Backend tarafından gelen biri için iyi bir egzersiz.** Tarayıcının nasıl çizim yaptığını, neyin pahalı olduğunu birebir görüyorsun.

## Kavisli monitör: 48 şerit ve biraz geometri

Giriş sahnesindeki monitör içe doğru kavisli. CSS ile bir elemanı bükemezsin, ama perspektif içinde **izleyiciye yaklaşan bir şey büyük görünür**. Ekranı 48 dikey şeride böldüm ve her şeridi farklı bir derinliğe (Z) koydum: kenardaki şeritler daha yakın, ortadakiler daha uzak.

Perspektif mesafesi `P` iken, `z` kadar öne çekilen bir şerit `P / (P - z)` kat büyük görünür. Kenarların %4 daha uzun görünmesi için gereken derinliği tersinden hesaplıyorum:

```js intro.js
const f = 1 + (EDGE - 1) * nx * nx;   // kenara doğru büyüme (nx: -1…1)
const z = P * (1 - 1 / f);            // bu büyümeyi veren derinlik
const preW = stripWidth / f;          // perspektif büyüteceği için önceden küçült
```

Şeritler önceden küçültülüp öne çekildiği için önden bakınca kusursuz birleşiyorlar, kamera hafifçe dönünce de gerçek bir kavis gibi davranıyorlar.

## Kepenkler: tek bir rotateX

Kapılar yukarı kaymıyor; gerçek bir seksiyonel kapı gibi tavana katlanıyor. Bunun için kapının dönme noktasını üst kenara alıp X ekseninde neredeyse 90 derece çevirmek yetiyor:

```css style.css
.door { transform-origin: 50% 0; transition: transform 1s cubic-bezier(.6,.05,.25,1); }
.bay:hover .door { transform: rotateX(-88deg); }
```

Çerçeveye verilen `perspective`, kapının tavana doğru kaçarken incelmesini sağlıyor.

## Akıcılık: neyi kaldırdım?

İlk sürüm güzel görünüyordu ama takılıyordu. Ölçünce suçlular netleşti:

| Sorun | Neden pahalı | Çözüm |
| --- | --- | --- |
| Monitörün içinde canlı site (iframe) | Aynı sayfa ikinci kez çalışıyordu | Önceden alınmış ekran görüntüleri |
| `mix-blend-mode` ışıklar | Her karede katman karıştırma | Normal saydamlık |
| Fare hareketinde `body` üzerinde CSS değişkeni | Tüm sayfanın stili yeniden hesaplanıyordu | Sadece ilgili elemana, karede bir kez |
| Hareketli sahne üstünde `backdrop-filter` | Her karede bulanıklık | Opak arka plan |

> [!NOT] Kural olarak sadece `transform` ve `opacity` canlandırıyorum. Bu ikisi ekran kartında birleştirilir; geri kalan her şey yeniden çizim demek.

## Sırada ne var?

Garaj artık Kocaeli saatine göre sabah, gündüz, akşam ve gece farklı görünüyor; site İngilizce de okunabiliyor. Bu defterde backend tarafında öğrendiklerimi, özellikle önbellekleme, loglama ve izleme üzerine notları paylaşacağım.
