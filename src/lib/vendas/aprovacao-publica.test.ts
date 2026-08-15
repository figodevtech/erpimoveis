import assert from "node:assert/strict";
import test from "node:test";
import {
  montarVendaParaAprovacaoPublica,
  obterEstadoTokenAprovacao,
} from "./aprovacao-publica";

test("o estado público bloqueia token usado, expirado e venda fora da etapa de aprovação", () => {
  const agora = Date.parse("2026-08-14T12:00:00.000Z");
  const vendaPendente = { status: "APROVACAO_ORCAMENTO", statusaprovacao: "PENDENTE" };

  assert.equal(obterEstadoTokenAprovacao(null, vendaPendente, agora), "INVALIDO");
  assert.equal(
    obterEstadoTokenAprovacao(
      { usado_em: "2026-08-14T11:00:00.000Z", expira_em: "2026-08-15T12:00:00.000Z" },
      vendaPendente,
      agora,
    ),
    "USADO",
  );
  assert.equal(
    obterEstadoTokenAprovacao({ expira_em: "2026-08-14T11:59:59.000Z" }, vendaPendente, agora),
    "EXPIRADO",
  );
  assert.equal(
    obterEstadoTokenAprovacao(
      { expira_em: "2026-08-15T12:00:00.000Z" },
      { status: "PAGAMENTO", statusaprovacao: "APROVADA" },
      agora,
    ),
    "INDISPONIVEL",
  );
  assert.equal(
    obterEstadoTokenAprovacao(
      { expira_em: "2026-08-15T12:00:00.000Z" },
      vendaPendente,
      agora,
    ),
    "VALIDO",
  );
});

test("a projeção pública contém somente os dados comerciais permitidos", () => {
  const publico = montarVendaParaAprovacaoPublica({
    id: 42,
    descricao: "Proposta comercial",
    desconto_tipo: "PORCENTAGEM",
    desconto_valor: 10,
    valor_frete: 20,
    valortotal: 194,
    cliente: {
      nomerazaosocial: "Cliente Teste",
      cpfcnpj: "12345678900",
    },
    observacoes: "segredo interno",
    descricao_financeiro: "cobrar na retirada",
    observacoes_fiscais: "não imprimir",
    garantia: "informação privada",
    itens: [
      {
        id: 1,
        quantidade: 2,
        sub_total: 200,
        tipo_desconto: "FIXO",
        valor_desconto: 10,
        valor_frete: 3,
        valor_total: 193,
        produto: { id: 9, titulo: "Produto A" },
      },
    ],
  } as Parameters<typeof montarVendaParaAprovacaoPublica>[0] & Record<string, unknown>);

  assert.deepEqual(publico.totais, {
    subtotal: 200,
    subtotalProdutos: 200,
    desconto: 29,
    descontoItens: 10,
    descontoGeral: { tipo: "PORCENTAGEM", valor: 10, aplicado: 19 },
    frete: 23,
    freteItens: 3,
    freteGeral: 20,
    total: 194,
  });
  assert.deepEqual(publico.itens[0].desconto, { tipo: "FIXO", valor: 10, aplicado: 10 });
  assert.equal(publico.itens[0].frete, 3);
  assert.equal(publico.cliente.nomerazaosocial, "Cliente Teste");

  const json = JSON.stringify(publico);
  for (const dadoPrivado of [
    "12345678900",
    "segredo interno",
    "cobrar na retirada",
    "não imprimir",
    "informação privada",
  ]) {
    assert.equal(json.includes(dadoPrivado), false);
  }
});
