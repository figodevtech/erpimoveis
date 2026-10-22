// Persist identity, never card details. Same cart/recipient/method resumes the
// existing operation after a refresh or a lost network response.
export function checkoutAttempt(userId:string,data:{addressId:unknown;deliveryMethod:unknown;billingType:unknown;items:Array<{productId:unknown;quantity:number}>;savedCardId?:unknown}) {
  const key=`checkout-attempt:${userId}`;
  const fingerprint=JSON.stringify([data.addressId,data.deliveryMethod,data.billingType,data.savedCardId||null,data.items.map(i=>[Number(i.productId),i.quantity]).sort((a,b)=>a[0]-b[0])]);
  try {
    const previous=JSON.parse(localStorage.getItem(key)||'null');
    if (previous?.fingerprint===fingerprint && typeof previous.id==='string') return previous.id as string;
    const id=crypto.randomUUID();
    localStorage.setItem(key,JSON.stringify({fingerprint,id}));
    return id;
  } catch { throw new Error('Permita o armazenamento local para finalizar a compra com segurança.'); }
}
export function forgetCheckoutAttempt(userId:string) {
  try {localStorage.removeItem(`checkout-attempt:${userId}`);} catch { /* confirmed payment must remain visible even if storage was disabled */ }
}
