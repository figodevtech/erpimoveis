import { NextResponse } from 'next/server';
import { requireVendasAccess } from '@/app/api/_authz/perms';
import { requireEmpresaId,errorStatus } from '@/lib/empresa-context';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { productPackageListingFields } from '@/lib/integrations/product-shipping-package';
export const dynamic='force-dynamic';
export async function GET(_request:Request,ctx:{params:Promise<{produtoId:string}>}){
 try{
  await requireVendasAccess();await requireEmpresaId();
  const id=Number((await ctx.params).produtoId);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({message:'Produto inválido.'},{status:422});
  const {data:product,error:productError}=await supabaseAdmin.from('produto').select('id').eq('id',id).eq('is_deleted',false).maybeSingle();
  if(productError)throw productError;
  if(!product)return NextResponse.json({message:'Produto não encontrado.'},{status:404});
  const {data,error}=await supabaseAdmin.from('site_product_checkout_config').select('policy').eq('produto_id',id).maybeSingle();
  if(error)throw error;
  return NextResponse.json({package:productPackageListingFields(data?.policy)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({message:'Não foi possível consultar a embalagem do produto.'},{status:errorStatus(error)});}
}
