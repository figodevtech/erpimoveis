# Fluxo de migrations dos bancos

Os quatro bancos usam as mesmas migrations e o mesmo schema. Somente os dados de
cada empresa são independentes.

## Stone em stand-by — 07/09/2026

Por orientação do responsável pelo projeto, a integração Stone permanece em
stand-by. A migration `20260907100000_corrigir_confirmacao_e_estorno_stone.sql`
foi aplicada somente à Demonstração antes dessa orientação. Demir, AlphaGarage
e Garage Premium permanecem na versão `20260905110000`; essa diferença é
intencional enquanto a Stone estiver em espera.

As correções de confirmação, estorno e conciliação estão preservadas no código,
com testes SQL executados na Demonstração e revertidos por rollback. As novas
rotas e os campos de pendências Stone dependem dessa migration; sua publicação
nos clientes fica adiada junto com a integração. O comando de deploy dos
clientes aplica todas as migrations pendentes, incluindo essa, e não deve ser
usado para publicar apenas a proteção de Configurações Gerais.

A proteção contra uma tela antiga alterar o modo de faturamento é independente
da Stone e não exige uma nova migration. A consulta feita após a retomada
confirmou `habilitar_faturamento_os = false` nos quatro bancos.

## Configuração local

Copie `.env.migrations.example` para `.env.migrations.local` e configure as URLs
PostgreSQL de Demonstração, Demir, AlphaGarage e Garage Premium. O arquivo local é ignorado pelo
Git. Por compatibilidade, os comandos também reconhecem as URLs antigas do
`.env.local`, identificando cada projeto pelo project ref.

## Conferência

```powershell
npm run db:status
```

O comando compara o histórico de migrations e fingerprints de relações,
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

O fluxo faz dry-run e aplica primeiro na Demonstração. Em seguida, fica parado
para permitir o teste do ERP. Somente depois da confirmação `CLIENTES` ele faz
dry-run e aplica, em sequência, no Demir, no AlphaGarage e no Garage Premium. Qualquer erro
interrompe o processo.

O fluxo também pode ser executado em duas etapas independentes:

```powershell
# Aplica somente na Demonstração
npm run db:deploy:demo

# Depois dos testes, aplica nos três bancos de clientes
npm run db:deploy:clients
```

Para automação não interativa, depois de estabelecer validações equivalentes no
pipeline:

```powershell
npm run db:deploy -- --approve-demo --approve-clients
```

Não use `--include-all` e não mova migrations novas para `migrations/old`.
