// Cache do app para abrir rápido e offline. Dados vêm do Firestore (que tem o próprio cache).
const VERSAO = 'guardei-v1';
const ARQUIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/cloud.js', 'js/config.js', 'js/gemini.js', 'js/icons.js', 'js/link.js', 'js/pipeline.js', 'js/search.js', 'js/ui.js',
  'vendor/firebase/firebase-app.js', 'vendor/firebase/firebase-auth.js', 'vendor/firebase/firebase-firestore.js',
  'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Página (inclusive ?share_url=...) sempre tenta a rede primeiro.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
    if (resp.ok) {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(e.request, copia));
    }
    return resp;
  })));
});
