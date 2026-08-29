import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  OperationalAttention,
  OperationalEvent,
  OperationalEventModule,
  OperationalNodeModule,
  OperationalSnapshot,
} from "@/lib/central-operacional/contracts";
import { OPERATIONAL_EVENT_MODULES } from "@/lib/central-operacional/contracts";
import { EventFeed } from "./event-feed";
import { OperationalAlert } from "./operational-alert";
import { NODE_POSITIONS, OperationalConnections } from "./operational-connections";
import { OperationalCore } from "./operational-core";
import { OperationalHeader } from "./operational-header";
import { OperationalNode } from "./operational-node";
import { OperationalTicker } from "./operational-ticker";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const MODULE_EVENTS: Record<OperationalEventModule, Pick<OperationalEvent, "tipo" | "entidadeTipo">> = {
  VENDAS: { tipo: "VENDA_CONFIRMADA", entidadeTipo: "VENDA" },
  ORDENS: { tipo: "OS_CRIADA", entidadeTipo: "ORDEM_SERVICO" },
  FINANCEIRO: { tipo: "PIX_RECEBIDO", entidadeTipo: "TRANSACAO" },
  CONTAS_PAGAR: { tipo: "CONTA_CRIADA", entidadeTipo: "TRANSACAO" },
  ESTOQUE: { tipo: "ESTOQUE_SAIDA", entidadeTipo: "PRODUTO" },
  FISCAL: { tipo: "NFE_AUTORIZADA", entidadeTipo: "NFE" },
};

function eventFor(operationalModule: OperationalEventModule, index: number): OperationalEvent {
  return {
    id: `aa000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ...MODULE_EVENTS[operationalModule],
    modulo: operationalModule,
    entidadeId: String(index + 1),
    titulo: `Evento ${operationalModule}`,
    descricao: `Descrição ${operationalModule}`,
    valor: 125.5,
    quantidade: null,
    prioridade: index === 4 ? "ATENCAO" : index === 5 ? "CRITICO" : "INFO",
    metadata: {},
    ocorridoEm: "2026-08-27T12:00:00.000Z",
  };
}

function snapshotNode(module: OperationalNodeModule) {
  return {
    modulo: module,
    disponivel: true,
    estado: "OPERACIONAL",
    indicador: {
      tipo: "MOEDA" as const,
      valor: 1250,
      sufixo: null,
    },
    detalhe: "3 operações na semana",
    alerta: false,
  };
}

const WEEKLY_SNAPSHOT: OperationalSnapshot = {
  meta: {
    tenantId: 1,
    empresa: "Oficina Modelo",
    atualizadoEm: "2026-08-27T12:00:00.000Z",
    status: "SINCRONIZADO",
    periodo: "SEMANAL",
    periodoInicio: "2026-08-24T03:00:00.000Z",
    periodoFimExclusivo: "2026-08-31T03:00:00.000Z",
    modulosPermitidos: [
      "VENDAS",
      "ORDENS",
      "FINANCEIRO",
      "CONTAS_RECEBER",
      "CONTAS_PAGAR",
      "ESTOQUE",
      "FISCAL",
    ],
  },
  geral: {
    usuariosAtivos: null,
    operacoesPeriodo: 18,
    osAtivas: 2,
  },
  modulos: {
    VENDAS: snapshotNode("VENDAS"),
    ORDENS: snapshotNode("ORDENS"),
    FINANCEIRO: snapshotNode("FINANCEIRO"),
    CONTAS_RECEBER: snapshotNode("CONTAS_RECEBER"),
    CONTAS_PAGAR: snapshotNode("CONTAS_PAGAR"),
    FISCAL: snapshotNode("FISCAL"),
  },
  eventosPeriodo: 18,
  eventosRecentes: [],
  atencoes: [],
};

test("o feed identifica as seis categorias, mantém severidade secundária e oculta valores", () => {
  const events = OPERATIONAL_EVENT_MODULES.map(eventFor);
  const html = renderToStaticMarkup(React.createElement(EventFeed, {
    events,
    eventCount: 18,
    counterLabel: "SEMANA",
    now: Date.parse("2026-08-27T12:01:00.000Z"),
    hideValues: true,
    paused: true,
  }));

  for (const operationalModule of OPERATIONAL_EVENT_MODULES) {
    assert.match(html, new RegExp(`data-module="${operationalModule}"`));
  }
  assert.match(html, /aria-label="18 eventos no período"/);
  assert.match(html, />SEMANA</);
  assert.match(html, /data-module="ESTOQUE" data-priority="ATENCAO"/);
  assert.match(html, /data-module="FISCAL" data-priority="CRITICO"/);
  assert.match(html, /R\$ ••••••/);
  assert.doesNotMatch(html, /125,50/);
});

test("o cabeçalho exibe o resultado semanal e oferece a próxima alternância mensal", () => {
  const html = renderToStaticMarkup(React.createElement(OperationalHeader, {
    snapshot: WEEKLY_SNAPSHOT,
    connectionStatus: "LIVE",
    onlineUsers: 3,
    now: Date.parse("2026-08-27T12:00:00.000Z"),
    hideValues: false,
    paused: false,
    refreshing: false,
    period: "SEMANAL",
    fullscreen: false,
    onToggleValues: () => undefined,
    onTogglePaused: () => undefined,
    onToggleFullscreen: () => undefined,
    onRefresh: () => undefined,
    onPeriodChange: () => undefined,
  }));

  assert.match(html, /OPERAÇÕES NA SEMANA/);
  assert.match(html, />18</);
  assert.match(html, />SEMANAL</);
  assert.match(html, /Alternar para MENSAL/);
});

test("nó, conexão e núcleo expõem estados ativo, alerta, restrito e pausado", () => {
  const activeEvent = eventFor("ORDENS", 1);
  const nodeHtml = renderToStaticMarkup(React.createElement(OperationalNode, {
    node: {
      modulo: "ORDENS",
      disponivel: false,
      estado: "SEM ACESSO",
      indicador: null,
      detalhe: null,
      alerta: true,
    },
    active: true,
    priority: "ATENCAO",
    paused: true,
    transientState: "RECEBENDO",
    hideValues: true,
    position: { x: 500, y: 76 },
  }));
  const coreHtml = renderToStaticMarkup(React.createElement(OperationalCore, {
    activeModule: "ORDENS",
    activePriority: "ATENCAO",
    paused: true,
  }));
  const connectionsHtml = renderToStaticMarkup(React.createElement(OperationalConnections, {
    activeEvent,
    paused: false,
  }));

  assert.match(nodeHtml, /class="operational-node has-alert is-restricted"/);
  assert.match(nodeHtml, /data-active="true" data-paused="true"/);
  assert.match(coreHtml, /data-module="ORDENS" data-priority="ATENCAO" data-active="true" data-paused="true"/);
  assert.match(connectionsHtml, /data-module="ORDENS" data-priority="INFO" data-active="true"/);
  assert.match(connectionsHtml, /operational-particle/);
  assert.match(connectionsHtml, /operational-destination-ripple/);
  assert.deepEqual(NODE_POSITIONS.FINANCEIRO, { x: 230, y: 480 });
  assert.deepEqual(NODE_POSITIONS.CONTAS_RECEBER, { x: 810, y: 190 });
  assert.equal("ESTOQUE" in NODE_POSITIONS, false);
});

test("alerta e ticker preservam módulo e exibem o acento crítico", () => {
  const attention: OperationalAttention = {
    id: "conta-vencida-1",
    modulo: "CONTAS_PAGAR",
    titulo: "Conta vencida",
    detalhe: "Cliente: Oficina Modelo",
    prioridade: "CRITICO",
    valor: 299.9,
    ocorridoEm: "2026-08-27T12:00:00.000Z",
  };
  const alertHtml = renderToStaticMarkup(React.createElement(OperationalAlert, {
    attention,
    hideValues: true,
    paused: false,
  }));
  const tickerHtml = renderToStaticMarkup(React.createElement(OperationalTicker, {
    attentions: [attention],
    hideValues: true,
    paused: true,
  }));

  assert.match(alertHtml, /data-module="CONTAS_PAGAR" data-priority="CRITICO"/);
  assert.match(alertHtml, /operational-alert-module/);
  assert.match(alertHtml, /operational-alert-severity/);
  assert.match(tickerHtml, /data-module="CONTAS_PAGAR" data-priority="CRITICO"/);
  assert.match(tickerHtml, /operational-ticker-category/);
  assert.match(tickerHtml, /data-paused="true"/);
});

test("o CSS mantém a paleta, os estados visuais e a redução de movimento", () => {
  const css = readFileSync(path.resolve(
    process.cwd(),
    "src/app/(app)/(full)/central-operacional/central-operacional.css",
  ), "utf8");

  for (const [operationalModule, color] of [
    ["VENDAS", "#fbbf24"],
    ["ORDENS", "#a78bfa"],
    ["FINANCEIRO", "#34d399"],
    ["CONTAS_RECEBER", "#2dd4bf"],
    ["CONTAS_PAGAR", "#fb7185"],
    ["ESTOQUE", "#60a5fa"],
    ["FISCAL", "#22d3ee"],
  ]) {
    assert.match(css, new RegExp(`data-module="${operationalModule}"[^\\n]+${color}`));
  }
  assert.match(css, /operational-node\.has-alert::after/);
  assert.match(css, /operational-node\.is-restricted/);
  assert.match(css, /data-paused="true"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
