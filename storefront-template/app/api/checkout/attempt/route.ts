import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resumeCheckout } from '@/lib/checkout-attempt';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {
  const client=await createClient();
  let {data:{user}}=await client.auth.getUser();
  const bearer=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!user&&bearer){const result=await supabaseAdmin.auth.getUser(bearer);user=result.data.user;}
  if(!user)return NextResponse.json({message:'Faça login para continuar.'},{status:401});
  const id=new URL(request.url).searchParams.get('id');
  if(!id||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))return NextResponse.json({message:'Tentativa inválida.'},{status:400});
  const {data:customer,error:customerError}=await supabaseAdmin.from('cliente').select('id').eq('user_id',user.id).maybeSingle();
  if(customerError)throw customerError;
  if(!customer)return NextResponse.json({message:'Cadastro não encontrado.'},{status:404});
  const {data:attempt,error}=await supabaseAdmin.from('checkout_attempt').select('request_hash').eq('attempt_id',id).eq('cliente_id',customer.id).maybeSingle();
  if(error)throw error;
  if(!attempt)return NextResponse.json({message:'Tentativa não encontrada.'},{status:404});
  return await resumeCheckout(id,Number(customer.id),attempt.request_hash) || NextResponse.json({message:'Tentativa não encontrada.'},{status:404});
 }catch{return NextResponse.json({message:'Não foi possível retomar o pagamento. Consulte seus pedidos antes de tentar novamente.'},{status:503});}
}
