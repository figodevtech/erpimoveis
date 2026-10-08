# Fluxo de migrations dos bancos

Para criar uma instalação independente do zero, siga
[o roteiro de novos clientes](../ROTEIRO_NOVOS_BANCOS.md). Os próximos clientes
são cadastrados em `scripts/db/clientes.json`, sem credenciais, e entram
automaticamente nos comandos gerais de atualização.

Os quatro bancos ativos (Demonstração, Demir, Garage Premium e Jean Car) usam as mesmas
migrations e o mesmo schema. Somente os dados de cada empresa são independentes.

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

## Cliente desativado — 09/09/2026

AlphaGarage foi removido dos alvos dos scripts de banco. A variável
`ERP_DB_ALPHA` não é mais necessária nem utilizada. As referências anteriores
a esse cliente neste documento são registros históricos.

## Configuração local

Copie `.env.migrations.example` para `.env.migrations.local` e configure as URLs
PostgreSQL de Demonstração, Demir, Garage Premium e Jean Car. O arquivo local é ignorado pelo
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
dry-run e aplica, em sequência, no Demir, no Garage Premium e no Jean Car. Qualquer erro
interrompe o processo.

O fluxo também pode ser executado em duas etapas independentes:

```powershell
# Aplica somente na Demonstração
npm run db:deploy:demo

# Depois dos testes, aplica nos dois bancos de clientes
npm run db:deploy:clients
```

Para automação não interativa, depois de estabelecer validações equivalentes no
pipeline:

```powershell
npm run db:deploy -- --approve-demo --approve-clients
```

Não use `--include-all` e não mova migrations novas para `migrations/old`.

## Jean Car — 08/10/2026

Jean Car participa de `db:status`, `db:deploy` e `db:deploy:clients`. A variável
`ERP_DB_JEAN_CAR` deve apontar somente para o projeto `jqpcttqzbdtsrlrsaatf`;
o carregador rejeita URLs de outro projeto. As credenciais são lidas nesta ordem:
ambiente do processo, `.env.migrations.local`, `.env.migrations` e o formato
antigo de `.env.local`. Os arquivos com credenciais não devem ser versionados.

O banco foi criado com a estrutura da Demonstração. As 331 versões já presentes
nessa estrutura foram registradas no histórico, sem reexecutar SQL antigo ou
copiar registros comerciais. O histórico registra versão e nome; não copia
os comandos SQL armazenados no banco de origem.

Para conferir apenas as migrations pendentes do Jean Car:

```powershell
npm run db:deploy:jean
```

Para aplicar somente nele:

```powershell
npm run db:deploy:jean -- --aplicar
```

O Auth é configurado separadamente no painel do novo projeto: habilite Email,
defina Site URL para o domínio do ERP e adicione `<domínio>/recuperar-senha`
em Redirect URLs. Configure SMTP para recuperação de senha em produção.
Os usuários são criados pelo ERP com `email_confirm: true`; não é necessário
desativar confirmação de e-mail.

Os 14 buckets do Storage foram criados vazios no Jean Car pela API, preservando
acesso público/privado, limites de tamanho e tipos MIME da Demonstração. Nenhum
arquivo foi copiado. O script valida o projeto de destino e não altera buckets
existentes com configuração diferente:

```powershell
npx tsx scripts/db/criar-buckets-jean.ts
npx tsx scripts/db/criar-buckets-jean.ts --aplicar
```

A primeira execução apenas confere; `--aplicar` cria os buckets ausentes.
