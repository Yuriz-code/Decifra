'use strict';
/* Teste de ponta a ponta: dois navegadores simulados criam e entram numa sala de verdade (via servidor WebSocket). */
const { test, expect } = require('@playwright/test');

/* Fontes e PeerJS (CDN) não são necessários: o servidor próprio cuida das salas. Bloquear deixa o teste rápido e estável. */
const hermetico = ctx => ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, r => r.abort());

/* Wake Lock de mentira (o headless não tem): conta pedidos e liberações. */
const wakeFalso = ctx => ctx.addInitScript(() => {
  window.__wake = { requests: 0, active: 0 };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        const l = new EventTarget(); let ativo = true;
        window.__wake.requests++; window.__wake.active++;
        l.release = async () => { if (!ativo) return; ativo = false; window.__wake.active--; l.dispatchEvent(new Event('release')); };
        return l;
      }
    }
  });
});

async function novoJogador(browser, { wake = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await hermetico(ctx);
  if (wake) await wakeFalso(ctx);
  return { ctx, page: await ctx.newPage() };
}

async function criarSala(page, nome) {
  await page.goto('/');
  await page.getByRole('button', { name: /Iniciar Partida/ }).click();
  await page.locator('#myname').fill(nome);
  await page.locator('[data-a="tab"][data-v="create"]').click();
  await page.locator('[data-a="create"]').click();
  await expect(page.locator('.codebox')).toBeVisible();
  const code = (await page.locator('.codebox .tile').allTextContents()).join('').trim();
  expect(code).toMatch(/^[A-Z0-9]{4,6}$/);
  return code;
}

async function entrarNaSala(page, code, nome) {
  await page.goto('/?sala=' + code);
  await expect(page.locator('#codein')).toHaveValue(code);          // o convite já preenche o código
  await page.locator('#myname').fill(nome);
  await page.locator('[data-a="join"]').click();
  await expect(page.locator('.codebox')).toBeVisible();
}

/* O anfitrião só inicia quando todos os convidados estão prontos (regra do jogo). */
async function ficarPronto(page, host) {
  await page.locator('[data-a="ready"]').click();
  await expect(host.locator('.board li', { hasText: 'Bia' })).toContainText('Pronto');
}

test('dois navegadores: criar sala, entrar e começar a partida', async ({ browser }) => {
  const a = await novoJogador(browser), b = await novoJogador(browser);
  try {
    const code = await criarSala(a.page, 'Ana');
    await entrarNaSala(b.page, code, 'Bia');

    for (const p of [a.page, b.page]) {
      await expect(p.locator('.board li')).toHaveCount(2);
      await expect(p.locator('.board')).toContainText('Ana');
      await expect(p.locator('.board')).toContainText('Bia');
    }
    await expect(a.page.locator('.board li', { hasText: 'Ana' })).toContainText('Anfitrião');
    await expect(b.page.locator('[data-a="start"]')).toHaveCount(0);     // só o anfitrião inicia

    await a.page.locator('[data-a="start"]').click();                    // convidado ainda não está pronto
    await expect(a.page.locator('.gtop')).not.toContainText('Rodada 1');

    await ficarPronto(b.page, a.page);
    await a.page.locator('[data-a="start"]').click();
    await expect(a.page.locator('.gtop')).toContainText('Rodada 1');
    await expect(b.page.locator('.gtop')).toContainText('Rodada 1');
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('Wake Lock: só o anfitrião segura a tela e solta ao sair da sala', async ({ browser }) => {
  const a = await novoJogador(browser, { wake: true }), b = await novoJogador(browser, { wake: true });
  try {
    const code = await criarSala(a.page, 'Ana');
    await entrarNaSala(b.page, code, 'Bia');
    await expect.poll(() => a.page.evaluate(() => window.__wake.active)).toBe(1);
    expect(await b.page.evaluate(() => window.__wake.requests)).toBe(0);
    await a.page.evaluate(() => leaveRoom(true));
    await expect.poll(() => a.page.evaluate(() => window.__wake.active)).toBe(0);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('Wake Lock: pedido é refeito quando a aba volta a ficar visível', async ({ browser }) => {
  const a = await novoJogador(browser, { wake: true });
  try {
    await criarSala(a.page, 'Ana');
    await expect.poll(() => a.page.evaluate(() => window.__wake.active)).toBe(1);
    // o navegador libera o bloqueio sozinho quando a aba some; simulamos isso e a volta à aba
    await a.page.evaluate(() => { WAKE.release(); });
    await expect.poll(() => a.page.evaluate(() => window.__wake.active)).toBe(0);
    await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => a.page.evaluate(() => window.__wake.active)).toBe(1);
  } finally { await a.ctx.close(); }
});

test('palavras vistas ficam no localStorage e não repetem entre partidas', async ({ browser }) => {
  const a = await novoJogador(browser), b = await novoJogador(browser);
  try {
    const code = await criarSala(a.page, 'Ana');
    await entrarNaSala(b.page, code, 'Bia');
    await ficarPronto(b.page, a.page);
    await a.page.locator('[data-a="start"]').click();
    await expect(a.page.locator('.gtop')).toContainText('Rodada 1');

    const primeira = await a.page.evaluate(() => S.secret.word);
    expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('decifra.seen')))).toContain(primeira);
    expect(await b.page.evaluate(() => localStorage.getItem('decifra.seen'))).toBeNull();   // convidado não grava

    // 100 partidas "novas" seguidas (S.used zerado a cada uma): nenhuma palavra pode se repetir
    const r = await a.page.evaluate(() => {
      const ws = [];
      for (let i = 0; i < 100; i++) { S.used = []; const w = pickWord(); ws.push(w.t); seenAdd(w.t); }
      return { total: ws.length, unicas: new Set(ws).size };
    });
    expect(r.unicas).toBe(r.total);

    await a.page.reload();                                           // sobrevive a recarregar a página
    expect((await a.page.evaluate(() => JSON.parse(localStorage.getItem('decifra.seen')))).length).toBeGreaterThanOrEqual(101);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('categoria pequena esgota e o ciclo recomeça sem travar', async ({ browser }) => {
  const a = await novoJogador(browser);
  try {
    await criarSala(a.page, 'Ana');
    const r = await a.page.evaluate(() => {
      S.cfg.cats = ['escritorio'];                                    // 15 palavras
      const ws = [];
      for (let i = 0; i < 60; i++) { S.used = []; const w = pickWord(); ws.push(w); seenAdd(w.t); }
      return { cats: [...new Set(ws.map(w => w.cat))], unicas: new Set(ws.map(w => w.t)).size };
    });
    expect(r.cats).toEqual(['escritorio']);
    expect(r.unicas).toBeGreaterThanOrEqual(13);                      // percorreu quase todo o banco antes de reciclar
  } finally { await a.ctx.close(); }
});

test('novas categorias aparecem nas configurações do anfitrião', async ({ browser }) => {
  const a = await novoJogador(browser);
  try {
    await criarSala(a.page, 'Ana');
    for (const nome of ['Novelas e TV', 'Música brasileira', 'Comidas regionais', 'Futebol brasileiro', 'Marcas e lojas', 'Redes sociais e internet', 'Festas e folclore'])
      await expect(a.page.locator('.chip', { hasText: nome })).toBeVisible();
  } finally { await a.ctx.close(); }
});

test('PWA: manifesto, service worker ativo e cartão de instalação', async ({ browser }) => {
  const a = await novoJogador(browser);
  try {
    await a.page.goto('/');
    const href = await a.page.locator('link[rel="manifest"]').getAttribute('href');
    const m = await a.page.evaluate(h => fetch(h).then(r => r.json()), href);
    expect(m.display).toBe('standalone');
    expect(await a.page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active))).toBe(true);
    await a.page.locator('[data-a="nav"][data-to="set"]').click();
    await expect(a.page.locator('.card', { hasText: 'Instalar como app' })).toBeVisible();
  } finally { await a.ctx.close(); }
});
