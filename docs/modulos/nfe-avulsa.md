# NF-e avulsa — resolução de DIFAL na edição

A tela consulta `POST /api/fiscal/difal/resolver` ao carregar os itens e quando
NCM, CEST, CST/CSOSN, CFOP, origem da mercadoria ou contexto da nota mudam.
Reutiliza `assinaturaDifalDe`, `resolverDifalDosItens` e
`aplicarResolucaoDifal` da emissão assistida. As regras continuam no resolvedor
fiscal existente; a interface apenas aplica a resposta.

A consulta tem debounce de 350 ms e `AbortController`. Trocar a classificação,
trocar de rascunho ou sair da tela cancela a consulta anterior. Antes de aplicar
a resposta, o estado atual é conferido novamente contra a assinatura consultada.
As alíquotas não entram na assinatura, evitando consultas em ciclo.

Interna, FCP, interestadual e partilha automáticos são atualizados. Campos
marcados como manuais são preservados. Enquanto uma nova resolução é buscada,
os valores automáticos do contexto anterior são limpos; se a consulta falhar,
eles continuam vazios. FCP resolvido em zero é exibido como `0`.

O contexto inclui UF do destinatário, consumidor final, indicador de IE,
entrada/saída, finalidade, UF de entrega e data fiscal. A UF e o CRT do emitente
são obtidos pelo servidor. Notas autorizadas não disparam essa atualização.
As chaves da consulta identificam cada linha, sem alterar o vínculo do item
com o produto ou estoque de origem.

Testes: `difal-resolucao-tela.test.ts` e `emissao-assistida-model.test.ts`, na
pasta `gerarNotaDeOsDialog`.
