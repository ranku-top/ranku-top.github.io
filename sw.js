// Service worker de NETTOYAGE (le site n'est plus une application hors ligne).
// Il remplace l'ancien : à l'activation il vide tous les caches, se désinscrit et recharge les pages ouvertes.
// À garder en ligne quelques semaines (jusqu'à ce que tous les navigateurs l'aient récupéré), puis à supprimer.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* rien à vider */ }
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach((p) => p.navigate(p.url)); // recharge les pages ouvertes : elles repartent sans service worker
  })());
});
