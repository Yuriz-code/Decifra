'use strict';
/* Testes estáticos do jogo (index.html): banco de palavras, sintaxe e recursos do app. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/* Executa só o trecho do banco (de "const CATS = [" até o CATS.forEach que monta c.words) e monta as palavras
   do mesmo jeito que o jogo faz. Tolera o código formatado ou compacto. */
function loadBank() {
  const a = html.search(/const CATS\s*=\s*\[/);
  const m = html.match(/CATS\.forEach\(\s*\(?c\)?\s*=>\s*\{\s*c\.w\s*=\s*c\.w\.concat\(/);
  assert.ok(a > 0 && m && m.index > a, 'trecho do banco não encontrado');
  const mount = ';CATS.forEach(c=>{c.w=c.w.concat((typeof EXTRA!=="undefined"&&EXTRA[c.id])||[]);' +
    'c.words=c.w.map(l=>{const p=l.split("|");return{t:p[0],d:+p[1],c:p.slice(2)}})});return CATS;';
  return new Function(html.slice(a, m.index) + mount)();
}

describe('banco de palavras', () => {
  const cats = loadBank();
  const words = cats.flatMap(c => c.words.map(w => ({ ...w, cat: c.id })));

  test('tem pelo menos 600 palavras e as categorias de cultura brasileira', () => {
    assert.ok(words.length >= 600, `só ${words.length} palavras`);
    for (const id of ['novelas', 'musica', 'regionais', 'futebol', 'marcas', 'redes', 'folclore'])
      assert.ok(cats.some(c => c.id === id && c.words.length >= 40), `categoria ${id} faltando ou pequena`);
  });

  test('ids de categoria únicos, com nome e emoji', () => {
    assert.equal(new Set(cats.map(c => c.id)).size, cats.length);
    cats.forEach(c => { assert.ok(c.n && c.e, c.id); });
  });

  test('cada palavra tem dificuldade 1–3 e exatamente 3 pistas não vazias', () => {
    for (const w of words) {
      assert.ok([1, 2, 3].includes(w.d), `${w.t}: dificuldade ${w.d}`);
      assert.equal(w.c.length, 3, `${w.t}: ${w.c.length} pistas`);
      w.c.forEach(p => assert.ok(p.trim().length > 0 && p.length <= 60, `${w.t}: pista inválida "${p}"`));
    }
  });

  // Palavras antigas cujas pistas repetem um pedaço do nome sem entregar a resposta; mantidas como estavam.
  const PARTE_OK = new Set(['CENTRAL DO BRASIL', 'CAÇA-PALAVRAS', 'SALTO COM VARA']);
  test('nenhuma pista entrega a resposta', () => {
    for (const w of words) {
      const key = norm(w.t), parts = w.t.split(/[\s-]+/).map(norm).filter(x => x.length >= 4);
      w.c.forEach(p => {
        const n = norm(p);
        assert.ok(!n.includes(key), `${w.t}: a pista "${p}" contém a resposta`);
        if (!PARTE_OK.has(w.t)) parts.forEach(x => assert.ok(!n.includes(x), `${w.t}: a pista "${p}" contém "${x}"`));
      });
    }
  });

  test('sem palavras repetidas (ignorando acentos)', () => {
    const seen = new Map(), dups = [];
    for (const w of words) { const k = norm(w.t); if (seen.has(k)) dups.push(`${w.t} / ${seen.get(k)}`); seen.set(k, w.t); }
    assert.deepEqual(dups, []);
  });

  test('cada categoria tem palavras fáceis, médias e difíceis (a dificuldade progressiva depende disso)', () => {
    for (const c of cats) for (const d of [1, 2, 3])
      assert.ok(c.words.some(w => w.d === d) || c.id === 'escritorio', `${c.id} sem palavras de nível ${d}`);
  });

  test('nenhuma palavra tem pedaço com mais de 14 letras (cabe nos blocos)', () => {
    words.forEach(w => w.t.split(/[\s-]+/).forEach(x => assert.ok([...norm(x)].length <= 14, w.t)));
  });

  test('o estado com todas as categorias continua pequeno (limite do servidor: 3700 caracteres)', () => {
    assert.ok(JSON.stringify(cats.map(c => c.id)).length < 400);
  });

  test('index.html está em dia com tools/palavras-brasil.txt', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'palavras.js'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});

describe('index.html', () => {
  test('todos os <script> inline têm sintaxe válida', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 3);
    scripts.forEach((s, i) => assert.doesNotThrow(() => new Function(s), `script ${i}`));
  });

  test('traz manifesto, ícones, theme-color e registro do service worker', () => {
    assert.match(html, /<link[^>]*rel="manifest"[^>]*href="manifest\.webmanifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /serviceWorker\.register\('sw\.js'\)/);
    assert.match(html, /viewport-fit=cover/);
  });

  test('fontes são do próprio servidor (nada de Google Fonts) e o PeerJS só é carregado sem servidor próprio', () => {
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.match(html, /@font-face[^}]*fonts\/fredoka-latin\.woff2/);
    assert.match(html, /@font-face[^}]*fonts\/nunito-latin\.woff2/);
    assert.doesNotMatch(html, /^\s*<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/peerjs/m, 'PeerJS não pode ter <script src> fixo');
    assert.match(html, /if \(!String\(window\.DECIFRA_WS \|\| ''\)\.trim\(\)\)\s*document\.write\(/);
  });

  test('o arquivo está formatado (npm run formatar)', () => {
    const r = spawnSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), '--check', path.join(ROOT, 'public', 'index.html')], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, 'rode "npm run formatar"\n' + r.stdout + r.stderr);
  });

  test('Wake Lock: pedido ligado ao laço do anfitrião e refeito ao voltar para a aba', () => {
    assert.match(html, /navigator\.wakeLock\.request\('screen'\)/);
    assert.match(html, /function stopLoop\(\)\s*\{[^}]*wakeSync\(\)/);
    assert.match(html, /visibilitychange/);
  });

  test('histórico de palavras vistas é gravado no localStorage a cada rodada', () => {
    assert.match(html, /SEEN_KEY\s*=\s*'decifra\.seen'/);
    assert.match(html, /seenAdd\(w\.t\)/);
  });
});
