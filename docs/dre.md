# DRE — Demonstração do Resultado do Exercício

Documento vivo da construção do módulo. Atualizar a cada fase concluída.

> **Estado em 17/08/2026.** O módulo foi construído entre 2 e 3 de agosto e
> entregue até a Fase 3b. De 5 a 13 de agosto o financeiro e o fluxo de OS
> continuaram em desenvolvimento e mudaram o comportamento da DRE em dez
> migrations — registradas na [seção 6.1](#61-correções-posteriores-5-a-13-de-agosto),
> escrita depois. A conferência da receita ([seção 7](#7-conferência-da-receita))
> achou seis defeitos, todos corrigidos pela `20260817110000`; a receita fecha
> nos quatro bancos. As Fases 4 e 5 nunca começaram.

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
| 1.3 Outras receitas da atividade | `eventos_financeiros` (FRETE) | acrescentado em 09/08 |
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
| — | correções vindas do financeiro e da OS (seção 6.1) | 05–13/08 |
| — | conferência da receita (seção 7) | ✅ 6 defeitos corrigidos |
| 4 Integridade | pendências, conciliação, fechamento de período | pendente |
| 5 Saída | exportação PDF/XLSX/CSV | pendente |

Fases 1 e 2 são independentes e podem ser paralelizadas.

Nada em `src/app/api/dre/` foi tocado desde 03/08: tudo o que mudou depois
mudou por baixo, no livro de lançamentos.

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

> Desatualizado. Desde a `20260811210000` a função soma `ATIVO` **e**
> `CONVERTIDO` — ver 6.1. Os números desta conferência são de 03/08.

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

### 6.1 Correções posteriores (5 a 13 de agosto)

Com a Fase 3b entregue, o módulo saiu do foco — mas o financeiro e o fluxo de
OS continuaram em desenvolvimento, e dez migrations mudaram o comportamento da
DRE sem passar por este documento. Estão registradas aqui porque duas delas
contradizem o que está escrito acima.

**As duas que mudam o que já estava documentado:**

`20260806260000_competencia_dispara_com_trigger_before` — a competência **nunca
era carimbada no caminho normal da OS**. `trg_os_execucao_set_times` (BEFORE)
escrevia `execucao_fim_em`; `trg_carimbar_competencia_eventos_os` era
`AFTER UPDATE OF execucao_fim_em`. No PostgreSQL, `UPDATE OF coluna` só dispara
quando a coluna aparece no `SET` do comando — e quem a escrevia era o trigger
BEFORE. Como `dre_somar_por_linha` filtra `competencia_em IS NOT NULL`, a OS
inteira ficava fora do relatório. Verificado em produção na época: 38 eventos,
nenhum com competência. **A DRE estava vazia.** O retrato do Demir da versão
original deste documento, escrito antes disso, media um relatório que não somava
nada.

`20260811210000_eventos_os_frete_conversao_e_custo` — a DRE passou a somar
eventos `CONVERTIDO`, não só `ATIVO`. Converter uma despesa em transação é
decidir *como* ela será paga, não desfazer o fato econômico; e não há contagem
dupla porque `sincronizar_eventos_financeiros_transacao` ignora transação com
`evento_financeiro_id`. A mesma migration corrigiu a fórmula do desconto da OS
para `bruto + frete − total`, deu fallback de custo de produto
(OS → último → médio) e fez `natureza_dre` nascer preenchido.

**As outras oito:**

| Migration | O que mudou na DRE |
|---|---|
| `20260805200000` | `ORIGEM_MIGRACAO`: saldo de abertura importado de sistema anterior não é resultado do ERP — nova regra de exclusão, além das da Fase 2 |
| `20260806210000` | evento de OS criado *depois* do fim da execução nascia sem competência e sumia do relatório sem erro |
| `20260806250000` | OS finalizada "sem cobrança" publicava receita que nunca existiu; agora sobram só os custos reais |
| `20260807110000` | origem `SERVICO:DESPESA` (despesa manual ligada a um serviço) → 4.3, com mapeamento próprio; auditoria passa a registrar eventos manuais |
| `20260809120000` | `FRETE` vira origem de evento: `FRETE:RECEITA` → 1.3 Outras receitas da atividade |
| `20260811203000` | marcos de status da venda |
| `20260811220000` | pagamento múltiplo numa transação só |
| `20260813040000` | transação de entrada nasce com a competência da nota, não com o vencimento da parcela |

Nenhuma dessas migrations reescreve evento existente — por decisão explícita da
`20260811210000`: *"as funções só valem para o que for gerado ou reconciliado
daqui para frente."* É daí que vem o defeito 3 da seção 7.

**Fora das migrations, uma inconsistência ficou em aberto na aplicação:** os três
alertas de [route.ts:56-80](../src/app/api/dre/route.ts#L56-L80) ainda filtram
`.eq("status", "ATIVO")`, enquanto a soma da linha passou a incluir
`CONVERTIDO`. A tarja "período sem despesa operacional" pode aparecer com
despesa já contada no total.

---

## 7. Conferência da receita

Feita em 17/08/2026, nos quatro bancos. A receita é o início da DRE: se ela não
fecha com o documento que a originou, nenhuma linha abaixo dela significa nada.

O script é [`supabase/tests/checar_receitas_dre.sql`](../supabase/tests/checar_receitas_dre.sql),
somente leitura, transação revertida:

```
npm run db:test:sql -- supabase/tests/checar_receitas_dre.sql demir
```

Ele verifica as seis maneiras de a receita estar errada: origem sem linha,
competência ausente em documento já reconhecido, antecipação contada em
duplicidade, documento que não fecha, documento reconhecido sem receita, e
lançamento com natureza contrária à da linha.

**Os seis defeitos abaixo foram corrigidos pela migration
`20260817110000_dre_correcoes_da_receita.sql`.** Depois dela a receita fecha nos
quatro bancos: toda venda e toda OS batem com o documento de origem. Os números
de cada defeito são os medidos antes da correção — ficam registrados porque
explicam por que a migration existe.

### O que passou

| | |
|---|---|
| Competência | nenhum documento reconhecido sem competência, nos 4 bancos |
| Cobertura | nenhuma venda ou OS reconhecida sem evento de receita |
| Reconhecimento de venda | os status de orçamento criados em 15/08 (`APROVACAO_ORCAMENTO`, `ORCAMENTO_APROVADO`, `ORCAMENTO_RECUSADO`) corretamente **não** reconhecem receita |
| Garage Premium | receita íntegra, nenhum defeito |

As 73 receitas do Demir sem competência (R$ 128.820) são todas de OS em
`EM_ANDAMENTO` ou `ORCAMENTO_APROVADO` — comportamento correto da
`20260802170000`: sem entrega, não há período.

### Defeito 1 — antecipação de recebíveis vira receita

| | Demir | Demonstração |
|---|---|---|
| Lançamentos | 3 | 2 |
| Valor | R$ 50.969,70 | R$ 507,05 |

Antecipar recebíveis é operação de crédito sobre títulos cuja receita **já foi
reconhecida** na OS ou na venda. A transação tem `eh_adiantamento = true` e não
aponta para OS, venda, entrada nem evento — então a lista de exclusão da Fase 2
não a alcança, e `sincronizar_eventos_financeiros_transacao` gera um evento
`AVULSO:RECEITA`. O mesmo dinheiro entra duas vezes.

Onde cada uma cai depende do plano de contas da transação, e o resultado é pior
que a duplicação:

```
Demir  R$  3.768,90  plano "Outros serviços da oficina"   -> 1.2 Receita de serviços
Demir  R$ 11.620,80  plano "Antecipação de recebíveis"    -> 10.2 Despesas financeiras
Demir  R$ 35.580,00  plano "Antecipação de recebíveis"    -> 10.2 Despesas financeiras
```

As duas últimas são eventos de **natureza RECEITA somando R$ 47.200,80 dentro de
uma linha de DESPESA**.

**Corrigido.** `sincronizar_eventos_financeiros_transacao` passou a ignorar
transação com `eh_adiantamento` (a antecipação em si — financiamento) ou
`adiantamento_id` (o título quitado por ela — baixa), pelo mesmo motivo que já
ignora as que apontam para OS e venda. O backfill reprocessou 3 transações no
Demir e 5 no Demonstração, encerrando os eventos. A linha 10.2 do Demir perdeu
os R$ 47.200,80 que não eram dela.

### Defeito 2 — frete de venda não vira receita

| | |
|---|---|
| Demir | venda #63, R$ 198,39 |
| Demonstração | venda #64, R$ 150,00 |

`sincronizar_eventos_financeiros_venda` é de 02/08 e **nunca foi redefinida**.
Ela registra receita bruta por `vendaproduto.sub_total` e dedução pelo desconto,
mas não conhece frete algum:

- `venda.valor_frete` existe desde a `20260729160000` — anterior à própria
  função;
- `vendaproduto.valor_frete` desde a `20260815115000`, que valida
  `valor_total = sub_total − desconto + frete`.

O lado da OS ganhou `FRETE:RECEITA` em 09/08. O lado da venda não — a assimetria
que a `20260802200000` eliminou foi recriada, agora ao contrário. O invariante
que a Fase 1 comemorava (*"toda venda fecha bruto − dedução = valortotal"*) está
quebrado sempre que há frete.

**Corrigido.** A venda passou a emitir `FRETE:RECEITA` somando
`venda.valor_frete` com o frete dos itens, espelhando a OS. O gatilho de `venda`
também não acordava quando só o frete mudava — passou a acordar. A fórmula fica
`bruto − desconto + frete = valortotal`, conferida contra todas as vendas
reconhecidas antes de escrever a migration: nenhuma foge dela.

### Defeito 2b — item removido da venda deixa o evento para trás

Apareceu ao **testar** a correção do defeito 2 — e estava escondendo o defeito 2.

`sincronizar_eventos_financeiros_venda` faz upsert dos itens que existem e nunca
encerrava o evento de um item que saiu da venda. O gatilho de `vendaproduto`
chama a sincronização no `AFTER DELETE`, mas a função não tinha o que fazer com
a informação. O lado da OS nunca teve esse problema: `reconciliar` monta o
conjunto desejado e cancela o que sobra.

Na venda #56 do Demir:

```
item atual      produto 860              R$ 5.000,00
eventos         produto 860              R$ 5.000,00
                produto 866              R$   180,00   <- não está mais na venda
frete da venda                           R$   180,00   <- não virava evento
valortotal                               R$ 5.180,00
```

Os dois erros tinham exatamente o mesmo valor e se anulavam: `5.000 + 180 = 5.180`
batia com o total por acaso. Corrigir só o frete teria transformado um acerto
acidental em divergência visível — por isso os dois foram na mesma migration.

**Corrigido.** Depois dos upserts, a função encerra evento de `PRODUTO` cujo
`chave_origem` não está mais entre os itens da venda. `CONVERTIDO` é preservado.
O backfill passou por todas as vendas reconhecidas (45 no Demir, 7 no
Demonstração) e encerrou 4 eventos órfãos.

### Defeito 3 — desconto subtraído duas vezes em OS antiga

| Banco | OS | Receita subtraída a mais |
|---|---|---|
| Demir | #151, #152 | R$ 640,00 |
| Demonstração | #65 | R$ 127,79 |
| AlphaGarage | #19 | R$ 120,96 |

Não é defeito de código — o código atual está certo. É dado defasado:

```
OS #151   itens (preço de tabela)   R$ 3.800,00
          evento de receita         R$ 3.610,00   <- líquido, versão antiga
          evento de desconto        R$   190,00   <- calculado sobre o bruto
          líquido na DRE            R$ 3.420,00
          orçamento da OS           R$ 3.610,00
```

Desde a `20260802200000` o evento de receita guarda o valor de tabela e o
desconto vira evento próprio. Eventos criados antes guardaram o líquido. Quando
a `20260809120000` passou a emitir `DESCONTO` a partir do bruto dos itens, os
dois passaram a conviver — e o desconto saiu duas vezes. Só morde OS com
desconto: 4 em toda a frota.

**Corrigido.** A migration procura pelo sintoma — receita dos eventos diferente
do bruto dos itens — em vez de listar ids, para valer em qualquer banco, e chama
`reconciliar_eventos_financeiros_os`, que reconstrói o conjunto com o código
atual. Depois disso `3.800 − 190 = 3.610` e a OS fecha.

Reconciliou 3 OS no Demir (apareceu uma quarta, a #134, que o bloco 3b não
pegava porque o orçamento dela também estava defasado), 1 no Demonstração e 1 no
AlphaGarage. Nenhuma foi pulada.

A reconciliação **recusa** OS com evento `CONVERTIDO` divergente — a despesa já
virou transação e mexer nela por aqui deixaria os dois lados desencontrados. O
bloco trata a exceção por OS: registra qual foi pulada e segue. Nenhuma caiu
nesse caso agora, mas em banco com comissão baixada isso pode acontecer.

### Achado transversal — a soma não olha a natureza

`dre_somar_por_linha` soma `e.valor` sem comparar a natureza do lançamento com a
da linha. Uma despesa classificada numa conta de receita entra **somando**
receita; uma receita numa conta de despesa entra somando despesa. Nada avisa —
o número sai limpo e errado.

```
Demir         10.2 Despesas financeiras   recebe 2 lanç. RECEITA  R$ 47.200,80
Demonstração  1.2  Receita de serviços    recebe 6 lanç. DESPESA  R$  1.300,00
```

Os do Demir eram o defeito 1 e sumiram com a correção. **O mecanismo continua
aberto de propósito**, porque não é defeito do módulo: a linha vem do plano de
contas escolhido no financeiro, e "corrigir" isso automaticamente seria a DRE
sobrescrevendo uma classificação que alguém fez de propósito.

O que resta depois da `20260817110000`:

```
Demonstração  1.2  Receita de serviços    5 lanç. DESPESA  R$ 966,66   (dados de teste)
```

São transações de despesa lançadas em conta de receita — erro de classificação
de quem digitou, não do código. O bloco 6 do script existe para que apareçam.
A Fase 4 deveria transformá-lo em alerta na tela: hoje não há nenhum, e é o tipo
de erro que o relatório nunca revela sozinho.

### Defeito 1b — DEPOSITO contava como despesa

Achado ao rastrear um lançamento que o bloco 6 acusou no Demir. A natureza do
evento saía de

```sql
case when upper(tipo) = 'RECEITA' then 'RECEITA' else 'DESPESA' end
```

— ou seja, **todo DEPOSITO virava despesa**. Passou despercebido porque todos os
DEPOSITO e SAQUE do Demir caem em "Movimentações não operacionais", grupo
excluído do resultado, e nunca chegavam a gerar evento. A primeira exceção foi um
rendimento de aplicação lançado como DEPOSITO na conta "Rendimentos financeiros":
entrou como **despesa dentro da linha 10.1 Receitas financeiras**.

**Corrigido.** `DEPOSITO` conta como entrada e `SAQUE` como saída, que é o que
eles são. Um detalhe do caminho: `natureza` faz parte da chave do `on conflict`,
e `idx_eventos_financeiros_transacao` é único em `transacaoid` — uma transação,
no máximo um evento. Mudar a natureza fazia o upsert não reconhecer a linha
existente e tentar inserir uma segunda, batendo naquele índice. A função passou a
realinhar a natureza da linha existente antes do upsert.

**Cuidado ao ler o bloco 6 daqui para frente.** Essa correção também **apagou um
alarme acidental**: o lançamento que o bloco acusava era a duplicata de um
rendimento (duas transações do mesmo R$ 0,03, digitadas com 4 minutos de
diferença). Enquanto uma delas era DEPOSITO, a divergência de natureza a
denunciava. Agora as duas são receita legítima. Duplicata de lançamento é um
problema à parte, que nenhum bloco deste script pega — ver seção 11.

### Defeito 1c — excluir a transação não tirava o lançamento da DRE

Achado ao investigar por que a duplicata acima nunca foi excluída pelo usuário.

`trg_eventos_financeiros_transacao` era `AFTER INSERT OR UPDATE` — **sem
DELETE**. A exclusão pela tela do financeiro é física (`DELETE`, não
`is_deleted`), e a FK `eventos_financeiros.transacaoid` é `ON DELETE SET NULL`:
a transação sumia, o evento continuava `ATIVO` somando na linha, e o drill-down
passava a apontar para um registro inexistente.

No Demir havia 2 eventos assim, R$ 13,35, um deles em 6.3 Despesas com pessoal.
Valor pequeno, mecanismo permanente — toda transação avulsa excluída deixava
rastro no resultado.

**Corrigido.** Gatilho `AFTER DELETE` encerra os eventos da transação (mantendo
`CONVERTIDO`, como em todo o resto do módulo), e o backfill fechou os que já
estavam órfãos. A mesma recriação acrescentou `eh_adiantamento` e
`adiantamento_id` à lista de colunas observadas: sem elas, a regra do defeito 1
não reagia quando o vínculo era criado **depois** — que é justamente como
funciona a baixa por antecipação, que carimba `adiantamento_id` num título já
existente.

### E o defeito que não era da DRE

A duplicata só existiu porque o usuário **não conseguia chegar até a transação**.
As abas do fluxo de caixa forçavam dois filtros cada:

| Aba | `pendente` | `tipo` |
|---|---|---|
| Fluxo (padrão) | `false` | livre |
| Liquidadas | `false` | livre |
| A receber | `true` | forçado `RECEITA` |
| A pagar | `true` | forçado `DESPESA` |

Um DEPOSITO ou SAQUE **pendente** não cabia em nenhuma: as duas primeiras pedem
`pendente = false`, as duas últimas forçam um tipo que não é o dele. A transação
existia no banco sem nenhum caminho na tela até ela — nem para abrir, nem para
editar, nem para excluir. Foi por isso que ele lançou de novo.

Corrigido fora da DRE, em [page.tsx](../src/app/\(app\)/\(pages\)/\(financeiro\)/fluxodecaixa/page.tsx):
"a receber" passou a ser `RECEITA + DEPOSITO` e "a pagar" `DESPESA + SAQUE` — o
mesmo par que `KpisFluxo` já somava, e que as abas contradiziam. O
`GET /api/transaction` e a exportação ganharam o filtro `tipos` (lista) para
isso.

---

### 6.2 Correcao do sinal no fechamento dos grupos (17/08)

Achado ao escrever o documento de leitura ([dre-como-funciona.md](dre-como-funciona.md)),
que obrigou a percorrer linha a linha o que cada uma soma.

`montarArvore` fechava os grupos com `filhos.reduce((acc, f) => acc + f.valor, 0)`.
O `sinal` de cada linha era lido para dentro do objeto e **nunca usado**.

Isso acerta enquanto todos os filhos de um grupo tem o mesmo sinal — o caso de
1, 2, 4, 6 e 13. **RESULTADO FINANCEIRO e o unico grupo que mistura**: 10.1
Receitas financeiras soma, 10.2 Despesas financeiras subtrai. A despesa entrava
somando, e como a linha 12 e `9 + 10 + 11`, o erro atravessava ate o resultado
liquido:

```
10.1  Receitas financeiras     R$      0,12
10.2  Despesas financeiras     R$  2.223,68

10    RESULTADO FINANCEIRO     R$ +2.223,80   <- era
                               R$ -2.223,56   <- correto

14    RESULTADO LIQUIDO        R$ 205.157,18  <- era
                               R$ 200.709,82  <- correto
```

R$ 4.447,36 de lucro a mais no Demir — o dobro das despesas financeiras.

A correcao nao e aplicar o sinal do filho cegamente: as formulas ja assumem que
os grupos de deducao, custo e despesa carregam **magnitude positiva**
(`RECEITA LIQUIDA = 1 - 2`). Aplicar o sinal direto inverteria esses. A regra
que vale para os dois casos esta em `agregarFilhos`: soma os filhos com o sinal
de cada um e, se o proprio grupo tem `sinal = -1` (ou seja, a formula o
subtrai), devolve a magnitude positiva. Devolve numero identico ao anterior para
os cinco grupos uniformes e corrige o unico misto.

A logica pura saiu de `_calculo.ts` para `_arvore.ts`, sem dependencia de banco,
para poder ser testada — `_calculo.ts` importava `supabaseAdmin` no topo e
qualquer teste tentava conectar. Seis casos em `_arvore.test.ts`, incluindo o de
regressao das deducoes, rodando com `npm run test:dre`.

---

## 8. A DRE do Demir hoje

Todo o histórico, medido em 17/08/2026 já com a `20260817110000` aplicada. O
banco está em uso diário, então os números se movem — o que importa aqui são as
ordens de grandeza e o que elas dizem.

```
1.1   Receita de venda de produtos        R$ 414.570,00   (89 lanc.)
1.2   Receita de prestacao de servicos    R$ 174.120,00   (78 lanc.)
1.3   Outras receitas da atividade        R$     428,39   ( 3 lanc.)
2.1   Impostos sobre vendas e servicos    R$ 119.363,30   (16 lanc.)
2.5   Descontos incondicionais            R$  12.804,50   (13 lanc.)
4.1   Custo das mercadorias vendidas      R$ 111.369,15   (89 lanc.)
4.3   Custo dos servicos prestados        R$  77.204,35   (69 lanc.)
4.5   Mao de obra direta                  R$   1.728,67   (37 lanc.)
6.3   Despesas com pessoal                R$  60.873,90   (11 lanc.)
6.6   Outras despesas operacionais        R$   8.887,52   (29 lanc.)
10.1  Receitas financeiras                R$       0,06   ( 2 lanc.)
10.2  Despesas financeiras                R$   2.196,64   (15 lanc.)
```

**O diagnóstico da versão anterior deste documento caducou.** Ele dizia que o
resultado era ficção porque nenhuma despesa operacional era lançada e o CMV era
zero. Das 56 transações de então o Demir passou a 1.245, e as duas lacunas
fecharam:

| Antes (03/08) | Hoje |
|---|---|
| nenhuma despesa operacional | R$ 69.761,42 em 40 lançamentos (6.3 e 6.6) |
| CMV R$ 0,00 | R$ 111.369,15 — o fallback de custo da `20260811210000` funcionou |
| 0 eventos de transação | 142, nenhum sem classificação |
| 10.2 Despesas financeiras R$ 49.056,54 | R$ 2.196,64 — os R$ 47.200,80 de antecipação saíram (defeito 1) |

O que resta de ressalva:

- **46 de 247 eventos de custo** ainda carregam `custo_nao_informado` — produto
  vendido sem custo cadastrado. A linha 4.1 melhorou muito, mas ainda contém
  itens a custo zero.
- **Comissão nunca baixada**: 53 eventos `ATIVO` somando R$ 3.273,67, nenhum
  `CONVERTIDO`. Se o pagamento acontece fora do sistema, a despesa aparece por
  competência sem contrapartida no caixa.

Esta é a primeira versão da DRE do Demir com receita, custo e despesa todos
alimentados por dado real, e com a receita conferida documento a documento.

---

## 9. Migrations de consistência que antecederam a DRE

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

## 10. Onde está cada coisa

**Banco** — a construção está em `supabase/migrations/2026080212…` a `…230000`,
na ordem da seção 6; as correções posteriores estão listadas na 6.1.

| Objeto | Papel | Última versão |
|---|---|---|
| `eventos_financeiros` | livro de resultado (todas as origens) | — |
| `dre_template`, `dre_linha`, `dre_mapeamento` | estrutura e classificação | `…180000` |
| `dre_somar_por_linha()` | agregação por linha | `20260811210000` |
| `dre_lancamentos_por_linha()` | drill-down, mesma resolução de linha | `20260811210000` |
| `sincronizar_eventos_financeiros_os()` | eventos de OS | `20260811210000` |
| `ajustar_eventos_frete_os()` | frete e desconto da OS | `20260811210000` |
| `sincronizar_eventos_financeiros_venda()` | eventos de venda | `20260817110000` |
| `sincronizar_eventos_financeiros_transacao()` | despesas e receitas próprias | `20260817110000` |
| `venda_reconhece_receita()` | regra de reconhecimento de venda | `20260802190000` |
| `natureza_dre_de_evento()` | natureza lida da linha mapeada | `20260811210000` |

**Conferência**

```
supabase/tests/checar_receitas_dre.sql   receita, ponta a ponta (seção 7)
npm run db:test:sql -- supabase/tests/checar_receitas_dre.sql <demo|demir|alpha|garage>
```

**Aplicação**

```
src/app/api/dre/route.ts                          árvore da DRE
src/app/api/dre/_calculo.ts                       busca no banco e monta a resposta
src/app/api/dre/_arvore.ts                        agregação, fórmulas, variações (puro)
src/app/api/dre/_arvore.test.ts                   npm run test:dre
src/app/api/dre/drilldown/route.ts                lançamentos de uma linha
src/app/(app)/(pages)/(financeiro)/dre/page.tsx   rota /dre
src/app/(app)/(pages)/(financeiro)/dre/dre-client.tsx  tela e diálogo
src/app/(app)/(pages)/(financeiro)/dre/types.ts   contrato compartilhado
```

Permissão: `PERMS.FINANCEIRO`, registrada em `src/middleware.ts` para `/dre` e
`/api/dre`. Menu em `src/app/(app)/components/sidebar/sidebar.tsx`.

---

## 11. Como continuar

**A receita está fechada.** Os quatro defeitos da seção 7 foram corrigidos pela
`20260817110000` e o script de conferência passa nos quatro bancos. O que
continua aberto do lado da receita é só a classificação de conta feita no
financeiro (achado transversal da seção 7), que é decisão de quem lança.

**Lançamento duplicado é o buraco que sobrou, e nenhum bloco do script pega.**
A conferência achou a duplicata do rendimento por acaso — só porque uma das duas
linhas tinha o tipo errado. Corrigido o tipo, as duas viraram receita legítima e
a duplicata ficou invisível. Procurando por mesmo valor + mesma data + mesma
conta no Demir, aparecem outros candidatos, agora em **despesa**:

```
R$   629,31  11/08  "Simples Nacional"        4 transações
R$ 2.126,78  11/08  "Simples Nacional"        3 transações
R$ 2.000,00  06/08  "Despesas não identif."   2 transações
R$ 1.000,00  30/08  "Serviços terceirizados"  2 transações
R$   225,00  10/08  "Sistemas e softwares"    2 transações
```

Nem toda repetição é duplicata — duas notas de mesmo valor no mesmo dia
acontecem. Mas o padrão que produziu a do rendimento (digitar, achar que errou,
digitar de novo, não limpar a primeira) produz exatamente isso, e despesa
duplicada reduz o lucro de mentira do mesmo jeito que a antecipação inflava a
receita. Vale um `checar_duplicatas_transacao.sql` antes de qualquer fechamento.

**Depois disso, conferir custo e despesa no mesmo molde.** Este ciclo só cobriu a
receita e achou seis coisas — e o defeito 1 apareceu justamente inflando a linha
10.2, que é despesa. As perguntas equivalentes:

- todo evento de custo tem contrapartida numa saída de estoque?
- CMV do período bate com o custo das saídas?
- despesa lançada duas vezes (transação + evento manual)?
- despesa em linha de natureza contrária (o bloco 6, do outro lado)?

**Fase 4 — integridade.** Status de período (`ABERTO`, `EM_REVISAO`, `FECHADO`)
com usuário, data e versão do template no fechamento; tela de pendências
consolidando o que hoje só existe como alerta na DRE (lançamento sem
classificação, item sem custo, período sem despesa); conciliação comparando
receita da DRE com vendas e OS reconhecidas, CMV com saídas de estoque, despesas
com contas a pagar.

O bloco 6 do script de conferência sugere uma pendência a mais: **lançamento com
natureza contrária à da linha**. Hoje não existe alerta nenhum para isso, e é o
tipo de erro que a tela nunca revela sozinha.

Fechar período só faz sentido quando houver mês completo — não antes de setembro.

**Fase 5 — exportação.** PDF, XLSX e CSV respeitando os filtros. No XLSX os
valores precisam sair como número, não texto.

**Ao retomar, verificar primeiro:**

1. Rodar `supabase/tests/checar_receitas_dre.sql` nos quatro bancos — é mais
   rápido que ler este documento e diz o estado real.
2. Se o mapeamento das contas foi revisado pelo contador (seção 12).
3. Se `osservico`/`osproduto` ainda têm PK composta (seção 13); se tiverem sido
   corrigidas, `source_item_id` precisa ser repontado para o novo id da linha.
4. Se os alertas de [route.ts](../src/app/api/dre/route.ts) já filtram
   `CONVERTIDO` junto de `ATIVO` (ver fim da seção 6.1).

---

## 12. Pendências que exigem validação contábil

- **Classificação das contas do plano nas linhas da DRE.** Decisão contábil, não
  técnica. A tela de mapeamento entrega uma sugestão automática a partir dos
  grupos; um contador precisa revisar antes de o relatório ser tratado como
  oficial.
- **Regime tributário.** O Demir está como Regime Normal (`regimetributario = 3`)
  — IRPJ e CSLL são linhas reais. Em empresa do Simples, esses tributos estariam
  dentro do DAS e pertenceriam às deduções, não à linha de tributos sobre lucro.
- **Comissões nunca baixadas.** No Demir há R$ 3.273,67 em 53 eventos de comissão
  `ATIVO`, nenhum `CONVERTIDO` (verificado em 17/08). Se o pagamento acontece
  fora do sistema, a despesa aparecerá na DRE por competência sem contrapartida
  no caixa.
- **Produto vendido sem custo.** Era o problema mais grave da versão original
  deste documento — CMV zero e margem de 100%. A `20260811210000` deu à função
  de custo um fallback (custo na OS → último valor de compra → preço médio) e o
  quadro melhorou muito: o CMV do Demir saiu de R$ 0,00 para R$ 111.369,15. Ainda
  assim, **47 dos 246 eventos de custo** carregam `custo_nao_informado`, então a
  linha 4.1 continua contendo itens a custo zero. O fallback só vale para evento
  gerado ou reconciliado depois de 11/08 — produto que nunca teve custo
  cadastrado segue sem custo. Decisão deliberada mantida: não estimar custo
  automaticamente, para não fabricar margem.

---

## 13. Limitações conhecidas do modelo

**PK composta em `osservico` e `osproduto`.** Uma OS não pode ter duas linhas do
mesmo serviço ou produto com preços diferentes. O catálogo de serviços do Demir
tem sete cadastros de "mão de obra" justamente como contorno disso. Corrigir
exige trocar a PK e ajustar `osservico_realizador`, `chave_origem` e as funções
de evento. Não bloqueia a DRE (ver 3.4), mas degrada o drill-down.
