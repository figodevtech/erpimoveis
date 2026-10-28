import { NextResponse } from 'next/server';
import { createShippingAuthorization,shippingAuthorized,shippingConnectionStatus,ShippingAuthError } from '@/lib/melhor-envio-oauth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!shippingAuthorized(request))return NextResponse.json({message:'Não autorizado.'},{status:401});
 return NextResponse.json(await shippingConnectionStatus(),{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 if(!shippingAuthorized(request))return NextResponse.json({message:'Não autorizado.'},{status:401});
 try{return NextResponse.json({url:await createShippingAuthorization()},{headers:{'Cache-Control':'no-store'}});}
 catch(error){return NextResponse.json({message:error instanceof ShippingAuthError?error.message:'Não foi possível iniciar a conexão de frete.'},{status:503});}
}
