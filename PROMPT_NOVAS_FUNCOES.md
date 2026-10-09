# Prompt para pedir novas funções ao Claude

Cole o conteúdo abaixo no Claude, anexando `index.html` e `server.js`. Preencha os campos `{{...}}`.

---

## Contexto
Jogo web de adivinhação de palavras em arquivo único (`index.html`, JS puro, sem build) com servidor Node (`server.js`, pacote `ws`). Arquitetura: anfitrião autoritativo — o anfitrião processa as ações e transmite o estado.
Protocolo WebSocket (JSON):
- Cliente → servidor: `{t:'join',room,resume}`, `{t:'pr',p}` (presença: pid, nm, av, h), `{t:'ev',topic,data}`, `{t:'pg'}`, `{t:'bye'}`
- Servidor → cliente: `{t:'joined',id,hostId,resumed}`, `{t:'peers',list}`, `{t:'ev',topic,data,by}`, `{t:'host',id}`, `{t:'full'}`
- Tópicos permitidos: `act` (qualquer jogador), `state`/`secret`/`msg`/`fx` (somente anfitrião)
Hospedagem: Render free (dorme sem tráfego). Público: amigos em redes diferentes, inclusive celular 4G.

## Tarefa
{{Descreva UMA função nova, o comportamento esperado e um exemplo concreto de uso.}}

## Restrições
- Não alterar o protocolo existente sem avisar; se precisar, liste exatamente o que muda no cliente e no servidor.
- Manter arquivo único, sem dependências novas além de `ws`.
- Preservar: reconexão com `resume`, troca de anfitrião, limites e validações do servidor.
- Estado total ≤ 3700 caracteres por `state`.
- Não inventar APIs ou funções que não existam no código anexado; se faltar informação, pergunte antes de implementar.
- Textos da interface em português do Brasil.

## Formato de saída
1. Lista curta de pontos do código que serão alterados (nome da função/linha).
2. Trechos de código com `str_replace` exatos (texto antigo → novo), sem reescrever o arquivo inteiro.
3. Passos de teste manual (2 jogadores em redes diferentes).
4. Seção **Sugestões de Melhoria Técnica** (ver abaixo).

---

## Sugestões de Melhoria Técnica (para este prompt)
**Redução de alucinações**
- Anexar sempre o código atual e exigir citação do trecho alterado (função/linha); a restrição "não invente APIs" já cobre isso.
- Pedir uma função por vez e exigir que o Claude liste suposições antes de codar.
- Pedir verificação final: "releia seu patch e confirme que cada identificador usado existe no código anexado".

**Temperatura/tom**
- Via API: temperatura 0–0.3 para código; 0.7–0.9 só para criar palavras, pistas e textos divertidos do jogo.
- Tom da interface: informal, curto, pt-BR, consistente com o texto atual.

**Few-shot / role-prompting**
- Role: "engenheiro sênior de sistemas em tempo real e jogos web".
- Few-shot: inclua 1 exemplo de patch no formato desejado, por exemplo:
  `ANTES: toast('Sala cheia.','bad')` → `DEPOIS: toast('Sala cheia (máx. 12).','bad')`
- Para novas palavras do banco, inclua 2–3 linhas reais no formato `PALAVRA|dificuldade|pista1|pista2|pista3` como exemplo.
