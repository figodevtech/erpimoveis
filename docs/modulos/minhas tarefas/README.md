# Módulo Minhas Tarefas — ERP Oficina

## 1. Objetivo do Módulo

O módulo **“Minhas tarefas”** oferece a cada usuário autenticado no ERP Oficina um espaço pessoal para registrar:
- Tarefas do dia a dia;
- Anotações e instruções rápidas;
- Lembretes com data prevista;
- Atividades pessoais relacionadas ao trabalho na oficina.

> [!IMPORTANT]
> **Privacidade Absoluta:** As tarefas e anotações deste módulo são **estritamente pessoais e privadas por usuário**. Nenhum outro usuário ou administrador possui acesso aos registros de terceiros. Não existe tela administrativa de tarefas.

---

## 2. Localização e Acesso

- **Acesso:** Menu pessoal do usuário no rodapé da sidebar (`nav-user.tsx`), posicionado diretamente abaixo de **Meu perfil** e acima de **Preferências**, com o ícone `ListTodo`.
- **Rota:** `/tarefas`
- **Bloqueio de Cobrança:** Segue rigorosamente a regra `billingBlocked`, ficando indisponível quando o acesso do cliente está restrito ao módulo de pagamento por pendência financeira.
- **Permissões:** Não requer permissão de perfil (ex: `TAREFAS_ACESSO`). Todo usuário ativo e autenticado pode acessar seu espaço pessoal.

---

## 3. Banco de Dados e Migration

- **Migration:** `supabase/migrations/20260914140000_tarefa_usuario.sql`
- **Tabela:** `public.tarefa_usuario`

### Estrutura dos Campos:
| Campo | Tipo | Restrições / Padrão | Descrição |
|---|---|---|---|
| `id` | `uuid` | Primary Key, `default gen_random_uuid()` | Identificador único não-sequencial |
| `usuario_id` | `uuid` | Not Null, FK `public.usuario(id) ON DELETE CASCADE` | Proprietário do registro |
| `tipo` | `text` | Check in `('TAREFA', 'NOTA')`, default `'TAREFA'` | Tipo do item |
| `titulo` | `text` | Not Null, entre 1 e 255 caracteres | Título do lembrete ou tarefa |
| `descricao` | `text` | Nullable, max 4000 caracteres | Detalhes adicionais e anotações |
| `status` | `text` | Check in `('ABERTA', 'CONCLUIDA')`, default `'ABERTA'` | Situação da tarefa |
| `prioridade` | `text` | Check in `('BAIXA', 'NORMAL', 'ALTA')`, default `'NORMAL'` | Nível de urgência |
| `data_prevista` | `date` | Nullable | Data limite/planejada no formato AAAA-MM-DD |
| `lembrete_em` | `timestamptz` | Nullable | Preparado para futura evolução com notificações |
| `fixada` | `boolean` | Not Null, default `false` | Se `true`, exibe no topo das listas |
| `ordem` | `integer` | Not Null, default `0` | Ordenação manual opcional |
| `created_at` | `timestamptz` | Not Null, default `clock_timestamp()` | Data de criação |
| `updated_at` | `timestamptz` | Not Null, default `clock_timestamp()` | Atualizado via trigger |
| `completed_at` | `timestamptz` | Nullable | Carimbado na conclusão e limpo na reabertura |

### Índices:
- `tarefa_usuario_usuario_id_idx`: Busca básica por usuário.
- `tarefa_usuario_usuario_status_idx`: `(usuario_id, status, fixada desc, data_prevista asc nulls last, created_at desc)`.
- `tarefa_usuario_usuario_tipo_idx`: `(usuario_id, tipo, fixada desc, created_at desc)`.
- `tarefa_usuario_usuario_data_prevista_idx`: `(usuario_id, data_prevista) where status = 'ABERTA'`.

---

## 4. Segurança e Row Level Security (RLS)

- **RLS Ativo:** A tabela `public.tarefa_usuario` possui RLS habilitado.
- **Policies:**
  - `SELECT`: `usuario_id = auth.uid()`
  - `INSERT`: `with check (usuario_id = auth.uid())`
  - `UPDATE`: `using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())`
  - `DELETE`: `using (usuario_id = auth.uid())`
- **Defesa em Profundidade no Backend:**
  Todas as rotas (`GET`, `POST`, `PATCH`, `DELETE`) validam `session.user.id` e incluem a cláusula `.eq("usuario_id", userId)`. Nenhuma informação de `usuario_id` enviada pelo frontend é considerada fonte confiável.
- **Usuários Inativos:** Se `ativo === false`, as APIs respondem com HTTP 403 e `{ error: "INACTIVE_USER" }`, disparando o fluxo de logout padrão do ERP.

---

## 5. Rotas de API

- `GET /api/tarefas`
  - Query Params:
    - `view`: `hoje` (padrão), `proximas`, `todas`, `notas`, `concluidas`, `favoritas`
    - `ref`: data de corte local do cliente (`AAAA-MM-DD`), imune a divergências de fuso horário UTC vs UTC-3
    - `q`: pesquisa textual em título e descrição
  - Retorno: `{ tarefas: TarefaUsuario[] }`
- `POST /api/tarefas`
  - Payload com validação Zod: `tipo`, `titulo`, `descricao`, `prioridade`, `data_prevista`, `fixada`
  - Injeção obrigatória do `usuario_id` da sessão do servidor
  - Retorno: `{ tarefa: TarefaUsuario }` (HTTP 201)
- `GET /api/tarefas/[id]`
  - Busca unitária garantindo `usuario_id = session.user.id`
- `PATCH /api/tarefas/[id]`
  - Atualização granular; carimba `completed_at` automaticamente ao concluir ou limpa ao reabrir
- `DELETE /api/tarefas/[id]`
  - Exclusão física definitiva do registro

---

## 6. Arquitetura Frontend

- **Isolamento de Cache:** Utiliza uma instância dedicada de `QueryClientProvider` em `tarefas-client.tsx`, eliminando risco de efeitos colaterais no restante do ERP.
- **Sem Polling Agressivo:** Zero `setInterval` ou chamadas periódicas globais. As atualizações ocorrem por mutations e invalidações contextuais.
- **Componentes:**
  - `QuickCreateTask`: Input de captura rápida com tecla `Enter` e alternância rápida Tarefa/Anotação.
  - `TaskItemCard`: Card compacto com checkbox para tarefas, marcador exclusivo para anotações, badges de prazos (com destaque para atrasadas), prioridade e menu de ações.
  - `TaskDetailSheet`: Painel lateral (`Sheet` do Shadcn UI) com edição detalhada de campos e confirmação de exclusão em `AlertDialog`.
  - `TaskEmptyState`: Mensagens contextuais amigáveis para cada filtro e para resultados vazios de busca.

---

## 7. Limitações Atuais e Melhorias Futuras

- **Lembretes com Notificação:** A coluna `lembrete_em` já está persistida no banco; a integração com a Central de Notificações (`system_notification`) e avisos agendados poderá ser ligada em uma fase posterior sem quebrar a modelagem.
- **Vínculos com ERP:** Preparado para receber futuramente associações opcionais com OS, clientes ou veículos.
- **Ordenação Drag-and-drop:** A coluna `ordem` existe na tabela caso se deseje ativar reordenação visual via `@dnd-kit`.
