const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('tsx/cjs');
let calls = [], allowed = true, pending = [], stored = [];
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === '@/lib/integrations/site-pending-orders') return {fetchPendingSiteOrders:async()=>pending.map(row=>({...row}))};
  if (name === '@/lib/supabaseAdmin') return { supabaseAdmin: { from(table) {
    calls.push(['from', table]);
    let filters=[], bounds=null;
    const query = { then(resolve, reject) {
      let data=table==='site_order_link'?stored.filter(row=>filters.every(([method,key,value])=>method==='eq'?key==='empresa_id'||row[key]===value:method==='in'?value.includes(row[key]):true)):[];
      const count=data.length;if(bounds)data=data.slice(bounds[0],bounds[1]+1);
      return Promise.resolve({data,count,error:null}).then(resolve,reject);
    } };
    for (const method of ['select','eq','or','order','not','neq','is','like','range','in']) query[method] = (...params) => { calls.push([method, ...params]);filters.push([method,...params]);if(method==='range')bounds=params; return query; };
    return query;
  } } };
  if (name === '@/app/api/_authz/perms') return { requireVendasAccess: async () => { if (!allowed) throw Object.assign(Error('Forbidden'), {status:403}); } };
  if (name === '@/lib/empresa-context') return { requireEmpresaId: async () => 77, errorStatus: error => error.status || 500 };
  if (name === '@/lib/integrations/site-order-sync') return { syncSiteOrders: async () => ({}) };
  return original.call(this, name, ...args);
};
const { NextRequest } = require('next/server');
const { GET } = require(path.resolve('src/app/api/integracoes/site/orders/route.ts'));
async function call(params) { calls = []; return GET(new NextRequest(`http://localhost/api?${params}`)); }
(async () => {
  allowed = false; assert.equal((await call('')).status, 403); assert.equal(calls.length, 0); allowed = true;
  for (const params of ['page=NaN','page=1.5','limit=0','stage=unknown','search=abc','search=9007199254740992']) assert.equal((await call(params)).status, 400, params);
  assert.equal((await call('page=2&limit=20&stage=return-pending&search=29')).status, 200);
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'empresa_id' && x[2] === 77));
  assert.ok(calls.some(x => x[0] === 'eq' && x[1] === 'site_order_id' && x[2] === 29));
  const filter = calls.findIndex(x => x[0] === 'is' && x[1] === 'return_received_at');
  const range = calls.findIndex(x => x[0] === 'range');
  assert.ok(filter >= 0 && filter < range, 'Filter must precede pagination');
  assert.deepEqual(calls[range], ['range',20,39]);
  stored=[{id:1,site_order_id:10,order_created_at:'2026-10-22T10:00:00Z',site_status:'PAGO',raw_order:{},venda:null}];
  pending=[{id:-10,site_order_id:10,order_created_at:'2026-10-22T10:00:00Z',site_status:'AGUARDANDO_PAGAMENTO',checkout_pending:true,raw_order:{}},
    {id:-11,site_order_id:11,order_created_at:'2026-10-22T11:00:00Z',site_status:'AGUARDANDO_PAGAMENTO',checkout_pending:true,raw_order:{},nextAction:'Aguardar pagamento.'}];
  let result=await (await call('page=1&limit=10')).json();
  assert.equal(result.pagination.total,2,'Linked order must replace its checkout without duplication');
  assert.deepEqual(result.data.map(row=>row.site_order_id),[11,10]);
  assert.equal(result.data[0].nextAction,'Aguardar pagamento.');
  result=await (await call('stage=awaiting-payment')).json();
  assert.deepEqual(result.data.map(row=>row.site_order_id),[11]);
  result=await (await call('search=10')).json();
  assert.deepEqual(result.data.map(row=>row.site_order_id),[10]);
  result=await (await call('stage=refund-denied')).json();
  assert.ok(result.data.every(row=>!row.checkout_pending));
  console.log('PASS: unified pending orders, deduplication after import, chronology, search and payment filters.');
  console.log('PASS: order filters remain tenant-scoped, run before pagination, and reject invalid parameters.');
})().catch(error => { console.error(error); process.exitCode = 1; });
