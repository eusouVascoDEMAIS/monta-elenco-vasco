# Monta o Elenco (Vasco)

Site local para montar um elenco do Vasco "contratando" qualquer jogador real: 11 titulares + 1 reserva por posição, com foto e valor de mercado do Transfermarkt, e exportação da escalação em PNG para compartilhar. Abaixo do campo ficam as abas **Outros reforços**, **Venda**, **Dispensa** e **Empréstimo**.

## Como rodar

```
node server.js
```

Abra **http://127.0.0.1:3015**. Precisa do Node 18 ou mais novo (usa o `fetch` nativo). Não tem dependências nem `npm install`. Para usar outra porta: `PORT=4000 node server.js`. Por padrão escuta só em 127.0.0.1; com `HOST=0.0.0.0` aceita conexões de fora (necessário quando hospedado).

## Publicar online (Render, grátis)

1. Suba esta pasta para um repositório no GitHub (com `server.js`, `index.html`, `package.json` e `render.yaml`).
2. Em render.com, escolha **New → Blueprint** e aponte para o repositório. O `render.yaml` já define o serviço web free, `node server.js` e `HOST=0.0.0.0` (a porta vem do `PORT` que o Render injeta).
3. O link fica `https://monta-elenco-vasco.onrender.com` (ou parecido). No plano free o serviço dorme após 15 min sem acesso e o primeiro acesso depois disso leva uns 30 a 50 s.

Cada amigo tem o próprio elenco, salvo no `localStorage` do navegador dele. Nada é compartilhado entre usuários.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `server.js` | Serve o `index.html` e expõe `GET /api/busca?q=nome` (raspa a busca rápida do Transfermarkt) e `GET /api/elenco-vasco` (raspa o elenco atual do Vasco). Os dois devolvem JSON. |
| `index.html` | A página inteira: campo, mesa de contratações, totais e exportação. |
| `package.json` | Só `npm start` e a versão mínima do Node, para o host reconhecer o projeto. Não tem dependências. |
| `render.yaml` | Blueprint do Render (serviço web free). |

## Como funciona

### Busca (`server.js`)
- O Transfermarkt não libera CORS nem tem API oficial, por isso o navegador pede ao servidor local, e ele busca o HTML de `schnellsuche/ergebnis/schnellsuche?query=...`.
- `parse()` pega só a tabela `#player-grid` (jogadores) e extrai, linha a linha: id, nome, foto, posição (já vem em PT: GOL, ZAG, MEI, CA…), idade, clube + escudo, nacionalidades e valor.
- A foto `portrait/small` é trocada por `portrait/header` (maior). O CDN de imagens do Transfermarkt manda `Access-Control-Allow-Origin: *`, por isso as fotos entram no PNG sem proxy.
- `parseValor()` converte "€ 2.50 mi." → 2500000 e "€ 800 mil" → 800000. A alternativa da regex é `mil|mi|bi` nessa ordem, porque com `mi` antes "mil" virava milhões.
- `parseElenco()` lê a página de elenco `cr-vasco-da-gama/kader/verein/978`. Ela traz as fotos em `data-src` (lazy), que viram `portrait/header`, e as posições por extenso, que `SIGLA` converte ("Ponta-Direita" → PD, "Meia Ofensivo" → MEI…). Os IDs são os mesmos da busca, então dá para detectar o mesmo jogador nas duas origens.
- Resultados ficam num cache em memória por termo buscado. Ele esvazia quando o servidor reinicia ou quando passa de 500 termos, para não crescer sem limite no servidor público.
- A busca traz só a 1ª página (10 jogadores). Termos com palavras extras (ex.: "João Victor zagueiro") não acham nada, então busque só pelo nome.

### Página (`index.html`)
- `FORM` define as formações (4-3-3, 4-4-2, 4-2-3-1, 4-1-4-1, 3-5-2, 3-4-3, 5-3-2). Cada uma tem 11 posições `[rótulo, x%, y%]`. O slot 0 é sempre o goleiro e os índices não mudam ao trocar de formação, então os jogadores continuam no slot.
- Estado `st = { nome, formacao, slots: [{t, r} × 11], listas: { reforcos, venda, dispensa, emprestimo } }`: `t` é o titular e `r` o reserva. `listas` é mesclado com o que já estava salvo, então elencos antigos continuam abrindo. Fica salvo no `localStorage` (chave `monta-elenco-v1`), só neste navegador.
- Clicar no círculo (titular) ou na pílula "Reserva" escolhe o slot. A mesa da direita mostra a busca. Clicar num resultado contrata o jogador e pula para o próximo slot vazio.
- Um mesmo jogador não entra duas vezes (campo, reforços ou listas de saída). `onde()` procura em tudo e o aviso diz onde ele já está.
- **Abas do mercado** (`ABAS`, `renderMercado()`): clicar numa aba ou em "+ Adicionar" põe a mesa no modo lista (`sel = { lista }`).
  - *Outros reforços* usa a busca global. O jogador soma no investimento total, mas não entra no campo.
  - *Venda*, *Dispensa* e *Empréstimo* listam só o elenco atual do Vasco (`/api/elenco-vasco`, carregado uma vez por sessão), com filtro local por nome que ignora acentos.
  - O × do card remove o jogador da lista.
- Totais: investimento total (titulares + reservas + outros reforços), titulares, reservas, outros reforços, receita com vendas (valor de mercado da aba Venda) e idade média dos titulares.
- Jogador que já é do Vasco (`clube === CLUBE_VASCO`, "CR Vasco da Gama") não conta como investimento (`custo()` em `renderTotais()`): ele não precisa ser contratado. O valor dele continua aparecendo no card. A receita com vendas soma todos, porque ali só entra jogador do Vasco.
  - O clube é o do momento em que o jogador foi adicionado. Um jogador que sair do Vasco depois continua contando como "do Vasco" até ser removido e adicionado de novo.
- **Compartilhar imagem**: o `html2canvas` (CDN cdnjs 1.4.1) captura o `#quadro` (nome, campo, totais e as quatro listas do mercado em grade 2×2, as vazias com "Nenhum jogador") em escala 2x. Se o navegador aceitar compartilhar arquivos (`navigator.canShare`, comum no celular), abre o menu de compartilhar. Senão, baixa o `.png`.
- Peculiaridades do html2canvas tratadas no código:
  - O gramado usa `linear-gradient` com paradas explícitas, porque ele ignora o `repeating-linear-gradient`.
  - No clone da exportação, o `<input>` do nome vira um `<div>`, porque ele corta o texto de inputs.
  - As quatro listas do mercado são montadas na página real (classe `.export`, que esconde abas, "+ Adicionar" e o × e mostra títulos e `.m-nada`), e a captura só começa depois que todas as fotos carregam. Montar só no clone deixava as fotos em branco, porque o html2canvas não espera imagens novas do clone. No final volta a aparecer só a aba ativa.
- "Limpar elenco" pede um segundo clique em até 3 s para confirmar. Ele limpa o campo e também as quatro listas.

## Limitações conhecidas
- O Transfermarkt pode bloquear IPs de datacenter. Se a busca hospedada responder 403, troque de host ou de região.
- O valor é o de mercado do Transfermarkt, não o custo real de transferência.
- Se o Transfermarkt mudar o HTML da busca, o `parse()` precisa de ajuste. O erro aparece na mesa como "Não deu para buscar agora (...)".
