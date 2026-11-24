// Garage by Emre Çuhadar — AYARLAR (config.js)
// Sitedeki kişisel bilgilerin çoğu buradan gelir. Metinler iki dilli: { tr: '…', en: '…' }.
// Terminal (whoami, deneyim, curl /api/emre, sqlcmd) ve takım çantası bu verileri kullanır.
// Değiştirdikten sonra sayfayı yenilemen yeterli.

window.GARAGE = {
  name: 'Emre Çuhadar',
  city: 'Kocaeli',
  timeZone: 'Europe/Istanbul',              // Kocaeli, İstanbul ile aynı saat dilimi
  email: 'cuhadaremre54@gmail.com',
  github: 'https://github.com/EmreC54',
  linkedin: 'https://www.linkedin.com/in/emre-%C3%A7uhadar-b49871297',
  site: 'https://emrec54.github.io',

  profile: {
    role: { tr: 'Backend Yazılım Geliştirici', en: 'Backend Software Developer' },
    team: { tr: 'Uygulama Altyapıları', en: 'Application Infrastructure' },
    company: 'Seyir Mobil',
    since: '2026-10',
    location: { tr: 'Kocaeli, Türkiye', en: 'Kocaeli, Türkiye' }
  },

  // En yeni en üstte. end: null → hâlâ devam ediyor
  experience: [
    { role: { tr: 'Backend Yazılım Geliştirici', en: 'Backend Software Developer' }, company: 'Seyir Mobil',
      team: { tr: 'Uygulama Altyapıları', en: 'Application Infrastructure' }, start: '2026-10', end: null },
    { role: { tr: 'Stajyer', en: 'Intern' }, company: 'Seyir Mobil',
      team: { tr: 'Mobil Uygulama Geliştirme', en: 'Mobile Application Development' }, start: '2025', end: '2026',
      note: { tr: '~8 ay', en: '~8 months' } }
  ],

  education: [
    { school: { tr: 'Mehmet Akif Ersoy Üniversitesi', en: 'Mehmet Akif Ersoy University' },
      field: { tr: 'Bilişim Sistemleri ve Teknolojileri', en: 'Information Systems and Technologies' } }
  ],

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

  // Takım çantası çekmeceleri (Takım Çantası sayfası, terminal ve sqlcmd "skills" tablosu)
  toolbox: [
    { drawer: { tr: 'Dil & Framework', en: 'Language & Framework' }, id: 'lang', tools: [
      { name: 'C#', note: { tr: 'Servisleri yazdığım ana dil.', en: 'My main language for building services.' } },
      { name: '.NET', note: { tr: 'API’lerin ve arka plan servislerinin çalıştığı platform.', en: 'The platform my APIs and background services run on.' } },
      { name: 'ASP.NET', note: { tr: 'HTTP API’leri ve web servisleri.', en: 'HTTP APIs and web services.' } }
    ] },
    { drawer: { tr: 'Veri & Önbellek', en: 'Data & Caching' }, id: 'data', tools: [
      { name: 'MSSQL', note: { tr: 'İlişkisel veriler, sorgular ve raporlama.', en: 'Relational data, queries and reporting.' } },
      { name: 'MongoDB', note: { tr: 'Esnek şemalı, doküman tabanlı veriler.', en: 'Flexible, document-based data.' } },
      { name: 'Redis', note: { tr: 'Önbellek ve hızlı anahtar-değer erişimi.', en: 'Caching and fast key-value access.' } }
    ] },
    { drawer: { tr: 'Gözlemlenebilirlik', en: 'Observability' }, id: 'obs', tools: [
      { name: 'Graylog', note: { tr: 'Logları toplama, arama ve hata ayıklama.', en: 'Collecting, searching and debugging logs.' } },
      { name: 'Grafana', note: { tr: 'Metrik panoları ve uyarılar.', en: 'Metric dashboards and alerts.' } },
      { name: 'Prometheus', note: { tr: 'Servislerden metrik toplama.', en: 'Collecting metrics from services.' } }
    ] }
  ],

  // Terminale kendi komutlarını ekle: (lang, args) => [satırlar]. Satırlarda basit HTML kullanılabilir.
  commands: {
    sudo: (lang) => lang === 'en'
      ? ['<span class="c">Permission denied.</span> Only Emre has the keys to this garage.']
      : ['<span class="c">Permission denied.</span> Bu garajın anahtarı sadece Emre’de.']
  }
};
