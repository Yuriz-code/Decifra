'use strict';
/* Valida tools/palavras-brasil.txt e injeta as categorias em public/index.html.
   Uso:  node tools/palavras.js          (valida e grava)
         node tools/palavras.js --check  (só valida; falha com código 1 se algo estiver errado) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const SRC = path.join(__dirname, 'palavras-brasil.txt');
const BEGIN = '/* BEGIN PALAVRAS-BRASIL (gerado por tools/palavras.js — não edite aqui) */';
const END = '/* END PALAVRAS-BRASIL */';
const ANCHOR = 'CATS.forEach(c=>{c.w=c.w.concat(';

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const checkOnly = process.argv.includes('--check');

/* ---------- lê o arquivo-fonte ---------- */
function parseSource(txt) {
  const cats = []; let cur = null; const erros = [];
  txt.split('\n').forEach((raw, i) => {
    const line = raw.trim(); const n = i + 1;
    if (!line || line.startsWith('#') && !line.startsWith('##')) return;
    if (line.startsWith('##')) {
      const p = line.slice(2).trim().split('|').map(s => s.trim());
      if (p.length !== 3 || !/^[a-z]+$/.test(p[0])) { erros.push(`linha ${n}: categoria inválida (use "## id|Nome|emoji")`); return; }
      cur = { id: p[0], n: p[1], e: p[2], w: [], line: n }; cats.push(cur); return;
    }
    if (!cur) { erros.push(`linha ${n}: palavra fora de categoria`); return; }
    cur.w.push({ raw: line, n });
  });
  return { cats, erros };
}

/* ---------- carrega o banco que já existe no jogo ---------- */
function loadExisting(html) {
  const a = html.indexOf('const CATS=[');
  if (a < 0) throw new Error('não achei "const CATS=[" em index.html');
  let b = html.indexOf(BEGIN); if (b < 0) b = html.indexOf(ANCHOR);
  if (b < 0) throw new Error('não achei o ponto de injeção em index.html');
  const code = html.slice(a, b) + ';return CATS;';
  return new Function(code)();
}

const html = fs.readFileSync(INDEX, 'utf8');
const existing = loadExisting(html);
const have = new Map(); // palavra normalizada -> categoria
(function indexExisting() {
  // as palavras originais vivem em c.w (CATS) e em EXTRA; o jogo junta os dois só depois, então relemos o texto
  const re = /"([A-ZÀ-Ý0-9'&\- ]+)\|[123]\|/g; let m;
  const a = html.indexOf('const CATS=['); let b = html.indexOf(BEGIN); if (b < 0) b = html.indexOf(ANCHOR);
  const trecho = html.slice(a, b);
  while ((m = re.exec(trecho))) have.set(norm(m[1]), 'banco original');
})();

const { cats, erros } = parseSource(fs.readFileSync(SRC, 'utf8'));
const ids = new Set(existing.map(c => c.id));
const saida = []; let total = 0;

cats.forEach(c => {
  if (ids.has(c.id)) erros.push(`categoria "${c.id}" já existe no jogo`);
  ids.add(c.id);
  const lista = [];
  c.w.forEach(({ raw, n }) => {
    const p = raw.split('|').map(s => s.trim());
    if (p.length !== 5) return erros.push(`linha ${n}: "${p[0]}" precisa ter exatamente 5 campos (palavra|dif|pista1|pista2|pista3)`);
    const [w, d, ...clues] = p;
    if (w !== w.toUpperCase()) erros.push(`linha ${n}: "${w}" deve estar em MAIÚSCULAS`);
    if (!['1', '2', '3'].includes(d)) erros.push(`linha ${n}: "${w}" dificuldade deve ser 1, 2 ou 3`);
    const key = norm(w);
    if (!key) erros.push(`linha ${n}: palavra vazia`);
    if (have.has(key)) erros.push(`linha ${n}: "${w}" repetida (já em ${have.get(key)})`);
    have.set(key, c.id);
    const pedacos = w.split(/[\s-]+/).filter(Boolean);
    if (pedacos.some(x => [...norm(x)].length > 14)) erros.push(`linha ${n}: "${w}" tem uma parte com mais de 14 letras (não cabe nos blocos)`);
    clues.forEach((cl, i) => {
      if (!cl) return erros.push(`linha ${n}: "${w}" pista ${i + 1} vazia`);
      if (cl.length > 56) erros.push(`linha ${n}: "${w}" pista ${i + 1} tem ${cl.length} caracteres (máx. 56)`);
      const nc = norm(cl);
      if (nc.includes(key)) erros.push(`linha ${n}: "${w}" pista ${i + 1} entrega a resposta`);
      pedacos.forEach(x => { const k = norm(x); if (k.length >= 4 && nc.includes(k)) erros.push(`linha ${n}: "${w}" pista ${i + 1} contém "${x}"`); });
    });
    if (new Set(clues.map(norm)).size < 3) erros.push(`linha ${n}: "${w}" tem pistas repetidas`);
    lista.push([w, d, ...clues].join('|'));
  });
  if (lista.length < 10) erros.push(`categoria "${c.id}" tem só ${lista.length} palavras (mínimo 10)`);
  total += lista.length;
  saida.push({ id: c.id, n: c.n, e: c.e, w: lista });
});

if (erros.length) {
  console.error(`✖ ${erros.length} problema(s) no banco de palavras:\n` + erros.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}

const bloco = BEGIN + '\n' + saida.map(c => `CATS.push(${JSON.stringify(c)});`).join('\n') + '\n' + END + '\n';
const a = html.indexOf(BEGIN), z = html.indexOf(END);
let novo;
if (a >= 0 && z >= 0) novo = html.slice(0, a) + bloco + html.slice(z + END.length).replace(/^\n/, '');
else { const k = html.indexOf(ANCHOR); novo = html.slice(0, k) + bloco + html.slice(k); }

const base = [...have.values()].filter(v => v === 'banco original').length;
console.log(`✔ ${saida.length} categorias novas, ${total} palavras novas (banco total: ${base + total}).`);
if (checkOnly) {
  if (novo !== html) { console.error('✖ index.html está desatualizado em relação a tools/palavras-brasil.txt — rode "npm run palavras".'); process.exit(1); }
} else if (novo !== html) { fs.writeFileSync(INDEX, novo); console.log('index.html atualizado.'); }
else console.log('index.html já estava em dia.');
