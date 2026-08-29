# IMPLEMENTAÇÃO — CHAT INTERNO DO ERP OFICINA — FASE 1

Implemente a primeira fase do chat interno no projeto:

```text
https://github.com/figodevtech/erpoficina
```

O chat deve fazer parte do próprio ERP, integrado ao header global e à arquitetura existente.

Não crie uma aplicação, página ou sistema separado.

---

# ANTES DE ALTERAR O CÓDIGO

Analise integralmente a arquitetura relacionada à funcionalidade antes de implementar.

Identifique:

1. o layout global atualmente utilizado;
2. o header verdadeiro da aplicação;
3. como o usuário autenticado é obtido;
4. como NextAuth/Auth.js está configurado;
5. como o Supabase e o banco PostgreSQL são acessados;
6. como as migrações de banco são organizadas;
7. como as rotas de API validam autenticação e permissões;
8. como o projeto trata paginação, erros e respostas de API;
9. como os componentes shadcn estão organizados;
10. como o projeto utiliza `Sheet`, `Drawer`, `Avatar`, `ScrollArea`, `Command`, `Button`, `Badge`, `Tooltip` e `Textarea`;
11. como o tema claro e escuro é aplicado;
12. como a responsividade e as áreas seguras do PWA são tratadas;
13. se já existe configuração do Supabase Realtime;
14. se cada instalação possui banco isolado ou se existe algum identificador de empresa/organização.

Reutilize os padrões, componentes, serviços, estilos e convenções atuais.

Não substitua configurações existentes sem necessidade.

Preserve integralmente as funcionalidades atuais do ERP.

---

# ESCOPO EXCLUSIVO DESTA FASE

Implementar somente:

1. conversas individuais;
2. lista de usuários ativos;
3. busca de usuários e conversas;
4. mensagens de texto;
5. atualização em tempo real;
6. contador de mensagens não lidas;
7. marcação de mensagens como lidas;
8. presença online;
9. paginação do histórico;
10. interface responsiva;
11. nova tentativa de envio em caso de falha.

Não implementar nesta fase:

* conversas em grupo;
* anexos;
* imagens;
* vídeos;
* documentos;
* áudios;
* mensagens de voz;
* reações;
* respostas citadas;
* edição de mensagens;
* exclusão de mensagens;
* encaminhamento;
* fixação de conversas;
* silenciamento;
* notificações push;
* notificações do navegador;
* toasts de nova mensagem;
* sons;
* e-mails;
* integração com Telegram;
* cartões de OS, cliente, venda ou produto;
* integração com o futuro módulo de notificações;
* uma página exclusiva de chat.

## Única sinalização global permitida

Por enquanto, a única sinalização de novas mensagens deve ser:

```text
contador de mensagens não lidas no ícone de chat do header
```

Não criar infraestrutura genérica de notificações antecipadamente.

---

# 1. INTEGRAÇÃO COM O HEADER GLOBAL

Adicionar um botão de chat ao header global existente em:

```text
src/app/(app)/(pages)/ClientAppShell.tsx
```

Validar se esse ainda é o ponto correto antes de modificar.

Usar um ícone apropriado do `lucide-react`, preferencialmente:

```text
MessagesSquare
```

O botão deve:

* abrir o painel do chat;
* possuir tooltip “Conversas”;
* possuir `aria-label`;
* ser acessível pelo teclado;
* seguir o estilo dos demais botões do header;
* funcionar nos temas claro e escuro;
* possuir área de toque adequada no celular;
* exibir um contador quando houver mensagens não lidas.

Exemplo:

```text
💬 3
```

Regras do contador:

* não aparecer quando o total for zero;
* mostrar o total de mensagens não lidas;
* exibir `99+` quando passar de 99;
* atualizar em tempo real;
* continuar correto depois de atualizar a página;
* diminuir ou desaparecer quando as mensagens forem marcadas como lidas;
* não depender de a lista de conversas estar aberta.

O contador não deve usar o futuro módulo de notificações.

---

# 2. ESTRUTURA VISUAL DO CHAT

Criar um componente central, por exemplo:

```text
ChatCenter
```

Ele deve controlar as visualizações internas:

```ts
type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "conversation"; conversationId: string }
```

Evitar empilhar vários `Sheet` independentes se isso gerar conflito de:

* foco;
* overlay;
* acessibilidade;
* fechamento;
* `z-index`;
* navegação no celular.

A experiência visual pode simular um segundo painel entrando por cima do primeiro, mas deve manter um controle previsível de estado.

---

# 3. SHEET PRINCIPAL — LISTA DE CONVERSAS

Ao clicar no botão do header, abrir um `Sheet` lateral.

## Desktop

Usar largura aproximada de:

```text
400px a 440px
```

## Celular

Usar a largura total disponível.

O painel deve ter:

* cabeçalho fixo;
* título “Conversas”;
* botão “Nova conversa”;
* campo para buscar conversas;
* lista rolável;
* estados de carregamento, vazio e erro.

Cada conversa deve mostrar:

* avatar ou iniciais;
* nome do outro participante;
* setor, quando disponível;
* indicador de presença;
* prévia da última mensagem;
* prefixo “Você:” quando a última mensagem for do usuário atual;
* horário ou data da última mensagem;
* contador de mensagens não lidas daquela conversa.

Ordenação:

```text
last_message_at DESC
```

Conversas com atividade mais recente devem aparecer primeiro.

## Estados vazios

Quando não existir conversa:

```text
Nenhuma conversa ainda.
Inicie uma conversa com outro usuário do sistema.
```

Quando a busca não encontrar resultado:

```text
Nenhuma conversa encontrada.
```

Usar skeleton durante o primeiro carregamento.

---

# 4. NOVA CONVERSA

O botão “Nova conversa” deve abrir uma visualização em altura total dentro do sistema de chat.

Ela pode utilizar `Drawer`, `Sheet` interno controlado ou uma transição entre painéis, desde que:

* funcione corretamente no celular;
* não quebre o foco;
* não crie overlays incorretos;
* permita voltar à lista;
* respeite o painel principal do chat.

Exibir:

* título “Nova conversa”;
* botão voltar;
* campo “Buscar usuário”;
* lista de usuários ativos;
* avatar ou iniciais;
* nome;
* setor;
* presença online.

A busca deve funcionar por:

* nome;
* username, se fizer sentido para a interface;
* setor, se suportado pela rota.

Não exibir o próprio usuário.

Mostrar todos os usuários ativos, mesmo que estejam offline.

## Seleção de usuário

Ao selecionar um usuário:

1. verificar se já existe uma conversa individual entre os dois;
2. se existir, retornar essa conversa;
3. se não existir, criar uma única conversa;
4. impedir conversas individuais duplicadas;
5. abrir imediatamente a conversa;
6. fechar a seleção de usuários.

A criação precisa ser segura contra duas requisições simultâneas.

---

# 5. ROTA SEGURA PARA USUÁRIOS DO CHAT

Não reutilizar diretamente a atual:

```text
GET /api/users
```

Essa rota está ligada ao gerenciamento de usuários e pode retornar dados administrativos.

Criar uma rota específica, semelhante a:

```text
GET /api/chat/users?q=
```

Ela deve ser acessível a qualquer usuário autenticado, inclusive usuários sem permissão administrativa de gerenciamento de usuários.

Retornar exclusivamente dados necessários ao chat:

```ts
type ChatUser = {
  id: string
  nome: string
  username: string | null
  setor: {
    id: number
    nome: string
  } | null
  avatarUrl: string | null
  online: boolean
  lastSeenAt: string | null
}
```

Não expor:

* salário;
* comissão;
* e-mail, se não for necessário;
* perfil de permissões;
* permissões;
* datas trabalhistas;
* dados de auditoria;
* informações administrativas.

Filtrar obrigatoriamente:

```text
usuario.ativo = true
```

Excluir o usuário autenticado do resultado.

---

# 6. MODELO DE DADOS

Adapte os nomes às convenções reais do banco, mas preserve os conceitos abaixo.

## Conversa

Criar tabela equivalente a:

```text
chat_conversa
```

Campos mínimos:

```text
id
tipo
direct_key
created_at
updated_at
last_message_at
```

Nesta fase, o único tipo permitido será:

```text
DIRECT
```

## Chave de conversa individual

Criar uma chave determinística com os IDs ordenados:

```text
direct_key = menorUsuarioId + ":" + maiorUsuarioId
```

Aplicar índice ou restrição única para impedir duas conversas individuais entre o mesmo par de usuários.

Nunca confiar em uma chave enviada livremente pelo frontend. Ela deve ser produzida ou validada no servidor.

## Participantes

Criar tabela equivalente a:

```text
chat_participante
```

Campos mínimos:

```text
conversa_id
usuario_id
joined_at
last_read_message_id
last_read_at
```

Aplicar chave única:

```text
UNIQUE (conversa_id, usuario_id)
```

Toda conversa individual deve possuir exatamente os dois participantes correspondentes.

## Mensagens

Criar tabela equivalente a:

```text
chat_mensagem
```

Campos mínimos:

```text
id
conversa_id
remetente_id
conteudo
client_message_id
created_at
```

Aplicar uma restrição de idempotência adequada utilizando:

```text
client_message_id
```

O mesmo envio repetido pelo navegador não pode gerar duas mensagens.

Criar os índices necessários para:

* buscar conversas de um usuário;
* ordenar conversas por atividade;
* paginar mensagens por conversa e data;
* calcular mensagens não lidas;
* localizar conversa pela `direct_key`.

Usar a convenção de UUID, timestamps, nomes e auditoria já adotada pelo projeto.

---

# 7. SEGURANÇA E AUTORIZAÇÃO

Todas as rotas de chat devem exigir autenticação.

O servidor deve obter o usuário atual pela sessão. Nunca aceitar `remetente_id` como verdade enviada pelo frontend.

Regras obrigatórias:

* somente participante pode abrir uma conversa;
* somente participante pode listar suas mensagens;
* somente participante pode enviar mensagem;
* somente o próprio participante pode alterar sua leitura;
* usuário inativo não pode criar conversa nem enviar mensagem;
* o destinatário precisa existir e estar ativo ao iniciar uma conversa;
* nenhum usuário pode consultar o chat de terceiros alterando IDs na URL;
* mensagens devem ser renderizadas como texto, sem HTML arbitrário;
* aplicar limite de tamanho;
* validar os payloads, preferencialmente com Zod;
* não permitir mensagem vazia ou composta somente por espaços;
* limitar o conteúdo a aproximadamente 5.000 caracteres;
* aplicar paginação obrigatória.

Se o projeto utilizar `supabaseAdmin` nas rotas, toda autorização deve ser feita explicitamente antes de qualquer consulta ou alteração sensível.

Se houver RLS habilitado e compatível com a arquitetura atual, criar políticas adequadas. Não introduzir uma estratégia conflitante com o padrão atual sem necessidade.

---

# 8. ROTAS OU SERVIÇOS

Adapte ao padrão do projeto, mas cubra operações equivalentes a:

```text
GET  /api/chat/conversations
POST /api/chat/conversations/direct
GET  /api/chat/conversations/:id/messages
POST /api/chat/conversations/:id/messages
POST /api/chat/conversations/:id/read
GET  /api/chat/unread-count
GET  /api/chat/users
```

## Listar conversas

Retornar dados suficientes para montar a caixa de entrada:

```ts
type ConversationSummary = {
  id: string
  participant: ChatUser
  lastMessage: {
    id: string
    content: string
    senderId: string
    createdAt: string
  } | null
  unreadCount: number
  lastMessageAt: string | null
}
```

## Criar ou recuperar conversa direta

A operação deve ser idempotente.

Dado um destinatário, retornar a conversa existente ou criar uma nova sem duplicação.

## Histórico de mensagens

Utilizar paginação por cursor, não por carregamento integral.

Exemplo:

```text
GET /api/chat/conversations/:id/messages?cursor=<cursor>&limit=30
```

Resposta sugerida:

```ts
type MessagePage = {
  messages: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}
```

Usar ordenação estável com combinação equivalente a:

```text
created_at + id
```

## Marcação de leitura

A rota de leitura deve atualizar somente o estado do participante autenticado.

Não alterar individualmente todas as mensagens se isso puder ser evitado.

Preferir manter:

```text
last_read_message_id
last_read_at
```

A operação deve ser idempotente.

---

# 9. TEMPO REAL

Usar Supabase Realtime de acordo com a configuração real do projeto.

O sistema deve atualizar em tempo real:

* mensagens da conversa aberta;
* prévia da última mensagem;
* ordenação da lista;
* contador não lido da conversa;
* contador global no ícone;
* marcação de leitura;
* presença online.

Não criar polling agressivo.

## Assinaturas

Evitar assinar a tabela inteira sem filtros.

Fluxo recomendado:

1. ao carregar o ERP, buscar o total não lido;
2. inscrever o usuário em atualizações relevantes;
3. ao abrir a caixa de entrada, carregar as conversas;
4. ao abrir uma conversa, carregar a primeira página;
5. assinar os eventos daquela conversa;
6. remover a assinatura ao trocar ou fechar;
7. limpar todos os canais no `unmount`.

Impedir mensagens duplicadas quando a mesma mensagem aparecer primeiro de forma otimista e depois pelo Realtime.

Conciliar usando:

```text
id
```

ou:

```text
client_message_id
```

O funcionamento não deve depender exclusivamente do evento em tempo real. Depois de uma reconexão, revalidar os dados necessários para recuperar eventos eventualmente perdidos.

---

# 10. PRESENÇA ONLINE

Diferenciar:

```text
usuário ativo
```

de:

```text
usuário online
```

Definições:

* ativo: possui acesso habilitado ao ERP;
* online: possui presença ativa no Supabase Realtime;
* offline: não possui presença ativa;
* ausente: opcional, somente se puder ser implementado de maneira consistente.

Utilizar Supabase Realtime Presence, se compatível com a configuração atual.

Criar presença somente depois de a sessão estar autenticada.

Utilizar identificador estável do usuário e impedir vazamento de informações desnecessárias.

Ao fechar a aba, perder a conexão ou desmontar o provider, remover ou deixar expirar corretamente a presença.

Se o mesmo usuário estiver conectado em mais de uma aba ou dispositivo, ele deve continuar online enquanto pelo menos uma presença estiver ativa.

Mostrar:

* ponto verde para online;
* ponto cinza para offline.

Não impedir o envio para usuários offline.

---

# 11. CONVERSA E TIMELINE

Ao selecionar uma conversa, abrir a visualização de mensagens.

## Cabeçalho

Mostrar:

* botão voltar;
* avatar;
* nome;
* setor, quando existir;
* indicador de presença;
* botão para fechar todo o chat.

## Timeline

As mensagens devem:

* aparecer em ordem cronológica;
* ser agrupadas por data;
* mostrar as mensagens do usuário atual à direita;
* mostrar as mensagens recebidas à esquerda;
* mostrar horário;
* quebrar textos longos;
* preservar quebras de linha;
* permitir selecionar e copiar o texto;
* não renderizar HTML arbitrário.

Separadores sugeridos:

```text
Hoje
Ontem
22 de agosto de 2026
```

Quando houver mensagens não lidas, mostrar:

```text
──────── 3 mensagens não lidas ────────
```

Ao abrir a conversa, posicionar a timeline de maneira que o usuário consiga identificar onde começam as mensagens não lidas.

Não marcar como lida apenas porque o evento chegou em tempo real.

Marcar como lida quando:

* a conversa estiver aberta;
* a aba estiver visível;
* as mensagens tiverem sido carregadas;
* a mensagem mais recente recebida estiver efetivamente alcançada ou visível.

Evitar requisições repetitivas de leitura. Agrupar ou aplicar debounce quando necessário.

---

# 12. PAGINAÇÃO DO HISTÓRICO

Carregar inicialmente aproximadamente:

```text
30 mensagens
```

Ao rolar para o topo:

* buscar a página anterior;
* manter a posição visual atual;
* não fazer o conteúdo “pular”;
* mostrar indicador de carregamento;
* interromper novas buscas quando `hasMore = false`;
* impedir requisições concorrentes duplicadas.

Não carregar todo o histórico de uma vez.

Ao receber mensagem nova:

* adicionar ao final;
* rolar automaticamente somente se o usuário já estiver próximo do final;
* se o usuário estiver lendo mensagens antigas, não forçar o scroll;
* indicar discretamente que existem mensagens novas abaixo, dentro da própria conversa.

Essa indicação local não deve ser integrada a um módulo global de notificações.

---

# 13. ENVIO DE MENSAGEM

Criar um composer fixo na parte inferior da conversa.

Deve conter:

* `Textarea` expansível;
* botão de enviar;
* suporte a texto com múltiplas linhas;
* limite de tamanho;
* estado desabilitado quando vazio;
* estado de envio.

Comportamento:

```text
Enter         = enviar
Shift + Enter = nova linha
```

No celular, avaliar o comportamento do teclado virtual e garantir que o campo continue visível.

Respeitar:

```css
env(safe-area-inset-bottom)
```

Implementar atualização otimista.

Cada envio deve possuir um:

```text
client_message_id
```

gerado no cliente.

Estados visuais mínimos:

```ts
type MessageSendStatus =
  | "sending"
  | "sent"
  | "failed"
```

Não é necessário implementar confirmação de entrega ou check azul nesta fase.

---

# 14. NOVA TENTATIVA EM CASO DE FALHA

Quando o envio falhar:

* manter a mensagem na timeline;
* mostrar estado visual de falha;
* exibir ação “Tentar novamente”;
* não apagar o texto;
* reutilizar o mesmo `client_message_id`;
* impedir mensagem duplicada;
* permitir nova tentativa após reconexão.

Exemplo:

```text
Não foi possível enviar. [Tentar novamente]
```

Diferenciar erro definitivo de erro temporário quando possível.

Exemplos definitivos:

* conteúdo inválido;
* conversa não autorizada;
* usuário inativo.

Exemplos temporários:

* falha de rede;
* timeout;
* servidor indisponível.

Não repetir envios infinitamente de maneira automática.

---

# 15. BUSCA

## Busca de conversas

No Sheet principal, permitir busca pelo nome do participante e, se disponível, setor ou username.

A busca deve ser responsiva e não travar a interface.

Para uma quantidade pequena de conversas, pode haver filtro local após o carregamento. Se a arquitetura exigir busca no servidor, aplicar debounce.

## Busca de usuários

Na criação de conversa, pesquisar apenas usuários ativos.

Aplicar debounce entre:

```text
250ms e 400ms
```

Cancelar ou ignorar respostas antigas quando o texto mudar rapidamente.

Tratar corretamente:

* carregando;
* nenhum resultado;
* erro;
* busca vazia.

---

# 16. RESPONSIVIDADE E ACESSIBILIDADE

## Desktop

* Sheet lateral com aproximadamente 400–440px;
* cabeçalho e composer fixos;
* timeline ocupando o espaço restante;
* lista com rolagem independente.

## Celular e PWA

* painel em largura total;
* usar `100dvh` ou unidade equivalente segura;
* não depender exclusivamente de `100vh`;
* respeitar safe areas;
* manter composer acima do teclado;
* botões com área de toque adequada;
* botão voltar claramente acessível;
* evitar rolagem dupla;
* impedir que o body role por trás do painel.

## Acessibilidade

* títulos apropriados no `Sheet`;
* descrições para leitores de tela;
* foco inicial previsível;
* foco devolvido ao botão do header ao fechar;
* navegação por teclado;
* `aria-label` em botões somente com ícone;
* contraste adequado;
* presença não representada somente por cor;
* mensagens de erro anunciadas de maneira acessível.

---

# 17. ESTADO E ORGANIZAÇÃO DO FRONTEND

Não concentrar toda a funcionalidade em um único componente grande.

Separar responsabilidades em componentes equivalentes a:

```text
ChatCenter
ChatTrigger
ChatInbox
ChatConversationItem
NewConversation
ChatConversation
ChatTimeline
ChatMessageBubble
ChatComposer
ChatPresenceIndicator
UnreadBadge
```

Os nomes podem ser adaptados ao padrão existente.

Criar hooks ou serviços para:

* carregar conversas;
* carregar mensagens;
* enviar mensagem;
* marcar leitura;
* controlar Realtime;
* controlar Presence;
* manter contador global.

Se o projeto já adota TanStack Query em funcionalidades semelhantes, avaliar seu uso para:

* cache;
* paginação infinita;
* revalidação;
* atualização otimista;
* invalidação após eventos em tempo real.

Não introduzir outra biblioteca de estado sem necessidade.

---

# 18. MIDDLEWARE E PERMISSÕES

As rotas de chat devem exigir usuário autenticado, mas não devem exigir permissão administrativa de usuários.

Verificar o middleware atual, especialmente regras especiais para usuários que possuem somente acesso à execução de OS.

Esses usuários também devem poder utilizar o chat interno.

Garantir que rotas equivalentes a:

```text
/api/chat/*
```

sejam acessíveis a todo usuário autenticado e ativo, mantendo as validações de participante dentro das próprias rotas.

Não tornar as rotas públicas.

---

# 19. ESTADOS DE ERRO

Implementar tratamento visual para:

* falha ao carregar conversas;
* falha ao carregar usuários;
* falha ao criar conversa;
* falha ao carregar mensagens;
* falha ao enviar;
* falha ao marcar leitura;
* queda do Realtime;
* reconexão.

Oferecer ação de tentar novamente quando fizer sentido.

A queda temporária do Realtime não deve apagar conversas nem mensagens já carregadas.

Após reconectar:

* atualizar contador;
* revalidar conversas;
* revalidar a conversa aberta;
* reconciliar mensagens otimistas.

---

# 20. DESEMPENHO

Evitar:

* carregar todas as mensagens;
* consultar cada conversa separadamente em loop;
* executar uma consulta por participante;
* manter assinaturas abandonadas;
* recalcular contadores no cliente usando todo o histórico;
* rerenderizar toda a timeline a cada tecla digitada;
* consultas sem índices;
* polling frequente.

O resumo das conversas e seus contadores deve ser obtido de maneira eficiente, preferencialmente em uma consulta, função SQL ou estratégia equivalente adequada ao banco atual.

---

# 21. TESTES OBRIGATÓRIOS

Adicionar testes compatíveis com a estrutura existente.

Cobrir pelo menos:

## Backend

* usuário não autenticado não acessa o chat;
* usuário não participante não lê conversa;
* usuário não participante não envia mensagem;
* usuário inativo não inicia conversa;
* conversa direta duplicada não é criada;
* mensagem vazia é recusada;
* mensagem acima do limite é recusada;
* repetição do mesmo `client_message_id` não duplica mensagem;
* paginação não repete nem perde mensagens;
* marcação de leitura altera somente o participante atual;
* contador não lido retorna valor correto.

## Frontend

* botão abre o chat;
* contador não aparece quando for zero;
* contador mostra `99+`;
* seleção de usuário abre conversa;
* busca filtra resultados;
* envio otimista aparece imediatamente;
* falha de envio mostra “Tentar novamente”;
* nova tentativa não duplica mensagem;
* mensagem recebida atualiza a conversa;
* abertura e leitura atualizam o contador;
* scroll para mensagens anteriores preserva a posição.

---

# 22. VALIDAÇÃO MANUAL

Validar pelo menos com dois usuários reais ou de teste em navegadores diferentes.

Cenários:

1. usuário A inicia conversa com B;
2. B recebe a mensagem em tempo real;
3. o contador de B aumenta;
4. B abre o painel, mas ainda não a conversa;
5. o contador continua existindo;
6. B abre a conversa;
7. a leitura é registrada;
8. o contador diminui;
9. B responde;
10. A recebe a resposta em tempo real;
11. um usuário fica offline;
12. o outro envia mensagem;
13. ao retornar, o usuário recupera a mensagem e o contador correto;
14. uma falha de rede durante o envio mostra “Tentar novamente”;
15. a nova tentativa envia apenas uma mensagem;
16. o histórico antigo carrega ao rolar para cima;
17. o layout funciona em desktop, celular e PWA;
18. o tema claro e escuro permanece correto.

---

# 23. CRITÉRIOS DE ACEITE

A implementação será considerada concluída quando:

* o ícone de chat estiver integrado ao header global;
* o ícone mostrar o total correto de mensagens não lidas;
* qualquer usuário autenticado e ativo puder visualizar os demais usuários ativos;
* dados administrativos dos usuários não forem expostos;
* for possível iniciar somente uma conversa individual por par;
* mensagens de texto forem enviadas e recebidas em tempo real;
* mensagens não lidas forem calculadas corretamente;
* abrir apenas o Sheet não marcar mensagens como lidas;
* abrir e visualizar a conversa registrar a leitura;
* a presença funcionar em mais de uma aba ou dispositivo;
* o histórico utilizar paginação por cursor;
* mensagens com falha puderem ser reenviadas sem duplicação;
* o layout funcionar em desktop, celular e PWA;
* usuários restritos à execução de OS também puderem usar o chat;
* nenhuma notificação, toast, som ou infraestrutura do futuro módulo de notificações tiver sido criada;
* todas as funcionalidades anteriores do ERP continuarem funcionando;
* lint, testes e build forem executados e os resultados informados.

---

# 24. ENTREGA

Ao finalizar, apresentar:

1. resumo da arquitetura implementada;
2. arquivos criados;
3. arquivos alterados;
4. migrações adicionadas;
5. tabelas, índices e políticas criadas;
6. rotas de API criadas;
7. funcionamento do Realtime;
8. funcionamento da presença;
9. estratégia do contador não lido;
10. estratégia de idempotência e nova tentativa;
11. testes executados;
12. resultado do lint;
13. resultado do build;
14. eventuais limitações encontradas.

Não ocultar erros de teste, lint ou build.

Não alterar funcionalidades fora do escopo para “aproveitar” a implementação.

Não implementar recursos reservados para fases futuras.
