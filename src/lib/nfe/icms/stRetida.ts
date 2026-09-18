// ST cobrada anteriormente, lida da NF-e de compra.
//
// Os valores do grupo ICMS60/ICMSSN500 da compra se referem à linha inteira.
// Quando a saída documenta só parte dela (devolução parcial, por exemplo), a
// ST que acompanha a mercadoria é a proporcional à quantidade. As alíquotas
// (pST, pFCPSTRet) não mudam com a quantidade.
//
// O núcleo nunca calcula esses valores sozinho: eles só existem quando há
// vínculo fiscal com a entrada (item da NF-e de compra identificado).

export type StRetidaDaCompra = {
  vBCSTRet: number | null;
  vICMSSTRet: number | null;
  pST: number | null;
  vICMSSubstituto: number | null;
  vBCFCPSTRet: number | null;
  pFCPSTRet: number | null;
  vFCPSTRet: number | null;
};

export function stRetidaProporcional(
  st: StRetidaDaCompra | null | undefined,
  quantidadeDocumentada: number | null | undefined,
  quantidadeDaCompra: number | null | undefined,
): StRetidaDaCompra | null {
  if (!st || st.vBCSTRet === null || st.vICMSSTRet === null) return null;
  const documentada = Number(quantidadeDocumentada ?? 0);
  const compra = Number(quantidadeDaCompra ?? 0);
  // Sem as duas quantidades não há proporção confiável: vale a linha inteira,
  // que é o que o fornecedor declarou.
  const fator = documentada > 0 && compra > 0 ? Math.min(1, documentada / compra) : 1;
  const parte = (valor: number | null) => (valor === null ? null : Number((valor * fator).toFixed(2)));
  return {
    vBCSTRet: parte(st.vBCSTRet),
    vICMSSTRet: parte(st.vICMSSTRet),
    pST: st.pST,
    vICMSSubstituto: parte(st.vICMSSubstituto),
    vBCFCPSTRet: parte(st.vBCFCPSTRet),
    pFCPSTRet: st.pFCPSTRet,
    vFCPSTRet: parte(st.vFCPSTRet),
  };
}
