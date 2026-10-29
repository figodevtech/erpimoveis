import assert from "node:assert/strict";
import { test } from "node:test";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import {
  aplicarResolucaoDifal,
  assinaturaDifalDe,
  resolverDifalDosItens,
  type ItemComResolucaoDifal,
  type ResolucaoDifalTela,
} from "./emissao-assistida-model";

const resolucao: ResolucaoDifalTela = {
  exigeDifal: true,
  aliquotaInterna: 22.5,
  aliquotaInterestadual: 12,
  aliquotaFcp: 0,
  percentualPartilha: 100,
  reducaoBase: null,
  origemAliquotaInterna: "REGRA",
  origemFcp: "REGRA",
  regraAliquotaInterna: null,
  regraFcp: null,
  conflitos: [],
  pendencias: [],
  resolvidoAutomaticamente: true,
};

const consulta = {
  modelo: MODELO_NFE,
  ufEmitente: "PB",
  ufDestino: "PI",
  crt: 3,
  indFinal: 1,
  indIEDest: 9,
  dataEmissao: "2026-09-22",
  tpNF: 1,
  finNFe: 1,
  ufEntrega: null as string | null,
  itens: [{ sourceItemId: "avulsa:0", ncm: "90328925", cest: "0199900", cfop: "6108", cst: "00", csosn: "", orig: "0" }],
};

function itemAvulso() {
  return {
    sourceItemId: null,
    quantidade: "2,5",
    valorUnitario: "100,00",
    difalHabilitado: true,
    difalResolucao: null,
    difalCamposManuais: [],
    difalAliquotaInterna: "18",
    difalAliquotaInterestadual: "7",
    difalAliquotaFcp: "2",
    difalPercentualPartilha: "100",
  } satisfies ItemComResolucaoDifal & { quantidade: string; valorUnitario: string };
}

test("classificação e contexto da avulsa invalidam a resolução; alíquotas não criam um ciclo", () => {
  const original = assinaturaDifalDe(consulta);
  for (const mudanca of [{ ncm: "87089990" }, { cest: "0100100" }, { cst: "60" }, { csosn: "500" }, { cfop: "5102" }, { orig: "1" }]) {
    assert.notEqual(assinaturaDifalDe({ ...consulta, itens: [{ ...consulta.itens[0], ...mudanca }] }), original);
  }
  for (const mudanca of [{ ufDestino: "RJ" }, { indFinal: 0 }, { indIEDest: 1 }, { crt: 1 }, { tpNF: 0 }, { finNFe: 4 }, { ufEntrega: "PB" }, { dataEmissao: "2026-10-01" }]) {
    assert.notEqual(assinaturaDifalDe({ ...consulta, ...mudanca }), original);
  }
  const itemComAliquotas = { ...consulta.itens[0], difalAliquotaInterna: "22.5", difalAliquotaFcp: "0" };
  assert.equal(assinaturaDifalDe({ ...consulta, itens: [itemComAliquotas] }), original);
});

test("o mesmo aplicador preenche a avulsa sem converter quantidade/preço nem perder FCP zero", () => {
  const [item] = aplicarResolucaoDifal([itemAvulso()], new Map([["avulsa:0", resolucao]]), (_, index) => `avulsa:${index}`);
  assert.equal(item.difalAliquotaInterna, "22.5");
  assert.equal(item.difalAliquotaInterestadual, "12");
  assert.equal(item.difalAliquotaFcp, "0");
  assert.equal(item.difalResolucao, resolucao);
  assert.equal(item.quantidade, "2,5");
  assert.equal(item.valorUnitario, "100,00");
  assert.equal(item.sourceItemId, null);
});

test("linhas do mesmo estoque recebem resoluções próprias", () => {
  const itens = [0, 1].map(() => ({ ...itemAvulso(), sourceItemId: "geral:8" }));
  const resposta = new Map([
    ["avulsa:0", resolucao],
    ["avulsa:1", { ...resolucao, aliquotaInterestadual: 4 }],
  ]);
  const atualizados = aplicarResolucaoDifal(itens, resposta, (_, index) => `avulsa:${index}`);
  assert.deepEqual(atualizados.map((item) => item.difalAliquotaInterestadual), ["12", "4"]);
  assert.deepEqual(atualizados.map((item) => item.sourceItemId), ["geral:8", "geral:8"]);
});

test("nova resolução preserva os campos manuais e atualiza os automáticos", () => {
  const item: ItemComResolucaoDifal = { ...itemAvulso(), sourceItemId: "x", difalCamposManuais: ["aliquotaInterna", "aliquotaFcp"] };
  const [atualizado] = aplicarResolucaoDifal([item], new Map([["x", resolucao]]));
  assert.equal(atualizado.difalAliquotaInterna, "18");
  assert.equal(atualizado.difalAliquotaFcp, "2");
  assert.equal(atualizado.difalAliquotaInterestadual, "12");
});

test("resposta ausente limpa automáticos antigos e conserva o manual", () => {
  const item: ItemComResolucaoDifal = { ...itemAvulso(), difalResolucao: resolucao, difalCamposManuais: ["aliquotaFcp"] };
  const [atualizado] = aplicarResolucaoDifal([item], new Map());
  assert.equal(atualizado.difalAliquotaInterna, "");
  assert.equal(atualizado.difalAliquotaInterestadual, "");
  assert.equal(atualizado.difalAliquotaFcp, "2");
  assert.equal(atualizado.difalResolucao, null);
});

test("resolução sem incidência desabilita DIFAL", () => {
  const [item] = aplicarResolucaoDifal([{ ...itemAvulso(), sourceItemId: "x" }], new Map([["x", { ...resolucao, exigeDifal: false }]]));
  assert.equal(item.difalHabilitado, false);
  assert.equal(item.difalResolucao, null);
});

test("cliente compartilhado envia classificação, finalidade, entrada/saída e sinal ao endpoint existente", async (t) => {
  const controle = new AbortController();
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/fiscal/difal/resolver");
    assert.equal(init.method, "POST");
    assert.equal(init.signal, controle.signal);
    const body = JSON.parse(String(init.body));
    assert.equal(body.tpNF, 0);
    assert.equal(body.finNFe, 4);
    assert.equal(body.ufEntrega, "PB");
    assert.equal(body.dataEmissao, "2026-09-22");
    assert.deepEqual(body.itens[0], { id: "avulsa:0", ncm: "90328925", cest: "0199900", origemMercadoria: "0", cfop: "6108", cst: "00", csosn: "" });
    return Response.json({ ok: true, resolucoes: { "avulsa:0": resolucao } });
  });
  const resultado = await resolverDifalDosItens({ ...consulta, tpNF: 0, finNFe: 4, ufEntrega: "PB", signal: controle.signal });
  assert.deepEqual(resultado.get("avulsa:0"), resolucao);
});

test("falha de rede não inventa resolução", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal((await resolverDifalDosItens(consulta)).size, 0);
});
