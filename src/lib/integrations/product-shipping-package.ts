import { z } from 'zod';

const packageSchema=z.object({weight:z.number().positive().max(1000),width:z.number().positive().max(1000),height:z.number().positive().max(1000),length:z.number().positive().max(1000)});
export function productPackageListingFields(policy:unknown){
 const parsed=packageSchema.safeParse((policy as {shippingPackage?:unknown}|null)?.shippingPackage);
 if(!parsed.success)return null;
 const pack=parsed.data,grams=Math.round(pack.weight*1000);
 if(grams<1)return null;
 return {widthCm:String(pack.width),heightCm:String(pack.height),lengthCm:String(pack.length),weightGrams:String(grams)};
}
