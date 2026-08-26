# Módulo de chat interno

> **IMPORTANTE:** antes de modificar qualquer parte do módulo de chat, leia este
> documento integralmente. Depois de qualquer alteração funcional, estrutural,
> visual, no banco, nas APIs, no Realtime ou nas regras de segurança, atualize
> esta documentação no mesmo conjunto de mudanças.

Este documento descreve o estado real do módulo. Os termos usados nas seções são:

- **Implementado:** existe no código e faz parte do contrato atual.
- **Planejado:** evolução conhecida, mas sem implementação ou contrato nesta fase.
- **Fora do escopo:** recurso deliberadamente proibido na fase atual.
- **Limitação conhecida:** comportamento implementado de forma parcial por uma restrição registrada.

A especificação de origem da fase 1 está em [`docs/chat_update/fase1.md`](../chat_update/fase1.md).
O refinamento visual vigente está especificado em
[`docs/chat_update/frontend.md`](../chat_update/frontend.md).
Em caso de divergência futura, este documento deve ser atualizado para representar o código e as
migrações efetivamente vigentes.

## Objetivo e escopo atual

O chat permite comunicação individual por texto entre usuários ativos da mesma instalação do ERP.
Ele é parte do shell global e abre em um único `Sheet`; não existe página exclusiva. Como cada
instalação (Demonstração, Demir, AlphaGarage e Garage Premium) possui banco próprio, os dados de chat
são isolados fisicamente por instalação e não usam `empresa_id`.

### Implementado

- conversas individuais, com uma conversa por par de usuários;
- lista e busca local de conversas;
- rota segura e busca com debounce de usuários ativos;
- mensagens de texto de até 5.000 caracteres;
- histórico paginado por cursor estável (`created_at + id`), 30 itens por página;
- atualização otimista, conciliação e reenvio manual idempotente;
- contador global e por conversa de mensagens não lidas;
- toast interno em tempo real para novas mensagens recebidas, com remetente, setor e prévia;
- leitura por cursor do participante, registrada somente quando o fim alcançado está visível;
- eventos privados do Supabase Realtime para invalidar mensagem, conversa e leitura;
- Supabase Realtime Presence com suporte a múltiplas abas/dispositivos;
- revalidação após foco, visibilidade, retorno da rede ou reconexão do canal;
- painel responsivo, acessível e adequado a desktop, celular e PWA;
- identidade visual violeta integrada ao ERP, tema claro/escuro, transições e microinterações com
  redução de movimento;
- acesso por qualquer usuário autenticado e ativo, inclusive “somente execução de OS”.

### Planejado

Não há recurso futuro contratado por esta fase. Uma fase posterior só deve ser iniciada com uma nova
especificação, migração e atualização deste documento.

### Fora do escopo

Grupos, anexos, imagens, vídeos, documentos, áudio/voz, reações, respostas citadas, edição, exclusão,
encaminhamento, fixação, silenciamento, confirmação de entrega/leitura visual, cards de entidades do
ERP e uma página exclusiva de chat não existem.

Também não existem push, Notification API do navegador, sons, e-mails, Telegram ou
integração/infraestrutura genérica com um futuro módulo de notificações. As sinalizações globais do
chat são somente o contador de mensagens não lidas no ícone do header e o toast interno de mensagem
recebida descrito neste documento.

### Limitações conhecidas

- `usuario` possui `foto_url` após a migração
  [`20260827130000_usuario_foto_perfil.sql`](../../supabase/migrations/20260827130000_usuario_foto_perfil.sql);
  quando preenchida, a UI e o toast usam a foto, mantendo iniciais como fallback. `lastSeenAt` continua
  `null` e a presença online/offline permanece efêmera.
- falhas otimistas permanecem na memória da aba, mas não são persistidas após recarregar a página;
- mensagens muito grandes podem fazer o auto-scroll optar por mostrar “Novas mensagens” se o usuário
  já não estiver próximo do final;
- sessões Auth.js criadas antes da implantação que não carregam token Supabase precisam de novo login,
  salvo quando o fallback opcional `SUPABASE_CHAT_JWT_SECRET` estiver configurado;
- não há recibo de entrega, “digitando”, ausente/idle ou persistência do último horário online;
- a validação automatizada cobre banco, contratos e utilitários; a validação de WebSocket/Presence em
  navegadores reais depende de a migração estar aplicada e do Realtime estar ativo na instalação.

## Arquitetura geral

O frontend nunca consulta as tabelas de chat diretamente. O fluxo é:

1. o Auth.js autentica por credenciais no Supabase Auth e mantém a sessão do ERP em JWT;
2. APIs Next.js validam sessão e estado atual de `usuario.ativo`;
3. as APIs usam `supabaseAdmin` (`service_role`) e funções SQL que repetem as invariantes sensíveis;
4. mudanças no banco enviam somente pequenos eventos de invalidação em tópicos privados;
5. o frontend recebe o evento e recarrega dados autorizados pelas APIs;
6. Presence trafega no canal privado global, sem liberar `SELECT` nas tabelas públicas.

Essa separação preserva o fechamento do schema público estabelecido por
[`20260820180000_public_schema_lockdown.sql`](../../supabase/migrations/20260820180000_public_schema_lockdown.sql).
Os eventos não carregam conteúdo de mensagem nem dados administrativos.

## Localização e responsabilidades

### Integração global

- [`ClientAppShell.tsx`](<../../src/app/(app)/(pages)/ClientAppShell.tsx>): monta `ChatCenter` no header
  verdadeiro, ao lado do relógio e do seletor de tema.
- [`middleware.ts`](../../src/middleware.ts): exige autenticação/usuário ativo e libera `/api/chat/*`
  para o perfil restrito à execução de OS, sem tornar a rota pública.
- [`auth.ts`](../../src/lib/auth.ts): preserva access/refresh token do Supabase Auth dentro do JWT
  criptografado do Auth.js e renova o access token antes do vencimento.
- [`next-auth.d.ts`](../../src/types/next-auth.d.ts): tipos dos campos de sessão usados pelo Realtime.

### Componentes

- [`chat-center.tsx`](../../src/components/chat/chat-center.tsx): único `Sheet` e roteamento das três
  visualizações (`inbox`, `new-conversation`, `conversation`).
- [`chat-view-transition.tsx`](../../src/components/chat/chat-view-transition.tsx): transição visual
  direcional entre as três visualizações, sem criar outro estado funcional de navegação.
- [`chat-visuals.tsx`](../../src/components/chat/chat-visuals.tsx): campo de busca, empty state e
  banner de conexão puramente visuais e reutilizados pelas telas.
- [`chat-trigger.tsx`](../../src/components/chat/chat-trigger.tsx): botão acessível do header, tooltip e
  badge global.
- [`chat-trigger-button.tsx`](../../src/components/chat/chat-trigger-button.tsx): parte apresentacional
  testável do gatilho, com ação de abertura e rótulo acessível.
- [`chat-inbox.tsx`](../../src/components/chat/chat-inbox.tsx): busca, loading/empty/error e lista.
- [`chat-conversation-item.tsx`](../../src/components/chat/chat-conversation-item.tsx): resumo, prévia,
  setor, hora, presença e contador local.
- [`new-conversation.tsx`](../../src/components/chat/new-conversation.tsx): busca abortável com debounce
  de 300 ms e criação/recuperação da conversa direta.
- [`chat-conversation.tsx`](../../src/components/chat/chat-conversation.tsx): orquestra páginas de
  mensagens, eventos, leitura, atualização otimista e retentativa.
- [`chat-timeline.tsx`](../../src/components/chat/chat-timeline.tsx): agrupamento por data, divisor de
  não lidas, paginação ao chegar ao topo e preservação do scroll.
- [`chat-message-bubble.tsx`](../../src/components/chat/chat-message-bubble.tsx): texto seguro,
  alinhamento, hora e estado `sending/sent/failed`.
- [`chat-message-toast.tsx`](../../src/components/chat/chat-message-toast.tsx): valida eventos
  notificáveis, limita a prévia e renderiza/dispara o toast azul de mensagem recebida.
- [`chat-composer.tsx`](../../src/components/chat/chat-composer.tsx): `Textarea`, limite, Enter para
  enviar, Shift+Enter para linha nova e safe area inferior.
- [`chat-presence-indicator.tsx`](../../src/components/chat/chat-presence-indicator.tsx): indicador
  online/offline com rótulo acessível, não apenas cor.
- [`unread-badge.tsx`](../../src/components/chat/unread-badge.tsx): oculta zero e limita a exibição a
  `99+` sem perder o total no rótulo acessível.

### Estado, hooks e serviços

- [`chat-provider.tsx`](../../src/components/chat/chat-provider.tsx): contexto global do chat,
  contador independente do painel, conversas, visualização, presença, canais, estado de conexão e
  revalidação autorizada usada pelo toast de mensagem recebida.
- [`chat-api.ts`](../../src/components/chat/chat-api.ts): cliente `fetch`, erros temporários/definitivos
  e contratos de todas as rotas.
- [`chat-actions.ts`](../../src/components/chat/chat-actions.ts): sequência testável para
  criar/recuperar, atualizar a lista e selecionar uma conversa direta.
- [`chat-utils.ts`](../../src/components/chat/chat-utils.ts): filtro normalizado, formatação e
  conciliação por `id`/`clientMessageId`, atualização de contadores, cálculo de preservação do scroll
  e classificação visual de mensagens realmente acrescentadas ao fim.
- [`contracts.ts`](../../src/lib/chat/contracts.ts): tipos compartilhados e schemas Zod.
- [`cursor.ts`](../../src/lib/chat/cursor.ts): codificação/validação do cursor opaco.
- [`repository.ts`](../../src/app/api/chat/_lib/repository.ts): consultas mínimas, RPCs e mapeamento das
  respostas públicas.
- [`route-utils.ts`](../../src/app/api/chat/_lib/route-utils.ts): sessão ativa, respostas sem cache e
  normalização de erros.

O projeto possui TanStack Query como dependência, mas não havia provider ou padrão de uso nas telas
atuais. O chat usa Context + estado local e não introduz outra biblioteca de estado.

## Estado e fluxo no frontend

`ChatProvider` permanece montado no header mesmo com o painel fechado. Ele carrega o contador global,
assina o tópico privado do usuário e mantém Presence. Abrir o `Sheet` carrega conversas; abrir uma
conversa carrega somente a página mais recente. O estado interno de navegação é:

```ts
type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "conversation"; conversationId: string }
```

Mensagens e paginação pertencem a `ChatConversation`, evitando rerender global a cada tecla. O
composer mantém apenas o rascunho atual. Mensagens otimistas são mescladas com respostas/eventos por
`id` ou pelo par `senderId + clientMessageId`.

## Modelo de dados

A migração da fase é
[`20260825190000_chat_interno_fase_1.sql`](../../supabase/migrations/20260825190000_chat_interno_fase_1.sql).
O avatar exibido pelo chat vem de `usuario.foto_url`, criado pela migração transversal
[`20260827130000_usuario_foto_perfil.sql`](../../supabase/migrations/20260827130000_usuario_foto_perfil.sql).

### `chat_conversa`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `tipo` | `text` | somente `DIRECT` |
| `direct_key` | `text` | IDs UUID ordenados e separados por `:`; UNIQUE |
| `created_at` | `timestamptz` | `clock_timestamp()` |
| `updated_at` | `timestamptz` | atualizado ao inserir mensagem |
| `last_message_at` | `timestamptz` | `null` até a primeira mensagem |

Índice `chat_conversa_atividade_idx` ordena atividade e criação. A restrição da chave também exige
ordem lexical crescente.

### `chat_participante`

| Campo | Tipo | Regra |
|---|---|---|
| `conversa_id` | `uuid` | FK para conversa, cascade |
| `usuario_id` | `uuid` | FK para usuário, restrict |
| `joined_at` | `timestamptz` | data de entrada |
| `last_read_message_id` | `uuid` | FK para mensagem; cursor de leitura |
| `last_read_at` | `timestamptz` | horário da última progressão |

A PK `(conversa_id, usuario_id)` impede participante repetido. O índice
`chat_participante_usuario_conversa_idx` atende a listagem por usuário. Um constraint trigger
deferido exige exatamente os dois UUIDs contidos na `direct_key`; ele também impede terceiro
participante ou conversa direta incompleta no commit.

### `chat_mensagem`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | PK |
| `conversa_id` | `uuid` | FK para conversa |
| `remetente_id` | `uuid` | FK composta exige que seja participante |
| `conteudo` | `text` | `btrim` não vazio, de 1 a 5.000 caracteres |
| `client_message_id` | `uuid` | identificador estável gerado no cliente |
| `created_at` | `timestamptz` | cursor temporal |

A UNIQUE `(conversa_id, remetente_id, client_message_id)` é a idempotência do envio. Os índices
`chat_mensagem_conversa_cursor_idx` e `chat_mensagem_nao_lida_idx` atendem paginação e contagem.

### Prevenção de conversa duplicada

`chat_direct_key(a,b)` ordena os UUIDs no servidor. `chat_get_or_create_direct` valida ambos os
usuários ativos, insere com `ON CONFLICT (direct_key) DO NOTHING`, recupera a linha concorrente e
insere os dois participantes. A UNIQUE é a proteção final contra duas requisições simultâneas; a
chave nunca é aceita do frontend.

### Idempotência da mensagem

O navegador cria um UUID antes da atualização otimista. `chat_send_message` usa o mesmo UUID nas
tentativas. A primeira chamada insere; chamadas repetidas recuperam a mensagem existente sem atualizar
`last_message_at` e sem emitir novo trigger. O frontend substitui o item otimista pelo persistido.

## Funções SQL e migrações

A migração cria e restringe ao `service_role`:

- `chat_direct_key`;
- `chat_get_or_create_direct`;
- `chat_send_message`;
- `chat_list_conversations`;
- `chat_list_messages`;
- `chat_unread_count`;
- `chat_mark_read`;
- triggers de broadcast e de integridade de participantes.

Somente `chat_realtime_topic_allowed(text)` pode ser executada por `authenticated`; ela devolve um
booleano usado pela política de canais e não expõe linhas. Migrações aplicadas nunca devem ser
editadas; evoluções exigem novo arquivo em `supabase/migrations`.

A migração inicial usa criação condicional para tabelas, índices, FK tardia e recriação controlada de
triggers. Isso permite registrar com segurança a versão na Demonstração quando o mesmo schema vazio já
existe sem entrada no histórico. Essa tolerância é uma recuperação específica da migração inicial e não
substitui a regra de criar novas migrações depois que a versão estiver aplicada.

**Situação de implantação em 2026-08-25:** `20260825190000_chat_interno_fase_1.sql` está aplicada na
Demonstração. Demir, AlphaGarage e Garage Premium ainda têm essa versão pendente e devem seguir a ordem
do procedimento multibanco em [`docs/database-migrations.md`](../database-migrations.md).

## Segurança, autenticação e autorização

As três tabelas têm RLS habilitado, sem policies públicas e sem privilégios para `public`, `anon` ou
`authenticated`. `service_role` acessa pelas APIs. Cada rota repete a verificação fresca de
`usuario.ativo`; as funções SQL sensíveis repetem participante/ativo para reduzir o impacto de erro de
aplicação.

Regras vigentes:

- sessão ausente retorna `401 UNAUTHENTICATED`;
- usuário inativo retorna `403 INACTIVE_USER`;
- não participante não lista, envia nem marca leitura;
- somente o usuário da sessão é remetente e dono do cursor de leitura;
- destinatário precisa existir, estar ativo e não ser o próprio usuário;
- a rota de usuários não devolve e-mail, salário, comissões, perfil, permissões ou auditoria;
- conteúdo é React text, nunca `dangerouslySetInnerHTML`;
- IDs, payloads, limites e cursores são validados com Zod e/ou SQL;
- histórico integral sem paginação não possui rota.

O access token Supabase é obtido no login já existente, guardado junto com o refresh token dentro do
JWT criptografado do Auth.js e renovado no servidor. O refresh token não é devolvido ao browser.

## Rotas de API

Todas são `force-dynamic`, `no-store`, autenticadas e aceitas pelo middleware sem permissão
administrativa.

| Método e rota | Entrada principal | Resposta principal |
|---|---|---|
| `GET /api/chat/users?q=` | busca até 100 chars | `{ users: ChatUser[] }` |
| `GET /api/chat/conversations` | — | `{ conversations: ConversationSummary[] }` |
| `POST /api/chat/conversations/direct` | `{ recipientId: uuid }` | `{ conversation, created }`, 200/201 |
| `GET /api/chat/conversations/:id/messages` | `cursor?`, `limit` 1–100 (UI: 30) | `MessagePage` |
| `POST /api/chat/conversations/:id/messages` | `{ content, clientMessageId }` | `{ message, created }`, 200/201 |
| `POST /api/chat/conversations/:id/read` | `{ lastMessageId }` | cursor, contadores local/global |
| `GET /api/chat/unread-count` | — | `{ unreadCount }` |
| `GET /api/chat/realtime-token` | — | `{ token, expiresAt }` |

Tipos públicos estão em [`contracts.ts`](../../src/lib/chat/contracts.ts). Erros previsíveis usam
códigos `CHAT_*`; 400/403 são definitivos para reenvio, enquanto rede, 408, 429 e 5xx são temporários.

## Paginação do histórico

A API busca `limit + 1` em ordem decrescente por `(created_at,id)`, remove o item sentinela e devolve
as mensagens da página em ordem cronológica. `nextCursor` é Base64URL de JSON validado, opaco para a
UI. Ao chegar ao topo, a timeline bloqueia chamadas concorrentes, busca a página anterior e soma a
diferença de `scrollHeight` ao `scrollTop`, preservando a posição visual. `hasMore=false` encerra as
buscas.

## Não lidas e marcação de leitura

Não existe flag por mensagem. Para cada participante, mensagens recebidas posteriores a
`last_read_message_id` na ordem `(created_at,id)` são não lidas. `chat_list_conversations` agrega
prévia e contadores em uma função SQL; `chat_unread_count` calcula o badge global sem carregar
históricos.

Abrir somente o Sheet não marca leitura. A conversa registra leitura quando:

- está aberta e as mensagens foram carregadas;
- `document.visibilityState === "visible"`;
- a timeline chegou a até 80 px do fim;
- existe mensagem persistida alcançada;
- há não lidas.

Uma espera de 300 ms agrupa eventos repetidos. O SQL só avança o cursor; chamadas iguais ou para trás
são idempotentes. O divisor inicial permanece na sessão para mostrar onde começou o bloco não lido.

## Supabase Realtime

O módulo usa **Broadcast from Database**, não `postgres_changes` das tabelas. Portanto as tabelas de
chat não entram na publication e continuam sem `SELECT` no browser.

Tópicos:

- `chat:user:<usuario_id>`: privado, recebe `chat_changed` com IDs e tipo de invalidação;
- `chat:presence`: privado, mantém Presence de usuários ativos;
- `chat:conversation:<conversa_id>`: já autorizado por participante para possível granularidade
  futura, mas não é assinado na fase 1.

Policies `chat_realtime_receive` e `chat_realtime_presence_track` em `realtime.messages` chamam
`chat_realtime_topic_allowed`. Broadcast não pode ser enviado pelo browser; insert é permitido apenas
para Presence no tópico global. O cliente chama `realtime.setAuth(token)` e cria canais com
`private: true`.

Triggers de mensagem e leitura enviam payload mínimo. Ao receber, o frontend reconsulta contador,
resumo e, quando aplicável, a página recente da conversa. Assim o WebSocket não é fonte de verdade.

## Toast de nova mensagem

**Implementado.** Um evento `chat_changed` produz toast somente quando o Sheet do chat está fechado,
`kind = message`, possui `messageId`/`senderId` e o remetente é diferente do usuário autenticado. Com
o chat aberto — inbox, nova conversa ou timeline — o evento continua revalidando os dados, mas não
faz a consulta adicional do toast nem o exibe. A abertura do chat enquanto a consulta está em curso
também cancela a apresentação. O toast não altera contadores nem marca leitura. Eventos de
conversa/leitura e o Broadcast provocado pelo próprio envio são ignorados.

O provider reconsulta, em paralelo, `GET /api/chat/conversations` e a primeira página de
`GET /api/chat/conversations/:id/messages`. O resumo fornece somente nome, setor e avatar do
participante; a página localiza a mensagem exata pelo `messageId`. Se qualquer dado não for encontrado
ou a consulta autorizada falhar, nada é exibido. O ID é removido do controle em caso de falha para
permitir nova tentativa caso o evento seja repetido.

O componente [`chat-message-toast.tsx`](../../src/components/chat/chat-message-toast.tsx) usa o
Sonner global montado por
[`route-aware-toaster.tsx`](../../src/components/route-aware-toaster.tsx), força posição
`bottom-right`, permanece por 9 segundos e permite fechamento. A superfície é azul, responsiva até
390 px e exibe avatar ou iniciais, nome, setor quando disponível e até 600 caracteres em no máximo
seis linhas. A linha de setor é omitida quando não há vínculo. React continua escapando o conteúdo;
HTML da mensagem nunca é interpretado.

Uma coleção limitada aos 200 IDs mais recentes impede que reconexão/evento duplicado exiba a mesma
mensagem novamente durante a sessão da conta. Trocar de usuário ou desmontar o provider cancela as
consultas pendentes, fecha os toasts do chat e limpa essa memória. Não existe som, push, permissão do
navegador, Notification API nem persistência de notificações.

**Decisão:** manter conteúdo e dados do remetente fora do Broadcast e montar o toast após reconsulta
HTTP autorizada.

**Motivo:** o tópico Realtime continua funcionando apenas como invalidação mínima, sem transformar o
WebSocket em uma nova fonte de dados ou ampliar a exposição de conteúdo.

**Alternativas consideradas:** incluir texto/nome/setor diretamente no payload Realtime ou usar
somente a última mensagem do resumo. A primeira ampliaria dados no canal; a segunda poderia mostrar a
mensagem errada quando várias chegassem rapidamente.

**Impactos e limitações:** cada mensagem recebida gera até duas leituras HTTP adicionais. O toast
depende da mensagem ainda estar entre as 30 mais recentes, condição normal no instante do evento. A
foto depende de `usuario.foto_url`; sem foto cadastrada ou se a imagem falhar, são exibidas iniciais.

### Queda e retorno da conexão

`CHANNEL_ERROR`, `TIMED_OUT` ou `CLOSED` mostra aviso sem apagar cache, mensagens ou falhas otimistas.
O Supabase reconecta o socket; em `SUBSCRIBED`, foco, aba visível ou evento `online`, o provider
revalida contador/conversas e a conversa aberta concilia a página recente. Não há polling agressivo.
Todos os timers, listeners, `untrack` e canais são limpos no unmount.

## Presença online

Presence só inicia após sessão autenticada. A chave é o UUID estável do usuário; o payload contém
somente `onlineAt`, não nome, e-mail, permissões ou setor. `presenceState()` define o conjunto online.
O mesmo UUID pode ter múltiplas metas, então fechar uma aba não remove o usuário enquanto outra
presença continuar ativa. Offline não impede envio.

## Atualização otimista e nova tentativa

O composer insere imediatamente uma mensagem `sending` com ID local. Sucesso ou evento Realtime a
concilia por `clientMessageId`. Falha mantém texto e horário na timeline. Erros temporários mostram
“Tentar novamente” e reutilizam o UUID; não há loop automático. Erros definitivos exibem recusa sem
ação de repetição. Se o servidor tiver persistido e a resposta se perder, a UNIQUE faz a tentativa
retornar a mesma linha.

## Responsividade e acessibilidade

No desktop o Sheet tem no máximo 430 px. Em telas menores usa toda a largura e `100dvh`. Header,
timeline/lista e composer têm rolagens independentes; o overlay Radix bloqueia o body. O composer usa
`env(safe-area-inset-bottom)`, área de toque de 40 px e permanece no fluxo flexível para o teclado.

O Sheet possui título/descrição para leitor de tela e devolve foco ao trigger. Botões de ícone têm
`aria-label`; loading/error/read usam rótulos ou regiões apropriadas; presença tem texto acessível;
mensagens podem ser selecionadas e preservam linhas. O conteúdo usa tokens de tema shadcn.

## Identidade visual e animações

**Implementado.** O `Sheet` continua único, com largura máxima de 430 px no desktop e largura total
em telas menores. As classes específicas `chat-panel`, `chat-header-surface`,
`chat-timeline-surface`, `chat-composer-dock` e `chat-composer-surface`, definidas em
[`globals.css`](../../src/app/globals.css), aplicam profundidade, superfícies e um radial violeta
discreto usando exclusivamente os tokens do tema. Header e composer usam blur leve; a timeline tem
canvas próprio. No modo escuro, as superfícies são separadas sem preto puro. A safe area superior é
considerada no header/fechamento e `env(safe-area-inset-bottom)` permanece no composer.

A inbox e a seleção de usuário usam itens arredondados, sem divisores linha a linha. Conversas não
lidas recebem fundo violeta sutil e maior peso tipográfico. Avatares sem imagem usam iniciais sobre
`primary/10`. A presença online tem um único pulso visual suave; offline é estático. Loading, vazio,
busca sem resultado e erro compartilham a mesma linguagem compacta. O badge anima somente ao aparecer
ou mudar de valor e não pulsa continuamente.

[`chat-view-transition.tsx`](../../src/components/chat/chat-view-transition.tsx) usa
`AnimatePresence` e deslocamento de 12–16 px: avanço entra da direita e retorno à inbox entra da
esquerda. A duração normal é de 200 ms. O trigger, itens e botões têm somente feedback curto de
hover/press. O banner de Realtime desconectado entra e sai por opacity/deslocamento e simplesmente
desaparece na reconexão; não existe toast ou sinalização de sucesso da reconexão.

Na timeline, mensagens próprias usam gradiente violeta discreto e mensagens recebidas usam card/muted.
Divisores de data/não lidas, início do histórico, carregamento anterior, falha/reenvio e o botão
“Novas mensagens” têm apresentação própria. O composer é um dock com textarea e envio na mesma
superfície; a mudança vazio/válido anima apenas opacity/scale do botão, e Send/Loader faz transição
curta. O contador continua em 5.000 caracteres e ganha cor de atenção nos últimos 10%.

### Entrada de mensagens e proteção do scroll

A animação de bolha usa somente `opacity`, `translateY` e `scale`, sem `layout animation`. A função
`appendedMessageKeys` compara o snapshot anterior com a lista atual e anima apenas chaves novas após
a última mensagem conhecida. Assim, a carga inicial e páginas antigas inseridas no topo não animam.
O React key visual é `senderId + clientMessageId`, mantido entre mensagem otimista e persistida; a
conciliação não desmonta a bolha e não repete a entrada. A lógica de 80/140 px, o debounce de leitura,
o cursor, os 30 itens por página e `preservedScrollTop` não foram alterados.

### Movimento reduzido

Os componentes Motion consultam `useReducedMotion`; nesse modo os deslocamentos e escalas são
removidos, as transições ficam praticamente instantâneas e o scroll programático usa `auto`. As
microinterações CSS usam variantes `motion-reduce`; o slide/overlay do Sheet é encurtado, spinners
ficam estáticos e o pulso de presença é ocultado. Funcionalidade, rótulos de loading, foco, leitura,
paginação e envio permanecem disponíveis.

**Decisão:** animar por chave estável de idempotência, sem animação global de layout.

**Motivo:** mensagens novas precisam de feedback visual uma única vez sem fazer o histórico piscar,
reanimar durante a reconciliação ou deslocar o scroll ao carregar páginas antigas.

**Alternativas consideradas:** animar todos os itens com `AnimatePresence`, usar `message.id` como
chave ou aplicar `layout` na lista. Essas opções reanimariam o lote inicial ou a troca do ID otimista.

**Impactos e limitações:** somente inserções ao final recebem entrada; mensagens antigas adicionadas
no topo aparecem imediatamente, de propósito. Não há animação de saída porque a fase não exclui
mensagens.

## Decisões técnicas relevantes

### Decisão: APIs como única fonte de dados

**Motivo:** NextAuth é a autenticação principal e o schema público foi fechado para `anon` e
`authenticated`.

**Alternativas consideradas:** liberar RLS direto nas tabelas ou usar o hook de polling existente.

**Impactos e limitações:** um evento Realtime provoca revalidação HTTP, mas não há vazamento de
conteúdo, dependência exclusiva do WebSocket ou polling frequente.

### Decisão: Broadcast privado em vez de Postgres Changes

**Motivo:** Postgres Changes exigiria `SELECT` direto compatível com o JWT do browser; Broadcast
permite payload mínimo e autorização por tópico em `realtime.messages`.

**Alternativas consideradas:** canais públicos com UUIDs difíceis de adivinhar e liberar tabelas para
`anon`. Ambas foram rejeitadas por segurança.

**Impactos e limitações:** a instalação precisa do serviço Realtime ativo; nenhum chat table é
adicionado à publication.

### Decisão: token Supabase dentro da sessão Auth.js

**Motivo:** o login já usa Supabase Auth e recebe uma credencial de usuário válida para as policies
privadas.

**Alternativas consideradas:** segredo HS256 obrigatório ou canal público. O segredo existe apenas
como fallback opcional de implantação.

**Impactos e limitações:** sessões anteriores precisam relogar se o fallback não estiver configurado;
o servidor renova o token sem expor o refresh token.

### Decisão: cursor de leitura por participante

**Motivo:** evita uma linha/UPDATE por destinatário por mensagem e torna contador/leitura eficientes.

**Alternativas consideradas:** booleano `lida` em cada mensagem.

**Impactos e limitações:** leitura é progressiva; não existe “marcar como não lida” na fase 1.

## Configuração necessária

Variáveis já usadas pelo ERP:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (handshake e Supabase Auth, nunca acesso às tabelas do chat);
- `SUPABASE_SERVICE_ROLE_KEY` (somente servidor);
- `AUTH_SECRET`.

Variável opcional:

- `SUPABASE_CHAT_JWT_SECRET`: legacy/shared signing secret aceito pelo projeto Supabase, usado somente
  para emitir token curto quando uma sessão antiga não possui token Supabase. Não usar a service-role
  key como valor e nunca prefixar com `NEXT_PUBLIC_`.

O Supabase Realtime deve estar habilitado. Os canais são explicitamente privados; desabilitar “Allow
public access to channels” no painel é uma defesa adicional recomendada, desde que nenhum módulo
legado dependa de canais públicos.

## Testes e validação

Testes TypeScript/React do módulo:

```powershell
npm run test:chat
```

O teste SQL permanente está em [`supabase/tests/chat_fase1.sql`](../../supabase/tests/chat_fase1.sql)
e deve rodar no banco de Demonstração depois da migração:

```powershell
npm run db:test:sql -- supabase/tests/chat_fase1.sql demo
```

Ele usa `BEGIN/ROLLBACK`, cria usuários A/B/C/inativo temporários e verifica autorização,
concorrência lógica da conversa, idempotência, limite, paginação sem lacuna/repetição, contador,
leitura isolada e autorização de tópico. Para migração ainda não aplicada, valide primeiro com o
fluxo de dry-run e execução transacional adotado em [`docs/database-migrations.md`](../database-migrations.md).

O runner seguro da própria migração remove e valida seus envelopes transacionais antes de abrir a
transação externa. Ele testa reaplicação sobre o schema atual e instalação sem as tabelas do chat:

```powershell
npm run db:test:chat-migration
```

Não envolva diretamente um arquivo que contém `COMMIT` em outro `BEGIN`: o `COMMIT` interno encerra a
transação externa no PostgreSQL.

Depois do deploy na Demonstração, o smoke test remoto cria dois usuários autenticados temporários,
valida tópicos privados, rejeição de tópico alheio, Presence multiaba, Broadcast, retorno offline,
contador e leitura, e remove os dados criados no bloco de limpeza:

```powershell
npm run db:test:chat-realtime
```

Antes de entregar alterações, executar também:

```powershell
npm run db:status
npm run test:chat
npm run lint
npm run build
```

Validação manual mínima com navegadores/perfis separados:

1. A cria/recupera conversa com B e envia;
2. B recebe, vê badges sem abrir a conversa e depois alcança o fim para zerá-los;
3. B responde e A recebe;
4. desligar/religar rede preserva dados e revalida;
5. falha durante envio deixa “Tentar novamente” e a repetição gera uma linha;
6. carregar mais de 30 mensagens pelo topo sem salto;
7. conferir desktop, celular/PWA, claro/escuro e usuário somente execução.

## Orientações para futuras alterações

Preserve os limites de componente e mantenha regras críticas no banco/API, não apenas no cliente.
Novos campos públicos exigem revisar explicitamente exposição administrativa. Eventos devem continuar
pequenos e não podem substituir revalidação autorizada. Qualquer mudança de ordenação deve atualizar
simultaneamente índice, SQL, cursor, merge e testes.

## Regras para futuras implementações

Toda implementação futura no chat deve:

1. ler esta documentação antes de alterar o módulo;
2. preservar os contratos existentes ou documentar sua alteração;
3. criar uma nova migração em vez de modificar migrações já aplicadas;
4. manter isolamento e autorização por participante;
5. não expor dados administrativos dos usuários;
6. manter paginação em históricos;
7. limpar corretamente canais e assinaturas do Realtime;
8. preservar idempotência e prevenção de mensagens duplicadas;
9. adicionar ou atualizar testes;
10. atualizar este mesmo arquivo de documentação.

## Histórico resumido

- **2026-08-25 — Fase 1:** modelo de conversas diretas, participantes, mensagens, funções atômicas,
  APIs NextAuth, Broadcast/Presence privados, badge global, inbox, timeline paginada, leitura,
  atualização otimista, retentativa, testes e documentação permanente.
- **2026-08-25 — Recuperação de deploy:** migração inicial tornou-se reconciliável com schema vazio
  sem histórico, ganhou runner que remove/verifica envelopes para impedir persistência acidental, foi
  aplicada na Demonstração e validada com dois usuários temporários em canais privados.
- **2026-08-25 — Refinamento visual:** nova identidade visual do painel, inbox, seleção de usuário,
  timeline, composer e mensagens; microinterações e transições com Motion; suporte a
  `prefers-reduced-motion`; sem alterações de banco, APIs, Realtime ou regras funcionais.
- **2026-08-26 — Toast de mensagem recebida:** toast interno azul no canto inferior direito com
  remetente, setor, avatar/iniciais e prévia ampla; deduplicação por `messageId` e reconsulta HTTP
  autorizada somente com o chat fechado, sem conteúdo adicional no Broadcast, som, push ou alteração
  de leitura.
- **2026-08-26 — Fotos de usuário:** listas, conversas e toasts passaram a consumir a foto pública
  cadastrada em `usuario.foto_url`, mantendo iniciais como fallback.
