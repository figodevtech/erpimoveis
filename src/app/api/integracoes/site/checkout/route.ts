import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireEmpresaId } from '@/lib/empresa-context';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.number().int().positive().max(2147483647);
const input = z.discriminatedUnion('action', [
  z.object({ action:z.literal('availability'), ids:z.array(id).min(1).max(100) }),
  z.object({ action:z.literal('reserve'), orderId:id, items:z.array(z.object({productId:id,quantity:id.max(100000),unitPrice:z.number().positive().finite()})).min(1).max(100) }),
  z.object({ action:z.literal('release'), orderId:id, reason:z.string().min(1).max(200) }),
  z.object({ action:z.literal('refundReservation'), orderId:id }),
]);
export async function POST(request:Request) {
  const expected=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim() || '';
  const received=request.headers.get('authorization')?.replace(/^Bearer /,'').trim() || '';
  if (!expected || Buffer.byteLength(expected)!==Buffer.byteLength(received) || !timingSafeEqual(Buffer.from(expected),Buffer.from(received))) return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
  try {
    const body=input.safeParse(await request.json());
    if (!body.success) return NextResponse.json({error:'DADOS_INVALIDOS'},{status:400});
    const company=await requireEmpresaId();
    const data=body.data;
    const result=data.action==='availability'
      ? await supabaseAdmin.rpc('fn_site_checkout_available',{p_empresa_id:company,p_ids:data.ids})
      : data.action==='reserve'
        ? await supabaseAdmin.rpc('fn_site_checkout_reserve',{p_empresa_id:company,p_order_id:data.orderId,p_items:data.items})
        : data.action==='refundReservation'
          ? await supabaseAdmin.rpc('fn_site_checkout_refund_before_import',{p_empresa_id:company,p_order_id:data.orderId})
          : await supabaseAdmin.rpc('fn_site_checkout_release',{p_empresa_id:company,p_order_id:data.orderId,p_reason:data.reason});
    if (result.error) {
      const stock=result.error.message.startsWith('INSUFFICIENT_STOCK:');
      const price=result.error.message.startsWith('SITE_PRICE_CHANGED:');
      console.error('[site/checkout]',{action:data.action,code:result.error.code,message:result.error.message});
      return NextResponse.json({error:stock?'ESTOQUE_INSUFICIENTE':price?'PRECO_ATUALIZADO':'CHECKOUT_INDISPONIVEL',message:stock?'Um dos produtos acabou de ficar indisponível. Revise seu carrinho.':price?'O preço de um produto foi atualizado. Atualize o carrinho antes de continuar.':'Não foi possível confirmar a disponibilidade agora. Tente novamente em instantes.'},{status:stock||price?409:503});
    }
    return NextResponse.json({data:result.data},{headers:{'Cache-Control':'no-store'}});
  } catch { return NextResponse.json({error:'ERP_INDISPONIVEL',message:'Não foi possível consultar o estoque agora. Tente novamente em instantes.'},{status:503}); }
}
