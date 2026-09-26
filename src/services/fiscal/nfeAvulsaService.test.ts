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
  decisaoFreteDoDraft,
  resolverIndFinalDaOperacao,
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
      destinoMercadoria: "USO_CONSUMO",
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
      // Frete cobrado na nota com transporte contratado pelo remetente.
      transporte: { modFrete: "0" },
      pagamentos: [
        { meio: "01", valor: 60, tipoIntegracao: "2" },
        { meio: "17", valor: 60, tipoIntegracao: "2" },
      ],
    });

    assert.deepEqual(validarDraftAvulso(draft), []);
  });
});

describe("emissão avulsa: Duplicata Mercantil", () => {
  const umaDuplicata = { duplicatas: [{ numero: "001", vencimento: "2026-10-25", valor: 100 }] };

  it("aceita uma duplicata ou PIX combinado com duplicata", () => {
    assert.deepEqual(errosDePagamento(draftBase({
      pagamentos: [{ meio: "14", valor: 100, tipoIntegracao: "2" }], cobranca: umaDuplicata,
    })), []);
    assert.deepEqual(errosDePagamento(draftBase({
      pagamentos: [
        { meio: "17", valor: 40, tipoIntegracao: "2" },
        { meio: "14", valor: 60, tipoIntegracao: "2" },
      ],
      cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor: 60 }] },
    })), []);
  });

  it("bloqueia duplicata sem pagamento, pagamento sem duplicata e soma diferente", () => {
    assert.match(errosDePagamento(draftBase({ cobranca: umaDuplicata }))[0]?.message ?? "", /só pode ser informado/);
    assert.match(errosDePagamento(draftBase({ pagamentos: [{ meio: "14", valor: 100 }] }))[0]?.message ?? "", /exige ao menos uma duplicata/);
    assert.match(errosDePagamento(draftBase({
      pagamentos: [{ meio: "14", valor: 100 }],
      cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor: 90 }] },
    }))[0]?.message ?? "", /soma das duplicatas/);
  });

  it("não deixa a finalidade de devolução ocultar tPag 14 recebido", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, finalidade: "DEVOLUCAO" },
      pagamentos: [{ meio: "14", valor: 100 }],
      cobranca: null,
    });
    assert.match(errosDePagamento(draft)[0]?.message ?? "", /não é permitida para esta finalidade/);
  });

  it("recusa Duplicata Mercantil no modelo 65", () => {
    const draft = draftBase({
      modelo: 65,
      pagamentos: [{ meio: "14", valor: 100 }],
      cobranca: umaDuplicata,
    });
    assert.match(errosDePagamento(draft)[0]?.message ?? "", /NFC-e/);
  });

  it("mantém boleto independente", () => {
    assert.deepEqual(errosDePagamento(draftBase({ pagamentos: [{ meio: "15", valor: 100 }] })), []);
  });
});

describe("emissão avulsa: frete na base do ICMS (LC 87/96, art. 13, §1º, II, b)", () => {
  const comFrete = (transporte: Draft["transporte"]) =>
    draftBase({
      itens: [itemBase({ valorFrete: 20 })],
      transporte,
      pagamentos: [{ meio: "01", valor: 120, tipoIntegracao: "2" }],
    });

  it("transporte do remetente: o frete integra a base por lei, sem perguntar", () => {
    for (const modFrete of ["0", "3"]) {
      const draft = comFrete({ modFrete });
      assert.equal(erros(draft, "transporte.freteIntegraBaseIcms").length, 0, modFrete);
      const decisao = decisaoFreteDoDraft(draft);
      assert.equal(decisao.integra, true);
      assert.equal(decisao.fonte, "LEI");
    }
  });

  it("frete cobrado em outra modalidade: exige a decisão do usuário", () => {
    for (const modFrete of ["1", "2", "4"]) {
      const [erro] = erros(comFrete({ modFrete }), "transporte.freteIntegraBaseIcms");
      assert.ok(erro, modFrete);
      assert.equal(erro.step, "transport");
      assert.match(erro.message, /Informe se este frete integra a base do ICMS próprio/);
    }
  });

  it("com a decisão informada, vale o que o usuário escolheu", () => {
    const naoIntegra = comFrete({ modFrete: "1", freteIntegraBaseIcms: false });
    assert.deepEqual(validarDraftAvulso(naoIntegra), []);
    assert.equal(decisaoFreteDoDraft(naoIntegra).integra, false);
    assert.equal(decisaoFreteDoDraft(comFrete({ modFrete: "9", freteIntegraBaseIcms: true })).fonte, "INCONSISTENTE");
  });

  it("a decisão não se sobrepõe à lei quando o transporte é do remetente", () => {
    assert.equal(decisaoFreteDoDraft(comFrete({ modFrete: "0", freteIntegraBaseIcms: false })).integra, true);
  });

  it("sem frete cobrado não há o que decidir", () => {
    assert.equal(decisaoFreteDoDraft(draftBase({ transporte: { modFrete: "1" } })).fonte, "SEM_FRETE");
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

  it("recusa revenda para não contribuinte: ele é sempre consumidor final", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, destinoMercadoria: "REVENDA_INDUSTRIALIZACAO" },
    });

    const encontrados = erros(draft, "destinoMercadoria");
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /não contribuinte \(indIEDest 9\) é sempre consumidor final/);
  });
});

describe("emissão avulsa: destino da mercadoria e indFinal", () => {
  const contribuinte = {
    ...draftBase().destinatario,
    indicadorIe: "1",
    inscricaoEstadual: "160000000",
  };

  it("exige o destino na NF-e de saída em vez de presumir consumidor final", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, destinoMercadoria: null, consumidorFinal: true },
    });
    const encontrados = erros(draft, "destinoMercadoria");
    assert.equal(encontrados.length, 1);
    assert.match(encontrados[0].message, /não o presume/);
  });

  it("aceita contribuinte comprando para uso e consumo", () => {
    const draft = draftBase({ destinatario: contribuinte });
    assert.deepEqual(validarDraftAvulso(draft), []);
    assert.equal(resolverIndFinalDaOperacao(draft), 1);
  });

  it("revenda para contribuinte sai com indFinal 0", () => {
    const draft = draftBase({
      destinatario: contribuinte,
      operacao: { ...draftBase().operacao, destinoMercadoria: "REVENDA_INDUSTRIALIZACAO" },
    });
    assert.deepEqual(validarDraftAvulso(draft), []);
    assert.equal(resolverIndFinalDaOperacao(draft), 0);
  });

  it("OUTRO só vale com o indicador de consumidor final informado", () => {
    const semIndicador = draftBase({ operacao: { ...draftBase().operacao, destinoMercadoria: "OUTRO" } });
    assert.equal(erros(semIndicador, "destinoMercadoria").length, 1);

    const comIndicador = draftBase({
      destinatario: contribuinte,
      operacao: { ...draftBase().operacao, destinoMercadoria: "OUTRO", consumidorFinal: false },
    });
    assert.deepEqual(validarDraftAvulso(comIndicador), []);
    assert.equal(resolverIndFinalDaOperacao(comIndicador), 0);
  });

  it("ignora o consumidorFinal enviado quando o destino decide", () => {
    const draft = draftBase({
      destinatario: contribuinte,
      operacao: { ...draftBase().operacao, destinoMercadoria: "ATIVO_IMOBILIZADO", consumidorFinal: false },
    });
    assert.equal(resolverIndFinalDaOperacao(draft), 1);
  });

  it("NFC-e é sempre consumidor final e não pergunta o destino", () => {
    const draft = draftBase({ modelo: 65, operacao: { ...draftBase().operacao, destinoMercadoria: null } });
    assert.equal(resolverIndFinalDaOperacao(draft), 1);
    assert.equal(erros(draft, "destinoMercadoria").length, 0);
  });

  it("NF-e de entrada própria mantém o indicador do fluxo de entrada", () => {
    const draft = draftBase({
      operacao: { ...draftBase().operacao, tipoOperacao: "ENTRADA", destinoMercadoria: null, consumidorFinal: false },
    });
    assert.equal(resolverIndFinalDaOperacao(draft), 0);
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
        destinoMercadoria: "REVENDA_INDUSTRIALIZACAO",
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
