import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AVISO_LUCENA_EMISSAO_ANTECIPADA,
  MENSAGEM_FORA_DO_EMISSOR_NACIONAL,
  MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA,
  motivoParaNaoReenviar,
  resumirErrosNFSe,
  modelosPossiveisNFSe,
  resolverContextoEmissaoNFSe,
  resolverPoliticaNFSe,
  rotuloPoliticaNFSe,
} from "./nfse-politica";

const LUCENA = "2508604";
const JOAO_PESSOA = "2507507";
const CABEDELO = "2503209";

const lucena = (regimeTributario: string, dataCompetencia: string) =>
  resolverPoliticaNFSe({ codigoMunicipio: LUCENA, regimeTributario, dataCompetencia, itensListaServico: ["14.01"] });

describe("Lucena/PB — Simples pelo Emissor Nacional via Focus", () => {
  it("CRT 1 em 13/10/2026 — rota Nacional liberada, só com aviso informativo", () => {
    const politica = lucena("1", "2026-10-13")!;
    assert.equal(politica.modelo, "NACIONAL");
    assert.equal(politica.layout, "DPS_NACIONAL");
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");
    assert.equal(politica.regra, "LUCENA_SIMPLES_NACIONAL");
    assert.equal(politica.aviso, AVISO_LUCENA_EMISSAO_ANTECIPADA);
    assert.equal("bloqueio" in politica, false);
  });

  it("L2: CRT 1 em 01/11/2026 — NACIONAL / DPS_NACIONAL / FOCUS_NACIONAL, liberada", () => {
    const politica = lucena("1", "2026-11-01")!;
    assert.equal(politica.modelo, "NACIONAL");
    assert.equal(politica.layout, "DPS_NACIONAL");
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");
    assert.equal(politica.usaDps, true);
    assert.equal(politica.regra, "LUCENA_SIMPLES_NACIONAL");
    assert.equal(politica.aviso, undefined);
  });

  it("CRT 2 segue a mesma rota antes e depois da virada; a apuração é conferida no mapeador", () => {
    for (const data of ["2026-10-13", "2026-11-01"]) {
      const politica = lucena("2", data)!;
      assert.equal(politica.autorizador, "FOCUS_NACIONAL");
      assert.equal(politica.regra, "LUCENA_SIMPLES_NACIONAL");
    }
  });

  it("L6/L7: a RTC do Simples continua em 2027, não por ser Nacional", () => {
    assert.equal(lucena("1", "2026-12-31")?.exigeRtc, false);
    assert.equal(lucena("1", "2027-01-01")?.exigeRtc, true);
  });

  it("L8: CRT 3 fica fora — sem rota, como qualquer município sem regra", () => {
    assert.equal(lucena("3", "2026-11-01"), null);
    assert.equal(lucena("3", "2026-10-13"), null);
  });

  it("L9: MEI continua na regra MEI existente", () => {
    const politica = lucena("4", "2026-10-13")!;
    assert.equal(politica.regra, "MEI_NACIONAL");
    assert.equal(politica.aviso, undefined);
  });

  it("L10/L11: decide o município do PRESTADOR e aplica a virada nacional também a Cabedelo", () => {
    const jp = resolverPoliticaNFSe({ codigoMunicipio: JOAO_PESSOA, regimeTributario: "1", dataCompetencia: "2026-10-13", itensListaServico: ["14.01"] })!;
    assert.equal(jp.regra, "JOAO_PESSOA_SIMPLES_TRANSICAO");
    assert.equal(jp.aviso, undefined);
    const jpNormal = resolverPoliticaNFSe({ codigoMunicipio: JOAO_PESSOA, regimeTributario: "3", dataCompetencia: "2026-10-02", itensListaServico: ["14.01"] })!;
    assert.equal(jpNormal.autorizador, "FOCUS_FORMATO_NACIONAL_MUNICIPAL");
    const cabedelo = resolverPoliticaNFSe({ codigoMunicipio: CABEDELO, regimeTributario: "1", dataCompetencia: "2026-11-01" })!;
    assert.equal(cabedelo.modelo, "NACIONAL");
    assert.equal(cabedelo.autorizador, "FOCUS_NACIONAL");
  });

  it("R5: a obrigação do Simples independe de regra municipal cadastrada", () => {
    assert.equal(resolverPoliticaNFSe({ codigoMunicipio: "2504009", regimeTributario: "1", dataCompetencia: "2026-11-01" })?.autorizador, "FOCUS_NACIONAL");
  });

  it("configuração: o padrão Nacional já aparece antes da virada, para ser cadastrado", () => {
    assert.deepEqual(modelosPossiveisNFSe({ codigomunicipio: LUCENA, regimetributario: "1" }, "2026-10-13"), ["NACIONAL"]);
    assert.deepEqual(modelosPossiveisNFSe({ codigomunicipio: LUCENA, regimetributario: "1" }, "2026-11-01"), ["NACIONAL"]);
  });

  it("contexto da revisão usa padroes_emissao.NACIONAL e nunca um municipal", () => {
    const contexto = resolverContextoEmissaoNFSe({
      empresa: { codigomunicipio: LUCENA, regimetributario: "1" },
      itensListaServico: ["14.01"],
      dataCompetencia: "2026-11-02",
      padroesEmissao: {
        NACIONAL: { codigoTributacaoNacionalIss: "140101" },
        MUNICIPAL_JOAO_PESSOA: { itemListaServico: "14.01", codigoCnae: "452000100" },
      },
    })!;
    assert.equal(contexto.modeloEmissao, "NACIONAL");
    assert.deepEqual(contexto.padraoFiscal, { codigoTributacaoNacionalIss: "140101" });
  });

  it("rótulo identifica Lucena via Focus", () => {
    assert.equal(rotuloPoliticaNFSe(lucena("1", "2026-11-01")), "NFS-e Nacional — Lucena/PB via Focus NFe");
    assert.equal(rotuloPoliticaNFSe({ modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }), "NFS-e Nacional");
  });
});

describe("E0039: complemento por município, sem trocar o retorno", () => {
  const E0039 = [{ codigo: "E0039", mensagem: "O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais" }];

  it("João Pessoa mantém a orientação dela; Lucena recebe a sua", () => {
    assert.ok(resumirErrosNFSe(E0039, "2507507")!.mensagem.startsWith(MENSAGEM_FORA_DO_EMISSOR_NACIONAL));
    assert.ok(resumirErrosNFSe(E0039)!.mensagem.startsWith(MENSAGEM_FORA_DO_EMISSOR_NACIONAL));
    const lucenaResumo = resumirErrosNFSe(E0039, LUCENA)!.mensagem;
    assert.ok(lucenaResumo.startsWith(MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA));
    assert.match(lucenaResumo, /Retorno da Focus: O município emissor/);
    assert.doesNotMatch(MENSAGEM_FORA_DO_EMISSOR_NACIONAL, /Lucena/);
    assert.doesNotMatch(MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA, /João Pessoa/);
  });

  it("reenvio idêntico após E0039 continua bloqueado, com a mensagem do município", () => {
    const nota = { modelo_emissao: "NACIONAL", erros: E0039 };
    assert.equal(motivoParaNaoReenviar(nota, lucena("1", "2026-10-13")), MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA);
    assert.equal(motivoParaNaoReenviar(nota, null), MENSAGEM_FORA_DO_EMISSOR_NACIONAL);
  });

  it("sem E0039, nenhum complemento é inventado", () => {
    const resumo = resumirErrosNFSe([{ codigo: "E0312", mensagem: "Código de tributação inválido" }], LUCENA)!;
    assert.deepEqual(resumo, { codigo: "E0312", mensagem: "Código de tributação inválido" });
  });
});
