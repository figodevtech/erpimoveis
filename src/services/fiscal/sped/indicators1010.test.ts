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

  it("Caso 4 — salvar configuração 1010: persiste evidencias.indicadores_1010 com dados auditáveis", () => {
    const actorId = "usuario-auditor-123";
    const merged = mergeSped1010Evidence(
      {},
      {
        IND_EXP: {
          valor: "S",
          status: "CONFIRMADO",
          descricao: "Empresa iniciou exportação de peças.",
        },
      },
      actorId
    );

    const ind = (merged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.ok(ind);
    assert.equal(ind.valor, "S");
    assert.equal(ind.status, "CONFIRMADO");
    assert.equal(ind.descricao, "Empresa iniciou exportação de peças.");
    assert.equal(ind.confirmadoPor, actorId);
    assert.ok(ind.confirmadoEm);
  });

  it("Caso 5 — preservar evidências antigas: não sobrescreve nem apaga outros gates", () => {
    const existingEvidencias = {
      timezone: {
        descricao: "Fuso de Brasília confirmado.",
        status: "CONFIRMADO",
        confirmadoEm: "2026-09-01T10:00:00Z",
      },
      perfil: {
        descricao: "Perfil B conforme regulamento da SEFAZ PB.",
        status: "CONFIRMADO",
        confirmadoEm: "2026-09-01T10:05:00Z",
      },
    };

    const merged = mergeSped1010Evidence(
      existingEvidencias,
      {
        IND_EXP: {
          valor: "N",
          status: "CONFIRMADO",
          descricao: "Ausência de exportações.",
        },
      },
      "actor-456"
    );

    // Evidências pré-existentes devem continuar 100% intactas
    assert.deepEqual(merged.timezone, existingEvidencias.timezone);
    assert.deepEqual(merged.perfil, existingEvidencias.perfil);

    // Indicador 1010 adicionado
    const ind1010 = (merged.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(ind1010.valor, "N");
    assert.equal(ind1010.status, "CONFIRMADO");
  });

  it("Caso 6 — voltar para pendente (Não decidido): volta a PENDENTE e diagnóstico ressurge", () => {
    // 1. Configuração com indicador anteriormente CONFIRMADO
    const initialConfig = {
      evidencias: {
        indicadores_1010: {
          IND_EXP: {
            valor: "N",
            status: "CONFIRMADO",
            descricao: "Confirmado anteriormente",
          },
        },
      },
    };

    // 2. Contador altera para Não decidido (PENDENTE)
    const updatedEvidencias = mergeSped1010Evidence(
      initialConfig.evidencias,
      {
        IND_EXP: {
          valor: "N",
          status: "PENDENTE",
          descricao: "",
        },
      },
      "actor-789"
    );

    const indExp = (updatedEvidencias.indicadores_1010 as Record<string, any>)?.IND_EXP;
    assert.equal(indExp.status, "PENDENTE");

    // 3. Resolução gera diagnóstico de bloqueio
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        evidencias: updatedEvidencias,
      },
    });

    assert.equal(res.details.IND_EXP.status, "PENDENTE");
    assert.equal(res.details.IND_EXP.origem, "PADRAO_PROVISORIO");
    assert.ok(res.diagnostics.length > 0);
    assert.ok(res.diagnostics[0].message.includes("IND_EXP"));
  });

  it("Validação server-side: rejeita valores inválidos fora de S e N", () => {
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
          "actor"
        ),
      (err: any) => err instanceof SpedServiceError && err.code === "INVALID_INDICATOR_VALUE"
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
          "actor"
        ),
      (err: any) => err instanceof SpedServiceError && err.code === "INVALID_INDICATOR_VALUE"
    );
  });

  it("Validação server-side: rejeita confirmação sem evidência textual", () => {
    assert.throws(
      () =>
        mergeSped1010Evidence(
          {},
          {
            IND_EXP: {
              valor: "N",
              status: "CONFIRMADO",
              descricao: "", // Vazia
            },
          },
          "actor"
        ),
      (err: any) => err instanceof SpedServiceError && err.code === "INDICATOR_EVIDENCE_REQUIRED"
    );
  });
});
