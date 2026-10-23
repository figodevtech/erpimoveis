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
      let data=table==='site_order_link'?stored.filter(row=>filters.every(([method,key,value])=>method==='eq'?key==='empresa_id'||row[key]===value:method==='in'?value.includes(row[key]):method==='neq'?row[key]!==value:method==='or'&&key.includes('archivedTest')?row.raw_order?.archivedTest!==true:true)):[];
      const count=data.length;if(bounds)data=data.slice(bounds[0],bounds[1]+1);
      return Promise.resolve({data,count,error:null}).then(resolve,reject);
    } };
    for (const method of ['select','eq','or','order','not','neq','is','like','range','in','gte','lte','lt','ilike']) query[method] = (...params) => { calls.push([method, ...params]);filters.push([method,...params]);if(method==='range')bounds=params; return query; };
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
  for (const params of ['page=NaN','page=1.5','limit=0','stage=unknown','search=abc','search=9007199254740992','startDate=2026-02-30','startDate=2026-10-24&endDate=2026-10-23','minTotal=200&maxTotal=100','payment=INVALID','delivery=INVALID']) assert.equal((await call(params)).status, 400, params);
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
  pending=[];
  stored=[{id:8,site_order_id:8,site_status:'CANCELADO',raw_order:{archivedTest:true}},
    {id:9,site_order_id:9,site_status:'CANCELADO',raw_order:{archivedTest:true}},
    {id:10,site_order_id:10,site_status:'CANCELADO',refund_status:'REFUNDED',raw_order:{},venda:null}];
  for(const params of ['', 'stage=cancelled', 'search=10']){
    result=await (await call(params)).json();
    assert.deepEqual(result.data.map(row=>row.site_order_id),[10],'Refunded #10 remains visible; archived tests never reappear');
    assert.equal(result.pagination.total,1);
  }
  result=await (await call('stage=active')).json();assert.equal(result.data.length,0);
  result=await (await call('search=8')).json();assert.equal(result.data.length,0);
  result=await (await call('startDate=2026-10-01&endDate=2026-10-23&minTotal=10&maxTotal=500&payment=PIX&delivery=pickup')).json();
  for(const expected of [['gte','order_created_at','2026-10-01T03:00:00.000Z'],['lt','order_created_at','2026-10-24T03:00:00.000Z'],['gte','total_amount',10],['lte','total_amount',500],['ilike','raw_order->>paymentMethod','%pix%'],['eq','raw_order->shippingAddress->>deliveryMethod','pickup']]){
    const position=calls.findIndex(call=>JSON.stringify(call)===JSON.stringify(expected));
    assert.ok(position>=0&&position<calls.findIndex(call=>call[0]==='range'),'Advanced filters must run before pagination');
  }
  const {EMPTY_SITE_ORDER_FILTERS:empty,matchesSiteOrderFilters:matches,siteOrderFiltersError:validate}=require(path.resolve('src/lib/integrations/site-order-filters.ts'));
  const fixture={order_created_at:'2026-10-24T02:59:59Z',total_amount:115,paymentMethod:'PIX',raw_order:{shippingAddress:{deliveryMethod:'pickup'}}};
  assert.equal(matches(fixture,{...empty,endDate:'2026-10-23',minTotal:'100',maxTotal:'120',payment:'PIX',delivery:'pickup'}),true);
  assert.equal(matches({...fixture,order_created_at:'2026-10-24T03:00:00Z'},{...empty,endDate:'2026-10-23'}),false);
  assert.equal(matches(fixture,{...empty,payment:'BOLETO'}),false);
  assert.equal(matches(fixture,{...empty,delivery:'delivery'}),false);
  assert.ok(validate({...empty,startDate:'2026-02-30'}));
  console.log('PASS: advanced filters, date boundaries in Brazil, validation, pending checkouts and SQL pagination.');
  console.log('PASS: test exclusions and refunded orders in all/cancelled/search filters, including orders without an ERP sale.');
  console.log('PASS: unified pending orders, deduplication after import, chronology, search and payment filters.');
  console.log('PASS: order filters remain tenant-scoped, run before pagination, and reject invalid parameters.');
})().catch(error => { console.error(error); process.exitCode = 1; });
