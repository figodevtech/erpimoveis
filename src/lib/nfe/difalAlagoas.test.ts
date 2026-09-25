import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { issuesDifalDoItem, resolverDifalDoItem } from "./difal";
import type { RegraDifal } from "./difalRegras";
import type { NFeItem } from "./types";
import { resolverRegraDifalComRegras } from "@/services/fiscal/difal/resolverRegraDifal";

type Curada = {
  uf: string; tipoRegra: RegraDifal["tipoRegra"]; descricao: string;
  aliquotaIcmsInterna: number | null; aliquotaFcp: number | null;
  vigenciaInicio: string; vigenciaFim: string | null;
  fonte?: string; fonteUrl?: string; fundamentoLegal?: string;
  dataFonte?: string; ativo?: boolean;
};
const caminho = path.join(process.cwd(), "data/fiscal/difal/aliquotas-uf.json");
const catalogo = JSON.parse(fs.readFileSync(caminho, "utf8")) as {
  fonte: string; fonteUrl: string; regras: Curada[];
};
const gerais = catalogo.regras.filter((r) => r.uf === "AL" && r.tipoRegra === "GERAL")
  .map((r, index): RegraDifal => ({
    id: index + 1, uf: r.uf, tipoRegra: r.tipoRegra, descricao: r.descricao,
    ncm: null, ncmPrefixo: null, cest: null,
    aliquotaIcmsInterna: r.aliquotaIcmsInterna, aliquotaFcp: r.aliquotaFcp,
    reducaoBase: null, vigenciaInicio: r.vigenciaInicio, vigenciaFim: r.vigenciaFim,
    prioridade: 10, fonte: r.fonte ?? catalogo.fonte,
    fonteUrl: r.fonteUrl ?? catalogo.fonteUrl,
    fundamentoLegal: r.fundamentoLegal ?? null, dataFonte: r.dataFonte ?? null,
    ativo: r.ativo ?? true,
  }));

function resolver(dataEmissao: string, ncm = "84212300", regras = gerais, cst = "00") {
  return resolverRegraDifalComRegras({
    ufEmitente: "PB", ufDestino: "AL", dataEmissao, modelo: 55,
    crt: 3, indFinal: 1, indIEDest: 9, tpNF: 1, ncm,
    origemMercadoria: "0", cfop: "6108", cst,
  }, regras);
}

describe("Alagoas: catálogo oficial versionado", () => {
  it("mantém exatamente as duas vigências gerais", () => {
    assert.deepEqual(gerais.map((r) => [
      r.vigenciaInicio, r.vigenciaFim, r.aliquotaIcmsInterna, r.aliquotaFcp, r.ativo,
    ]), [
      ["2023-04-01", "2026-03-31", 19, 1, true],
      ["2026-04-01", null, 20.5, 1, true],
    ]);
  });

  for (const [data, interna] of [
    ["2025-10-01", 19], ["2025-12-01", 19], ["2026-03-31", 19],
    ["2026-04-01", 20.5], ["2026-09-25", 20.5],
  ] as const) {
    it(`resolve ${data} sem pendências`, () => {
      const saida = resolver(data);
      assert.equal(saida.exigeDifal, true);
      assert.equal(saida.aliquotaInterna, interna);
      assert.equal(saida.aliquotaFcp, 1);
      assert.equal(saida.origemAliquotaInterna, "REGRA_UF");
      assert.equal(saida.origemFcp, "REGRA_UF");
      assert.equal(saida.resolvidoAutomaticamente, true);
      assert.deepEqual(saida.pendencias, []);
    });
  }

  it("resolve os quatro NCMs da NF-e 203 sem regra especial", () => {
    for (const ncm of ["84212300", "84099969", "90259090", "85365090"]) {
      const saida = resolver("2026-09-25", ncm);
      assert.deepEqual([saida.aliquotaInterna, saida.aliquotaFcp], [20.5, 1], ncm);
      assert.deepEqual(saida.pendencias, [], ncm);

      const item = resolverDifalDoItem({
        numeroItem: 1, codigoProduto: ncm, descricao: "Peça",
        ncm, cfop: "6108", unidade: "UN", quantidade: 1,
        valorUnitario: 100, valorTotal: 100, cst: "00", cstIcms: "00", orig: "0",
      } as NFeItem, {
        ufEmitente: "PB", ufDestinatario: "AL", dataEmissao: "2026-09-25",
        indFinal: 1, indIEDest: 9, tpNF: 1, crt: 3, modelo: 55,
      }, { regras: gerais });
      assert.deepEqual([
        item.icmsUfDest?.pICMSUFDest, item.icmsUfDest?.pFCPUFDest,
      ], [20.5, 1], ncm);
      const bloqueios = issuesDifalDoItem(item).map((issue) => issue.code);
      assert.ok(!bloqueios.includes("NFE_DIFAL_ALIQUOTA_INTERNA_SEM_REGRA"), ncm);
      assert.ok(!bloqueios.includes("NFE_DIFAL_FCP_NAO_DETERMINADO"), ncm);
    }
  });

  it("não depende de CST 60 para escolher a regra da UF", () => {
    const saida = resolver("2026-09-25", "84212300", gerais, "60");
    assert.deepEqual([saida.aliquotaInterna, saida.aliquotaFcp], [20.5, 1]);
  });

  it("prioriza NCM específico em ambos os campos", () => {
    const especial: RegraDifal = {
      ...gerais[1], id: 90, tipoRegra: "NCM", ncm: "84212300",
      aliquotaIcmsInterna: 25, aliquotaFcp: 2, prioridade: 30,
    };
    const saida = resolver("2026-09-25", "84212300", [...gerais, especial]);
    assert.deepEqual([saida.aliquotaInterna, saida.aliquotaFcp], [25, 2]);
    assert.deepEqual([saida.origemAliquotaInterna, saida.origemFcp], ["REGRA_NCM", "REGRA_NCM"]);
  });

  it("resolve cada campo separadamente quando NCM só determina FCP", () => {
    const especial: RegraDifal = {
      ...gerais[1], id: 91, tipoRegra: "NCM", ncm: "84212300",
      aliquotaIcmsInterna: null, aliquotaFcp: 2, prioridade: 30,
    };
    const saida = resolver("2026-09-25", "84212300", [...gerais, especial]);
    assert.deepEqual([saida.aliquotaInterna, saida.aliquotaFcp], [20.5, 2]);
    assert.deepEqual([saida.origemAliquotaInterna, saida.origemFcp], ["REGRA_UF", "REGRA_NCM"]);
  });
});
