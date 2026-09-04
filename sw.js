const CACHE_NAME = 'conociendo-al-novio-v27';
const PUSH_REGISTER_URL = 'https://mgcwbggaowehwhjizkog.supabase.co/functions/v1/register-push';
const SUPABASE_ANON_KEY = 'sb_publishable_2m5crUGV89npNXP-WFJATQ_s1ke26Cp';
const VAPID_PUBLIC_KEY = 'BNbS-edRZ7q3eBkTFoa4BzxgKpG16hEuJVe1qJq4WldgsVZ1RlOcILkaOLYoVwZb1F0piAj96AVNk3mdqqPn91I';
const APP_SHELL = ['./', './index.html', './styles.css?v=27', './app.js?v=27', './manifest.json', './assets/amigas-del-novio-black-transparent-v4.png', './assets/amigas-del-novio-background-v1.png', './assets/amigas-del-novio-hero-v2.png', './assets/amigas-del-novio-hero-wide-v3.png', './assets/icon-192-v6.png', './assets/icon-512-v6.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Áudios e chamadas do Supabase permanecem network-first para conteúdo atualizado.
  if (url.hostname.endsWith('.supabase.co') || event.request.destination === 'audio') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) { payload = { body: event.data?.text() }; }
  const title = payload.title || 'Conociendo al Novio';
  const options = {
    body: payload.body || 'Hay un nuevo audio disponible.',
    icon: './assets/icon-192-v6.png',
    badge: './assets/icon-192-v6.png',
    tag: payload.tag || 'nuevo-audio',
    renotify: true,
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = subscription.toJSON();
    await fetch(PUSH_REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ action: 'register', subscription: { endpoint: json.endpoint, keys: json.keys }, language: 'es' })
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) await client.navigate(destination);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(destination) : undefined;
    })
  );
});
