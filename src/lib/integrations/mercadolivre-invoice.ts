import { ensureMercadoLivreToken } from "@/lib/integrations/mercadolivre-token";
import {
  resolveMercadoLivreInvoiceChannel,
  type MercadoLivreInvoiceChannel,
} from "@/lib/integrations/mercadolivre-shipment-format";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ML_API_BASE_URL = "https://api.mercadolibre.com";
/** Limite do ML para o XML anexado ao pedido. */
const FISCAL_DOCUMENT_MAX_BYTES = 1024 * 1024;

type MercadoLivreAccount = {
  id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  site_id: string | null;
};

type StoredOrder = {
  id: number;
  empresa_id: number;
  account_id: number | null;
  venda_id: number | null;
  ml_order_id: number;
  ml_pack_id: number | null;
  ml_shipment_id: number | null;
  shipping_mode: string | null;
  logistic_type: string | null;
  shipment_status: string | null;
  shipment_substatus: string | null;
  status: string | null;
  payment_status: string | null;
  payment_status_detail: string | null;
  order_tags: string[] | null;
  nfe_id: number | null;
  ml_invoice_id: string | null;
  invoice_status: string | null;
  invoice_fiscal_key: string | null;
  invoice_error: string | null;
  invoice_sent_at: string | null;
  invoice_updated_at: string | null;
  raw_invoice: Record<string, unknown> | null;
  raw_shipment: Record<string, unknown> | null;
};

export async function getMercadoLivreInvoiceState(orderId: number, empresaId: number, refreshRemote = false) {
  const order = await getOrder(orderId, empresaId);
  const nfe = await getLatestNfe(order);
  let remoteInvoice = order.raw_invoice ?? {};
  const channel = resolveMercadoLivreInvoiceChannel(order);

  if (refreshRemote && (channel === "pack" || (channel === "shipment" && order.ml_shipment_id))) {
    try {
      const account = await getAccount(order);
      const accessToken = await ensureValidAccessToken(account);
      remoteInvoice = channel === "pack"
        ? await fetchPackFiscalDocuments(accessToken, packIdOf(order), order.raw_invoice)
        : await fetchInvoiceData(accessToken, Number(order.ml_shipment_id), account.site_id);
      await persistInvoiceState(order.id, nfe, remoteInvoice, null, false);
    } catch (error: any) {
      if (!isInvoiceNotFound(error)) throw error;
    }
  }

  return buildInvoiceState(order, nfe, remoteInvoice);
}

export async function sendMercadoLivreInvoice(orderId: number, empresaId: number) {
  const order = await getOrder(orderId, empresaId);
  const nfe = await getLatestNfe(order);
  const channel = resolveMercadoLivreInvoiceChannel(order);

  try {
    validateInvoiceUpload(order, nfe, channel);
    const account = await getAccount(order);
    const accessToken = await ensureValidAccessToken(account);
    let remoteInvoice: Record<string, unknown>;
    if (channel === "pack") {
      const packId = packIdOf(order);
      const upload = await uploadPackFiscalDocument(accessToken, packId, nfe);
      const ids = Array.isArray(upload?.ids) ? upload.ids : [];
      remoteInvoice = await fetchPackFiscalDocuments(accessToken, packId, { ids }).catch(() => ({
        channel: "pack",
        pack_id: packId,
        ids,
        fiscal_documents: [],
      }));
    } else {
      const shipmentId = Number(order.ml_shipment_id);
      const uploadResult = await uploadInvoiceXml(accessToken, shipmentId, nfe.xml_autorizado, account.site_id);
      remoteInvoice = await fetchInvoiceData(accessToken, shipmentId, account.site_id).catch(() => uploadResult);
    }

    await persistInvoiceState(order.id, nfe, remoteInvoice, null, true);
    return buildInvoiceState(
      {
        ...order,
        nfe_id: nfe.id,
        invoice_status: extractInvoiceStatus(remoteInvoice) || "sent",
        invoice_fiscal_key: nfe.chave_acesso,
        invoice_error: null,
        invoice_sent_at: new Date().toISOString(),
        invoice_updated_at: new Date().toISOString(),
        raw_invoice: remoteInvoice,
      },
      nfe,
      remoteInvoice,
    );
  } catch (error: any) {
    const message = formatInvoiceError(error);
    await supabaseAdmin
      .from("mercadolivre_order")
      .update({ invoice_error: message, invoice_updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("empresa_id", empresaId);
    throw new Error(message);
  }
}

export async function syncRecentMercadoLivreInvoices(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id")
    .not("account_id", "is", null)
    .not("invoice_sent_at", "is", null)
    .order("invoice_updated_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;

  const results: Array<{ orderId: number; ok: boolean; error?: string }> = [];
  for (const row of data ?? []) {
    try {
      await getMercadoLivreInvoiceState(Number(row.id), Number(row.empresa_id), true);
      results.push({ orderId: Number(row.id), ok: true });
    } catch (syncError: any) {
      results.push({ orderId: Number(row.id), ok: false, error: formatInvoiceError(syncError) });
    }
  }
  return results;
}

async function getOrder(orderId: number, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, empresa_id, account_id, venda_id, ml_order_id, ml_pack_id, status, payment_status, payment_status_detail, order_tags, ml_shipment_id, shipping_mode, logistic_type, shipment_status, shipment_substatus, nfe_id, ml_invoice_id, invoice_status, invoice_fiscal_key, invoice_error, invoice_sent_at, invoice_updated_at, raw_invoice, raw_shipment")
    .eq("id", orderId)
    .eq("empresa_id", empresaId)
    .single();
  if (error) throw error;
  return data as StoredOrder;
}

async function getLatestNfe(order: StoredOrder) {
  if (!order.venda_id) return null;

  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select("id, vendaid, empresaid, numero, serie, chave_acesso, ambiente, status, xml_autorizado, dataautorizacao, createdat")
    .eq("vendaid", order.venda_id)
    .eq("empresaid", order.empresa_id)
    .eq("modelo", "NFE")
    .eq("is_deleted", false)
    .order("createdat", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function getAccount(order: StoredOrder) {
  if (!order.account_id) throw new Error("Este pedido pertence a uma conta Mercado Livre anterior e não pode mais enviar NF-e.");
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, access_token, refresh_token, expires_at, site_id")
    .eq("empresa_id", order.empresa_id)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = query.eq("id", order.account_id);

  const { data, error } = await query.single();
  if (error) throw error;
  return data as MercadoLivreAccount;
}

async function ensureValidAccessToken(account: MercadoLivreAccount) {
  return ensureMercadoLivreToken(account);
}

function validateInvoiceUpload(order: StoredOrder, nfe: any, channel: MercadoLivreInvoiceChannel) {
  if (!order.venda_id) throw new Error("Este pedido ainda não está vinculado a uma venda do ERP.");
  if (channel === "fulfillment") {
    throw new Error("Em pedidos do Full a NF-e é emitida pelo próprio Mercado Livre; não há nota para anexar.");
  }
  if (channel === "unknown") {
    throw new Error("A logística deste envio ainda não foi sincronizada. Sincronize o envio e tente de novo.");
  }
  if (channel === "shipment" && !order.ml_shipment_id) {
    throw new Error("Este pedido não possui um envio do Mercado Livre vinculado.");
  }
  const payment = String(order.payment_status ?? "").toLowerCase();
  if (payment && !["paid", "approved", "accredited"].includes(payment)) {
    throw new Error("A NF-e só pode ser enviada depois que o pagamento for aprovado.");
  }
  const orderState = [order.status, order.payment_status, order.payment_status_detail, ...(order.order_tags ?? [])]
    .map((value) => String(value ?? "").toLowerCase());
  if (orderState.some((value) => value.includes("cancel") || value.includes("refund") || value.includes("charged_back"))) {
    throw new Error("Este pedido foi cancelado ou reembolsado e não permite enviar NF-e ao shipment.");
  }
  // Só a importação no envio depende do momento: o ML a aceita enquanto
  // espera a nota para liberar a etiqueta. Anexar ao pedido vale a qualquer hora.
  if (channel === "shipment" && String(order.shipment_substatus ?? "").toLowerCase() !== "invoice_pending" && !order.invoice_sent_at) {
    throw new Error("O envio não está aguardando NF-e. Sincronize o envio antes de tentar novamente.");
  }
  if (!nfe) throw new Error("Nenhuma NF-e foi encontrada para esta venda. Emita e autorize a nota antes de enviá-la ao Mercado Livre.");
  if (String(nfe.status).toUpperCase() !== "AUTORIZADA") throw new Error("A NF-e vinculada ainda não está autorizada pela SEFAZ.");
  if (String(nfe.ambiente).toUpperCase() !== "PRODUCAO") {
    throw new Error("O Mercado Livre não aceita NF-e de homologação. Autorize uma NF-e em produção para este pedido.");
  }
  if (!String(nfe.xml_autorizado ?? "").includes("<nfeProc")) {
    throw new Error("O XML autorizado da NF-e não contém o protocolo nfeProc exigido pelo Mercado Livre.");
  }
  if (channel === "pack" && Buffer.byteLength(xmlComDeclaracao(nfe.xml_autorizado), "utf8") > FISCAL_DOCUMENT_MAX_BYTES) {
    throw new Error("O XML da NF-e passa de 1 MB, o limite do Mercado Livre para anexar ao pedido.");
  }
}

/** Pedido sem carrinho não tem pack; o ML manda usar o próprio número do pedido. */
function packIdOf(order: StoredOrder) {
  const packId = Number(order.ml_pack_id);
  return Number.isFinite(packId) && packId > 0 ? packId : Number(order.ml_order_id);
}

/** O ML exige a declaração XML antes do <nfeProc>. */
function xmlComDeclaracao(xml: string) {
  const conteudo = String(xml ?? "").replace(/^\uFEFF/, "").trim();
  return conteudo.startsWith("<?xml") ? conteudo : `<?xml version="1.0" encoding="UTF-8"?>${conteudo}`;
}

async function uploadPackFiscalDocument(accessToken: string, packId: number, nfe: any) {
  const form = new FormData();
  const nome = `NFe${String(nfe.chave_acesso ?? nfe.numero ?? packId)}.xml`;
  form.append("fiscal_document", new Blob([xmlComDeclaracao(nfe.xml_autorizado)], { type: "application/xml" }), nome);
  const response = await fetch(`${ML_API_BASE_URL}/packs/${packId}/fiscal_documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    body: form,
    cache: "no-store",
  });
  return parseResponse(response, "anexar a NF-e ao pedido");
}

async function fetchPackFiscalDocuments(accessToken: string, packId: number, previous?: Record<string, unknown> | null) {
  const response = await fetch(`${ML_API_BASE_URL}/packs/${packId}/fiscal_documents`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await parseResponse(response, "consultar as notas do pedido");
  return {
    channel: "pack",
    pack_id: packId,
    ids: Array.isArray(previous?.ids) ? previous.ids : [],
    fiscal_documents: Array.isArray(body?.fiscal_documents) ? body.fiscal_documents : [],
  };
}

async function uploadInvoiceXml(accessToken: string, shipmentId: number, xml: string, siteId?: string | null) {
  const response = await fetch(`${ML_API_BASE_URL}/shipments/${shipmentId}/invoice_data/?siteId=${normalizeSiteId(siteId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/xml", Accept: "application/json" },
    body: xml,
    cache: "no-store",
  });
  return parseResponse(response, "enviar a NF-e");
}

async function fetchInvoiceData(accessToken: string, shipmentId: number, siteId?: string | null) {
  const response = await fetch(`${ML_API_BASE_URL}/shipments/${shipmentId}/invoice_data?siteId=${normalizeSiteId(siteId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  return parseResponse(response, "consultar a NF-e");
}

function normalizeSiteId(siteId?: string | null) {
  const value = String(siteId ?? "MLB").toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "MLB";
}

async function parseResponse(response: Response, operation: string) {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text ? { message: text } : {};
  }
  if (!response.ok) {
    const error = new Error(`Mercado Livre não conseguiu ${operation} (${response.status}): ${JSON.stringify(body)}`);
    (error as any).status = response.status;
    (error as any).body = body;
    throw error;
  }
  return body;
}

async function persistInvoiceState(orderId: number, nfe: any, remoteInvoice: any, error: string | null, sent: boolean) {
  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("mercadolivre_order")
    .update({
      nfe_id: nfe?.id ?? null,
      ml_invoice_id: extractInvoiceId(remoteInvoice),
      invoice_status: extractInvoiceStatus(remoteInvoice) || (sent ? "sent" : null),
      invoice_fiscal_key: nfe?.chave_acesso ?? extractFiscalKey(remoteInvoice),
      invoice_error: error,
      ...(sent ? { invoice_sent_at: now } : {}),
      invoice_updated_at: now,
      raw_invoice: remoteInvoice ?? {},
    })
    .eq("id", orderId);
  if (updateError) throw updateError;
}

function buildInvoiceState(order: StoredOrder, nfe: any, remoteInvoice: any) {
  const channel = resolveMercadoLivreInvoiceChannel(order);
  return {
    eligible: channel === "shipment" || channel === "pack",
    channel,
    orderId: order.id,
    vendaId: order.venda_id,
    shipmentId: order.ml_shipment_id,
    invoice: {
      id: extractInvoiceId(remoteInvoice) || order.ml_invoice_id,
      status: extractInvoiceStatus(remoteInvoice) || order.invoice_status,
      fiscalKey: nfe?.chave_acesso || extractFiscalKey(remoteInvoice) || order.invoice_fiscal_key,
      error: order.invoice_error,
      sentAt: order.invoice_sent_at,
      updatedAt: order.invoice_updated_at,
    },
    nfe: nfe
      ? { id: nfe.id, numero: nfe.numero, serie: nfe.serie, chaveAcesso: nfe.chave_acesso, ambiente: nfe.ambiente, status: nfe.status, autorizadaEm: nfe.dataautorizacao }
      : null,
  };
}

function extractInvoiceId(value: any) {
  if (value?.id != null) return String(value.id);
  if (value?.invoice_id != null) return String(value.invoice_id);
  const anexado = (Array.isArray(value?.ids) ? value.ids[0] : null) ?? (Array.isArray(value?.fiscal_documents) ? value.fiscal_documents[0]?.id : null);
  return anexado != null ? String(anexado) : null;
}

function extractInvoiceStatus(value: any) {
  if (value?.status != null) return String(value.status);
  if (value?.invoice_status != null) return String(value.invoice_status);
  // Anexo ao pedido não tem status no ML: existir já é o estado final.
  if (value?.channel === "pack") {
    const anexos = (Array.isArray(value.ids) ? value.ids.length : 0) + (Array.isArray(value.fiscal_documents) ? value.fiscal_documents.length : 0);
    return anexos > 0 ? "attached" : null;
  }
  return null;
}

function extractFiscalKey(value: any) {
  return value?.fiscal_key || value?.fiscalKey || value?.invoice_key || value?.key || null;
}

function isInvoiceNotFound(error: any) {
  return Number(error?.status) === 404;
}

function formatInvoiceError(error: any) {
  const raw = String(error?.body?.message || error?.body?.error || error?.message || "Falha ao enviar NF-e ao Mercado Livre.");
  return raw
    .replaceAll("wrong_receiver_cpf", "O CPF do destinatário da NF-e é diferente do comprador do pedido.")
    .replaceAll("wrong_receiver_cnpj", "O CNPJ do destinatário da NF-e é diferente do comprador do pedido.")
    .replaceAll("invalid_sender_cnpj", "O CNPJ do emitente da NF-e é diferente do vendedor do Mercado Livre.")
    .replaceAll("invoice_data_already_saved", "A NF-e deste envio já foi registrada no Mercado Livre.")
    .replaceAll("malformed_xml", "O XML da NF-e está malformado ou incompleto.")
    .replaceAll("invalid_invoice_type", "O XML informado não é uma NF-e modelo 55 válida.")
    .replaceAll("invalid_shipment", "O envio não aceita importação de NF-e neste estado.")
    .replaceAll("fiscal_key_already_exists", "Esta chave de acesso já foi utilizada em outro envio.")
    .replaceAll("invoice_key_already_exists", "Esta chave de acesso já foi utilizada em outro envio.");
}
