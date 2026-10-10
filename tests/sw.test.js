'use strict';
/* Testa a lógica de navegação do service worker (public/sw.js) num ambiente simulado, sem navegador. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ESCALA = 50;   // os 3 s do service worker viram 60 ms nos testes

class FakeResponse {
  constructor(body, status = 200) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; }
  clone() { return new FakeResponse(this.body, this.status); }
  static error() { const r = new FakeResponse('', 0); r.erro = true; return r; }
}

function criarSW({ rede, copia }) {
  const handlers = {}, store = new Map(), puts = [];
  if (copia !== undefined) store.set('./', new FakeResponse(copia));
  const caches = {
    async open() { return { async put(k, v) { store.set(k, v); puts.push(k); }, async addAll() {} }; },
    async match(k) { return store.get(typeof k === 'string' ? k : k.url); },
    async keys() { return []; }, async delete() { return true; }
  };
  const self = { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  const ctx = vm.createContext({
    self, caches, Response: FakeResponse, URL, Promise,
    location: { origin: 'https://decifra.test' },
    fetch: rede,
    setTimeout: (fn, ms) => setTimeout(fn, ms / ESCALA),
    clearTimeout
  });
  vm.runInContext(SRC, ctx);
  const navegar = () => new Promise((resolve, reject) => {
    const req = { method: 'GET', url: 'https://decifra.test/?sala=ABC12', mode: 'navigate' };
    handlers.fetch({ request: req, respondWith: p => p.then(resolve, reject) });
  });
  return { navegar, store, puts };
}
const espera = ms => new Promise(r => setTimeout(r, ms));
const atrasada = (resp, ms) => () => new Promise(r => setTimeout(() => r(resp), ms / ESCALA));

describe('service worker: navegação', () => {
  test('servidor acordado: entrega a página nova e atualiza a cópia', async () => {
    const nova = new FakeResponse('NOVA');
    const sw = criarSW({ rede: async () => nova, copia: 'VELHA' });
    const r = await sw.navegar();
    assert.equal(r.body, 'NOVA');
    await espera(10);
    assert.equal(sw.store.get('./').body, 'NOVA');
  });

  test('servidor dormindo (não responde em 3 s): abre a cópia na hora e atualiza a cópia quando ele acordar', async () => {
    const t0 = Date.now();
    const sw = criarSW({ rede: atrasada(new FakeResponse('NOVA'), 20000), copia: 'VELHA' });
    const r = await sw.navegar();
    assert.equal(r.body, 'VELHA');
    assert.ok(Date.now() - t0 < 1000, 'não esperou os 20 s simulados do servidor');
    await espera(20000 / ESCALA + 100);                       // o servidor acorda
    assert.equal(sw.store.get('./').body, 'NOVA');            // próximo acesso já traz a versão nova
  });

  test('rede com falha: usa a cópia', async () => {
    const sw = criarSW({ rede: async () => { throw new TypeError('offline'); }, copia: 'VELHA' });
    assert.equal((await sw.navegar()).body, 'VELHA');
  });

  test('erro 5xx do proxy (Render acordando): usa a cópia e não a guarda no lugar da página', async () => {
    const sw = criarSW({ rede: async () => new FakeResponse('Service Unavailable', 503), copia: 'VELHA' });
    assert.equal((await sw.navegar()).body, 'VELHA');
    assert.equal(sw.store.get('./').body, 'VELHA');
  });

  test('primeira visita (sem cópia) e servidor lento: espera a rede, sem desistir aos 3 s', async () => {
    const sw = criarSW({ rede: atrasada(new FakeResponse('NOVA'), 10000) });
    assert.equal((await sw.navegar()).body, 'NOVA');
  });

  test('sem rede e sem cópia: erro de rede (o navegador mostra a página de offline)', async () => {
    const sw = criarSW({ rede: async () => { throw new TypeError('offline'); } });
    assert.equal((await sw.navegar()).erro, true);
  });

  test('erro 5xx sem cópia: entrega a própria resposta de erro', async () => {
    const sw = criarSW({ rede: async () => new FakeResponse('Bad Gateway', 502) });
    assert.equal((await sw.navegar()).status, 502);
  });
});

describe('manter-acordado (GitHub Actions)', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'manter-acordado.yml'), 'utf8');
  test('só roda com a variável RENDER_URL, a cada 10 min (menos que os 15 min do Render) e sem injetar a URL no shell', () => {
    assert.match(yml, /cron: '\*\/10 /);
    assert.match(yml, /if: \$\{\{ vars\.RENDER_URL != '' \}\}/);
    assert.match(yml, /env:\s*\n\s*RENDER_URL: \$\{\{ vars\.RENDER_URL \}\}/);
    assert.match(yml, /curl [^\n]*"\$RENDER_URL\/health"/);
    assert.doesNotMatch(yml, /run:[^\n]*\$\{\{/);
  });
});
