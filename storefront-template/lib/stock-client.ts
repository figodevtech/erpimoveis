export async function availableStock(productId:number|string):Promise<number> {
  const response=await fetch('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[Number(productId)]}),cache:'no-store',signal:AbortSignal.timeout(20_000)});
  const data=await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível consultar o estoque agora. Tente novamente.');
  return Math.max(0,Number(data.items?.find((p:{productId:number})=>p.productId===Number(productId))?.available || 0));
}
