import fs from 'node:fs';
import path from 'node:path';

const files=['lib/melhor-envio-oauth.ts','app/api/integrations/melhor-envio/connect/route.ts','app/api/integrations/melhor-envio/authorize/route.ts','app/api/integrations/melhor-envio/callback/route.ts','app/integracoes/melhor-envio/page.tsx','supabase/migrations/20261028160000_shipping_oauth.sql','components/product/ProductPaymentTerms.tsx','lib/asaas-fees.ts','lib/shipping-quote.ts','app/api/shipping/quote/route.ts','lib/asaas.ts','lib/checkout-card.ts','lib/payment-methods.ts','lib/checkout-policy.ts','lib/erp-checkout-policy.ts','lib/save-checkout-card.ts','app/api/checkout/options/route.ts','components/product/CheckoutTerms.tsx','components/product/CheckoutCardFields.tsx','components/product/ShippingSimulator.tsx','lib/erp-checkout.ts','lib/stock-client.ts','lib/checkout-attempt.ts','lib/checkout-attempt-client.ts','lib/checkout-reconcile.ts','lib/checkout-pending-status.ts','app/api/stock/route.ts','app/api/checkout/attempt/route.ts','app/api/integrations/erp/checkout/reconcile/route.ts','supabase/migrations/20261021211000_checkout_attempts.sql','supabase/migrations/20261021212000_checkout_event_retry.sql','supabase/migrations/20261021213000_checkout_cutover_guard.sql','supabase/migrations/20261022090000_checkout_order_after_payment.sql'];
const arguments_=process.argv.slice(2);
const requested=arguments_.filter(value=>value!=='--core-only');
const sites=requested.length?requested:['site_brpecaspb','site_demirdiesel'];
for (const site of sites) {
  if(!/^site_[a-zA-Z0-9_-]+$/.test(site)||!fs.existsSync(site))throw new Error('Informe uma pasta site_* existente na raiz do projeto.');
  for (const file of files) {
    fs.mkdirSync(path.dirname(`${site}/${file}`),{recursive:true});
    fs.copyFileSync(`storefront-template/${file}`,`${site}/${file}`);
  }
  if(arguments_.includes('--core-only'))continue;
  const file=`${site}/app/api/checkout/route.ts`;
  let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  if(source.includes('attemptIdentity')) continue;
  function replace(from,to) {if(!source.includes(from)) throw new Error(`Missing anchor ${site}: ${from.slice(0,70)}`);source=source.replace(from,to);}
  source=`import { attemptIdentity, resumeCheckout, bindCheckoutPayment, checkoutFailed } from '@/lib/checkout-attempt';\nimport { erpCheckout, InventoryError } from '@/lib/erp-checkout';\n${source}`;
  replace('    const uniqueProductIds = Array.from(consolidatedMap.keys());',`    const identity = attemptIdentity(body.checkoutAttemptId, Number(cliente.id), addressId, deliveryMethod, billingType, savedCardId, consolidatedMap);
    const resumed = await resumeCheckout(identity.attempt, Number(cliente.id), identity.hash);
    if (resumed) return resumed;

    const uniqueProductIds = Array.from(consolidatedMap.keys());`);
  replace('const { data: orderId, error: rpcError } = await supabaseAdmin.rpc("fn_criar_pedido_site", {', 'const { data: attemptResult, error: rpcError } = await supabaseAdmin.rpc("fn_start_checkout", {');
  replace('      p_cliente_id: cliente.id,\n      p_endereco_snapshot: enderecoSnapshot,\n      p_itens: orderItemsPayload,',`      p_attempt: identity.attempt,
      p_cliente: cliente.id,
      p_hash: identity.hash,
      p_billing: billingType,
      p_address: enderecoSnapshot,
      p_items: orderItemsPayload,`);
  replace('      p_canal: "ONLINE",\n      p_forma_pagamento: paymentMethodLabel,','      p_method: paymentMethodLabel,');
  replace('    if (rpcError || !orderId) {','    const orderId = Number(attemptResult?.orderId);\n    if (rpcError || !orderId) {');
  replace('    // 8. CRIA',`    if (!attemptResult.started) {
      const existing = await resumeCheckout(identity.attempt, Number(cliente.id), identity.hash);
      if (existing) return existing;
      throw new Error('Não foi possível retomar o pedido. Consulte seus pedidos.');
    }

    // 8. CRIA`);
  replace('    try {\n      const externalCustomerReference',`    try {
      await erpCheckout({action:'reserve',orderId,items:validatedItems.map(item=>({productId:item.id,quantity:item.quantity,unitPrice:item.unitPrice}))});
      const externalCustomerReference`);
  replace('      const payment = await createAsaasPayment(paymentPayload);',`      if (billingType === 'BOLETO') paymentPayload.daysAfterDueDateToRegistrationCancellation = 0;
      const { error: sendingError } = await supabaseAdmin.rpc('fn_checkout_sending', {p_order:orderId,p_customer:asaasCustomerId});
      if (sendingError) throw sendingError;
      // Never retry this POST blindly: an HTTP timeout does not prove failure.
      const payment = await createAsaasPayment(paymentPayload);
      await bindCheckoutPayment(orderId,payment);`);
  const gateway=`          payment_provider: "ASAAS",
          gateway_payment_id: payment.id,
          gateway_checkout_url: payment.invoiceUrl || null,
          gateway_status: payment.status || "PENDING",
          gateway_due_date: payment.dueDate || null,
`;
  replace(gateway,'');
  replace('    } catch (paymentError) {',`    } catch (paymentError) {
      let retryable = false;
      try { retryable = await checkoutFailed(orderId, paymentError instanceof AsaasApiError && [400,422].includes(paymentError.status)); }
      catch { console.error('[checkout] Conciliação de estoque pendente', {orderId}); }
      if (paymentError instanceof InventoryError) return NextResponse.json({error:'DISPONIBILIDADE',message:paymentError.message,orderId,retryable},{status:paymentError.status});`);
  replace('          error: "ERRO_ASAAS",\n          message,','          error: "ERRO_ASAAS",\n          retryable,\n          message,');
  fs.writeFileSync(file,source);
  const pageFile=`${site}/app/checkout/page.tsx`;
  let page=fs.readFileSync(pageFile,'utf8').replace(/\r\n/g,'\n');
  const useClient=/^(["']use client["'];?\n)/;
  page=page.replace(useClient,`$1\nimport {checkoutAttempt,forgetCheckoutAttempt} from '@/lib/checkout-attempt-client';\n`);
  page=page.replace('body: JSON.stringify(checkoutData),',`body: JSON.stringify({...checkoutData,checkoutAttemptId:checkoutAttempt(sessionData?.session?.user?.id || 'anonymous',checkoutData)}),`);
  page=page.replace('      if (!response.ok) {\n',`      if (!response.ok) {
        if (result.retryable) forgetCheckoutAttempt(sessionData?.session?.user?.id || 'anonymous');
`);
  fs.writeFileSync(pageFile,page);
  const ordersFile=`${site}/app/api/integrations/erp/orders/route.ts`;
  let orders=fs.readFileSync(ordersFile,'utf8');
  orders=orders.replace('  status: string;','  status: string;\n  central_inventory?: boolean;');
  orders=orders.replace('id, status, sub_total, valortotal, forma_pagamento, endereco_entrega_snapshot,','id, status, central_inventory, sub_total, valortotal, forma_pagamento, endereco_entrega_snapshot,');
  orders=orders.replace('    status: order.status,','    status: order.status,\n    centralInventory: Boolean(order.central_inventory),');
  fs.writeFileSync(ordersFile,orders);
}
