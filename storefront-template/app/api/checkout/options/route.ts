import { NextResponse } from 'next/server';
import { getCheckoutPolicy } from '@/lib/erp-checkout-policy';
import { getCardFees } from '@/lib/asaas-fees';
import { AsaasApiError } from '@/lib/asaas';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const ids=(new URL(request.url).searchParams.get('ids')||'').split(',').map(Number);
 if(ids.length>100||ids.some(id=>!Number.isInteger(id)||id<=0||id>2147483647))return NextResponse.json({message:'Informe os produtos.'},{status:422});
 const config=await getCheckoutPolicy(ids);
 const needsFees=new URL(request.url).searchParams.get('includeFees')==='1'||Object.values(config.policies).some(p=>p.feeMode!=='absorbed');
 let fees=null;
 let feesError:string|undefined;
 if(needsFees){try{fees=await getCardFees();}catch(error){feesError=error instanceof AsaasApiError&&[401,403].includes(error.status)?'ASAAS_UNAUTHORIZED':'ASAAS_UNAVAILABLE';}}
 if(new URL(request.url).searchParams.get('includeFees')==='1'&&!fees)return NextResponse.json({fees:null,feesError,message:'Não foi possível consultar as taxas Asaas da loja.'},{status:503,headers:{'Cache-Control':'no-store'}});
 return NextResponse.json({...config,fees},{headers:{'Cache-Control':'no-store'}});
}
