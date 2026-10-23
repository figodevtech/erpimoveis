export type SiteOrderFilters = {
 startDate:string;endDate:string;minTotal:string;maxTotal:string;payment:string;delivery:string;
};
export const EMPTY_SITE_ORDER_FILTERS:SiteOrderFilters={startDate:'',endDate:'',minTotal:'',maxTotal:'',payment:'all',delivery:'all'};
export function siteOrderFiltersError(filters:SiteOrderFilters):string|null {
 for(const value of [filters.startDate,filters.endDate])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return 'Informe datas válidas.';
 if(filters.startDate&&filters.endDate&&filters.startDate>filters.endDate)return 'A data inicial deve ser anterior ou igual à final.';
 for(const value of [filters.minTotal,filters.maxTotal])if(value&&(value.trim()===''||!Number.isFinite(Number(value))||Number(value)<0))return 'Informe valores maiores ou iguais a zero.';
 if(filters.minTotal&&filters.maxTotal&&Number(filters.minTotal)>Number(filters.maxTotal))return 'O valor mínimo deve ser menor ou igual ao máximo.';
 if(!['all','PIX','BOLETO','CREDIT_CARD'].includes(filters.payment)||!['all','delivery','pickup'].includes(filters.delivery))return 'Filtro inválido.';
 return null;
}
export function orderDateBounds(filters:SiteOrderFilters){
 const start=filters.startDate?`${filters.startDate}T03:00:00.000Z`:null;
 const end=filters.endDate?new Date(Date.parse(`${filters.endDate}T03:00:00.000Z`)+86400000).toISOString():null;
 return {start,end};
}
export function matchesSiteOrderFilters(row:{order_created_at?:string|null;total_amount:number;paymentMethod?:string|null;raw_order?:{shippingAddress?:{deliveryMethod?:string}}},filters:SiteOrderFilters){
 const {start,end}=orderDateBounds(filters),time=Date.parse(row.order_created_at||'');
 if((start&&(!Number.isFinite(time)||time<Date.parse(start)))||(end&&(!Number.isFinite(time)||time>=Date.parse(end))))return false;
 if(filters.minTotal&&row.total_amount<Number(filters.minTotal)||filters.maxTotal&&row.total_amount>Number(filters.maxTotal))return false;
 const method=(row.paymentMethod||'').toUpperCase();
 if(filters.payment!=='all'&&!(filters.payment==='PIX'?method.includes('PIX'):filters.payment==='BOLETO'?method.includes('BOLETO'):method.includes('CREDIT_CARD')||method.includes('CARTÃO')||method.includes('CARTAO')))return false;
 return filters.delivery==='all'||(row.raw_order?.shippingAddress?.deliveryMethod==='pickup'?'pickup':'delivery')===filters.delivery;
}
