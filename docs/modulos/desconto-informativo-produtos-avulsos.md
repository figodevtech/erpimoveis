# Desconto informativo em produtos avulsos

Na OS e no orçamento individual, cada produto avulso pode ter uma anotação de
desconto em reais ou percentual. O campo está disponível ao lançar o item e na
tabela de edição. Selecione **Sem** para remover a anotação.

A impressão apresenta abaixo da descrição: “Desconto informativo: R$ 25,00
(não abatido dos totais)”, ou o percentual informado. Valores zerados são omitidos.

Esse desconto não reduz o subtotal do item nem os totais da OS/orçamento, não
participa do desconto geral e não gera abatimento financeiro. Os descontos
comerciais existentes mantêm suas regras.

Ao gerar uma OS a partir do orçamento, a anotação acompanha o produto avulso.
Ao vincular o avulso a um produto do estoque, ela deixa de existir com o avulso;
não é convertida em desconto comercial do produto cadastrado.

## Banco de dados

Aplicar a migration `20260923000200_desconto_informativo_produtos_avulsos.sql`
antes de publicar o código. Ela acrescenta `desconto_informativo_tipo` e
`desconto_informativo` a `osproduto_avulso` e `orcamento_produto_avulso`, sem
recalcular documentos existentes. As permissões e regras de estoque permanecem
as mesmas.

## Validação

`npx tsx --test src/lib/ordens/desconto-informativo.test.ts` verifica isolamento
dos totais, coexistência com descontos comerciais, normalização e texto impresso.

`npx tsx scripts/db/test-desconto-informativo.ts` valida a migration no banco de
demonstração e desfaz tudo com rollback. O teste usa cópias temporárias das
tabelas para conferir gravação e restrições sem acionar operações comerciais.
