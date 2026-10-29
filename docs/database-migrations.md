# Fluxo de migrations do banco

Este ERP tem um único banco: o projeto Supabase da Cespedes Living
(`hchntifztkbopchpvstd`, variável `ERP_DB_CESPEDES`). Ele é o único item de
`DATABASES`, em `scripts/db/lib.ts`, e por isso o único alvo do deploy, do
`db:status`, dos testes de migration e do `fiscal:difal`.

Nenhum banco do ERP de oficina, ou dos clientes dele, pode ser cadastrado em
`DATABASES`: os comandos de deploy aplicam migrations em todos os bancos da
lista.

## Configuração local

Copie `.env.migrations.example` para `.env.migrations.local` e preencha a URL
PostgreSQL do banco. O arquivo local é ignorado pelo Git. Na falta da variável,
os comandos procuram a `DATABASE_URL` do projeto (ativa ou comentada) no
`.env.local` e no `.env`, identificando o projeto pelo project ref. Uma URL de
outro projeto é rejeitada.

As credenciais são lidas nesta ordem: ambiente do processo,
`.env.migrations.local`, `.env.migrations` e `DATABASE_URL` do `.env.local`/`.env`.

## Conferência

```powershell
npm run db:status
```

O comando compara o histórico de migrations e lista fingerprints de relações,
colunas, constraints, índices, triggers, políticas/RLS, enums, sequências,
Realtime e funções. Ele não compara dados das tabelas.

## Deploy

Crie sempre uma migration nova na pasta principal:

```powershell
npx supabase migration new nome_da_alteracao
```

Depois execute:

```powershell
npm run db:deploy
```

O fluxo faz dry-run, pede a confirmação `APLICAR`, aplica as migrations
pendentes e confere o histórico em seguida. Qualquer erro interrompe o processo.

Para automação não interativa, depois de estabelecer validações equivalentes no
pipeline:

```powershell
npm run db:deploy -- --approve
```

Não use `--include-all` e não mova migrations novas para `migrations/old`.

## Adaptação para imóveis e primeiro acesso

A migration `20261029152806_desacoplar_modulos_oficina.sql` alinhou o catálogo de
permissões e o Realtime à remoção inicial dos módulos de oficina. A migration
`20261029154534_excluir_agendamentos_e_legado_oficina.sql` remove agendamentos e
exclui fisicamente 46 tabelas, após desacoplar as rotinas compartilhadas. O
inventário e as decisões de compatibilidade estão em
[transicao-erp-imoveis.md](transicao-erp-imoveis.md).

O administrador inicial é configurado separadamente, com o e-mail explícito do
único usuário existente. Isso evita promover automaticamente usuários em futuras
instalações ao reaplicar o histórico de migrations.

```powershell
npm.cmd run db:test:base-imoveis -- --email <email-do-unico-usuario>
npm.cmd run db:admin:inicial -- --email <email-do-unico-usuario> --aplicar
```

O teste executa as alterações em rollback. A configuração do administrador
recusa um banco com múltiplos usuários e exige o catálogo de permissões já
ajustado. Faça novo login para atualizar as permissões na sessão.

O teste atual valida a migration de exclusão, as views compartilhadas, o
administrador e fluxos reais de abono, baixa, estorno e eventos de vendas. Os
cadastros necessários são criados temporariamente e toda a transação é revertida.
