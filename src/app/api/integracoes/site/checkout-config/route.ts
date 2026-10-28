import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireEstoqueAccess,requireEstoqueEdit,requireFinanceiroEdit } from '@/app/api/_authz/perms';
import { z } from 'zod';
import { requireEmpresaId,errorStatus } from '@/lib/empresa-context';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { paymentFields,resolveCheckoutPolicy } from '@/lib/integrations/site-checkout-inheritance';
import { checkoutPolicySchema,defaultCheckoutPolicy } from '@/lib/integrations/site-checkout-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function isStore(request:Request){
 const expected=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim()||'';
 const received=request.headers.get('authorization')?.replace(/^Bearer /,'').trim()||'';
 return Boolean(expected)&&Buffer.byteLength(expected)===Buffer.byteLength(received)&&timingSafeEqual(Buffer.from(expected),Buffer.from(received));
}
export async function GET(request:Request){
 try{
 if(request.headers.has('authorization')){if(!isStore(request))return NextResponse.json({message:'Não autorizado.'},{status:401});}
 else await requireEstoqueAccess();
 const empresaId=await requireEmpresaId();
 const params=new URL(request.url).searchParams;
 const store=isStore(request);
 if(params.has('groupId')){
  if(store)return NextResponse.json({message:'Consulta de grupo disponível somente no ERP.'},{status:403});
  const groupId=Number(params.get('groupId'));
  if(!Number.isInteger(groupId)||groupId<=0||groupId>2147483647)return NextResponse.json({message:'Informe o grupo.'},{status:422});
  const [{data:group,error:groupError},{data:rule,error:ruleError}]=await Promise.all([
   supabaseAdmin.from('produtogrupo').select('id,nome').eq('id',groupId).maybeSingle(),
   supabaseAdmin.from('site_group_checkout_config').select('policy,updated_at').eq('grupo_id',groupId).maybeSingle(),
  ]);
  if(groupError||ruleError)throw groupError||ruleError;
  if(!group)return NextResponse.json({message:'Grupo não encontrado.'},{status:404});
  const policy=checkoutPolicySchema.parse({...defaultCheckoutPolicy,...(rule?.policy as object||{})});
  return NextResponse.json({policy,groupName:group.nome},{headers:{'Cache-Control':'no-store'}});
 }
 const ids=(params.get('ids')||params.get('productId')||'').split(',').map(Number);
 if(!ids.length||ids.length>100||ids.some(id=>!Number.isInteger(id)||id<=0||id>2147483647))return NextResponse.json({message:'Informe os produtos.'},{status:422});
 const [{data,error},{data:products,error:productsError}]=await Promise.all([
  supabaseAdmin.from('site_product_checkout_config').select('produto_id,policy,payment_override,updated_at').in('produto_id',ids),
  supabaseAdmin.from('produto').select('id,grupo_produto_id').in('id',ids),
 ]);
 if(error||productsError)throw error||productsError;
 const preview=params.has('previewGroupId')&&!store&&ids.length===1?Number(params.get('previewGroupId')):undefined;
 if(preview!==undefined&&(!Number.isInteger(preview)||preview<0||preview>2147483647))return NextResponse.json({message:'Grupo inválido.'},{status:422});
 const assignedGroup=(productId:number)=>preview!==undefined?preview:Number(products?.find(product=>Number(product.id)===productId)?.grupo_produto_id)||0;
 const groupIds=[...new Set(ids.map(assignedGroup).filter(Boolean))];
 const [{data:groupRules,error:rulesError},{data:groups,error:groupsError}]=groupIds.length?await Promise.all([
  supabaseAdmin.from('site_group_checkout_config').select('grupo_id,policy,updated_at').in('grupo_id',groupIds),
  supabaseAdmin.from('produtogrupo').select('id,nome').in('id',groupIds),
 ]):[{data:[],error:null},{data:[],error:null}];
 if(rulesError||groupsError)throw rulesError||groupsError;
 const resolved=Object.fromEntries(ids.map(id=>[String(id),resolveCheckoutPolicy(data?.find(row=>Number(row.produto_id)===id),groupRules?.find(row=>Number(row.grupo_id)===assignedGroup(id)))]));
 const policies=Object.fromEntries(Object.entries(resolved).map(([id,result])=>[id,result.policy]));
 const firstId=ids[0],first=resolved[String(firstId)];
 const groupName=groups?.find(group=>Number(group.id)===assignedGroup(firstId))?.nome||null;
 const revision=ids.map(id=>`${id}:${assignedGroup(id)}:${data?.find(row=>Number(row.produto_id)===id)?.updated_at||'default'}:${groupRules?.find(row=>Number(row.grupo_id)===assignedGroup(id))?.updated_at||'default'}`).join('|');

 const {data:empresa,error:empresaError}=await supabaseAdmin.from('empresa').select('cep').eq('id',empresaId).maybeSingle();
 if(empresaError)throw empresaError;
 const originCep=String(empresa?.cep||'').replace(/\D/g,'');
 return NextResponse.json({policies,...first,groupName,groupId:assignedGroup(firstId)||null,originCep:/^\d{8}$/.test(originCep)?originCep:null,revision},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({message:'Não foi possível carregar as regras do checkout.'},{status:errorStatus(error)});}
}
export async function PUT(request:Request){
 try{
 await requireEstoqueEdit();await requireFinanceiroEdit();await requireEmpresaId();
 const parsed=z.union([
  z.object({productId:z.number().int().positive(),policy:checkoutPolicySchema,paymentOverride:z.boolean().default(true)}),
  z.object({groupId:z.number().int().positive(),policy:checkoutPolicySchema}),
 ]).safeParse(await request.json());
 if(!parsed.success)return NextResponse.json({message:parsed.error.issues[0]?.message||'Confira as regras.'},{status:422});
 if('groupId' in parsed.data){
  const {data:group,error:groupError}=await supabaseAdmin.from('produtogrupo').select('id').eq('id',parsed.data.groupId).maybeSingle();
  if(groupError)throw groupError;if(!group)return NextResponse.json({message:'Grupo não encontrado.'},{status:404});
  const policy={...paymentFields(parsed.data.policy),freeShipping:parsed.data.policy.freeShipping};
  const {error}=await supabaseAdmin.from('site_group_checkout_config').upsert({grupo_id:parsed.data.groupId,policy,updated_at:new Date().toISOString()});
  if(error)throw error;
  return NextResponse.json({policy:{...defaultCheckoutPolicy,...policy}});
 }

 const {data:product,error:productError}=await supabaseAdmin.from('produto').select('id').eq('id',parsed.data.productId).eq('is_deleted',false).maybeSingle();
 if(productError)throw productError;if(!product)return NextResponse.json({message:'Produto não encontrado.'},{status:404});
 const {error}=await supabaseAdmin.from('site_product_checkout_config').upsert({produto_id:parsed.data.productId,policy:parsed.data.policy,payment_override:parsed.data.paymentOverride,updated_at:new Date().toISOString()});
 if(error)throw error;
 return NextResponse.json({policy:parsed.data.policy});
 }catch(error){return NextResponse.json({message:'Não foi possível salvar as regras.'},{status:errorStatus(error)});}
}
