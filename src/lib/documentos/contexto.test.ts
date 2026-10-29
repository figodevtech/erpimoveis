import assert from "node:assert/strict";
import test from "node:test";

import { CATALOGOS } from "./catalogo";
import { contextoDaVenda, type EmissaoDocumento } from "./contexto";
import { EMPRESA_EXEMPLO, VENDA_EXEMPLO, contextoDeExemplo } from "./exemplos";
import { MODULOS_DOCUMENTO } from "./tipos";

const EMISSAO: EmissaoDocumento = {
  nomeDocumento: "Teste",
  emitidoPor: "Ana",
  agora: new Date("2026-10-14T15:00:00Z"),
  logoUrl: null,
};

const semEspacoDuro = (s: unknown) => String(s).replace(/\s/g, " ");

function valor(contexto: Record<string, unknown>, chave: string) {
  return chave.split(".").reduce<unknown>((atual, parte) => (atual as Record<string, unknown> | undefined)?.[parte], contexto);
}

test("toda variável do catálogo sai do contexto de cada módulo", () => {
  for (const modulo of MODULOS_DOCUMENTO) {
    const contexto = contextoDeExemplo(modulo);
    const catalogo = CATALOGOS[modulo];
    for (const grupo of catalogo.grupos) {
      for (const variavel of grupo.variaveis) {
        assert.equal(typeof valor(contexto, variavel.chave), "string", `${modulo}: ${variavel.chave} não está no contexto`);
      }
    }
    for (const condicao of catalogo.condicoes) {
      assert.equal(typeof contexto[condicao.chave], "boolean", `${modulo}: a condição ${condicao.chave} não está no contexto`);
    }
    for (const lista of catalogo.listas) {
      const linhas = contexto[lista.chave];
      assert.ok(Array.isArray(linhas) && linhas.length > 0, `${modulo}: a lista ${lista.chave} veio vazia no exemplo`);
      for (const campo of lista.campos) {
        assert.equal(typeof (linhas[0] as Record<string, unknown>)[campo.chave], "string", `${modulo}: ${lista.chave}.${campo.chave} não está no item`);
      }
    }
  }
});

test("empresa: endereço completo com a cidade; sem ela, só a UF", () => {
  const ctx = contextoDaVenda({ venda: VENDA_EXEMPLO, empresa: EMPRESA_EXEMPLO, pagamentos: null, emissao: EMISSAO }) as any;
  assert.equal(ctx.empresa.endereco, "Av. Epitácio Pessoa, nº 1000, Loja 2 · Tambaú · João Pessoa/PB · CEP 58039-000");
  assert.equal(ctx.empresa.cidade, "João Pessoa");

  const semCidade = contextoDaVenda({
    venda: VENDA_EXEMPLO,
    empresa: { ...EMPRESA_EXEMPLO, cidade: null },
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(semCidade.empresa.endereco, "Av. Epitácio Pessoa, nº 1000, Loja 2 · Tambaú · PB · CEP 58039-000");
});

test("condições do cliente: exatamente uma das três vale", () => {
  const venda = (cliente: unknown) =>
    contextoDaVenda({ venda: { ...VENDA_EXEMPLO, cliente }, empresa: null, pagamentos: null, emissao: EMISSAO }) as any;
  const condicoes = (ctx: any) => [ctx.se_pessoa_juridica, ctx.se_pessoa_fisica, ctx.se_sem_cliente];
  const pj = venda({ nomerazaosocial: "ACME LTDA", tipopessoa: "JURIDICA", cpfcnpj: "30430969000163" });
  assert.deepEqual(condicoes(pj), [true, false, false]);
  const pf = venda({ nomerazaosocial: "Maria", tipopessoa: "FISICA", cpfcnpj: "12345678909" });
  assert.deepEqual(condicoes(pf), [false, true, false]);
  // Sem tipo no cadastro, o documento decide.
  const semTipo = venda({ nomerazaosocial: "ACME", cpfcnpj: "30.430.969/0001-63" });
  assert.deepEqual(condicoes(semTipo), [true, false, false]);
  assert.deepEqual(condicoes(venda(null)), [false, false, true]);
  // O Consumidor Final do sistema é venda sem cliente identificado.
  const consumidorFinal = venda({ nomerazaosocial: "CONSUMIDOR FINAL", tipopessoa: "FISICA", cpfcnpj: null, codigo_sistema: "consumidor_final" });
  assert.deepEqual(condicoes(consumidorFinal), [false, false, true]);
  assert.equal(consumidorFinal.cliente.nome, "");
});

test("venda: linhas de desconto, frete e acréscimo só quando há valor", () => {
  const venda = (extra: Record<string, unknown>) =>
    contextoDaVenda({ venda: { ...VENDA_EXEMPLO, ...extra }, empresa: null, pagamentos: null, emissao: EMISSAO }) as any;
  const exemplo = venda({});
  assert.deepEqual([exemplo.se_desconto, exemplo.se_frete], [true, true]);
  const limpa = venda({
    itens: [{ id: 1, quantidade: 1, sub_total: 35, valor_total: 35, produto: { titulo: "Filtro de ar" } }],
    desconto_tipo: null,
    desconto_valor: 0,
    valor_frete: 0,
    acrescimo_financeiro_tipo: null,
    acrescimo_financeiro_valor: 0,
  });
  assert.deepEqual([limpa.se_desconto, limpa.se_frete, limpa.se_acrescimo], [false, false, false]);
});

test("venda: totais iguais aos do diálogo (descontos de item e geral, frete)", () => {
  const ctx = contextoDaVenda({ venda: VENDA_EXEMPLO, empresa: EMPRESA_EXEMPLO, pagamentos: null, emissao: EMISSAO }) as any;
  // 180 + 140 = 320; 10% no segundo item = 14; geral fixo 20; frete 30.
  assert.equal(semEspacoDuro(ctx.venda.subtotal), "R$ 320,00");
  assert.equal(semEspacoDuro(ctx.venda.desconto), "R$ 34,00");
  assert.equal(semEspacoDuro(ctx.venda.total), "R$ 316,00");
  assert.equal(ctx.venda.total_extenso, "trezentos e dezesseis reais");
  assert.equal(semEspacoDuro(ctx.itens[1].valor_unitario), "R$ 35,00");
  assert.equal(semEspacoDuro(ctx.itens[1].desconto), "R$ 14,00");
  assert.equal(ctx.cliente.nome, "Maria da Silva Souza");
  assert.equal(ctx.cliente.documento, "123.456.789-09");
  assert.equal(ctx.cliente.tipo_pessoa, "Pessoa física");
  assert.equal(ctx.venda.pagamentos, "");
  assert.equal(ctx.documento.data_emissao_extenso, "14 de outubro de 2026");
  assert.equal(ctx.venda.ano, "2026");
  assert.equal(ctx.venda.ano_curto, "26");
});

test("venda: acréscimo financeiro entra no total", () => {
  const ctx = contextoDaVenda({
    venda: { ...VENDA_EXEMPLO, acrescimo_financeiro_tipo: "PORCENTAGEM", acrescimo_financeiro_valor: 10 },
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(semEspacoDuro(ctx.venda.acrescimo), "R$ 31,60");
  assert.equal(semEspacoDuro(ctx.venda.total), "R$ 347,60");
  assert.equal(ctx.empresa.nome, "");
});

test("tabelas prontas escapam o texto dos itens", () => {
  const ctx = contextoDaVenda({
    venda: { ...VENDA_EXEMPLO, itens: [{ ...VENDA_EXEMPLO.itens[0], produto: { id: 1, titulo: "<b>Peça</b>" } }] },
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.ok(ctx.venda.itens_tabela.includes("&lt;b&gt;Peça&lt;/b&gt;"));
  assert.ok(!ctx.venda.itens_tabela.includes("<b>"));
});
