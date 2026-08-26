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

A especificação de origem da fase 1 está em [`docs/chat_update/fase1.md`](../chat_update/fase1.md) e a
da fase 2 em [`docs/chat_update/fase2.md`](../chat_update/fase2.md).
O refinamento visual vigente está especificado em
[`docs/chat_update/frontend.md`](../chat_update/frontend.md), com o refinamento dos recursos da fase 2
em [`docs/chat_update/frontendfase2.md`](../chat_update/frontendfase2.md).
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

Acrescentado pela fase 2:

- mensagens de voz gravadas no próprio composer, com revisão antes do envio e armazenamento privado;
- resposta citada com recorte histórico e navegação até a mensagem original;
- quatro reações fixas (❤️ 👍 😄 😢), uma por usuário por mensagem;
- edição da própria mensagem de texto dentro de 15 minutos, com histórico de auditoria;
- exclusão “para mim” e “para todos”, esta última dentro de 15 minutos;
- notificações Web Push de novas mensagens, inclusive com o PWA fechado;
- supressão do push quando o destinatário confirma a conversa aberta, visível e conectada.

### Planejado

Não há recurso futuro contratado por esta fase. Uma fase posterior só deve ser iniciada com uma nova
especificação, migração e atualização deste documento.

O Web Push foi construído de forma isolada, sem sininho global nem histórico, justamente para que um
módulo central de notificações possa reaproveitá-lo depois — mas esse módulo **não** existe e não foi
antecipado.

### Fora do escopo

Grupos, anexos genéricos, imagens, fotos, vídeos, documentos, compartilhamento de arquivos,
encaminhamento, fixação, silenciamento, confirmação de entrega/leitura visual, chamadas de áudio ou
vídeo, localização, contatos, status/stories, cards de entidades do ERP (OS, vendas, clientes,
produtos) e uma página exclusiva de chat não existem.

O composer **não** permite escolher arquivos do dispositivo: a única gravação aceita é a produzida
pelo próprio botão de microfone.

Também não existem central ou histórico de notificações dentro do ERP, sininho global, preferências
genéricas de outros módulos, notificações de OS/vendas/estoque/financeiro, sons, e-mails ou Telegram
no chat. As sinalizações globais continuam sendo o contador de não lidas no ícone do header, o toast
interno de mensagem recebida e, quando ativado pelo usuário, o Web Push.

### Limitações conhecidas

- `usuario` possui `foto_url` após a migração
  [`20260827130000_usuario_foto_perfil.sql`](../../supabase/migrations/20260827130000_usuario_foto_perfil.sql);
  quando preenchida, a UI e o toast usam a foto, mantendo iniciais como fallback. `lastSeenAt` continua
  `null` e a presença online/offline permanece efêmera.
- falhas otimistas permanecem na memória da aba, mas não são persistidas após recarregar a página; uma
  gravação de voz que falhou e teve a página recarregada mostra “A gravação foi perdida ao recarregar
  a página” e não oferece nova tentativa;
- mensagens muito grandes podem fazer o auto-scroll optar por mostrar “Novas mensagens” se o usuário
  já não estiver próximo do final;
- sessões Auth.js criadas antes da implantação que não carregam token Supabase precisam de novo login,
  salvo quando o fallback opcional `SUPABASE_CHAT_JWT_SECRET` estiver configurado;
- não há recibo de entrega, “digitando”, ausente/idle ou persistência do último horário online;
- **não existe interface mostrando quem reagiu**: o balão exibe apenas o agregado por reação e destaca
  a do usuário atual;
- o histórico de edição existe no banco para auditoria, mas **não possui tela**;
- a remoção física do áudio no Storage acontece na mesma requisição da exclusão para todos; se o
  Storage falhar, o caminho permanece em `chat_audio_pendente_remocao` para limpeza posterior e o
  áudio já está inacessível, mas **não há rotina agendada** que esvazie essa fila;
- o Web Push depende do service worker, que o `next-pwa` só gera em produção: em `next dev` a ativação
  aparece como indisponível;
- no iPhone e no iPad o Web Push exige o ERP adicionado à Tela de Início (iOS/iPadOS 16.4+); no Safari
  comum a interface explica o requisito em vez de prometer entrega;
- a validação automatizada cobre banco, contratos, utilitários e renderização; a validação de
  WebSocket/Presence, gravação de microfone e entrega real de push em navegadores depende de a
  migração estar aplicada e do Realtime estar ativo na instalação.

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
  não lidas, paginação ao chegar ao topo, preservação do scroll e seleção contextual por toque curto,
  distinguindo controles internos e gesto de rolagem.
- [`chat-message-bubble.tsx`](../../src/components/chat/chat-message-bubble.tsx): texto seguro,
  alinhamento, hora, estado `sending/sent/failed`, citação, marca “editada”, aviso de mensagem
  excluída, reações agrupadas, controles contextuais e player de voz.
- [`chat-message-actions.tsx`](../../src/components/chat/chat-message-actions.tsx): menu por mensagem
  com gatilho interno ao balão e somente Responder, Editar, Excluir para mim e Excluir para todos;
  também contém o botão externo e o `Popover` separado das quatro reações, além da confirmação
  acessível da exclusão para todos.
- [`chat-audio-player.tsx`](../../src/components/chat/chat-audio-player.tsx): player próprio do chat,
  com progresso tematizado, estados de carregamento/erro, retentativa e registro em módulo que garante
  um único áudio tocando por vez.
- [`chat-voice-recorder.tsx`](../../src/components/chat/chat-voice-recorder.tsx): modo de gravação do
  composer, com detecção de suporte, escolha de formato, contagem, prévia, descarte e estados textuais
  de preparação, gravação, revisão, envio e falha.
- [`chat-push-settings.tsx`](../../src/components/chat/chat-push-settings.tsx): consentimento
  explícito do Web Push dentro da inbox, com superfícies próprias para disponível, ativando, ativo,
  permissão negada, indisponível e erro, além de desativação por dispositivo.
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
- [`contracts.ts`](../../src/lib/chat/contracts.ts): tipos compartilhados, schemas Zod e **todas as
  constantes centralizadas** — limite de texto, página, janela de edição/exclusão, duração e tamanho
  máximos do áudio, MIMEs aceitos, TTL da URL assinada, TTL/intervalo do foco, teto de dispositivos e
  o conjunto das quatro reações.
- [`cursor.ts`](../../src/lib/chat/cursor.ts): codificação/validação do cursor opaco.
- [`push-payload.ts`](../../src/lib/chat/push-payload.ts): montagem e sanitização do conteúdo do push
  e hash do endpoint, sem acesso ao banco — por isso é testável isoladamente.
- [`web-push.ts`](../../src/lib/chat/web-push.ts): leitura das chaves VAPID, CRUD das subscriptions,
  envio e revogação automática em `404/410`.
- [`push-client.ts`](../../src/lib/chat/push-client.ts): detecção por recurso, permissão, criação e
  remoção da subscription do dispositivo atual.
- [`repository.ts`](../../src/app/api/chat/_lib/repository.ts): consultas mínimas, RPCs e mapeamento das
  respostas públicas.
- [`push.ts`](../../src/app/api/chat/_lib/push.ts): decide e dispara o push de uma mensagem nova.
- [`route-utils.ts`](../../src/app/api/chat/_lib/route-utils.ts): sessão ativa, respostas sem cache e
  normalização de erros.
- [`worker/index.js`](../../worker/index.js): custom worker importado pelo service worker do
  `next-pwa`; trata `push` e `notificationclick`.

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

As migrações do módulo são
[`20260825190000_chat_interno_fase_1.sql`](../../supabase/migrations/20260825190000_chat_interno_fase_1.sql)
e
[`20260828120000_chat_interno_fase_2.sql`](../../supabase/migrations/20260828120000_chat_interno_fase_2.sql).
A segunda é incremental: nenhuma estrutura da fase 1 foi recriada, nenhuma migração antiga foi editada
e as mensagens existentes continuam válidas (recebem `tipo = 'TEXT'` pelo default da coluna).
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
| `foco_ate` | `timestamptz` | fase 2; enquanto no futuro, o push desta conversa é suprimido |

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
| `conteudo` | `text` | não nulo; regra depende de `tipo` e da exclusão |
| `client_message_id` | `uuid` | identificador estável gerado no cliente |
| `created_at` | `timestamptz` | cursor temporal |
| `tipo` | `text` | fase 2; `TEXT` ou `VOICE`, default `TEXT` |
| `reply_to_message_id` | `uuid` | fase 2; FK para `chat_mensagem`, `on delete set null` |
| `reply_snapshot_tipo` | `text` | fase 2; `TEXT`/`VOICE` do original no momento da resposta |
| `reply_snapshot_conteudo` | `text` | fase 2; recorte histórico de até 160 caracteres |
| `reply_snapshot_remetente_nome` | `text` | fase 2; autor do original no momento da resposta |
| `editada_em` | `timestamptz` | fase 2; `null` até a primeira edição |
| `excluida_para_todos_em` | `timestamptz` | fase 2; exclusão lógica |
| `excluida_para_todos_por` | `uuid` | fase 2; FK para `usuario` |
| `audio_path` | `text` | fase 2; caminho no bucket privado, **nunca devolvido ao navegador** |
| `audio_mime` | `text` | fase 2; MIME conferido no servidor |
| `audio_bytes` | `integer` | fase 2; 1 a 10.485.760 |
| `audio_duracao_ms` | `integer` | fase 2; 1 a 300.000 |

A UNIQUE `(conversa_id, remetente_id, client_message_id)` é a idempotência do envio, agora usada
também pela mensagem de voz. Os índices `chat_mensagem_conversa_cursor_idx` e
`chat_mensagem_nao_lida_idx` atendem paginação e contagem; a fase 2 acrescentou
`chat_mensagem_reply_idx` e `chat_mensagem_audio_path_idx`, ambos parciais.

O check `chat_mensagem_conteudo_check` da fase 1 foi **substituído** por
`chat_mensagem_conteudo_por_tipo_check`, porque voz e exclusão lógica exigem conteúdo vazio:

- excluída para todos → `length(conteudo) = 0`;
- `TEXT` → `btrim` entre 1 e 5.000 caracteres (idêntico à fase 1);
- `VOICE` → `length(conteudo) = 0`.

Os demais checks são `chat_mensagem_tipo_check`, `chat_mensagem_audio_check` (metadados obrigatórios e
coerentes só enquanto a mensagem de voz existe), `chat_mensagem_exclusao_check` (data e autor da
exclusão andam juntos) e `chat_mensagem_reply_snapshot_check`.

### `chat_reacao`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | PK |
| `mensagem_id` | `uuid` | FK para mensagem, cascade |
| `usuario_id` | `uuid` | FK para usuário, cascade |
| `reacao` | `text` | `CORACAO`, `LEGAL`, `FELIZ` ou `TRISTE` |
| `created_at` / `updated_at` | `timestamptz` | criação e última troca |

`UNIQUE (mensagem_id, usuario_id)` garante no máximo uma reação por usuário por mensagem; o check
garante que o valor pertence ao conjunto permitido mesmo se a API for contornada.

### `chat_mensagem_edicao`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | PK |
| `mensagem_id` | `uuid` | FK para mensagem, cascade |
| `conteudo_anterior` | `text` | texto antes da edição |
| `editado_por` | `uuid` | FK para usuário, restrict |
| `created_at` | `timestamptz` | momento da edição |

Existe para auditoria, diagnóstico e preservação de contexto. **Não há tela** e nenhuma rota pública
devolve esse histórico.

### `chat_mensagem_oculta`

| Campo | Tipo | Regra |
|---|---|---|
| `mensagem_id` | `uuid` | FK para mensagem, cascade |
| `usuario_id` | `uuid` | FK para usuário, cascade |
| `created_at` | `timestamptz` | momento da ocultação |

A PK `(mensagem_id, usuario_id)` é a restrição única exigida. A linha principal em `chat_mensagem`
continua intacta.

### `chat_audio_pendente_remocao`

| Campo | Tipo | Regra |
|---|---|---|
| `path` | `text` | PK; caminho do objeto no bucket |
| `conversa_id` | `uuid` | conversa de origem |
| `created_at` | `timestamptz` | entrada na fila |

Fila de objetos a apagar do Storage depois de uma exclusão para todos.

### `chat_push_subscription`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `uuid` | PK |
| `usuario_id` | `uuid` | FK para usuário, cascade |
| `endpoint` | `text` | endpoint do serviço de push |
| `endpoint_hash` | `text` | SHA-256 do endpoint; UNIQUE global |
| `p256dh` / `auth` | `text` | chaves da subscription |
| `user_agent` | `text` | até 300 caracteres, apenas para diagnóstico |
| `device_label` | `text` | rótulo opcional |
| `created_at` / `updated_at` | `timestamptz` | criação e última renovação |
| `last_used_at` | `timestamptz` | último envio aceito |
| `revoked_at` | `timestamptz` | `null` enquanto ativa |

Cada usuário pode ter várias subscriptions — celular, tablet, computador e mais de um navegador. A
unicidade é pelo hash do endpoint, então o mesmo navegador reutilizado por outra conta **troca de
dono** em vez de duplicar.

### Prevenção de conversa duplicada

`chat_direct_key(a,b)` ordena os UUIDs no servidor. `chat_get_or_create_direct` valida ambos os
usuários ativos, insere com `ON CONFLICT (direct_key) DO NOTHING`, recupera a linha concorrente e
insere os dois participantes. A UNIQUE é a proteção final contra duas requisições simultâneas; a
chave nunca é aceita do frontend.

### Idempotência da mensagem

O navegador cria um UUID antes da atualização otimista. `chat_send_message` usa o mesmo UUID nas
tentativas. A primeira chamada insere; chamadas repetidas recuperam a mensagem existente sem atualizar
`last_message_at` e sem emitir novo trigger. O frontend substitui o item otimista pelo persistido.

## Storage do áudio

**Implementado.** A migração da fase 2 cria o bucket **privado** `chat_audio`, com limite de 10 MB e
`allowed_mime_types` restrito a `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg` e `audio/aac`.
Não existe URL pública e o bucket nunca é lido pelo navegador diretamente.

O caminho é determinístico:

```text
chat_audio/<conversa_id>/<remetente_id>/<client_message_id>.<ext>
```

A extensão vem do MIME já conferido, nunca do nome do arquivo enviado.

**Decisão:** caminho determinístico com `upsert: true` em vez de reservar um ID de mensagem antes do
upload.

**Motivo:** a retentativa reenvia o mesmo `client_message_id`, sobrescreve exatamente o mesmo objeto e
a UNIQUE de idempotência devolve a mesma mensagem. Não há duplicação nem estado intermediário de
“processando” para conciliar.

**Alternativas consideradas:** reservar o ID da mensagem antes do upload (exigiria estado parcial no
banco) ou nomear com UUID aleatório (uma retentativa deixaria o objeto anterior órfão).

**Impactos e limitações:** se o upload funcionar e o registro da mensagem falhar, a rota remove o
objeto recém-enviado antes de responder o erro. O caminho contém IDs, mas o bucket é privado e o
`audio_path` nunca sai do servidor.

## Funções SQL e migrações

A migração da fase 1 cria e restringe ao `service_role`:

- `chat_direct_key`;
- `chat_get_or_create_direct`;
- `chat_send_message`;
- `chat_list_conversations`;
- `chat_list_messages`;
- `chat_unread_count`;
- `chat_mark_read`;
- triggers de broadcast e de integridade de participantes.

A migração da fase 2 substitui `chat_send_message`, `chat_list_messages`, `chat_list_conversations` e
`chat_unread_count` e acrescenta, todas restritas ao `service_role`:

- `chat_edit_message(usuario, mensagem, conteudo, janela_segundos)`;
- `chat_delete_message_for_me(usuario, mensagem)`;
- `chat_delete_message_for_everyone(usuario, mensagem, janela_segundos)`;
- `chat_set_reaction(usuario, mensagem, reacao)` e `chat_clear_reaction(usuario, mensagem)`;
- `chat_audio_access(usuario, mensagem)`;
- `chat_marcar_foco(usuario, conversa, segundos)`;
- `chat_push_target(mensagem)`;
- auxiliares `chat_broadcast_para_participantes` e `chat_reacoes_da_mensagem`;
- triggers `chat_mensagem_broadcast_after_update` e `chat_reacao_broadcast`.

`chat_send_message` teve a assinatura de 4 argumentos **removida e substituída** por uma de 10, com
`p_tipo`, `p_reply_to_message_id` e os quatro metadados do áudio como parâmetros opcionais. Chamadas
posicionais de 4 argumentos continuam válidas pelos defaults, o que preserva os testes da fase 1. A
função nunca teve chamador fora do `service_role`.

As janelas de 15 minutos chegam ao SQL como parâmetro vindo das constantes de
[`contracts.ts`](../../src/lib/chat/contracts.ts), mas **quem recusa é o banco**: nenhuma decisão de
prazo depende do relógio do navegador.

Somente `chat_realtime_topic_allowed(text)` pode ser executada por `authenticated`; ela devolve um
booleano usado pela política de canais e não expõe linhas. Migrações aplicadas nunca devem ser
editadas; evoluções exigem novo arquivo em `supabase/migrations`.

A migração inicial usa criação condicional para tabelas, índices, FK tardia e recriação controlada de
triggers. Isso permite registrar com segurança a versão na Demonstração quando o mesmo schema vazio já
existe sem entrada no histórico. Essa tolerância é uma recuperação específica da migração inicial e não
substitui a regra de criar novas migrações depois que a versão estiver aplicada.

**Situação de implantação em 2026-08-28:** `20260825190000_chat_interno_fase_1.sql` está aplicada na
Demonstração. `20260828120000_chat_interno_fase_2.sql` foi validada contra a Demonstração em transação
revertida (`npm run db:test:chat-fase2`) mas **ainda não foi aplicada em nenhum banco**. Demonstração,
Demir, AlphaGarage e Garage Premium devem seguir a ordem do procedimento multibanco em
[`docs/database-migrations.md`](../database-migrations.md); Demir, AlphaGarage e Garage Premium também
seguem com a fase 1 pendente.

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

Regras acrescentadas pela fase 2:

- somente o autor edita a própria mensagem, e somente `TEXT`;
- somente o autor exclui para todos; qualquer participante oculta apenas para si;
- o prazo de 15 minutos é decidido no SQL, com `clock_timestamp()` do banco;
- a reação precisa pertencer ao conjunto permitido — validado no SQL, não no que o cliente enviou;
- a citação só é aceita se apontar para mensagem viva, da mesma conversa e visível para quem responde;
- o MIME do áudio é conferido contra a lista permitida e a extensão é derivada dele, nunca do nome do
  arquivo; o tamanho real do buffer é medido no servidor e o bucket ainda repete o limite;
- o áudio é liberado por URL assinada de 5 minutos, emitida só depois de o SQL confirmar participação,
  tipo `VOICE`, ausência de exclusão para todos e ausência de ocultação para aquele usuário;
- `audio_path` nunca aparece em nenhuma resposta pública;
- a subscription de push pertence ao usuário autenticado da sessão; o endpoint informado é apenas
  localizado pelo hash dentro das linhas daquele usuário;
- o push nunca é enviado ao próprio remetente — `chat_push_target` só devolve o outro participante;
- nenhum log escreve áudio, endpoint, chaves de subscription, chave VAPID ou conteúdo de mensagem: as
  falhas de envio registram apenas o status HTTP.

### Proteção contra abuso

**Implementado:** limite de 5.000 caracteres por mensagem, 5 minutos e 10 MB por áudio (validados na
aplicação, na constraint da tabela e no próprio bucket), no máximo uma reação por usuário por
mensagem, no máximo 20 subscriptions ativas por usuário e janela de 15 minutos para edição e exclusão
para todos.

**Limitação conhecida:** não existe rate limit por quantidade de mensagens, reações, alterações ou
inscrições no tempo. O único rate limiting do ERP hoje é o de login
([`login-rate-limit.ts`](../../src/lib/login-rate-limit.ts)), construído sobre funções SQL específicas
de autenticação. Estendê-lo ao chat exigiria infraestrutura nova, o que esta fase deliberadamente não
introduziu; todas as rotas continuam exigindo sessão ativa e participação na conversa.

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
| `POST /api/chat/conversations/:id/messages` | `{ content, clientMessageId, replyToMessageId? }` | `{ message, created }`, 200/201 |
| `POST /api/chat/conversations/:id/messages/voice` | multipart: `audio`, `clientMessageId`, `durationMs`, `replyToMessageId?` | `{ message, created }`, 200/201 |
| `POST /api/chat/conversations/:id/read` | `{ lastMessageId }` | cursor, contadores local/global |
| `POST /api/chat/conversations/:id/focus` | `{ active: boolean }` | `{ ok: true }` |
| `PATCH /api/chat/messages/:id` | `{ content }` | `{ messageId, conversationId, content, editedAt }` |
| `DELETE /api/chat/messages/:id/for-me` | — | `{ messageId, conversationId }` |
| `DELETE /api/chat/messages/:id/for-everyone` | — | `{ messageId, conversationId, deletedForEveryoneAt }` |
| `PUT /api/chat/messages/:id/reaction` | `{ reaction }` | `{ messageId, conversationId, reactions }` |
| `DELETE /api/chat/messages/:id/reaction` | — | `{ messageId, conversationId, reactions }` |
| `GET /api/chat/audio/:messageId` | — | `{ url, expiresAt, mimeType, durationMs }` |
| `GET /api/chat/push/status` | — | `{ supported, vapidPublicKey, deviceCount }` |
| `POST /api/chat/push/subscriptions` | `{ endpoint, keys:{p256dh,auth}, deviceLabel? }` | status, 201 |
| `DELETE /api/chat/push/subscriptions` | `{ endpoint }` | status |

A resposta citada foi incorporada às rotas de criação de mensagem em vez de ganhar rota própria.

Tipos públicos estão em [`contracts.ts`](../../src/lib/chat/contracts.ts). Erros previsíveis usam
códigos `CHAT_*`; 400/403 são definitivos para reenvio, enquanto rede, 408, 429 e 5xx são temporários.

Códigos acrescentados pela fase 2 e o status correspondente:

| Código | Status | Quando ocorre |
|---|---|---|
| `CHAT_INVALID_REPLY_TARGET` | 400 | citação de outra conversa, inexistente, oculta ou já excluída |
| `CHAT_INVALID_REACTION` | 400 | reação fora do conjunto permitido |
| `CHAT_INVALID_AUDIO` / `CHAT_INVALID_AUDIO_TYPE` | 400 | áudio ausente, vazio ou MIME não aceito |
| `CHAT_AUDIO_TOO_LONG` | 400 | duração acima de 5 minutos |
| `CHAT_AUDIO_TOO_LARGE` | 413 | arquivo acima de 10 MB |
| `CHAT_MESSAGE_NOT_FOUND` | 404 | mensagem inexistente |
| `CHAT_AUDIO_UNAVAILABLE` | 404 | áudio excluído, oculto ou de mensagem que não é de voz |
| `CHAT_EDIT_WINDOW_EXPIRED` / `CHAT_DELETE_WINDOW_EXPIRED` | 409 | prazo de 15 minutos vencido |
| `CHAT_MESSAGE_NOT_EDITABLE` | 409 | voz ou mensagem já excluída para todos |
| `CHAT_MESSAGE_UNAVAILABLE` | 409 | reação em mensagem excluída ou oculta |
| `CHAT_PUSH_NOT_CONFIGURED` | 503 | VAPID ausente no servidor |

Os 409 são deliberadamente definitivos: a interface mostra o motivo em vez de oferecer “tentar
novamente” para algo que nunca vai passar.

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

A fase 2 acrescentou dois filtros ao mesmo cálculo, sem mudar o cursor: mensagens ocultas para aquele
usuário e mensagens excluídas para todos não contam. Como o cursor continua sendo `(created_at, id)`,
ele permanece válido mesmo apontando para uma mensagem que depois foi excluída. A prévia da inbox
também respeita a ocultação e passou a devolver `tipo` e um sinalizador de exclusão, para exibir
“Mensagem de voz” ou “Mensagem excluída” em vez de texto vazio.

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
para Presence no tópico global. O cliente cria os canais com `private: true` e mantém o token válido
pelo `realtime.accessToken` descrito em [Token do Realtime](#token-do-realtime) — `setAuth(token)` no
início da conexão sozinho não basta.

Triggers de mensagem e leitura enviam payload mínimo. Ao receber, o frontend reconsulta contador,
resumo e, quando aplicável, a página recente da conversa. Assim o WebSocket não é fonte de verdade.

A fase 2 mantém exatamente esse desenho e acrescenta dois tipos de evento, ambos com payload mínimo:

| `kind` | Origem | Campos |
|---|---|---|
| `message` | insert em `chat_mensagem` | `conversationId`, `messageId`, `senderId`, `clientMessageId`, `messageType` |
| `message-updated` | update em `chat_mensagem` (edição/exclusão para todos) | `conversationId`, `messageId`, `senderId` |
| `reaction` | insert/update/delete em `chat_reacao` | `conversationId`, `messageId` |

Nenhum deles carrega conteúdo, reação escolhida, nome ou caminho de áudio: a conversa aberta reconsulta
a página recente por HTTP e reconcilia por `id` / `senderId + clientMessageId`, como na fase 1.

“Excluir para mim” **não** é transmitido ao outro participante: `chat_delete_message_for_me` envia o
broadcast apenas para o tópico de quem excluiu, para que as outras abas e dispositivos do próprio
usuário acompanhem. Ao reconciliar, a conversa remove da lista local as mensagens que o servidor
deixou de devolver dentro da janela recarregada, preservando otimistas e falhas.

Depois de reconectar, a mesma revalidação por HTTP traz reações, edições e exclusões junto com as
mensagens novas — não existe caminho separado para elas.

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

`CHANNEL_ERROR`, `TIMED_OUT` ou `CLOSED` no canal de mensagens marca `disconnected` sem apagar cache,
mensagens ou falhas otimistas, e agenda uma reconexão própria com espera crescente — 1s, 2s, 4s, 8s,
16s e teto de 30s ([`nextReconnectDelay`](../../src/components/chat/chat-utils.ts)). Cada tentativa
**destrói e recria os dois canais**: o `subscribe()` do realtime-js só age sobre canal fechado, então
reassinar um canal em erro não recupera nada. Foco, aba visível e evento `online` continuam revalidando
por HTTP e, quando o status é `disconnected`, também encurtam o backoff pedindo tentativa imediata — o
mesmo que faz o botão “Tentar reconectar” do aviso. `unavailable` (segredo ausente no servidor) não
retenta, porque nenhuma tentativa passaria. Todos os timers, listeners, `untrack` e canais são limpos
no unmount.

O status é escrito **somente** pelo canal `chat:user:<id>`. A presença tem falha independente: quando
ela cai, as bolinhas voltam para offline e a reconexão é agendada, mas o aviso não aparece — perder
presença não significa que mensagens pararam de chegar. Antes, um `handleStatus` compartilhado deixava
o último canal a falar decidir, o que tanto exibia o aviso com as mensagens fluindo quanto o escondia
com o canal de mensagens morto.

O aviso só aparece depois de ~2,5s ininterruptos sem conexão, para que uma oscilação curta não o faça
piscar, e some no mesmo instante em que o canal volta a `SUBSCRIBED`.

#### Token do Realtime

Os dois canais são `private: true` e o servidor valida a cada join o JWT de
[`/api/chat/realtime-token`](../../src/app/api/chat/realtime-token/route.ts). Esse token **não pode**
ser entregue só uma vez com `realtime.setAuth(token)`: o `subscribe()` do realtime-js chama
`socket.setAuth()` sem argumento em todo join bem-sucedido, e o `SupabaseClient` responde a essa
chamada com o anon key quando não há sessão do Supabase Auth — substituindo o token do chat no payload
de rejoin de todos os canais. O efeito era silencioso e fatal: tudo funcionava até a primeira oscilação
de rede, e a partir daí todo rejoin era recusado, em laço, até o reload da página.

Por isso o cliente é criado com [`chatRealtimeAccessToken`](../../src/lib/chat/realtime-token.ts) em
`realtime.accessToken` ([`supabase-browser.ts`](../../src/lib/supabase-browser.ts)) — é esse módulo que
responde àquela chamada interna, devolvendo o token em cache e renovando quando falta menos de 60s para
expirar. Fica dentro de `realtime` de propósito: na raiz das opções trocaria também o token de
REST/Storage e transformaria `supabase.auth` em um Proxy que lança.

#### Modo degradado

Com o chat aberto, o status em `disconnected` e a aba visível, o provider relê contador e conversas a
cada 15 segundos e a conversa aberta reconcilia a página recente pelo mesmo caminho do evento Realtime
(`fetchMessages` + `mergeChatMessages`, preservando otimistas e falhas). O intervalo para sozinho ao
reconectar, ao fechar o painel ou ao esconder a aba — fora dessas três condições não há polling.

## Resposta citada

**Implementado.** O menu de qualquer mensagem viva oferece `Responder`. A escolha guarda a mensagem
como referência, mostra uma prévia acima do composer com o autor e um trecho — ou “Mensagem de voz” —
e um botão para cancelar. O envio leva apenas o `replyToMessageId`.

No balão, a citação aparece como uma área compacta com autor e trecho, com ícone de microfone quando
o original é voz. Clicar nela procura a mensagem original na timeline; se ela ainda não estiver
carregada, a conversa busca páginas anteriores (até 20) até encontrá-la, rola até o centro e aplica um
destaque temporário de ~2,6 s. Se a mensagem não aparecer, a conversa informa que ela não está mais
disponível em vez de falhar em silêncio.

**Decisão:** a resposta guarda o ID **e** um recorte histórico gravado pelo servidor
(`reply_snapshot_tipo`, `reply_snapshot_conteudo` limitado a 160 caracteres e
`reply_snapshot_remetente_nome`).

**Motivo:** a citação precisa continuar compreensível depois de o original ser editado ou excluído.
Com o conteúdo atual, uma edição reescreveria o passado e uma exclusão apagaria o contexto da resposta.

**Alternativas consideradas:** guardar só o ID e resolver o conteúdo na leitura (a citação mudaria
sozinha) ou deixar o cliente enviar o recorte (o navegador passaria a declarar autoria e conteúdo
alheios).

**Impactos e limitações:** o recorte é uma cópia; se o original for editado, a citação continua
mostrando o texto de quando a resposta foi escrita. Quando o original é excluído para todos, o recorte
da resposta é preservado, mas o balão do original passa a exibir “Mensagem excluída”. Uma citação cujo
`reply_snapshot_conteudo` está vazio e não é voz é renderizada como “Mensagem excluída”.

O servidor recusa citação de mensagem de outra conversa, inexistente, já excluída para todos ou oculta
para quem responde (`CHAT_INVALID_REPLY_TARGET`). O nome e o trecho **nunca** vêm do cliente.

## Reações

**Implementado.** Somente quatro reações, sem seletor de emojis:

```text
❤️ CORACAO   👍 LEGAL   😄 FELIZ   😢 TRISTE
```

Um botão `SmilePlus` separado fica fora do balão e voltado para o centro da timeline — antes do balão
nas mensagens próprias e depois dele nas recebidas. Ele abre um `Popover` compacto contendo somente
as quatro opções; as reações não fazem parte do dropdown textual. Cada usuário tem no máximo uma
reação por mensagem: escolher outra substitui a anterior e clicar de novo na atual remove.

As reações aplicadas aparecem em chips compactos conectados visualmente à base do balão
(`❤️ 2 👍 3 😄 1`), com borda/sombra discreta, destaque visual e `aria-pressed` na escolha do usuário
atual. Os chips continuam clicáveis e usam a mesma atualização otimista do seletor.

A atualização é otimista e reconciliada com o agregado autorizado que o SQL devolve; uma falha restaura
o estado anterior e mostra um erro local, sem notificação global. O evento `reaction` atualiza o outro
participante em tempo real e o agregado sobrevive ao recarregamento porque vem do banco.

Reagir não altera o estado de leitura: `chat_set_reaction` não toca no cursor do participante.

**Decisão:** ao excluir para todos, as reações da mensagem são **removidas**, não apenas ocultadas.

**Motivo:** a mensagem deixa de ter conteúdo; manter reações preservaria um sinal sobre algo que já
não existe para nenhum dos dois participantes.

**Impactos e limitações:** a remoção é definitiva. Mensagens excluídas para todos também não aceitam
novas reações (`CHAT_MESSAGE_UNAVAILABLE`).

**Limitação conhecida:** não existe interface mostrando **quem** reagiu. O balão traz apenas a
contagem por reação e a marcação da própria.

## Edição de mensagens

**Implementado.** O remetente edita a própria mensagem de texto dentro de **15 minutos**
(`CHAT_MESSAGE_EDIT_WINDOW_SECONDS`, em [`contracts.ts`](../../src/lib/chat/contracts.ts)). Não é
possível editar mensagem de outro usuário, mensagem de voz, mensagem já excluída para todos, mensagem
inacessível ou de outra conversa — e o menu simplesmente não oferece a ação nesses casos.

O editor é o próprio composer: ele carrega o conteúdo atual, exibe a faixa “Editando mensagem”, aceita
`Esc` para cancelar, preserva quebras de linha, recusa conteúdo vazio, aplica o mesmo limite de 5.000
caracteres e mostra estado de salvamento. Se a operação falhar, o conteúdo anterior permanece na
timeline e o editor continua aberto com a mensagem de erro.

Depois de salva, a mensagem exibe “editada” ao lado do horário, para os dois participantes, em tempo
real.

A edição **não** cria mensagem nova, **não** altera `created_at`, **não** move a conversa para o topo
(`last_message_at` fica intocado), **não** incrementa o contador de quem já leu e **não** dispara Web
Push — o push só é chamado quando `chat_send_message` realmente insere uma linha.

O conteúdo anterior é preservado em `chat_mensagem_edicao` para auditoria, diagnóstico e contexto.
**Limitação conhecida:** não existe tela para esse histórico nesta fase e nenhuma rota o expõe.

## Exclusão de mensagens

**Implementado.** Duas ações distintas.

### Excluir para mim

Qualquer participante oculta uma mensagem apenas na própria visualização. A linha em `chat_mensagem`
permanece; o que existe é um registro em `chat_mensagem_oculta`. A mensagem some de
`chat_list_messages`, do resumo da inbox e da contagem de não lidas **daquele** usuário, sem afetar o
outro. O arquivo de voz não é apagado, porque o outro participante ainda pode ouvi-lo. Respostas que
citem a mensagem continuam válidas, porque a citação vive do recorte histórico.

### Excluir para todos

Somente o remetente, dentro de **15 minutos** (mesma constante da edição), validado no servidor. A
exclusão é lógica: a linha permanece com `excluida_para_todos_em` e `excluida_para_todos_por`, o
conteúdo é esvaziado, o recorte de citação é limpo, os metadados de áudio são zerados e as reações são
apagadas. Os dois participantes passam a ver “Mensagem excluída” em tempo real, e a interface confirma
com um diálogo acessível antes de executar.

A mensagem excluída não aceita edição, nem novas reações, nem ser citada.

### Áudio da mensagem excluída

`chat_delete_message_for_everyone` move o `audio_path` para `chat_audio_pendente_remocao` e o remove da
mensagem na mesma transação. A partir desse instante `chat_audio_access` recusa o pedido
(`CHAT_AUDIO_UNAVAILABLE`), então nenhuma nova reprodução é possível e nenhuma URL assinada é emitida —
as assinaturas já entregues expiram em até 5 minutos e nunca houve URL pública permanente.

Em seguida, ainda na mesma requisição, a rota apaga o objeto do Storage e remove a linha da fila.

**Decisão:** remoção física imediata, com fila persistente como rede de segurança.

**Motivo:** o áudio precisa sumir o quanto antes, mas o Postgres não consegue apagar objetos do
Storage. A fila garante que uma falha do Storage fique registrada em vez de virar um arquivo esquecido
e desconhecido.

**Impactos e limitações:** se o Storage falhar, o áudio continua inacessível pela aplicação, mas o
objeto permanece no bucket privado até uma limpeza. **Não existe rotina agendada** esvaziando
`chat_audio_pendente_remocao` nesta fase; ela é o insumo para essa rotina.

### Menu por mensagem

O gatilho do dropdown é um chevron real **dentro do canto superior direito do balão**, com espaço
reservado no conteúdo para não cobrir texto, citação, horário ou player. No desktop ele fica
visualmente oculto no repouso e aparece em `hover`, `focus-within` ou enquanto o menu está aberto; a
opacidade não o remove da árvore de acessibilidade, então o foco por teclado também o revela.

O dropdown contém somente ações textuais/contextuais e separa as exclusões das ações de composição.
O botão de reação é outro controle, fora do balão, descrito em [Reações](#reações). A disponibilidade
permanece derivada das mesmas regras do servidor:

| Situação | Ações oferecidas |
|---|---|
| própria, texto, dentro do prazo | Responder, Editar, Excluir para mim, Excluir para todos |
| própria, voz, dentro do prazo | Responder, Excluir para mim, Excluir para todos |
| própria, fora do prazo | Responder, Excluir para mim |
| recebida | Responder, Excluir para mim |
| excluída para todos | Excluir para mim |
| ainda enviando ou com falha | nenhuma (o balão oferece “Tentar novamente”) |

No touch/PWA, um toque curto na área neutra do balão seleciona temporariamente a mensagem e revela o
chevron interno e o botão externo de reação. A timeline mede o deslocamento do ponteiro: rolagem não
seleciona e já remove uma seleção aberta. Toques em player, barra de progresso, links, citação, chips
de reação e retentativa são ignorados pelo seletor; tocar no canvas da timeline remove a seleção.
Abrir menu ou reações a mantém, e fechar a superfície a remove quando apropriado.

## Mensagens de voz

**Implementado.** O composer tem um botão de microfone que aparece quando não há texto digitado e
quando `MediaRecorder`, `getUserMedia` e contexto seguro estão disponíveis.

### Permissão

A permissão do microfone é pedida **somente** depois do clique no botão — nunca ao abrir o ERP ou o
chat. O cabeçalho `Permissions-Policy` do projeto passou de `microphone=()` para `microphone=(self)`;
sem essa mudança o navegador bloquearia a captura antes mesmo do pedido. Câmera e localização
continuam bloqueadas.

Erros recebem mensagem específica e acessível: permissão negada, microfone não encontrado, microfone
em uso por outro aplicativo, navegador sem suporte e interrupção durante a gravação. Esconder a aba ou
fechar a tela (`visibilitychange`, `pagehide`) encerra a gravação e leva para a revisão, em vez de
perder o áudio silenciosamente.

### Fluxo

```text
Gravar → Parar → Ouvir → Enviar ou descartar
```

Parar **não** envia. O modo de gravação mostra indicador pulsante, rótulo textual “Gravando”, a
duração corrente e um `aria-live` que anuncia o estado; depois de parar, oferece prévia, descarte e
envio. Ao alcançar a duração máxima a gravação para sozinha e vai para a revisão.

### Limites e formatos

```text
duração máxima: 5 minutos   (CHAT_VOICE_MAX_DURATION_MS)
tamanho máximo: 10 MB       (CHAT_VOICE_MAX_BYTES)
```

Ambos estão em [`contracts.ts`](../../src/lib/chat/contracts.ts) e são repetidos como constraint em
`chat_mensagem` e como limite do bucket. O gravador escolhe o primeiro formato suportado entre
`audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, `audio/ogg` e `audio/mp4` — o Safari
normalmente produz `audio/mp4` e o Chrome, `audio/webm`. O servidor aceita `audio/webm`, `audio/ogg`,
`audio/mp4`, `audio/mpeg` e `audio/aac`, sempre pelo MIME conferido e nunca pela extensão do arquivo.
A duração é validada como valor declarado; o tamanho e o MIME são medidos no servidor.

### Envio consistente

1. o navegador gera o `client_message_id` e insere a bolha otimista com a prévia local;
2. a rota confere sessão, participação, MIME, tamanho e duração;
3. o áudio sobe para `chat_audio` no caminho determinístico, com `upsert`;
4. `chat_send_message` registra a mensagem `VOICE`;
5. se o passo 4 falhar, a rota remove o objeto recém-enviado antes de responder o erro.

Uma retentativa reenvia o mesmo `client_message_id`, sobrescreve o mesmo objeto e recebe de volta a
mesma mensagem: nada duplica.

### Player

O balão de voz não usa o `<audio>` padrão: traz botão reproduzir/pausar com rótulo acessível, uma
barra de progresso tematizada e operável por teclado (`input[type=range]` com `aria-valuetext`), tempo
restante, horário, carregamento, erro com retentativa, estado `sending/sent/failed` e área de toque de
40 px. O balão reserva o canto superior do menu sem cobrir o player. Um registro em módulo garante que
**apenas um áudio toca por vez** — iniciar outro pausa o anterior — e o elemento é parado e liberado ao
desmontar. Enquanto o envio não é confirmado, a reprodução usa o blob local; depois, a URL assinada.

## Notificações Web Push

**Implementado**, exclusivamente para mensagens novas do chat.

### Consentimento

A permissão **nunca** é pedida no carregamento do ERP. A inbox mostra um painel “Ativar notificações
do chat” que explica antes de perguntar: para que serve, que os avisos chegam com o ERP fechado, que
mostram o nome do remetente e uma prévia curta, que valem só para aquele dispositivo e que podem ser
desativados ali mesmo. Só o clique chama `Notification.requestPermission()`.

Os quatro estados são tratados: `default` (oferece ativar), `granted` (mostra ativo e permite
desativar), `denied` (explica que a autorização precisa ser alterada nas configurações do navegador ou
do sistema, **sem insistir**) e não suportado (explica o motivo detectado).

### Plataformas

A detecção é por recurso — `isSecureContext`, `Notification`, `serviceWorker`, `PushManager` — e não
por user agent. O user agent é consultado apenas para **explicar** o requisito do iOS/iPadOS.

- **iPhone e iPad:** o Web Push exige o ERP adicionado à Tela de Início (iOS/iPadOS 16.4+) e a
  permissão precisa ser concedida dentro do PWA instalado. No Safari comum a interface orienta a
  instalação em vez de prometer entrega. O iPadOS moderno se identifica como Macintosh, então a
  detecção considera `maxTouchPoints`.
- **Android:** funciona no PWA instalado e nos navegadores que expõem `PushManager`.
- **Desktop:** usa o service worker e as permissões do navegador; navegadores sem suporte recebem a
  explicação.

### Service worker

O service worker do `@ducanh2912/next-pwa` **não** foi substituído nem duplicado. A fase 2 usa o
recurso de custom worker: [`worker/index.js`](../../worker/index.js) é compilado para
`public/worker-<hash>.js` e importado pelo `sw.js` gerado. O `runtimeCaching` existente, o
`NetworkOnly` das rotas `/api`, o funcionamento offline, a instalação do PWA e o `skipWaiting`
permanecem exatamente como estavam.

O custom worker trata `push` (valida o payload, ignora o que não for `chat_message` e chama
`showNotification` com `tag` por conversa e `renotify`) e `notificationclick` (procura uma janela do
ERP na mesma origem, foca e envia `postMessage`; se não houver nenhuma, abre o deep link).

### Assinaturas

Cada usuário pode ter várias subscriptions. A unicidade é por `endpoint_hash`, e o teto é de 20
dispositivos ativos (`CHAT_PUSH_MAX_DEVICES`); ao ultrapassar, as mais antigas são revogadas.
Respostas `404` ou `410` do serviço de push revogam a subscription automaticamente no envio seguinte.

**Estratégia na saída da conta:** nada é excluído automaticamente. O botão “Desativar neste
dispositivo” cancela a subscription do navegador atual e revoga apenas aquela linha; celular, tablet e
outros navegadores do mesmo usuário continuam recebendo. Sair da conta sem desativar mantém a
subscription registrada — o próximo push para aquele usuário continua chegando naquele dispositivo até
que ele desative ou o serviço de push responda `404/410`.

### VAPID

```text
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_SUBJECT
```

Gere o par uma vez por instalação com `npx web-push generate-vapid-keys` e guarde no `.env` do
projeto. O exemplo sem segredos está em [`webpush.env.example`](../../webpush.env.example) e a seção
opcional foi adicionada a [`docs/INSTALLATION.md`](../INSTALLATION.md). A chave privada **nunca** pode
ser prefixada com `NEXT_PUBLIC_` e segredos não são versionados.

Sem as três variáveis o Web Push fica inteiramente desligado: `GET /api/chat/push/status` devolve
`supported: false`, a interface não oferece ativação, `POST /api/chat/push/subscriptions` responde
`503 CHAT_PUSH_NOT_CONFIGURED` e nenhum envio é tentado. O restante do chat funciona normalmente.

### Momento de disparo

O push é enviado somente **depois** de a mensagem ter sido persistida, e apenas quando
`chat_send_message` de fato criou uma linha (`created = true`). O disparo roda em `after()` do Next,
fora do caminho da resposta. Portanto **não** há push para o próprio remetente, edição, reação,
marcação de leitura, exclusão, retentativa idempotente que não criou mensagem nem evento duplicado do
Realtime.

### Supressão

**Decisão:** a supressão é decidida no servidor, a partir de um foco confirmado pelo destinatário e com
prazo de validade.

Enquanto a conversa está aberta, a aba visível e o Realtime conectado, a conversa chama
`POST /api/chat/conversations/:id/focus` a cada 25 segundos, e `chat_marcar_foco` grava
`chat_participante.foco_ate = now() + 60s`. `chat_push_target` marca `suprimido = true` enquanto essa
janela vale, e o disparo é abortado. Fechar a conversa, esconder a aba, perder o Realtime ou
desmontar o componente limpa o foco.

**Motivo:** só o servidor pode decidir com segurança, e as três condições precisam ser afirmadas pelo
destinatário. Uma janela curta que expira sozinha faz o sistema errar para o lado da entrega: se o
cliente sumir, o push volta a ser enviado.

**Alternativas consideradas:** decidir no service worker consultando `clients.matchAll()` — ele não
sabe qual conversa está aberta e pushes silenciosos consomem o orçamento do navegador, que pode exibir
um aviso genérico no lugar; ou não suprimir nada — o destinatário receberia notificação de mensagens
que está lendo naquele instante.

**Impactos e limitações:** cada conversa aberta gera uma requisição leve a cada 25 s enquanto a aba
está visível. Uma mensagem que chegue nos segundos entre o usuário fechar a aba e a janela expirar
pode ser suprimida indevidamente — o contador de não lidas continua correto e o toast interno cobre o
caso oposto.

### Conteúdo

```text
Texto:  título = nome do remetente | corpo = prévia de até 140 caracteres
Voz:    título = nome do remetente | corpo = "Enviou uma mensagem de voz"
```

A prévia é sanitizada: controles e marcas invisíveis são removidos, espaços são colapsados e o texto é
truncado. O payload carrega somente:

```ts
{ type: "chat_message", conversationId, messageId, url, title, body }
```

Nenhum token, ID desnecessário, dado administrativo ou caminho de áudio.

### Clique na notificação

O clique procura uma janela já aberta do ERP na mesma origem e a foca, enviando
`{ type: "chat-open-conversation", conversationId, messageId }`. Sem janela aberta, abre
`/?chat=<conversationId>&message=<messageId>`.

Em ambos os casos o parâmetro apenas **orienta** a interface: o provider abre o `ChatCenter`, procura
a conversa entre as que a API devolveu e, ao encontrá-la, pede o destaque da mensagem. Se a conversa
não pertencer ao usuário ela nunca aparece na lista e o pedido é descartado depois de duas tentativas —
o `conversationId` recebido pelo service worker **não** é tratado como autorização. Na partida fria os
parâmetros são removidos da URL com `history.replaceState` logo após serem lidos, para não reabrir a
conversa a cada render.

### Contador do ícone

O Web Push não substitui o contador de não lidas, que continua sendo a sinalização global dentro do
ERP. Abrir a aplicação por uma notificação revalida o contador e carrega a conversa; a leitura só é
marcada pelas regras já existentes (fim da timeline visível, aba visível, debounce de 300 ms). Nenhum
contador é zerado antecipadamente.

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

Na fase 2, cada operação escolheu o comportamento adequado ao risco:

| Operação | Estratégia | Em caso de falha |
|---|---|---|
| mensagem com citação | otimista, citação junto | mantém mensagem e citação, permite tentar novamente sem duplicar |
| mensagem de voz | otimista, com prévia local tocável | mantém a bolha e o blob em memória, permite tentar novamente com o mesmo `client_message_id` |
| reação | otimista, com agregado local coerente | restaura o estado anterior e mostra erro local, sem toast global |
| edição | confirmação do servidor | mantém o conteúdo anterior e deixa o editor aberto com a mensagem de erro |
| exclusão para todos | confirmação do servidor | mantém a mensagem intacta e mostra erro local |

A gravação pendente vive num `Map` por `client_message_id` dentro da conversa aberta. Ela não
sobrevive ao recarregamento da página: nesse caso a bolha passa a `retryable: false` e explica que a
gravação foi perdida, em vez de oferecer uma retentativa que falharia. Os `blob:` criados para a
prévia são revogados ao trocar de conversa ou desmontar.

## Responsividade e acessibilidade

No desktop o Sheet tem no máximo 430 px. Em telas menores usa toda a largura e `100dvh`. Header,
timeline/lista e composer têm rolagens independentes; o overlay Radix bloqueia o body. O composer usa
`env(safe-area-inset-bottom)`, área de toque de 40 px e permanece no fluxo flexível para o teclado.

O Sheet possui título/descrição para leitor de tela e devolve foco ao trigger. Botões de ícone têm
`aria-label`; loading/error/read usam rótulos ou regiões apropriadas; presença tem texto acessível;
mensagens podem ser selecionadas e preservam linhas. O conteúdo usa tokens de tema shadcn.

Os elementos da fase 2 seguem as mesmas regras. A prévia de resposta, a faixa de edição e o modo de
gravação vivem **dentro** do dock do composer, acima da mesma superfície: entram e saem animando
altura, continuam no fluxo flexível, respeitam `env(safe-area-inset-bottom)` e não empurram o composer
para fora da tela, não criam rolagem dupla nem cobrem o botão de enviar com o teclado virtual aberto. O
contador de caracteres é ocultado enquanto o modo de gravação está ativo, para não competir por altura.
A faixa de resposta usa marcador violeta e `Reply`; a edição usa marcador neutro, `Pencil`, título e
trecho truncado. O gravador permanece visível durante o envio para mostrar o estado “Enviando” e fecha
quando a tentativa termina.

Controles de mensagem não dependem de hover: teclado usa `focus-within` e touch usa seleção por toque
curto na área neutra do balão. Nenhum `preventDefault` é aplicado ao gesto, preservando scroll vertical
e seleção/cópia de texto; controles interativos são explicitamente excluídos da seleção contextual.

Acessibilidade específica:

- microfone, parar, descartar, ouvir, enviar, reproduzir/pausar e o menu da mensagem têm `aria-label`;
- o estado de gravação é anunciado por `aria-live` e representado por texto (“Gravando”) e duração,
  não apenas pela cor do ponto pulsante — que some com `prefers-reduced-motion`;
- o chevron interno usa `aria-label="Ações da mensagem"`; o botão externo usa
  `aria-label="Adicionar reação"`; ambos permanecem na ordem de tabulação quando transparentes e o
  foco os torna visíveis;
- as quatro reações do `Popover` têm nome acessível (“Reagir com coração/legal/feliz/triste”) e
  `aria-pressed`, sem depender só do emoji; as reações agrupadas anunciam nome, total e se incluem a do
  usuário;
- a barra de progresso do áudio é um `input[type=range]` operável por teclado, com `aria-valuetext` em
  minutos e segundos;
- `Esc` fecha dropdown/popover com retorno ao gatilho correto e também cancela a edição; o foco volta ao
  composer ao entrar no modo correspondente;
- a exclusão para todos usa `AlertDialog`, com título, descrição e ação de cancelar;
- erros de gravação, envio, edição, exclusão e reação usam `role="alert"`.

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

O refinamento visual da fase 2 mantém essa identidade e limpa a timeline: o chevron de ações usa uma
pequena superfície coerente com a cor do próprio balão e aparece por opacity/scale sem deslocar o
texto; o `SmilePlus` fica numa superfície neutra fora do balão e voltada para o centro. O seletor é um
`Popover` arredondado restrito às quatro reações, enquanto o dropdown permanece textual e compacto.
Chips aplicados se sobrepõem levemente à base do balão, e a citação recebeu marcador violeta, contraste
suave, até duas linhas e foco visível.

Player, gravador e painel de Web Push usam os mesmos tokens `primary`, `card`, `muted`, `background`,
`border`, `destructive` e `muted-foreground`, sem nova paleta. A barra de áudio é customizada em CSS,
os estados do gravador possuem texto/ícone e o Push diferencia disponível, ativando, ativo, negado,
indisponível e erro sem se apresentar como banner global.

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

Os controles contextuais acrescentados na fase 2 também perdem escala/deslocamento em movimento
reduzido. O destaque de citação é uma única transição de ring/brilho, sem piscar nem animar o layout da
lista; a chave visual `senderId + clientMessageId` e toda a estratégia de scroll permanecem inalteradas.

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

Variáveis opcionais:

- `SUPABASE_CHAT_JWT_SECRET`: legacy/shared signing secret aceito pelo projeto Supabase, usado somente
  para emitir token curto quando uma sessão antiga não possui token Supabase. Não usar a service-role
  key como valor e nunca prefixar com `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` e `WEB_PUSH_SUBJECT`: ligam o
  Web Push. Geradas com `npx web-push generate-vapid-keys`; exemplo sem segredos em
  [`webpush.env.example`](../../webpush.env.example). Sem elas o chat funciona por completo e apenas o
  push fica desligado.

O bucket privado `chat_audio` é criado pela migração da fase 2 e não exige configuração manual. O
service worker só é gerado em produção (`next-pwa` desliga o PWA em `next dev`), então a ativação do
push aparece como indisponível em desenvolvimento.

O Supabase Realtime deve estar habilitado. Os canais são explicitamente privados; desabilitar “Allow
public access to channels” no painel é uma defesa adicional recomendada, desde que nenhum módulo
legado dependa de canais públicos.

## Testes e validação

Testes TypeScript/React do módulo:

```powershell
npm run test:chat
```

Os testes de renderização da fase 2 verificam também que o gatilho de ações é interno ao balão e
oculto visualmente no repouso, que o botão de reação é separado e ocupa o lado interno correto, que o
dropdown não possui reação, que mensagem excluída mantém apenas a ação válida e que toque em controle
interno ou deslocamento de scroll não ativa a seleção contextual. Substituição/remoção otimista,
`aria-pressed`, citação, edição, exclusão e player continuam cobertos pelos testes de regressão.

O teste SQL permanente está em [`supabase/tests/chat_fase1.sql`](../../supabase/tests/chat_fase1.sql)
e deve rodar no banco de Demonstração depois da migração:

```powershell
npm run db:test:sql -- supabase/tests/chat_fase1.sql demo
```

Ele usa `BEGIN/ROLLBACK`, cria usuários A/B/C/inativo temporários e verifica autorização,
concorrência lógica da conversa, idempotência, limite, paginação sem lacuna/repetição, contador,
leitura isolada e autorização de tópico. Para migração ainda não aplicada, valide primeiro com o
fluxo de dry-run e execução transacional adotado em [`docs/database-migrations.md`](../database-migrations.md).

O teste SQL da fase 2 está em [`supabase/tests/chat_fase2.sql`](../../supabase/tests/chat_fase2.sql).
Ele também usa `BEGIN/ROLLBACK` e cobre citação (mesma conversa, outra conversa, ID inexistente,
mensagem excluída e recorte histórico), reações (valor válido, valor desconhecido, substituição,
remoção, não participante, restrição única e agregado), edição (autoria, prazo, conteúdo vazio,
histórico, `created_at` intocado e contador de não lidas estável), exclusão para mim (isolamento entre
participantes e preservação do registro), exclusão para todos (autoria, prazo, limpeza de conteúdo e
reações, bloqueio de edição/reação/citação), voz (tipo, metadados obrigatórios, tamanho, duração,
acesso por participante, recusa a não participante, fila de remoção e áudio inacessível após a
exclusão), supressão do push por foco e unicidade das subscriptions.

O runner seguro da própria migração remove e valida seus envelopes transacionais antes de abrir a
transação externa. Ele testa reaplicação sobre o schema atual e instalação sem as tabelas do chat:

```powershell
npm run db:test:chat-migration
npm run db:test:chat-fase2
```

O runner da fase 2 executa quatro cenários: aplicação sobre o schema atual, reaplicação da própria
migração, instalação limpa das duas fases e **regressão dos testes da fase 1 sobre o schema da fase
2** — este último é o que garante que idempotência, paginação, leitura, contador e autorização
continuam iguais depois da mudança de assinatura de `chat_send_message`.

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

Validação manual da fase 2, com dois usuários e, quando possível, dois dispositivos:

1. **Resposta:** A responde uma mensagem de B; B recebe em tempo real; a prévia mostra autor e trecho
   corretos; clicar na citação localiza o original, inclusive carregando páginas anteriores; excluir o
   original para todos não quebra a timeline.
2. **Reação:** A reage com coração; B vê em tempo real; A troca para legal e o coração é substituído;
   A clica de novo em legal e a reação some; recarregar a página mantém o agregado.
3. **Edição:** A envia texto e edita; B vê o novo conteúdo e “editada”; o contador de B não aumenta;
   B não encontra a ação de editar; após 15 minutos a ação desaparece e a API recusa.
4. **Exclusão:** A exclui uma mensagem para si e B continua vendo; A exclui outra para todos e ambos
   veem “Mensagem excluída”; uma mensagem de voz excluída deixa de tocar.
5. **Voz:** A concede o microfone, grava, para, ouve a prévia e envia; B recebe em tempo real e
   reproduz; iniciar outro áudio pausa o anterior; simular falha de rede e tentar novamente não
   duplica.
6. **Push:** B ativa por ação explícita e fecha o PWA; A envia texto e B recebe; clicar abre a
   conversa correta; A envia voz e o corpo mostra “Enviou uma mensagem de voz”; edição e reação não
   geram push; repetir no desktop, no Android/PWA e no iPhone/iPad instalado na Tela de Início.

**Plataformas efetivamente testadas nesta entrega:** nenhuma. As validações automatizadas rodaram
(testes TypeScript, migração e testes SQL contra a Demonstração em transação revertida, lint e build),
mas os itens 1 a 6 acima dependem de dois usuários em navegadores reais e **não foram executados**.
Gravação de microfone, entrega de Web Push no Chrome/Edge desktop, no Android instalado e no
iPhone/iPad na Tela de Início continuam pendentes de verificação manual.

No refinamento visual da fase 2, os testes do chat, o lint restrito aos arquivos alterados e o build de
produção foram executados com sucesso. O lint global continua falhando em regras já existentes fora do
chat (15 erros e 50 avisos nesta execução), sem erro nos arquivos deste refinamento. Não foram geradas
capturas porque o fluxo Playwright exige `.env.capture` e um estado/usuário de captura autenticado,
indisponíveis neste workspace; por isso os tamanhos e temas da matriz visual permanecem pendentes de
conferência em navegador autenticado.

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
- **2026-08-26 — Reconexão do Realtime:** o token do chat deixou de ser sobrescrito pelo anon key nos
  rejoins, o provider ganhou reconexão própria com backoff, o aviso passou a refletir apenas o canal de
  mensagens (com carência de 2,5s e botão “Tentar reconectar”) e o chat aberto passa a reler por HTTP a
  cada 15s enquanto estiver sem Realtime.
- **2026-08-28 — Fase 2:** mensagens de voz com bucket privado e URL assinada curta, resposta citada
  com recorte histórico e navegação até o original, quatro reações em tempo real, edição com janela de
  15 minutos e histórico de auditoria, exclusão para mim e para todos com remoção do áudio, e Web Push
  de novas mensagens com custom worker, supressão por foco confirmado e deep link validado pela API.
  Migração incremental, novas rotas, novos testes TypeScript e SQL, e regressão da fase 1 preservada.
- **2026-08-28 — Refinamento visual da fase 2:** chevron contextual dentro do balão, dropdown textual,
  botão e `Popover` de reação separados, seleção touch sem conflito com scroll/player, chips e citação
  refinados, modos de resposta/edição integrados, player/gravador e painel de Web Push com estados
  visuais próprios; sem alterações de banco, APIs, contratos, Realtime, Presence ou regras funcionais.
