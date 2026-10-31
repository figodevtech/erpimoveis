import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { competenciaDoRegistroNFSe, motivoParaNaoReenviar, resolverPoliticaNFSe } from "./nfse-politica";
import { pendenciaDestinoFocus } from "./nfse-focus-destino";
import { NFSeService, NFSeValidationError } from "./nfse-service";
import { transportDaPolitica } from "./nfse-transport";
import { pendenciaLeiauteNFSe, resolverLeiauteNFSe } from "./nfse-leiaute";

describe("CGSN 191/2026 — precedência nacional e competências retroativas", () => {
  for (const municipio of ["2507507", "2503209", "2508604", "3550308"]) {
    for (const regime of ["1", "2", "4"]) {
      it(`${municipio}, CRT ${regime}: novembro é Sefin mesmo com item municipal de exceção`, () => {
        const politica = resolverPoliticaNFSe({ codigoMunicipio: municipio, regimeTributario: regime,
          dataCompetencia: "2026-11-01", itensListaServico: ["01.03", "16.01"] });
        assert.equal(politica?.autorizador, "FOCUS_NACIONAL");
        assert.equal(politica?.exigeRtc, false);
      });
    }
  }
  it("Lucro Presumido e Real (CRT 3) preservam o autorizador municipal aplicável", () => {
    for (const regimeApuracao of ["PRESUMIDO", "REAL"]) {
      const entrada = { regimeTributario: "3", regimeApuracao, dataCompetencia: "2026-11-01" };
      assert.equal(resolverPoliticaNFSe({ ...entrada, codigoMunicipio: "2507507" })?.autorizador, "FOCUS_FORMATO_NACIONAL_MUNICIPAL");
      assert.equal(resolverPoliticaNFSe({ ...entrada, codigoMunicipio: "2503209" })?.autorizador, "FOCUS_MUNICIPAL");
      assert.equal(resolverPoliticaNFSe({ ...entrada, codigoMunicipio: "3550308" }), null);
    }
  });
  it("reenvio de outubro em novembro mantém a competência original", () => {
    const dataCompetencia = competenciaDoRegistroNFSe({ data_competencia: "2026-10-30" }, "2026-11-02T14:00:00Z");
    assert.equal(resolverPoliticaNFSe({ codigoMunicipio: "2503209", regimeTributario: "1", dataCompetencia })?.autorizador, "FOCUS_MUNICIPAL");
    assert.equal(competenciaDoRegistroNFSe({ data_emissao: "2026-10-31T23:59:00-0300" }, null), "2026-10-31");
    assert.equal(competenciaDoRegistroNFSe({ data_emissao: "2026-11-01T00:05:00" }, null), "2026-11-01");
  });
  it("não troca competência inválida ou ausente pela data atual", () => {
    assert.throws(() => competenciaDoRegistroNFSe({ data_competencia: "2026-02-31" }, "2026-10-31"));
    assert.throws(() => competenciaDoRegistroNFSe({}, null));
    assert.throws(() => resolverPoliticaNFSe({ codigoMunicipio: "2507507", regimeTributario: "1", dataCompetencia: "2026-02-31" }));
  });
  it("recusa reenvio quando o snapshot e a política divergem mesmo usando /nfsen", () => {
    assert.ok(motivoParaNaoReenviar({ modelo_emissao: "NACIONAL", autorizador_emissao: "FOCUS_FORMATO_NACIONAL_MUNICIPAL" },
      { modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }));
  });
});

describe("NT 009 por versão e ambiente", () => {
  it("mantém NT 004/007 em produção e seleciona release 1 em homologação", () => {
    assert.equal(resolverLeiauteNFSe("PRODUCAO"), "NT004_NT007");
    assert.equal(resolverLeiauteNFSe("HOMOLOGACAO"), "NT009_RELEASE1");
    assert.throws(() => resolverLeiauteNFSe("PRODUCAO", "NT009_RELEASE1"));
    assert.equal(resolverLeiauteNFSe("HOMOLOGACAO", "NT004_NT007"), "NT004_NT007");
  });
  it("aceita bens móveis documentados na Focus somente no leiaute de testes", () => {
    const dados = { codigo_tributacao_nacional_iss: "990201", bens_moveis: [{ codigo_ncm: "87089990", descricao: "Bem sintético", quantidade: 1 }] };
    assert.equal(pendenciaLeiauteNFSe(dados, "NT009_RELEASE1"), null);
    assert.match(pendenciaLeiauteNFSe(dados, "NT004_NT007")!, /homologação/);
    assert.ok(pendenciaLeiauteNFSe({ ...dados, bens_moveis: [{ ...dados.bens_moveis[0], quantidade: 1000 }] }, "NT009_RELEASE1"));
  });
  it("não envia nomes XML como se fossem campos JSON da Focus", () => {
    assert.ok(pendenciaLeiauteNFSe({ gPgtoVinc: [] }, "NT009_RELEASE1"));
    assert.ok(pendenciaLeiauteNFSe({ vAjusteBC: 10 }, "NT009_RELEASE1"));
  });
});

describe("destino efetivo da DPS na Focus", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  it("usa o flag do ambiente selecionado e rejeita cadastro não confirmado", () => {
    const config = { habilita_nfse: true, habilita_nfsen_producao: false, habilita_nfsen_homologacao: true };
    assert.equal(pendenciaDestinoFocus(config, "FOCUS_NACIONAL", "HOMOLOGACAO"), null);
    assert.match(pendenciaDestinoFocus(config, "FOCUS_NACIONAL", "PRODUCAO")!, /Habilite/);
    assert.equal(pendenciaDestinoFocus(config, "FOCUS_FORMATO_NACIONAL_MUNICIPAL", "PRODUCAO"), null);
    assert.match(pendenciaDestinoFocus(config, "FOCUS_FORMATO_NACIONAL_MUNICIPAL", "HOMOLOGACAO")!, /desabilitado/);
    assert.ok(pendenciaDestinoFocus({}, "FOCUS_NACIONAL", "PRODUCAO"));
  });
  for (const indisponibilidade of ["municipal", "servidor", "rede"]) {
    it(`não transmite DPS quando a conferência falha: ${indisponibilidade}`, async () => {
      const chamadas: string[] = [];
      globalThis.fetch = async (input, init) => {
        chamadas.push(String(input));
        assert.notEqual(init?.method, "POST");
        if (indisponibilidade === "rede") throw new TypeError("fetch failed");
        return new Response(JSON.stringify([{ cnpj: "11222333000181", habilita_nfsen_homologacao: false }]),
          { status: indisponibilidade === "servidor" ? 500 : 200 });
      };
      const service = new NFSeService();
      service.configurarAmbiente("HOMOLOGACAO", "token-sintetico");
      const transport = transportDaPolitica({ modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }, service);
      await assert.rejects(transport.emitir({ referencia: "sintetica", cnpj_prestador: "11222333000181" }), NFSeValidationError);
      assert.equal(chamadas.length, 1);
    });
  }
  // A API de empresas exige o token principal; o token de emissão não enxerga o cadastro.
  for (const semAcesso of ["401", "403", "404", "lista vazia"]) {
    it(`token de emissão sem acesso à consulta de empresas (${semAcesso}) não bloqueia a DPS`, async () => {
      const chamadas: string[] = [];
      globalThis.fetch = async (input, init) => {
        chamadas.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (init?.method === "POST") return new Response(JSON.stringify({ ref: "sintetica", status: "processando_autorizacao" }), { status: 202 });
        return semAcesso === "lista vazia" ? new Response("[]") : new Response("HTTP Basic: Access denied.", { status: Number(semAcesso) });
      };
      const service = new NFSeService();
      service.configurarAmbiente("PRODUCAO", "token-sintetico");
      const transport = transportDaPolitica({ modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }, service);
      assert.equal((await transport.emitir({ referencia: "sintetica", cnpj_prestador: "11222333000181" })).ok, true);
      assert.match(chamadas[0], /^GET .*empresas\?cnpj=/);
      assert.match(chamadas[1], /^POST .*nfsen\?ref=/);
    });
  }
  it("confere o CNPJ e transmite somente após confirmar habilitação nacional", async () => {
    const chamadas: string[] = [];
    globalThis.fetch = async (input, init) => {
      chamadas.push(String(input));
      return init?.method === "POST"
        ? new Response(JSON.stringify({ ref: "sintetica", status: "processando_autorizacao" }), { status: 202 })
        : new Response(JSON.stringify([{ cnpj: "11222333000181", habilita_nfsen_homologacao: true }]));
    };
    const service = new NFSeService();
    service.configurarAmbiente("HOMOLOGACAO", "token-sintetico");
    const transport = transportDaPolitica({ modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }, service);
    assert.equal((await transport.emitir({ referencia: "sintetica", cnpj_prestador: "11222333000181" })).ok, true);
    assert.match(chamadas[0], /empresas\?cnpj=/);
    assert.match(chamadas[1], /nfsen\?ref=/);
  });
});
