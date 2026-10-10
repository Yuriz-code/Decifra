'use strict';
/* Servidor de salas do Decifra: serve o jogo + retransmite mensagens por WebSocket.
   Todos se conectam a ESTE servidor (443/80), então funciona em qualquer rede. */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

/* ---------- configuração (variáveis de ambiente opcionais) ---------- */
const PORT = +process.env.PORT || 3000;
const GRACE_MS = 25000;                 // tempo para reconectar mantendo o lugar
const MAX_PEERS = 16;                   // por sala
const MAX_ROOMS = 500;
const MAX_CONNS = 600;                  // total de conexões
const MAX_CONNS_IP = +process.env.MAX_CONNS_IP || 12;
const JOINS_PER_MIN_IP = 40;
const ROOM_IDLE_MS = 3 * 3600e3;        // sala sem nenhuma mensagem por 3h é encerrada
const MAX_PAYLOAD = 16 * 1024;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // ex.: meusite.com,outro.app
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY !== '0' : !!process.env.RENDER;
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || '';
const ROOM_RE = /^decifra-[a-z0-9]{3,8}(-g\d{1,3})?$/i;
const TOPICS = new Set(['act', 'fx', 'state', 'secret', 'msg']);
const HOST_ONLY = new Set(['state', 'secret', 'msg', 'fx']);   // só o anfitrião pode emitir (impede forjar estado)
const INDEX = path.join(__dirname, 'public', 'index.html');

/* ---------- log estruturado + métricas ---------- */
const T0 = Date.now();
const stats = { joins: 0, resumes: 0, dropped: 0, floods: 0, blocked: 0, msgs: 0, full: 0 };
const log = (ev, o) => console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), ev }, o || {})));
process.on('uncaughtException', e => log('uncaught', { err: String(e && e.stack || e) }));
process.on('unhandledRejection', e => log('unhandled', { err: String(e) }));

/* ---------- HTTP ---------- */
let htmlCache = null, htmlMtime = 0;
function page() {
  const st = fs.statSync(INDEX);
  if (!htmlCache || st.mtimeMs !== htmlMtime) {
    htmlMtime = st.mtimeMs;
    htmlCache = fs.readFileSync(INDEX, 'utf8').replace(/window\.DECIFRA_WS\s*=\s*(['"])\1\s*;/,
      "window.DECIFRA_WS=(location.protocol==='https:'?'wss://':'ws://')+location.host;");
  }
  return htmlCache;
}
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN'
};
/* arquivos do app instalável (PWA): lista fechada, sem navegar em pastas */
const PUB = path.join(__dirname, 'public');
const STATIC = {
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8', 'no-cache', { 'Service-Worker-Allowed': '/' }]
};
const ICON_RE = /^\/icons\/[a-z0-9-]+\.png$/;
function sendStatic(res, file, type, cache, extra) {
  fs.readFile(path.join(PUB, file), (err, buf) => {
    if (err) { res.writeHead(404, SEC); return res.end('not found'); }
    res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': buf.length }, SEC, extra || {}));
    res.end(buf);
  });
}
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const st = STATIC[url];
  if (st) return sendStatic(res, st[0], st[1], st[2], st[3]);
  if (ICON_RE.test(url)) return sendStatic(res, url.slice(1), 'image/png', 'public, max-age=86400');
  if (url === '/health' || url === '/alive') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, SEC));
    return res.end('ok');
  }
  if (url === '/stats') {   // só contadores, nada de dados dos jogadores
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SEC));
    return res.end(JSON.stringify({ uptime_s: Math.round((Date.now() - T0) / 1000), rooms: rooms.size, conns: wss.clients.size, ...stats }));
  }
  if (url === '/' || url === '/index.html') {
    try {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, SEC));
      return res.end(page());
    } catch (e) { res.writeHead(500); return res.end('index.html não encontrado em /public'); }
  }
  res.writeHead(404, SEC); res.end('not found');
});
server.headersTimeout = 20000; server.requestTimeout = 30000;

/* ---------- salas ---------- */
const rooms = new Map(); // nome -> { peers: Map(id -> peer), hostId, act }
const newId = () => crypto.randomBytes(5).toString('hex');
const send = (ws, o) => { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} } };
const live = r => [...r.peers.values()].filter(p => p.ws);

function broadcast(r, o, exceptId) {
  const s = JSON.stringify(o);
  live(r).forEach(p => { if (p.id !== exceptId && p.ws.readyState === 1) { try { p.ws.send(s); } catch (e) {} } });
}
const sendPeers = r => broadcast(r, { t: 'peers', list: live(r).map(p => ({ id: p.id, presence: p.presence })) });

/* anfitrião = jogador conectado de menor "pid" (mesma regra do jogo); empate -> mais antigo */
function pickHost(r) {
  const c = live(r).sort((a, b) => {
    const x = a.presence && a.presence.pid, y = b.presence && b.presence.pid;
    if (x && y && x !== y) return x < y ? -1 : 1;
    return a.seq - b.seq;
  });
  return c.length ? c[0].id : null;
}
function reassignHost(name, r) {
  const h = pickHost(r);
  if (h && h !== r.hostId) { r.hostId = h; log('host', { room: name, peers: live(r).length }); broadcast(r, { t: 'host', id: h }); }
  else if (!h) r.hostId = null;
}
function dropPeer(name, r, p) {
  clearTimeout(p.timer);
  if (!r.peers.delete(p.id)) return;
  stats.dropped++;
  if (!r.peers.size) { rooms.delete(name); log('room_closed', { room: name, rooms: rooms.size }); return; }
  if (r.hostId === p.id) reassignHost(name, r);
  sendPeers(r);
}
function detach(name, r, p, ws) {
  if (p.ws !== ws) return;
  p.ws = null; sendPeers(r);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { if (!p.ws) dropPeer(name, r, p); }, GRACE_MS);
}

/* valida presença: só campos conhecidos, tipos e tamanhos limitados */
function cleanPresence(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = {};
  if ('pid' in p) { if (typeof p.pid !== 'string' || p.pid.length > 64) return null; o.pid = p.pid; }
  if ('nm' in p) { if (typeof p.nm !== 'string') return null; o.nm = p.nm.slice(0, 40); }
  if ('av' in p) { if (typeof p.av !== 'string' && typeof p.av !== 'number') return null; o.av = typeof p.av === 'string' ? p.av.slice(0, 16) : p.av; }
  if ('h' in p) { o.h = p.h === 1 ? 1 : 0; }
  return o;
}

/* ---------- limites por IP ---------- */
const ipConns = new Map(), ipJoins = new Map();
const clientIp = req => {
  if (TRUST_PROXY) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); }
  return req.socket.remoteAddress || '?';
};
setInterval(() => { const n = Date.now(); ipJoins.forEach((v, k) => { if (n - v.t > 60000) ipJoins.delete(k); }); }, 60000).unref();

/* ---------- WebSocket ---------- */
let seq = 0;
const originOk = req => {
  const o = req.headers.origin;
  if (!o) return true;                       // clientes que não são navegador
  let h; try { h = new URL(o).host; } catch (e) { return false; }
  if (h === req.headers.host) return true;
  if (SELF_URL) { try { if (new URL(SELF_URL).host === h) return true; } catch (e) {} }
  return ALLOWED.some(a => a === h || a === o);
};
const wss = new WebSocketServer({
  server, maxPayload: MAX_PAYLOAD, perMessageDeflate: false,
  verifyClient: ({ req }, cb) => {
    const ip = clientIp(req);
    if (!originOk(req)) { stats.blocked++; log('blocked_origin', { origin: req.headers.origin }); return cb(false, 403, 'origin'); }
    if (wss.clients.size >= MAX_CONNS || (ipConns.get(ip) || 0) >= MAX_CONNS_IP) { stats.blocked++; return cb(false, 429, 'limit'); }
    cb(true);
  }
});

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  let room = null, name = null, me = null, alive = true, last = Date.now();
  let tokens = 40, tAt = Date.now(), strikes = 0, kicked = false;
  ws.on('pong', () => { alive = true; });

  ws.on('message', (raw, isBinary) => {
    if (kicked) return;
    last = Date.now(); alive = true;
    if (isBinary) return;
    const n = Date.now(); tokens = Math.min(40, tokens + (n - tAt) / 1000 * 20); tAt = n;   // 20 msg/s, rajada de 40
    if (--tokens < 0) { stats.floods++; if (++strikes > 50) { kicked = true; log('flood_kick', { ip }); ws.terminate(); } return; }
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    stats.msgs++;

    if (m.t === 'join') {
      if (me) return;
      const j = ipJoins.get(ip) || { c: 0, t: n };
      if (n - j.t > 60000) { j.c = 0; j.t = n; }
      if (++j.c > JOINS_PER_MIN_IP) { stats.blocked++; ipJoins.set(ip, j); return ws.close(); }
      ipJoins.set(ip, j);
      const rn = String(m.room || '').toLowerCase();
      if (!ROOM_RE.test(rn)) { send(ws, { t: 'full' }); return ws.close(); }
      let r = rooms.get(rn);
      if (!r) {
        if (rooms.size >= MAX_ROOMS) { stats.full++; send(ws, { t: 'full' }); return ws.close(); }
        r = { peers: new Map(), hostId: null, act: Date.now() }; rooms.set(rn, r);
        log('room_open', { room: rn, rooms: rooms.size });
      }
      let p = m.resume && r.peers.get(String(m.resume)), resumed = false;
      if (p) {
        resumed = true; stats.resumes++; clearTimeout(p.timer);
        if (p.ws && p.ws !== ws) { const old = p.ws; p.ws = null; try { old.close(); } catch (e) {} }
        p.ws = ws;
      } else {
        if (r.peers.size >= MAX_PEERS) { stats.full++; send(ws, { t: 'full' }); return ws.close(); }
        p = { id: newId(), ws, presence: {}, seq: ++seq, timer: null };
        r.peers.set(p.id, p); stats.joins++;
      }
      room = r; name = rn; me = p; r.act = Date.now();
      if (!r.hostId || !r.peers.has(r.hostId)) r.hostId = p.id;
      send(ws, { t: 'joined', id: p.id, hostId: r.hostId, resumed });
      sendPeers(r);
      return;
    }
    if (!me || !room) return;
    if (m.t === 'pg') return send(ws, { t: 'pg' });
    if (m.t === 'pr') {
      const c = cleanPresence(m.p);
      if (c) { me.presence = Object.assign({}, me.presence, c); sendPeers(room); }
      return;
    }
    if (m.t === 'ev') {
      if (typeof m.topic !== 'string' || !TOPICS.has(m.topic)) return;
      if (HOST_ONLY.has(m.topic) && room.hostId !== me.id) return;
      room.act = Date.now();
      broadcast(room, { t: 'ev', topic: m.topic, data: m.data, by: me.id }, me.id);
      return;
    }
    if (m.t === 'bye') { const r = room, nm = name, p = me; me = null; room = null; dropPeer(nm, r, p); try { ws.close(); } catch (e) {} }
  });

  ws.on('close', () => {
    const c = (ipConns.get(ip) || 1) - 1; if (c <= 0) ipConns.delete(ip); else ipConns.set(ip, c);
    if (me && room) detach(name, room, me, ws);
  });
  ws.on('error', () => {});
  ws._chk = () => {
    if (!alive || Date.now() - last > 70000) return ws.terminate();
    alive = false; try { ws.ping(); } catch (e) {}
  };
});

/* batimento + varredura de salas inativas */
setInterval(() => wss.clients.forEach(ws => ws._chk && ws._chk()), 25000).unref();
setInterval(() => {
  const n = Date.now();
  rooms.forEach((r, nm) => {
    if (n - r.act > ROOM_IDLE_MS) {
      log('room_idle_closed', { room: nm });
      r.peers.forEach(p => { clearTimeout(p.timer); if (p.ws) { send(p.ws, { t: 'full' }); try { p.ws.close(); } catch (e) {} } });
      rooms.delete(nm);
    }
  });
}, 5 * 60000).unref();

/* keep-alive: enquanto houver salas, o servidor chama a si mesmo (evita dormir no Render free) */
if (SELF_URL) {
  const lib = SELF_URL.startsWith('https') ? https : http;
  setInterval(() => {
    if (!rooms.size) return;
    lib.get(SELF_URL.replace(/\/$/, '') + '/health', r => r.resume()).on('error', () => {});
  }, 9 * 60000).unref();
}

/* desligamento limpo */
function shutdown() {
  log('shutdown', { rooms: rooms.size });
  wss.clients.forEach(ws => { try { ws.close(1012, 'restart'); } catch (e) {} });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

server.listen(PORT, () => log('start', { port: PORT, trustProxy: TRUST_PROXY, selfPing: !!SELF_URL, allowedOrigins: ALLOWED }));
