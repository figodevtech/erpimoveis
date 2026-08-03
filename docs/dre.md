# DRE — Demonstração do Resultado do Exercício

Documento vivo da construção do módulo. Atualizar a cada fase concluída.

---

## 1. Objetivo

DRE por **regime de competência**: mostrar como a empresa chegou ao lucro ou
prejuízo do período, com rastreabilidade até o registro de origem.

Uma visão por caixa pode existir depois, mas identificada como gerencial. Ela
não substitui a DRE por competência.

---

## 2. O sistema antes do módulo

### O que já existia e foi aproveitado

**`eventos_financeiros`** já era um livro de resultado — só que exclusivo de
ordem de serviço. Tinha chave de idempotência, snapshots de percentual e base,
ciclo `ATIVO → CONVERTIDO → CANCELADO`, vínculo bidirecional com `transacao` e
drill-down até a OS. Faltava competência, origem genérica e papel na DRE.

**Plano de contas hierárquico** (`planosdecontagrupos` → `planosdeconta`), já
com forma de DRE e, importante, com um grupo dedicado a movimentações que **não
são resultado** (aporte de sócios, empréstimos, transferências, adiantamentos) —
exatamente o que precisa ficar fora da apuração.

**Custo histórico preservado**: `custo_unitario_aplicado` existe em
`osproduto` **e** em `vendaproduto`. O requisito mais difícil — não recalcular
período passado com o custo atual do cadastro — já estava atendido na origem.

### O que não existia

| | |
|---|---|
| Data de competência | em lugar nenhum; o financeiro era caixa puro |
| Livro de resultado para vendas | só OS tinha |
| Patrimônio / depreciação | nenhuma tabela |
| Apuração de IRPJ / CSLL | nenhuma tabela |
| Orçamento / metas | nenhuma tabela |
| Filial | nenhuma tabela |

---

## 3. Decisões arquiteturais

### 3.1 Sem `company_id` / `tenant_id`

O projeto é **um banco por empresa** — Demonstração, Demir, AlphaGarage e Garage
Premium, mesmas migrations, dados isolados fisicamente (ver
[database-migrations.md](database-migrations.md)). `empresa` tem uma linha.

Acrescentar `company_id` criaria uma coluna constante e uma falsa sensação de
isolamento. O isolamento já é físico.

### 3.2 Filial preparada, não construída

Não há filiais hoje. O campo fica previsto no livro de lançamentos, nulo, para
não exigir migração estrutural caso venham a existir.

### 3.3 Estender `eventos_financeiros`, não criar tabela paralela

Criar um livro novo ao lado do existente produziria **duas fontes de verdade
para o resultado da OS**. Essa exata situação gerou a família de bugs corrigida
nas migrations `130000`–`150000`: o rateio de comissão divergia porque duas
funções calculavam o mesmo número por caminhos diferentes.

A tabela existente foi generalizada.

### 3.4 `source_item_id` é coluna, não texto embutido

`chave_origem` codifica significado dentro de uma string (`servicoid` para
receita, `servicoid:usuarioid` para comissão). O identificador da linha de
origem ficou em **coluna própria**.

Motivo: `osservico` e `osproduto` têm PK composta
(`ordemservicoid`, `servicoid` / `produtoid`), o que impede uma OS de ter duas
linhas do mesmo serviço com preços diferentes. Essa limitação provavelmente será
corrigida. Com `source_item_id` em coluna, essa mudança futura vira um `UPDATE`;
com o identificador dentro de um texto, viraria um redesenho.

### 3.5 Competência retroativa = `transacao.data`

É o único dado disponível para o histórico, e é corrigível lançamento a
lançamento depois. Para eventos de OS, a competência é o fim da execução
(`execucao_fim_em`, carimbado pelo sistema), com fallback na entrada da OS.

Não se usa `datasaida`: ela é digitada à mão e há OS na base com saída anterior
à entrada.

### 3.6 Linhas sem fonte automática

Depreciação e IRPJ/CSLL existem no template mas aceitam **apenas lançamento
manual**, com aviso visível quando o período não tiver lançamento. Construir
patrimônio e apuração fiscal é outro projeto.

Comparação com orçamento não existe — a DRE compara com o período anterior.

---

## 4. Mapa das fontes

| Linha da DRE | Origem | Situação |
|---|---|---|
| 1.1 Receita de produtos | `venda` + `vendaproduto` | Fase 1 |
| 1.2 Receita de serviços | `eventos_financeiros` (SERVICO) | ✅ já existe |
| 2.1 Impostos sobre vendas | `nfe`, `nfse`, `notafiscal` | Fase 1 |
| 2.2–2.5 Devoluções e descontos | desconto em venda/OS | Fase 1 |
| 4.1–4.2 CMV / CPV | `custo_unitario_aplicado` | Fase 1 |
| 4.3–4.7 Custo de serviços | `eventos_financeiros` (PRODUTO, COMISSAO) | ✅ já existe |
| 6.x Despesas operacionais | `transacao` + plano de contas | Fase 2 |
| 8 Depreciação | — | manual |
| 10 Resultado financeiro | grupos financeiros do plano | Fase 2 |
| 13 IRPJ / CSLL | — | manual |

**Excluídos do resultado**: o grupo de movimentações não operacionais do plano de
contas (aportes, retiradas, empréstimos, transferências, adiantamentos,
estornos). O mapeamento é por banco — cada empresa tem seu plano de contas.

---

## 5. Fases

| Fase | Conteúdo | Estado |
|---|---|---|
| 0.1 Competência | `transacao.competencia_em` + backfill | ✅ aplicado |
| 0.2 Livro genérico | generalizar `eventos_financeiros` | ✅ aplicado |
| 0.2b Competência por entrega | correção do backfill + cancelamento | ✅ aplicado |
| 0.3 Tabelas da DRE | template, linha, mapeamento (versionados) | ✅ concluído |
| 0.4 Mapeamento inicial | sugestão a partir dos grupos do plano | ✅ concluído |
| 1 Receita e custo | vendas geram lançamentos; CMV; deduções | ✅ concluído |
| 2 Despesas | `transacao` classificada; grupos excluídos | ✅ concluído |
| 3 Tela | DRE hierárquica, cards, comparativo | ✅ concluído |
| 3b Drill-down | lançamentos que compõem cada linha | ✅ concluído |
| 4 Integridade | pendências, conciliação, fechamento de período | pendente |
| 5 Saída | exportação PDF/XLSX/CSV | pendente |

Fases 1 e 2 são independentes e podem ser paralelizadas.

---

## 6. O que foi construído

### Migration `20260802160000_dre_competencia_e_livro_generico.sql`

**`transacao.competencia_em`** — data que define o período na DRE, ao contrário
de `data` e `pago_em`, que são de caixa. Backfill copiou `data`. Índice criado.

**`eventos_financeiros`** ganhou:

| Coluna | Papel |
|---|---|
| `source_type` | `ORDEM_SERVICO`, `VENDA`, `TRANSACAO`, `MANUAL` |
| `source_id` | id do documento de origem |
| `source_item_id` | id da linha na origem |
| `competencia_em` | período na DRE |
| `natureza_dre` | `RECEITA`, `DEDUCAO`, `CUSTO`, `DESPESA` |
| `centro_custo_id` | rateio |
| `estorno_de_id` | referência ao lançamento revertido |
| `is_manual` | lançamento digitado |

`ordemservicoid` passou a aceitar nulo.

`natureza_dre` é distinto de `natureza`: o segundo é `RECEITA`/`DESPESA` do
fluxo de caixa; o primeiro é o papel na apuração, onde dedução e custo são
categorias próprias.

**Idempotência.** A constraint `UNIQUE (ordemservicoid, origem, chave_origem,
natureza)` foi **preservada intacta** — as funções
`sincronizar_`/`reconciliar_eventos_financeiros_os` dependem dela no
`on conflict`. Origens novas usam um índice único parcial
`(source_type, source_id, origem, chave_origem, natureza) WHERE ordemservicoid
IS NULL`.

Nenhum comportamento existente muda: as colunas são aditivas e o backfill só
preenche o que estava vazio.

### Validação no Demir

Executada em transação revertida:

```
transacao: 56 linhas, 56 com competência, 0 divergentes
eventos_financeiros após backfill:
  ORDEM_SERVICO  RECEITA   83 linhas   R$ 180.640,00
  ORDEM_SERVICO  CUSTO     69 linhas   R$  16.351,27
linhas sem backfill: 0
reconciliar_eventos_financeiros_os(OS#182): OK — caminho de OS intacto
```

### Migration `20260802170000_dre_competencia_por_entrega.sql`

Corrigiu dois defeitos da anterior.

**Competência só com entrega.** A `160000` usou
`coalesce(execucao_fim_em, dataentrada)`, e OS não concluídas caíram no
fallback — ganharam competência sem que o serviço tivesse sido entregue. Agora
evento de OS sem `execucao_fim_em` fica **sem competência**: existe no livro,
alimenta a projeção de rentabilidade da OS, mas não entra em período nenhum. Um
gatilho carimba a competência quando a execução encerra.

**Cancelamento passa a cancelar.** `tg_reconciliar_eventos_ao_finalizar_os`
chamava `reconciliar` também no `CANCELADO` — e `reconciliar` reconstrói o
conjunto a partir de `osproduto`/`osservico`, que o cancelamento não apaga. Os
eventos voltavam com valor cheio. Agora o cancelamento encerra os eventos.
Eventos `CONVERTIDO` são preservados: viraram transação e devem ser estornados
pelo financeiro.

Impacto no Demir: receita reconhecida caiu de R$ 180.640 para **R$ 71.100**
(70 eventos perderam competência indevida) e 6 eventos de 3 OS canceladas foram
encerrados.

### Migration `20260802180000_dre_template_linha_mapeamento.sql`

**`dre_template`** — versões do relatório. Um período fechado guarda a versão
usada, o que permite reproduzi-lo depois.

**`dre_linha`** — 40 linhas em hierarquia, com `tipo`
(`GRUPO`/`DETALHE`/`SUBTOTAL`/`FORMULA`), `sinal` (soma ou subtrai no pai),
`formula` para os subtotais e `sem_fonte` para as linhas sem origem automática
(8 depreciação, 13 tributos sobre o lucro).

Fórmulas semeadas:

```
3  RECEITA LIQUIDA              = 1 - 2
5  LUCRO BRUTO                  = 3 - 4
7  EBITDA GERENCIAL             = 5 - 6
9  RESULTADO OPERACIONAL        = 7 - 8
12 RESULTADO ANTES DOS TRIBUTOS = 9 + 10 + 11
14 RESULTADO LIQUIDO            = 12 - 13
```

**`dre_mapeamento`** — liga origem (conta, grupo, categoria ou origem de evento)
a uma linha, com vigência e rateio.

A distinção importante é entre **não mapeado** e **fora do resultado de
propósito**. Aporte de sócio, empréstimo, transferência entre contas e compra de
imobilizado não compõem resultado — mas se ficassem sem mapeamento apareceriam
para sempre na tela de pendências, que viraria ruído. Por isso existe
`exclui_do_resultado`, com constraint garantindo que todo mapeamento ou aponta
para uma linha ou está explicitamente fora, nunca ambos e nunca nenhum.

Mapeamento sugerido no Demir (por palavra-chave no nome do grupo):

```
1 Receitas                                -> 1.2  Receita de servicos
2 Custos diretos                          -> 4.3  Custo dos servicos
3 Pessoal                                 -> 6.3  Despesas com pessoal
4 Despesas operacionais                   -> 6.6  Outras despesas operacionais
5 Impostos e taxas                        -> 2.1  Impostos sobre vendas
6 Despesas financeiras                    -> 10.2 Despesas financeiras
7 Receitas financeiras e outras           -> 10.1 Receitas financeiras
8 Investimentos e imobilizado             -> FORA DO RESULTADO
9 Movimentacoes nao operacionais          -> FORA DO RESULTADO

pendencias reais: 0
```

Mais quatro mapeamentos de origem de evento de OS: `SERVICO:RECEITA` → 1.2,
`PRODUTO:RECEITA` → 1.1, `PRODUTO:DESPESA` → 4.1, `COMISSAO:DESPESA` → 4.5.

Primeiro esboço com dado real do Demir:

```
1.1  Receita de venda de produtos      R$ 25.971,81
1.2  Receita de prestacao de servicos  R$ 45.128,19
4.1  Custo das mercadorias vendidas    R$  8.233,55
4.5  Mao de obra direta                R$    891,50
```

Ainda sem vendas (Fase 1) e sem despesas (Fase 2).

### Migration `20260802190000_dre_eventos_de_venda.sql` — Fase 1

Vendas passam a alimentar o livro.

**Reconhecimento**: `venda_reconhece_receita(status)` centraliza a regra —
`PAGAMENTO`, `FINALIZADA`, `PAGO`, `AUTORIZADO`. `PAGAMENTO` entra porque
significa operação concluída e paga; o que falta é o registro da baixa, não o
fato econômico. **Competência = `venda.datavenda`**: a venda de balcão se conclui
no ato, ao contrário da OS, que tem data própria de entrega.

**Receita bruta + dedução.** Diferente da OS — que registra receita já líquida
via `fator` —, a venda registra receita pelo valor de tabela e o desconto como
`DEDUCAO` na linha 2.5. É o caminho contábil correto e torna visível quanto a
empresa concede em desconto.

Criou uma assimetria com o lado da OS, **resolvida pela migration `200000`**
(abaixo).

Gatilhos em `venda` (status, valor, desconto, data) e em `vendaproduto`
(qualquer alteração de item). Venda que deixa de ser reconhecida tem os eventos
encerrados, nunca apagados; `CONVERTIDO` é preservado.

Validação no Demir — 10 vendas reconhecidas, todas fechando:

```
receita bruta de venda   R$ 81.500,00   (10 eventos)
CMV de venda             R$      0,00
idempotência             20 -> 20 eventos ao reprocessar
cancelar venda #64       0 ativos, 2 cancelados
```

Toda venda fecha `bruto − dedução = valortotal`.

### Migration `20260802200000_dre_os_receita_bruta_e_deducao.sql`

Elimina a assimetria: a OS passa a registrar receita **bruta** (valor de tabela,
`precounitario × quantidade`) e um evento `DESCONTO/DEDUCAO` com a diferença até
o `orcamentototal`. Esse único número captura tanto o desconto dado item a item
quanto o dado no total da ordem, porque parte do valor de tabela e chega ao total
fechado.

A receita líquida não muda — `bruto − dedução` continua dando exatamente o
`orcamentototal`. O que muda é a visibilidade do desconto concedido.

**A comissão não segue essa mudança.** `recalcular_comissao_osservico` continua
calculando sobre o líquido (decisão da `140000`). Comissão é paga, não
apresentada — a forma de exibir a receita não deve alterar quanto alguém recebe.
Verificado: total de comissão permanece R$ 2.442,50.

**OS de cortesia** passa a mostrar receita bruta e dedução de mesmo valor, em vez
de receita zero. O líquido continua zero, mas o relatório revela que o serviço
foi prestado e integralmente descontado, em vez de fazer a operação sumir.

Efeito colateral capturado: `origem = 'DESCONTO'` violava o CHECK de
`eventos_financeiros.origem`, que só aceitava `PRODUTO`, `SERVICO`, `COMISSAO` e
`AVULSO`. A `190000` teria falhado **na primeira venda com desconto** — não
falhou na validação apenas porque nenhuma venda do Demir tem desconto. O CHECK
foi ampliado na própria `190000`, onde a origem é introduzida.

Validação no Demir, com as 17 OS entregues reprocessadas:

```
conferência: 17 OS fecham, 0 divergem

1.1  Receita de venda de produtos      R$ 107.770,00
1.2  Receita de prestacao de servicos  R$  45.470,00
4.1  Custo das mercadorias vendidas    R$   8.233,55
4.5  Mao de obra direta                R$     891,50

1  RECEITA BRUTA      R$ 153.240,00
2  (-) DEDUCOES       R$       0,00
3  RECEITA LIQUIDA    R$ 153.240,00
4  (-) CUSTOS         R$   9.125,05
5  LUCRO BRUTO        R$ 144.114,95
```

Deduções zeradas porque nenhuma OS ou venda do Demir tem desconto no período.
O lucro bruto de 94% reflete o CMV ausente descrito nas pendências, não margem
real.

---

### Migration `20260802210000_dre_eventos_de_transacao.sql` — Fase 2

O risco central é **contar duas vezes**. A maioria das transações não é fato
econômico novo: é a liquidação de algo já reconhecido. Uma OS entregue já lançou
sua receita; quando o cliente paga, nasce uma `transacao` com o mesmo dinheiro.

São ignoradas as transações que apontam para evento financeiro (são a baixa
dele), para OS ou venda (recebimento de receita já reconhecida), e para entrada
de estoque ou uso/consumo (compra não é despesa — vira estoque e chega à DRE
como CMV quando o item sai). Excluídas (`is_deleted`) também.

Grupos marcados `exclui_do_resultado` não geram evento. Transação sem plano de
contas gera evento **sem linha**: não entra em total nenhum e aparece nas
pendências. Deliberado não chutar classificação — número mal classificado é pior
que ausente, porque parece certo.

Competência = `transacao.competencia_em`, nunca `pago_em`.

Validação no Demir:

```
receita vinda de transação:        R$ 0,00   (nenhuma duplicação)
retirada de sócio #130:            0 eventos (grupo 9, fora do resultado)
transações sem classificação:      0
eventos de transação criados:      0
```

---

### Migration `20260802220000` + tela — Fase 3

**`dre_somar_por_linha(template, de, ate)`** agrega no banco, resolvendo os dois
tipos de vínculo: `eventos_financeiros.dre_linha_id` (lançamentos de transação,
cuja linha depende do plano de contas) e `dre_mapeamento` por origem de evento
(`SERVICO:RECEITA`, `COMISSAO:DESPESA`…, usado por OS e venda). O vínculo direto
tem precedência — reclassificar um lançamento específico vence a regra geral.

Feito no banco para não trazer todos os lançamentos só para somá-los, e para
que o drill-down use exatamente o mesmo critério da linha, garantindo que os
totais nunca divirjam.

Conferido no Demir: soma das linhas = soma dos eventos ativos = R$ 161.725,05,
102 lançamentos, nenhum fora de linha.

**`GET /api/dre?de=&ate=`** devolve a árvore com valor atual, valor do período
anterior (mesma duração, imediatamente antes), variação absoluta e percentual,
percentual sobre receita líquida e contagem de lançamentos. Fórmulas são
avaliadas sobre os totais já apurados.

O avaliador de fórmula aceita apenas soma e subtração de códigos — sem `eval`,
sem parênteses. Token desconhecido zera o termo em vez de derrubar o relatório.

**Divisão por zero**: sem receita líquida, o percentual volta `null` e a tela
mostra "—". Devolver `0` sugeriria "nada", quando o correto é "indefinido".

**Alertas.** A API devolve três sinais e a tela exibe uma tarja quando qualquer
um dispara: período sem despesa operacional lançada, itens vendidos sem custo, e
lançamentos sem classificação. Existem porque o módulo pode estar correto e
ainda assim produzir número enganoso — mais honesto avisar do que exibir o
resultado limpo.

**Tela** em `/dre`, protegida por `PERMS.FINANCEIRO` no middleware e no
`requireFinanceirosAccess` da rota. Tabela hierárquica expansível com recuo por
nível, 4 cards (receita líquida, lucro bruto, EBITDA, resultado líquido com suas
margens), filtro de período, badge "Preliminar" e comparativo com o período
anterior. Variação usa ícone além de cor, para não depender só de cor.

---

### Migration `20260802230000` + drill-down — Fase 3b

**`dre_lancamentos_por_linha(template, linha_ids[], de, ate)`** devolve os
lançamentos que compõem uma ou mais linhas, com **resolução de linha idêntica** à
de `dre_somar_por_linha`. Escrever a regra duas vezes seria a forma mais provável
de o drill-down deixar de bater com o total — que é justamente o que ele existe
para provar.

Recebe um array de linhas para que a linha-mãe inclua toda a subárvore: quem
clica em "CUSTOS" espera ver 4.1 a 4.7, não uma lista vazia.

Linha de fórmula não abre lançamentos — é resultado de cálculo, não de
lançamento; a API devolve lista vazia com `calculada: true`.

**`GET /api/dre/drilldown?linha=&de=&ate=`** e diálogo na tela, aberto ao clicar
no valor. Mostra competência, descrição, origem com link conceitual ao registro
(OS, venda ou transação), marcadores de manual/estorno/sem custo, e o total ao
pé com a confirmação explícita **"Confere com o total da linha"** — ou aviso em
destaque se divergir.

Conferência no Demir, linha a linha:

```
1.1  linha R$ 107.471,81 | drill R$ 107.471,81 (27 lanc.) OK
1.2  linha R$  45.128,19 | drill R$  45.128,19 (24 lanc.) OK
4.1  linha R$   8.233,55 | drill R$   8.233,55 (27 lanc.) OK
4.5  linha R$     891,50 | drill R$     891,50 (24 lanc.) OK

linha-mãe "4 CUSTOS" com subárvore: R$ 9.125,05 (51 lanc.)
TODAS AS LINHAS BATEM
```

---

## 7. A DRE do Demir hoje

```
1  RECEITA BRUTA        R$ 152.600,00
2  (-) DEDUCOES         R$       0,00
3  RECEITA LIQUIDA      R$ 152.600,00
4  (-) CUSTOS           R$   9.125,05
5  LUCRO BRUTO          R$ 143.474,95
6  (-) DESP. OPERACION. R$       0,00
7  EBITDA               R$ 143.474,95
```

**Este resultado é ficção, e o motivo não é o módulo.** Das 56 transações do
Demir:

| | |
|---|---|
| 47 RECEITA | baixas de OS (35) e venda (12) — receita já reconhecida |
| 8 DESPESA | todas de compra para estoque (`entrada_id`) |
| 1 SAQUE | retirada de sócio |

**Nenhuma despesa operacional está registrada no sistema.** Não há aluguel,
salário, energia, combustível, contador — nada. A oficina evidentemente tem esses
custos; eles simplesmente não são lançados.

Some-se a isso o CMV ausente (produto vendido sem custo cadastrado) e o resultado
é: a DRE mostrará quase todo o faturamento como lucro.

**O módulo está correto; o dado de entrada não existe.** Nenhuma implementação
resolve isso — depende de a oficina passar a lançar despesa no sistema.

---

## 8. Migrations de consistência que antecederam a DRE

Correções de consistência dos lançamentos de OS que antecederam a DRE:

| Migration | O que corrige |
|---|---|
| `20260802120000` | flag `gera_comissao` por serviço |
| `20260802130000` | rateio da comissão na reconciliação |
| `20260802140000` | comissão sobre o valor líquido |
| `20260802150000` | receita zero quando a OS não cobra |

As duas últimas foram verificadas no Demir: impacto de **−R$ 17,09** no total de
comissão, nenhuma OS bloqueada, nenhum evento `CONVERTIDO` afetado.

---

## 9. Onde está cada coisa

**Banco** — todas as migrations em `supabase/migrations/2026080212…` a
`…230000`, na ordem em que aparecem na seção 6.

| Objeto | Papel |
|---|---|
| `eventos_financeiros` | livro de resultado (todas as origens) |
| `dre_template`, `dre_linha`, `dre_mapeamento` | estrutura e classificação |
| `dre_somar_por_linha()` | agregação por linha |
| `dre_lancamentos_por_linha()` | drill-down, mesma resolução de linha |
| `sincronizar_eventos_financeiros_os()` | eventos de OS |
| `sincronizar_eventos_financeiros_venda()` | eventos de venda |
| `sincronizar_eventos_financeiros_transacao()` | despesas e receitas próprias |
| `venda_reconhece_receita()` | regra de reconhecimento de venda |

**Aplicação**

```
src/app/api/dre/route.ts                          árvore da DRE
src/app/api/dre/_calculo.ts                       hierarquia, fórmulas, variações
src/app/api/dre/drilldown/route.ts                lançamentos de uma linha
src/app/(app)/(pages)/(financeiro)/dre/page.tsx   rota /dre
src/app/(app)/(pages)/(financeiro)/dre/dre-client.tsx  tela e diálogo
src/app/(app)/(pages)/(financeiro)/dre/types.ts   contrato compartilhado
```

Permissão: `PERMS.FINANCEIRO`, registrada em `src/middleware.ts` para `/dre` e
`/api/dre`. Menu em `src/app/(app)/components/sidebar/sidebar.tsx`.

---

## 10. Como continuar

**Fase 4 — integridade.** Status de período (`ABERTO`, `EM_REVISAO`, `FECHADO`)
com usuário, data e versão do template no fechamento; tela de pendências
consolidando o que hoje só existe como alerta na DRE (lançamento sem
classificação, item sem custo, período sem despesa); conciliação comparando
receita da DRE com vendas e OS reconhecidas, CMV com saídas de estoque, despesas
com contas a pagar.

Fechar período só faz sentido quando houver mês completo — não antes de setembro.

**Fase 5 — exportação.** PDF, XLSX e CSV respeitando os filtros. No XLSX os
valores precisam sair como número, não texto.

**Ao retomar, verificar primeiro:**

1. Se o mapeamento das contas foi revisado pelo contador (seção 11).
2. Se já existe despesa operacional lançada — sem ela a DRE segue incompleta.
3. Se `osservico`/`osproduto` ainda têm PK composta (seção 12); se tiverem sido
   corrigidas, `source_item_id` precisa ser repontado para o novo id da linha.

---

## 11. Pendências que exigem validação contábil

- **Classificação das contas do plano nas linhas da DRE.** Decisão contábil, não
  técnica. A tela de mapeamento entrega uma sugestão automática a partir dos
  grupos; um contador precisa revisar antes de o relatório ser tratado como
  oficial.
- **Regime tributário.** O Demir está como Regime Normal (`regimetributario = 3`)
  — IRPJ e CSLL são linhas reais. Em empresa do Simples, esses tributos estariam
  dentro do DAS e pertenceriam às deduções, não à linha de tributos sobre lucro.
- **Comissões nunca baixadas.** No Demir há R$ 2.192,50 em eventos de comissão
  `ATIVO`, nenhum `CONVERTIDO`. Se o pagamento acontece fora do sistema, a
  despesa aparecerá na DRE por competência sem contrapartida no caixa.
- **Produto vendido sem custo.** No Demir, 12 dos 13 itens de venda têm
  `custo_unitario_aplicado` preenchido **com zero**, e 492 dos 576 produtos têm
  `ultimovalordecompra` zerado. A DRE mostrará R$ 81.500 de receita de produto
  com CMV zero — margem de 100%, que é falsa. Não é defeito do módulo: o custo
  nunca foi cadastrado. Os eventos marcam `custo_nao_informado` no snapshot para
  a tela de pendências, e **a linha 4.1 não deve ser lida como confiável** até
  que os produtos tenham custo. Decisão deliberada: não estimar custo
  automaticamente, para não fabricar margem.

---

## 12. Limitações conhecidas do modelo

**PK composta em `osservico` e `osproduto`.** Uma OS não pode ter duas linhas do
mesmo serviço ou produto com preços diferentes. O catálogo de serviços do Demir
tem sete cadastros de "mão de obra" justamente como contorno disso. Corrigir
exige trocar a PK e ajustar `osservico_realizador`, `chave_origem` e as funções
de evento. Não bloqueia a DRE (ver 3.4), mas degrada o drill-down.
