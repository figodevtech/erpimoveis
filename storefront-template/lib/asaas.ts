import "server-only";

const rawApiKey = process.env.ASAAS_API_KEY || "";
const apiKey = rawApiKey.trim().replace(/^["']|["']$/g, "");
const environment = (process.env.ASAAS_ENVIRONMENT || "sandbox").trim().toLowerCase();
const configuredApiUrl = (process.env.ASAAS_API_URL || "").trim().replace(/\/+$/, "");

export const asaasApiUrl =
  configuredApiUrl ||
  (environment === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3");

export interface AsaasCustomer {
  id: string;
  name?: string;
  cpfCnpj?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
}

export interface AsaasPayment {
  installment?: string;
  installmentGroupDeleted?: boolean;
  installmentNumber?: number;
  creditCard?: { creditCardToken?: string; creditCardBrand?: string; creditCardNumber?: string };
  deleted?: boolean;
  refunds?: Array<{ status?: string }> | null;
  id: string;
  customer?: string;
  billingType?: string;
  status?: string;
  value?: number;
  netValue?: number;
  dueDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  externalReference?: string;
}

export interface AsaasCardToken {
  creditCardToken: string;
  creditCardNumber?: string;
  creditCardBrand?: string;
}

interface AsaasList<T> {
  data?: T[];
}

export class AsaasApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AsaasApiError";
  }
}

export function assertAsaasConfigured() {
  if (!apiKey) {
    throw new AsaasApiError("ASAAS_API_KEY não configurada no servidor.", 500);
  }
}

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Erro não identificado no Asaas.";

  const record = payload as Record<string, unknown>;
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const messages = errors
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      return String((item as Record<string, unknown>).description || "").trim();
    })
    .filter(Boolean);

  return messages.join(" ") || String(record.message || "Erro não identificado no Asaas.");
}

export async function asaasRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertAsaasConfigured();

  const response = await fetch(`${asaasApiUrl}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(30_000),
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "StorefrontERP/1.0",
      access_token: apiKey,
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: "Resposta inválida recebida do Asaas." };
  }

  if (!response.ok) {
    throw new AsaasApiError(extractErrorMessage(payload), response.status, payload);
  }

  return payload as T;
}

export async function findAsaasCustomer(cpfCnpj: string, externalReference: string) {
  const query = new URLSearchParams({ cpfCnpj, externalReference, limit: "1" });
  const result = await asaasRequest<AsaasList<AsaasCustomer>>(`/customers?${query.toString()}`);
  if (result.data?.[0]) return result.data[0];

  const fallback = new URLSearchParams({ cpfCnpj, limit: "1" });
  const byDocument = await asaasRequest<AsaasList<AsaasCustomer>>(
    `/customers?${fallback.toString()}`
  );
  return byDocument.data?.[0] || null;
}

export async function createAsaasCustomer(payload: Record<string, unknown>) {
  return asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({ ...payload, notificationDisabled: true }),
  });
}

export async function disableAsaasCustomerNotifications(customerId: string) {
  return asaasRequest<AsaasCustomer>(`/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify({ notificationDisabled: true }),
  });
}

export async function createAsaasPayment(payload: Record<string, unknown>) {
  const payment = await asaasRequest<AsaasPayment>("/payments", {
    signal: AbortSignal.timeout(90_000),
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeInstallmentPayment(payment);
}

export async function tokenizeAsaasCreditCard(payload: Record<string, unknown>) {
  return asaasRequest<AsaasCardToken>("/creditCard/tokenizeCreditCard", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function normalizeInstallmentPayment(payment:AsaasPayment):Promise<AsaasPayment> {
  if(!payment.installment)return payment.billingType==='DEBIT_CARD'?{...payment,billingType:'CREDIT_CARD'}:payment;
  let group:AsaasList<AsaasPayment>&{hasMore?:boolean};
  try{group=await asaasRequest<AsaasList<AsaasPayment>&{hasMore?:boolean}>(`/installments/${encodeURIComponent(payment.installment)}/payments?limit=100`);}
  catch(error){if(payment.deleted&&error instanceof AsaasApiError&&error.status===404)return {...payment,installmentGroupDeleted:true};throw error;}
  const rows=group.data||[];
  if(group.hasMore||rows.length<2||rows.length>21||rows.some(p=>p.installment!==payment.installment||p.customer!==payment.customer||p.externalReference!==payment.externalReference||p.billingType!=='CREDIT_CARD'||!Number.isFinite(p.value)||Number(p.value)<=0))throw new Error('Parcelamento inconsistente; aguarde a conciliacao.');
  const first=rows.find(p=>p.installmentNumber===1);
  if(!first)throw new Error('Primeira parcela nao encontrada.');
  const total=rows.reduce((sum,p)=>sum+Math.round(Number(p.value)*100),0)/100;
  const refunded=rows.filter(p=>p.status==='REFUNDED').length;
  const status=refunded===rows.length?'REFUNDED':refunded>0?'PARTIALLY_REFUNDED':first.status;
  return {...first,value:total,status,creditCard:payment.creditCard||first.creditCard};
}
export async function getAsaasPayment(paymentId: string) {
  return normalizeInstallmentPayment(await asaasRequest<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`));
}
export async function cancelAsaasPayment(payment:AsaasPayment){
  const resource=payment.installment?`/installments/${encodeURIComponent(payment.installment)}`:`/payments/${encodeURIComponent(payment.id)}`;
  const removed=await asaasRequest<{deleted?:boolean}>(resource,{method:'DELETE',signal:AbortSignal.timeout(60_000)});
  if(!removed.deleted)throw new Error('Cancelamento nao confirmado.');
  const latest=await asaasRequest<AsaasPayment>(`/payments/${encodeURIComponent(payment.id)}`);
  if(!latest.deleted||['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(latest.status||''))throw new Error('Cancelamento inconclusivo.');
  return {...payment,deleted:true,status:latest.status};
}
export async function refundAsaasPayment(paymentId: string, description: string) {
  const payment=await getAsaasPayment(paymentId);
  if(payment.installment){
    await asaasRequest(`/installments/${encodeURIComponent(payment.installment)}/refund`,{method:'POST',body:JSON.stringify({}),signal:AbortSignal.timeout(60_000)});
    return getAsaasPayment(payment.id);
  }
  return asaasRequest<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(60_000),
  });
}

export async function refundAsaasBankSlip(paymentId: string) {
  return asaasRequest<{ requestUrl: string }>(`/payments/${encodeURIComponent(paymentId)}/bankSlip/refund`, {
    method: "POST", body: JSON.stringify({}), signal: AbortSignal.timeout(60_000),
  });
}

export async function getAsaasPixQrCode(paymentId: string) {
  return asaasRequest<{ encodedImage: string; payload: string; expirationDate: string }>(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, { signal: AbortSignal.timeout(15_000) });
}
export async function getAsaasBoletoLine(paymentId: string) {
  return asaasRequest<{ identificationField: string }>(`/payments/${encodeURIComponent(paymentId)}/identificationField`, { signal: AbortSignal.timeout(15_000) });
}
