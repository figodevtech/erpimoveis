# Central Operacional em tempo real

> **IMPORTANTE:** antes de alterar a Central Operacional, seus gatilhos, contratos,
> APIs, regras de acesso ou canais Realtime, leia este documento integralmente.
> Depois de qualquer mudança funcional, estrutural, visual ou de segurança,
> atualize este arquivo no mesmo conjunto de alterações.

## Objetivo e estado da Fase 1

A rota full-screen `/central-operacional` consolida a atividade da oficina em seis
nós: Vendas, Ordens de Serviço, Contas a Receber, Contas a Pagar, Fluxo de Caixa e
Fiscal. Ela é uma projeção operacional: exibe snapshots agregados, eventos reais e
pendências, mas não substitui nenhuma tela transacional nem altera regras de negócio.
Eventos de Estoque continuam no feed autorizado, porém não possuem mais card no mapa.

A Fase 1 está implementada com:

- item **Central Operacional** no menu, protegido por `acompanhamento:visualizar`;
- snapshot autenticado e filtrado pelas permissões de cada módulo;
- log visual idempotente com retenção de 90 dias;
- Broadcast privado por instalação, sem liberar tabelas de negócio ao navegador;
- seis gatilhos sobre OS, venda, transação, produto, NF-e e NFS-e;
- reconciliação periódica, por foco, retorno da rede e reconexão do canal;
- mapa com animações derivadas dos eventos, feed, alertas e ticker;
- modo tela cheia, pausa visual, valores monetários ocultos por padrão e preferência
  persistida localmente;
- estados `CONECTANDO`, `AO VIVO`, `RECONECTANDO` e `OFFLINE`;
- adaptação para desktop, tablet e celular, além de `prefers-reduced-motion`.

## Princípio de arquitetura

As tabelas dos módulos continuam sendo a fonte de verdade. O evento operacional só
invalida o snapshot e comanda a animação; valores e contadores sempre são recalculados
no servidor.

```text
operação de negócio
    │ mesma transação
    ▼
trigger AFTER ──► central_evento_operacional (event_key único)
                         │
                         └──► Broadcast privado { eventId, createdAt }
                                      │
                                      ▼
                              navegador autorizado
                                      │ invalida
                                      ▼
                         GET /api/central-operacional/snapshot
                                      │
                                      ▼
                           mapa + feed + ticker
```

Essa separação é deliberada:

- o Broadcast não contém título, valor, entidade ou metadados;
- um pacote perdido é corrigido pelo próximo snapshot;
- evento duplicado não duplica a linha nem o Broadcast;
- falha ao registrar um evento gera `WARNING`, mas nunca bloqueia a operação original;
- os componentes não somam `evento.valor` ao estado atual.

## Modelo de dados

A migração
[`20260828140000_central_operacional_fase1.sql`](../../supabase/migrations/20260828140000_central_operacional_fase1.sql)
cria `public.central_evento_operacional`.

Campos relevantes:

| Campo | Contrato |
|---|---|
| `id` | UUID do evento |
| `tenant_id` | FK obrigatória para `empresa.id` |
| `tipo` | um dos 24 tipos da Fase 1 |
| `modulo` | uma das seis categorias persistidas de evento |
| `entidade_tipo` / `entidade_id` | origem técnica, sem dados pessoais |
| `titulo` / `descricao` | texto curto para o feed |
| `valor` / `quantidade` | medidas opcionais |
| `prioridade` | `INFO`, `ATENCAO` ou `CRITICO` |
| `metadata` | contexto técnico mínimo em JSON |
| `event_key` | chave idempotente por tenant |
| `ocorrido_em` | instante do fato no módulo |
| `created_at` | instante de gravação no log |

`UNIQUE (tenant_id, event_key)` é a barreira de idempotência. Inserções usam
`ON CONFLICT DO NOTHING`; somente a inserção vencedora publica o Broadcast. Eventos
de criação têm chave estável por entidade. Transições incluem `txid_current()`, o que
impede retries na mesma transação sem bloquear uma futura transição legítima para o
mesmo estado.

A função `central_emitir_evento_operacional` remove, de forma oportunista, eventos
com mais de 90 dias do tenant que está emitindo. Não há dependência de `pg_cron`.

RLS está habilitada e `anon`/`authenticated` não possuem `SELECT` na tabela. Apenas o
backend com `service_role` lê o log e monta o snapshot.

## Eventos instrumentados

| Origem | Evento | Condição |
|---|---|---|
| `ordemservico` | `OS_CRIADA` | inserção que não seja apagada ou histórica migrada |
| `ordemservico` | `OS_INICIO_EXECUCAO` | status passa para `EM_ANDAMENTO` |
| `ordemservico` | `OS_AGUARDANDO_PAGAMENTO` | status passa para `PAGAMENTO` |
| `ordemservico` | `OS_FINALIZADA` | status passa para `CONCLUIDO` |
| `ordemservico` | `OS_CANCELADA` | status passa para `CANCELADO` |
| `venda` | `VENDA_CRIADA` | inserção ainda não confirmada |
| `venda` | `VENDA_CONFIRMADA` | inserção/transição para `PAGAMENTO`, `PAGO`, `FINALIZADA` ou `AUTORIZADO` |
| `venda` | `VENDA_CANCELADA` | transição para `CANCELADA` ou `CANCELADO` |
| `transacao` | `PAGAMENTO_RECEBIDO` | receita efetivada por método diferente de PIX |
| `transacao` | `PIX_RECEBIDO` | receita efetivada por PIX |
| `transacao` | `TRANSACAO_CRIADA` | lançamento inserido sem classificação mais específica |
| `transacao` | `TRANSACAO_PAGA` | despesa já paga na inserção ou baixa genérica |
| `transacao` | `CONTA_CRIADA` | despesa pendente inserida |
| `transacao` | `CONTA_PAGA` | despesa muda de pendente para paga |
| `produto` | `ESTOQUE_ENTRADA` | `estoque` aumenta |
| `produto` | `ESTOQUE_SAIDA` | `estoque` diminui |
| `produto` | `ESTOQUE_BAIXO` | saldo cruza o mínimo ou chega a zero |
| `nfe` | `NFE_EMISSAO_INICIADA` | status entra em `ASSINADA`, `ENVIADA` ou `PENDENTE_ENVIO` |
| `nfe` | `NFE_AUTORIZADA` | status passa para `AUTORIZADA` |
| `nfe` | `NFE_REJEITADA` | status passa para `REJEITADA` ou `DENEGADA` |
| `nfse` | `NFSE_EMISSAO_INICIADA` | inserção/processamento de autorização |
| `nfse` | `NFSE_AUTORIZADA` | status autorizado ou emitido |
| `nfse` | `NFSE_REJEITADA` | status rejeitado ou erro de autorização |

`CONTA_VENCIDA` faz parte do contrato visual, mas na Fase 1 é uma **pendência derivada
do snapshot**, e não um evento persistido: a passagem do tempo não executa uma
transação de domínio confiável. Isso evita inventar um evento sem fonte real.

### Direção visual

Para todo evento associado a um nó visível, o núcleo envia uma partícula **para o
nó**, sempre na cor do módulo. Contas a Receber é uma projeção do snapshot e não
introduz um novo tipo de evento nesta fase. Movimentações de Estoque permanecem no
feed, sem conexão ou partícula no mapa. O mapa completo tipo → módulo → estado
temporário → direção → prioridade fica em
[`event-mapping.ts`](../../src/lib/central-operacional/event-mapping.ts).

## Snapshot

`GET /api/central-operacional/snapshot?periodo=DIARIO` exige sessão ativa e
`acompanhamento:visualizar`. O parâmetro aceita `DIARIO`, `SEMANAL` ou `MENSAL`; se
omitido, usa `DIARIO`, e valores inválidos recebem `400`. O servidor lê novamente as
permissões atuais no banco e retorna somente os módulos autorizados.

O contrato, validado com Zod no servidor e no cliente, possui:

```json
{
  "meta": {
    "tenantId": 1,
    "empresa": "Oficina",
    "atualizadoEm": "2026-08-27T12:00:00.000Z",
    "status": "SINCRONIZADO",
    "periodo": "SEMANAL",
    "periodoInicio": "2026-08-24T03:00:00.000Z",
    "periodoFimExclusivo": "2026-08-31T03:00:00.000Z",
    "modulosPermitidos": ["ORDENS", "FINANCEIRO", "CONTAS_RECEBER", "CONTAS_PAGAR"]
  },
  "geral": {
    "usuariosAtivos": null,
    "operacoesPeriodo": 18,
    "osAtivas": 7
  },
  "modulos": {},
  "eventosPeriodo": 18,
  "eventosRecentes": [],
  "atencoes": []
}
```

Indicadores calculados:

| Nó | Indicador estável | Alertas derivados |
|---|---|---|
| Ordens | valor (`orcamentototal`) e quantidade concluídos no período; somente status `PAGAMENTO` e `CONCLUIDO`, pela data `execucao_fim_em` | execução acima de 2h; crítica a partir de 6h |
| Vendas | valor e quantidade confirmados no período | cancelamentos entram pelo feed |
| Contas a Receber | saldo e quantidade com vencimento no período | receitas vencidas sinalizam o nó e a Atenção global |
| Contas a Pagar | saldo e quantidade com vencimento no período | despesas vencidas sinalizam o nó e a Atenção global |
| Fluxo de Caixa | entradas menos saídas efetivadas no banco durante o período | eventos críticos recentes |
| Fiscal | documentos autorizados no período | NF-e/NFS-e rejeitadas no período sinalizam somente o nó/feed |

Por decisão operacional, produtos com estoque baixo/zerado e NF-e/NFS-e
rejeitadas **não entram na barra inferior “Atenção” nem no alerta global do mapa**.
Estoque não possui mais nó: suas movimentações continuam visíveis apenas no feed para
quem tem acesso. A barra global recebe OS com execução prolongada, contas a
pagar/receber vencidas e outros eventos críticos que não estejam nessa lista de
exclusão.

Cada conta vencida mostra a descrição de `transacao.descricao`. Quando
`transacao.cliente_id` aponta para um cliente, também mostra
`cliente.nomerazaosocial` com o prefixo `Cliente:`. CPF/CNPJ, telefone, e-mail e
demais campos do cliente não são consultados nem enviados. **Contas a Pagar** soma
somente despesas e **Contas a Receber** soma somente receitas; adiantamentos de
clientes não são tratados como títulos a receber. Em ambos os cards, o período usa
`vencimento_em` e recorre a `data` quando não houver vencimento.

Os períodos são janelas fechadas no início e abertas no fim, sempre em
`America/Sao_Paulo`: diário é o dia civil atual, semanal começa na segunda-feira e
mensal começa no primeiro dia do mês. A troca preserva o último snapshot até a nova
resposta e descarta respostas atrasadas de um período anterior.

O backend busca até 40 eventos recentes autorizados; a UI mantém 12 visíveis. Módulos
sem permissão aparecem como `SEM ACESSO`, sem indicador ou detalhe sensível. Eventos
e alertas desses módulos não são enviados.

O cliente reconcilia:

- na abertura;
- quando chega uma invalidação Realtime;
- a cada 45 segundos enquanto a aba está visível;
- ao voltar para a aba, recuperar foco ou retornar à rede;
- depois de reconectar o canal.

Consultas simultâneas são coalescidas: uma invalidação ocorrida durante uma busca
agenda somente uma nova busca ao final. Em erro, o último snapshot permanece na tela.

## Detalhe de evento sob demanda

`GET /api/central-operacional/evento/<uuid>` devolve o detalhe do registro por trás
de um evento do feed. O parâmetro é o **UUID do evento**, nunca o id da entidade:
é isso que permite ao servidor reler `modulo` da linha confiável do log em vez de
aceitar do navegador — um módulo vindo do cliente anularia a re-checagem de
permissão.

A consulta acontece somente quando alguém abre um card. O snapshot de 45 segundos
não engorda: carregar o detalhe dos 40 eventos a cada ciclo, para todos os
usuários, sairia caro e quase sempre para nada.

`acompanhamento:visualizar` abre a rota, mas **não é chave-mestra**: o módulo do
evento passa pela mesma matriz de `allowedOperationalModules` que filtra o
snapshot. Um perfil só de acompanhamento abre eventos de Ordens e nenhum outro.
Evento inexistente, de outro tenant ou de módulo não permitido recebem o mesmo
`404 EVENTO_NAO_ENCONTRADO` — um `403` no último caso confirmaria a existência de
um evento que o feed nunca mostra a esse perfil.

Entidade apagada responde `200` com `estado: "ENTIDADE_INDISPONIVEL"`, montado a
partir do que o próprio evento guardou. O log retém 90 dias e as linhas de negócio
são apagadas por marcação, então um evento antigo apontando para o vazio é caso
previsto, não erro.

O contrato é um envelope genérico — `indicadores`, `secoes`, `campos`, `vinculos`
e `restricoes` —, e não uma união por tipo de entidade. Um único componente
renderiza os seis tipos, e um campo que o usuário não pode ver simplesmente não
existe no array: omissão é o padrão, em vez de um nulo que a interface ainda
rotularia. Valores saem **crus**, nunca formatados, porque só o navegador conhece
a preferência local de ocultar dinheiro.

| Entidade | Conteúdo | Gates além do módulo |
|---|---|---|
| `ORDEM_SERVICO` | execução, duração, composição, veículo com placa, garantia | recebido/saldo exigem `financeiro:visualizar` |
| `VENDA` | canal, vendedor, itens, entrega, pagamento | recebido/saldo exigem `financeiro:visualizar` |
| `TRANSACAO` | valor, líquido, em aberto, método, conta, vencimento, natureza | vínculo de venda exige `vendas:visualizar` |
| `PRODUTO` | saldo, mínimo, situação, movimento posterior ao evento | custo exige `financeiro:visualizar` |
| `NFE` | modelo, série, chave, protocolo e o motivo da rejeição | — |
| `NFSE` | número, protocolo, valor e a primeira mensagem de erro | — |

Ficam deliberadamente fora do payload: `nfse.payload_enviado`, `retorno_bruto` e
`erros` crus — o primeiro carrega documento e endereço completos do tomador —, e
`nfse.url_pdf` / `url_consulta` / `url_xml`, que são URLs de terceiro sem
autenticação e, num card, viram um bypass compartilhável de todas as permissões
desta rota. A rota `/api/transaction/[id]/contexto` **não** é reaproveitada: além
de ter outro guard, ela seleciona CPF/CNPJ, telefone, e-mail e endereço do cliente
e do fornecedor.

## Realtime privado, autenticação e tenant

`GET /api/central-operacional/realtime-token` devolve uma credencial curta e o tópico
exato `operational:tenant:<empresaId>`. A rota reutiliza o token Supabase da sessão
quando ele ainda é válido; caso contrário, assina um JWT HS256 de 10 minutos com
`SUPABASE_CHAT_JWT_SECRET`, a mesma infraestrutura privada já usada pelo chat.

A policy `central_operacional_realtime_receive` em `realtime.messages` autoriza apenas:

- usuário existente e ativo (`auth.uid()`);
- usuário root ou perfil com `acompanhamento:visualizar`;
- extensão `broadcast`;
- tópico exatamente igual ao tenant da instalação.

O projeto adota um banco/Supabase por instalação e uma empresa ativa por banco.
`central_operacional_tenant_id()` resolve a primeira empresa, pois as tabelas
históricas de OS, venda, transação e produto não carregam `empresa_id`. NF-e e NFS-e
preservam o `empresaid` da própria linha. Misturar várias empresas operacionais no
mesmo banco está fora do contrato desta fase e exigiria propagar tenant às tabelas de
origem e ao snapshot.

O payload privado é apenas:

```json
{ "eventId": "uuid", "createdAt": "timestamp" }
```

O navegador não confia no conteúdo do Broadcast: ele solicita o snapshot protegido.
A quantidade de usuários online vem do canal privado `chat:presence`; indisponibilidade
de presença mostra `—` e não interrompe a Central.

O cliente usa backoff exponencial de 1 a 30 segundos, recria os canais, renova token,
escuta `online`, `offline`, foco e visibilidade. Se Realtime estiver indisponível, a
reconciliação periódica continua funcionando.

## Permissões

O acesso à rota, às duas APIs e ao canal exige `acompanhamento:visualizar`. Depois
dessa guarda, o snapshot aplica a matriz abaixo:

| Nó | Permissão existente |
|---|---|
| Ordens | `acompanhamento:visualizar` |
| Vendas | `vendas:visualizar` |
| Fluxo de Caixa | `financeiro:visualizar` |
| Contas a Receber | `financeiro:visualizar` |
| Contas a Pagar | `financeiro:visualizar` |
| Fiscal | `financeiro:notas_fiscais` |

`estoque:visualizar` autoriza os eventos de Estoque no feed, sem criar um nó no
mapa.

A mesma matriz é reaplicada ao abrir o detalhe de um evento, e duas permissões
externas entram nessa tela:

| Dado no detalhe | Permissão |
|---|---|
| Nome do cliente | `clientes:visualizar` |
| Vínculo completo de uma venda dentro de evento financeiro | `vendas:visualizar` |

O nome do cliente é o **único** relaxamento da regra de privacidade do feed, e
vale só para o detalhe expandido. Sem `clientes:visualizar` a coluna nem entra na
consulta: a seção some e `restricoes` explica a lacuna. CPF/CNPJ, telefone,
e-mail e endereço continuam fora em qualquer perfil.

As implicações globais continuam válidas. Por exemplo,
`financeiro:notas_fiscais` implica `financeiro:visualizar`; por isso um perfil fiscal
também recebe Fluxo de Caixa, Contas a Receber e Contas a Pagar. A filtragem
relevante ocorre no servidor, não apenas por CSS.

## Interface e comportamento

A tela ocupa `100dvh` e não usa o shell lateral. O cabeçalho apresenta empresa,
usuários online, operações do período, OS ativas, relógio de São Paulo e
sincronização. Um botão geral alterna em ciclo entre resultado diário, semanal e
mensal e atualiza todos os agregados temporais. Os demais controles permitem
atualizar, ocultar valores, pausar animações, entrar em tela cheia e sair.

O mapa é SVG e acompanha o redimensionamento. Os seis cards mantêm um estado estável
do snapshot; durante um evento, somente o nó relacionado recebe um estado temporário
depois que uma partícula percorre a conexão do núcleo até ele. A janela visual dura
2,05 segundos: o trajeto ocupa 1,25 segundo e a reação de alimentação do card é
disparada pela chegada real da partícula, combinando glow, varredura luminosa e um
deslocamento curto antes de voltar ao estado estável.

Em repouso, os nós flutuam continuamente com amplitudes pequenas e ciclos
desencontrados de 6,4 a 7,4 segundos, implementados com Framer Motion. Hover e foco
reforçam o glow na cor do módulo. A flutuação cede temporariamente à animação de
alimentação, para que os dois movimentos não disputem o mesmo `transform`.

Cada nó pode ser aberto por clique, `Enter` ou espaço. A expansão aparece centralizada
somente dentro da área do mapa, acima dos nós e do núcleo, com resultado do período,
situação, acesso, atualização e último evento relacionado. Não existe backdrop ou
desfoque global: cabeçalho, feed e ticker permanecem visíveis e utilizáveis enquanto o
card está aberto. Nesta etapa a janela é somente visualização e não dispara consultas
ou ações novas: usa apenas o snapshot e os eventos que já estão carregados. Valores
continuam respeitando o modo de privacidade. Clique na área livre do mapa, botão de
fechar e `Escape` encerram a janela; o foco retorna ao nó de origem.

Uma fila FIFO evita vinte animações simultâneas. Ela retém no máximo 16 eventos e
processa um por vez. O primeiro snapshot apenas hidrata o feed; não reproduz como
“novo” todo o histórico. IDs vistos são deduplicados e eventos fora de ordem são
ordenados por `ocorridoEm` antes de entrar na fila.

Pausar afeta somente as animações e o ticker: snapshots e dados continuam sendo
atualizados. `prefers-reduced-motion` elimina rotações, partículas, ticker e
transições não essenciais. O modo mobile transforma o mapa em uma área horizontal
navegável e coloca o feed abaixo.

Valores monetários começam ocultos como `R$ ••••••`; a escolha fica em
`localStorage` sob `central-operacional:hide-values`. Contagens operacionais continuam
visíveis. A lista do feed não inclui nome, CPF/CNPJ ou contato de cliente. Nome de
cliente aparece em exatamente dois lugares, sempre sem documento nem contato: na
Atenção de conta vencida relacionada por `transacao.cliente_id`, e no detalhe
expandido de um evento, aí sim exigindo `clientes:visualizar`.

### Expansão de um evento

Clicar num card do feed — ou acioná-lo por `Enter`/espaço — o expande num painel
que **cobre a altura da lista**, com o conteúdo rolando por dentro. Cobrir a lista
é o que permite o feed continuar recebendo eventos normalmente enquanto alguém lê:
o que chega entra atrás do painel, invisível, e ao fechar o feed já está em dia —
sem congelar a recepção nem deslocar o bloco que está sendo lido.

A expansão anima **só a altura**: o painel nasce na posição e no tamanho do card
clicado e cresce até preencher a lista, com a mola macia de
[`motion-timing.ts`](../../src/lib/central-operacional/motion-timing.ts) e saída
mais rápida que a entrada. Não há `scaleY`, que distorceria o texto no caminho.

Fecham o painel: o `X` no cabeçalho, `Escape`, um clique em qualquer canto da
Central fora dele, e o próprio card aberto. O evento em leitura continua
renderizado mesmo que saia dos 12 visíveis. `prefers-reduced-motion` e a pausa
eliminam o movimento sem tirar a funcionalidade.

### Sistema visual por categoria

A categoria visual vem sempre de `OperationalEvent.modulo`. A prioridade não troca
a identidade do módulo: `ATENCAO` adiciona um acento âmbar e `CRITICO` adiciona um
acento coral/vermelho por marcador, ícone ou borda secundária.

| Módulo | Tom principal | Hexadecimal |
|---|---|---|
| Vendas | âmbar | `#fbbf24` |
| Ordens | violeta | `#a78bfa` |
| Fluxo de Caixa (`FINANCEIRO`) | verde | `#34d399` |
| Contas a Receber | verde-água | `#2dd4bf` |
| Contas a Pagar | coral | `#fb7185` |
| Estoque (somente feed) | azul | `#60a5fa` |
| Fiscal | ciano | `#22d3ee` |
| Núcleo | ciano + violeta | — |

Rótulo, rótulo compacto, ícone e tom ficam centralizados em
[`presentation.ts`](../../src/lib/central-operacional/presentation.ts). Os componentes
expõem `data-module`, `data-priority`, `data-active` e `data-paused`; o CSS converte
esses estados nos tokens `--module-color`, `--module-soft` e `--severity-color`.

O feed usa borda lateral, fundo tonal, ícone, categoria e valor no tom do módulo. Um
novo item entra de cima, com deslocamento de 8 px e glow de até 560 ms; os itens
anteriores apenas se reposicionam. O cabeçalho mostra `eventosPeriodo` com o rótulo
da janela selecionada e continuam visíveis no máximo 12 eventos.

Em repouso, cada nó mantém borda, ícone, glow discreto e flutuação leve. Hover ou foco
produzem um glow pulsante na cor da categoria. Um evento colore o núcleo e a conexão,
emite um pulso de origem e conduz halo/partícula até o nó. No contato, um ripple inicia
a alimentação: o card ganha glow, recebe uma varredura tonal, desloca-se levemente
para fora e intensifica ícone e valor antes de estabilizar. `has-alert` usa o acento
de severidade sem apagar a categoria, enquanto módulos sem acesso ficam dessaturados.

Pausa e `prefers-reduced-motion` interrompem ou eliminam movimento não essencial.
Texto não recebe blur; os efeitos contínuos ficam restritos principalmente a
`transform` e `opacity`, adequados ao uso prolongado e ao modo TV.

## Localização e responsabilidades

- [`central-operacional.tsx`](<../../src/app/(app)/(full)/central-operacional/central-operacional.tsx>):
  composição, relógio compartilhado, tela cheia e privacidade.
- [`central-operacional.css`](<../../src/app/(app)/(full)/central-operacional/central-operacional.css>):
  layout, tema, responsividade e redução de movimento.
- [`components`](<../../src/app/(app)/(full)/central-operacional/components>): cabeçalho,
  mapa, núcleo, nós, janela expandida, conexões, alerta, feed e ticker.
- [`use-operational-state.ts`](<../../src/app/(app)/(full)/central-operacional/hooks/use-operational-state.ts>):
  snapshots, coalescência, deduplicação e fila visual.
- [`use-operational-realtime.ts`](<../../src/app/(app)/(full)/central-operacional/hooks/use-operational-realtime.ts>):
  canais privados, presença, estados de conexão e backoff.
- [`contracts.ts`](../../src/lib/central-operacional/contracts.ts): tipos e schemas Zod.
- [`snapshot.ts`](../../src/lib/central-operacional/snapshot.ts): agregações server-only.
- [`tenant.ts`](../../src/lib/central-operacional/tenant.ts): resolução única da
  empresa da instalação, compartilhada por snapshot e detalhe.
- [`event-detail.ts`](../../src/lib/central-operacional/event-detail.ts): leitura
  server-only da entidade por trás do evento.
- [`event-detail-view.ts`](../../src/lib/central-operacional/event-detail-view.ts):
  montagem pura e testável do detalhe, onde vive o contrato de privacidade.
- [`permissions.ts`](../../src/lib/central-operacional/permissions.ts): matriz módulo/RBAC.
- [`formatters.ts`](../../src/lib/central-operacional/formatters.ts): moeda, quantidade e
  tempo relativo.
- [`period.ts`](../../src/lib/central-operacional/period.ts): janelas e rótulos dos
  períodos diário, semanal e mensal.
- [`aggregates.ts`](../../src/lib/central-operacional/aggregates.ts): somatórios puros
  de OS concluídas e fluxo de caixa.
- [`motion-timing.ts`](../../src/lib/central-operacional/motion-timing.ts): tempos
  compartilhados do percurso, contato, alimentação e fila visual.
- [`presentation.ts`](../../src/lib/central-operacional/presentation.ts): rótulos,
  ícones e tons compartilhados das categorias e dos nós.
- [`attention-rules.ts`](../../src/lib/central-operacional/attention-rules.ts): exclusões
  explícitas da barra global “Atenção”.
- [`snapshot/route.ts`](../../src/app/api/central-operacional/snapshot/route.ts): API do snapshot.
- [`evento/[id]/route.ts`](<../../src/app/api/central-operacional/evento/[id]/route.ts>):
  API do detalhe sob demanda.
- [`realtime-token/route.ts`](../../src/app/api/central-operacional/realtime-token/route.ts):
  credencial curta e tópico privado.
- [`central_operacional.sql`](../../supabase/tests/central_operacional.sql): teste SQL
  permanente e transacional.

## Testes e validação

```powershell
npm run test:central-operacional
npm run db:test:central-operacional
npx eslint "src/app/(app)/(full)/central-operacional/**/*.{ts,tsx}" "src/lib/central-operacional/**/*.{ts,tsx}" "src/app/api/central-operacional/**/*.{ts,tsx}"
npx tsc --noEmit --pretty false
npm run build
```

A rota `/central-operacional` também faz parte do catálogo autenticado de capturas.
Na revisão visual, validar desktop `1440×900`, uma largura intermediária e mobile
`390×844`, incluindo os estados ocioso, ativo, alerta, restrito, pausado e redução de
movimento.

`db:test:central-operacional` aplica a migração no banco escolhido dentro de uma
transação externa e sempre executa `ROLLBACK`. O teste verifica DDL, RLS, falta de
leitura direta pelo browser, seis triggers, compilação dos corpos PL/pgSQL,
idempotência, tenant e autorização do tópico privado. É possível escolher outro
banco com `npm run db:test:central-operacional -- demir`.

Validação manual mínima depois de aplicar a migração:

1. abrir `/central-operacional` com perfil completo e conferir os seis nós, sem card de Estoque;
2. alternar Diário → Semanal → Mensal e conferir cabeçalho, feed e todos os agregados;
3. repetir com perfil que possua acompanhamento, mas não Fluxo de Caixa/Estoque/Fiscal;
4. concluir uma OS em `PAGAMENTO` e outra em `CONCLUIDO`; conferir quantidade e soma de `orcamentototal`;
5. confirmar uma venda e um pagamento PIX sem duplicar o evento;
6. criar receitas/despesas a vencer no período e conferir Contas a Receber/Pagar;
7. criar uma receita vencida com descrição e cliente, conferindo os três dados na Atenção;
8. reduzir um produto abaixo do mínimo, conferir somente o feed e confirmar que não entra no ticker;
9. rejeitar um documento fiscal, conferir nó/feed e confirmar que não entra no ticker;
10. desligar a rede, conferir `OFFLINE` com dados preservados e depois a reconexão;
11. recarregar a página e conferir o feed persistido;
12. testar flutuação, glow no hover, abertura da janela por mouse/teclado e fechamento
    por botão, área externa e `Escape`;
13. testar ocultação, pausa, tela cheia, celular e redução de movimento;
14. abrir um evento de cada tipo de entidade no feed e conferir o conteúdo, o
    fechamento pelo `X`, `Escape`, clique fora e clique no próprio card;
15. repetir com perfil só de `acompanhamento:visualizar` — eventos de outros
    módulos nem chegam ao feed — e com perfil sem `clientes:visualizar`,
    conferindo que a seção de cliente é substituída pela restrição;
16. abrir um evento cujo registro de origem foi apagado e conferir o estado
    "indisponível" em vez de erro.

## Limitações conhecidas e Fase 2

- O histórico começa após a aplicação da migração; não há backfill de operações
  anteriores.
- O detalhe de um evento é somente leitura e não abre a tela transacional: as telas
  atuais expõem detalhes por diálogo e não têm rota canônica por entidade. Os
  vínculos apontam para as rotas de impressão, que são estáveis e endereçáveis.
- Movimentações dos estoques simples (`usoconsumo_*`) não alimentam o nó nesta fase;
  o gatilho acompanha `produto.estoque`.
- `CONTA_VENCIDA` é derivada em cada snapshot e não persiste no event log.
- Não há som. A Fase 1 é deliberadamente silenciosa, inclusive para eventos críticos.
- O contador online depende da presença privada do chat; o snapshot não inventa esse
  número quando a presença está indisponível.
- A limpeza de 90 dias ocorre quando um novo evento é emitido, não em horário fixo.
- Instalação com várias empresas no mesmo banco não faz parte do contrato atual.

## Regras para futuras implementações

1. mantenha tabelas de domínio como fonte de verdade;
2. crie uma nova migração em vez de editar uma já aplicada;
3. adicione o tipo em `contracts.ts`, no CHECK SQL e em `event-mapping.ts`;
4. emita o evento na mesma transação do fato, com `event_key` determinística;
5. nunca faça o gatilho impedir a operação de negócio;
6. mantenha o Broadcast opaco e privado; dados completos vêm do snapshot;
7. filtre módulo, evento, alerta e valor no servidor conforme RBAC;
8. não derive contador somando eventos; reconcilie a fonte real;
9. atualize testes de contrato, mapping, permissão e SQL;
10. atualize esta documentação.

Para adicionar um novo módulo, também é obrigatório definir sua permissão existente,
agregação no snapshot, nó indisponível, cor/ícone, posição SVG, comportamento mobile
e tratamento em caso de fonte indisponível.

## Histórico resumido

- **2026-08-28 — Eventos clicáveis:** expansão de um card do feed para um painel
  que cobre a lista e rola por dentro, alimentado por um endpoint de detalhe sob
  demanda com re-checagem de módulo, nome de cliente atrás de `clientes:visualizar`
  e estado próprio para registro de origem apagado.
- **2026-08-28 — Nós interativos:** flutuação leve e desencontrada com Framer Motion,
  glow no hover/foco e expansão centralizada com dados básicos já disponíveis no
  snapshot e no feed.
- **2026-08-28 — Fluxo núcleo → nó:** percurso invertido e desacelerado, emissão na
  cor do card e reação de alimentação sincronizada ao contato com o nó.
- **2026-08-27 — Períodos e indicadores financeiros:** seletor diário/semanal/mensal,
  OS concluídas por `execucao_fim_em` nos status `PAGAMENTO`/`CONCLUIDO`, Fluxo de
  Caixa no lugar de Estoque e novo nó de Contas a Receber.
- **2026-08-27 — Refinamento visual:** apresentação compartilhada por módulo, cores
  semânticas no feed e nas conexões, glow moderado, reação do núcleo, acentos de
  severidade, contador diário, pausa completa e contratos visuais automatizados.
- **2026-08-27 — Fase 1:** rota full-screen, seis nós, event log idempotente, triggers
  de domínio, Broadcast privado por instalação, token curto, snapshot com RBAC,
  presença, reconciliação, feed, ticker, privacidade, offline, responsividade, testes
  unitários/SQL e esta documentação.
