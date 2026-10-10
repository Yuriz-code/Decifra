'use strict';
/* Testes do servidor (Node 18+, sem dependências além do `ws`). Rodam com:  npm test */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, get, connect, join, sleep } = require('./helpers');

const uid = () => Math.random().toString(36).slice(2, 7);
const room = () => 'decifra-' + uid();

describe('HTTP e arquivos do app (PWA)', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.stop());

  test('/health responde ok', async () => {
    const r = await get(srv.base, '/health');
    assert.equal(r.status, 200); assert.equal(r.body.toString(), 'ok');
  });

  test('/stats traz só contadores', async () => {
    const r = await get(srv.base, '/stats');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    for (const k of ['uptime_s', 'rooms', 'conns', 'joins', 'resumes', 'dropped', 'floods', 'blocked', 'msgs', 'full']) assert.equal(typeof j[k], 'number', k);
  });

  test('/ serve o jogo e aponta o WebSocket para o próprio servidor', async () => {
    const r = await get(srv.base, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    const html = r.body.toString();
    assert.match(html, /<title>Decifra/);
    assert.match(html, /window\.DECIFRA_WS=\(location\.protocol==='https:'\?'wss:\/\/':'ws:\/\/'\)\+location\.host;/);
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  });

  test('caminhos desconhecidos e tentativa de sair da pasta dão 404', async () => {
    for (const p of ['/nada', '/server.js', '/package.json', '/icons/..%2Fserver.js', '/icons/%2e%2e/server.js', '/icons/a.PNG', '/icons/sub/a.png', '/tools/palavras.js']) {
      const r = await get(srv.base, p);
      assert.equal(r.status, 404, p);
    }
  });

  test('manifesto é válido e todos os ícones declarados existem com o tamanho certo', async () => {
    const r = await get(srv.base, '/manifest.webmanifest');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/manifest\+json/);
    const m = JSON.parse(r.body);
    assert.equal(m.display, 'standalone'); assert.equal(m.lang, 'pt-BR');
    assert.ok(m.name && m.short_name && m.start_url && m.background_color && m.theme_color);
    assert.ok(m.icons.some(i => i.sizes === '192x192'), 'falta ícone 192');
    assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'), 'falta ícone 512');
    assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'falta ícone maskable');
    for (const ic of m.icons) {
      const img = await get(srv.base, '/' + ic.src);
      assert.equal(img.status, 200, ic.src);
      assert.equal(img.headers['content-type'], 'image/png');
      assert.equal(img.body.subarray(1, 4).toString(), 'PNG');
      const [w, h] = [img.body.readUInt32BE(16), img.body.readUInt32BE(20)];
      assert.equal(`${w}x${h}`, ic.sizes, ic.src);
    }
    const apple = await get(srv.base, '/icons/apple-touch-icon.png');
    assert.equal(apple.status, 200);
  });

  test('service worker: JS, escopo raiz e sem cache longo', async () => {
    const r = await get(srv.base, '/sw.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /javascript/);
    assert.equal(r.headers['service-worker-allowed'], '/');
    assert.match(r.headers['cache-control'], /no-cache/);
    assert.match(r.body.toString(), /addEventListener\('fetch'/);
  });
});

describe('salas e protocolo', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.stop());

  test('o primeiro a entrar vira anfitrião', async () => {
    const r = room(), a = await join(srv.port, r);
    assert.equal(a.hostId, a.id); assert.equal(a.resumed, false);
    const p = await a.waitFor(m => m.t === 'peers');
    assert.equal(p.list.length, 1);
    a.close();
  });

  test('o segundo entra sem tirar o anfitrião; os dois se enxergam', async () => {
    const r = room(), a = await join(srv.port, r), b = await join(srv.port, r);
    assert.equal(b.hostId, a.id);
    for (const c of [a, b]) {
      const p = await c.waitFor(m => m.t === 'peers' && m.list.length === 2);
      assert.deepEqual(p.list.map(x => x.id).sort(), [a.id, b.id].sort());
    }
    a.close(); b.close();
  });

  test('nome de sala inválido recebe "full" e é desconectado', async () => {
    for (const bad of ['sala', 'decifra-', 'decifra-abc def', 'decifra-123456789', '../etc/passwd', '']) {
      const c = await connect(srv.port).opened;
      c.send({ t: 'join', room: bad });
      await c.waitFor(m => m.t === 'full');
      await c.closed;
    }
  });

  test('só o anfitrião emite state/secret/msg/fx; jogador não consegue forjar', async () => {
    const r = room(), host = await join(srv.port, r), guest = await join(srv.port, r);
    for (const topic of ['state', 'secret', 'msg', 'fx']) {
      guest.send({ t: 'ev', topic, data: { forjado: true } });
      host.send({ t: 'ev', topic, data: { ok: 1 } });
      const m = await guest.waitFor(x => x.t === 'ev' && x.topic === topic);
      assert.equal(m.by, host.id); assert.deepEqual(m.data, { ok: 1 });
    }
    await host.expectNone(m => m.t === 'ev' && m.topic !== 'act');
    host.close(); guest.close();
  });

  test('"act" funciona para qualquer jogador e tópicos desconhecidos são ignorados', async () => {
    const r = room(), host = await join(srv.port, r), guest = await join(srv.port, r);
    guest.send({ t: 'ev', topic: 'act', data: { a: 1 } });
    const m = await host.waitFor(x => x.t === 'ev' && x.topic === 'act');
    assert.equal(m.by, guest.id);
    const from = guest.mark();
    host.send({ t: 'ev', topic: 'xyz', data: 1 });
    await guest.expectNone(x => x.t === 'ev', { from });
    host.close(); guest.close();
  });

  test('presença: campos limitados e inválidos rejeitados', async () => {
    const r = room(), a = await join(srv.port, r), b = await join(srv.port, r);
    a.send({ t: 'pr', p: { pid: 'p1', nm: 'x'.repeat(100), evil: '<script>' } });
    const p = await b.waitFor(m => m.t === 'peers' && m.list.some(x => x.id === a.id && x.presence.pid === 'p1'));
    const pres = p.list.find(x => x.id === a.id).presence;
    assert.equal(pres.nm.length, 40); assert.equal('evil' in pres, false);
    const from = b.mark();
    a.send({ t: 'pr', p: { pid: 'y'.repeat(65) } });
    await b.expectNone(m => m.t === 'peers', { from });
    a.close(); b.close();
  });

  test('reconectar com "resume" devolve o mesmo lugar', async () => {
    const r = room(), a = await join(srv.port, r), b = await join(srv.port, r);
    const id = b.id;
    b.ws.terminate();                                           // queda de rede
    await a.waitFor(m => m.t === 'peers' && m.list.length === 1);
    const b2 = await join(srv.port, r, { resume: id });
    assert.equal(b2.id, id); assert.equal(b2.resumed, true);
    await a.waitFor(m => m.t === 'peers' && m.list.length === 2 && m.list.some(x => x.id === id));
    a.close(); b2.close();
  });

  test('anfitrião que sai ("bye") passa a vez para quem tem o menor pid', async () => {
    const r = room(), a = await join(srv.port, r, { pid: 'a1' }), b = await join(srv.port, r, { pid: 'b1' });
    assert.equal(a.hostId, a.id);
    const from = b.mark();
    a.send({ t: 'bye' });
    const h = await b.waitFor(m => m.t === 'host', { from });
    assert.equal(h.id, b.id);
    // o novo anfitrião passa a poder emitir estado
    const c = await join(srv.port, r, { pid: 'c1' });
    b.send({ t: 'ev', topic: 'state', data: { n: 1 } });
    await c.waitFor(m => m.t === 'ev' && m.topic === 'state');
    b.close(); c.close();
  });

  test('ping de aplicação (pg) é respondido', async () => {
    const r = room(), a = await join(srv.port, r);
    a.send({ t: 'pg' });
    await a.waitFor(m => m.t === 'pg');
    a.close();
  });

  test('origem de outro site é bloqueada; a do próprio servidor passa', async () => {
    await assert.rejects(connect(srv.port, { origin: 'https://site-malvado.example' }).opened, e => e.status === 403);
    const ok = await connect(srv.port, { origin: `http://127.0.0.1:${srv.port}` }).opened;
    ok.close();
    const stats = JSON.parse((await get(srv.base, '/stats')).body);
    assert.ok(stats.blocked >= 1);
  });

  test('mensagem acima de 16 KB derruba a conexão', async () => {
    const c = await join(srv.port, room());
    c.send('x'.repeat(20 * 1024));
    const code = await c.closed;
    assert.equal(code, 1009);
  });

  test('antiflood expulsa quem manda mensagens demais', async () => {
    const c = await join(srv.port, room());
    for (let i = 0; i < 400; i++) { try { c.send({ t: 'pg' }); } catch (e) { break; } }
    await Promise.race([c.closed, sleep(4000).then(() => { throw new Error('não foi expulso'); })]);
    assert.ok((JSON.parse((await get(srv.base, '/stats')).body)).floods > 0);
  });
});

describe('limites', () => {
  test('sala cheia: 16 entram e o 17º recebe "full"', async () => {
    const srv = await startServer({ MAX_CONNS_IP: '40' });
    try {
      const r = room(), cs = [];
      for (let i = 0; i < 16; i++) cs.push(await join(srv.port, r));
      const extra = await connect(srv.port).opened;
      extra.send({ t: 'join', room: r });
      await extra.waitFor(m => m.t === 'full');
      await extra.closed;
      cs.forEach(c => c.close());
    } finally { await srv.stop(); }
  });

  test('limite de conexões por IP', async () => {
    const srv = await startServer({ MAX_CONNS_IP: '3' });
    try {
      const cs = [];
      for (let i = 0; i < 3; i++) cs.push(await connect(srv.port).opened);
      await assert.rejects(connect(srv.port).opened, e => e.status === 429);
      cs.forEach(c => c.close());
    } finally { await srv.stop(); }
  });
});
