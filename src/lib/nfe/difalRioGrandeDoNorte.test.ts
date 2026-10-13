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
const gerais = catalogo.regras.filter((r) => r.uf === "RN" && r.tipoRegra === "GERAL")
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

function resolver(dataEmissao: string) {
  return resolverRegraDifalComRegras({
    ufEmitente: "PB", ufDestino: "RN", dataEmissao, modelo: 55,
    crt: 3, indFinal: 1, indIEDest: 9, tpNF: 1, ncm: "87089990",
    origemMercadoria: "0", cfop: "6403", cst: "60",
  }, gerais);
}

describe("Rio Grande do Norte: Lei 11.999/2024 (20% desde 20/03/2025)", () => {
  it("mantém a linha antiga fechada e inativa e a nova ativa", () => {
    assert.deepEqual(gerais.map((r) => [
      r.vigenciaInicio, r.vigenciaFim, r.aliquotaIcmsInterna, r.aliquotaFcp, r.ativo,
    ]), [
      ["2021-12-30", "2025-03-19", 18, null, false],
      ["2025-03-20", null, 20, 0, true],
    ]);
  });

  for (const data of ["2025-03-20", "2026-10-13"]) {
    it(`resolve ${data} sem pendências: 20% interna, 12% interestadual, FCP 0`, () => {
      const saida = resolver(data);
      assert.equal(saida.exigeDifal, true);
      assert.deepEqual(
        [saida.aliquotaInterna, saida.aliquotaInterestadual, saida.aliquotaFcp],
        [20, 12, 0],
      );
      assert.equal(saida.resolvidoAutomaticamente, true);
      assert.deepEqual(saida.pendencias, []);
    });
  }

  it("antes de 20/03/2025 não há regra ativa: bloqueia em vez de usar 18%", () => {
    const saida = resolver("2025-03-19");
    assert.equal(saida.aliquotaInterna, null);
    assert.ok(saida.pendencias.includes("ALIQUOTA_INTERNA_NAO_DETERMINADA"));
  });

  it("NF-e 230 da Demir: o rascunho com zeros passa a sair com R$ 384,00 de DIFAL", () => {
    const item = resolverDifalDoItem({
      numeroItem: 1, codigoProduto: "2056", descricao: "MANOPLA VTRONIC",
      ncm: "87089990", cest: "0107500", cfop: "6403", unidade: "UN", quantidade: 1,
      valorUnitario: 4800, valorTotal: 4800, cst: "60", cstIcms: "60", orig: "0",
      aliquotaInternaDestino: 0, aliquotaInterestadual: 0, aliquotaFcpDestino: 0,
      percentualPartilhaDestino: 100,
    } as NFeItem, {
      ufEmitente: "PB", ufDestinatario: "RN", dataEmissao: "2026-10-13",
      indFinal: 1, indIEDest: 9, tpNF: 1, crt: 3, modelo: 55,
    }, { regras: gerais });

    assert.equal(item.difalDecisao?.origemAliquotaInterna, "REGRA_UF");
    assert.deepEqual(
      [item.icmsUfDest?.pICMSUFDest, item.icmsUfDest?.pICMSInter, item.icmsUfDest?.pFCPUFDest],
      [20, 12, 0],
    );
    assert.equal(item.icmsUfDest?.vICMSUFDest, 384);
    assert.deepEqual(issuesDifalDoItem(item), []);
  });
});
