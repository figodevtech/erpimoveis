import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INICIO_NACIONAL_JOAO_PESSOA,
  ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA,
  MENSAGEM_EMISSOR_NACIONAL_EXIGIDO,
  dataDoDiaNFSe,
  detectarEmissorMunicipalEncerrado,
  familiaDoModeloNFSe,
  modelosPossiveisNFSe,
  normalizarItemListaServico,
  reenvioExigeNovoModelo,
  resolverPoliticaNFSe,
  resumirErrosNFSe,
  rtcObrigatorio,
} from "./nfse-politica";

const JOAO_PESSOA = "2507507";
const CABEDELO = "2503209";

/** A Demir: João Pessoa, regime normal, serviços no item 14.01. */
const demir = (dataCompetencia: string, itens: string[] = ["14.01"]) =>
  resolverPoliticaNFSe({
    codigoMunicipio: JOAO_PESSOA,
    regimeTributario: "3",
    dataCompetencia,
    itensListaServico: itens,
  });

/** O L999 exatamente como a Focus gravou na nota 136 (OS 525) da Demir. */
const ERROS_OS_525 = [
  {
    codigo: "L999",
    correcao: "Acionar o suporte responsável",
    mensagem:
      "O Emissor atual está disponível somente para contribuintes enquadrados no Simples Nacional ou que possuam atividade vigente vinculada aos itens de serviço 01.03, 01.05, 01.09 ou 16.01. Para realizar a emissão, utilize o Novo emissor ajustado ao padrão nacional.",
  },
];

describe("política da NFS-e — João Pessoa, CRT 3, item 14.01", () => {
  it("Caso A: 30/09/2026 continua no emissor municipal", () => {
    const politica = demir("2026-09-30");
    assert.equal(politica?.modelo, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(politica?.usaDps, false);
    assert.equal(politica?.exigeRtc, false);
  });

  it("Caso B: 01/10/2026 passa para o padrão Nacional", () => {
    const politica = demir("2026-10-01");
    assert.equal(politica?.modelo, "NACIONAL");
    assert.equal(politica?.usaDps, true);
    assert.equal(politica?.regra, "JOAO_PESSOA_NACIONAL");
  });

  it("Caso C: 02/10/2026 (dia da OS 525) segue no padrão Nacional", () => {
    const politica = demir("2026-10-02");
    assert.equal(politica?.modelo, "NACIONAL");
    assert.equal(politica?.usaDps, true);
  });

  it("a virada é exatamente na data configurada", () => {
    assert.equal(INICIO_NACIONAL_JOAO_PESSOA, "2026-10-01");
    assert.equal(demir("2026-09-30")?.modelo, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(demir("2026-10-01")?.modelo, "NACIONAL");
  });

  it("regime normal no Nacional exige o grupo da Reforma Tributária", () => {
    assert.equal(demir("2026-10-02")?.exigeRtc, true);
  });

  it("não depende do formato em que o item foi cadastrado", () => {
    assert.equal(demir("2026-10-02", ["1401"])?.modelo, "NACIONAL");
    assert.equal(demir("2026-10-02", ["14.01.01"])?.modelo, "NACIONAL");
  });

  it("sem item conhecido não presume exceção", () => {
    assert.equal(demir("2026-10-02", [])?.modelo, "NACIONAL");
    assert.equal(demir("2026-10-02", ["", "  "])?.modelo, "NACIONAL");
  });

  it("exige a data explícita no formato AAAA-MM-DD", () => {
    assert.throws(() => demir("02/10/2026"), /AAAA-MM-DD/);
  });
});

describe("Caso D: exceções da transição de João Pessoa", () => {
  for (const item of ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA) {
    it(`item ${item} continua no emissor municipal depois de 01/10/2026`, () => {
      const politica = demir("2026-10-02", [item]);
      assert.equal(politica?.modelo, "MUNICIPAL_JOAO_PESSOA");
      assert.equal(politica?.regra, "JOAO_PESSOA_EXCECAO_ITEM");
    });
  }

  it("a lista de exceções é a do retorno da prefeitura", () => {
    assert.deepEqual([...ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA], ["01.03", "01.05", "01.09", "16.01"]);
  });

  it("nota que mistura exceção com item comum vai para o Nacional", () => {
    assert.equal(demir("2026-10-02", ["01.03", "14.01"])?.modelo, "NACIONAL");
  });

  it("várias exceções juntas continuam no municipal", () => {
    assert.equal(demir("2026-10-02", ["01.03", "16.01"])?.modelo, "MUNICIPAL_JOAO_PESSOA");
  });

  it("Simples ME/EPP fica no emissor municipal até 31/10/2026", () => {
    const simples = (data: string, regime = "1") => resolverPoliticaNFSe({
      codigoMunicipio: JOAO_PESSOA, regimeTributario: regime, dataCompetencia: data, itensListaServico: ["14.01"],
    });
    assert.equal(simples("2026-10-02")?.modelo, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(simples("2026-10-31", "2")?.modelo, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(simples("2026-10-02")?.regra, "JOAO_PESSOA_SIMPLES_TRANSICAO");
  });
});

describe("Caso E: MEI continua no padrão Nacional", () => {
  const mei = (municipio: string, data: string) => resolverPoliticaNFSe({
    codigoMunicipio: municipio, regimeTributario: "4", dataCompetencia: data, itensListaServico: ["14.01"],
  });

  it("em qualquer município e em qualquer data", () => {
    for (const municipio of [JOAO_PESSOA, CABEDELO, "3550308"]) {
      for (const data of ["2026-07-01", "2026-10-02", "2027-03-01"]) {
        assert.equal(mei(municipio, data)?.modelo, "NACIONAL", `${municipio} ${data}`);
      }
    }
  });

  it("MEI não é obrigado ao grupo da Reforma em 2026, só a partir de 2027", () => {
    assert.equal(mei(CABEDELO, "2026-12-31")?.exigeRtc, false);
    assert.equal(mei(CABEDELO, "2027-01-01")?.exigeRtc, true);
  });
});

describe("próximas viradas", () => {
  const simplesJp = (data: string) => resolverPoliticaNFSe({
    codigoMunicipio: JOAO_PESSOA, regimeTributario: "1", dataCompetencia: data, itensListaServico: ["14.01"],
  });

  it("01/11/2026: Simples ME/EPP de João Pessoa passa para o padrão Nacional", () => {
    assert.equal(simplesJp("2026-10-31")?.modelo, "MUNICIPAL_JOAO_PESSOA");
    assert.equal(simplesJp("2026-11-01")?.modelo, "NACIONAL");
  });

  it("Simples no Nacional não é sinônimo de RTC obrigatória em 2026", () => {
    assert.equal(simplesJp("2026-11-01")?.exigeRtc, false);
  });

  it("01/01/2027: o grupo da Reforma passa a ser exigido do Simples", () => {
    assert.equal(simplesJp("2026-12-31")?.exigeRtc, false);
    assert.equal(simplesJp("2027-01-01")?.exigeRtc, true);
  });

  it("rtcObrigatorio separa regime de modelo", () => {
    assert.equal(rtcObrigatorio("3", "2026-10-02"), true);
    for (const regime of ["1", "2", "4"]) {
      assert.equal(rtcObrigatorio(regime, "2026-12-31"), false, regime);
      assert.equal(rtcObrigatorio(regime, "2027-01-01"), true, regime);
    }
  });

  it("Cabedelo segue no emissor municipal — a regra de novembro não foi estendida a ele", () => {
    const cabedelo = resolverPoliticaNFSe({
      codigoMunicipio: CABEDELO, regimeTributario: "1", dataCompetencia: "2026-11-01", itensListaServico: ["14.01"],
    });
    assert.equal(cabedelo?.modelo, "MUNICIPAL_CABEDELO");
  });

  it("município sem emissor configurado não tem política", () => {
    assert.equal(resolverPoliticaNFSe({
      codigoMunicipio: "3550308", regimeTributario: "3", dataCompetencia: "2026-10-02",
    }), null);
  });
});

describe("modelos que a empresa precisa ter cadastrados", () => {
  it("Demir depois da virada: Nacional e o municipal das exceções", () => {
    assert.deepEqual(
      modelosPossiveisNFSe({ codigomunicipio: JOAO_PESSOA, regimetributario: "3" }, "2026-10-02"),
      ["NACIONAL", "MUNICIPAL_JOAO_PESSOA"],
    );
  });

  it("Demir antes da virada: só o municipal", () => {
    assert.deepEqual(
      modelosPossiveisNFSe({ codigomunicipio: JOAO_PESSOA, regimetributario: "3" }, "2026-09-30"),
      ["MUNICIPAL_JOAO_PESSOA"],
    );
  });

  it("Cabedelo: só o municipal", () => {
    assert.deepEqual(
      modelosPossiveisNFSe({ codigomunicipio: CABEDELO, regimetributario: "1" }, "2026-10-02"),
      ["MUNICIPAL_CABEDELO"],
    );
  });
});

describe("L999 de migração de João Pessoa", () => {
  it("é identificado pela mensagem, não pelo código", () => {
    assert.equal(detectarEmissorMunicipalEncerrado(ERROS_OS_525), true);
    assert.equal(detectarEmissorMunicipalEncerrado([{ codigo: "L999", mensagem: "Could not commit transaction." }]), false);
    assert.equal(detectarEmissorMunicipalEncerrado([{ codigo: "L999", mensagem: "Problema(s) encontrado(s) no processamento dos dados." }]), false);
    assert.equal(detectarEmissorMunicipalEncerrado(null), false);
  });

  it("aceita a mensagem sem acento e em caixa diferente", () => {
    assert.equal(
      detectarEmissorMunicipalEncerrado("PARA REALIZAR A EMISSAO, UTILIZE O NOVO EMISSOR AJUSTADO AO PADRAO NACIONAL."),
      true,
    );
  });

  it("a explicação vai na frente e o retorno original da Focus fica inteiro", () => {
    const resumo = resumirErrosNFSe(ERROS_OS_525);
    assert.equal(resumo?.codigo, "L999");
    assert.ok(resumo?.mensagem.startsWith(MENSAGEM_EMISSOR_NACIONAL_EXIGIDO));
    assert.ok(resumo?.mensagem.includes(ERROS_OS_525[0].mensagem));
  });

  it("outros erros passam sem explicação", () => {
    assert.deepEqual(
      resumirErrosNFSe([{ codigo: "E36", mensagem: "ISS retido inválido" }]),
      { codigo: "E36", mensagem: "ISS retido inválido" },
    );
  });
});

describe("reenvio sem alterar", () => {
  it("a nota 136 (OS 525, municipal com o L999 de migração) não é reenviada igual", () => {
    assert.equal(reenvioExigeNovoModelo({ modelo_emissao: "MUNICIPAL_JOAO_PESSOA", erros: ERROS_OS_525 }, null), true);
  });

  it("municipal rejeitada por outro motivo também não, se hoje a operação é Nacional", () => {
    const erros = [{ codigo: "L999", mensagem: "Could not commit transaction." }];
    assert.equal(reenvioExigeNovoModelo({ modelo_emissao: "MUNICIPAL_JOAO_PESSOA", erros }, "NACIONAL"), true);
    assert.equal(reenvioExigeNovoModelo({ modelo_emissao: "MUNICIPAL_JOAO_PESSOA", erros }, "MUNICIPAL_JOAO_PESSOA"), false);
  });

  it("Cabedelo continua reenviando", () => {
    assert.equal(reenvioExigeNovoModelo({ modelo_emissao: "MUNICIPAL_CABEDELO", erros: [] }, "MUNICIPAL_CABEDELO"), false);
  });

  it("nota que nasceu Nacional sempre volta como Nacional", () => {
    assert.equal(reenvioExigeNovoModelo({ modelo_emissao: "NACIONAL", erros: ERROS_OS_525 }, "MUNICIPAL_JOAO_PESSOA"), false);
  });
});

describe("Caso G: endpoint de nota já emitida vem do modelo gravado", () => {
  it("municipal antiga continua em /v2/nfse", () => {
    assert.equal(familiaDoModeloNFSe("MUNICIPAL_JOAO_PESSOA"), "MUNICIPAL");
    assert.equal(familiaDoModeloNFSe("MUNICIPAL_CABEDELO"), "MUNICIPAL");
    assert.equal(familiaDoModeloNFSe("MUNICIPAL"), "MUNICIPAL");
    assert.equal(familiaDoModeloNFSe(null), "MUNICIPAL");
  });

  it("Nacional em /v2/nfsen", () => {
    assert.equal(familiaDoModeloNFSe("NACIONAL"), "NACIONAL");
  });
});

describe("apoio", () => {
  it("normaliza o item da LC 116", () => {
    assert.equal(normalizarItemListaServico("14.01"), "14.01");
    assert.equal(normalizarItemListaServico("1401"), "14.01");
    assert.equal(normalizarItemListaServico("14.01.01"), "14.01");
    assert.equal(normalizarItemListaServico("103"), "01.03");
    assert.equal(normalizarItemListaServico(""), null);
  });

  it("o dia da NFS-e é o do fuso da empresa", () => {
    // 02h UTC de 02/10 ainda é 01/10 em Fortaleza (UTC-3).
    assert.equal(dataDoDiaNFSe(new Date("2026-10-02T02:00:00Z")), "2026-10-01");
    assert.equal(dataDoDiaNFSe(new Date("2026-10-02T02:00:00Z"), "UTC"), "2026-10-02");
  });
});
