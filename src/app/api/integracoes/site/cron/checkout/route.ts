import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileSiteCheckouts } from '@/lib/integrations/site-checkout-reconcile';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request) {
 const secret=process.env.CRON_SECRET?.trim();
 if(!secret)return NextResponse.json({error:'CRON_SECRET não configurado.'},{status:503});
 const expected=`Bearer ${secret}`,received=request.headers.get('authorization')||'';
 if(Buffer.byteLength(expected)!==Buffer.byteLength(received)||!timingSafeEqual(Buffer.from(expected),Buffer.from(received)))return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
 try {return NextResponse.json(await reconcileSiteCheckouts());}
 catch {return NextResponse.json({error:'Conciliação pendente. A próxima execução tentará novamente.'},{status:503});}
}
