// Cache do app para abrir offline. Com internet, sempre busca a versão nova (rede primeiro).
const VERSAO = 'guardei-v12';
const ARQUIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/cloud.js', 'js/config.js', 'js/gemini.js', 'js/icons.js', 'js/link.js', 'js/mapa.js', 'js/pipeline.js', 'js/qr.js', 'js/search.js', 'js/semantica.js', 'js/ui.js',
  'vendor/firebase/firebase-app.js', 'vendor/firebase/firebase-auth.js', 'vendor/firebase/firebase-firestore.js', 'vendor/qrcode.mjs',
  'vendor/three.module.min.js', 'vendor/three.core.min.js', 'vendor/OrbitControls.js',
  'icons/icon.svg', 'icons/marca.svg', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita guardar arquivos velhos do cache HTTP do navegador.
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((resp) => {
    if (resp.ok && e.request.mode !== 'navigate') {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(e.request, copia));
    }
    return resp;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) || caches.match('index.html')));
});
