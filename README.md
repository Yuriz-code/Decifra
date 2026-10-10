# Decifra — servidor online

Serve o jogo e as salas por WebSocket (porta 443). Funciona em qualquer rede.

## A) Teste imediato (seu PC como servidor)
1. Node 18+ instalado
2. `npm install && npm start`
3. Outro terminal: `npx cloudflared tunnel --url http://localhost:3000`
4. Envie o link `https://xxxx.trycloudflare.com` aos amigos (PC precisa ficar ligado).

## B) Hospedagem grátis permanente (Render)
1. Suba esta pasta para um repositório no GitHub
2. render.com → New → Web Service → escolha o repositório (o `render.yaml` configura tudo, plano Free)
3. Compartilhe `https://SEU-APP.onrender.com`

### Evitar que o servidor durma (plano Free dorme após ~15 min sem acesso)
- **Automático:** enquanto houver salas abertas, o servidor chama a si mesmo a cada 9 min (usa `RENDER_EXTERNAL_URL`, já definida pelo Render).
- **Recomendado para ficar sempre acordado:** crie um monitor gratuito em uptimerobot.com (ou cron-job.org) apontando para `https://SEU-APP.onrender.com/health`, a cada 5 min. (Um serviço 24/7 cabe nas 750 h grátis/mês do Render.)
- Se mesmo assim estiver dormindo, o jogo mostra "Acordando o servidor… pode levar até 1 min" e acorda o servidor assim que a página abre.

## Variáveis de ambiente (opcionais)
| Variável | Função |
|---|---|
| `ALLOWED_ORIGINS` | Sites extras autorizados a usar o servidor (ex.: `meusite.com`). Por padrão só o próprio endereço do servidor. |
| `MAX_CONNS_IP` | Conexões simultâneas por IP (padrão 12 — cuidado com redes que compartilham IP) |
| `TRUST_PROXY` | `1`/`0`: confiar em `X-Forwarded-For` (automático no Render) |
| `SELF_URL` | URL pública para o auto-ping fora do Render |

## Monitoramento
- `/health` → `ok`
- `/stats` → contadores (salas, conexões, entradas, reconexões, bloqueios). Sem dados de jogadores.
- Logs em JSON (abertura/fechamento de sala, troca de anfitrião, bloqueios).

## Segurança aplicada
Origem verificada (impede outros sites de usar seu servidor) · só o anfitrião pode emitir `state/secret/msg/fx` (jogador não forja o estado) · tópicos em lista fechada · presença validada e limitada · antiflood (20 msg/s) com expulsão · limites por IP, sala (16) e total · mensagens ≤ 16 KB · salas inativas por 3 h encerradas.

## HTML em outro site
Edite no `index.html`: `window.DECIFRA_WS='wss://SEU-APP.onrender.com';` e adicione o domínio do site em `ALLOWED_ORIGINS`.

## Testes automáticos
```bash
npm install
npm test                 # servidor (salas, antiflood, origem, PWA) + banco de palavras + index.html, ~10 s, sem navegador
npx playwright install chromium   # só na primeira vez
npm run test:e2e         # dois navegadores reais criam e entram numa sala, Wake Lock, palavras vistas, PWA
```
O GitHub Actions (`.github/workflows/test.yml`) roda tudo a cada commit/PR. Se um teste falhar, o relatório do Playwright fica anexado à execução.
Dica: `CHROMIUM_PATH=/caminho/do/chromium npm run test:e2e` usa um Chromium já instalado.

## Banco de palavras
- As palavras originais estão no `public/index.html`. As categorias de cultura brasileira (novelas, música, comidas regionais, futebol, marcas, redes sociais, festas e folclore) ficam em `tools/palavras-brasil.txt`, no formato `PALAVRA|dificuldade|pista1|pista2|pista3`.
- Depois de editar o `.txt`, rode `npm run palavras`: ele valida (pista que entrega a resposta, palavra repetida, pista longa, dificuldade inválida) e injeta no `index.html`, entre os marcadores `BEGIN/END PALAVRAS-BRASIL`. Não edite esse trecho do HTML à mão. Os testes falham se o HTML ficar fora de sincronia com o `.txt`.
- **Sem repetição entre partidas:** o anfitrião guarda as palavras já sorteadas no `localStorage` (`decifra.seen`, neste aparelho). Quando as categorias escolhidas esgotam, só as palavras delas voltam a valer. Para zerar manualmente: apague a chave `decifra.seen` nos dados do site.

## Tela do anfitrião sempre ligada
Enquanto o jogo roda no aparelho do anfitrião, ele pede à API Wake Lock para a tela não apagar (e refaz o pedido ao voltar para a aba). Se o navegador não suportar, nada muda. Convidados não seguram a tela.

## Instalar como app (PWA)
`public/manifest.webmanifest`, `public/sw.js` e `public/icons/*` são servidos pelo `server.js`. O jogo mostra o botão **Instalar app** (Chrome/Android) ou a instrução do iPhone (Compartilhar → Adicionar à Tela de Início). O service worker só acelera a abertura: o jogo continua precisando do servidor. Para trocar o ícone, edite `tools/gerar-icones.py`, rode `npm run icones` e aumente `VERSION` em `public/sw.js`.

## Segurança da palavra secreta
No modo Clássico, a palavra vai do anfitrião só para quem dá as pistas. O servidor entrega as mensagens `secret` e `msg` **apenas ao destinatário** (`data.to`); sem destinatário válido a mensagem é descartada, nunca retransmitida à sala. Há testes que simulam um jogador "espião" lendo o WebSocket. Limitação: no modo sem servidor (PeerJS, conexão direta entre aparelhos) não existe esse intermediário, então um jogador que mexa nas ferramentas do navegador ainda pode ver a palavra. O modo com servidor é o recomendado para jogar a sério.

## Desempenho e manutenção
- O servidor entrega o `index.html` comprimido (brotli/gzip): cerca de 60 KB na rede em vez de 206 KB.
- As fontes (Fredoka e Nunito, licença OFL em `public/fonts/LICENSE-OFL.txt`) vêm do próprio servidor, sem Google Fonts. O PeerJS só é baixado se `DECIFRA_WS` estiver vazio (modo sem servidor).
- O `index.html` é mantido formatado com Prettier: `npm run formatar` (e `npm run formatar:check`, que também roda em `npm test`). O `npm run palavras` já formata ao final.
- Trocar fontes ou ícones: aumente `VERSION` em `public/sw.js` para o cache dos aparelhos renovar.

## Render grátis dorme
O plano grátis desliga o serviço após ~15 min sem visitas, e quem chega depois espera até 1 min. O que já está no projeto:
- **Aviso agendado** (`.github/workflows/manter-acordado.yml`): chama `/health` a cada 10 min, das 12h à 01h59 (horário de Brasília). Para ativar: no GitHub, *Settings → Secrets and variables → Actions → Variables → New repository variable*, nome `RENDER_URL`, valor `https://SEU-APP.onrender.com`. Sem a variável, nada roda. Para mudar o horário, edite o `cron` (ele usa UTC: Brasília + 3 h).
- **Quem já abriu o jogo antes** (inclusive o app instalado) vê a tela na hora: se o servidor não responde em 3 s, o service worker mostra a cópia guardada e o jogo avisa "Acordando o servidor…" enquanto conecta. A cópia se atualiza em segundo plano, então uma versão nova aparece no acesso seguinte.
- O servidor também chama a si mesmo a cada 9 min enquanto houver sala aberta.

Cuidados:
- O Render dá 750 h grátis por mês **somando todos os serviços da conta**. Um único serviço ligado 24 h gasta ~744 h; por isso o aviso agendado cobre só 14 h por dia (~420 h/mês). Se você tem outro serviço grátis (por exemplo o Arena-quiz), não amplie o horário sem fazer essa conta.
- O GitHub só garante os agendamentos "no melhor esforço" (podem atrasar alguns minutos) e, em repositório público, os desativa após 60 dias sem nenhuma atividade no repositório. Em repositório **privado**, cada execução gasta minutos do plano grátis (2000/mês) e esse horário passa disso; nesse caso prefira o UptimeRobot (grátis, intervalo de 5 min, apontando para `/health`).
- Para o servidor nunca dormir, só um plano pago do Render resolve de verdade.

## Convites
Na sala há dois botões: **Convidar** (compartilhar do celular; no computador copia o texto com o link) e **WhatsApp** (abre o WhatsApp com o convite pronto). O link `?sala=CODIGO` já abre a tela de entrada com o código preenchido.
