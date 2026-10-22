import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileCheckoutBatch } from '@/lib/checkout-reconcile';
import { supabaseAdmin } from '@/lib/supabase/admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
function authorized(request:Request) {
 const secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
 const expected=`Bearer ${secret||''}`,received=request.headers.get('authorization')||'';
 return Boolean(secret && Buffer.byteLength(expected)===Buffer.byteLength(received) && timingSafeEqual(Buffer.from(expected),Buffer.from(received)));
}
export async function GET(request:Request) {
 if(!authorized(request))return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
 const {data,error}=await supabaseAdmin.from('checkout_attempt').select('order_id,phase,billing_type,last_error,created_at,updated_at,bank_cancelled_at,release_pending').or('phase.not.in.(CANCELLED,DONE),release_pending.eq.true').order('created_at',{ascending:false}).limit(100);
 if(error)return NextResponse.json({error:'Falha ao consultar checkouts.'},{status:503});
 const {data:legacy,error:legacyError}=await supabaseAdmin.rpc('fn_checkout_cutover_status');
 if(legacyError)return NextResponse.json({error:'Falha ao conferir a transição de estoque.'},{status:503});
 return NextResponse.json({data,legacy},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
 if(!authorized(request))return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
 try {const results=await reconcileCheckoutBatch();return NextResponse.json({results});}
 catch {return NextResponse.json({error:'Conciliação pendente. A próxima execução tentará novamente.'},{status:503});}
}
