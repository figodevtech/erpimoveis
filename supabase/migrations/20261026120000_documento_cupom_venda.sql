BEGIN;

-- Cupom de venda: modelo de fábrica para a impressora térmica de 80 mm.
--
-- O cupom não fiscal do caixa (empresa, itens, totais, forma de pagamento,
-- cliente) vira um documento dinâmico do módulo venda, emitido pelo diálogo
-- da venda. O `data-documento-bobina="80mm"` no <body> faz a emissão sair em
-- uma tira só, da altura do conteúdo, em vez de folhas A4.
--
-- O seed é cópia de src/lib/documentos/padrao.ts; `padrao.test.ts` confronta
-- as duas. Não atropela: padrão já semeado (mesmo excluído) fica como está, e
-- banco que já tem um documento de venda com o mesmo nome não ganha outro (o
-- índice único por módulo e nome recusaria).
--
-- ORDEM DO DEPLOY
-- Indiferente: o código antigo lista o modelo, mas emite em folha A4.

INSERT INTO public.documento_modelo (codigo_padrao, modulo, nome, ordem, html)
SELECT padrao.codigo_padrao, padrao.modulo, padrao.nome, padrao.ordem, padrao.html
FROM (
  VALUES
  ('venda_cupom', 'venda', 'Cupom de venda', 3, $doc$<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Cupom de venda</title>
<style>
  @page { margin: 3mm 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Courier New", Courier, monospace; font-size: 11px; line-height: 1.35; color: #000; background: #fff; }
  p { margin: 0; }
  .centro { text-align: center; }
  .empresa strong { display: block; font-size: 12px; }
  .linha { margin: 5px 0; border: 0; border-top: 1px dashed #000; }
  .par { display: flex; justify-content: space-between; gap: 8px; }
  .par span:last-child { text-align: right; white-space: nowrap; }
  .itens { width: 100%; border-collapse: collapse; }
  .itens th { padding: 0 0 2px; font-weight: normal; text-align: left; }
  .itens td { padding: 0; vertical-align: top; }
  .itens .num { text-align: right; white-space: nowrap; padding-left: 6px; }
  .itens .produto td { padding-top: 4px; }
  .total { margin-top: 2px; font-size: 13px; font-weight: bold; }
  .doc-pagamentos { margin: 2px 0 0; padding: 0; list-style: none; }
  .aviso { margin-top: 6px; font-weight: bold; }
</style>
</head>
<body data-documento-bobina="80mm">
<div class="centro empresa">
  <strong>{{empresa.razao_social}}</strong>
  <p>CNPJ: {{empresa.cnpj}} IE: {{empresa.inscricao_estadual}}</p>
  <p>{{empresa.endereco}}</p>
  <p>{{empresa.telefone}}</p>
</div>
<hr class="linha" />
<div class="par"><span>{{venda.data_hora}}</span><span>VENDA Nº {{venda.numero}}</span></div>
<hr class="linha" />
<table class="itens">
  <thead>
    <tr><th>Item</th><th class="num">Qtde</th><th class="num">Vl. unit.</th><th class="num">Total</th></tr>
  </thead>
  <tbody>
{{#itens}}
    <tr class="produto"><td colspan="4">{{item.codigo}} {{item.descricao}}</td></tr>
    <tr><td>{{item.unidade}}</td><td class="num">{{item.quantidade}}</td><td class="num">{{item.valor_unitario}}</td><td class="num">{{item.total}}</td></tr>
{{/itens}}
  </tbody>
</table>
<hr class="linha" />
<div class="par"><span>Quantidade de itens</span><span>{{venda.quantidade_itens}}</span></div>
<div class="par"><span>Subtotal</span><span>{{venda.subtotal}}</span></div>
{{#se_desconto}}<div class="par"><span>Descontos</span><span>- {{venda.desconto}}</span></div>{{/se_desconto}}
{{#se_frete}}<div class="par"><span>Frete</span><span>{{venda.frete}}</span></div>{{/se_frete}}
{{#se_acrescimo}}<div class="par"><span>Acréscimo</span><span>{{venda.acrescimo}}</span></div>{{/se_acrescimo}}
<div class="par total"><span>TOTAL</span><span>{{venda.total}}</span></div>
<hr class="linha" />
<p>FORMA DE PAGAMENTO</p>
{{venda.pagamentos}}
<hr class="linha" />
{{#se_sem_cliente}}<p>Consumidor não identificado</p>{{/se_sem_cliente}}
{{#se_pessoa_fisica}}<p>Cliente: {{cliente.nome}}</p>
<p>CPF: {{cliente.documento}}</p>{{/se_pessoa_fisica}}
{{#se_pessoa_juridica}}<p>Cliente: {{cliente.nome}}</p>
<p>CNPJ: {{cliente.documento}}</p>{{/se_pessoa_juridica}}
<hr class="linha" />
<p>Vendedor: {{venda.vendedor}}</p>
<p>Emitido em {{documento.hora_emissao}} por {{documento.emitido_por}}</p>
<p class="centro aviso">NÃO É DOCUMENTO FISCAL</p>
</body>
</html>
$doc$)
) AS padrao (codigo_padrao, modulo, nome, ordem, html)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.documento_modelo existente
  WHERE existente.modulo = padrao.modulo
    AND lower(btrim(existente.nome)) = lower(btrim(padrao.nome))
    AND NOT existente.is_deleted
)
ON CONFLICT (codigo_padrao) DO NOTHING;

COMMIT;
