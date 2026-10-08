const assert = require('node:assert/strict');
require('tsx/cjs');
const {readJsonResponse} = require('../../src/lib/read-json-response.ts');
(async()=>{
  assert.deepEqual(await readJsonResponse(new Response('{"gatewayStatus":"REFUNDED"}')), {gatewayStatus:'REFUNDED'});
  assert.deepEqual(await readJsonResponse(new Response('{"error":"Não autorizado"}',{status:401})),{error:'Não autorizado'});
  await assert.rejects(readJsonResponse(new Response('<!DOCTYPE html><body>Private error</body>',{status:404}), 'Loja'), /Loja respondeu HTTP 404 sem JSON/);
  await assert.rejects(readJsonResponse(new Response('',{status:502})), /HTTP 502/);
  await assert.rejects(readJsonResponse(new Response('null')), /sem JSON/);
  console.log('PASS: JSON success/error, HTML 404, empty response and invalid shape.');
})().catch(e=>{console.error(e);process.exitCode=1});
