"use client";
import { useEffect,type Dispatch,type SetStateAction } from 'react';
import { toast } from 'sonner';
type PackageForm={produtoId:string;widthCm:string;heightCm:string;lengthCm:string;weightGrams:string};
// Apply only to untouched fields. A late response never replaces a manual edit.
export function useProductPackage<T extends PackageForm>(form:T,setForm:Dispatch<SetStateAction<T>>,enabled:boolean){
 const id=form.produtoId;
 useEffect(()=>{
  if(!enabled||!id)return;
  const controller=new AbortController();
  void fetch(`/api/integracoes/mercadolivre/products/${encodeURIComponent(id)}/package`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{if(!response.ok)throw Error();return response.json();})
   .then(body=>{if(controller.signal.aborted||!body.package)return;setForm(current=>{
    if(current.produtoId!==id)return current;
    const keys=['widthCm','heightCm','lengthCm','weightGrams'] as const;
    if(keys.some(key=>current[key]))return current;
    if(keys.some(key=>typeof body.package[key]!=='string'||!Number.isFinite(Number(body.package[key]))||Number(body.package[key])<=0))return current;
    return {...current,...Object.fromEntries(keys.map(key=>[key,body.package[key]]))};
   });})
   .catch(()=>{if(!controller.signal.aborted)toast.error('Não foi possível carregar a embalagem do produto. Confira as medidas do anúncio.');});
  return()=>controller.abort();
 },[id,enabled,setForm]);
}
