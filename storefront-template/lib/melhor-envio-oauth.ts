import 'server-only';
import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

export class ShippingAuthError extends Error {}
export function shippingEnvironment(){
 const environment=process.env.MELHOR_ENVIO_ENVIRONMENT?.trim();
 if(environment!=='sandbox'&&environment!=='production')throw new ShippingAuthError('Configure MELHOR_ENVIO_ENVIRONMENT como production ou sandbox no servidor da loja.');
 return environment;
}
export function shippingProviderBase(environment:string){return environment==='production'?'https://melhorenvio.com.br':'https://sandbox.melhorenvio.com.br';}
export function oauthConfig(){
 const environment=shippingEnvironment(),clientId=process.env.MELHOR_ENVIO_CLIENT_ID?.trim(),clientSecret=process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim();
 if(!clientId||!/^\d{1,40}$/.test(clientId)||!clientSecret)throw new ShippingAuthError('Preencha MELHOR_ENVIO_CLIENT_ID e MELHOR_ENVIO_CLIENT_SECRET no servidor da loja.');
 const origin=new URL(process.env.NEXT_PUBLIC_SITE_URL||process.env.NEXT_PUBLIC_APP_URL||'');
 if(origin.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(origin.hostname)))throw new ShippingAuthError('Configure a URL oficial HTTPS da loja.');
 const callback=new URL('/api/integrations/melhor-envio/callback',origin).toString();
 const email=process.env.NEXT_PUBLIC_COMPANY_EMAIL?.trim();
 if(!email||!email.includes('@'))throw new ShippingAuthError('Preencha o e-mail de contato da empresa na configuração da loja.');
 return {environment,clientId,clientSecret,callback,origin:origin.origin,userAgent:`StorefrontERP (${email})`};
}
export function shippingAuthorized(request:Request){
 const secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
 const expected=`Bearer ${secret||''}`,received=request.headers.get('authorization')||'';
 return Boolean(secret&&Buffer.byteLength(expected)===Buffer.byteLength(received)&&timingSafeEqual(Buffer.from(expected),Buffer.from(received)));
}
export const stateHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const validState=(value:string)=>/^[A-Za-z0-9_-]{43}$/.test(value);
type Tokens={access_token:string;refresh_token:string};
function encryptionKey(config:ReturnType<typeof oauthConfig>){return createHash('sha256').update('store-shipping-oauth-v1\0'+config.clientSecret).digest();}
export function sealShippingTokens(tokens:Tokens){
 const config=oauthConfig(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(config),iv);
 cipher.setAAD(Buffer.from(`${config.origin}|${config.environment}|${config.clientId}`));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(tokens),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function openShippingTokens(value:string):Tokens{
 try{
  const config=oauthConfig(),[version,iv,tag,encrypted]=value.split('.');
  if(version!=='v1')throw Error();
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(config),Buffer.from(iv,'base64url'));
  decipher.setAAD(Buffer.from(`${config.origin}|${config.environment}|${config.clientId}`));decipher.setAuthTag(Buffer.from(tag,'base64url'));
  const tokens=JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8'));
  if(typeof tokens.access_token!=='string'||!tokens.access_token||typeof tokens.refresh_token!=='string'||!tokens.refresh_token)throw Error();
  return tokens;
 }catch{throw new ShippingAuthError('Reconecte o Melhor Envio para atualizar as credenciais da loja.');}
}
export async function exchangeShippingTokens(grant:{code:string}|{refresh_token:string}){
 const config=oauthConfig();
 let response:Response;
 try{response=await fetch(`${shippingProviderBase(config.environment)}/oauth/token`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':config.userAgent},body:JSON.stringify({grant_type:'code' in grant?'authorization_code':'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.callback,...grant})});}
 catch{throw new ShippingAuthError('Não foi possível confirmar a autorização. Conecte novamente o Melhor Envio.');}
 const body=await response.json().catch(()=>null);
 if(!response.ok||!body||body.token_type?.toLowerCase()!=='bearer'||typeof body.access_token!=='string'||!body.access_token||typeof body.refresh_token!=='string'||!body.refresh_token||!Number.isFinite(body.expires_in)||body.expires_in<60||body.expires_in>60*60*24*60)throw new ShippingAuthError('O Melhor Envio não concluiu a autorização. Confira o aplicativo e conecte novamente.');
 if(typeof body.scope==='string'&&!body.scope.split(' ').includes('shipping-calculate'))throw new ShippingAuthError('Autorize a permissão de cotação de fretes para conectar.');
 return {encrypted:sealShippingTokens({access_token:body.access_token,refresh_token:body.refresh_token}),accessToken:body.access_token as string,expiresAt:new Date(Date.now()+body.expires_in*1000).toISOString()};
}
export async function createShippingAuthorization(){
 const config=oauthConfig(),state=randomBytes(32).toString('base64url');
 const cleanup=await supabaseAdmin.from('store_shipping_oauth_state').delete().lt('expires_at',new Date().toISOString());
 if(cleanup.error)throw new ShippingAuthError('Atualize as migrations do banco da loja para conectar o frete.');
 const {error}=await supabaseAdmin.from('store_shipping_oauth_state').insert({state_hash:stateHash(state),environment:config.environment,client_id:config.clientId,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
 if(error)throw new ShippingAuthError('Não foi possível iniciar a conexão do frete.');
 const url=new URL('/api/integrations/melhor-envio/authorize',config.origin);url.searchParams.set('state',state);
 return url.toString();
}
async function connection(environment:string){
 const {data,error}=await supabaseAdmin.from('store_shipping_connection').select('*').eq('environment',environment).maybeSingle();
 if(error)throw new ShippingAuthError('Não foi possível consultar a conexão do frete. Confira as migrations da loja.');
 return data;
}
export async function automaticShippingEnabled(){
 if(process.env.MELHOR_ENVIO_TOKEN?.trim())return true;
 if(!process.env.MELHOR_ENVIO_CLIENT_ID?.trim()&&!process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim())return false;
 return Boolean(await connection(shippingEnvironment()));
}
export async function shippingConnectionStatus(){
 try{
  const config=oauthConfig(),row=await connection(config.environment);
  const manual=Boolean(process.env.MELHOR_ENVIO_TOKEN?.trim());
  const connected=Boolean(row&&row.client_id===config.clientId&&!row.requires_reconnect);
  return {configured:true,environment:config.environment,connected:connected||(!row&&manual),expiresAt:row?.expires_at||null,requiresReconnect:Boolean(row&&(row.requires_reconnect||row.client_id!==config.clientId)),message:connected?'Melhor Envio autorizado.':manual&&!row?'Usando token configurado manualmente.':'Autorize a conta da loja para calcular o frete.'};
 }catch(error){return {configured:false,connected:false,environment:process.env.MELHOR_ENVIO_ENVIRONMENT||null,message:error instanceof ShippingAuthError?error.message:'Confira a configuração da integração de frete.'};}
}
export async function shippingAccessToken(){
 const environment=shippingEnvironment();
 const hasOAuth=Boolean(process.env.MELHOR_ENVIO_CLIENT_ID?.trim()||process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim());
 const row=hasOAuth?await connection(environment):null;
 if(!row){const token=process.env.MELHOR_ENVIO_TOKEN?.trim();if(token)return {token,environment};throw new ShippingAuthError('Autorize a conta do Melhor Envio no ERP para habilitar a cotação.');}
 const config=oauthConfig();
 if(row.requires_reconnect||row.client_id!==config.clientId)throw new ShippingAuthError('Reconecte a conta do Melhor Envio no ERP para calcular o frete.');
 const tokens=openShippingTokens(row.encrypted_tokens);
 if(Date.parse(row.expires_at)>Date.now()+7*24*60*60*1000)return {token:tokens.access_token,environment};
 const owner=randomUUID();
 const claim=await supabaseAdmin.from('store_shipping_connection').update({refresh_owner:owner,refresh_lock_until:new Date(Date.now()+60000).toISOString()}).eq('environment',environment).eq('revision',row.revision).or(`refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`).select('revision').maybeSingle();
 if(claim.error)throw new ShippingAuthError('Não foi possível renovar a autorização de frete. Tente novamente.');
 if(!claim.data){if(Date.parse(row.expires_at)>Date.now()+60000)return {token:tokens.access_token,environment};throw new ShippingAuthError('A autorização do frete está sendo atualizada. Tente novamente em instantes.');}
 try{
  // Do not blindly retry this POST: the provider may have rotated the refresh token.
  const next=await exchangeShippingTokens({refresh_token:tokens.refresh_token});
  const saved=await supabaseAdmin.from('store_shipping_connection').update({encrypted_tokens:next.encrypted,expires_at:next.expiresAt,revision:randomUUID(),refresh_owner:null,refresh_lock_until:null,requires_reconnect:false,updated_at:new Date().toISOString()}).eq('environment',environment).eq('revision',row.revision).eq('refresh_owner',owner).select('revision').maybeSingle();
  if(saved.error||!saved.data)throw new ShippingAuthError('Não foi possível confirmar a renovação do frete. Reconecte a conta no ERP.');
  return {token:next.accessToken,environment};
 }catch{
  await supabaseAdmin.from('store_shipping_connection').update({requires_reconnect:true,refresh_owner:null,refresh_lock_until:null}).eq('environment',environment).eq('revision',row.revision).eq('refresh_owner',owner);
  throw new ShippingAuthError('A autorização de frete precisa ser refeita. Reconecte o Melhor Envio no ERP.');
 }
}
