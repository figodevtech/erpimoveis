# Fluxo de migrations dos bancos

Os bancos ativos (Demonstração, Demir, Garage Premium, Jean Car e HG Comércio e
Serviços) usam as mesmas migrations e o mesmo schema. Somente os dados de cada
empresa são independentes. A lista fica em `DATABASES`/`DATABASE_KEYS`, em
`scripts/db/lib.ts`: cliente novo entra ali e passa a valer para o deploy, o
`db:status`, os testes de migration e o `fiscal:difal`.

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

## Clientes adicionados — 13/10/2026

Jean Car (`jqpcttqzbdtsrlrsaatf`, variável `ERP_DB_JEAN_CAR`) e HG Comércio e
Serviços (`nxbociyfidsyepkyhcqw`, variável `ERP_DB_HG`) entraram nos alvos dos
scripts de banco. Os dois projetos ficam em `us-east-1`.

Os dois foram criados por um dump **só de estrutura** com o histórico de
migrations junto: o deploy os vê em dia, mas as cargas de dados das migrations
nunca rodaram neles. Para um banco nesse estado:

```powershell
npm run db:carregar:catalogos -- jeancar            # simula, nada gravado
npm run db:carregar:catalogos -- jeancar --aplicar  # grava
npm run fiscal:difal -- --todos --aplicar
npm run fiscal:ncm -- jeancar --aplicar
npm run radios:sincronizar:todos-bancos
```

O `db:carregar:catalogos` grava só em tabela vazia, em duas etapas:

- **Catálogo:** a linha igual, id inclusive, em pelo menos dois de
  Demonstração, Demir e Garage Premium (DRE padrão, classificações, tabelas da
  reforma tributária, tipos de entrada/saída/documento/ajuste, grupos de uso e
  consumo, termos de impressão). Linha com o mesmo conteúdo e id diferente em
  cada banco (`CONSUMO_EM_OS`) entra com o id do Demir.
- **Plano de contas:** grupos, contas e categorias ativos do Demir, com o
  mapeamento da DRE e as regras de reclassificação — decisão de 13/10/2026 para
  Jean Car e HG. O mapeamento aponta para `dre_linha` por id, que não é igual
  em todo banco (11.1 e 11.2 são 45/46 na Demonstração e 55/56 nos clientes),
  então é traduzido pelo código da linha.

Unidades de medida ficam de fora (cada oficina cadastra as suas), assim como o
que depende da empresa cadastrada: `nfe_config`, NFS-e e SPED.

## Configuração local

Copie `.env.migrations.example` para `.env.migrations.local` e configure as URLs
PostgreSQL de cada banco. O arquivo local é ignorado pelo Git. Na falta da
variável, os comandos procuram a `DATABASE_URL` do projeto — ativa ou comentada —
no `.env.local` e no `.env`, identificando cada projeto pelo project ref.

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
dry-run e aplica, em sequência, em cada banco de cliente. Qualquer erro
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
