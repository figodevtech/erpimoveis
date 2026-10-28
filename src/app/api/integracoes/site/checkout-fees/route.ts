import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireEstoqueAccess } from '@/app/api/_authz/perms';
import { requireEmpresaId,errorStatus } from '@/lib/empresa-context';
import { storefrontFetch } from '@/lib/integrations/storefront-http';

export const dynamic='force-dynamic';
export const runtime='nodejs';
const percent=z.number().finite().min(0).lt(100);
const feesSchema=z.object({operationValue:z.number().finite().min(0).max(1000),one:percent,six:percent,twelve:percent});
export async function GET(request:Request){
 try{
  await requireEstoqueAccess();await requireEmpresaId();
  const productId=Number(new URL(request.url).searchParams.get('productId')||1);
  if(!Number.isInteger(productId)||productId<=0||productId>2147483647)return NextResponse.json({message:'Informe o produto.'},{status:422});
  const base=process.env.STOREFRONT_API_URL?.trim();
  if(!base)return NextResponse.json({message:'Configure a conexão da loja para consultar as taxas Asaas.'},{status:503});
  const url=new URL('/api/checkout/options',base);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error();
  url.searchParams.set('ids',String(productId));url.searchParams.set('includeFees','1');
  const response=await storefrontFetch(url.toString(),{cache:'no-store',signal:AbortSignal.timeout(35000)});
  if(response.status===404)return NextResponse.json({message:'A loja publicada ainda não tem a rota de consulta das taxas. Publique a atualização do site correspondente e tente novamente.'},{status:503});
  if([401,403].includes(response.status))return NextResponse.json({message:'A loja bloqueou a consulta das taxas. Confira a proteção de acesso da publicação.'},{status:503});
  const body=await response.json().catch(()=>null);
  if(body?.feesError==='ASAAS_UNAUTHORIZED')return NextResponse.json({message:'O Asaas recusou a consulta. Confira a chave de API e o ambiente Asaas nas configurações do servidor da loja.'},{status:503});
  if(!response.ok) return NextResponse.json({message:'A loja não conseguiu consultar as taxas Asaas. Confira a configuração do servidor da loja e tente novamente.'},{status:503});
  const fees=feesSchema.safeParse(body?.fees);
  if(!fees.success)return NextResponse.json({message:'Não foi possível consultar as taxas da conta Asaas. Publique a versão atualizada da loja e tente novamente.'},{status:503});
  return NextResponse.json({fees:fees.data},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({message:'Não foi possível consultar as taxas do parcelamento. Confira a conexão com a loja e tente novamente.'},{status:errorStatus(error,503)});}
}
