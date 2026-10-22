# Monta o Elenco (Vasco)

Site para montar um elenco do Vasco "contratando" qualquer jogador real: 11 titulares + 1 reserva por posição, com foto e valor de mercado do Transfermarkt, e exportação da escalação em PNG para compartilhar. Abaixo do campo ficam as abas **Outros reforços**, **Venda**, **Dispensa** e **Empréstimo**. Cada jogador tem um **Scout** com atributos e estatísticas do Sofascore, e a tela **Comparar** põe dois jogadores lado a lado.

## Como rodar

```
npm install
npx playwright install chromium
node server.js
```

Abra **http://127.0.0.1:3015**. Precisa do Node 18 ou mais novo (usa o `fetch` nativo). A única dependência é o `playwright`, usado só pelo Scout: sem ele, a parte do Transfermarkt continua funcionando. Para usar outra porta: `PORT=4000 node server.js`. Por padrão escuta só em 127.0.0.1; com `HOST=0.0.0.0` aceita conexões de fora (necessário quando hospedado).

## Publicar online (Render, grátis)

Repositório: https://github.com/eusouVascoDEMAIS/monta-elenco-vasco

1. O repositório precisa ter `server.js`, `index.html`, `package.json`, `Dockerfile`, `render.yaml` e `.gitignore`.
2. Em render.com, escolha **New → Blueprint** (link direto: `dashboard.render.com/select-repo?type=blueprint`) e aponte para o repositório. O `render.yaml` define um serviço web free com `runtime: docker`. O `Dockerfile` parte da imagem oficial do Playwright (já traz o Chromium e as bibliotecas de sistema) e define `HOST=0.0.0.0`. A porta vem do `PORT` que o Render injeta.
3. O link fica `https://monta-elenco-vasco.onrender.com` (ou parecido). No plano free o serviço dorme após 15 min sem acesso e o primeiro acesso depois disso leva uns 30 a 50 s.
4. Para o Scout funcionar hospedado, preencha `SOFA_RELAY` e `RELAY_KEY` em **Environment** no Render e deixe o `ponte.cmd` rodando no PC (veja "IP de datacenter" abaixo).
5. O deploy automático a cada commit não disparou neste serviço. Depois de um commit, use **Manual Deploy → Deploy latest commit**.
6. A versão do `playwright` no `package.json` (1.61.1) precisa ser a mesma da tag da imagem no `Dockerfile` (`v1.61.1-noble`). Se mudar uma, mude a outra.

Cada amigo tem o próprio elenco, salvo no `localStorage` do navegador dele. Nada é compartilhado entre usuários.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `server.js` | Serve o `index.html` e expõe `GET /api/busca?q=nome` (raspa a busca rápida do Transfermarkt), `GET /api/elenco-vasco` (raspa o elenco atual do Vasco) e `GET /api/sofa/...` (repassa chamadas à API do Sofascore). Todos devolvem JSON. |
| `index.html` | A página inteira: campo, mesa de contratações, totais e exportação. |
| `package.json` | `npm start`, versão mínima do Node e a dependência `playwright`. |
| `Dockerfile` | Imagem para o Render, baseada na imagem oficial do Playwright. |
| `render.yaml` | Blueprint do Render (serviço web free, Docker). Declara `SOFA_RELAY` e `RELAY_KEY`, preenchidas no painel. |
| `ponte.cmd` | Liga a ponte do Scout no PC: servidor local + túnel ngrok. Fica fora do Git. |
| `relay-key.txt` | Chave secreta da ponte. Fica fora do Git. |

## Como funciona

### Busca (`server.js`)
- O Transfermarkt não libera CORS nem tem API oficial, por isso o navegador pede ao servidor local, e ele busca o HTML de `schnellsuche/ergebnis/schnellsuche?query=...`.
- `parse()` pega só a tabela `#player-grid` (jogadores) e extrai, linha a linha: id, nome, foto, posição (já vem em PT: GOL, ZAG, MEI, CA…), idade, clube + escudo, nacionalidades e valor.
- A foto `portrait/small` é trocada por `portrait/header` (maior). O CDN de imagens do Transfermarkt manda `Access-Control-Allow-Origin: *`, por isso as fotos entram no PNG sem proxy.
- `parseValor()` converte "€ 2.50 mi." → 2500000 e "€ 800 mil" → 800000. A alternativa da regex é `mil|mi|bi` nessa ordem, porque com `mi` antes "mil" virava milhões.
- `parseElenco()` lê a página de elenco `cr-vasco-da-gama/kader/verein/978`. Ela traz as fotos em `data-src` (lazy), que viram `portrait/header`, e as posições por extenso, que `SIGLA` converte ("Ponta-Direita" → PD, "Meia Ofensivo" → MEI…). Os IDs são os mesmos da busca, então dá para detectar o mesmo jogador nas duas origens.
- Resultados ficam num cache em memória por termo buscado. Ele esvazia quando o servidor reinicia ou quando passa de 500 termos, para não crescer sem limite no servidor público.
- A busca traz só a 1ª página (10 jogadores). Termos com palavras extras (ex.: "João Victor zagueiro") não acham nada, então busque só pelo nome.

### Proxy do Sofascore (`server.js`)
- O Sofascore devolve 403 para o `fetch` do Node e para o `curl`, mesmo com cabeçalhos de navegador, porque identifica o cliente pela assinatura TLS. Chamadas de outro site no navegador também levam 403. Só passa quem está na própria origem `www.sofascore.com`.
- Por isso o servidor abre um Chromium headless (Playwright, `channel: 'chromium'`, o Chromium completo em vez do headless shell) uma vez, deixa uma aba parada em `www.sofascore.com/robots.txt` e faz cada chamada com `fetch` dentro dessa aba (`sofa()`). Fica rápido porque a página não carrega o site inteiro.
- `sofaPage()` guarda a promessa da aba, então chamadas simultâneas reaproveitam o mesmo navegador. Se o Chromium cair, o evento `disconnected` zera a promessa e o próximo pedido abre outro.
- `SOFA_OK` é uma lista branca do que pode ser repassado: busca (`search/all`), dados do jogador (`player/{id}`), atributos (`attribute-overviews`), lista de temporadas (`statistics/seasons`) e estatísticas de uma temporada (`unique-tournament/{t}/season/{s}/statistics/overall`). Qualquer outro caminho volta 400.
- 404 do Sofascore (ex.: jogador sem atributos) vira `null` com status 200, para a página tratar como "sem dados". As respostas usam o mesmo cache em memória da busca.
- **IP de datacenter**: no Render, a página base abre (200), mas a API responde 403, porque o Sofascore bloqueia IPs de datacenter na API. Proxy residencial resolveria, mas é pago. A solução adotada é uma **ponte pelo PC do dono**, que tem IP residencial:
  - No Render, `SOFA_RELAY=https://<dominio>.ngrok-free.app` faz o `/api/sofa/...` ser repassado para o PC (`relay()`) em vez de abrir o Chromium. O cabeçalho `ngrok-skip-browser-warning` pula a página de aviso do ngrok free.
  - No PC, o `ponte.cmd` sobe o `server.js` (sem `SOFA_RELAY`, ou seja, com o Chromium) e o `ngrok http --url=<dominio> 3015`.
  - **Chave**: o ngrok expõe o servidor do PC na internet. Por isso, no PC, toda requisição que chega pelo túnel (tem `x-forwarded-for`) precisa trazer `x-relay-key` igual ao `RELAY_KEY`. Sem a chave, volta 403. O Render manda a mesma chave. Ela fica em `relay-key.txt` (fora do Git) e é colada em `RELAY_KEY` no Render. A checagem não roda no Render, porque lá o proxy do próprio Render também põe `x-forwarded-for` em tudo.
  - PC desligado ou túnel fora: o ngrok responde uma página HTML ou a conexão falha. Nos dois casos a ficha mostra "Scout fora do ar: o PC que consulta o Sofascore está desligado". O resto do site continua funcionando.
  - O cache do Render guarda o que já foi consultado, então jogadores já vistos continuam abrindo com o PC desligado, até o serviço reiniciar.
- As fotos do Sofascore (`img.sofascore.com`) não carregam em `<img>` de outro site. Por isso as fotos continuam vindo do Transfermarkt.

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
- O favicon é a cruz do cabeçalho, embutida como SVG em data URI no `<link rel="icon">`.
- Os botões **Elenco** e **Comparar** abaixo do cabeçalho trocam a tela (`verTela()`). A regra `[hidden] { display: none !important }` é necessária porque o `display: grid` do `main` venceria o atributo `hidden`.

### Scout (`index.html`)
- Abre de dois jeitos: pelo botão **Scout** do jogador selecionado na mesa (clicar no jogador no campo e depois em Scout), ou clicando no nome de um card das abas do mercado. Aparece num `<dialog>`.
- **Ficha** (`carregarFicha()`): é o que o scout e a comparação mostram para um jogador.
  1. `candidatos()` busca o nome do Transfermarkt no Sofascore e fica só com jogadores de futebol (a busca traz também minifootball etc.). O candidato cujo time bate com o clube do Transfermarkt vem primeiro. Se o nome completo não achar ninguém, tenta só o sobrenome.
  2. O select **Jogador no Sofascore** deixa trocar o candidato quando o casamento errar. A escolha fica salva no próprio jogador (`p.sofa`), então ele abre certo da próxima vez.
  3. Busca em paralelo atributos, temporadas e dados do jogador. As temporadas são ordenadas pelo ano ("26/27" conta como 2026). A competição padrão é a liga principal do time atual (`primaryUniqueTournament`, depois `tournament`), para não abrir numa copa. Sem achar, fica a mais recente.
- **Atributos**: escala de 0 a 100 dos últimos 12 meses (`yearShift === 0`). Linha: ataque, técnica, tática, defesa, criatividade. Goleiro: defesas, antecipação, distribuição, jogo aéreo, tática. O traço branco na barra é a média da posição.
- **Estatísticas** (`STATS`): cada linha é `[chave, rótulo, conta por 90?, menor é melhor?, formato, 1 = só goleiro / -1 = só linha]`. A coluna "Por 90 min" aparece só nas estatísticas de contagem. Para goleiro escondem-se as de ataque (gols, xG, finalizações…), e para jogador de linha as de goleiro (`mostra()`).
- **Comparar com…** leva a ficha aberta para o lado A da tela Comparar.

### Comparar (`index.html`)
- Dois lados, A (dourado) e B (azul). Cada um escolhe o jogador pelo select **Do seu elenco** (todos do campo e das quatro listas, sem repetir) ou pela busca do Transfermarkt. Depois a ficha é carregada como no scout, com os mesmos selects de jogador e competição.
- A tabela (`renderTabela()`) mostra atributos (barra em escala fixa de 100) e estatísticas (barra relativa ao maior dos dois). O melhor valor fica em destaque. Em perdas de posse, cartões e gols sofridos, menor é melhor. A caixa **Estatísticas por 90 minutos** divide as de contagem pelos minutos jogados.
- Linhas de goleiro aparecem se algum dos dois for goleiro. As de ataque somem só se os dois forem goleiros.
- Cada lado redesenha só a si mesmo (`redesenhaLado()`), para não apagar o que está sendo digitado no outro lado enquanto uma ficha carrega.

## Limitações conhecidas
- O Transfermarkt pode bloquear IPs de datacenter. Se a busca hospedada responder 403, troque de host ou de região. O mesmo vale para o Sofascore.
- O Chromium usa uns 150 a 250 MB de RAM. O plano free do Render tem 512 MB. Se o serviço reiniciar por falta de memória, o próximo passo é um plano pago ou outro host.
- O Sofascore não tem API oficial. Se ele mudar a proteção ou os caminhos, o Scout para e a mensagem de erro aparece na ficha. O resto do site continua funcionando.
- As características (pontos fortes e fracos) do Sofascore vêm só como códigos numéricos sem tradução, por isso ficaram de fora.
- O valor é o de mercado do Transfermarkt, não o custo real de transferência.
- Se o Transfermarkt mudar o HTML da busca, o `parse()` precisa de ajuste. O erro aparece na mesa como "Não deu para buscar agora (...)".
