const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('tsx/cjs');
process.env.ASAAS_WEBHOOK_TOKEN = 'isolated-test-token';
process.env.ERP_ORDER_WEBHOOK_URL = 'https://erp.test/webhook';
process.env.ERP_ORDER_SYNC_SECRET = 'isolated-secret';
let payment = { externalReference: '100', status: 'REFUNDED', billingType: 'PIX' };
let calls = [], reads = 0, deliveries = 0, duplicate = false, rpcError = null, remoteStatus = 200;
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === '@/lib/asaas') return { getAsaasPayment: async () => { reads++; return payment; } };
  if (name === '@/lib/supabase/admin') return { supabaseAdmin: { rpc: async (name, params) => {
    calls.push({ name, params }); return { data: duplicate ? 'DUPLICADO' : 'PROCESSADO', error: rpcError };
  } } };
  return original.call(this, name, ...args);
};
global.fetch = async () => { deliveries++; return Response.json({ error: 'simulated ERP failure' }, { status: remoteStatus }); };
const { POST } = require(path.resolve('site_demirdiesel/app/api/webhooks/asaas/route.ts'));
const event = { id: 'evt_test', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test', status: 'CONFIRMED' } };
const call = (payload = event, token = 'isolated-test-token') => POST(new Request('http://localhost/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': token }, body: JSON.stringify(payload),
}));
(async () => {
  assert.equal((await call(event, '')).status, 401);
  assert.equal((await call(event, 'wrong')).status, 401);
  assert.equal(reads, 0); assert.equal(calls.length, 0);
  assert.equal((await call({ id: 'incomplete' })).status, 400); assert.equal(reads, 0);
  assert.equal((await call()).status, 200);
  assert.equal(calls.at(-1).params.p_gateway_status, 'REFUNDED', 'late confirmed payload must use current provider status');
  assert.equal(calls.at(-1).params.p_novo_status, 'CANCELADO');
  duplicate = true; remoteStatus = 503;
  const failed = await call(); assert.equal(failed.status, 502);
  assert.equal((await failed.json()).erpStatus, 503);
  remoteStatus = 200; const retried = await call(); assert.equal(retried.status, 200);
  assert.equal((await retried.json()).result, 'DUPLICADO'); assert.equal(deliveries, 3, 'duplicate retries must redeliver to ERP');
  duplicate = false; payment = { ...payment, status: 'CHARGEBACK_REQUESTED' };
  assert.equal((await call()).status, 200); assert.equal(calls.at(-1).params.p_novo_status, 'PENDENTE');
  assert.equal(deliveries, 3, 'chargeback must not trigger ordinary paid/cancelled delivery');
  payment = { ...payment, status: 'RECEIVED', externalReference: 'not-an-order' };
  const before = calls.length; assert.equal((await call()).status, 200); assert.equal(calls.length, before);
  payment = { ...payment, externalReference: '100' }; rpcError = { message: 'simulated transaction failure' };
  assert.equal((await call()).status, 500); assert.equal(deliveries, 3);
  console.log('PASS: authentication, malformed events, current provider state, duplicate ERP retry, chargeback mapping, foreign reference and transaction failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
