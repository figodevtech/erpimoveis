# ERP Imóveis

ERP de gestão de imóveis da **Cespedes Living Hospedagens**, administradora de
flats de terceiros em João Pessoa/PB.

> **Estado atual:** o código partiu de uma base de ERP para oficinas e está sendo
> podado e adaptado para o domínio de imóveis. As telas e APIs de OS, veículos,
> desmanche, orçamentos de oficina, aluguel de bens e agendamentos já foram
> retiradas. As tabelas específicas desses módulos foram excluídas após o
> desacoplamento das rotinas compartilhadas. Estoque, vendas/PDV, marketplace e
> fiscal ainda permanecem.
>
> A situação do banco, o administrador inicial, o contrato do site e a sequência
> proposta dos novos módulos estão em [docs/transicao-erp-imoveis.md](docs/transicao-erp-imoveis.md).

## Stack

| Categoria | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Linguagem | TypeScript |
| Estilo | Tailwind CSS 4, shadcn/ui |
| Banco e storage | Supabase (PostgreSQL) |
| Autenticação | NextAuth.js v5 |
| Dados no cliente | TanStack Query |
| Deploy | Vercel |

## Início rápido

Requisitos: Node.js 24.x (veja `.nvmrc`) e acesso ao projeto Supabase do ERP.

```bash
git clone https://github.com/figodevtech/erpimoveis.git
cd erpimoveis
npm install
cp .env.example .env.local   # preencha com as credenciais do ambiente
npm run dev                  # http://localhost:3000
```

No PowerShell com scripts bloqueados, use `npm.cmd` no lugar de `npm`.

## Banco de dados

Migrations ficam em `supabase/migrations/`. O fluxo de conferência e deploy
está em [docs/database-migrations.md](docs/database-migrations.md):

```bash
npm run db:status   # compara o histórico local com o banco
npm run db:deploy   # dry-run, confirmação e aplicação
```

## Estrutura

```
src/
├── app/
│   ├── (app)/        # área autenticada (páginas e telas de impressão)
│   ├── (pages)/      # páginas públicas (login, recuperação de senha)
│   └── api/          # rotas de API
├── components/       # componentes compartilhados (ui/ = shadcn)
├── lib/              # regras de negócio e integrações
├── services/
└── hooks/
supabase/             # migrations, testes SQL e edge functions
scripts/              # banco, testes e utilitários de desenvolvimento
```

## Projetos relacionados

- [site-cespedesliving](https://github.com/figodevtech/site-cespedesliving):
  site público de hospedagem. O contrato de dados que ele espera do ERP está no
  `CODEX_BRIEF.md` daquele repositório.
