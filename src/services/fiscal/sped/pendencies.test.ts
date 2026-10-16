import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileDocuments } from "./reconciliation";
import { buildSpedPendencies } from "./pendencies";

const diag = (codigo: string, severidade = "BLOQUEIO", key?: string) => ({
  codigo,
  severidade,
  mensagem: `${codigo} ${key ?? ""}`.trim(),
  registro: null,
  campo: null,
  fontes: key ? [{ source: { documentKey: key } }] : [],
});

describe("pendências agrupadas", () => {
  it("agrupa por categoria e colapsa ocorrências repetidas", () => {
    const result = buildSpedPendencies([
      diag("DATA_ENTRADA_FISCAL_NAO_CONFIRMADA", "BLOQUEIO", "A"),
      diag("DATA_ENTRADA_FISCAL_NAO_CONFIRMADA", "BLOQUEIO", "B"),
      diag("DATA_ENTRADA_FISCAL_NAO_CONFIRMADA", "BLOQUEIO", "C"),
      diag("CONTABILISTA_AUSENTE"),
      diag("CODIGO_ITEM_CANONICO_AUSENTE", "BLOQUEIO", "D"),
      diag("E116_RECOLHIMENTO_AUSENTE"),
      diag("TRATAMENTO_CREDITO_PENDENTE", "BLOQUEIO", "E"),
    ], "42");
    assert.deepEqual(result.groups.map((group) => group.category), ["CADASTRO", "DOCUMENTOS_FISCAIS", "TRIBUTACAO", "APURACAO", "CONFIGURACAO_CONTABIL"]);
    const dates = result.groups.find((group) => group.category === "DOCUMENTOS_FISCAIS")!.items[0];
    assert.equal(dates.occurrences, 3);
    assert.deepEqual(dates.affected, ["NF-e A", "NF-e B", "NF-e C"]);
    assert.ok(dates.action.length > 0 && dates.reason.length > 0);
    assert.equal(result.blocking, 7);
  });

  it("cada pendência traz motivo, ação e link para a tela de correção", () => {
    const result = buildSpedPendencies([diag("CODIGO_ITEM_CANONICO_AUSENTE")], "42");
    const item = result.groups[0].items[0];
    assert.equal(item.link?.href, "/fiscal/sped/avancado?competencia=42&aba=decisoes-itens");
    assert.ok(item.title && item.reason && item.action);
  });

  it("une códigos diferentes que descrevem a mesma pendência", () => {
    const result = buildSpedPendencies([diag("PERFIL_EFD_PENDENTE"), diag("GATE_PERFIL_EFD_STATUS_NAO_CONFIRMADO")], null);
    assert.equal(result.groups[0].items.length, 1);
    assert.deepEqual(result.groups[0].items[0].codes.sort(), ["GATE_PERFIL_EFD_STATUS_NAO_CONFIRMADO", "PERFIL_EFD_PENDENTE"]);
  });

  it("avisos não bloqueiam e ficam separados", () => {
    const result = buildSpedPendencies([diag("PARTICIPANTE_SEM_REFERENCIA", "AVISO")], null);
    assert.equal(result.groups.length, 0);
    assert.equal(result.blocking, 0);
    assert.equal(result.warnings.length, 1);
  });

  it("código desconhecido não some: vira pendência com o próprio código", () => {
    const result = buildSpedPendencies([diag("NOVO_CODIGO_QUALQUER")], null);
    assert.equal(result.groups[0].items[0].title, "Novo codigo qualquer");
  });
});

describe("reconciliação banco × arquivo", () => {
  it("fecha quando todo documento elegível foi escriturado ou explicado", () => {
    const result = reconcileDocuments({ sourceNotes: 1200, sourceEntries: 340, projected: 1535, rejected: 4, duplicates: 1, c100: 1535 });
    assert.equal(result.summary.balanced, true);
    assert.equal(result.diagnostics.length, 0);
  });

  it("documento perdido em silêncio bloqueia", () => {
    const result = reconcileDocuments({ sourceNotes: 1200, sourceEntries: 340, projected: 1530, rejected: 4, duplicates: 1, c100: 1530 });
    assert.equal(result.diagnostics[0].code, "RECONCILIACAO_DOCUMENTOS_DIVERGENTE");
    assert.equal(result.diagnostics[0].severity, "BLOQUEIO");
  });

  it("C100 diferente dos documentos projetados bloqueia", () => {
    const result = reconcileDocuments({ sourceNotes: 2, sourceEntries: 0, projected: 2, rejected: 0, duplicates: 0, c100: 1 });
    assert.equal(result.diagnostics[0].code, "RECONCILIACAO_C100_DIVERGENTE");
  });
});
