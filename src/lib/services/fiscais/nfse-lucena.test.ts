import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MENSAGEM_LUCENA_AGUARDANDO_NACIONAL,
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
  it("L1: CRT 1 em 31/10/2026 — rota Nacional decidida, emissão bloqueada", () => {
    const politica = lucena("1", "2026-10-31")!;
    assert.equal(politica.modelo, "NACIONAL");
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");
    assert.equal(politica.regra, "LUCENA_SIMPLES_AGUARDANDO_NACIONAL");
    assert.equal(politica.bloqueio, MENSAGEM_LUCENA_AGUARDANDO_NACIONAL);
  });

  it("L2: CRT 1 em 01/11/2026 — NACIONAL / DPS_NACIONAL / FOCUS_NACIONAL, liberada", () => {
    const politica = lucena("1", "2026-11-01")!;
    assert.equal(politica.modelo, "NACIONAL");
    assert.equal(politica.layout, "DPS_NACIONAL");
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");
    assert.equal(politica.usaDps, true);
    assert.equal(politica.regra, "LUCENA_SIMPLES_NACIONAL");
    assert.equal(politica.bloqueio, undefined);
  });

  it("L2/L4: CRT 2 segue a mesma rota; a apuração é conferida no mapeador", () => {
    const politica = lucena("2", "2026-11-01")!;
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");
    assert.equal(politica.bloqueio, undefined);
    assert.equal(lucena("2", "2026-10-31")?.bloqueio, MENSAGEM_LUCENA_AGUARDANDO_NACIONAL);
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
    assert.equal(politica.bloqueio, undefined);
  });

  it("L10/L11: decide o município do PRESTADOR — João Pessoa e Cabedelo inalterados", () => {
    const jp = resolverPoliticaNFSe({ codigoMunicipio: JOAO_PESSOA, regimeTributario: "1", dataCompetencia: "2026-10-13", itensListaServico: ["14.01"] })!;
    assert.equal(jp.regra, "JOAO_PESSOA_SIMPLES_TRANSICAO");
    assert.equal(jp.bloqueio, undefined);
    const jpNormal = resolverPoliticaNFSe({ codigoMunicipio: JOAO_PESSOA, regimeTributario: "3", dataCompetencia: "2026-10-02", itensListaServico: ["14.01"] })!;
    assert.equal(jpNormal.autorizador, "FOCUS_FORMATO_NACIONAL_MUNICIPAL");
    const cabedelo = resolverPoliticaNFSe({ codigoMunicipio: CABEDELO, regimeTributario: "1", dataCompetencia: "2026-11-01" })!;
    assert.equal(cabedelo.modelo, "MUNICIPAL_CABEDELO");
    assert.equal(cabedelo.autorizador, "FOCUS_MUNICIPAL");
  });

  it("R5: município sem regra continua sem política", () => {
    assert.equal(resolverPoliticaNFSe({ codigoMunicipio: "2504009", regimeTributario: "1", dataCompetencia: "2026-11-01" }), null);
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
    assert.equal(rotuloPoliticaNFSe(lucena("1", "2026-11-01")), "NFS-e Nacional · Lucena via Focus");
    assert.equal(rotuloPoliticaNFSe({ modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }), "NFS-e Nacional");
  });
});
