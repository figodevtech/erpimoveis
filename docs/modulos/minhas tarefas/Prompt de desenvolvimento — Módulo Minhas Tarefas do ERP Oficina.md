Quero que você implemente no projeto **ERP Oficina** um novo módulo pessoal chamado **“Minhas tarefas”**, destinado a tarefas, lembretes simples e anotações privadas de cada usuário.

Antes de alterar qualquer arquivo, analise o código real do repositório e reutilize os padrões já existentes de autenticação, APIs, banco, migrations, UI, responsividade, tratamento de erros, loading states, dark mode e componentes Shadcn.

Não crie uma arquitetura paralela ao restante do sistema.

==================================================
1. OBJETIVO DO MÓDULO
==================================================

O objetivo é oferecer a cada usuário autenticado um espaço pessoal dentro do ERP para registrar:

- tarefas;
- anotações;
- coisas que precisa lembrar;
- atividades previstas para determinado dia;
- informações pessoais relacionadas ao trabalho.

Esse conteúdo é estritamente pessoal.

Exemplos:

- “Ligar para fornecedor amanhã”
- “Conferir OS 241”
- “Emitir NF-e do módulo Volvo”
- “Cliente João pediu retorno mês que vem”
- “Verificar orçamento pendente”
- “Lembrar de falar com o financeiro”

O módulo NÃO deve ser tratado como gerenciamento de projetos, gestão de equipe, delegação de tarefas ou Kanban corporativo.

A filosofia do recurso é:

**“Meu espaço pessoal dentro do ERP.”**

==================================================
2. DECISÃO IMPORTANTE: LOCAL DO ACESSO
==================================================

NÃO adicionar “Tarefas” à lista principal de módulos da sidebar.

O acesso deve ficar no menu pessoal do usuário localizado no rodapé da sidebar, onde atualmente existem opções como:

- Meu perfil
- Preferências
- Alterar senha
- Sair

O arquivo atual responsável por isso é:

`src/app/(app)/components/sidebar/components/nav-user.tsx`

Adicionar a opção:

**Minhas tarefas**

Preferencialmente utilizando um ícone Lucide apropriado, como:

- `ListTodo`
- ou equivalente coerente com a interface atual.

Posição desejada:

1. Meu perfil
2. Minhas tarefas
3. Preferências
4. Alterar senha
5. separador
6. Sair

A rota será:

`/tarefas`

Preservar o comportamento atual de `billingBlocked`.

Se “Meu perfil” e “Preferências” ficam indisponíveis quando o acesso do cliente está bloqueado por cobrança, “Minhas tarefas” deve seguir a mesma regra.

==================================================
3. NÃO CRIAR PERMISSÃO DE PERFIL
==================================================

NÃO criar algo como:

`TAREFAS_ACESSO`

ou outra permissão administrativa.

Todo usuário ativo e autenticado deve poder utilizar seu próprio espaço pessoal.

A segurança desse recurso não depende de perfil/permissão funcional.

Ela depende do isolamento por `usuario_id`.

Um administrador também NÃO deve conseguir entrar no módulo e visualizar tarefas pessoais de outros usuários.

Não criar tela administrativa de tarefas.

==================================================
4. AUTENTICAÇÃO E USUÁRIO
==================================================

O ERP atualmente utiliza NextAuth/Auth.js e disponibiliza o usuário autenticado através da sessão.

O código atual em:

`src/lib/auth.ts`

já disponibiliza:

`session.user.id`

O ID corresponde ao usuário da tabela:

`public.usuario`

e é UUID.

Todas as operações do módulo devem usar SEMPRE o ID da sessão do servidor.

NUNCA aceitar `usuario_id` enviado pelo frontend como fonte confiável.

Exemplo conceitual:

```ts
const session = await auth();
const userId = session?.user?.id;
```

O backend deve determinar o proprietário do registro.

==================================================
5. BANCO DE DADOS
==================================================

Criar uma nova migration dentro de:

`supabase/migrations`

Antes de escolher definitivamente os nomes e tipos, examine as migrations atuais e mantenha o padrão do projeto.

Sugestão de tabela:

`tarefa_usuario`

Estrutura conceitual:

```text
id
usuario_id
tipo
titulo
descricao
status
prioridade
data_prevista
lembrete_em
fixada
ordem
created_at
updated_at
completed_at
```

Ajuste nomes e tipos caso o padrão atual do banco recomende outra nomenclatura.

Requisitos mínimos:

### id

Utilizar uma estratégia compatível com o padrão atual do projeto.

### usuario_id

UUID obrigatório.

FK:

`public.usuario(id)`

com:

`ON DELETE CASCADE`

### tipo

Valores esperados:

- `TAREFA`
- `NOTA`

Pode ser CHECK ou outra abordagem consistente com o banco existente.

### titulo

Obrigatório.

Não permitir texto vazio.

Definir tamanho máximo razoável.

### descricao

Opcional.

Texto livre.

### status

Para tarefas, inicialmente basta representar:

- aberta;
- concluída.

Não criar workflow complexo.

### prioridade

Sugestão:

- `BAIXA`
- `NORMAL`
- `ALTA`

Padrão:

`NORMAL`

### data_prevista

Opcional.

Representa a data planejada da tarefa.

Evitar problemas de timezone quando a intenção for somente representar um “dia”.

Analise se o melhor tipo é `date`.

### lembrete_em

Pode existir desde já na estrutura para evolução futura, mas NÃO implementar nesta fase um mecanismo pesado de polling ou cron de lembrete.

Pode ficar nullable.

### fixada

Boolean.

Default false.

### ordem

Campo opcional/preparado para ordenação manual futura.

Não é obrigatório implementar drag-and-drop no MVP.

### timestamps

- `created_at`
- `updated_at`
- `completed_at`

Definir defaults adequados.

Ao concluir:

`completed_at = now()`

Ao reabrir:

`completed_at = null`

==================================================
6. ÍNDICES
==================================================

Criar somente índices úteis.

No mínimo considerar:

`usuario_id`

e índices compostos adequados aos filtros mais comuns, por exemplo:

- usuário + status;
- usuário + data prevista;
- usuário + created_at.

Não criar índices indiscriminadamente.

==================================================
7. RLS E PRIVACIDADE
==================================================

Este é um requisito crítico.

A tabela deve possuir Row Level Security.

Existe uma referência muito adequada no projeto:

`supabase/migrations/20260903100000_system_notification_realtime.sql`

A Central de Notificações já utiliza a ideia:

```sql
usuario_id = auth.uid()
```

Para `tarefa_usuario`, criar policies que garantam que um usuário autenticado possa:

SELECT:
somente seus próprios registros.

INSERT:
somente registros cujo `usuario_id = auth.uid()`.

UPDATE:
somente seus próprios registros.

DELETE:
somente seus próprios registros.

Mesmo que atualmente algumas operações do ERP passem pelo backend com service role, manter RLS corretamente configurado para defesa em profundidade.

Não conceder acesso global aos registros.

==================================================
8. DEFESA EM PROFUNDIDADE NAS APIS
==================================================

RLS não substitui validação na API.

Todas as queries de leitura/escrita também devem restringir por:

```ts
.eq("usuario_id", userId)
```

Exemplos:

Um usuário solicita:

`PATCH /api/tarefas/123`

A API deve fazer algo conceitualmente equivalente a:

```text
id = 123
AND usuario_id = usuário autenticado
```

Nunca:

```text
id = 123
```

sozinho.

Isso também vale para DELETE e GET individual.

Um usuário nunca pode acessar uma tarefa de outro simplesmente conhecendo o ID.

==================================================
9. ROTAS DE API
==================================================

Criar APIs seguindo o padrão atual do App Router.

Sugestão:

`src/app/api/tarefas/route.ts`

Suportando:

GET
POST

e:

`src/app/api/tarefas/[id]/route.ts`

Suportando:

GET, se necessário
PATCH
DELETE

Pode haver endpoints auxiliares caso realmente tragam benefício, mas evitar fragmentação desnecessária.

==================================================
10. GET /api/tarefas
==================================================

Deve retornar somente registros do usuário autenticado.

Suportar filtros úteis através de query params.

Exemplos conceituais:

```text
?view=hoje
?view=proximas
?view=todas
?view=notas
?view=concluidas
?q=fornecedor
```

A implementação pode utilizar parâmetros separados em vez de `view`, desde que a API fique clara.

Ordenação padrão sugerida:

1. fixadas primeiro;
2. tarefas vencidas/mais próximas;
3. data prevista;
4. criação mais recente.

Analise UX antes de decidir exatamente.

Não carregar milhares de registros sem limite.

Se necessário, implementar paginação ou limite adequado.

==================================================
11. POST /api/tarefas
==================================================

Receber somente campos editáveis pelo usuário.

Exemplo:

```json
{
  "tipo": "TAREFA",
  "titulo": "Ligar para fornecedor",
  "descricao": "",
  "prioridade": "NORMAL",
  "data_prevista": "2026-09-15"
}
```

`usuario_id` deve ser obtido no servidor.

Validar payload.

Utilizar Zod se estiver alinhado ao padrão atual do projeto.

==================================================
12. PATCH
==================================================

Permitir atualizar:

- título;
- descrição;
- tipo;
- prioridade;
- data prevista;
- fixada;
- status.

Ao marcar tarefa como concluída:

definir `completed_at`.

Ao reabrir:

limpar `completed_at`.

Uma anotação não precisa obrigatoriamente ter comportamento de conclusão.

Evitar estados incoerentes.

==================================================
13. DELETE
==================================================

Excluir somente registro do usuário autenticado.

Usar confirmação visual no frontend antes da exclusão.

==================================================
14. PÁGINA /tarefas
==================================================

Criar a página seguindo o layout atual do ERP.

Ela deve funcionar corretamente em:

- desktop;
- tablet;
- celular;
- tema claro;
- tema escuro.

Título:

**Tarefas & Anotações**

Subtítulo sugerido:

**Organize suas atividades, lembretes e anotações pessoais.**

==================================================
15. CRIAÇÃO RÁPIDA
==================================================

Essa deve ser uma das principais características do módulo.

No topo da página, exibir uma caixa simples:

**O que você precisa lembrar?**

Com input e ação de adicionar.

O usuário deve conseguir:

1. digitar o título;
2. pressionar Enter;
3. tarefa criada.

Não obrigar o preenchimento inicial de:

- prioridade;
- descrição;
- data;
- horário;
- categoria.

Esses detalhes podem ser adicionados posteriormente.

Por padrão, criação rápida gera:

```text
tipo = TAREFA
prioridade = NORMAL
status = ABERTA
```

ou nomenclatura equivalente escolhida na implementação.

==================================================
16. VISÕES / FILTROS
==================================================

A interface deve oferecer inicialmente:

### Hoje

Mostrar:

- tarefas vencidas;
- tarefas com data prevista para hoje.

Itens vencidos devem ter indicação visual discreta.

### Próximas

Tarefas futuras.

### Todas

Todas as tarefas abertas.

### Anotações

Somente itens `tipo = NOTA`.

### Concluídas

Histórico de tarefas concluídas.

### Favoritas

Pode ser implementado através de `fixada = true`.

Se considerar que “Favoritas” e “Fixadas” geram duplicidade conceitual, escolher um único termo consistente na interface.

==================================================
17. BUSCA
==================================================

Adicionar busca textual.

Pesquisar no mínimo:

- título;
- descrição.

Evitar disparar requisição a cada tecla sem controle.

Usar debounce ou filtragem client-side quando o volume carregado permitir.

==================================================
18. ITEM DA LISTA
==================================================

Cada tarefa deve apresentar de forma compacta:

- checkbox;
- título;
- data, quando houver;
- prioridade, se relevante;
- indicação de atraso;
- indicação de fixada;
- menu de ações.

Para anotações:

não exibir checkbox de conclusão como se fossem tarefas.

Permitir identificar visualmente que o item é uma anotação.

==================================================
19. PAINEL DE DETALHES
==================================================

Ao clicar em uma tarefa/anotação, não navegar obrigatoriamente para uma nova página.

Preferencialmente abrir um:

`Sheet`

lateral utilizando os componentes atuais do Shadcn.

Desktop:

painel lateral.

Mobile:

ocupar a maior parte ou toda a área útil.

Campos:

- título;
- descrição;
- tipo;
- data prevista;
- prioridade;
- fixada;
- status, quando for tarefa.

Exibir informações secundárias:

- data de criação;
- data de conclusão, quando existir.

A edição deve ser simples e confiável.

==================================================
20. CONCLUSÃO DE TAREFAS
==================================================

Checkbox deve permitir concluir rapidamente.

Depois da conclusão:

- atualizar a interface imediatamente;
- persistir no backend;
- mover/remover da visualização aberta conforme o filtro;
- aparecer em “Concluídas”.

Evitar reload completo da página.

Utilizar atualização otimista somente se houver tratamento seguro para rollback em erro.

==================================================
21. ANOTAÇÕES
==================================================

O usuário deve poder criar um item do tipo:

`NOTA`

Uma nota representa conteúdo pessoal sem obrigação de conclusão.

Exemplo:

**Cliente João prefere contato após as 14h.**

Deve permitir:

- editar;
- excluir;
- fixar;
- opcionalmente transformar em tarefa.

A transformação Nota → Tarefa é desejável caso não complique a primeira versão.

==================================================
22. TANSTACK REACT QUERY
==================================================

O projeto já possui:

`@tanstack/react-query`

Antes de usar, verifique como está configurado atualmente.

Se já existir provider/padrão estabelecido, utilize-o.

Utilizar cache e invalidação de maneira eficiente.

Evitar fazer novas requisições desnecessárias sempre que o usuário navegar entre filtros já carregados.

==================================================
23. NÃO IMPLEMENTAR POLLING AGRESSIVO
==================================================

Este requisito é importante.

O ERP passou recentemente por investigação de alto volume de requisições, Functions, Middleware, timeouts e chamadas redundantes.

Portanto:

NÃO criar algo como:

```text
setInterval(..., 5000)
```

NÃO consultar tarefas/lembretes a cada poucos segundos.

NÃO criar um novo `/api/tarefas/unread-count` sendo chamado continuamente.

NÃO adicionar polling global no `ClientAppShell`.

O módulo deve atualizar através de:

- carregamento inicial;
- mutations;
- invalidação de cache;
- refetch contextual quando realmente necessário.

==================================================
24. LEMBRETES — PREPARAR, MAS NÃO COMPLEXIFICAR
==================================================

O conceito de lembrete faz parte do módulo, mas a primeira versão NÃO precisa implementar um sistema completo de disparos agendados.

Pode existir:

`lembrete_em`

no banco, preparado para evolução.

Por enquanto, a data da própria tarefa já funciona como lembrete visual dentro da tela.

Futuramente o módulo poderá conversar com a Central de Notificações.

==================================================
25. INTEGRAÇÃO FUTURA COM CENTRAL DE NOTIFICAÇÕES
==================================================

O sistema já possui:

`NotificationCenter`

e tabela:

`system_notification`

O header atual em:

`src/app/(app)/(pages)/ClientAppShell.tsx`

já utiliza:

- NotificationCenter;
- ChatCenter;
- DateTimeBadge.

NÃO modificar essa infraestrutura sem necessidade nesta etapa.

Somente estruturar o módulo de maneira que futuramente seja possível gerar algo como:

```text
Lembrete
Ligar para fornecedor
Hoje às 15:00
```

com destino:

`/tarefas?id=123`

==================================================
26. INTEGRAÇÕES FUTURAS COM O ERP
==================================================

Não é obrigatório implementar agora, mas não criar uma arquitetura que impeça futura associação pessoal com entidades do ERP.

Exemplos futuros:

- OS;
- cliente;
- veículo;
- venda.

Exemplo:

```text
Cobrar aprovação do orçamento

OS #241
Toyota Hilux — ABC1D23
```

A tarefa continua privada.

Em uma fase futura poderá existir:

`⋯ → Criar tarefa pessoal`

dentro da Ordem de Serviço.

NÃO implementar toda essa integração agora, a menos que seja extremamente simples e sem aumentar risco.

Priorizar o MVP.

==================================================
27. WIDGET NO DASHBOARD
==================================================

NÃO é requisito obrigatório desta entrega.

Pode ser preparado conceitualmente para fase futura.

Exemplo futuro:

```text
Minhas tarefas

3 para hoje

☐ Ligar fornecedor
☐ Conferir OS #241
☐ Emitir nota

+ Nova tarefa
Ver todas
```

Não adicionar nova consulta frequente ao Dashboard nesta fase.

==================================================
28. DRAG-AND-DROP
==================================================

O projeto já possui `@dnd-kit`.

Entretanto, drag-and-drop NÃO é requisito do MVP.

O campo de ordenação pode ser preparado no banco caso faça sentido.

Não adicionar complexidade desnecessária só porque a biblioteca já existe.

==================================================
29. ESTADOS DE INTERFACE
==================================================

Implementar corretamente:

- loading;
- lista vazia;
- erro;
- criação em andamento;
- atualização;
- exclusão;
- tarefa concluída;
- nenhuma busca encontrada.

Exemplo de empty state para Hoje:

**Nenhuma tarefa para hoje.**

Complemento:

**Aproveite para organizar as próximas atividades.**

Não usar textos genéricos ou placeholders sem acabamento.

==================================================
30. RESPONSIVIDADE
==================================================

O módulo deve ser confortável no celular.

Evitar tabela tradicional.

Preferir lista/cards compactos.

No mobile:

- criação rápida acessível;
- filtros roláveis ou adaptados;
- Sheet de detalhes em largura adequada;
- ações sem depender de hover.

==================================================
31. ACESSIBILIDADE
==================================================

Garantir:

- labels;
- foco;
- navegação por teclado;
- `aria-label` quando necessário;
- botões com significado claro;
- Enter para criação rápida;
- contraste adequado.

==================================================
32. ARQUIVOS QUE PROVAVELMENTE SERÃO ENVOLVIDOS
==================================================

Confirme no código real antes de alterar.

Prováveis pontos:

```text
src/app/(app)/components/sidebar/components/nav-user.tsx

src/app/(app)/(pages)/tarefas/page.tsx

src/app/api/tarefas/route.ts

src/app/api/tarefas/[id]/route.ts

supabase/migrations/<timestamp>_tarefas_usuario.sql
```

Possivelmente também:

```text
src/app/(app)/(pages)/ClientAppShell.tsx
```

somente para adicionar o título da rota:

`/tarefas: "Tarefas & Anotações"`

Não alterar outras partes do shell sem necessidade.

Criar componentes separados se a página ficar muito grande.

Evitar um `page.tsx` monolítico.

==================================================
33. PADRÕES VISUAIS
==================================================

Respeitar integralmente:

- Shadcn UI;
- Tailwind atual;
- tema claro/escuro;
- bordas;
- espaçamentos;
- tipografia;
- componentes já utilizados no projeto;
- estilo da sidebar;
- estilo dos Sheets/Dialogs;
- toast atual;
- loading skeletons, se aplicável.

Não criar uma interface visualmente desconectada do ERP.

==================================================
34. VALIDAÇÃO DE SEGURANÇA
==================================================

Criar testes ou validações que cubram obrigatoriamente:

### Caso 1

Usuário A cria tarefa.

Usuário A consegue ler.

Usuário B NÃO consegue ler.

### Caso 2

Usuário B conhece o ID da tarefa de A.

`GET/PATCH/DELETE` não deve retornar ou modificar o registro.

### Caso 3

Frontend tenta enviar outro `usuario_id`.

Backend ignora/rejeita e utiliza o ID da sessão.

### Caso 4

Usuário não autenticado.

API retorna 401.

### Caso 5

Usuário inativo.

Seguir o comportamento de autenticação/inativação já utilizado pelo ERP.

==================================================
35. TESTES FUNCIONAIS
==================================================

Validar:

- criar tarefa rápida;
- criar anotação;
- editar título;
- editar descrição;
- definir data;
- alterar prioridade;
- fixar;
- concluir;
- reabrir;
- excluir;
- pesquisar;
- filtrar Hoje;
- filtrar Próximas;
- filtrar Todas;
- filtrar Anotações;
- filtrar Concluídas;
- abrir detalhes;
- mobile;
- desktop;
- dark mode;
- navegação pelo menu pessoal.

==================================================
36. NÃO QUEBRAR O RESTANTE DO ERP
==================================================

Não fazer refactors amplos não relacionados.

Não modificar autenticação global sem necessidade.

Não alterar regras existentes de permissões.

Não modificar NotificationCenter.

Não alterar Chat.

Não mexer em Agendamentos.

Não alterar comportamento da sidebar além da nova opção no menu pessoal.

Não introduzir polling global.

==================================================
37. MIGRATION
==================================================

A alteração no banco deve ser feita por migration versionada.

NÃO executar SQL ad-hoc sem registrar migration.

Verifique as migrations existentes antes de escolher o timestamp/nome.

A migration deve ser segura e idempotente quando o padrão do projeto permitir.

==================================================
38. QUALIDADE DE CÓDIGO
==================================================

Evitar:

- `any` desnecessário;
- componentes gigantes;
- duplicação de lógica;
- estados conflitantes;
- chamadas redundantes;
- fetch sem tratamento;
- manipulação de timezone incorreta;
- N+1 queries;
- APIs sem autenticação;
- confiar em dados enviados pelo frontend para ownership.

==================================================
39. DOCUMENTAÇÃO
==================================================

Após implementar, criar uma documentação curta do módulo, seguindo o padrão de documentação existente no repositório.

Descrever:

- objetivo;
- tabela;
- RLS;
- APIs;
- fluxo de autenticação;
- componentes;
- filtros;
- limitações atuais;
- melhorias futuras.

Registrar explicitamente que:

**tarefas e anotações são privadas por usuário.**

==================================================
40. ENTREGÁVEIS
==================================================

Ao finalizar, apresente:

1. resumo da solução;
2. arquivos criados;
3. arquivos alterados;
4. migration criada;
5. APIs criadas;
6. medidas de segurança/RLS;
7. comportamento do menu “Minhas tarefas”;
8. testes executados;
9. resultado de build/typecheck/lint/testes aplicáveis;
10. quaisquer limitações;
11. sugestões deixadas para a próxima fase.

==================================================
41. CRITÉRIOS DE ACEITE
==================================================

A implementação só deve ser considerada concluída se:

- “Minhas tarefas” aparecer no menu pessoal da sidebar abaixo de “Meu perfil”;
- não existir item Tarefas entre os módulos principais;
- qualquer usuário ativo puder acessar `/tarefas`;
- não existir necessidade de permissão `TAREFAS_ACESSO`;
- tarefas forem privadas;
- usuário A nunca acessar registros de B;
- RLS estiver habilitado;
- APIs filtrarem por usuário autenticado;
- criação rápida funcionar;
- tarefas puderem ser concluídas/reabertas;
- anotações puderem ser criadas;
- filtros principais funcionarem;
- busca funcionar;
- layout funcionar em desktop/mobile;
- dark mode estiver correto;
- nenhuma chamada periódica agressiva tiver sido adicionada;
- nenhuma funcionalidade existente do ERP tiver sido quebrada.

==================================================
42. FORMA DE TRABALHO
==================================================

Antes de escrever código:

1. inspecione os arquivos atuais;
2. confirme os padrões existentes;
3. identifique componentes reutilizáveis;
4. confira como o ERP trata autenticação e usuário inativo;
5. confira conventions das migrations;
6. confira se React Query já possui provider;
7. confira o padrão atual de toast/error handling;
8. só então implemente.

Caso algum detalhe deste prompt entre em conflito com a arquitetura real do projeto, priorize a arquitetura real, mas preserve os requisitos funcionais e de segurança.

Não invente tabelas, nomes de colunas ou abstrações sem antes conferir o código existente.

Após implementar, faça uma revisão final procurando especialmente:

- vazamento de dados entre usuários;
- queries sem `usuario_id`;
- ausência de RLS;
- polling desnecessário;
- problemas de timezone;
- chamadas duplicadas;
- comportamento mobile;
- regressões na sidebar.