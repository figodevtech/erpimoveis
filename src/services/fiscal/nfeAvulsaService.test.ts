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

import {
  validarDraftAvulso,
  validarLimiteTotalDevolucao,
} from "./nfeAvulsaService";

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

describe("emissão avulsa: catálogo oficial de CFOP", () => {
  it("recusa 6405 numa chamada direta antes de gravar o rascunho", () => {
    const encontrados = erros(draftBase({ itens: [itemBase({ cfop: "6405" })] }), "cfop");
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /não existe na tabela vigente/i);
  });

  it("recusa na NFC-e um CFOP que existe, mas não é permitido no modelo 65", () => {
    const encontrados = erros(
      draftBase({ modelo: 65, itens: [itemBase({ cfop: "6102" })] }),
      "cfop",
    );
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /não é permitido em NFC-e/i);
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

  it("aceita frete por conta do remetente sem transportadora informada", () => {
    // Caso real: nota de garantia autorizada pela SEFAZ com modFrete=0 e
    // nenhum dado de transportadora — o grupo <transporta> é opcional no
    // layout da NF-e independente do modFrete.
    const draft = draftBase({ transporte: { modFrete: "0" } });

    assert.deepEqual(
      validarDraftAvulso(draft).filter((erro) => erro.step === "transport"),
      [],
    );
  });

  it("cobra os dados da transportadora quando algum campo dela é preenchido pela metade", () => {
    const draft = draftBase({
      transporte: { modFrete: "0", transportadora: { nome: "TRANSPORTES TESTE LTDA" } },
    });
    const campos = validarDraftAvulso(draft)
      .filter((erro) => erro.step === "transport")
      .map((erro) => erro.field);

    assert.deepEqual(campos.sort(), ["transportadora.documento", "transportadora.uf"]);
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

  it("recusa não contribuinte marcado como não consumidor final", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, consumidorFinal: false },
    });

    assert.equal(erros(draft, "consumidorFinal").length, 1);
  });
});

describe("emissão avulsa: entrega/retirada", () => {
  function entregaCompleta(overrides: Partial<NonNullable<Draft["entrega"]>> = {}) {
    return {
      habilitado: true,
      tipoPessoa: "FISICA" as const,
      cpfCnpj: "12345678909",
      nome: "Gustavo Guarnieri Guarnieri",
      endereco: "AVENIDA RIO DE JANEIRO",
      numero: "SN",
      complemento: "RETIRADA EM AEROPORTO",
      bairro: "PARQUE JOAO BRAZ",
      cidade: "GOIANIA",
      estado: "GO",
      cep: "74483500",
      codigoMunicipio: "5208707",
      ...overrides,
    };
  }

  it("não acusa pendência quando a entrega não foi habilitada", () => {
    assert.deepEqual(validarDraftAvulso(draftBase()), []);
  });

  it("aceita entrega/retirada com todos os dados preenchidos", () => {
    const draft = draftBase({ entrega: entregaCompleta() });
    assert.deepEqual(
      validarDraftAvulso(draft).filter((erro) => erro.step === "delivery"),
      [],
    );
  });

  it("cobra os dados obrigatórios quando a entrega é habilitada vazia", () => {
    const draft = draftBase({ entrega: { habilitado: true } });
    const campos = validarDraftAvulso(draft)
      .filter((erro) => erro.step === "delivery")
      .map((erro) => erro.field);

    assert.deepEqual(campos.sort(), [
      "entrega.bairro",
      "entrega.cidade",
      "entrega.codigoMunicipio",
      "entrega.cpfCnpj",
      "entrega.endereco",
      "entrega.estado",
      "entrega.nome",
      "entrega.numero",
    ]);
  });

  it("recusa CPF inválido da pessoa indicada", () => {
    const draft = draftBase({ entrega: entregaCompleta({ cpfCnpj: "11111111111" }) });
    const campos = validarDraftAvulso(draft)
      .filter((erro) => erro.step === "delivery")
      .map((erro) => erro.field);

    assert.deepEqual(campos, ["entrega.cpfCnpj"]);
  });

  it("recusa código IBGE do município fora do padrão", () => {
    const draft = draftBase({ entrega: entregaCompleta({ codigoMunicipio: "123" }) });
    const campos = validarDraftAvulso(draft)
      .filter((erro) => erro.step === "delivery")
      .map((erro) => erro.field);

    assert.deepEqual(campos, ["entrega.codigoMunicipio"]);
  });

  it("aceita CEP vazio, mas recusa CEP incompleto", () => {
    const semCep = draftBase({ entrega: entregaCompleta({ cep: "" }) });
    assert.deepEqual(
      validarDraftAvulso(semCep).filter((erro) => erro.field === "entrega.cep"),
      [],
    );

    const cepIncompleto = draftBase({ entrega: entregaCompleta({ cep: "1234" }) });
    assert.equal(
      validarDraftAvulso(cepIncompleto).filter((erro) => erro.field === "entrega.cep").length,
      1,
    );
  });

  it("aceita entrega em UF diferente do destinatário sem transportadora — nota de garantia da Demir", () => {
    // Destinatário fiscal em MT, retirada física em GO por terceiro, frete
    // por conta do remetente (modFrete=0) sem transportadora contratada.
    const draft = draftBase({
      destinatario: {
        ...draftBase().destinatario,
        cpfCnpj: "39838572000180",
        nomeRazaoSocial: "DIESEL TEC LTDA",
        cidade: "CONFRESA",
        estado: "MT",
        codigoMunicipio: "5103353",
      },
      transporte: { modFrete: "0" },
      entrega: entregaCompleta(),
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });
});

describe("emissão avulsa: NF-e referenciada", () => {
  // Chave real do rascunho da Garage Premium: serve porque o DV confere.
  const chaveValida = "25260850114987000143550030000000011872971236";

  function devolucao(overrides: Partial<Draft> = {}): Draft {
    return draftBase({
      operacao: {
        ...draftBase().operacao,
        finalidade: "DEVOLUCAO",
        naturezaOperacao: "DEVOLUCAO DE MERCADORIA",
        consumidorFinal: false,
        indicadorPresenca: "0",
      },
      destinatario: {
        ...draftBase().destinatario,
        indicadorIe: "1",
        inscricaoEstadual: "160000000",
      },
      pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
      ...overrides,
    });
  }

  it("cobra a nota de origem numa devolução", () => {
    assert.equal(erros(devolucao(), "documentosReferenciados").length, 1);
  });

  it("aceita a devolução com a chave da NF-e original", () => {
    const draft = devolucao({ documentosReferenciados: [{ chaveAcesso: chaveValida }] });
    assert.deepEqual(validarDraftAvulso(draft), []);
  });

  it("aceita a referência granular usada pelo motor de saída", () => {
    const draft = devolucao({
      itens: [itemBase({ dfeReferenciado: { chaveAcesso: chaveValida, nItem: 1 } })],
    });

    assert.deepEqual(erros(draft, "documentosReferenciados"), []);
  });

  it("valida o dígito da chave referenciada no item", () => {
    const chaveErrada = `${chaveValida.slice(0, 43)}0`;
    const draft = devolucao({
      itens: [itemBase({ dfeReferenciado: { chaveAcesso: chaveErrada, nItem: 1 } })],
    });

    assert.equal(erros(draft, "dfeReferenciado.chaveAcesso").length, 1);
  });

  it("exige nItem válido na referência granular", () => {
    const draft = devolucao({
      itens: [itemBase({ dfeReferenciado: { chaveAcesso: chaveValida, nItem: 0 } })],
    });

    assert.equal(erros(draft, "dfeReferenciado.nItem").length, 1);
  });

  it("exige referência granular em todos os produtos da devolução", () => {
    const draft = devolucao({
      itens: [
        itemBase({ dfeReferenciado: { chaveAcesso: chaveValida, nItem: 1 } }),
        itemBase({ descricao: "SEGUNDO PRODUTO" }),
      ],
    });

    assert.equal(erros(draft, "dfeReferenciado").length, 1);
  });

  it("recusa chave com dígito verificador errado", () => {
    const chaveErrada = `${chaveValida.slice(0, 43)}0`;
    const draft = devolucao({ documentosReferenciados: [{ chaveAcesso: chaveErrada }] });

    assert.equal(erros(draft, "documentosReferenciados.0.chaveAcesso").length, 1);
  });

  it("recusa a mesma NF-e referenciada duas vezes", () => {
    const draft = devolucao({
      documentosReferenciados: [{ chaveAcesso: chaveValida }, { chaveAcesso: chaveValida }],
    });

    assert.equal(erros(draft, "documentosReferenciados").length, 1);
  });

  it("não exige referência numa nota normal", () => {
    assert.deepEqual(erros(draftBase(), "documentosReferenciados"), []);
  });

  it("bloqueia a rejeição 545 antes de gerar o rascunho", () => {
    const errors = validarLimiteTotalDevolucao(3850, 1092.26);

    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /3850\.00/);
    assert.match(errors[0].message, /1092\.26/);
    assert.match(errors[0].message, /545/);
  });

  it("aceita devolução que não supera o documento original", () => {
    assert.deepEqual(validarLimiteTotalDevolucao(1092.26, 1092.26), []);
    assert.deepEqual(validarLimiteTotalDevolucao(500, 1092.26), []);
  });
});

describe("emissão avulsa: níveis de referenciamento", () => {
  const chaveValida = "25260850114987000143550030000000011872971236";

  function devolucao(overrides: Partial<Draft> = {}): Draft {
    return draftBase({
      operacao: {
        ...draftBase().operacao,
        finalidade: "DEVOLUCAO",
        naturezaOperacao: "DEVOLUCAO DE MERCADORIA",
        consumidorFinal: false,
        indicadorPresenca: "0",
      },
      destinatario: {
        ...draftBase().destinatario,
        indicadorIe: "1",
        inscricaoEstadual: "160000000",
      },
      pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
      ...overrides,
    });
  }

  it("recusa referência no cabeçalho e no item ao mesmo tempo", () => {
    const draft = devolucao({
      documentosReferenciados: [{ chaveAcesso: chaveValida }],
      itens: [itemBase({ dfeReferenciado: { chaveAcesso: chaveValida, nItem: 1 } })],
    });

    assert.equal(erros(draft, "documentosReferenciados").length, 1);
  });

  it("aceita a devolução referenciada só no item", () => {
    const draft = devolucao({
      itens: [itemBase({ dfeReferenciado: { chaveAcesso: chaveValida, nItem: 1 } })],
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });
});
