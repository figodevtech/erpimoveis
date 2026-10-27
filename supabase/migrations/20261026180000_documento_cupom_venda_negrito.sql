BEGIN;

-- Cupom de venda mais escuro.
--
-- Na térmica o cupom saiu claro: o traço fino do Courier quase some. O texto
-- novo põe tudo em negrito, numa fonte de traço grosso (Consolas), um ponto
-- maior. O pé da tira ganhou folga no código (paginar.ts), não aqui.
--
-- Só troca o cupom que ainda está com o texto original da migration
-- 20261026120000 (md5 abaixo): o que a oficina já editou fica como está, e o
-- "Restaurar texto padrão" da tela traz esta versão.
--
-- O texto é cópia de src/lib/documentos/padrao.ts; `padrao.test.ts` confronta
-- as duas.

UPDATE public.documento_modelo AS existente
SET html = padrao.html
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
  body { margin: 0; font-family: Consolas, "Lucida Console", "Courier New", monospace; font-size: 12px; font-weight: bold; line-height: 1.35; color: #000; background: #fff; }
  p { margin: 0; }
  .centro { text-align: center; }
  .empresa strong { display: block; font-size: 13px; }
  .linha { margin: 5px 0; border: 0; border-top: 1.5px dashed #000; }
  .par { display: flex; justify-content: space-between; gap: 8px; }
  .par span:last-child { text-align: right; white-space: nowrap; }
  .itens { width: 100%; border-collapse: collapse; }
  .itens th { padding: 0 0 2px; font-weight: bold; text-align: left; }
  .itens td { padding: 0; vertical-align: top; }
  .itens .num { text-align: right; white-space: nowrap; padding-left: 6px; }
  .itens .produto td { padding-top: 4px; }
  .total { margin-top: 2px; font-size: 14px; }
  .doc-pagamentos { margin: 2px 0 0; padding: 0; list-style: none; }
  .aviso { margin-top: 6px; }
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
WHERE existente.codigo_padrao = padrao.codigo_padrao
  AND md5(existente.html) = '8b560df31a787adf7eecf811090d9247';

COMMIT;
