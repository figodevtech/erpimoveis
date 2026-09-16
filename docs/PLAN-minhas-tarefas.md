# Plano de Implementação — Módulo Minhas Tarefas (ERP Oficina)

> Este documento registra o plano de trabalho e tarefas para o módulo pessoal de Tarefas e Anotações no ERP Oficina.

## Tipo de Projeto
- **WEB** (Next.js 15 App Router, React 19, Tailwind CSS v4, Shadcn UI, Supabase / PostgreSQL).
- Agentes designados: `orchestrator`, `backend-specialist` (APIs e Migrations), `frontend-specialist` (UI/UX e Componentes), `test-engineer` (Testes).

## Decisões Arquiteturais Confirmadas
- **React Query:** Instância dedicada (`QueryClientProvider`) encapsulada na rota `/tarefas`, garantindo isolamento total em relação ao resto da aplicação.
- **Timezone:** Coluna `DATE` no Postgres + query param `?ref=YYYY-MM-DD` com a data local do navegador, eliminando divergências de fuso horário UTC vs UTC-3.
- **Conclusão:** Strikethrough imediato com feedback via toast e remoção graciosa da visualização aberta.
- **Segurança:** Isolamento restrito por `usuario_id` extraído exclusivamente da sessão do servidor (`auth()`), sem criação de permissão funcional tipo `TAREFAS_ACESSO`. RLS ativo para `authenticated`.

## Tarefas de Execução

### Fase 1: Banco de Dados & RLS
- [ ] Criar migration `supabase/migrations/20260914140000_tarefa_usuario.sql` com tabela, índices, trigger de `updated_at` e policies de RLS.
- [ ] Validar conformidade de migrations usando `npm run db:status`.

### Fase 2: Backend & Endpoints de API
- [ ] Implementar `src/app/api/tarefas/route.ts` (GET com filtros, busca e ordenação; POST com validação Zod e injeção do `usuario_id` da sessão).
- [ ] Implementar `src/app/api/tarefas/[id]/route.ts` (PATCH para edição e conclusão; DELETE para exclusão com conferência de propriedade).

### Fase 3: Navegação e Shell
- [ ] Atualizar `src/app/(app)/components/sidebar/components/nav-user.tsx` inserindo "Minhas tarefas" com ícone `ListTodo` abaixo de "Meu perfil".
- [ ] Atualizar `src/app/(app)/(pages)/ClientAppShell.tsx` registrando o título de rota para `/tarefas`.

### Fase 4: Frontend & Experiência do Usuário
- [ ] Criar `src/app/(app)/(pages)/tarefas/page.tsx` (Metadata e Server Component wrapper).
- [ ] Criar `src/app/(app)/(pages)/tarefas/tarefas-client.tsx` com `QueryClientProvider` isolado e estado de abas/filtros.
- [ ] Criar `src/app/(app)/(pages)/tarefas/components/quick-create-task.tsx` (Criação rápida com Enter).
- [ ] Criar `src/app/(app)/(pages)/tarefas/components/task-item-card.tsx` (Card de tarefa/nota, badges, menus).
- [ ] Criar `src/app/(app)/(pages)/tarefas/components/task-detail-sheet.tsx` (Painel lateral Sheet com edição completa e AlertDialog).
- [ ] Criar `src/app/(app)/(pages)/tarefas/components/task-empty-state.tsx` (Empty states elegantes).

### Fase 5: Validação, Testes e Documentação
- [ ] Criar `src/app/api/tarefas/tarefas.test.ts` validando os 5 cenários de segurança e isolamento.
- [ ] Rodar validação de linters e testes do projeto (`npm run lint`, `npm run test:negocio`).
- [ ] Documentar o módulo em `docs/modulos/minhas tarefas/README.md`.
