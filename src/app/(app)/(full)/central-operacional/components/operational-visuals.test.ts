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
import {
  OPERATIONAL_EVENT_MODULES,
  OPERATIONAL_NODE_MODULES,
} from "@/lib/central-operacional/contracts";
import { EventFeed } from "./event-feed";
import { OperationalAlert } from "./operational-alert";
import {
  CORE_POSITION,
  NODE_POSITIONS,
  operationalConnectionPath,
  OperationalConnections,
} from "./operational-connections";
import { OperationalCore } from "./operational-core";
import { OperationalHeader } from "./operational-header";
import { OperationalMap } from "./operational-map";
import {
  nextOperationalFloatLeg,
  OPERATIONAL_NODE_FLOAT_PROFILES,
} from "../hooks/use-operational-float";
import { OperationalNode } from "./operational-node";
import { OperationalNodeWindow } from "./operational-node-window";
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

const FEED_BASE = {
  eventCount: 18,
  counterLabel: "SEMANA",
  now: Date.parse("2026-08-27T12:01:00.000Z"),
  hideValues: true,
  paused: true,
  expandedEventId: null,
  onExpand: () => undefined,
  onClose: () => undefined,
};

test("o feed identifica as seis categorias, mantém severidade secundária e oculta valores", () => {
  const events = OPERATIONAL_EVENT_MODULES.map(eventFor);
  const html = renderToStaticMarkup(React.createElement(EventFeed, {
    ...FEED_BASE,
    events,
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

test("cada card do feed anuncia que abre um detalhe e responde ao teclado", () => {
  const html = renderToStaticMarkup(React.createElement(EventFeed, {
    ...FEED_BASE,
    events: [eventFor("ORDENS", 0)],
  }));

  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-label="Abrir detalhes de Evento ORDENS"/);
});

test("o card aberto vira painel de detalhe sem tirar a lista de baixo", () => {
  const evento = eventFor("ORDENS", 0);
  const html = renderToStaticMarkup(React.createElement(EventFeed, {
    ...FEED_BASE,
    events: [evento],
    expandedEventId: evento.id,
  }));

  // O painel mora no viewport, fora da lista rolável, e a lista continua ali.
  const viewport = html.indexOf('class="operational-feed-viewport"');
  const lista = html.indexOf('class="operational-feed-list"');
  const painel = html.indexOf('class="operational-detail-panel"');
  assert.ok(viewport >= 0 && lista > viewport);
  assert.ok(painel > lista, "o painel deve vir depois da lista, sobrepondo-a");

  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal=/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="Fechar detalhes de Evento ORDENS"/);
  // Sem dado carregado ainda, nenhum valor é inventado na tela.
  assert.match(html, /Consultando o registro de origem/);
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
    selected: false,
    onSelect: () => undefined,
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
  assert.match(nodeHtml, /data-active="true" data-feeding="true" data-floating="false" data-selected="false" data-paused="true"/);
  assert.match(coreHtml, /data-module="ORDENS" data-priority="ATENCAO" data-active="true" data-paused="true"/);
  assert.match(connectionsHtml, /data-module="ORDENS" data-priority="INFO" data-active="true"/);
  assert.match(connectionsHtml, /operational-origin-pulse/);
  assert.match(connectionsHtml, /operational-particle-halo/);
  assert.match(connectionsHtml, /operational-particle/);
  assert.match(connectionsHtml, /operational-destination-ripple/);
  assert.deepEqual(operationalConnectionPath("ORDENS"), {
    from: CORE_POSITION,
    to: NODE_POSITIONS.ORDENS,
  });
  assert.deepEqual(NODE_POSITIONS.FINANCEIRO, { x: 230, y: 480 });
  assert.deepEqual(NODE_POSITIONS.CONTAS_RECEBER, { x: 810, y: 190 });
  assert.equal("ESTOQUE" in NODE_POSITIONS, false);
});

test("os seis nós possuem flutuação leve, lenta e desencontrada", () => {
  const delays = new Set<number>();

  for (const operationalModule of OPERATIONAL_NODE_MODULES) {
    const profile = OPERATIONAL_NODE_FLOAT_PROFILES[operationalModule];
    const [minDuration, maxDuration] = profile.durationRange;
    // Duração de um trecho; a ida e volta leva o dobro.
    assert.ok(minDuration >= 2);
    // Faixa larga, não valor fixo: um trecho pode durar o dobro do anterior, e
    // é essa variação que impede o ritmo de se repetir.
    assert.ok(maxDuration >= minDuration * 2);
    assert.ok(profile.amplitudeX <= 3);
    assert.ok(profile.amplitudeY <= 5.5);
    // Deriva vertical dominante — flutuar é sobretudo subir e descer.
    assert.ok(profile.amplitudeY > profile.amplitudeX);
    delays.add(profile.delay);
  }

  assert.equal(delays.size, OPERATIONAL_NODE_MODULES.length);
});

test("cada trecho da deriva troca de lado, mantém curso mínimo e varia a duração", () => {
  const profile = OPERATIONAL_NODE_FLOAT_PROFILES.VENDAS;
  const range = profile.durationRange;

  // Sorteio nos extremos: garante o contrato em toda a faixa possível.
  for (const roll of [0, 0.5, 0.999]) {
    const random = () => roll;
    const subindo = nextOperationalFloatLeg(3, profile.amplitudeY, range, random);
    const descendo = nextOperationalFloatLeg(-3, profile.amplitudeY, range, random);

    // Sempre cruza para a metade oposta: nunca fica parado perto de onde está.
    assert.ok(subindo.target < 0);
    assert.ok(descendo.target > 0);
    // Curso mínimo de 35% da amplitude, para não existir trecho quase imóvel.
    assert.ok(Math.abs(subindo.target) >= profile.amplitudeY * 0.35);
    assert.ok(Math.abs(subindo.target) <= profile.amplitudeY);
    assert.ok(subindo.duration >= range[0] && subindo.duration <= range[1]);
  }

  // Sorteios distintos produzem trechos distintos — é o que quebra o ritmo.
  const curto = nextOperationalFloatLeg(0, profile.amplitudeY, range, () => 0);
  const longo = nextOperationalFloatLeg(0, profile.amplitudeY, range, () => 0.999);
  assert.notEqual(curto.target, longo.target);
  assert.notEqual(curto.duration, longo.duration);
});

test("a janela expandida mantém categoria, privacidade e informações básicas do nó", () => {
  const html = renderToStaticMarkup(React.createElement(OperationalNodeWindow, {
    node: WEEKLY_SNAPSHOT.modulos.ORDENS,
    period: "SEMANAL",
    updatedAt: WEEKLY_SNAPSHOT.meta.atualizadoEm,
    lastEvent: eventFor("ORDENS", 1),
    hideValues: true,
    paused: true,
    onClose: () => undefined,
  }));

  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal=/);
  assert.match(html, /data-module="ORDENS" data-priority="INFO"/);
  assert.match(html, /aria-label="Fechar detalhes de ORDENS DE SERVIÇO"/);
  assert.match(html, /R\$ \u2022{6}/);
  assert.match(html, />SEMANAL</);
  assert.match(html, />AUTORIZADO</);
  assert.match(html, /Evento ORDENS/);
  assert.match(html, /SNAPSHOT \+ REALTIME/);
  assert.doesNotMatch(html, /1\.250,00/);
});

test("a expansão fica contida no mapa operacional, acima dos nós e do núcleo", () => {
  const html = renderToStaticMarkup(React.createElement(OperationalMap, {
    snapshot: WEEKLY_SNAPSHOT,
    activeEvent: null,
    paused: true,
    hideValues: false,
    selectedModule: "VENDAS",
    onNodeSelect: () => undefined,
    onNodeClose: () => undefined,
  }));
  const mapStart = html.indexOf('class="operational-map-panel"');
  const windowPosition = html.indexOf('class="operational-node-window-layer"');
  const mapEnd = html.lastIndexOf("</section>");

  assert.ok(mapStart >= 0);
  assert.ok(windowPosition > mapStart);
  assert.ok(windowPosition < mapEnd);
  assert.match(html, /operational-map-scroll/);
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
  assert.match(css, /operational-node-feed-wash/);
  assert.match(css, /operational-node-icon-charge/);
  assert.match(css, /operational-node-ambient/);
  assert.match(css, /operational-node-hover-glow/);
  assert.match(css, /operational-node-window-layer/);
  assert.match(css, /operational-node-window-grid/);
  assert.match(css, /\.operational-node-window\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(css, /\.operational-node-window-aura[^\n]+right:\s*0/);
  const windowLayerRule = css.match(/\.operational-node-window-layer\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(windowLayerRule, /position:\s*absolute/);
  assert.match(windowLayerRule, /background:\s*transparent/);
  assert.doesNotMatch(windowLayerRule, /backdrop-filter/);
  assert.match(css, /operational-connection-flow/);
  assert.match(css, /data-paused="true"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
