# Estoque Geral/Avulso

> **IMPORTANTE:** antes de modificar qualquer parte dos estoques simples, leia este
> documento integralmente. Depois de qualquer alteração funcional, estrutural,
> visual, no banco, nas APIs ou nas regras de autorização, atualize esta
> documentação no mesmo conjunto de mudanças.

Os termos usados nas seções são:

- **Implementado:** existe no código e faz parte do contrato atual.
- **Planejado:** evolução conhecida, mas sem implementação ou contrato nesta fase.
- **Fora do escopo:** recurso deliberadamente ausente na fase atual.
- **Limitação conhecida:** comportamento implementado de forma parcial por uma restrição registrada.

## Objetivo e escopo atual

O ERP tem três estoques:

| Estoque | Tabelas | Consumido por |
|---|---|---|
| Produtos de venda | `produto`, `entrada`, `estoque_saida`, `estoque_movimento` | venda e ordem de serviço |
| Uso e consumo | `usoconsumo_*` com `escopo = 'USOCONSUMO'` | só entrada e saída |
| **Geral/Avulso** | `usoconsumo_*` com `escopo = 'GERAL'` | só entrada e saída |

Os dois últimos são chamados aqui de **estoques simples**: não têm venda, não entram
em OS e não têm motor fiscal próprio de saída. São funcionalmente idênticos entre si
— mesmo cadastro, mesmo bloco fiscal, mesmo fluxo, mesmas etiquetas, mesma presença
na NF-e avulsa e nos relatórios. **A única diferença é o nome e o fato de os saldos
serem independentes.**

### Implementado

- cadastro de item com bloco fiscal completo, por estoque;
- entrada manual, entrada fiscal por XML e entrada fiscal mista (rateada com produto);
- saída por motivo, ajuste de inventário e cancelamento de entrada e de saída;
- histórico com filtros, autores e indicador de lançamento financeiro, por estoque;
- impressão de etiqueta, vínculo de etiqueta ao item e movimentação por leitura de QR Code;
- emissão de NF-e pelo motor avulso, com item de qualquer um dos dois estoques simples;
- relatório de movimentação por estoque;
- rota `/estoque/geral`, item de menu e guarda de middleware.

### Fora do escopo

Venda, ordem de serviço, orçamento e PDV não consomem estoque simples. Não existe
preço de venda no cadastro — só custo. Não existe "mover item de um estoque para o
outro": o escopo é definido no cadastro e não é editável, porque trocá-lo mudaria de
estoque um saldo que já tem histórico.

### Limitações conhecidas

- Não existe emissão de NF-e a partir de uma entrada ou de uma saída de estoque
  simples — nem para uso e consumo, nem para o geral. Ver "Planejado".

### Planejado

Motor fiscal de entrada/saída para os estoques simples. Hoje só o estoque de produtos
tem: `/api/entradas/[id]/produtos-para-nfe`, `/xml`, `/danfe` do lado da entrada, e
`/api/estoque/saidas/[id]/fiscal`, `/espelho-fiscal`, `/produtos-para-nfe`,
`/api/nfe/por-saida/[id]` e [`nfeSaidaService.ts`](../../src/services/fiscal/nfeSaidaService.ts)
do lado da saída, sobre as tabelas `estoque_saida_fiscal` / `estoque_saida_item_fiscal`
e a FK `nfe.saidaid`.

Levar isso para os estoques simples exigiria, no mínimo: tabelas
`usoconsumo_saida_fiscal` / `usoconsumo_saida_item_fiscal`, uma FK nova em `nfe`
(hoje `saidaid` aponta para `estoque_saida`), um serviço espelhando `nfeSaidaService`,
espelho fiscal, DANFE, cancelamento e o tratamento de CFOP de saída para mercadoria
que entrou como uso e consumo — [`cfopDevolucao.ts`](../../src/lib/nfe/cfopDevolucao.ts)
e [`difal.ts`](../../src/lib/nfe/difal.ts) já têm parte dessa lógica. É um projeto
próprio, não um ajuste deste módulo.

## Decisões técnicas relevantes

### Decisão: uma coluna `escopo`, não tabelas duplicadas

**Motivo:** `transacao.usoconsumo_entrada_id` e
`fiscal_dfe_item_apropriacao.usoconsumo_entrada_id` já apontam para
`usoconsumo_entrada`. Duplicar as tabelas exigiria uma segunda FK em `transacao` e a
propagação dela por DRE, fluxo de caixa, competência
(`tg_transacao_competencia_entrada`), reparcelamento, baixa parcial e entrada fiscal
mista — pelo menos oito migrações financeiras e vários serviços.

**Alternativas consideradas:** copiar as nove tabelas `usoconsumo_*` com prefixo
próprio, junto com rotas, componentes e permissões.

**Impactos e limitações:** o financeiro não mudou uma linha e o
`sourceItemId = "usoconsumo:{id}"` da NF-e avulsa continua válido, porque o espaço de
ids é o mesmo. Em troca, toda consulta ao módulo precisa filtrar por escopo — quem
esquecer o filtro mistura os dois estoques.

### Decisão: cadastros e permissões compartilhados

**Motivo:** decisão de negócio. Grupos (`usoconsumo_grupo`), tipos de entrada
(`tipos_entrada` escopo `USOCONSUMO`), motivos de saída (`tipos_motivo_saida` escopo
`USOCONSUMO`) e as permissões `usoconsumo:*` valem para os dois estoques simples.

**Impactos e limitações:** nenhuma permissão nova foi criada, nenhum perfil precisou
de backfill e nenhum CHECK de escopo de `tipos_entrada`/`tipos_motivo_saida` mudou.
Em troca, **quem tem `usoconsumo:visualizar` vê os dois estoques** — não há como
liberar um e bloquear o outro por perfil.

### Decisão: `MISTO` no cabeçalho da entrada

**Motivo:** a NF-e de um fornecedor mistura o que quiser, e os três destinos precisam
estar sempre disponíveis por linha. Mas uma nota **não pode virar duas entradas**:
`usoconsumo_entrada_chave_uk` é UNIQUE em `chave_nfe` globalmente, não por escopo, e
`usoconsumo_entrada_dfe_uk` idem para o documento. Derrubar esses índices abriria a
porta para a mesma nota ser lançada duas vezes — que é o que eles impedem. Soma-se a
isso a coluna única `transacao.usoconsumo_entrada_id`.

**Alternativas consideradas:** uma entrada por estoque (barrada pelos índices); uma
tabela de ligação entre transação e entrada (propagaria por DRE, fluxo de caixa,
competência e cancelamento).

**Impactos e limitações:** uma nota, uma entrada — com `escopo = 'MISTO'` quando ela
tem item dos dois estoques simples. **A verdade sobre a qual estoque um saldo pertence
continua sendo `usoconsumo_item.escopo`**; o cabeçalho só resume, para filtro e rótulo.
Em troca, todo filtro de cabeçalho por estoque precisa usar
[`escoposDoCabecalho`](../../src/lib/usoconsumo/api.ts) (`.in`, não `.eq`), senão a
nota mista some de uma das abas. `usoconsumo_saida` **não** tem `MISTO`: a saída sempre
parte de uma página de estoque.

### Decisão: `escopo` ao lado de `inventory`, não dentro dele

**Motivo:** os componentes compartilhados de estoque já tinham
`inventory: "produto" | "usoconsumo"`, que endereça a **tabela** e o **endpoint**.
Como os dois estoques simples dividem tabela e endpoint, transformar `inventory` em
três valores obrigaria a revisar todo `inventory === "usoconsumo"` do módulo.

**Impactos e limitações:** `inventory` continua com dois valores e ganhou uma prop
`escopo` ao lado, usada só quando `inventory` é `"usoconsumo"`. Quem ler o código
precisa saber que os dois significam coisas diferentes — está comentado em cada
declaração.

### Decisão: `geral:{id}` como prefixo de origem na NF-e avulsa

**Motivo:** `nfe_item.produtoid` tem FK para `produto(id)` e não comporta o id de um
item de estoque simples. A origem viaja como texto em `sourceItemId`, dentro de
`tributacao_snapshot`.

**Impactos e limitações:** `usoconsumo:{id}` continua significando uso e consumo, o
que mantém as notas antigas corretas sem migração de dados — elas são todas de uso e
consumo, porque foram gravadas antes do estoque geral existir.

## Modelo de dados

São duas migrações:
[`20260826120000_estoque_geral_avulso.sql`](../../supabase/migrations/20260826120000_estoque_geral_avulso.sql)
criou o escopo, e
[`20260827120000_entrada_fiscal_tres_destinos.sql`](../../supabase/migrations/20260827120000_entrada_fiscal_tres_destinos.sql)
abriu o cabeçalho da entrada para `MISTO`.

`usoconsumo_item`, `usoconsumo_entrada` e `usoconsumo_saida` ganharam:

```sql
escopo text NOT NULL DEFAULT 'USOCONSUMO' CHECK (escopo IN ('USOCONSUMO','GERAL'))
-- usoconsumo_entrada, depois de 20260827120000:
escopo text NOT NULL DEFAULT 'USOCONSUMO' CHECK (escopo IN ('USOCONSUMO','GERAL','MISTO'))
```

O `DEFAULT` fez o backfill das linhas existentes e **é mantido de propósito**:
qualquer chamada que não informe escopo continua caindo em uso e consumo.

Índices: `escopo` virou a primeira coluna de `usoconsumo_item_status_idx`,
`usoconsumo_item_grupo_idx`, `usoconsumo_entrada_created_idx` e
`usoconsumo_saida_created_idx`; entrou o novo `usoconsumo_item_escopo_idx`.

**`usoconsumo_item_etiqueta_uk` e `usoconsumo_item_codigo_uk` não mudaram.** Etiqueta
e código de barras seguem únicos na tabela inteira, o que preserva o trigger global
[`validar_etiqueta_inventario_global`](../../supabase/migrations/20260729143000_enforce_shared_inventory_labels.sql)
sem alteração e garante que uma etiqueta lida nunca seja ambígua entre os três
estoques.

### Coerência item ↔ cabeçalho

Uma entrada/saída de escopo `GERAL` só aceita itens de escopo `GERAL`. A validação
está nas RPCs (o `SELECT` do item filtra por escopo) **e** em
`usoconsumo_validar_escopo_movimento`, trigger `AFTER INSERT` em
`usoconsumo_entrada_item` e `usoconsumo_saida_item` — a rede de segurança, no mesmo
espírito de `usoconsumo_proteger_saldo`.

### Funções recriadas

`criar_item_usoconsumo`, `registrar_entrada_usoconsumo`, `registrar_saida_usoconsumo`
e `ajustar_inventario_usoconsumo` passaram a ler e gravar escopo. Cada uma partiu da
definição **mais recente**, não da original.

Ficaram de fora de propósito:

- `registrar_entrada_fiscal_mista` — repassa `p_entrada_usoconsumo` inteiro para
  `registrar_entrada_usoconsumo`, então o escopo flui sozinho;
- `cancelar_entrada_usoconsumo` e `cancelar_saida_usoconsumo` — o escopo vem da linha
  cancelada e nada no estorno depende dele.

### Visões

`usoconsumo_movimento_historico` e `usoconsumo_movimento_financeiro_historico`
expõem `escopo`; `usoconsumo_movimento_autor` passou a listar autor **por** escopo.
As três foram recriadas do zero pelo mesmo motivo de
[`20260820100000`](../../supabase/migrations/20260820100000_historico_estoque_filtro_motivo_e_usuario.sql):
`CREATE OR REPLACE VIEW` só acrescenta coluna no fim, e a visão financeira consome
`historico.*`.

`fiscal_dfe_item_apropriacao.destino` continua `'USOCONSUMO'` para os dois estoques
simples — a FK é `usoconsumo_entrada_id` e o escopo real vem por join.

## Contrato de API

Todas as rotas de `/api/usoconsumo/*` aceitam `escopo` — na query (GET) ou no corpo
(POST/PATCH) —, com **default `USOCONSUMO`**. É o que mantém funcionando todo
chamador anterior ao estoque geral. Só o corpo da **entrada** aceita também `MISTO`.

Nos filtros de **cabeçalho** (entradas e visões de movimento) use
`.in("escopo", escoposDoCabecalho(escopo))`: uma entrada `MISTO` pertence aos dois
estoques. Para **item** e **saída**, que têm escopo único, continue com `.eq`.

`/api/usoconsumo/entradas/duplicidades` **não** filtra por escopo: a chave é única
globalmente, então chave repetida é duplicidade em qualquer estoque.

O parser aceita tanto o código (`GERAL`) quanto o slug de URL (`geral`):
[`escopoDaBusca`](../../src/lib/usoconsumo/api.ts) e
[`escopoDoSlug`](../../src/lib/usoconsumo/escopo.ts).

Não mudaram, por serem cadastro compartilhado: `/api/usoconsumo/grupos`,
`/api/usoconsumo/opcoes`, `/api/usoconsumo/entradas/nf`,
`/api/usoconsumo/entradas/apropriacoes` e `/api/tipos/*`.

> **Cuidado com o nome:** `/api/usoconsumo/entradas/geral` é "entrada geral" no
> sentido de *não fiscal*. Não tem relação com o estoque Geral/Avulso.

## Localização e responsabilidades

- [`escopo.ts`](../../src/lib/usoconsumo/escopo.ts): fonte única do tipo, dos rótulos,
  dos slugs de URL e do prefixo de origem da NF-e. Nome de estoque não deve ser
  escrito à mão em nenhuma tela.
- [`schemas.ts`](../../src/lib/usoconsumo/schemas.ts): `escopoSchema`, presente no
  cadastro, na entrada e na saída. Ausente no patch de propósito.
- [`inventory-labels.ts`](../../src/lib/inventory-labels.ts): `InventoryLabelKind` é a
  **tabela** (dois valores); `InventoryTarget` é o **estoque** (três). A checagem de
  etiqueta repetida compara `InventoryTarget`.
- [`usoconsumo-client.tsx`](<../../src/app/(app)/(pages)/usoconsumo/usoconsumo-client.tsx>):
  uma tela só, parametrizada por `escopo`. `/estoque/uso-consumo` e `/estoque/geral`
  renderizam o mesmo componente.
- [`entrada-fiscal-dialog.tsx`](../../src/components/entrada-fiscal/entrada-fiscal-dialog.tsx):
  `DestinoEntrada` tem os **três** estoques — aqui ele é o estoque, não a tabela. A
  prop `escopo` não restringe nada: é só o padrão de um item cadastrado antes de o
  destino ser escolhido. O escopo do cabeçalho sai de `escopoDeEntradaDe`.
- [`historico/page.tsx`](<../../src/app/(app)/(pages)/estoque/historico/page.tsx>):
  três abas; as duas não-produto são a mesma fonte filtrada por escopo.

## Testes e validação

```powershell
npm run db:status
npm run db:test:sql -- supabase/tests/estoque_geral_avulso.sql demo
npm run lint
npm run build
```

O teste SQL permanente está em
[`estoque_geral_avulso.sql`](../../supabase/tests/estoque_geral_avulso.sql). Usa
`BEGIN/ROLLBACK` e cobre: escopo no cadastro e no saldo inicial, isolamento das
listagens, isolamento dos saldos, recusa de item de outro estoque (pela RPC e pelo
trigger), unicidade global da etiqueta entre os três estoques, ajuste de inventário,
cancelamento de entrada e o `escopo` nas três visões; a entrada `MISTO` creditando
cada item no seu estoque e aparecendo no histórico; e a garantia de que uma entrada de
escopo único continua recusando item de fora — mais a regressão de que as linhas
pré-existentes continuam em `USOCONSUMO`.

Validação manual mínima, na Demonstração e depois da migração:

1. `/estoque/uso-consumo` lista exatamente os mesmos itens de antes;
2. `/estoque/geral` abre vazio; cadastrar item com estoque inicial e conferir a entrada `SALDO_INICIAL`;
3. entrada manual, saída, inventário e cancelamento no Geral, conferindo o título em `/fluxodecaixa`;
4. `/estoque/historico`: as três abas filtram corretamente;
5. XML com Produto + Geral registra e gera uma transação só;
6. etiqueta do Geral recusada em produto e em uso/consumo;
7. `/estoque/movimentacao` lê a etiqueta do Geral e rotula "Geral/Avulso";
8. NF-e avulsa: item do Geral entra com badge de origem, CFOP do padrão e valor zerado;
9. relatório com `inventario=geral` exporta o arquivo certo.

## Regras para futuras implementações

1. ler esta documentação antes de alterar o módulo;
2. **toda consulta a `usoconsumo_*` filtra por escopo** — sem isso os dois estoques se misturam;
3. criar nova migração em vez de modificar migrações já aplicadas;
4. manter o `DEFAULT 'USOCONSUMO'` como rede de compatibilidade;
5. não tornar `escopo` editável em item que já tem movimento;
6. rótulo de estoque vem sempre de `escopo.ts`, nunca escrito à mão;
7. preservar a unicidade global da etiqueta entre os três estoques;
8. adicionar ou atualizar testes;
9. atualizar este mesmo arquivo.

## Histórico resumido

- **2026-08-26 — Três destinos na entrada fiscal:** o seletor de destino por linha
  passou a oferecer sempre os três estoques; o cabeçalho da entrada ganhou `MISTO`; os
  filtros de cabeçalho viraram `.in`; o relatório passou a cortar por escopo do item;
  o histórico marca a nota mista e a mostra nas duas abas.

- **2026-08-26 — Estoque Geral/Avulso:** coluna `escopo` nas tabelas `usoconsumo_*`,
  trigger de coerência, RPCs e visões recriadas, parâmetro de escopo em todas as rotas
  do módulo, tela parametrizada com nova rota `/estoque/geral`, terceira aba no
  histórico, três estoques em etiquetas e movimentação por QR Code, seletor de escopo
  na NF-e avulsa, relatório por estoque, teste SQL e esta documentação.
