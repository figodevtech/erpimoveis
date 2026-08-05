// Regras de emissão validadas antes de a NF-e virar rascunho.
//
// `validarDraftAvulso` é o portão dos dois motores: a emissão avulsa chama
// direto, e a emissão a partir de OS/Venda cai aqui depois, porque
// `salvarNFeDeOrigem` delega para `salvarNFeAvulsaDraft`. Os casos abaixo
// cobrem o que foi mexido recentemente — frete no total, descrição do tPag 99,
// combinação do tPag 90 — mais o caminho feliz, que é o que garante que nada
// disso passou a barrar emissão legítima.

import "./__testEnv";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarDraftAvulso } from "./nfeAvulsaService";

type Draft = Parameters<typeof validarDraftAvulso>[0];

function itemBase(overrides: Partial<Draft["itens"][number]> = {}): Draft["itens"][number] {
  return {
    descricao: "PECA DE TESTE",
    ncm: "84099900",
    cfop: "5102",
    unidade: "UN",
    quantidade: 2,
    valorUnitario: 50,
    valorDesconto: 0,
    orig: "0",
    csosn: "102",
    cstPis: "49",
    cstCofins: "49",
    ...overrides,
  };
}

function draftBase(overrides: Partial<Draft> = {}): Draft {
  return {
    operacao: {
      tipoOperacao: "SAIDA",
      naturezaOperacao: "VENDA DE MERCADORIA",
      finalidade: "NORMAL",
      consumidorFinal: true,
      indicadorPresenca: "1",
    },
    destinatario: {
      clienteId: null,
      tipoPessoa: "JURIDICA",
      cpfCnpj: "19131243000197",
      nomeRazaoSocial: "CLIENTE TESTE LTDA",
      indicadorIe: "9",
      inscricaoEstadual: "",
      endereco: "RUA DAS FLORES",
      numero: "100",
      bairro: "CENTRO",
      cidade: "JOAO PESSOA",
      estado: "PB",
      cep: "58010000",
      codigoMunicipio: "2507507",
    },
    // 2 x 50 = 100,00 — é esse total que os pagamentos precisam fechar.
    itens: [itemBase()],
    pagamentos: [{ meio: "01", valor: 100, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    ...overrides,
  };
}

function erros(draft: Draft, campo: string) {
  return validarDraftAvulso(draft).filter((erro) => erro.field === campo);
}

function errosDePagamento(draft: Draft) {
  return validarDraftAvulso(draft).filter((erro) => erro.step === "payment");
}

describe("emissão avulsa: caminho feliz", () => {
  it("não acusa pendência numa nota completa", () => {
    assert.deepEqual(validarDraftAvulso(draftBase()), []);
  });

  it("aceita a nota com frete quando os pagamentos incluem o frete", () => {
    const draft = draftBase({
      itens: [itemBase({ valorFrete: 20 })],
      pagamentos: [
        { meio: "01", valor: 60, tipoIntegracao: "2" },
        { meio: "17", valor: 60, tipoIntegracao: "2" },
      ],
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });
});

describe("emissão avulsa: frete no total da nota", () => {
  it("cobra o frete na soma dos pagamentos", () => {
    // Produtos 100 + frete 20: pagar só os 100 tem de acusar diferença.
    const draft = draftBase({
      itens: [itemBase({ valorFrete: 20 })],
      pagamentos: [
        { meio: "01", valor: 50, tipoIntegracao: "2" },
        { meio: "17", valor: 50, tipoIntegracao: "2" },
      ],
    });

    const encontrados = erros(draft, "pagamentos");
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /120\.00/);
  });

  it("recusa frete negativo no item", () => {
    const draft = draftBase({ itens: [itemBase({ valorFrete: -1 })] });
    assert.equal(erros(draft, "valorFrete").length, 1);
  });
});

describe("emissão avulsa: método de pagamento", () => {
  it("exige descrição quando o método é 99 - Outros", () => {
    const draft = draftBase({
      pagamentos: [{ meio: "99", valor: 100, tipoIntegracao: "2" }],
    });

    const encontrados = erros(draft, "pagamentos.0.descricao");
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /descrição/i);
  });

  it("aceita o método 99 com a descrição preenchida", () => {
    const draft = draftBase({
      pagamentos: [
        { meio: "99", valor: 100, tipoIntegracao: "2", descricao: "PERMUTA" },
      ],
    });

    assert.deepEqual(errosDePagamento(draft), []);
  });

  it("aceita o método 90 - Sem pagamento sozinho", () => {
    const draft = draftBase({
      pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
    });

    assert.deepEqual(errosDePagamento(draft), []);
  });

  it("recusa o método 90 combinado com outro", () => {
    const draft = draftBase({
      pagamentos: [
        { meio: "90", valor: 0, tipoIntegracao: "2" },
        { meio: "01", valor: 100, tipoIntegracao: "2" },
      ],
    });

    const mensagens = errosDePagamento(draft).map((erro) => erro.message);
    assert.ok(mensagens.some((mensagem) => /Sem pagamento não pode ser combinado/i.test(mensagem)));
  });

  it("recusa o mesmo método informado duas vezes", () => {
    const draft = draftBase({
      pagamentos: [
        { meio: "01", valor: 50, tipoIntegracao: "2" },
        { meio: "01", valor: 50, tipoIntegracao: "2" },
      ],
    });

    const mensagens = errosDePagamento(draft).map((erro) => erro.message);
    assert.ok(mensagens.some((mensagem) => /mais de uma vez/i.test(mensagem)));
  });

  it("dispensa pagamento em nota de ajuste e devolução", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, finalidade: "AJUSTE" },
      pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
    });

    assert.deepEqual(errosDePagamento(draft), []);
  });
});

describe("emissão avulsa: destinatário e transporte", () => {
  it("exige inscrição estadual quando o destinatário é contribuinte", () => {
    const draft = draftBase({
      destinatario: { ...draftBase().destinatario, indicadorIe: "1", inscricaoEstadual: "" },
    });

    assert.equal(erros(draft, "inscricaoEstadual").length, 1);
  });

  it("aceita contribuinte com inscrição estadual preenchida", () => {
    const draft = draftBase({
      destinatario: { ...draftBase().destinatario, indicadorIe: "1", inscricaoEstadual: "160000000" },
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });

  it("cobra os dados da transportadora quando o frete é contratado", () => {
    const draft = draftBase({ transporte: { modFrete: "0" } });
    const campos = validarDraftAvulso(draft)
      .filter((erro) => erro.step === "transport")
      .map((erro) => erro.field);

    assert.deepEqual(campos.sort(), [
      "transportadora.documento",
      "transportadora.nome",
      "transportadora.uf",
    ]);
  });

  it("aceita frete contratado com a transportadora completa", () => {
    const draft = draftBase({
      transporte: {
        modFrete: "0",
        transportadora: {
          documento: "19131243000197",
          nome: "TRANSPORTES TESTE LTDA",
          uf: "PB",
        },
      },
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });

  it("recusa CPF/CNPJ inválido do destinatário", () => {
    const draft = draftBase({
      destinatario: { ...draftBase().destinatario, cpfCnpj: "11111111111111" },
    });

    assert.equal(erros(draft, "cpfCnpj").length, 1);
  });
});
