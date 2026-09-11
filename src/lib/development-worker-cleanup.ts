// Executado no HTML antes da hidratação: um chunk antigo pode impedir que
// qualquer useEffect rode. Exclusivo de next dev e do worker /sw.js do ERP.
export const developmentWorkerCleanup = `
(async function () {
  if (!('serviceWorker' in navigator)) return;
  try {
    var registrations = await navigator.serviceWorker.getRegistrations();
    var removed = false;
    for (var registration of registrations) {
      var worker = registration.active || registration.waiting || registration.installing;
      if (!worker) continue;
      var url = new URL(worker.scriptURL);
      if (url.origin !== location.origin || url.pathname !== '/sw.js') continue;
      removed = (await registration.unregister()) || removed;
    }
    if (!removed) return;
    if ('caches' in window) {
      for (var name of await caches.keys()) {
        var cache = await caches.open(name);
        for (var request of await cache.keys()) {
          var cachedUrl = new URL(request.url);
          if (cachedUrl.origin === location.origin) await cache.delete(request);
        }
      }
    }
    // Uma única recarga após remover o registro. Na próxima visita não existe
    // registro para remover, portanto não há loop de recarga.
    if (navigator.serviceWorker.controller) location.reload();
  } catch (error) {
    console.warn('[development] Falha ao limpar service worker antigo', error);
  }
})();
`;
