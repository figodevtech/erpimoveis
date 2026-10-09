const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('tsx/cjs');
let calls = [], allowed = true;
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === '@/lib/supabaseAdmin') return { supabaseAdmin: { from(table) {
    calls.push(['from', table]);
    const query = { then(resolve, reject) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject); } };
    for (const method of ['select','eq','or','order','not','neq','is','like','range']) query[method] = (...params) => { calls.push([method, ...params]); return query; };
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
  console.log('PASS: order filters remain tenant-scoped, run before pagination, and reject invalid parameters.');
})().catch(error => { console.error(error); process.exitCode = 1; });
