# Teste automatico da troca de modulos

Deixe o ERP rodando em `http://localhost:3000` e execute na raiz:

```sh
npm run perf:login
```

Abre uma janela propria do Edge. Faca login nela uma vez; a sessao da sua
janela habitual nao e copiada. O script salva a sessao em
`playwright/.auth/performance-user.json` e fecha a janela automaticamente.
Esse arquivo equivale a uma sessao autenticada: nao compartilhe nem versione.
A pasta ja esta no `.gitignore`. Se expirar, repita o comando.

```sh
npm run perf:navigation
```

Percorre Dashboard, Ordens, Clientes, Estoque, Veiculos, Agendamentos,
Fluxo de Caixa, Bancos, Fiscal e Relatorios, duas vezes. Usa os links reais do
menu para testar navegacao do Next.js, sem substituir a troca por reloads.
Nao clica em salvar, excluir, pagar ou emitir. As consultas e os efeitos
normais de abertura de cada tela continuam ocorrendo.

No PowerShell que bloqueia `npm.ps1`, use `npm.cmd` em lugar de `npm`.

## Personalizar

```sh
npm run perf:navigation -- --routes=/clientes,/ordens,/estoque --rounds=3 --headed
npm run perf:navigation -- --budget=10000
npm run perf:login -- --url=http://localhost:3001
npm run perf:navigation -- --url=http://localhost:3001
```

Informe ao menos duas rotas. Apenas enderecos localhost sao aceitos.
Use `--headed` para acompanhar o teste. Rotas sem permissao ou sem link no
menu ficam como `unavailable`; nao ha tentativa de contornar o acesso.

## Resultados

Cada execucao cria `artifacts/performance/<data>/navigation.md` e
`navigation.json`. Salva resultados parciais apos cada troca.

- **URL (ms)**: tempo da acao automatizada ate chegar a URL esperada.
- **Pronta (ms)**: do clique no Link ate o conteudo principal estar visivel,
  sem indicadores de carregamento reconhecidos, com texto/estrutura estaveis
  e sem requisicoes relevantes por pelo menos 700 ms, seguido de dois frames.
  Inclui essa janela de estabilidade; e uma aproximacao de tela utilizavel,
  nao uma medicao exclusiva de renderizacao ou de compilacao.
- **Long tasks (ms)**: soma das tarefas de JavaScript acima de 50 ms desde
  o clique, quando o navegador suporta essa metrica.
- **Requisicoes**: duracao completa ate terminar o corpo da resposta, tipo,
  status HTTP e caminho sem query string. Nao inclui corpos, headers ou cookies.
  Requisicoes de chat, notificacoes, radio, sessao e status do plano sao
  excluidas da espera para nao prender o teste em atualizacoes de fundo.

A primeira rodada e a primeira visita **deste teste**, nao necessariamente
uma compilacao fria: o servidor ja pode ter compilado a rota. A ultima rota
da lista e aberta para preparar a sessao antes da medicao. Para comparar
compilacao fria, reinicie o servidor com um diretorio de build novo, sem
outras abas usando as rotas, e considere essa preparacao.

Compare as duas rodadas e os logs `Compiling`/`Compiled` do terminal. O navegador
sozinho nao separa compilacao, middleware, banco e processamento dentro do
tempo de resposta de uma API. Para comparar com producao local, execute o
mesmo teste com o ERP iniciado por `npm run build` e `npm start`.

O teste encerra com codigo 1 quando encontra erros, rotas indisponiveis ou
uma troca acima de `--budget` (padrao: 5000 ms, incluindo estabilidade).
Interrompe depois de tres falhas de navegacao/menu consecutivas, em vez de
repetir a espera para todos os modulos. Falhas registram a etapa (`menu`,
`click`, `url` ou `screen`) e a rota em que o navegador ficou.
O timeout de cada etapa de navegacao e 45 segundos.
Cancelamentos normais (`ERR_ABORTED`) aparecem como `cancelled` no JSON e
nao classificam sozinhos a tela como erro de rede.
Isso permite usar o relatorio como verificacao de regressao. Nao executa
automaticamente em CI porque depende de servidor e sessao autenticada.

Para validar o proprio medidor, com um servidor de exemplo isolado:

```sh
npm run perf:test
```

## Medicao autenticada em 26/10/2026

Depois de corrigir a expansao dos grupos do menu e remover cliques forcados,
foi executado o percurso Dashboard, Ordens, Clientes e Estoque, duas rodadas.
Relatorio: `artifacts/performance/2026-10-26T18-37-34-765Z/navigation.json`.

| Modulo | Rodada 1 | Rodada 2 |
| --- | ---: | ---: |
| Dashboard | 11,90 s | 4,43 s |
| Ordens | 10,23 s | 7,80 s |
| Clientes | 6,99 s | 4,01 s |
| Estoque | 13,41 s | 13,90 s |

O relatorio dessa execucao ainda marcou Clientes como `network-error` por
um cancelamento de requisicao com nova resposta HTTP 200. A classificacao de
cancelamentos foi corrigida depois; os tempos acima continuam sendo os
tempos observados daquela execucao.

Na segunda rodada, a URL chegou em 0,61 a 0,77 s nos tres primeiros modulos,
mas o conteudo demorou mais para estabilizar. Consultas de Ordens levaram
ate 4,70 s; no Estoque, planos de conta, categorias de transacao e unidades
de medida levaram entre 9,82 e 10,11 s. Isso mostra espera de requisicoes
alem do custo de abrir a rota. So esses tempos nao separam middleware,
compilacao das APIs, processamento e banco. Estoque foi aberto antes das
rodadas para preparar a sessao, portanto nao e uma amostra de cache frio.

## Ajustes e medicao final

Os dialogos de produto, entrada geral e entrada fiscal do Estoque agora montam
no primeiro uso. Entrada/saida individuais tambem usam imports dinamicos.
Grupos e unidades dos filtros de produtos, assim como pessoas e setores dos
filtros de Ordens, sao consultados ao abrir o filtro. Montagens de verificacao
do Strict Mode deixam de iniciar consultas duplicadas de listas e contadores
de Clientes/Estoque e contadores de Ordens: a tarefa inicial e cancelada pelo
cleanup antes da montagem definitiva. Atualizacoes manuais e realtime continuam.

Medicao final autenticada, duas rodadas, no servidor de desenvolvimento:
`artifacts/performance/2026-10-26T18-46-17-162Z/navigation.json`.

| Modulo | Rodada 1 | Rodada 2 |
| --- | ---: | ---: |
| Dashboard | 4,59 s | 3,71 s |
| Ordens | 6,09 s | 5,64 s |
| Clientes | 4,84 s | 3,69 s |
| Estoque | 3,41 s | 3,50 s |

Estoque caiu de 13,90 s na segunda rodada anterior para 3,50 s nesta amostra,
aproximadamente 75%. Sao amostras com caches aquecidos e variacao de rede,
nao um benchmark controlado de cache frio nem promessa para todas as maquinas.
O relatorio final registra apenas uma chamada de lista e uma de contadores
por visita a Clientes/Estoque. A meta padrao de 5 s ainda e excedida em Ordens;
por isso o comando retorna codigo 1 mesmo com todas as navegacoes `ok`.

Validacao adicional no navegador autenticado, sem salvar registros:

- Estoque abre sem consultar planos de conta, categorias ou unidades de
  formularios/filtros fechados.
- Abrir Filtros dos produtos consulta unidades e mostra o painel.
- Acoes > Novo Produto abre o formulario carregado sob demanda.
- Ordens abre sem consultar pessoas e setores usados apenas pelos filtros.
- Abrir Filtros da listagem consulta pessoas e mostra o painel.

ESLint passou nos arquivos alterados. A verificacao TypeScript nao encontrou
diagnosticos nos componentes/hooks alterados; havia dois diagnosticos em
dependencias fora desses arquivos. Nao foi executada uma build de producao.

## Revisao dos demais modulos

Em 26/10/2026 foram medidas duas passagens por Veiculos, Agendamentos,
Fluxo de Caixa, Bancos, Fiscal e Relatorios, sem alterar esses modulos.
Relatorio: `artifacts/performance/2026-10-26T18-50-14-529Z/navigation.json`.
Tempos incluem a janela de estabilidade; nao sao tempos exclusivos de render.

| Modulo | Rodada 1 | Rodada 2 | APIs na rodada 2 |
| --- | ---: | ---: | ---: |
| Veiculos | 10,18 s | 2,86 s | 1 |
| Agendamentos | 5,68 s | 7,24 s | 6 |
| Fluxo de Caixa | 15,34 s | 13,36 s | 42 |
| Bancos | 5,76 s | 4,31 s | 3 |
| Fiscal | 8,18 s | 5,55 s | 13 |
| Relatorios | 9,29 s | 9,51 s | 24 |

Prioridades de revisao:

1. Fluxo de Caixa: `financialTable.tsx` monta varios dialogos, incluindo
   `TransactionDialog` e `DialogEntradaGeral`. Formularios internos consultam
   planos/categorias durante a montagem. A segunda rodada repetiu 42 chamadas
   e planos de conta chegaram a 11,43 s. Adiar conteudos fechados e reduzir
   consultas duplicadas e o primeiro candidato de melhoria.
2. Relatorios: `reports-grid.tsx` monta todos os dialogos. `dialog-fluxo.tsx`,
   `dialog-receita-categoria.tsx` e `dialog-despesa-categoria.tsx` usam hooks
   de dados auxiliares mesmo fechados. A segunda rodada repetiu 24 chamadas,
   com categorias levando ate 7,44 s. Preservar os botoes e montar/carregar
   os formularios apenas ao abrir e o candidato principal.
3. Agendamentos: monta lookup, servicos e lista na abertura, com efeitos
   iniciais sujeitos a repeticao no desenvolvimento. A lista solicita ate
   300 itens na agenda e 150 na outra visualizacao. Revisar necessidade dos
   auxiliares na abertura, repeticoes e quantidade de dados sem prejudicar
   o calendario.
4. Fiscal: revisar consultas de KPIs e auxiliares; foram 13 chamadas na
   segunda rodada. KPIs levaram 3,71 s. Ainda nao foi isolada a causa interna.
5. Bancos: revisar repeticoes de `/api/bancos/resumo`, que ocorreram na
   segunda rodada. A consulta mais lenta levou 2,09 s.
6. Veiculos: uma unica chamada de API na segunda rodada, de 0,76 s. A grande
   diferenca na primeira abertura sugere custo de compilacao/carregamento;
   prioridade menor que os gargalos persistentes acima.

PDV, Historico de Vendas, Alugueis, Orcamentos e demais rotas ainda nao foram
cronometrados nesta revisao. Nao ha conclusao de lentidao para esses modulos.

## Otimizacao de Fluxo de Caixa e Relatorios

Os dialogos financeiros de nova/edicao de transacao, transferencia, conciliacao
OFX e detalhes de OS/venda/entrada agora carregam sob demanda. `MountOnDemand`
preserva a montagem depois do primeiro uso. As mesmas condicoes de permissao,
callbacks de fechamento, recargas e componentes internos foram preservados.
Os auxiliares dos filtros financeiros e dos relatorios passam a consultar
dados ao abrir. Os hooks compartilhados aceitam `enabled`, com padrao `true`
para preservar seus outros usos, sem criar cache global de dados financeiros.
Listagem e KPIs financeiros nao repetem a consulta pela montagem de verificacao
do Strict Mode: o cleanup cancela a tarefa de inicializacao antes dela iniciar.

Resultado autenticado em 26/10/2026, segunda passagem:

| Modulo | Antes | Depois | APIs antes/depois |
| --- | ---: | ---: | ---: |
| Fluxo de Caixa | 13,36 s | 3,56 s | 42 / 2 |
| Relatorios | 9,51 s | 2,04 s | 24 / 0 |

Relatorio final: `artifacts/performance/2026-10-26T19-00-19-041Z/navigation.json`.
Variacoes de rede e cache continuam aplicaveis; a primeira passagem do Fluxo
levou 5,21 s e a de Relatorios 1,77 s. Nenhuma regra de calculo, API de gravacao
ou permissao foi alterada nesta etapa.

Verificacoes:

- `npm run test:financeiro`: 400 testes aprovados.
- `npm run build` inicia com `test:negocio`: 2.802 testes aprovados em 281 arquivos.
- `npm run perf:smoke`: 12 cenarios no navegador autenticado aprovados.
  Cobre filtros, abertura/fechamento/reabertura de nova transacao, transferencia,
  protecao de saida do OFX, relatorios financeiros/vendas/ordens preservando
  datas e nova transacao no layout mobile. Sem gravar, pagar ou importar OFX.
- ESLint sem erros nos arquivos alterados. A verificacao TypeScript nao
  encontrou erros nos arquivos alterados; tres diagnosticos ocorreram em
  dependencias fora deles. Isso nao equivale a uma checagem global limpa.

O smoke usa a mesma sessao de `perf:login` e o servidor em localhost:3000:

```sh
npm run perf:smoke
```

As verificacoes reduzem o risco, mas nao comprovam todas as combinacoes de
dados/permissoes nem gravacoes reais. A otimizacao adia o trabalho do primeiro
uso de cada formulario; nao elimina a necessidade de consultar suas opcoes.
Referencia: https://nextjs.org/docs/app/guides/lazy-loading

Build de producao isolada: compilacao Webpack/PWA concluida com avisos, mas
a coleta de dados das rotas falhou em `/api/pagamentos/stone/pedido` porque
`PAGARME_API_BASE` ou `PAGARME_SECRET_KEY` nao estao configuradas no ambiente
local. Nao foram adicionadas credenciais ficticias nem alterada a integracao
de pagamentos para contornar a validacao. Portanto a build completa nao foi
validada. O teste usou `.next-perf-production` e uma configuracao TypeScript
temporaria em `artifacts/performance/tsconfig.build.json`, com baseUrl na raiz,
para nao disputar o diretorio do servidor de desenvolvimento.

Atualizacao posterior: por solicitacao do usuario, a integracao Pagar.me /
Stone Connect foi removida. A build completa passou em seguida, incluindo
2.800 testes e a geracao de 222 paginas. Ver `docs/REMOCAO-PAGARME.md`.

## Agendamentos, PDV, Historico de Vendas e Alugueis

Agendamentos consulta veiculos e servicos apenas ao abrir o formulario, com
indicacao de carregamento. Buscas de lista obsoletas sao canceladas e suas
respostas nao substituem a lista atual. O limite de itens e as verificacoes
de disponibilidade dos horarios foram preservados. O botao Recarregar continua
fazendo uma consulta manual.

PDV evita repetir a busca inicial de produtos, grupos e categorias na montagem
de verificacao do desenvolvimento. Historico de Vendas carrega seus dialogos
sob demanda e nao duplica a consulta inicial de metricas. Em Alugueis, listas
e contadores tambem evitam repetir a consulta inicial.

Na API de vendas, autores, rateios, notas e nomes de compradores de marketplace
sao consultados em paralelo quando independentes. Os filtros, a ordem da
pagina, o tratamento de rateios e os vinculos de notas foram preservados.
Uma assinatura SHA-256 da resposta completa de uma amostra autenticada foi
identica antes e depois; os dados da resposta nao foram salvos pelo teste.

Ultima medicao: `artifacts/performance/2026-10-26T19-49-51-488Z/navigation.json`.
Segunda visita, incluindo a janela de estabilidade do medidor:

| Modulo | Antes desta rodada | Depois |
| --- | ---: | ---: |
| Agendamentos | 7,24 s | 3,03 s |
| PDV | 4,59 s | 3,81 s |
| Historico de Vendas | 8,74 s | 6,21 s |
| Alugueis | 4,13 s | 3,06 s |

Sao amostras sujeitas a rede, cache e carga local; o Historico ainda excede
a meta de 5 segundos. A volta do PDV remonta o shell e inclui suas consultas
de configuracao/preferencias. O medidor usa o botao Sair do PDV para navegar
ao historico. Se o destino for outro modulo, sai primeiro e prepara o link
no menu fora do tempo medido; `fromRoute` registra a origem real de cada troca.

Verificacao funcional reutilizavel:

```sh
npm run perf:smoke:operational
```

Nove cenarios passaram: agenda sem auxiliares de formulario na abertura,
recarregar, novo agendamento/cancelar, busca de produtos no PDV, adicionar e
remover item apenas no carrinho local, sair do PDV, detalhes e filtros de
vendas e novo aluguel/cancelar. Nenhuma venda, agendamento ou aluguel foi salvo.
O teste respeita a protecao do formulario de aluguel contra Escape, usando
Cancelar para fecha-lo.

Tambem passaram os 2.800 testes de negocio e o ESLint dos arquivos alterados.
TypeScript nao encontrou diagnosticos nos arquivos revisados; permanece um
diagnostico em dependencia fora deles. Foi corrigida a guarda de sessao
opcional na rota de vendas (`session?.user?.id`). A build compilou e gerou
as 222 paginas e o resumo de rotas, mas o processo do comando ficou pendente
no encerramento, sem codigo de saida confirmado. Log local:
`artifacts/performance/build-operational-performance.log`.

## Consulta resumida do historico e configuracao concorrente

O Historico agora solicita `GET /api/venda?view=historico`: somente id, cliente
(id/nome/telefone), status, total, data, canal e status de entrega. Filtros,
ordenacao, paginacao, autorizacao e nomes de compradores do marketplace sao
preservados. A tabela nao usa itens, transacoes, autores das baixas ou notas;
formularios e acoes continuam consultando os detalhes por id. Sem `view=historico`,
a API continua entregando o contrato completo, incluindo rateios financeiros.

Na amostra de seis vendas, JSON completo: 10.756 bytes; resumido: 1.535 bytes
(aproximadamente 86% menor). O teste `npm run perf:smoke:sales` compara apenas
os campos da tabela, paginacao e filtros com a resposta completa em quatro
cenarios: normal, status, busca e segunda pagina com limite de um item.
Nenhum corpo de resposta ou dado comercial e registrado. Uma pagina fora da
faixa existente retornou 500 nas duas versoes; esse comportamento anterior
continua pendente de correcao e nao foi tratado como regressao da otimizacao.

Os layouts do shell e PDV compartilham somente a requisicao de configuracao
em andamento usando `requestConfig`. Nao ha novo cache persistente ou TTL;
leituras posteriores e eventos de atualizacao continuam funcionando como antes.
Um teste verifica compartilhamento concorrente, nova leitura apos conclusao
e recuperacao apos HTTP 503.

Verificacoes: nove cenarios operacionais passaram; quatro comparacoes de API
passaram; teste de concorrencia passou; ESLint dos arquivos alterados passou.
TypeScript global apontou erros em referencias geradas antigas (.next-dev),
artefatos e scripts de banco, sem diagnosticos nos arquivos desta alteracao.
Nao foi executada nova build completa nesta rodada.

Medicao sem smoke ou TypeScript concorrentes:
`artifacts/performance/2026-10-26T20-09-59-494Z/navigation.json`.
Segunda passagem: PDV 3,68 s; Historico 7,14 s; Alugueis 3,41 s; Agenda 2,79 s.
O PDV fez uma unica chamada `/api/config`. No Historico, `/api/venda` levou
4,60 s, indicadores 4,51 s e preferencias 3,85 s. Portanto nao se confirmou
melhoria do tempo total do Historico nesta amostra, embora a resposta e as
consultas de enriquecimento tenham sido reduzidas. Rede, autenticacao e
consulta de indicadores precisam ser medidos separadamente na proxima rodada.
A rodada anterior com testes concorrentes foi descartada da comparacao.

## Diagnostico por fase das APIs de vendas

`npm run perf:api:sales` faz tres leituras sequenciais da listagem resumida e dos
indicadores, depois de preparar a sessao no contexto isolado do navegador.
Registra apenas caminho, status, tempo total e Server-Timing; salva JSON em
`artifacts/performance/api-sales-*.json`, sem corpos, consultas, cookies ou tokens.
Os cabecalhos Server-Timing so sao emitidos em NODE_ENV=development. Na rota
resumida: access (autorizacao), query (consulta principal), marketplace (nomes de
compradores) e handler (total da rota). Os tempos de fases nao incluem middleware,
compilacao anterior a entrada na rota ou transporte local.

A sessao de teste e preparada via GET /api/auth/session antes da medicao e dos
smokes. Isso permite atualizar o cookie no contexto isolado, evitando renovar o
mesmo token antigo em cada API; nao altera login do sistema nem persiste novas
credenciais. A mudanca no protocolo impede atribuir toda diferenca em relacao
a rodadas anteriores apenas ao codigo da aplicacao. Primeira chamada ainda pode
incluir compilacao; nao e uma medicao de inicializacao a frio.

No sistema, foram removidos 350 ms de espera fixa na abertura do Historico e
nas alteracoes de filtros/paginacao. A digitacao continua usando debounce de
350 ms, com cancelamento da requisicao anterior. Preferencias agora agenda o
inicio da consulta para a proxima tarefa e cancela essa tarefa no cleanup;
a montagem descartada pelo StrictMode nao dispara uma consulta inutil.

Verificacao: tres testes da automacao passaram; TypeScript com os arquivos
alterados e declaracoes de sessao nao teve diagnosticos; ESLint passou.
As regras de calculo, permissoes e politica de validade de sessao/cache nao foram
alteradas. Nenhuma migration ou gravacao de negocio foi realizada nesta rodada.

Resultado final desta rodada: dez cenarios operacionais passaram, incluindo
pesquisar e limpar o Historico. A automacao inicialmente usava o papel textbox;
foi corrigida para searchbox, como o input type=search da tela.

Medicao de navegacao sem testes concorrentes:
`artifacts/performance/2026-10-26T20-24-25-078Z/navigation.json`.
Segunda passagem: PDV 3,71 s; Historico 6,01 s; Alugueis 3,08 s; Agenda 2,95 s.
Todas as navegacoes terminaram com status ok; o comando sinaliza a meta de 5 s
excedida pelo Historico. Ele fez uma unica requisicao de preferencias, sem a
consulta inicial descartada. A rodada anterior marcou 7,14 s, mas a preparacao
de sessao mudou e a rede varia: nao atribuir toda a diferenca ao codigo.

Diagnostico sequencial sem testes concorrentes:
`artifacts/performance/api-sales-2026-10-26T20-25-20-759Z.json`.
Apos a primeira chamada: listagem 1,10-1,19 s totais (0,66-0,72 s dentro da
rota), indicadores 0,76-0,83 s totais (0,29-0,36 s dentro da rota).
Consultas principais levaram 0,29-0,37 s e complemento de marketplace 0,31-0,34 s.
Durante a navegacao, as mesmas APIs levaram 4,09 s e 3,25 s. Essa diferenca
precisa de comparacao com uma build local de producao para separar compilacao,
concorrencia, middleware e transporte. Nao comprova um gargalo de indice no banco.
Nao foi executada uma nova build de producao nesta rodada.

## Comparacao com build local de producao e proximos modulos

A build isolada `.next-perf-compare` terminou com codigo 0 e gerou 222 paginas.
Usou `NEXT_TSCONFIG_PATH=artifacts/performance/tsconfig.build.json` para nao
alterar os tipos do servidor dev. O servidor temporario de producao foi iniciado
na porta 3001 e encerrado ao fim da comparacao; o dev da porta 3000 foi preservado.
O `public/sw.js` gerado pela build foi restaurado, sem diferenca de conteudo.
A primeira tentativa restrita falhou com ECONNRESET nas conexoes externas; o
servidor foi reiniciado com acesso a rede e essa rodada invalida foi descartada.

Resultados da segunda passagem, incluindo estabilidade do medidor:

| Modulo | Dev | Producao local |
| --- | ---: | ---: |
| PDV | 3,66 s | 2,58 s |
| Historico | 5,81 s | 2,61 s |
| Alugueis | 2,96 s | 2,39 s |
| Agenda | 3,33 s | 2,14 s |

Relatorios validos:
`artifacts/performance/2026-10-26T20-33-08-206Z/navigation.json` (producao) e
`artifacts/performance/2026-10-26T20-34-12-695Z/navigation.json` (dev).
As rodadas foram sequenciais, com a build concluida antes das medicoes.
A lista de dev tambem incluiu Veiculos e Bancos. Rede, origem da navegacao e
cache variam; a comparacao indica custo do modo dev, sem provar uma causa unica.

Depois desta comparacao, Veiculos passou a carregar dialogo de cadastro/edicao
e seletor de transferencia sob demanda. O componente permanece montado apos o
primeiro uso para preservar o ciclo de estado e fechamento. Foi removida do
wrapper a consulta `/api/veiculos/cliente/:id`: ela gravava apenas estados sem
leitores, enquanto o formulario de edicao ja consulta `/api/veiculos/:id`.
As callbacks de cadastro, edicao, transferencia e recarga foram preservadas.
Abertura e mudanca de tamanho de pagina nao esperam mais 300 ms; a digitacao
continua com debounce. Requisicoes substituidas ou de paginas desmontadas sao
canceladas, e nao substituem a lista atual.

Bancos agenda as leituras iniciais para evitar a busca descartada pelo StrictMode.
As consultas de efeito recebem AbortSignal e respostas canceladas nao atualizam
a tela nem disparam toast. Resumo, totais, saldos, filtros, paginacao e permissoes
continuam usando as mesmas APIs e regras. Sem banco selecionado, o indicador de
carregamento de transacoes e encerrado explicitamente.

A build de comparacao antecede esses ajustes adicionais em Veiculos/Bancos;
nao constitui uma nova build desses ultimos ajustes. ESLint passou e TypeScript
com os quatro arquivos alterados e declaracoes de sessao teve zero diagnosticos.
Smoke reutilizavel: `npm run perf:smoke:vehicles-banks`.

Os sete cenarios novos passaram: abertura de Veiculos sem clientes de formularios,
pesquisa/limpeza, novo/cancelar, editar/cancelar sem consulta redundante por
cliente, abrir selecao de transferencia/sair sem transferir, abertura de Bancos
com uma consulta de resumo e uma de transacoes e recarga dessas duas consultas.
O smoke reinicia seu conjunto de requisicoes pendentes na navegacao de documento
para nao esperar consultas de formularios que pertenciam a pagina anterior.
Nenhuma gravacao de negocio foi feita. A selecao de edicao usa o menu Editar,
como a tela; a tabela de Veiculos nao implementa abertura por duplo clique.

Varredura final dos dez modulos, segunda passagem:
`artifacts/performance/2026-10-26T20-42-27-086Z/navigation.json`.

| Modulo | Tempo dev | Consultas API |
| --- | ---: | ---: |
| Dashboard | 4,78 s | 1 |
| Ordens | 8,52 s | 5 |
| Clientes | 5,01 s | 2 |
| Estoque | 4,33 s | 2 |
| Veiculos | 5,18 s | 1 |
| Agenda | 3,83 s | 1 |
| Fluxo de Caixa | 3,61 s | 2 |
| Bancos | 3,89 s | 2 |
| Fiscal | 8,54 s | 9 |
| Relatorios | 1,73 s | 0 |

Todas as 20 navegacoes terminaram com status ok. O comando retorna 1 porque
algumas excederam o orcamento de 5 s, nao por erro HTTP ou timeout. Bancos passou
de tres para duas consultas iniciais. A variacao de tempo de Veiculos nao
comprova ganho consistente: so a reducao do carregamento antecipado e a remocao
da consulta redundante foram verificadas funcionalmente. O HTML servido pelo
dev confirmou assets de Turbopack; ele ja esta ativo nessa instancia.

Proximas prioridades identificadas (ainda sem alteracoes nesta rodada):
Fiscal repete `/api/fiscal/kpis` e consulta auxiliares como `/api/banks` na entrada;
foram nove chamadas no total, com KPI mais lento em 4,42 s. Ordens tem tempo de
navegacao de 8,52 s, embora a chamada mais lenta `/api/ordens` tenha levado 2,63 s;
precisa separar carregamento de codigo, renderizacao e atividades da tela.
Clientes e Veiculos devem ser medidos novamente depois desses dois, pois os
tempos oscilaram entre rodadas. A comparacao local de producao nao foi estendida
a esses modulos nesta rodada.

## Fiscal e Ordens: leituras na abertura e formularios sob demanda

Fiscal agora monta e importa EntradaFiscalDialog somente ao solicitar Gerar
Entrada. Depois do primeiro uso, MountOnDemand preserva a montagem e o ciclo de
fechamento. A abertura da lista nao busca bancos e formas de pagamento desse
formulario. Os outros dialogos de origem ja eram condicionais e foram mantidos.
A consulta inicial de KPIs e agendada com cleanup para nao repetir a montagem
de verificacao do desenvolvimento. Lista e KPIs cancelam a requisicao anterior,
ignoram respostas/erros de consultas canceladas e sao abortados ao desmontar.
Filtros, paginacao, endpoints e callbacks de sincronizacao continuam iguais.
A espera de 250 ms aplica-se a digitacao, nao a abertura da lista.

Ordens consulta formas de pagamento somente quando abre a confirmacao de envio
para pagamento/faturamento. O hook conserva suas opcoes padrao, estado de carga,
erros e tentativa manual. A abertura da lista, abas e paginacao nao aguardam mais
300 ms. A digitacao continua com debounce de 300 ms, inclusive quando tambem
reinicia a pagina. Renovacao de realtime, reconciliacao de dados, regras de
status, calculos, gravacoes e permissoes nao foram alterados.

`npm run perf:smoke:fiscal-orders` passou oito cenarios: Fiscal com KPI unico e
sem auxiliares da entrada; recarregar; pesquisar/limpar; abrir/fechar filtros;
alternar proprias/terceiros sem sincronizar; Ordens sem formas na abertura;
pesquisar/limpar; abrir/cancelar confirmacao com busca das formas de pagamento.
No ultimo cenario, nao havia OS elegivel na primeira pagina. O teste usou uma
OS existente com status EM_ANDAMENTO simulado somente na resposta GET da tabela.
Os detalhes e formas vieram das APIs; nenhum status real foi gravado. Esse
cenario valida montagem e carregamento, nao uma transicao de negocio completa.
Gerar/salvar entrada fiscal, emitir/sincronizar notas e enviar OS nao foram
executados pelo smoke. TypeScript nos arquivos alterados e suas dependencias
nao teve diagnosticos; ESLint passou; tres testes da automacao passaram.

O medidor agora registra startMs por requisicao: inicio relativo a navegacao,
sem registrar parametros ou conteudo. Isso permite distinguir uma API demorada
de uma chamada que so comecou depois do carregamento da rota. A metrica readyMs
e a janela de estabilidade permaneceram iguais. Nao houve nova build completa
nesta rodada; a build local de comparacao documentada acima e anterior a ela.

Medicao apos os ajustes, sem outros testes concorrentes:
`artifacts/performance/2026-10-26T20-55-58-945Z/navigation.json`.
Nas passagens 2 e 3: Fiscal 3,63 / 4,06 s; Ordens 5,49 / 6,26 s.
O Fiscal passou de nove consultas na amostra anterior para duas consultas
proprias da tela (lista e KPIs). O relatorio pode incluir uma chamada cancelada
de realtime de Ordens durante a saida; ela nao e consulta iniciada pelo Fiscal.
Ordens deixou de consultar formas na abertura e continua recebendo tokens de
realtime. A lista de Ordens levou 1,88-2,25 s; uma chamada adicional de token
iniciada em torno de 3,2 s tambem participa da estabilidade total do medidor.

Outra rodada com o navegador fora da restricao de rede:
`artifacts/performance/2026-10-26T20-57-31-855Z/navigation.json`.
Segunda passagem: Fiscal 3,74 s; Ordens 5,56 s. Todas as navegacoes terminaram
com status ok; o retorno 1 indica a meta de 5 s ainda excedida por Ordens.
Os resultados sao amostras e a origem da navegacao difere da varredura dos dez
modulos; nao devem ser interpretados como ganho fixo garantido.

`node scripts/performance/orders-realtime-diagnostic.mjs` observa apenas eventos
e categorias de erro do WebSocket por 12 s, sem gravar frames brutos, tokens,
topicos ou identificadores. A amostra nao observou erro ou negacao de permissao;
respostas do protocolo estavam ok. Portanto nao se confirmou falha de realtime
como causa da chamada adicional. Conexao, renovacao, reconcilicacao e tentativas
foram preservadas. Ordens continua como ponto para investigacao adicional,
separando disponibilidade da lista de estabilizacao de atividades em segundo plano.

## Clientes e disponibilidade da lista de Ordens

Concluida a verificacao TypeScript pendente da rodada Fiscal/Ordens: zero
diagnosticos no programa com os arquivos revisados e suas dependencias.

CustomerDialog agora importa cadastro e edicao sob demanda, preservando o
DialogTrigger/DrawerTrigger e o estado de abertura controlado ou interno.
MountOnDemand mantem cada conteudo montado depois do primeiro uso. Os estados
de cadastro e callbacks de gravacao/atualizacao permanecem no componente.
Foi removido o GET redundante do wrapper: ele so preenchia estados sem leitores;
o EditContent continua buscando o cliente para exibir e editar seus dados.
Nenhum endpoint, calculo de divida, filtro, permissao ou regra de cadastro mudou.

`npm run perf:smoke:customers` passou cinco cenarios: lista sem detalhes antecipados,
buscar/limpar, cadastrar/cancelar no desktop, abrir edicao/cancelar e cadastrar/
cancelar no tamanho de celular. O teste usa dados existentes e nao salva nada.
ESLint passou e TypeScript do componente com suas dependencias teve zero
diagnosticos. Nao houve nova build completa nesta rodada.

Medicao em desenvolvimento:
`artifacts/performance/2026-10-27T11-19-40-570Z/navigation.json`.
Passagens 2 e 3: Clientes 3,39 / 3,71 s; Ordens 5,94 / 6,33 s. Todas com status ok;
o retorno 1 indica a meta de 5 s excedida por Ordens. A amostra anterior de
Clientes foi 5,01 s; origens de navegacao e rede variam, sem ganho fixo garantido.

A medicao especial `npm run perf:readiness:orders` separa disponibilidade da
primeira linha e estabilidade de APIs de Ordens. Espera a resposta da lista e
usa click({trial:true}) no menu da primeira linha: verifica visibilidade,
habilitacao e hit target sem abrir o menu nem executar acao. Requer uma OS
visivel na lista. Nao substitui nem altera readyMs do perf:navigation.

Resultado:
`artifacts/performance/orders-readiness-2026-10-27T11-22-01-713Z.json`.
Lista interativa em 3,48 / 3,88 s; estabilidade das APIs de Ordens e do conteudo
em 6,92 / 7,41 s nessas mesmas passagens. Essa estabilidade inclui consultas
adicionais e a janela de quietude; nao e tempo puro de renderizacao. Os tempos
nao sao diretamente equivalentes a perf:navigation, que observa mais recursos.
Realtime, reconciliacao de dados e autenticacao foram preservados. A amostra
ajuda a separar espera para usar a lista de atividades posteriores; nao confirma
uma causa unica para todo o tempo restante nem valida gravacoes reais.

## Validacao integrada final - 27/10/2026

A primeira tentativa encontrou seis falhas nos testes da rota GET /api/venda:
a VM de teste ainda nao reconhecia a dependencia api-timing adicionada na
instrumentacao. A fixture agora usa a implementacao real dessa dependencia,
sem retirar as assercoes anteriores. Foi incluido um teste do contrato resumido:
filtros e paginacao preservados e nenhuma consulta de enriquecimento financeiro.
Os sete testes da rota passaram e a suite completa foi executada novamente.

Resultado final de `npm run build` em `.next-perf-final`, com configuracao TS
isolada: codigo 0, 2.802 testes aprovados, zero falhas e 222 paginas geradas.
Log: `artifacts/performance/build-integrated-final.log`.
A tentativa inicial foi preservada em `build-integrated-initial-failure.log`.
Verificacao separada de tipos: 54 arquivos raiz revisados e suas dependencias,
zero diagnosticos (`artifacts/performance/typecheck-integrated.log`). Essa
verificacao nao equivale a incluir scripts e artefatos antigos de toda a pasta.
ESLint dos arquivos de teste/instrumentacao desta rodada passou; quatro testes
da automacao de navegacao tambem passaram.

First Load JS informado pelas builds de comparacao e final:

| Modulo | Build de comparacao | Build final |
| --- | ---: | ---: |
| Clientes | 787 kB | 227 kB |
| Fiscal | 820 kB | 248 kB |
| Veiculos | 785 kB | 206 kB |

Esse e o custo inicial informado pelo Next, nao a soma de todos os formularios
apos abertos nem uma medicao de tempo de rede. O carregamento dos formularios
foi adiado, e nao eliminado.

O servidor da build final foi executado temporariamente na porta 3001 com acesso
as APIs configuradas. Navegacao sem testes concorrentes:
`artifacts/performance/2026-10-27T11-53-59-500Z/navigation.json`.
As 20 navegacoes passaram com status ok e ficaram abaixo da meta de 5 s.
Segunda passagem:

| Modulo | Producao local |
| --- | ---: |
| Dashboard | 3,43 s |
| Ordens | 4,37 s |
| Clientes | 2,49 s |
| Estoque | 2,68 s |
| Veiculos | 1,93 s |
| Agenda | 2,46 s |
| Fluxo de Caixa | 3,91 s |
| Bancos | 3,13 s |
| Fiscal | 3,26 s |
| Relatorios | 1,38 s |

Sao amostras quentes de producao local com a janela de estabilidade do medidor;
nao garantem esses tempos no dev ou em toda combinacao de rede/dados.

Os smokes agora aceitam PERF_BASE_URL, restrita a origem localhost sem caminho,
credenciais ou consulta. `npm run perf:smoke:integrated` executa sequencialmente
as seis suites: financeiro/relatorios, operacional, veiculos/bancos,
fiscal/ordens, clientes e equivalencia da API de vendas.
Com PERF_BASE_URL=http://localhost:3001, as seis passaram: 43 mensagens PASS,
zero SKIP e quatro consultas comparadas no teste de API de vendas. Log:
`artifacts/performance/smoke-integrated-production.log`.
Os cenarios de interface abriram e cancelaram formularios, sem gravar registros
reais. A confirmacao financeira de OS usou status simulado apenas na resposta da
tabela; detalhes e opcoes foram consultados nas APIs. Nessa suite o service worker
e bloqueado para permitir a interceptacao da fixture; as outras suites e a
navegacao de producao rodaram com PWA permitido. Nao foram testados pagamentos,
emissoes ou cadastros reais; os testes de negocio usam dependencias isoladas.

Diagnostico adicional de Ordens: abertura direta e troca Clientes -> Ordens
registraram uma chamada inicial de credencial por conexao observada, origem
connect, HTTP 200 e resposta do canal orders ok. Nao houve erro de permissao,
token expirado ou topico ausente nessas amostras. A chamada extra de rodadas
anteriores nao foi reproduzida de forma consistente. Autenticacao, reconcilicao,
renovacao e tentativas do realtime foram preservadas; a metrica total nao foi
reduzida artificialmente excluindo essas chamadas.

Ao fim, o servidor temporario foi encerrado e public/sw.js foi restaurado a
copia anterior a build, sem diferenca de conteudo. O servidor dev da porta 3000
foi preservado. Nao houve publicacao, migration ou alteracao de dados de negocio.
