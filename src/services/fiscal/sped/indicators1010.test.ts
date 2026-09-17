import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeSped1010Evidence,
  resolve1010Indicators,
  SPED_1010_MANUAL_FIELDS,
} from "./indicators1010";
import { SpedServiceError } from "./errors";

describe("SPED Fiscal — Registro 1010: Fonte de Verdade Fiscal e Auditoria", () => {
  it("Demir Diesel (PB): GIAF 1, 3 e 4 são N por REGRA_UF com status CONFIRMADO", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
      },
    });

    assert.equal(res.indicators.IND_GIAF1, "N");
    assert.equal(res.indicators.IND_GIAF3, "N");
    assert.equal(res.indicators.IND_GIAF4, "N");

    assert.equal(res.details.IND_GIAF1.origem, "REGRA_UF");
    assert.equal(res.details.IND_GIAF1.status, "CONFIRMADO");
    assert.match(res.details.IND_GIAF1.motivo, /Pernambuco/);
  });

  it("Empresa em Pernambuco (PE): GIAF fica PENDENTE se não houver decisão fiscal cadastrada", () => {
    const res = resolve1010Indicators({
      uf: "PE",
      config: {
        evidencias: {},
      },
    });

    assert.equal(res.details.IND_GIAF1.status, "PENDENTE");
    assert.equal(res.details.IND_GIAF3.status, "PENDENTE");
    assert.equal(res.details.IND_GIAF4.status, "PENDENTE");
  });

  it("IND_VA respeita a aplicabilidade e confirmação do Registro 1400", () => {
    // 1. Confirmado aplicável -> S
    const resS = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: true,
      },
    });
    assert.equal(resS.indicators.IND_VA, "S");
    assert.equal(resS.details.IND_VA.status, "CONFIRMADO");

    // 2. Confirmado inaplicável -> N
    const resN = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
      },
    });
    assert.equal(resN.indicators.IND_VA, "N");
    assert.equal(resN.details.IND_VA.status, "CONFIRMADO");

    // 3. Pendente -> status PENDENTE
    const resPend = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "PENDENTE",
        registro_1400_aplicavel: false,
      },
    });
    assert.equal(resPend.details.IND_VA.status, "PENDENTE");
  });

  it("IND_CART reflete existência real de operações eletrônicas ou gate 1601", () => {
    // 1. Movimento detectado (mesmo sem gate fechado) -> S
    const resMov = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "PENDENTE",
      },
      hasElectronicPayments: true,
    });
    assert.equal(resMov.indicators.IND_CART, "S");
    assert.equal(resMov.details.IND_CART.origem, "FONTES_MOVIMENTO");
    assert.equal(resMov.details.IND_CART.status, "CONFIRMADO");

    // 2. Confirmado aplicável -> S
    const resConf = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: true,
      },
    });
    assert.equal(resConf.indicators.IND_CART, "S");
    assert.equal(resConf.details.IND_CART.status, "CONFIRMADO");

    // 3. Confirmado inaplicável e sem pagamentos -> N
    const resInap = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
      },
      hasElectronicPayments: false,
    });
    assert.equal(resInap.indicators.IND_CART, "N");
    assert.equal(resInap.details.IND_CART.status, "CONFIRMADO");
  });

  it("IND_REST_RESSARC_COMPL_ICMS respeita o gate C176/C179", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: true,
      },
    });
    assert.equal(res.indicators.IND_REST_RESSARC_COMPL_ICMS, "S");
    assert.equal(res.details.IND_REST_RESSARC_COMPL_ICMS.status, "CONFIRMADO");
  });

  // --- CASOS OBRIGATÓRIOS DO 1010 ---

  it("Caso 1 — nenhum indicador manual confirmado: lista todos os 7 indicadores faltantes", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
        evidencias: {}, // nenhum dos 7 manuais confirmado
      },
    });

    assert.equal(res.diagnostics.length, 1);
    assert.equal(res.diagnostics[0].code, "INDICADORES_1010_PENDENTES");
    assert.equal(res.diagnostics[0].severity, "BLOQUEIO");
    // Todos os 7 manuais devem constar na mensagem
    for (const field of SPED_1010_MANUAL_FIELDS) {
      assert.ok(
        res.diagnostics[0].message.includes(field.campo),
        `Esperava que ${field.campo} constasse na mensagem de pendências`
      );
    }
  });

  it("Caso 2 — todos os 7 indicadores manuais confirmados no formato auditável: nenhum diagnóstico pendente", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
        evidencias: {
          indicadores_1010: {
            IND_EXP: { valor: "N", status: "CONFIRMADO", descricao: "Sem exportação." },
            IND_CCRF: { valor: "N", status: "CONFIRMADO", descricao: "Sem créditos acumulados." },
            IND_COMB: { valor: "N", status: "CONFIRMADO", descricao: "Sem combustíveis." },
            IND_USINA: { valor: "N", status: "CONFIRMADO", descricao: "Não é usina de açúcar/álcool." },
            IND_EE: { valor: "N", status: "CONFIRMADO", descricao: "Sem operações de energia." },
            IND_FORM: { valor: "N", status: "CONFIRMADO", descricao: "Sem formulário de segurança." },
            IND_AER: { valor: "N", status: "CONFIRMADO", descricao: "Sem transporte aéreo." },
          },
        },
      },
    });

    assert.equal(res.diagnostics.length, 0);
    assert.equal(res.indicators.IND_EXP, "N");
    assert.equal(res.details.IND_EXP.status, "CONFIRMADO");
    assert.equal(res.details.IND_EXP.origem, "CONFIGURACAO");
    assert.equal(res.indicators.IND_COMB, "N");
    assert.equal(res.details.IND_COMB.status, "CONFIRMADO");
  });

  it("Caso 3 — parte confirmada: diagnóstico lista estritamente os que ainda faltam", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
        evidencias: {
          indicadores_1010: {
            IND_EXP: { valor: "N", status: "CONFIRMADO", descricao: "Confirmado." },
            IND_COMB: { valor: "N", status: "CONFIRMADO", descricao: "Confirmado." },
          },
        },
      },
    });

    assert.equal(res.diagnostics.length, 1);
    const msg = res.diagnostics[0].message;
    // Confirmados não devem constar
    assert.ok(!msg.includes("IND_EXP"), "IND_EXP não deveria estar na mensagem de pendentes");
    assert.ok(!msg.includes("IND_COMB"), "IND_COMB não deveria estar na mensagem de pendentes");
    // Faltantes devem constar
    assert.ok(msg.includes("IND_CCRF"));
    assert.ok(msg.includes("IND_USINA"));
    assert.ok(msg.includes("IND_EE"));
    assert.ok(msg.includes("IND_FORM"));
    assert.ok(msg.includes("IND_AER"));
  });

  // --- CASOS OBRIGATÓRIOS DO 1010 (AUDITORIA E VALIDAÇÃO) ---

  it("Caso A — confirmado corretamente: valor=N, status=CONFIRMADO, confirmadoPor=actorId, confirmadoEm pelo servidor", () => {
    const actorId = "usuario-auditor-real";
    const merged = mergeSped1010Evidence(
      {},
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportações.",
        },
      },
      actorId
    );

    const ind = (merged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.ok(ind);
    assert.equal(ind.valor, "N");
    assert.equal(ind.status, "CONFIRMADO");
    assert.equal(ind.descricao, "Sem exportações.");
    assert.equal(ind.confirmadoPor, actorId);
    assert.ok(ind.confirmadoEm);
    assert.ok(Date.now() - new Date(ind.confirmadoEm).getTime() < 60000);
  });

  it("Caso B — frontend tenta falsificar usuário: confirmadoPor deve ser sempre o actorId real", () => {
    const realActorId = "usuario-autenticado-real";
    const merged = mergeSped1010Evidence(
      {},
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportações.",
          confirmadoPor: "usuario-falso",
        },
      },
      realActorId
    );

    const ind = (merged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(ind.confirmadoPor, realActorId);
    assert.notEqual(ind.confirmadoPor, "usuario-falso");
  });

  it("Caso C — frontend tenta falsificar data: confirmadoEm enviado pelo cliente não é aceito", () => {
    const fakeTimestamp = "2000-01-01T00:00:00Z";
    const merged = mergeSped1010Evidence(
      {},
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportações.",
          confirmadoEm: fakeTimestamp,
        },
      },
      "actor-1"
    );

    const ind = (merged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.notEqual(ind.confirmadoEm, fakeTimestamp);
    assert.ok(Date.now() - new Date(ind.confirmadoEm).getTime() < 60000);
  });

  it("Caso D — string direta é rejeitada com erro 400 (INVALID_1010_EVIDENCE_FORMAT)", () => {
    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: "N",
          } as any,
          "actor-1"
        ),
      (err: any) =>
        err instanceof SpedServiceError &&
        err.statusCode === 400 &&
        err.code === "INVALID_1010_EVIDENCE_FORMAT"
    );

    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: "S",
          } as any,
          "actor-1"
        ),
      (err: any) =>
        err instanceof SpedServiceError &&
        err.statusCode === 400 &&
        err.code === "INVALID_1010_EVIDENCE_FORMAT"
    );
  });

  it("Caso E — confirmação sem descrição: rejeita com INDICATOR_EVIDENCE_REQUIRED", () => {
    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: {
              valor: "N",
              status: "CONFIRMADO",
              descricao: "",
            },
          },
          "actor-1"
        ),
      (err: any) =>
        err instanceof SpedServiceError &&
        err.code === "INDICATOR_EVIDENCE_REQUIRED"
    );
  });

  it("Caso F — valor inválido: rejeita com INVALID_INDICATOR_VALUE", () => {
    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: {
              valor: "SIM",
              status: "CONFIRMADO",
              descricao: "Teste",
            },
          },
          "actor-1"
        ),
      (err: any) =>
        err instanceof SpedServiceError &&
        err.code === "INVALID_INDICATOR_VALUE"
    );

    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: {
              valor: "TRUE",
              status: "CONFIRMADO",
              descricao: "Teste",
            },
          },
          "actor-1"
        ),
      (err: any) =>
        err instanceof SpedServiceError &&
        err.code === "INVALID_INDICATOR_VALUE"
    );
  });

  it("Caso G — volta para pendente: status PENDENTE e resolvedor gera INDICADORES_1010_PENDENTES", () => {
    const updated = mergeSped1010Evidence(
      {
        indicadores_1010: {
          IND_EXP: {
            valor: "N",
            status: "CONFIRMADO",
            descricao: "Confirmado antes",
            confirmadoEm: "2026-09-01T10:00:00Z",
            confirmadoPor: "user-1",
          },
        },
      },
      {
        IND_EXP: {
          valor: "N",
          status: "PENDENTE",
          descricao: "",
        },
      },
      "actor-novo"
    );

    const indExp = (updated.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(indExp.status, "PENDENTE");

    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        evidencias: updated,
      },
    });

    assert.equal(res.details.IND_EXP.status, "PENDENTE");
    assert.equal(res.details.IND_EXP.origem, "PADRAO_PROVISORIO");
    assert.ok(res.diagnostics.length > 0);
    assert.ok(res.diagnostics.some((d) => d.code === "INDICADORES_1010_PENDENTES" && d.message.includes("IND_EXP")));
  });

  it("Caso H — merge não apaga outros gates (timezone, perfil, 1601)", () => {
    const existing = {
      timezone: { status: "CONFIRMADO", descricao: "Fuso de Brasília confirmado." },
      perfil: { status: "CONFIRMADO", descricao: "Perfil B da SEFAZ PB." },
      "1601": { status: "CONFIRMADO", aplicavel: false },
    };

    const merged = mergeSped1010Evidence(
      existing,
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportações no período.",
        },
      },
      "actor-h"
    );

    assert.deepEqual(merged.timezone, existing.timezone);
    assert.deepEqual(merged.perfil, existing.perfil);
    assert.deepEqual(merged["1601"], existing["1601"]);
    assert.ok(merged.indicadores_1010);
    assert.equal((merged.indicadores_1010 as Record<string, any>).IND_EXP.valor, "N");
  });

  it("Caso I — mesma decisão não perde auditoria; alteração gera nova confirmação", () => {
    const originalTimestamp = "2026-09-17T15:00:00Z";
    const originalActor = "usuario-X";
    const initialEvidencias = {
      indicadores_1010: {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportação no período.",
          confirmadoEm: originalTimestamp,
          confirmadoPor: originalActor,
        },
      },
    };

    // 1. Chamada posterior idêntica: preserva timestamp e autor originais
    const sameMerged = mergeSped1010Evidence(
      initialEvidencias,
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Sem exportação no período.",
        },
      },
      "usuario-Y"
    );

    const sameInd = (sameMerged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(sameInd.confirmadoEm, originalTimestamp, "Deveria ter preservado confirmadoEm original");
    assert.equal(sameInd.confirmadoPor, originalActor, "Deveria ter preservado confirmadoPor original");

    // 2. Mudança no valor (N -> S): gera nova auditoria
    const changedValMerged = mergeSped1010Evidence(
      initialEvidencias,
      {
        IND_EXP: {
          valor: "S",
          status: "CONFIRMADO",
          descricao: "Sem exportação no período.",
        },
      },
      "usuario-Y"
    );
    const changedValInd = (changedValMerged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(changedValInd.confirmadoPor, "usuario-Y");
    assert.notEqual(changedValInd.confirmadoEm, originalTimestamp);

    // 3. Mudança na descrição: gera nova auditoria
    const changedDescMerged = mergeSped1010Evidence(
      initialEvidencias,
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Exportação confirmada pela NF-e X",
        },
      },
      "usuario-Z"
    );
    const changedDescInd = (changedDescMerged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(changedDescInd.confirmadoPor, "usuario-Z");
    assert.notEqual(changedDescInd.confirmadoEm, originalTimestamp);
  });
});
