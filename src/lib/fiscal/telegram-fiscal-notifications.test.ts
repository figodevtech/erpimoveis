import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFiscalNotificationMessage,
  type TelegramFiscalDfe,
  type TelegramFiscalNfe,
  type TelegramFiscalNfse,
} from "./telegram-fiscal-notification-format";
import {
  classifyDfeStatusNotificationEvent,
  classifyNfeNotificationEvent,
  classifyNfseNotificationEvent,
  fiscalDocumentTypeOf,
  isFiscalNotificationEvent,
} from "./telegram-fiscal-events";

test("classifica os status da NF-e em eventos do catálogo", () => {
  assert.equal(classifyNfeNotificationEvent("AUTORIZADA"), "NFE_AUTORIZADA");
  assert.equal(classifyNfeNotificationEvent("rejeitada"), "NFE_REJEITADA");
  assert.equal(classifyNfeNotificationEvent("DENEGADA"), "NFE_DENEGADA");
  assert.equal(classifyNfeNotificationEvent("CANCELADA"), "NFE_CANCELADA");
  assert.equal(classifyNfeNotificationEvent("RESULTADO_INCERTO"), "NFE_RESULTADO_INCERTO");
  assert.equal(classifyNfeNotificationEvent("PENDENTE_ENVIO"), null);
  assert.equal(classifyNfeNotificationEvent(null), null);
});

test("denegação de NFS-e cai no mesmo evento da rejeição", () => {
  assert.equal(classifyNfseNotificationEvent("REJEITADA"), "NFSE_REJEITADA");
  assert.equal(classifyNfseNotificationEvent("DENEGADA"), "NFSE_REJEITADA");
  assert.equal(classifyNfseNotificationEvent("PROCESSANDO"), null);
});

test("só cStat sem validade vira cancelamento de nota de terceiro", () => {
  assert.equal(classifyDfeStatusNotificationEvent("101"), "DFE_CANCELADA");
  assert.equal(classifyDfeStatusNotificationEvent("110"), "DFE_CANCELADA");
  assert.equal(classifyDfeStatusNotificationEvent("100"), null);
});

test("cada evento aponta para a tabela que carrega o documento", () => {
  assert.equal(fiscalDocumentTypeOf("NFE_REJEITADA"), "NFE");
  assert.equal(fiscalDocumentTypeOf("NFSE_CANCELADA"), "NFSE");
  assert.equal(fiscalDocumentTypeOf("DFE_RECEBIDA"), "DFE");
  assert.equal(isFiscalNotificationEvent("NFE_INUTILIZADA"), false);
});

function nfe(overrides: Partial<TelegramFiscalNfe> = {}): TelegramFiscalNfe {
  return {
    id: 42,
    modelo: "NFE",
    serie: 1,
    numero: 1180,
    chave_acesso: "25260812345678000199550010000011801000011805",
    status: "REJEITADA",
    protocolo: null,
    total_nfe: 1250.5,
    codigo_rejeicao: "204",
    motivo_rejeicao: "Duplicidade de NF-e",
    justificativacancelamento: null,
    dataemissao: "2026-09-01T12:00:00.000Z",
    ordemservicoid: 77,
    vendaid: null,
    cliente_nome: "Auto Peças <Silva> & Cia",
    ...overrides,
  };
}

test("rejeição de NF-e leva código, motivo e origem", () => {
  const message = buildFiscalNotificationMessage("NFE_REJEITADA", { tipo: "NFE", documento: nfe() });
  assert.match(message, /NF-e rejeitada/);
  assert.match(message, /NF-e nº 1180 · série 1/);
  assert.match(message, /204 — Duplicidade de NF-e/);
  assert.match(message, /OS #77/);
  assert.match(message, /Auto Peças &lt;Silva&gt; &amp; Cia/);
});

test("resultado incerto avisa para não reemitir", () => {
  const message = buildFiscalNotificationMessage("NFE_RESULTADO_INCERTO", {
    tipo: "NFE",
    documento: nfe({ status: "RESULTADO_INCERTO", codigo_rejeicao: null, motivo_rejeicao: null }),
  });
  assert.match(message, /Não emita outra/);
});

test("cancelamento de NF-e mostra a justificativa e o protocolo", () => {
  const message = buildFiscalNotificationMessage("NFE_CANCELADA", {
    tipo: "NFE",
    documento: nfe({ status: "CANCELADA", protocolo: "125260000123456", justificativacancelamento: "Erro na quantidade dos itens" }),
  });
  assert.match(message, /Erro na quantidade dos itens/);
  assert.match(message, /125260000123456/);
});

function nfse(overrides: Partial<TelegramFiscalNfse> = {}): TelegramFiscalNfse {
  return {
    id: 9,
    numero: null,
    referencia: "OS-77-1",
    status: "REJEITADA",
    protocolo: null,
    valor_total: 480,
    erros: [{ codigo: "L999", mensagem: "Código de tributação do município inválido" }],
    ordemservicoid: 77,
    updatedat: "2026-09-01T12:30:00.000Z",
    cliente_nome: "Transportes Norte",
    ...overrides,
  };
}

test("rejeição de NFS-e mostra a mensagem antes do código genérico", () => {
  const message = buildFiscalNotificationMessage("NFSE_REJEITADA", { tipo: "NFSE", documento: nfse() });
  assert.match(message, /Código de tributação do município inválido \(L999\)/);
  assert.match(message, /referência OS-77-1/);
});

test("rejeição de NFS-e sem erro registrado não fica com motivo vazio", () => {
  const message = buildFiscalNotificationMessage("NFSE_REJEITADA", {
    tipo: "NFSE",
    documento: nfse({ erros: null }),
  });
  assert.match(message, /Não informado pela prefeitura/);
});

function dfe(overrides: Partial<TelegramFiscalDfe> = {}): TelegramFiscalDfe {
  return {
    id: 300,
    nsu: "000000000000512",
    chave_acesso: "25260812345678000199550010000011801000011805",
    tipo_documento: "RESUMO_NFE",
    emitente_nome: "Distribuidora Alfa",
    emitente_cnpj: "12345678000199",
    valor_total: 3200,
    data_emissao: "2026-08-31T18:00:00.000Z",
    status: "100",
    status_manifestacao: null,
    ...overrides,
  };
}

test("nota de terceiro reconhecida diz que é resumo e que falta manifestar", () => {
  const message = buildFiscalNotificationMessage("DFE_RECEBIDA", { tipo: "DFE", documento: dfe() });
  assert.match(message, /Nota de terceiro reconhecida/);
  assert.match(message, /12\.345\.678\/0001-99/);
  assert.match(message, /Aguardando manifestação/);
  assert.match(message, /XML completo ainda não liberado/);
});

test("nota de terceiro com XML completo não repete o aviso de resumo", () => {
  const message = buildFiscalNotificationMessage("DFE_RECEBIDA", {
    tipo: "DFE",
    documento: dfe({ tipo_documento: "PROC_NFE", status_manifestacao: "CONFIRMACAO" }),
  });
  assert.doesNotMatch(message, /XML completo ainda não liberado/);
  assert.match(message, /Operação confirmada/);
});
