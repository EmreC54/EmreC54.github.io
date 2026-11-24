// Garage by Emre Çuhadar — AYARLAR (config.js)
// Kişisel METİNLER (hakkımda, deneyim, eğitim, takım çantası, CV) artık icerik.json'da.
// Burada sitenin AYARLARI var: bağlantılar, atölye saatleri, hava durumu, gün döngüsü, ziyaretçi defteri, terminal komutları.
// Değiştirdikten sonra sayfayı yenilemen yeterli.

window.GARAGE = {
  name: 'Emre Çuhadar',
  city: 'Kocaeli',
  timeZone: 'Europe/Istanbul',              // Kocaeli, İstanbul ile aynı saat dilimi
  email: 'cuhadaremre54@gmail.com',
  github: 'https://github.com/EmreC54',
  linkedin: 'https://www.linkedin.com/in/emre-%C3%A7uhadar-b49871297',
  site: 'https://emrec54.github.io',

  // Atölye saatleri (tabeladaki "atölye açık / kapalı"). Gün: 1=Pzt … 7=Paz
  workshop: { days: [1, 2, 3, 4, 5], open: 9, close: 18 },

  // Garaj tabelasındaki hava durumu (Open-Meteo; anahtar gerekmez, çerez yok).
  // İstek ziyaretçinin tarayıcısından api.open-meteo.com'a gider; 30 dakika sekmede saklanır.
  // İstemezsen enabled: false yap.
  weather: { enabled: true, latitude: 40.7654, longitude: 29.9408 },

  // Gün döngüsü sınırları (Kocaeli saatiyle)
  phases: { morning: 6, day: 10, evening: 17, night: 20 },

  // Her zaman dilimi için ayrı sahne görseli (yapay zekayla ürettiğinde ekle).
  // Boş bırakılan dilimde ana görsel + ışık katmanları kullanılır.
  sceneImages: {
    // morning: 'assets/img/scene/morning.jpg',
    // day: 'assets/img/scene/day.jpg',
    // evening: 'assets/img/scene/evening.jpg',
    // night: 'assets/img/scene/night.jpg'
  },

  // Ziyaretçi defteri (giscus). repoId ve categoryId doluysa defter açılır, boşsa "yakında" kartı görünür.
  giscus: {
    repo: 'EmreC54/EmreC54.github.io',
    repoId: '',
    category: 'Ziyaretçi Defteri',
    categoryId: ''
  },

  // Terminale kendi komutlarını ekle: (lang, args) => [satırlar]. Satırlarda basit HTML kullanılabilir.
  commands: {
    sudo: (lang) => lang === 'en'
      ? ['<span class="c">Permission denied.</span> Only Emre has the keys to this garage.']
      : ['<span class="c">Permission denied.</span> Bu garajın anahtarı sadece Emre’de.']
  }
};

// icerik.json'daki kişisel bilgiler (yayında assets/js/icerik.js olarak üretilir) ayarlara eklenir.
Object.assign(window.GARAGE, window.GARAGE_ICERIK || {});
