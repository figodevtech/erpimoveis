# Eventos financeiros

`/eventos-financeiros` apresenta uma lista cronológica de eventos de OS,
comissões e eventos manuais de vendas. A exibição é sempre em lista, com identificação do documento
e do cliente, situação, valor e ações. Não há agrupamento por OS.

Cada card de evento de OS também mostra **Conclusão da OS**, a partir de
`ordemservico.execucao_fim_em`, no formato dia/mês/ano e fuso da oficina
(America/Fortaleza). Quando a data não está registrada, exibe **Sem data de
conclusão**. A API consulta as datas das OS da página em lote. A data do evento
continua visível; os filtros de período e a ordenação continuam usando
`data_evento`.

Os cartões refletem o filtro inteiro, independentemente da página. A busca
aceita descrição e número de OS ou venda. A gaveta permite filtrar por tipo de
documento, natureza, origem, OS, beneficiário e datas; os filtros aplicados
aparecem acima da lista e podem ser removidos individualmente.

- **Não lançados:** eventos elegíveis ainda sem título financeiro.
- **Lançados:** eventos vinculados ao financeiro; o pagamento deve ser conferido
  na transação, pois lançar não significa pagar.
- **Todos:** também inclui eventos automáticos, como receitas e custos, que
  compõem o resultado e não exigem novo título.

A seleção de despesas permanece ao trocar de página. Trocar busca, situação ou
filtros limpa a seleção. O servidor revalida valores e vínculos ao lançar.
Falhas de carregamento exibem erro e opção de tentar novamente.

## Eventos da venda

O diálogo de detalhes da venda tem a aba **Eventos financeiros**, disponível
para quem possui acesso ao financeiro. A API exige tanto acesso a vendas quanto
ao financeiro: `GET /api/venda/[id]/eventos-financeiros`.

A aba consulta os eventos ativos ou convertidos da própria venda: receitas,
custos, descontos, frete e comissão, com totais de receitas, despesas/deduções e
resultado. Eventos cancelados ficam fora. Os valores derivados são alterados na
venda; os eventos automáticos continuam protegidos e são corrigidos na origem.

**Novo lançamento** cria um fato econômico complementar com natureza Receita ou
Despesa e tipo Produto, Serviço ou Consumo (consumo é sempre despesa). Não altera
itens, estoque, total comercial, frete, desconto, documentos fiscais ou pagamentos
do cliente. Os manuais mostram o autor e permitem editar título, detalhe e valor
ou excluir, inclusive em venda finalizada, cancelada ou recusada.

A criação exige `financeiro:criar`, edição `financeiro:editar` e exclusão
`financeiro:excluir`, além dos acessos a Vendas e Financeiro. O status comercial
não bloqueia estas operações. Eventos convertidos ou com vínculo financeiro
exigem desfazer primeiro a transação ou o lançamento; as proteções de pagamento
e autoria do financeiro continuam vigentes. A exclusão tem prévia de impacto e
auditoria, sem estorno de estoque para estes eventos avulsos.

Receitas usam `evento_financeiro_id` e despesas usam `lancamento_de_eventos`, com
agrupamento e parcelamento. Nenhum caminho cria um segundo fato na DRE. A fila
global também mostra os manuais. A competência é `datavenda/createdat` e alterações
avisam quando afetam meses anteriores.

A proveniência exige **ambos** `is_manual=true` e `chave_origem=MANUAL:<uuid>`.
Overrides de comissão continuam governados pela regra existente. A sincronização
automática preserva manuais em mudanças de status, produtos, frete e desconto.
O recurso depende de `20261005162941_eventos_financeiros_manuais_venda.sql`.

Quem tem permissão para criar lançamentos financeiros pode usar **Adicionar despesa
de frete** no menu da receita de frete da venda. A despesa guarda o vínculo com a
receita e sua competência, sem alterar o valor cobrado do cliente. Ela aparece na
aba da venda e na fila financeira, onde pode ser lançada e ter sua transação consultada,
assim como as comissões. Zerar o frete cobrado não remove o custo manual da transportadora.
O recurso depende da migração `20260911140000_despesa_frete_venda.sql`. A nova
regra também preserva esta despesa manual quando a venda é cancelada. A criação
vinculada continua exigindo uma receita de frete ativa; um fato independente usa
**Novo lançamento**.

Comissões históricas anteriores a setembro
de 2026 mantêm a regra de preservação documentada em
[`lancamentos-financeiros-e-comissoes.md`](../lancamentos-financeiros-e-comissoes.md).
