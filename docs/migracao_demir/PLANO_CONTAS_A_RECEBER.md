# Plano — migração do Contas a Receber do DataSystem para o banco do Demir

Origem: `CONTAS A RECEBER - DATASYSTEM_CSV20260803-142521.csv` (extraído em 03/08/2026)
Destino: banco Demir (`lkpwaiynvnfedvxcjmrp`), tabela `public.transacao`

**Nada foi inserido. Este documento é só o plano, para revisão.**

---

## 1. Decisões já tomadas

| Decisão | Definido |
|---|---|
| DRE | **Nenhum título entra na DRE.** É migração de contas a receber para controle e cobrança, não reconhecimento de receita — o DataSystem já reconheceu essa receita na época. |
| Competência | Irrelevante, já que nada vai para a DRE. Só o **vencimento** importa. |

---

## 2. O que tem no arquivo

- **333 títulos em aberto**, todos com `Valor Recebido` e `Dt Recebimento` vazios
- **R$ 1.216.525,18** de saldo a receber
  (R$ 1.258.424,22 de valor original − R$ 26.280,00 de pagamentos parciais − R$ 15.619,04 de descontos de antecipação e cartão)
- **126 clientes distintos** — 38 já cadastrados no Demir, **88 a criar**
- Vencimentos: 85 em 2025 (o mais antigo com 577 dias de atraso), 246 em 2026, 2 em 2027
- Sem registros duplicados; CPF/CNPJ consistente (nunca dois nomes para o mesmo documento)

Colunas do CSV 100% vazias, descartadas: `Romaneio`, `Dt Recebimento`, `Somatório Origem`, `Conta Baixa`, `Televenda`, `Data Remessa`, `Invoice`, `Boleto Impresso`, `Status Faturamento`.

---

## 3. De/Para

### 3.1 Campos de `transacao`

| Coluna destino | Origem / valor | Observação |
|---|---|---|
| `tipo` | `'RECEITA'` | fixo |
| `pendente` | `true` | fixo — é título em aberto |
| `data` | **`Vencimento`** | no ERP, transação pendente guarda o vencimento em `data`; a `baixar_transacao_pendente` move para `pago_em` na baixa e copia o vencimento para `vencimento_em` |
| `vencimento_em` | `null` | mesma convenção das parcelas geradas por OS/venda |
| `competencia_em` | `null` | nada vai para a DRE |
| `valor` | **`Valor Líquido`** | saldo em aberto — ver §6.1 |
| `valorLiquido` | igual a `valor` | convenção das transações já existentes no banco |
| `descricao` | `{Cliente} — Pedido {Pedido} · Parcela {N/M} [DS#{Registro}]` | o `[DS#…]` é a marca de rastreio e idempotência |
| `descricao_pagamento` | rótulo original + banco + valor original/parcial quando diferirem | ex.: `BOLETO ANTECIPADO · ITAU · original R$ 11.000,00` |
| `metodopagamento` | mapa §3.2 | |
| `banco_id` | mapa §3.3 | `null` quando `Conta Boleto` vazio (90 títulos) — a baixa exige banco e vai pedir na hora |
| `cliente_id` | por CPF/CNPJ | `null` só no registro 13868 (`CONSUMIDOR`, sem documento) |
| `nomepagador` | `Razão Social` | |
| `cpfcnpjpagador` | `CNPJ/CPF` (só dígitos) | string vazia no registro 13868 |
| `plano_de_conta_id` | plano novo §4.1 | grupo não operacional ⇒ não gera evento de DRE |
| `centro_custo_id` | mapa §3.4 | `null` em 281 títulos (coluna vazia no CSV) |
| `categoria` | `'NÃO RELACIONADO'` | não é OS nem venda do ERP |
| `parcelas` | `1` | cada linha do CSV **já é** uma parcela; o "3/3" fica na descrição |
| `ordemservicoid`, `vendaid`, `entrada_id`, `evento_financeiro_id` | `null` | não existe documento correspondente no ERP |
| `created_by` | `null` | importação automatizada, sem usuário |

Campos do CSV preservados na descrição por serem úteis na cobrança: `Cliente` (nome fantasia — difere da razão social em 203 títulos), `Pedido`, `Parcela`, `Histórico` (255 preenchidos, quando houver).

### 3.2 Método de pagamento

O enum `metodo_pagamento` tem só 6 valores. O rótulo original vai inteiro para `descricao_pagamento`, então nada se perde.

| CSV | Qtd | `metodopagamento` |
|---|---|---|
| BOLETO BANCARIO | 157 | `BOLETO` |
| BOLETO ANTECIPADO | 90 | `BOLETO` |
| PIX | 39 | `PIX` |
| CARTAO CREDITO | 25 | `CREDITO` |
| TRANSFERENCIA | 16 | `TRANSFERENCIA` |
| DEPOSITO BANCARIO | 5 | `TRANSFERENCIA` |
| CHEQUE A VISTA | 1 | `TRANSFERENCIA` — sem equivalente no enum |

### 3.3 Conta bancária → `bancoconta`

Todas as contas do CSV já existem no Demir.

| CSV | Qtd | id |
|---|---|---|
| BANCO DO BRASIL | 140 | 2 |
| *(vazio)* | 90 | `null` |
| HR FACTORING | 39 | 9 |
| ITAU | 36 | 7 |
| SANTANDER | 24 | 4 |
| BANCO INTER | 3 | 5 |
| EDMIR SANTANDER | 1 | 4 |

### 3.4 Centro de resultado → `centrosdecusto`

| CSV | Qtd | id / nome |
|---|---|---|
| *(vazio)* | 281 | `null` |
| 1 - OFICINA | 25 | 1 — OFICINA |
| 2 - SALA DE REPAROS/MODULO | 17 | 6 — SALA DE REPARO DE MÓDULOS E PAINÉIS |
| 5 - VENDAS | 5 | 11 — VENDAS |
| 9 - ESTOQUE SALA MODULO | 5 | 15 — ESTOQUE |

### 3.5 Plano de contas

O `Plano Conta` do DataSystem (`1.1 - RECEITA COM VENDAS` em 308 títulos, `1.2 - RECEITA COM DEVOLUÇÃO DE VENDAS` em 1) **não é aproveitado** — apontar para um plano de receita jogaria R$ 1,2 mi na DRE. O valor original fica registrado em `descricao_pagamento` para consulta.

---

## 4. Etapas

### 4.1 Plano de contas para os títulos migrados

O gatilho `trg_eventos_financeiros_transacao` cria um evento de DRE para toda transação sem vínculo de OS/venda/entrada. Duas formas de mantê-las fora do resultado:

- **plano nulo** → gera evento sem linha de DRE: não soma em nada, mas as 333 aparecem para sempre na tela de pendências de classificação;
- **plano num grupo com `exclui_do_resultado`** → não gera evento nenhum. DRE limpa e tela de pendências limpa.

Proposta: criar um plano dedicado no grupo 10 (*Movimentações não operacionais*, `exclui_do_resultado = true`):

```sql
INSERT INTO planosdeconta (codigo, nome, descricao, grupo_id, ativo)
VALUES ('9.9', 'Recebíveis migrados (DataSystem)',
        'Títulos em aberto importados do sistema anterior em ago/2026. '
        'Fora da DRE: a receita já foi reconhecida no DataSystem.', 10, true);
```

Ganha rastreabilidade — dá para filtrar os 333 por plano de contas a qualquer momento. Reaproveitar o `9.6 — Adiantamento de clientes` funcionaria igual na DRE, mas é semanticamente errado (adiantamento é dinheiro recebido antes da entrega; aqui é o contrário).

### 4.2 Criar os 88 clientes faltantes

`cliente` exige só `tipopessoa`, `cpfcnpj` e `nomerazaosocial` — tudo disponível no CSV.

- `tipopessoa`: 11 dígitos → `FISICA`, 14 → `JURIDICA`
- `cpfcnpj`: só dígitos (formato já usado no banco)
- `nomerazaosocial`: `Razão Social`
- `cidade` / `estado`: da coluna `Cidade` (`"PEDRO LEOPOLDO - MG"` → `PEDRO LEOPOLDO` / `MG`). Sem UF em 2 casos (`CABEDELO` e 1 vazio) → `estado` nulo
- `email` / `telefone`: nulos — não vêm no CSV

Os ids criados ficam gravados num JSON para permitir rollback.

### 4.3 Importar os 333 títulos

Script `scripts/db/importar-contas-receber-demir.ts`, seguindo o padrão de `scripts/db/lib.ts` (mesma conexão via pooler e `.env.migrations.local`):

- roda em **uma transação só** — ou entra tudo, ou nada
- **`--dry-run` por padrão**; só grava com `--aplicar`
- **idempotente**: antes de inserir, lê os `[DS#…]` já existentes em `transacao.descricao` e pula os repetidos, então rodar duas vezes não duplica
- imprime o resumo (contagem e soma) para conferência contra o CSV antes do commit

---

## 5. Validação e rollback

Depois de aplicar, conferir:

1. `select count(*), sum(valor) from transacao where descricao like '%[DS#%' and not is_deleted`
   → esperado **333** e **1.216.525,18**
2. `select count(*) from eventos_financeiros where source_type='TRANSACAO' and status='ATIVO' and source_id in (...)`
   → esperado **0** (nenhum evento de DRE gerado)
3. Totais da DRE de ago/2026 idênticos aos de antes da importação
4. Abrir o fluxo de caixa e conferir que os títulos aparecem como pendentes, com os vencimentos certos
5. Baixar um título de teste e conferir que `vencimento_em` e `pago_em` são preenchidos corretamente — depois desfazer

**Rollback:** `delete from transacao where descricao like '%[DS#%'` (delete físico, não soft delete, para não deixar lixo), mais o delete dos clientes cujos ids estão no JSON e o delete do plano 9.9. Como nenhum evento de DRE é criado, não há nada mais a limpar.

---

## 6. Pontos que precisam da sua revisão

### 6.1 `valor` = Valor Líquido, não Valor Original

Estou usando o **`Valor Líquido`** (R$ 1.216.525,18) porque é o que ainda tem a receber. Ele já vem descontado de duas coisas:

- **R$ 26.280,00 de pagamentos parciais** — 2 títulos. Ex.: registro 10090, original R$ 1.800,00, cliente já pagou R$ 1.480,00, restam R$ 320,00. Migrar os R$ 1.800,00 faria cobrar de novo o que já foi pago.
- **R$ 15.619,04 de descontos** — 110 títulos de boleto antecipado e cartão, onde a taxa da antecipação/maquineta já saiu do valor. Ex.: registro 14953, original R$ 11.000,00, líquido R$ 10.587,50.

Nos parciais o líquido é claramente o certo. Nos antecipados depende de o Demir querer cobrar o cliente pelo cheio ou já contar o valor que vai pingar na conta. **Se preferir o Valor Original nesses 110, o total sobe para R$ 1.232.144,22** e eu ajusto.

### 6.2 Criar o plano de contas `9.9`

Mexe no plano de contas do Demir (§4.1). Se preferir não criar item novo, uso o `9.6 — Adiantamento de clientes`, que dá o mesmo resultado na DRE.

### 6.3 Registro 13868 — `CONSUMIDOR`

Único título sem CPF/CNPJ, R$ 291,60, vencido em 06/01/2026. Entra sem `cliente_id`, com `nomepagador = 'CONSUMIDOR'`. Se souber de quem é, dá para corrigir antes.

### 6.4 Títulos muito antigos

85 títulos vencem em 2025, o mais antigo com 577 dias de atraso (registro 13266, R$ 6.000,00, venceu em 03/01/2025). O plano importa todos. Se algum já é perda e não vai mais ser cobrado, melhor tirar do CSV antes.
