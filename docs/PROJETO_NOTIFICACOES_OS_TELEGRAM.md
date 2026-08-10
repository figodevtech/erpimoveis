# Projeto — notificações de ordens de serviço pelo Telegram

## 1. Objetivo

Enviar avisos internos sobre ordens de serviço para usuários da oficina pelo Telegram, com preferências individuais e sem fazer o salvamento da OS depender da disponibilidade do Telegram.

Esta primeira versão não envia mensagens a clientes. A arquitetura deve permitir adicionar WhatsApp ou outro canal no futuro sem refazer a captura de eventos de OS.

## 2. Escopo funcional

Cada usuário poderá:

- conectar e desconectar sua conta do Telegram;
- ativar ou pausar os avisos;
- escolher quais ordens deseja acompanhar;
- escolher quando deseja ser avisado;
- enviar uma mensagem de teste;
- consultar o estado da conexão e o último erro de entrega.

### 2.1. Escopo das ordens

Opções propostas:

- `TODAS`: todas as OS da empresa;
- `MINHAS`: OS criadas pelo usuário ou com serviço atribuído a ele;
- `MEU_SETOR`: OS do setor atual do usuário.

Para o MVP, `TODAS` e `MINHAS` são suficientes. `MEU_SETOR` pode entrar na mesma entrega se a consulta de destinatários não aumentar a complexidade dos testes.

### 2.2. Regra de eventos

Opções exibidas na interface:

- **Somente criação**: avisa ao criar a OS;
- **Criação e finalização**: avisa ao criar e quando chegar a `CONCLUIDO` ou `SEM_COBRANCA`;
- **Todas as mudanças**: avisa na criação e em qualquer troca real de status;
- **Personalizado**: permite selecionar criação e cada status individualmente.

Mapeamento dos status atuais:

| Código | Texto na mensagem |
| --- | --- |
| `AGUARDANDO_CHECKLIST` | Aguardando checklist |
| `ORCAMENTO` | Orçamento |
| `APROVACAO_ORCAMENTO` | Aguardando aprovação |
| `ORCAMENTO_APROVADO` | Orçamento aprovado |
| `ORCAMENTO_RECUSADO` | Orçamento recusado |
| `EM_ANDAMENTO` | Em andamento |
| `PAGAMENTO` | Aguardando pagamento |
| `SEM_COBRANCA` | Finalizada sem cobrança |
| `CONCLUIDO` | Concluída |
| `CANCELADO` | Cancelada |

`CANCELADO` não será tratado como “finalização” na opção simplificada. Ele será enviado em “Todas as mudanças” ou quando escolhido no modo personalizado.

Não deve existir aviso quando um `UPDATE` mantiver o mesmo status.

## 3. Experiência do usuário

### 3.1. Administração

Criar a seção **Configurações > Integrações > Telegram**, protegida pela permissão de edição de configurações.

Ela mostrará:

- integração ativa/inativa;
- nome do bot;
- webhook configurado ou com erro;
- última execução do processador;
- quantidade de mensagens pendentes e com falha;
- botão **Configurar webhook**;
- botão **Testar integração**;
- botão **Reprocessar falhas**.

O token do bot nunca será exibido nem salvo pelo navegador.

### 3.2. Cadastro de destinatários

Adicionar em **Configurações > Telegram** a administração dos contatos que receberão os avisos. A tela e suas APIs exigem permissão de configurações.

Fluxo de conexão:

1. O administrador seleciona o usuário do ERP, informa seu `@username` do Telegram e escolhe os avisos desejados.
2. O servidor salva as preferências e, quando solicitado, cria um código aleatório, de uso único, válido por 10 minutos.
3. O sistema abre `https://t.me/<bot>?start=<codigo>`.
4. O usuário toca em **Iniciar** no Telegram.
5. O webhook valida o código e confirma que o username recebido do Telegram é igual ao informado no ERP.
6. O webhook associa o `chat_id` ao usuário autenticado que gerou o vínculo.
7. O bot confirma a conexão e a tela administrativa passa a mostrar o contato conectado.

O `@username` identifica visualmente a conta, mas o envio utiliza o `chat_id`, pois bots não podem iniciar conversas somente pelo username. A validação conjunta do username e do código de uso único reduz o risco de vincular a pessoa errada.

Comandos mínimos do bot:

- `/start <codigo>`: concluir a conexão;
- `/status`: informar se os avisos estão ativos;
- `/parar`: pausar os avisos sem apagar o vínculo;
- `/ajuda`: mostrar instruções curtas e link para o sistema.

## 4. Formato das mensagens

Exemplo de criação:

```text
🔧 Nova ordem de serviço #154

Cliente: João da Silva
Veículo: ABC-1D23 — Mercedes Sprinter
Setor: Mecânica
Prioridade: Normal
Criada por: Lucas
Status: Aguardando checklist
```

Exemplo de mudança:

```text
🔄 OS #154 atualizada

Cliente: João da Silva
Veículo: ABC-1D23 — Mercedes Sprinter
De: Orçamento
Para: Em andamento
Alterada por: Lucas
```

Incluir um botão inline **Abrir OS** apontando para a tela autenticada do sistema.

Regras de conteúdo:

- não enviar CPF/CNPJ, telefone, observações, valores ou descrição completa no MVP;
- exibir peça ou equipamento no lugar do veículo quando aplicável;
- escapar todo conteúdo dinâmico antes de usar `parse_mode: HTML`;
- limitar campos longos para respeitar o tamanho máximo da mensagem;
- quem não estiver autenticado no ERP deverá fazer login ao abrir o link.

## 5. Arquitetura

```text
INSERT da OS / mudança de status
              │
              ▼
     trigger simples no Postgres
              │
              ▼
       evento persistido (outbox)
              │
              ▼
 processador protegido e recorrente
              │
       ┌──────┴──────┐
       ▼             ▼
 preferências    dados resumidos
       │             │
       └──────┬──────┘
              ▼
      entregas idempotentes
              │
              ▼
       Telegram Bot API
```

O trigger não chama a internet. Ele apenas registra o evento. Assim:

- criar ou atualizar uma OS continua funcionando se o Telegram estiver fora do ar;
- falhas podem ser repetidas;
- mensagens duplicadas são impedidas por chave única;
- alterações realizadas por outras rotas, RPCs ou processos automáticos também são capturadas.

### 5.1. Processamento

Criar um endpoint interno protegido por `CRON_SECRET`, executado a cada minuto pelo agendador já utilizado nas integrações do projeto.

O processador:

1. reserva eventos pendentes com bloqueio seguro para concorrência;
2. resolve os usuários elegíveis conforme preferência e escopo;
3. cria uma entrega única por evento e usuário;
4. monta a mensagem com os dados atuais/snapshot da OS;
5. chama `sendMessage` na Bot API;
6. registra sucesso, identificador da mensagem ou erro;
7. repete falhas transitórias com espera progressiva.

Política inicial de repetição: 1, 5, 15 e 60 minutos, com no máximo 5 tentativas. Em HTTP `429`, respeitar o `retry_after` informado pelo Telegram.

Erros permanentes, como bot bloqueado pelo usuário ou chat inexistente, devem marcar a entrega como falha permanente e sinalizar a conexão na tela. Um erro de formatação não deve desconectar o usuário.

## 6. Modelo de dados proposto

Os nomes podem ser ajustados ao padrão final da migration.

### 6.1. `telegram_usuario_preferencia`

| Campo | Finalidade |
| --- | --- |
| `usuario_id uuid PK/FK` | Usuário do ERP |
| `chat_id bigint UNIQUE` | Destino privado no Telegram |
| `telegram_user_id bigint` | Identificador do usuário no Telegram |
| `telegram_username text` | Username informado no ERP e confirmado pelo webhook |
| `telegram_nome text` | Nome retornado pelo Telegram |
| `vinculado_em timestamptz` | Data da conexão |
| `ativo boolean` | Pausa geral |
| `modo text` | `CRIACAO`, `CRIACAO_FINALIZACAO`, `TODOS`, `PERSONALIZADO` |
| `escopo text` | `TODAS`, `MINHAS`, `MEU_SETOR` |
| `notificar_criacao boolean` | Usado no modo personalizado |
| `status_selecionados text[]` | Status escolhidos |
| `ultimo_erro text` | Diagnóstico visível e limitado |
| `updated_at timestamptz` | Auditoria técnica |

Aplicar `CHECK` para modos, escopos e status aceitos. Não usar `username` como chave, pois ele é opcional e mutável.

### 6.2. `telegram_vinculo_token`

| Campo | Finalidade |
| --- | --- |
| `id uuid PK` | Identificador interno |
| `usuario_id uuid FK` | Dono do vínculo |
| `token_hash text UNIQUE` | Somente hash do código enviado no link |
| `expires_at timestamptz` | Validade de 10 minutos |
| `used_at timestamptz` | Impede reutilização |
| `created_at timestamptz` | Auditoria |

Ao gerar um novo código, invalidar os anteriores ainda abertos para o mesmo usuário.

### 6.3. `os_notificacao_evento`

| Campo | Finalidade |
| --- | --- |
| `id bigint identity PK` | Evento monotônico |
| `ordemservico_id integer FK` | OS relacionada |
| `tipo text` | `CRIADA` ou `STATUS_ALTERADO` |
| `status_anterior text` | Nulo na criação |
| `status_novo text` | Estado resultante |
| `ator_usuario_id uuid` | Usuário da sessão, quando disponível |
| `snapshot jsonb` | Dados mínimos para mensagem/auditoria |
| `status_processamento text` | `PENDENTE`, `PROCESSANDO`, `PROCESSADO`, `ERRO` |
| `tentativas integer` | Controle do worker |
| `disponivel_em timestamptz` | Repetição e pequeno atraso após criação |
| `locked_at timestamptz` | Recuperação de worker interrompido |
| `created_at timestamptz` | Momento do evento |

Na criação, usar pequeno atraso antes do envio. Se a criação composta falhar e a OS for removida pela rota atual, o evento relacionado deve ser removido antes de ficar disponível.

### 6.4. `os_notificacao_entrega`

| Campo | Finalidade |
| --- | --- |
| `id bigint identity PK` | Entrega |
| `evento_id bigint FK` | Evento de origem |
| `usuario_id uuid FK` | Destinatário |
| `chat_id bigint` | Snapshot do destino |
| `status text` | `PENDENTE`, `ENVIANDO`, `ENVIADO`, `ERRO`, `DESCARTADO` |
| `tentativas integer` | Número de tentativas |
| `next_retry_at timestamptz` | Próxima tentativa |
| `telegram_message_id bigint` | Retorno do Telegram |
| `erro_codigo text` | Código resumido |
| `erro_mensagem text` | Mensagem sanitizada |
| `sent_at timestamptz` | Data de entrega |
| `created_at timestamptz` | Criação |

Criar restrição `UNIQUE (evento_id, usuario_id)`. Essa é a principal garantia contra duplicidade.

### 6.5. `telegram_webhook_update`

Guardar somente `update_id`, data e resultado por um período curto para impedir o processamento repetido do mesmo webhook. Não é necessário persistir todo o conteúdo recebido.

## 7. Endpoints propostos

### Integração e administração

- `POST /api/integracoes/telegram/webhook`: recebe comandos do bot;
- `POST /api/integracoes/telegram/processar`: processa a fila, protegido por segredo;
- `GET /api/integracoes/telegram/status`: diagnóstico administrativo;
- `GET|PUT|DELETE /api/integracoes/telegram/destinatarios`: lista, salva e remove contatos;
- `POST /api/integracoes/telegram/destinatarios/vinculo`: gera o link temporário de um contato;
- `POST /api/integracoes/telegram/destinatarios/teste`: envia uma mensagem de teste ao contato;
- `POST /api/integracoes/telegram/configurar-webhook`: registra URL e segredo no Telegram;
- `POST /api/integracoes/telegram/reprocessar`: recoloca falhas elegíveis na fila.

As rotas administrativas exigem permissão de configurações; gravações exigem `configuracoes:editar`.

## 8. Segurança e privacidade

- guardar `TELEGRAM_BOT_TOKEN` apenas como segredo do servidor;
- validar `X-Telegram-Bot-Api-Secret-Token` em todo webhook;
- usar HTTPS e URL pública fixa;
- armazenar somente hash dos códigos de vínculo;
- código aleatório com entropia suficiente, expiração e uso único;
- deduplicar `update_id` do Telegram;
- nunca confiar em `username`, nome ou texto recebido para autorizar vínculo;
- escapar HTML e não registrar token, código de vínculo ou payload completo em logs;
- aplicar RLS sem acesso direto do navegador às tabelas técnicas;
- limitar geração de vínculo e mensagem de teste por usuário;
- registrar na auditoria conexão, desconexão e alteração de preferências;
- remover ou anonimizar o vínculo quando o usuário for excluído; usuário inativo não recebe avisos.

## 9. Variáveis e configuração externa

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_NOTIFICATIONS_ENABLED=true
APP_URL=https://endereco-publico-do-erp
CRON_SECRET=
```

Passos fora do código:

1. Criar o bot oficial da Figo pelo `@BotFather` usando `/newbot`.
2. Definir nome, username, foto e descrição.
3. Guardar o token nos ambientes de desenvolvimento/homologação/produção.
4. Usar bots separados por ambiente para evitar que testes cheguem a usuários reais.
5. Publicar a aplicação com HTTPS.
6. Registrar o webhook com a URL de produção e o segredo.
7. Configurar a execução recorrente do processador.

## 10. Observabilidade e operação

O painel administrativo deve permitir responder rapidamente:

- o Telegram está configurado?
- o webhook recebeu evento recentemente?
- quando o processador rodou pela última vez?
- quantas entregas estão pendentes ou falharam?
- qual foi o último erro, sem expor segredo ou conteúdo sensível?

Logs devem conter identificadores internos de evento/entrega/OS, duração, tentativa e código HTTP, mas não o token do bot.

Definir limpeza periódica:

- updates de webhook: 7 dias;
- entregas enviadas: 90 dias, ou prazo definido pela política de auditoria;
- tokens expirados: 24 horas;
- eventos sem entrega: manter pelo mesmo prazo das entregas para diagnóstico.

## 11. Testes obrigatórios

### Banco

- cria exatamente um evento ao inserir uma OS;
- cria evento somente quando o status realmente muda;
- preserva status anterior e novo;
- não deixa evento órfão de uma OS removida durante falha de criação;
- reserva concorrência sem dois workers processarem o mesmo evento.

### Regras

- cada modo de preferência seleciona os eventos corretos;
- `CONCLUIDO` e `SEM_COBRANCA` contam como finalização;
- `CANCELADO` segue sua regra separada;
- escopos `TODAS`, `MINHAS` e `MEU_SETOR` selecionam corretamente;
- usuários inativos, desconectados ou pausados não recebem;
- evento e usuário geram no máximo uma entrega.

### API e segurança

- webhook rejeita segredo inválido;
- código expirado, usado ou incorreto não vincula conta;
- um `chat_id` não pode ficar vinculado a dois usuários;
- repetição do mesmo `update_id` é inofensiva;
- usuário não altera preferências de outra pessoa;
- HTML vindo de cliente, veículo ou equipamento é escapado.

### Entrega

- sucesso grava `message_id` e data;
- timeout e erro 5xx são repetidos;
- `429` respeita `retry_after`;
- bot bloqueado gera erro permanente e aviso na interface;
- indisponibilidade do Telegram não impede criar ou atualizar uma OS.

## 12. Fases de implementação

### Fase 1 — Base confiável

- migration das tabelas, índices, constraints, RLS e funções de reserva;
- trigger de criação/mudança de status;
- módulo servidor para Telegram, formatação e repetição;
- webhook, processador e variáveis de ambiente;
- testes unitários e SQL da fila.

### Fase 2 — Conexão e preferências

- cadastro de destinatários em Configurações > Telegram;
- vínculo seguro por deep link;
- modos de evento e escopo;
- teste de mensagem e desconexão;
- auditoria das alterações.

### Fase 3 — Administração e operação

- página de diagnóstico;
- reprocessamento de falhas;
- métricas e limpeza;
- documentação operacional;
- teste completo em bot de homologação antes de produção.

Estimativa técnica para uma entrega completa e validada: 4 a 6 dias úteis. Um MVP restrito a um grupo único, sem preferências individuais e sem painel, seria mais rápido, mas não atende ao nível de personalização e rastreabilidade definido aqui.

## 13. Critérios de aceite do MVP

O MVP estará pronto quando:

1. um usuário conseguir conectar o próprio Telegram sem informar `chat_id`;
2. conseguir selecionar “somente criação”, “criação e finalização” ou “todas as mudanças”;
3. receber mensagem de criação e status conforme a preferência;
4. a mensagem identificar OS, cliente, alvo, setor, status e possuir link para abrir a OS;
5. uma falha do Telegram não afetar a alteração da OS;
6. falhas transitórias forem repetidas e mensagens não forem duplicadas;
7. administradores conseguirem ver a saúde da integração e reprocessar falhas;
8. tokens e segredos não aparecerem no navegador, banco público ou logs;
9. os testes de banco, regras e API passarem em homologação.

## 14. Decisões recomendadas

- Público inicial: somente usuários internos da oficina.
- Destino inicial: conversa privada; grupos ficam para uma segunda etapa.
- Preferência: administrada por contato em Configurações > Telegram.
- Finalização: `CONCLUIDO` e `SEM_COBRANCA`.
- Cancelamento: evento separado.
- Captura: trigger/outbox no Postgres.
- Entrega: worker recorrente com idempotência e repetição.
- Token: somente em variável secreta do servidor.
- Custo recorrente do Telegram: zero no volume esperado, usando os limites normais do Bot API.
