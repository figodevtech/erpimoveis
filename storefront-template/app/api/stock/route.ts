import { NextResponse } from 'next/server';
import { erpCheckout, InventoryError } from '@/lib/erp-checkout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    const {ids}=await request.json();
    if (!Array.isArray(ids) || ids.length<1 || ids.length>100 || ids.some(id=>!Number.isSafeInteger(id) || id<=0 || id>2147483647)) return NextResponse.json({message:'Produtos inválidos.'},{status:400});
    const data=await erpCheckout({action:'availability',ids});
    // Prices and private ERP information do not leave this public endpoint.
    return NextResponse.json({items:data.map((p:{productId:number;available:number})=>({productId:p.productId,available:p.available}))},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return NextResponse.json({message:error instanceof InventoryError?error.message:'Não foi possível consultar o estoque agora.'},{status:error instanceof InventoryError?error.status:503});}
}
