# Fluxo de migrations dos bancos

Os quatro bancos usam as mesmas migrations e o mesmo schema. Somente os dados de
cada empresa são independentes.

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
