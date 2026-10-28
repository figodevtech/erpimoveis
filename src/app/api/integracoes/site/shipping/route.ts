import { NextResponse } from 'next/server';
import { requireEstoqueAccess,requireEstoqueEdit } from '@/app/api/_authz/perms';
import { requireEmpresaId,errorStatus } from '@/lib/empresa-context';
import { storefrontFetch } from '@/lib/integrations/storefront-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function proxy(method:'GET'|'POST'){
 try{
  if(method==='POST')await requireEstoqueEdit();else await requireEstoqueAccess();
  await requireEmpresaId();
  const base=process.env.STOREFRONT_API_URL?.trim(),secret=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
  if(!base||!secret)return NextResponse.json({message:'Configure a conexão do ERP com a loja.'},{status:503});
  const url=new URL('/api/integrations/melhor-envio/connect',base);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error();
  const response=await storefrontFetch(url.toString(),{method,headers:{Authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status===404)return NextResponse.json({message:'Publique a atualização da loja para conectar o Melhor Envio.'},{status:503});
  const body=await response.json().catch(()=>null);
  if(!response.ok)return NextResponse.json({message:response.status===401?'Confira o segredo de integração da loja.':body?.message||'Não foi possível consultar a conexão de frete.'},{status:503});
  if(method==='POST'){
   const target=new URL(body.url);if(target.origin!==url.origin||target.pathname!=='/api/integrations/melhor-envio/authorize')throw Error();
   return NextResponse.json({url:target.toString()},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({configured:body.configured===true,connected:body.connected===true,environment:['production','sandbox'].includes(body.environment)?body.environment:null,expiresAt:body.expiresAt||null,requiresReconnect:body.requiresReconnect===true,message:String(body.message||'').slice(0,400)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({message:'Não foi possível consultar a conexão com a loja.'},{status:errorStatus(error,503)});}
}
export async function GET(){return proxy('GET');}
export async function POST(){return proxy('POST');}
