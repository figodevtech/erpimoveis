import 'server-only';

export class InventoryError extends Error {
  constructor(message:string,public readonly status=503) { super(message); }
}
export async function erpCheckout(body:Record<string,unknown>) {
  const webhook=process.env.ERP_ORDER_WEBHOOK_URL?.trim();
  const secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
  if (!webhook || !secret) throw new InventoryError('Não foi possível consultar o estoque. A loja está temporariamente indisponível.');
  const base=new URL(webhook);
  if (base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw new InventoryError('Integração de estoque indisponível.');
  try {
    const response=await fetch(new URL('/api/integracoes/site/checkout',base),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15_000)});
    const result=await response.json();
    if (!response.ok) throw new InventoryError(result.message || 'Não foi possível confirmar o estoque agora.',response.status===409?409:503);
    return result.data;
  } catch(error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError('Não foi possível confirmar o estoque agora. Tente novamente em instantes.');
  }
}
