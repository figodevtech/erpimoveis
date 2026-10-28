import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),{NextRequest}=require('next/server');
const env={MELHOR_ENVIO_ENVIRONMENT:'production',MELHOR_ENVIO_CLIENT_ID:'123',MELHOR_ENVIO_CLIENT_SECRET:'test-client-secret',NEXT_PUBLIC_SITE_URL:'https://own-store.test',NEXT_PUBLIC_COMPANY_EMAIL:'test@example.test',ERP_ORDER_SYNC_SECRET:'own-secret'};
function load(file,{admin,fetchMock,environment=env,mocks={}}={}){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(`storefront-template/${file}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,Buffer,URL,URLSearchParams,AbortSignal,Request,Response,Date,process:{env:environment},fetch:fetchMock,require(name){
  if(name in mocks)return mocks[name];if(name==='server-only')return {};
  if(name==='@/lib/supabase/admin')return {supabaseAdmin:admin};
  if(name==='@/lib/melhor-envio-oauth')return load('lib/melhor-envio-oauth.ts',{admin,fetchMock,environment});
  return require(name);
 }});return exports;
}
function memory(initial={}){
 const tables={store_shipping_connection:[],store_shipping_oauth_state:[],...structuredClone(initial)},writes=[];
 return {tables,writes,from(table){
  let operation='select',value,returning=false;const filters=[];
  const query={select(){returning=true;return this;},eq(key,expected){filters.push(row=>row[key]===expected);return this;},gt(key,expected){filters.push(row=>row[key]>expected);return this;},lt(key,expected){filters.push(row=>row[key]<expected);return this;},or(){filters.push(row=>!row.refresh_lock_until||Date.parse(row.refresh_lock_until)<Date.now());return this;},update(payload){operation='update';value=payload;return this;},insert(payload){operation='insert';value=payload;return this;},upsert(payload){operation='upsert';value=payload;return this;},delete(){operation='delete';return this;},async maybeSingle(){const result=execute();return {...result,data:result.data?.[0]||null};},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
  function execute(){
   let rows=tables[table].filter(row=>filters.every(filter=>filter(row)));
   if(operation!=='select')writes.push({table,operation,value:structuredClone(value),count:rows.length});
   if(operation==='update')rows.forEach(row=>Object.assign(row,value));
   if(operation==='delete')tables[table]=tables[table].filter(row=>!rows.includes(row));
   if(operation==='insert'){tables[table].push({...value,started:value.started??false});rows=[value];}
   if(operation==='upsert'){const found=tables[table].find(row=>row.environment===value.environment);if(found)Object.assign(found,value);else tables[table].push({...value});rows=[value];}
   return {data:operation==='select'||returning?structuredClone(rows):null,error:null};
  }
  return query;
 }};
}
const tokenResponse=()=>Response.json({token_type:'Bearer',access_token:'access-private',refresh_token:'refresh-private',expires_in:2592000,scope:'shipping-calculate'});

test('shipping tokens are encrypted and bound to store, client and environment',()=>{
 const client=load('lib/melhor-envio-oauth.ts');const sealed=client.sealShippingTokens({access_token:'access-private',refresh_token:'refresh-private'});
 assert.equal(sealed.includes('private'),false);assert.equal(client.openShippingTokens(sealed).access_token,'access-private');
 for(const patch of [{MELHOR_ENVIO_ENVIRONMENT:'sandbox'},{NEXT_PUBLIC_SITE_URL:'https://another-store.test'},{MELHOR_ENVIO_CLIENT_SECRET:'rotated'}])assert.throws(()=>load('lib/melhor-envio-oauth.ts',{environment:{...env,...patch}}).openShippingTokens(sealed));
});
test('only the ERP secret can initiate connection or read connection status',async()=>{
 const admin=memory(),route=load('app/api/integrations/melhor-envio/connect/route.ts',{admin});
 assert.equal((await route.POST(new Request('https://own-store.test/connect',{method:'POST'}))).status,401);assert.equal(admin.writes.length,0);
 const started=await route.POST(new Request('https://own-store.test/connect',{method:'POST',headers:{Authorization:'Bearer own-secret'}}));
 const {url}=await started.json();assert.equal(new URL(url).pathname,'/api/integrations/melhor-envio/authorize');
 assert.equal(admin.tables.store_shipping_oauth_state.length,1);assert.equal(admin.tables.store_shipping_oauth_state[0].state_hash.includes(new URL(url).searchParams.get('state')),false);
});
test('authorization sets browser binding and a callback consumes state only once',async()=>{
 const admin=memory();let exchanges=0;
 const fetchMock=async(url,init)=>{exchanges++;assert.equal(url,'https://melhorenvio.com.br/oauth/token');const body=JSON.parse(init.body);assert.equal(body.grant_type,'authorization_code');assert.equal(body.redirect_uri,'https://own-store.test/api/integrations/melhor-envio/callback');return tokenResponse();};
 const auth=load('lib/melhor-envio-oauth.ts',{admin,fetchMock}),url=await auth.createShippingAuthorization(),state=new URL(url).searchParams.get('state');
 const start=load('app/api/integrations/melhor-envio/authorize/route.ts',{admin,fetchMock});
 const redirect=await start.GET(new Request(url));assert.equal(redirect.status,302);assert.match(redirect.headers.get('set-cookie'),/HttpOnly/);assert.match(redirect.headers.get('set-cookie'),/Secure/);
 const provider=new URL(redirect.headers.get('location'));assert.equal(provider.searchParams.get('scope'),'shipping-calculate');assert.equal(provider.searchParams.get('state'),state);
 assert.equal((await start.GET(new Request(url))).status,400);
 const callback=load('app/api/integrations/melhor-envio/callback/route.ts',{admin,fetchMock});
 const request=cookie=>new NextRequest(`https://own-store.test/api/integrations/melhor-envio/callback?state=${state}&code=code-private`,{headers:cookie?{cookie:`me_oauth_state=${cookie}`}:{}});
 const invalid=await callback.GET(request('x'.repeat(43)));assert.match(invalid.headers.get('location'),/status=invalid/);assert.equal(exchanges,0);
 const success=await callback.GET(request(state));assert.match(success.headers.get('location'),/status=connected/);assert.equal(exchanges,1);
 const saved=admin.tables.store_shipping_connection[0];assert.equal(auth.openShippingTokens(saved.encrypted_tokens).refresh_token,'refresh-private');assert.equal(JSON.stringify(saved).includes('access-private'),false);
 const duplicate=await callback.GET(request(state));assert.match(duplicate.headers.get('location'),/status=invalid/);assert.equal(exchanges,1);
});
test('denied or expired authorizations never replace the current connection',async()=>{
 const admin=memory(),auth=load('lib/melhor-envio-oauth.ts',{admin});const url=await auth.createShippingAuthorization(),state=new URL(url).searchParams.get('state');
 admin.tables.store_shipping_oauth_state[0].started=true;
 const callback=load('app/api/integrations/melhor-envio/callback/route.ts',{admin,fetchMock:()=>{throw Error('Unexpected token request');}});
 const denied=await callback.GET(new NextRequest(`https://own-store.test/callback?state=${state}&error=access_denied`,{headers:{cookie:`me_oauth_state=${state}`}}));assert.match(denied.headers.get('location'),/status=denied/);assert.equal(admin.tables.store_shipping_connection.length,0);
 const nextUrl=await auth.createShippingAuthorization();admin.tables.store_shipping_oauth_state[0].expires_at='2000-01-01T00:00:00.000Z';
 const start=load('app/api/integrations/melhor-envio/authorize/route.ts',{admin});assert.equal((await start.GET(new Request(nextUrl))).status,400);
});
test('refresh token rotation is serialized and ambiguous failures require reconnection',async()=>{
 for(const failure of [false,true]){
  const admin=memory();let exchanges=0;
  const auth=load('lib/melhor-envio-oauth.ts',{admin,fetchMock:async(_url,init)=>{exchanges++;assert.equal(JSON.parse(init.body).grant_type,'refresh_token');if(failure)throw Error('timeout');return tokenResponse();}});
  admin.tables.store_shipping_connection.push({environment:'production',client_id:'123',encrypted_tokens:auth.sealShippingTokens({access_token:'old-access',refresh_token:'old-refresh'}),expires_at:new Date(Date.now()-1000).toISOString(),revision:'revision-old',refresh_lock_until:null,requires_reconnect:false});
  const row=admin.tables.store_shipping_connection[0];row.refresh_lock_until=new Date(Date.now()+60000).toISOString();
  await assert.rejects(()=>auth.shippingAccessToken(),/sendo atualizada/);assert.equal(exchanges,0);row.refresh_lock_until=null;
  if(failure){await assert.rejects(()=>auth.shippingAccessToken(),/refeita/);assert.equal(row.requires_reconnect,true);await assert.rejects(()=>auth.shippingAccessToken());assert.equal(exchanges,1);}
  else{const result=await auth.shippingAccessToken();assert.equal(result.token,'access-private');assert.notEqual(row.revision,'revision-old');assert.equal(row.refresh_lock_until,null);assert.equal(auth.openShippingTokens(row.encrypted_tokens).refresh_token,'refresh-private');}
 }
});
