'use strict';
/* Service worker do Decifra: deixa o app instalável e acelera a abertura.
   O jogo NÃO funciona offline (precisa do servidor de salas), então:
   - a página (HTML) vem sempre da rede; o cache só serve de reserva se a rede falhar;
   - ícones e manifesto vêm do cache. Se mudar os ícones, aumente VERSION. */
const VERSION = 'decifra-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // fontes, PeerJS etc. passam direto
  if (url.pathname === '/health' || url.pathname === '/stats') return;
  if (req.mode === 'navigate') {                                    // página: rede primeiro
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put('./', cp)); }
      return r;
    }).catch(() => caches.match('./').then(hit => hit || Response.error())));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {   // ícones etc.: cache primeiro
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return r;
  })));
});
