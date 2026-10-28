import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { oauthConfig,shippingProviderBase,stateHash,validState } from '@/lib/melhor-envio-oauth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const state=new URL(request.url).searchParams.get('state')||'';
 if(!validState(state))return NextResponse.json({message:'Inicie a conexão pelo ERP.'},{status:400});
 try{
  const config=oauthConfig();
  const {data,error}=await supabaseAdmin.from('store_shipping_oauth_state').update({started:true}).eq('state_hash',stateHash(state)).eq('environment',config.environment).eq('client_id',config.clientId).eq('started',false).gt('expires_at',new Date().toISOString()).select('state_hash').maybeSingle();
  if(error||!data)return NextResponse.json({message:'Esta autorização expirou ou já foi utilizada. Inicie novamente pelo ERP.'},{status:400});
  const url=new URL('/oauth/authorize',shippingProviderBase(config.environment));
  url.searchParams.set('client_id',config.clientId);url.searchParams.set('redirect_uri',config.callback);url.searchParams.set('response_type','code');url.searchParams.set('scope','shipping-calculate');url.searchParams.set('state',state);
  const response=NextResponse.redirect(url,302);
  response.cookies.set('me_oauth_state',state,{httpOnly:true,secure:new URL(config.origin).protocol==='https:',sameSite:'lax',path:'/api/integrations/melhor-envio/callback',maxAge:600});
  response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  return response;
 }catch{return NextResponse.json({message:'Não foi possível iniciar a autorização. Confira as configurações no ERP.'},{status:503});}
}
