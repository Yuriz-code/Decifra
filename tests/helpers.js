'use strict';
/* Utilitários dos testes: sobe o servidor numa porta livre e oferece um cliente WebSocket que guarda as mensagens. */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

/* Sobe `node server.js` numa porta livre e espera o log "start". */
async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), RENDER: '', RENDER_EXTERNAL_URL: '', SELF_URL: '', TRUST_PROXY: '', ALLOWED_ORIGINS: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  let buf = '';
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { logs.push(JSON.parse(l)); } catch (e) { logs.push({ raw: l }); } } });
  child.stderr.on('data', d => logs.push({ ev: 'stderr', raw: String(d) }));
  const t0 = Date.now();
  while (!logs.some(l => l.ev === 'start')) {
    if (child.exitCode !== null) throw new Error('servidor encerrou ao iniciar: ' + JSON.stringify(logs));
    if (Date.now() - t0 > 8000) { child.kill(); throw new Error('servidor não iniciou em 8 s'); }
    await sleep(25);
  }
  return {
    port, logs, base: `http://127.0.0.1:${port}`,
    async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 4000).unref(); }); }
  };
}

/* GET simples que devolve {status, headers, body(Buffer)} sem normalizar o caminho. */
function get(base, p) {
  return new Promise((res, rej) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: p }, r => {
      const chunks = []; r.on('data', c => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', rej);
  });
}

/* Cliente WebSocket: guarda tudo o que chega em `msgs`. */
function connect(port, { origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
  const msgs = [];
  const c = {
    ws, msgs,
    closed: new Promise(r => ws.on('close', (code) => r(code))),
    opened: new Promise((res, rej) => {
      ws.on('open', () => res(c));
      ws.on('error', rej);
      ws.on('unexpected-response', (_req, r) => rej(Object.assign(new Error('HTTP ' + r.statusCode), { status: r.statusCode })));
    }),
    send(o) { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); },
    mark() { return msgs.length; },
    async waitFor(pred, { from = 0, ms = 3000 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const m = msgs.slice(from).find(pred);
        if (m) return m;
        if (Date.now() - t0 > ms) throw new Error('mensagem esperada não chegou: ' + pred + '\nrecebidas: ' + JSON.stringify(msgs.slice(from)));
        await sleep(15);
      }
    },
    async expectNone(pred, { from = 0, ms = 350 } = {}) {
      await sleep(ms);
      const m = msgs.slice(from).find(pred);
      if (m) throw new Error('chegou uma mensagem que não deveria: ' + JSON.stringify(m));
    },
    close() { try { ws.close(); } catch (e) {} }
  };
  ws.on('message', raw => { try { msgs.push(JSON.parse(raw)); } catch (e) {} });
  c.opened.catch(() => {});
  return c;
}

/* Conecta e entra numa sala; devolve o cliente já com {id, hostId}. */
async function join(port, room, { resume, pid, nm } = {}) {
  const c = await connect(port).opened;
  c.send({ t: 'join', room, resume });
  const j = await c.waitFor(m => m.t === 'joined');
  c.id = j.id; c.hostId = j.hostId; c.resumed = j.resumed;
  if (pid || nm) { c.send({ t: 'pr', p: { pid, nm } }); await c.waitFor(m => m.t === 'peers' && m.list.some(p => p.id === c.id && p.presence && p.presence.pid === pid)); }
  return c;
}

module.exports = { ROOT, sleep, startServer, get, connect, join };
