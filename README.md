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
