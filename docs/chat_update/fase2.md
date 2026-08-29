# IMPLEMENTAÇÃO — CHAT INTERNO DO ERP OFICINA — FASE 2

## Projeto

```text
https://github.com/figodevtech/erpoficina
```

## OBJETIVO

Evoluir o módulo de chat individual já implementado na primeira fase, adicionando:

1. mensagens de voz;
2. resposta citada;
3. reações simples;
4. edição de mensagens;
5. exclusão de mensagens;
6. notificações Web Push de novas mensagens, inclusive quando o PWA estiver fechado.

Esta tarefa deve preservar integralmente a arquitetura e as funcionalidades existentes da primeira fase:

* conversas individuais;
* usuários ativos;
* busca;
* mensagens de texto;
* Supabase Realtime;
* contador de não lidas;
* marcação de leitura;
* presença;
* paginação;
* interface responsiva;
* idempotência;
* atualização otimista;
* tentativa novamente;
* autenticação;
* autorização;
* isolamento entre conversas;
* comportamento de reconexão.

---

# RECURSOS FORA DO ESCOPO

Não implementar nesta fase:

* grupos;
* anexos genéricos;
* imagens;
* fotos;
* vídeos;
* documentos;
* compartilhamento de arquivos;
* fixação de conversas;
* silenciamento;
* associação com OS;
* associação com vendas;
* associação com clientes;
* associação com produtos;
* encaminhamento de mensagens;
* chamadas de áudio;
* chamadas de vídeo;
* localização;
* contatos;
* status;
* stories;
* um módulo central de notificações;
* central ou histórico de notificações dentro do ERP.

## Exceção para arquivos

Embora anexos genéricos estejam fora do escopo, esta fase permite o armazenamento de arquivos de áudio produzidos pela funcionalidade de mensagem de voz.

O sistema não deve permitir que o usuário selecione ou envie arquivos arbitrários pelo composer.

---

# 1. LEITURA OBRIGATÓRIA

Antes de modificar qualquer arquivo, leia integralmente:

```text
docs/modulos/chat.md
```

Leia também o documento de especificação da primeira fase, se estiver disponível, por exemplo:

```text
docs/chat_update/fase1.md
```

Trate:

```text
docs/modulos/chat.md
```

como a fonte de verdade técnica do módulo.

Analise a implementação real antes de decidir:

* tabelas e migrations;
* componentes;
* hooks;
* providers;
* rotas de API;
* serviços;
* contratos TypeScript;
* Realtime;
* Presence;
* paginação;
* leitura;
* contador não lido;
* atualização otimista;
* idempotência;
* PWA;
* service worker;
* autenticação;
* autorização;
* armazenamento de arquivos.

Não presuma que os caminhos sugeridos neste documento ainda são exatos. Adapte aos padrões reais encontrados.

---

# 2. DOCUMENTAÇÃO PERMANENTE

Toda alteração desta fase deve ser registrada em:

```text
docs/modulos/chat.md
```

Atualize a documentação no mesmo conjunto de mudanças da implementação.

Documente:

* mensagens de voz;
* armazenamento e acesso aos áudios;
* limites e formatos;
* resposta citada;
* reações;
* edição;
* exclusão;
* Web Push;
* subscriptions por dispositivo;
* chaves VAPID;
* service worker;
* eventos em tempo real;
* novos campos e tabelas;
* novas rotas;
* regras de segurança;
* regras de autorização;
* políticas de retenção;
* comportamento offline;
* limitações de navegador e PWA;
* testes;
* procedimentos de diagnóstico;
* decisões técnicas.

Não documente comportamento planejado como se estivesse implementado.

Diferencie claramente:

```text
Implementado
Planejado
Fora do escopo
Limitação conhecida
```

---

# 3. PRESERVAÇÃO DA PRIMEIRA FASE

Antes de implementar, crie uma lista dos contratos e comportamentos existentes que não podem ser quebrados.

A segunda fase não pode:

* recriar o módulo do zero;
* alterar IDs de conversas existentes;
* perder mensagens existentes;
* invalidar paginação;
* duplicar conversas individuais;
* quebrar o contador não lido;
* quebrar leitura;
* quebrar Presence;
* abrir acesso entre não participantes;
* remover idempotência;
* substituir migrations já aplicadas;
* modificar migrations antigas.

Toda mudança no banco deve ser feita por novas migrations incrementais e compatíveis com os dados atuais.

Mensagens antigas precisam continuar aparecendo normalmente.

---

# 4. RESPOSTA CITADA

Implementar resposta a uma mensagem específica, no mesmo conceito utilizado pelo WhatsApp.

O usuário deve conseguir selecionar a ação:

```text
Responder
```

em uma mensagem existente.

Ao escolher a ação:

1. guardar a mensagem selecionada como referência;
2. mostrar uma prévia acima do composer;
3. permitir cancelar a resposta;
4. enviar a nova mensagem contendo a referência;
5. apresentar a mensagem citada dentro do novo balão.

## Prévia no composer

Mostrar:

* nome do autor original;
* trecho do texto;
* ou “Mensagem de voz” quando for áudio;
* botão para cancelar.

Exemplo:

```text
Respondendo a João
“A peça da OS chegou?”
[X]

[ Digite uma mensagem... ]
```

## Exibição no balão

A nova mensagem deve conter uma área compacta com:

* autor da mensagem original;
* trecho do conteúdo original;
* indicador de mensagem de voz quando aplicável.

Ao clicar na citação:

* localizar a mensagem original na timeline;
* carregar páginas anteriores, se necessário;
* rolar até ela;
* aplicar um destaque visual temporário.

Se a mensagem original tiver sido excluída para todos, mostrar:

```text
Mensagem excluída
```

A resposta deve continuar válida mesmo que o conteúdo original seja posteriormente editado ou excluído.

Defina e documente se a prévia usa:

* snapshot histórico do conteúdo no momento da resposta; ou
* conteúdo atual da mensagem referenciada.

Preferência: armazenar a referência pelo ID e uma pequena representação histórica segura para que a resposta continue compreensível mesmo após edição ou exclusão.

## Banco

Adicionar estrutura equivalente a:

```text
reply_to_message_id
reply_snapshot_type
reply_snapshot_content
reply_snapshot_sender_name
```

Adapte os campos ao modelo atual sem duplicar dados desnecessariamente.

Impedir referência a:

* mensagem de outra conversa;
* mensagem inacessível ao usuário;
* ID inexistente;
* conteúdo que não pertence aos participantes atuais.

---

# 5. REAÇÕES

Implementar somente quatro reações simples:

```text
❤️ Coração
👍 Legal
😄 Feliz
😢 Triste
```

Não implementar seletor completo de emojis.

Ao selecionar uma mensagem, apresentar uma barra compacta com essas quatro opções.

## Regras

* qualquer participante pode reagir a uma mensagem da conversa;
* cada usuário pode ter no máximo uma reação por mensagem;
* escolher outra reação substitui a anterior;
* clicar novamente na reação já selecionada remove a reação;
* uma reação não deve alterar o estado de leitura da mensagem por si só;
* reações devem atualizar em tempo real;
* reações devem sobreviver à atualização da página;
* mensagens excluídas para todos não aceitam novas reações;
* ao excluir para todos, as reações podem ser removidas ou ocultadas conforme a modelagem escolhida;
* documentar a decisão.

Exibir as reações agrupadas abaixo do balão:

```text
❤️ 2   👍 3   😄 1
```

Destacar visualmente a reação selecionada pelo usuário atual.

Ao clicar em uma reação agrupada, pode ser exibida uma interface simples mostrando quem reagiu, desde que isso não aumente desnecessariamente o escopo. Se não for implementado, documentar como limitação.

## Banco

Criar tabela equivalente a:

```text
chat_reacao
```

Campos mínimos:

```text
id
mensagem_id
usuario_id
reacao
created_at
updated_at
```

Aplicar:

```text
UNIQUE (mensagem_id, usuario_id)
```

Validar no servidor que a reação pertence ao conjunto permitido.

Não confiar no valor enviado livremente pelo frontend.

---

# 6. EDIÇÃO DE MENSAGENS

Permitir que o remetente edite suas próprias mensagens de texto.

Não permitir edição de:

* mensagem de outro usuário;
* mensagem de voz;
* mensagem excluída para todos;
* mensagem inacessível;
* mensagem de outra conversa.

## Janela de edição

Se o módulo ainda não tiver uma regra documentada, utilizar:

```text
15 minutos após o envio
```

Definir essa duração em uma constante centralizada e documentada, evitando números espalhados pelo código.

A validação do prazo deve ocorrer no servidor.

## Interface

Na própria mensagem enviada pelo usuário, disponibilizar:

```text
Editar
```

Ao editar:

* carregar o conteúdo atual no composer ou editor inline;
* identificar claramente que o modo de edição está ativo;
* permitir cancelar;
* preservar quebras de linha;
* validar mensagem vazia;
* aplicar o mesmo limite das mensagens de texto;
* mostrar estado de salvamento;
* manter o conteúdo anterior se a operação falhar.

Depois da edição, mostrar:

```text
editada
```

próximo ao horário.

A alteração deve aparecer em tempo real para os dois participantes.

## Histórico de edição

Criar uma estratégia segura para preservar o conteúdo anterior.

Preferencialmente criar tabela equivalente a:

```text
chat_mensagem_edicao
```

Campos:

```text
id
mensagem_id
conteudo_anterior
editado_por
created_at
```

O histórico não precisa ficar visível na interface nesta fase, mas deve existir para:

* auditoria;
* diagnóstico;
* preservação de contexto.

Somente usuários autorizados e mecanismos administrativos futuros poderão acessar esse histórico. Não criar uma tela administrativa agora.

A edição não deve:

* criar nova mensagem;
* alterar `created_at`;
* aumentar o contador não lido de quem já leu;
* mover indevidamente a conversa para o topo como se fosse uma mensagem nova;
* disparar Web Push como nova mensagem.

---

# 7. EXCLUSÃO DE MENSAGENS

Implementar duas opções:

```text
Excluir para mim
Excluir para todos
```

## Excluir para mim

Permitir que qualquer participante oculte uma mensagem apenas na sua própria visualização.

Regras:

* não apagar o registro principal;
* não ocultar para o outro participante;
* não alterar o histórico do outro;
* não afetar a contagem não lida do outro;
* não apagar o arquivo de voz se o outro participante ainda puder acessá-lo;
* não quebrar respostas que referenciem a mensagem.

Criar uma tabela equivalente a:

```text
chat_mensagem_oculta
```

Campos mínimos:

```text
mensagem_id
usuario_id
created_at
```

Aplicar:

```text
UNIQUE (mensagem_id, usuario_id)
```

## Excluir para todos

Permitir somente ao remetente excluir sua própria mensagem.

Se não existir regra anterior documentada, usar o mesmo limite da edição:

```text
15 minutos após o envio
```

A validação deve ocorrer no servidor.

Usar exclusão lógica, mantendo metadados necessários:

```text
deleted_for_everyone_at
deleted_for_everyone_by
```

Não remover fisicamente a mensagem imediatamente.

Na interface dos dois participantes, substituir por:

```text
Mensagem excluída
```

A exclusão para todos deve atualizar em tempo real.

Para mensagens de voz:

* impedir novas reproduções;
* tornar o arquivo inacessível;
* realizar remoção física de forma segura, preferencialmente por rotina controlada;
* documentar quando e como o áudio é removido do Storage;
* não deixar URLs públicas permanentes.

## Menu de exclusão

Não mostrar opções inválidas.

Exemplo:

* mensagem própria dentro do prazo: `Editar`, `Excluir para mim`, `Excluir para todos`;
* mensagem própria fora do prazo: `Excluir para mim`;
* mensagem recebida: `Excluir para mim`;
* mensagem de voz própria dentro do prazo: `Excluir para mim`, `Excluir para todos`.

Antes de “Excluir para todos”, solicitar confirmação.

---

# 8. MENSAGENS DE VOZ

Adicionar gravação e envio de áudio diretamente no composer.

Não implementar upload manual de áudio.

## Permissão do microfone

O pedido de acesso ao microfone deve ocorrer somente após ação explícita do usuário.

Não solicitar permissão automaticamente ao abrir o ERP ou o chat.

Tratar:

* permissão concedida;
* permissão negada;
* microfone indisponível;
* navegador sem suporte;
* erro durante a gravação;
* interrupção da gravação;
* troca de aba;
* encerramento da tela;
* chamada ou bloqueio do aparelho quando aplicável.

Apresentar mensagens de erro claras e acessíveis.

## Fluxo de gravação

O composer deve oferecer botão de microfone.

Ao iniciar:

* substituir ou adaptar o composer para o modo de gravação;
* mostrar duração;
* mostrar indicador de gravação;
* permitir cancelar;
* permitir parar e revisar;
* permitir reproduzir antes de enviar;
* permitir descartar;
* permitir enviar.

Fluxo esperado:

```text
Gravar
→ Parar
→ Ouvir
→ Enviar ou descartar
```

Não enviar automaticamente ao parar.

## Limites

Se não existir regra anterior, utilizar:

```text
duração máxima: 5 minutos
tamanho máximo: 10 MB
```

Centralizar e documentar esses limites.

Interromper a gravação ao alcançar o tempo máximo.

## Formatos

Usar `MediaRecorder` com detecção de suporte.

Aceitar apenas formatos realmente produzidos e suportados pelos navegadores do projeto, como:

```text
audio/webm
audio/ogg
audio/mp4
```

Não assumir que todos os navegadores produzem o mesmo codec.

Validar no servidor:

* MIME permitido;
* tamanho;
* duração, quando tecnicamente possível;
* usuário autenticado;
* participação na conversa;
* identificador da mensagem;
* integridade do envio.

Não confiar somente na extensão do arquivo.

## Armazenamento

Usar bucket privado do Supabase Storage ou estratégia privada equivalente.

Não usar URL pública permanente.

O caminho deve evitar colisões e exposição:

```text
chat-audio/<conversation-id>/<message-id>/<arquivo>
```

O acesso deve ocorrer por:

* rota autenticada;
* signed URL de curta duração;
* ou mecanismo privado equivalente.

Antes de gerar acesso ao áudio, validar que:

* o usuário está autenticado;
* participa da conversa;
* a mensagem não está excluída para ele;
* a mensagem não foi excluída para todos.

Não armazenar áudio em Base64 no banco.

## Envio consistente

Evitar registros incompletos.

Fluxo sugerido:

1. criar ou reservar ID da mensagem;
2. enviar o arquivo para o Storage;
3. validar o resultado;
4. registrar a mensagem;
5. limpar arquivo órfão se a criação da mensagem falhar.

Alternativamente, criar estado controlado de processamento e rotina de limpeza.

Documentar a estratégia escolhida.

Utilizar `client_message_id` também para mensagens de voz.

## Interface do áudio

O balão deve mostrar:

* botão reproduzir/pausar;
* progresso;
* duração;
* horário;
* estado `sending`, `sent` ou `failed`;
* ação de tentar novamente em falha.

Não usar obrigatoriamente o player HTML padrão se ele destoar da interface. Criar um controle acessível e consistente com o chat.

Garantir:

* apenas um áudio reproduzindo por vez;
* pausa ao iniciar outro áudio;
* limpeza do player ao desmontar;
* suporte aos temas claro e escuro;
* operação pelo teclado;
* rótulos acessíveis.

## Falha e nova tentativa

Em caso de falha:

* manter a prévia local enquanto possível;
* mostrar “Não foi possível enviar”;
* permitir tentar novamente;
* reutilizar o mesmo `client_message_id`;
* impedir duplicação;
* informar quando a prévia local tiver sido perdida após recarregar a página.

Não realizar tentativas infinitas automaticamente.

---

# 9. NOTIFICAÇÕES WEB PUSH

Implementar Web Push exclusivamente para novas mensagens do chat.

Não construir agora:

* central de notificações;
* histórico genérico de notificações;
* sininho global;
* preferências genéricas de outros módulos;
* notificações de OS, vendas, estoque ou financeiro.

A implementação deve ser organizada para permitir integração futura com um módulo central de notificações, mas sem antecipar esse módulo.

## Objetivo

O destinatário deve poder receber uma notificação quando chegar uma nova mensagem, inclusive quando:

* o ERP estiver em segundo plano;
* a aba estiver fechada;
* o PWA instalado estiver fechado;
* o navegador não estiver com a conversa aberta.

## Consentimento

Nunca solicitar permissão automaticamente ao carregar o ERP.

Apresentar uma ação explícita, por exemplo:

```text
Ativar notificações do chat
```

Somente depois do clique chamar:

```ts
Notification.requestPermission()
```

Explicar antes da solicitação:

* para que as notificações serão usadas;
* que podem chegar com o ERP fechado;
* como desativá-las.

Tratar os estados:

```text
default
granted
denied
unsupported
```

Se estiver negado:

* não insistir repetidamente;
* explicar que a autorização deve ser alterada nas configurações do navegador ou sistema.

## PWA e plataformas

Tratar corretamente:

### iPhone e iPad

* Web Push exige PWA adicionado à Tela de Início;
* requisito mínimo de iOS/iPadOS compatível;
* permissão solicitada dentro do PWA instalado;
* orientar o usuário quando estiver no Safari comum.

### Android

* funcionar no PWA instalado quando suportado;
* avaliar suporte no navegador sem instalação;
* não prometer comportamento que o navegador atual não suporta.

### Desktop

* usar o service worker e as permissões do navegador;
* tratar browsers sem suporte.

A detecção deve ser por recursos disponíveis, não somente por user agent.

## Service worker

Analise primeiro a configuração existente de:

```text
@ducanh2912/next-pwa
```

Não substitua ou duplique o service worker sem necessidade.

Integrar:

* recebimento do evento `push`;
* exibição via `showNotification`;
* tratamento de `notificationclick`;
* abertura ou foco da aplicação;
* abertura da conversa correta;
* atualização segura do service worker.

Não quebrar:

* cache atual;
* funcionamento offline existente;
* instalação do PWA;
* atualizações do service worker.

## Assinaturas

Criar tabela equivalente a:

```text
chat_push_subscription
```

Campos mínimos:

```text
id
usuario_id
endpoint
p256dh
auth
user_agent
device_label
created_at
updated_at
last_used_at
revoked_at
```

Cada usuário pode ter várias subscriptions:

* celular;
* tablet;
* computador;
* mais de um navegador.

Aplicar unicidade segura pelo endpoint ou hash do endpoint.

Não registrar chaves sensíveis em logs.

Criar operações equivalentes a:

```text
POST   /api/chat/push/subscriptions
DELETE /api/chat/push/subscriptions
GET    /api/chat/push/status
```

Na saída da conta:

* não excluir automaticamente subscriptions de outros dispositivos;
* oferecer remoção da subscription do dispositivo atual;
* documentar a estratégia adotada.

Subscriptions inválidas ou expiradas devem ser revogadas quando o serviço de push retornar respostas como `404` ou `410`.

## VAPID

Usar Web Push padrão com chaves VAPID.

Variáveis sugeridas:

```text
NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_SUBJECT
```

Nunca expor a chave privada no cliente.

Não versionar segredos.

Atualizar:

```text
.env.example
```

ou o arquivo equivalente de exemplo, sem valores secretos reais.

Documentar como gerar e configurar as chaves em:

```text
docs/modulos/chat.md
```

## Momento de disparo

Enviar push somente depois que a nova mensagem tiver sido persistida com sucesso.

Não disparar push para:

* o próprio remetente;
* edição;
* reação;
* marcação de leitura;
* exclusão;
* retentativa idempotente que não criou nova mensagem;
* eventos duplicados do Realtime.

Enviar para todos os dispositivos válidos do destinatário, observando a estratégia de supressão abaixo.

## Supressão

Quando for possível determinar com segurança que o destinatário está:

* com o ERP visível;
* com a conversa específica aberta;
* e conectado em tempo real;

não enviar push para evitar duplicidade desnecessária.

Se não for possível determinar isso com segurança, priorizar a entrega da notificação.

Documentar como a decisão é tomada e suas limitações.

## Conteúdo

Mensagem de texto:

```text
Título: nome do remetente
Corpo: prévia limitada da mensagem
```

Mensagem de voz:

```text
Título: nome do remetente
Corpo: Enviou uma mensagem de voz
```

Não incluir conteúdo sensível excessivo.

Limitar e sanitizar a prévia.

Adicionar dados mínimos ao payload:

```ts
{
  type: "chat_message"
  conversationId: string
  messageId: string
  url: string
}
```

Não incluir tokens, IDs desnecessários ou dados administrativos.

## Clique na notificação

Ao clicar:

1. procurar uma janela já aberta do ERP;
2. focá-la, se existir;
3. caso contrário, abrir o ERP;
4. abrir o `ChatCenter`;
5. abrir a conversa correspondente;
6. carregar ou localizar a mensagem;
7. validar a autorização normalmente no servidor.

Não confiar no `conversationId` recebido pelo service worker como autorização.

Defina uma rota ou estado navegável seguro, por exemplo:

```text
/?chat=<conversationId>&message=<messageId>
```

O parâmetro deve apenas orientar a interface. As APIs continuam validando se o usuário participa da conversa.

Depois de consumir o deep link, remova ou normalize os parâmetros para evitar reabertura contínua.

## Contador do ícone

O Web Push não substitui o contador não lido existente.

O contador continua sendo a sinalização global dentro do ERP.

Ao abrir a aplicação por uma notificação:

* revalidar o contador;
* carregar a conversa;
* marcar leitura somente conforme as regras já existentes;
* não zerar contadores antecipadamente.

---

# 10. MODELO DE MENSAGEM

Evolua o modelo existente para suportar tipos de mensagem.

Utilizar conceito equivalente a:

```ts
type ChatMessageType = "TEXT" | "VOICE"
```

Campos possíveis:

```text
type
content
reply_to_message_id
reply_snapshot
edited_at
deleted_for_everyone_at
deleted_for_everyone_by
audio_storage_path
audio_mime_type
audio_size_bytes
audio_duration_ms
```

Adapte às convenções reais.

Regras:

* `TEXT` exige conteúdo válido;
* `VOICE` exige metadados válidos do áudio;
* não aceitar combinações inconsistentes;
* mensagem excluída deve preservar somente dados necessários;
* mensagem oculta apenas para um participante continua existindo;
* mensagens antigas sem `type` devem ser migradas ou interpretadas como `TEXT`;
* migrations precisam ser retrocompatíveis.

Adicionar constraints e índices apropriados sempre que possível.

---

# 11. TEMPO REAL

Atualizar em tempo real:

* novas mensagens de voz;
* edições;
* exclusões para todos;
* reações;
* alterações necessárias na timeline.

Excluir para mim não precisa ser transmitido ao outro participante, mas deve atualizar corretamente as sessões do próprio usuário quando aplicável.

Evitar:

* assinaturas duplicadas;
* listeners abandonados;
* eventos repetidos;
* mensagem otimista duplicada;
* reação duplicada;
* loops de invalidação.

Reconciliar eventos usando IDs estáveis.

Depois de reconectar:

* revalidar a conversa;
* revalidar reações;
* atualizar mensagens editadas;
* atualizar mensagens excluídas;
* preservar paginação e posição do scroll sempre que possível.

---

# 12. INTERAÇÕES E MENU DA MENSAGEM

Criar um menu acessível para cada mensagem.

No desktop:

* clique em botão de ações;
* opcionalmente clique com botão direito, se consistente com o projeto.

No celular:

* botão de ações;
* ou pressionar e segurar, desde que exista alternativa acessível.

Ações possíveis conforme a mensagem:

```text
Responder
Reagir
Editar
Excluir para mim
Excluir para todos
```

Não mostrar ações que o usuário não pode executar.

Não depender somente de hover, pois o ERP é utilizado em celular e PWA.

---

# 13. RESPONSIVIDADE

Validar em:

* desktop;
* tablet;
* celular;
* PWA instalado;
* orientação vertical;
* orientação horizontal;
* teclado virtual aberto.

A gravação de voz, prévia de resposta, edição e player não podem:

* empurrar o composer para fora da tela;
* criar rolagem dupla;
* quebrar o Sheet;
* ficar atrás da safe area;
* bloquear o botão de enviar;
* perder controles no teclado virtual.

Usar unidades adequadas como:

```text
dvh
svh
env(safe-area-inset-bottom)
```

quando compatíveis com os padrões existentes.

---

# 14. SEGURANÇA

Validar todas as operações no servidor.

Nunca confiar em:

* `senderId`;
* `userId`;
* autoria informada pelo cliente;
* conversa informada sem conferir participação;
* MIME informado pelo navegador;
* prazo calculado somente no frontend;
* permissão de editar ou excluir calculada somente na interface.

Garantir:

* somente participantes acessam mensagens e áudios;
* somente autor edita;
* somente autor exclui para todos;
* usuário oculta apenas para si;
* reação pertence ao conjunto permitido;
* resposta referencia mensagem da mesma conversa;
* subscription push pertence ao usuário autenticado;
* Push nunca é enviado ao remetente;
* signed URLs possuem duração curta;
* bucket de voz é privado;
* conteúdo textual continua sem HTML arbitrário;
* logs não expõem áudio, subscriptions, chaves ou conteúdo sensível.

Avaliar proteção contra abuso:

* limite de tamanho;
* limite de duração;
* rate limit de mensagens;
* rate limit de reações;
* rate limit de alterações;
* rate limit de subscriptions;
* limite razoável de dispositivos por usuário.

Siga o padrão atual do projeto para rate limiting. Não introduza infraestrutura incompatível apenas nesta fase.

---

# 15. ROTAS OU SERVIÇOS

Adapte aos padrões atuais, mas forneça operações equivalentes a:

```text
POST   /api/chat/conversations/:id/messages/voice
PATCH  /api/chat/messages/:id
DELETE /api/chat/messages/:id/for-me
DELETE /api/chat/messages/:id/for-everyone

PUT    /api/chat/messages/:id/reaction
DELETE /api/chat/messages/:id/reaction

GET    /api/chat/audio/:messageId

GET    /api/chat/push/status
POST   /api/chat/push/subscriptions
DELETE /api/chat/push/subscriptions
```

A resposta citada pode ser incorporada à rota já existente de criação de mensagens.

Não criar rotas redundantes se a arquitetura atual já possuir serviços apropriados.

Padronizar:

* status HTTP;
* Zod;
* mensagens de erro;
* contratos;
* cache `no-store` em dados privados;
* autenticação;
* autorização;
* idempotência.

---

# 16. ESTADOS OTIMISTAS E FALHAS

## Resposta citada

Se o envio falhar:

* manter a mensagem e a citação;
* permitir tentar novamente;
* não duplicar.

## Reação

Pode atualizar otimisticamente.

Se falhar:

* restaurar o estado anterior;
* informar erro sem criar notificação global.

## Edição

Pode atualizar após confirmação do servidor ou de forma otimista com rollback seguro.

Se falhar:

* restaurar conteúdo anterior;
* manter o editor disponível.

## Exclusão

Para exclusão para todos, preferir confirmação do servidor antes de substituir definitivamente o conteúdo.

Se falhar:

* manter a mensagem;
* mostrar erro local.

## Voz

Mostrar:

```text
gravando
processando
enviando
enviada
falha
```

Permitir tentativa novamente quando o arquivo local ainda existir.

Não apresentar sucesso antes de o arquivo e a mensagem estarem consistentes no servidor.

---

# 17. ACESSIBILIDADE

Garantir:

* rótulos em botões de microfone, reprodução e ações;
* anúncio do estado de gravação;
* anúncio da duração;
* operação completa por teclado;
* foco previsível em menus;
* foco retornando ao composer;
* reações com nomes acessíveis;
* não depender somente dos emojis;
* confirmação acessível de exclusão;
* erros anunciados;
* player operável sem mouse;
* contraste correto;
* estado de gravação não representado somente por cor.

Textos acessíveis das reações:

```text
Reagir com coração
Reagir com legal
Reagir com feliz
Reagir com triste
```

---

# 18. TESTES OBRIGATÓRIOS

Adicionar testes compatíveis com o projeto.

## Resposta citada

* responde a mensagem da mesma conversa;
* rejeita mensagem de outra conversa;
* exibe snapshot correto;
* mensagem original excluída não quebra a resposta;
* clique localiza a mensagem original;
* carrega página anterior quando necessário.

## Reações

* adiciona reação válida;
* rejeita reação desconhecida;
* substitui reação anterior;
* remove reação repetida;
* impede reação de não participante;
* atualiza em tempo real;
* restrição única impede duplicação.

## Edição

* autor edita texto dentro do prazo;
* outro usuário não edita;
* edição fora do prazo é recusada;
* voz não pode ser editada;
* mensagem excluída não pode ser editada;
* histórico registra conteúdo anterior;
* edição não incrementa não lidas;
* edição não dispara push.

## Exclusão

* excluir para mim afeta somente o usuário;
* excluir para todos exige autoria;
* prazo é validado no servidor;
* exclusão para todos atualiza os participantes;
* mensagem excluída não aceita edição;
* áudio excluído deixa de ser acessível;
* respostas antigas continuam renderizando com segurança.

## Mensagem de voz

* exige autenticação;
* exige participação;
* rejeita MIME inválido;
* rejeita tamanho excedido;
* rejeita duração excedida;
* salva no bucket privado;
* não expõe URL pública;
* acesso ao áudio valida participação;
* `client_message_id` impede duplicação;
* falha limpa arquivo órfão ou registra processamento;
* retentativa não duplica;
* player controla apenas um áudio por vez.

## Web Push

* inscrição exige autenticação;
* várias subscriptions por usuário são permitidas;
* endpoint duplicado não cria duplicação;
* chave privada não chega ao cliente;
* remetente não recebe push;
* edição não dispara push;
* reação não dispara push;
* exclusão não dispara push;
* retentativa idempotente não dispara push duplicado;
* subscription `404/410` é revogada;
* payload não contém dados sensíveis;
* clique abre a conversa correta;
* usuário não participante continua sem acesso mesmo manipulando a URL.

## Regressão da fase 1

Executar e preservar testes de:

* texto;
* tempo real;
* leitura;
* contador;
* paginação;
* presença;
* busca;
* idempotência;
* nova tentativa;
* responsividade.

---

# 19. VALIDAÇÃO MANUAL

Testar com dois usuários e, quando possível, dois dispositivos.

## Resposta

1. A responde uma mensagem de B;
2. B recebe em tempo real;
3. a prévia apresenta o autor e o conteúdo corretos;
4. clicar na resposta localiza a mensagem original;
5. mensagem original excluída não quebra a timeline.

## Reação

1. A reage com coração;
2. B vê a reação em tempo real;
3. A muda para legal;
4. coração é substituído;
5. A clica novamente em legal;
6. reação é removida.

## Edição

1. A envia texto;
2. A edita;
3. B vê o novo conteúdo e “editada”;
4. contador não aumenta;
5. B não consegue editar;
6. mensagem fora do prazo não pode ser editada.

## Exclusão

1. A exclui mensagem para si;
2. B continua vendo;
3. A exclui outra para todos;
4. ambos veem “Mensagem excluída”;
5. mensagem de voz excluída deixa de tocar.

## Voz

1. A concede microfone;
2. grava;
3. para;
4. ouve a prévia;
5. envia;
6. B recebe em tempo real;
7. B reproduz;
8. outra reprodução pausa a anterior;
9. simular falha;
10. tentar novamente sem duplicação.

## Push

1. B ativa notificações por ação explícita;
2. B fecha o PWA;
3. A envia texto;
4. B recebe push;
5. clicar abre a conversa;
6. A envia voz;
7. push mostra “Enviou uma mensagem de voz”;
8. edição não gera push;
9. reação não gera push;
10. testar no desktop;
11. testar no Android/PWA, se disponível;
12. testar no iPhone/iPad instalado na Tela de Início, se disponível;
13. documentar plataformas que não puderam ser testadas.

---

# 20. CRITÉRIOS DE ACEITE

A fase 2 estará concluída quando:

* mensagens de voz puderem ser gravadas, revisadas, enviadas e reproduzidas;
* áudios estiverem em armazenamento privado;
* acesso aos áudios exigir participação;
* falhas de áudio permitirem nova tentativa sem duplicação;
* respostas citadas funcionarem como no WhatsApp;
* citações localizarem a mensagem original;
* as quatro reações funcionarem em tempo real;
* cada usuário possuir no máximo uma reação por mensagem;
* textos puderem ser editados pelo autor dentro do prazo;
* mensagens editadas mostrarem “editada”;
* o histórico de edição for preservado;
* excluir para mim afetar somente o usuário;
* excluir para todos funcionar dentro do prazo;
* mensagens e áudios excluídos ficarem inacessíveis corretamente;
* novas mensagens gerarem Web Push;
* o push funcionar com o PWA fechado em plataformas suportadas;
* clicar no push abrir a conversa correta;
* permissão de notificações nunca for solicitada automaticamente;
* subscriptions inválidas forem revogadas;
* contador não lido da fase 1 continuar correto;
* Realtime, Presence e paginação continuarem funcionando;
* nenhuma funcionalidade fora do escopo tiver sido implementada;
* `docs/modulos/chat.md` estiver atualizado;
* testes, lint e build forem executados.

---

# 21. ENTREGA

Ao finalizar, apresentar:

1. resumo da implementação;
2. arquivos criados;
3. arquivos alterados;
4. migrations adicionadas;
5. tabelas, campos, constraints e índices;
6. buckets e políticas de Storage;
7. rotas e contratos;
8. funcionamento das mensagens de voz;
9. funcionamento da resposta citada;
10. funcionamento das reações;
11. regras de edição;
12. regras de exclusão;
13. funcionamento do Web Push;
14. configuração VAPID necessária;
15. alterações no service worker;
16. variáveis adicionadas ao arquivo de exemplo;
17. testes executados;
18. resultado do lint;
19. resultado do build;
20. validações manuais realizadas;
21. plataformas testadas;
22. limitações encontradas;
23. confirmação da atualização de `docs/modulos/chat.md`.

Não ocultar:

* testes com falha;
* erros de lint;
* erros de build;
* limitações de navegador;
* recursos que não puderam ser testados.

Não pare apenas na análise ou no planejamento.

Implemente, valide, teste e documente a segunda fase completa.
