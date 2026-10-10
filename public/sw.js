'use strict';
/* Service worker do Decifra: deixa o app instalável e acelera a abertura.
   O jogo NÃO funciona offline (precisa do servidor de salas), então:
   - a página (HTML) vem da rede; o cache só serve de reserva se a rede falhar, der erro 5xx ou demorar mais que
     NAV_TIMEOUT_MS (Render grátis leva até 1 min para acordar: a cópia abre na hora e o jogo mostra "Acordando o
     servidor…" enquanto conecta). A cópia é atualizada em segundo plano, então a versão nova aparece no acesso seguinte;
   - ícones, fontes e manifesto vêm do cache. Se mudar ícones ou fontes, aumente VERSION. */
const VERSION = 'decifra-v3';
const NAV_TIMEOUT_MS = 3000;   // servidor que não responde em 3 s é tratado como "dormindo"
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/fredoka-latin.woff2', 'fonts/nunito-latin.woff2'];

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
  if (req.mode === 'navigate') { e.respondWith(navegar(req)); return; }   // página: rede primeiro, cópia se demorar
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {   // ícones etc.: cache primeiro
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return r;
  })));
});

function navegar(req) {
  return new Promise(resolve => {
    let respondeu = false;
    const daCopia = () => caches.match('./');
    const entrega = r => { if (!respondeu) { respondeu = true; resolve(r); } };
    const timer = setTimeout(() => daCopia().then(hit => { if (hit) entrega(hit); }), NAV_TIMEOUT_MS);
    fetch(req).then(r => {
      clearTimeout(timer);
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put('./', cp)); }   // atualiza mesmo se a cópia já foi usada
      if (r.status >= 500) daCopia().then(hit => entrega(hit || r)); else entrega(r);
    }, () => {
      clearTimeout(timer);
      daCopia().then(hit => entrega(hit || Response.error()));
    });
  });
}
