import { performanceBaseURL, preparePerformanceSession } from './navigation.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext({storageState:'playwright/.auth/performance-user.json'});
 await preparePerformanceSession(context, baseURL);
 for(const query of ['limit=20', 'limit=20&status=FINALIZADA', 'limit=20&search=teste', 'limit=1&page=2']) {
  const full=await context.request.get((baseURL + '/api/venda?')+query);
  const lean=await context.request.get((baseURL + '/api/venda?view=historico&')+query);
  console.log('Cenario',query || 'padrao','status',full.status(),lean.status());
  assert.equal(full.status(),200); assert.equal(lean.status(),200);
  const a=await full.json(), b=await lean.json();
  if (query === "limit=20") console.log(JSON.stringify({fullBytes:Buffer.byteLength(JSON.stringify(a)),summaryBytes:Buffer.byteLength(JSON.stringify(b))}));
  assert.ok(isDeepStrictEqual(b.filters,a.filters), "Filtros divergentes");
  assert.ok(isDeepStrictEqual(b.pagination,a.pagination), "Paginacao divergente");
  assert.ok(isDeepStrictEqual(b.data,a.data.map(v=>({id:v.id,clienteid:v.clienteid,cliente:v.cliente ? {id:v.cliente.id,nomerazaosocial:v.cliente.nomerazaosocial,telefone:v.cliente.telefone}:null,status:v.status,valortotal:v.valortotal,datavenda:v.datavenda,canal:v.canal,status_entrega:v.status_entrega}))), "Dados resumidos divergentes");
 }
 console.log('PASS: resumo equivalente em 4 consultas (padrao, status, busca e pagina), sem gravacoes');
} finally {await browser.close();}
