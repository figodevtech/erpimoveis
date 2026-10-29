import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, { env = {}, sync, company = async () => 1, now = Date.now } = {}) {
 const exports = {};
 const code = ts.transpileModule(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { exports, Buffer, Date: { now }, console: { info() {}, error() {} }, process: { env }, require(name) {
  if(name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  if(name === '@/lib/empresa-context') return { requireEmpresaId: company };
  if(name === '@/lib/integrations/storefront-catalog-run') return { runStorefrontCatalog: sync };
  if(name === '@/lib/integrations/storefront-catalog') return { syncStorefrontCatalog: sync };
  return require(name);
 } });
 return exports;
}
const routeFile = 'src/app/api/integracoes/site/cron/route.ts';
const runFile = 'src/lib/integrations/storefront-catalog-run.ts';
const configured = { CRON_SECRET: 'cron-test', STOREFRONT_API_URL: 'https://store.test', STOREFRONT_CATALOG_SYNC_SECRET: 'catalog-test' };
const request = token => new Request('https://erp.test/api/integracoes/site/cron', { headers: token ? { authorization: token } : {} });
test('cron rejects absent configuration and invalid authentication before database access', async () => {
 const company = () => { throw Error('Unexpected database access'); };
 assert.equal((await load(routeFile, { company }).GET(request())).status, 503);
 for(const token of ['', 'Bearer wrong', 'Bearer catalog-test']) {
  assert.equal((await load(routeFile, { env: configured, company }).GET(request(token))).status, 401);
 }
});
test('installations without a store skip without accessing the database', async () => {
 const response = await load(routeFile, { env: { CRON_SECRET: 'cron-test' }, company: () => { throw Error('Unexpected database'); } }).GET(request('Bearer cron-test'));
 assert.equal(response.status, 200);
 assert.equal((await response.json()).skipped, true);
});
test('cron resolves the single tenant and runs bounded batches', async () => {
 let called = false;
 const response = await load(routeFile, { env: configured, company: async () => 7, sync: async (id, options) => {
  assert.equal(id, 7); assert.equal(options.maxBatches, 3); assert.equal(options.budgetMs, 20000); called = true;
  return { processed: 4, products: 4, categories: 2, drained: true };
 } }).GET(request('Bearer cron-test'));
 assert.equal(response.status, 200); assert.equal(called, true); assert.equal((await response.json()).products, 4);
});
test('cron refuses ambiguous tenants and returns failures for retry without leaking details', async () => {
 for(const failure of ['company', 'sync']) {
  const response = await load(routeFile, { env: configured, company: async () => { if(failure === 'company') throw Error('private detail'); return 1; }, sync: async () => { throw Error('private detail'); } }).GET(request('Bearer cron-test'));
  assert.equal(response.status, 500); assert.equal(JSON.stringify(await response.json()).includes('private detail'), false);
 }
});
test('runner drains new products and images in multiple batches then stops on empty queue', async () => {
 let calls = 0;
 const { runStorefrontCatalog } = load(runFile, { sync: async id => {
  assert.equal(id, 1); calls++;
  return { processed: calls < 3 ? 100 : 0, products: calls < 3 ? 100 : 0, categories: 4 };
 } });
 const result = await runStorefrontCatalog(1);
 assert.equal(calls, 3); assert.equal(result.processed, 200); assert.equal(result.categories, 4); assert.equal(result.drained, true);
});
test('runner respects batch/time limits, leaving the rest for the next cron', async () => {
 let calls = 0;
 let time = 0;
 const { runStorefrontCatalog } = load(runFile, { now: () => time, sync: async () => { calls++; time += 15000; return { processed: 100, products: 100, categories: 1 }; } });
 const result = await runStorefrontCatalog(1, { maxBatches: 3, budgetMs: 20000 });
 assert.equal(calls, 2); assert.equal(result.drained, false);
 calls = 0; time = 0;
 await runStorefrontCatalog(1, { maxBatches: 1 }); assert.equal(calls, 1);
});
test('runner propagates failures without a tight retry loop', async () => {
 let calls = 0;
 const { runStorefrontCatalog } = load(runFile, { sync: async () => { calls++; throw Error('offline'); } });
 await assert.rejects(runStorefrontCatalog(1), /offline/); assert.equal(calls, 1);
});
