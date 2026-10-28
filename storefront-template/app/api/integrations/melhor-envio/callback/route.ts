import { randomUUID,timingSafeEqual } from 'node:crypto';
import { NextResponse,type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { oauthConfig,stateHash,validState,exchangeShippingTokens } from '@/lib/melhor-envio-oauth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 let origin:string;
 try{origin=oauthConfig().origin;}catch{return NextResponse.json({message:'Configure o aplicativo Melhor Envio no servidor da loja.'},{status:503});}
 function result(status:string){
  const url=new URL('/integracoes/melhor-envio',origin);url.searchParams.set('status',status);
  const response=NextResponse.redirect(url,303);
  response.cookies.set('me_oauth_state','',{httpOnly:true,secure:new URL(origin).protocol==='https:',sameSite:'lax',path:'/api/integrations/melhor-envio/callback',maxAge:0});
  response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
 }
 const params=new URL(request.url).searchParams,state=params.get('state')||'',cookie=request.cookies.get('me_oauth_state')?.value||'';
 if(!validState(state)||!validState(cookie)||state.length!==cookie.length||!timingSafeEqual(Buffer.from(state),Buffer.from(cookie)))return result('invalid');
 try{
  const config=oauthConfig();
  // Consume before exchanging: duplicate callbacks never submit the same code twice.
  const consumed=await supabaseAdmin.from('store_shipping_oauth_state').delete().eq('state_hash',stateHash(state)).eq('environment',config.environment).eq('client_id',config.clientId).eq('started',true).gt('expires_at',new Date().toISOString()).select('state_hash').maybeSingle();
  if(consumed.error||!consumed.data)return result('invalid');
  if(params.has('error'))return result('denied');
  const code=params.get('code');if(!code||code.length>4096)return result('invalid');
  const tokens=await exchangeShippingTokens({code});
  const saved=await supabaseAdmin.from('store_shipping_connection').upsert({environment:config.environment,client_id:config.clientId,encrypted_tokens:tokens.encrypted,expires_at:tokens.expiresAt,revision:randomUUID(),refresh_owner:null,refresh_lock_until:null,requires_reconnect:false,updated_at:new Date().toISOString()});
  if(saved.error)return result('error');
  return result('connected');
 }catch{return result('error');}
}
