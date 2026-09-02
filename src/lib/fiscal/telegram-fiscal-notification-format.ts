import { escapeTelegramHtml } from "@/lib/integrations/telegram";
import type { FiscalNotificationEvent } from "@/lib/fiscal/telegram-fiscal-events";

export type TelegramFiscalNfe = {
  id: number;
  modelo: string | null;
  serie: number | null;
  numero: number | null;
  chave_acesso: string | null;
  status: string | null;
  protocolo: string | null;
  total_nfe: number | null;
  codigo_rejeicao: string | null;
  motivo_rejeicao: string | null;
  justificativacancelamento: string | null;
  dataemissao: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  cliente_nome: string | null;
};

export type TelegramFiscalNfse = {
  id: number;
  numero: string | null;
  referencia: string | null;
  status: string | null;
  protocolo: string | null;
  valor_total: number | null;
  erros: unknown;
  ordemservicoid: number | null;
  updatedat: string | null;
  cliente_nome: string | null;
};

export type TelegramFiscalDfe = {
  id: number;
  nsu: string | null;
  chave_acesso: string | null;
  tipo_documento: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  status: string | null;
  status_manifestacao: string | null;
};

export type TelegramFiscalDocument =
  | { tipo: "NFE"; documento: TelegramFiscalNfe }
  | { tipo: "NFSE"; documento: TelegramFiscalNfse }
  | { tipo: "DFE"; documento: TelegramFiscalDfe };

const EVENT_HEADINGS: Record<FiscalNotificationEvent, string> = {
  NFE_AUTORIZADA: "✅ <b>NF-e autorizada</b>",
  NFE_REJEITADA: "⚠️ <b>NF-e rejeitada</b>",
  NFE_DENEGADA: "⛔ <b>NF-e denegada</b>",
  NFE_CANCELADA: "🚫 <b>NF-e cancelada</b>",
  NFE_RESULTADO_INCERTO: "❓ <b>NF-e sem resposta da SEFAZ</b>",
  NFSE_AUTORIZADA: "✅ <b>NFS-e autorizada</b>",
  NFSE_REJEITADA: "⚠️ <b>NFS-e rejeitada</b>",
  NFSE_CANCELADA: "🚫 <b>NFS-e cancelada</b>",
  DFE_RECEBIDA: "📄 <b>Nota de terceiro reconhecida</b>",
  DFE_CANCELADA: "🚫 <b>Nota de terceiro cancelada</b>",
};

const MANIFESTACAO_LABELS: Record<string, string> = {
  CIENCIA: "Ciência da operação",
  CONFIRMACAO: "Operação confirmada",
  DESCONHECIMENTO: "Operação desconhecida",
  OPERACAO_NAO_REALIZADA: "Operação não realizada",
};

const MODELO_LABELS: Record<string, string> = {
  NFE: "NF-e",
  NFCE: "NFC-e",
  "55": "NF-e",
  "65": "NFC-e",
};

function formatMoney(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);
}

function formatDocument(value: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return value ?? null;
}

/**
 * Motivo legível de uma NFS-e rejeitada.
 *
 * O código do município costuma ser genérico — em João Pessoa quase tudo volta
 * como L999 —, então o texto vem primeiro e o código só acompanha entre
 * parênteses. É a mensagem que diz o que corrigir.
 */
function nfseErrorText(erros: unknown) {
  const list = Array.isArray(erros) ? erros : erros ? [erros] : [];
  const messages = list
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const record = (item ?? {}) as Record<string, unknown>;
      const message = String(record.mensagem ?? record.message ?? record.descricao ?? "").trim();
      const code = String(record.codigo ?? record.code ?? "").trim();
      if (!message) return code;
      return code ? `${message} (${code})` : message;
    })
    .filter(Boolean);
  if (messages.length === 0) return null;
  return messages.slice(0, 3).join("\n• ");
}

function pushLine(lines: string[], label: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  lines.push(`<b>${label}:</b> ${escapeTelegramHtml(value)}`);
}

function buildNfeLines(event: FiscalNotificationEvent, nfe: TelegramFiscalNfe) {
  const modelo = MODELO_LABELS[String(nfe.modelo ?? "").toUpperCase()] ?? "Nota";
  const identificacao = nfe.numero
    ? `${modelo} nº ${nfe.numero}${nfe.serie !== null && nfe.serie !== undefined ? ` · série ${nfe.serie}` : ""}`
    : `${modelo} (rascunho #${nfe.id})`;
  const lines: string[] = [];

  pushLine(lines, "Documento", identificacao);
  pushLine(lines, "Destinatário", nfe.cliente_nome);
  pushLine(lines, "Valor", formatMoney(nfe.total_nfe));

  if (event === "NFE_REJEITADA" || event === "NFE_DENEGADA") {
    const motivo = [nfe.codigo_rejeicao, nfe.motivo_rejeicao].filter(Boolean).join(" — ");
    pushLine(lines, "Motivo", motivo || "Não informado pela SEFAZ");
  }
  if (event === "NFE_CANCELADA") {
    pushLine(lines, "Justificativa", nfe.justificativacancelamento);
  }
  if (event === "NFE_AUTORIZADA" || event === "NFE_CANCELADA") {
    pushLine(lines, "Protocolo", nfe.protocolo);
  }

  pushLine(lines, "Chave", nfe.chave_acesso);
  if (nfe.ordemservicoid) pushLine(lines, "Origem", `OS #${nfe.ordemservicoid}`);
  else if (nfe.vendaid) pushLine(lines, "Origem", `Venda #${nfe.vendaid}`);
  pushLine(lines, "Emissão", formatDate(nfe.dataemissao));

  if (event === "NFE_RESULTADO_INCERTO") {
    lines.push(
      "",
      "<i>A nota foi transmitida e a resposta não chegou. Não emita outra: consulte a situação da chave para saber se ela foi autorizada.</i>",
    );
  }
  return lines;
}

function buildNfseLines(event: FiscalNotificationEvent, nfse: TelegramFiscalNfse) {
  const identificacao = nfse.numero ? `NFS-e nº ${nfse.numero}` : `NFS-e (referência ${nfse.referencia ?? nfse.id})`;
  const lines: string[] = [];

  pushLine(lines, "Documento", identificacao);
  pushLine(lines, "Tomador", nfse.cliente_nome);
  pushLine(lines, "Valor", formatMoney(nfse.valor_total));

  if (event === "NFSE_REJEITADA") {
    const motivo = nfseErrorText(nfse.erros);
    lines.push(`<b>Motivo:</b>${motivo ? `\n• ${escapeTelegramHtml(motivo)}` : " Não informado pela prefeitura"}`);
  }
  if (event === "NFSE_AUTORIZADA" || event === "NFSE_CANCELADA") {
    pushLine(lines, "Protocolo", nfse.protocolo);
  }

  if (nfse.ordemservicoid) pushLine(lines, "Origem", `OS #${nfse.ordemservicoid}`);
  pushLine(lines, "Referência", nfse.referencia);
  pushLine(lines, "Atualizada em", formatDate(nfse.updatedat));
  return lines;
}

function buildDfeLines(event: FiscalNotificationEvent, dfe: TelegramFiscalDfe) {
  const lines: string[] = [];

  pushLine(lines, "Emitente", dfe.emitente_nome ?? "Não informado");
  pushLine(lines, "CNPJ", formatDocument(dfe.emitente_cnpj));
  pushLine(lines, "Valor", formatMoney(dfe.valor_total));
  pushLine(lines, "Chave", dfe.chave_acesso);
  pushLine(lines, "Emissão", formatDate(dfe.data_emissao));

  if (event === "DFE_RECEBIDA") {
    const manifestacao = dfe.status_manifestacao
      ? MANIFESTACAO_LABELS[dfe.status_manifestacao] ?? dfe.status_manifestacao
      : "Aguardando manifestação";
    pushLine(lines, "Manifestação", manifestacao);
    // O resumo chega antes do XML completo; dizer isso evita a pergunta de por
    // que a nota apareceu sem os itens.
    if (String(dfe.tipo_documento ?? "").toUpperCase() === "RESUMO_NFE") {
      pushLine(lines, "Conteúdo", "Resumo da NF-e (XML completo ainda não liberado)");
    }
  }
  pushLine(lines, "NSU", dfe.nsu);
  return lines;
}

export function buildFiscalNotificationMessage(
  event: FiscalNotificationEvent,
  document: TelegramFiscalDocument,
) {
  const body = document.tipo === "NFE"
    ? buildNfeLines(event, document.documento)
    : document.tipo === "NFSE"
      ? buildNfseLines(event, document.documento)
      : buildDfeLines(event, document.documento);

  return [EVENT_HEADINGS[event], "", ...body].join("\n").slice(0, 4000);
}
