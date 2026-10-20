/**
 * O mesmo GTIN aparece com zeros a esquerda diferentes: o EAN-13 7891234567895
 * e o GTIN-14 07891234567895 da caixa sao o mesmo item, assim como o UPC-A de
 * 12 digitos e o EAN-13 com um zero na frente. Para comparar, tira os zeros e
 * remonta o codigo em todos os tamanhos de GTIN — a lista serve de filtro `in`.
 */
export function variantesGtin(codigo: string) {
  const digitos = codigo.replace(/\D/g, "");
  if (!digitos) return [];

  const nucleo = digitos.replace(/^0+/, "");
  const variantes = new Set([digitos]);
  for (const tamanho of [8, 12, 13, 14]) {
    if (nucleo.length <= tamanho) variantes.add(nucleo.padStart(tamanho, "0"));
  }
  return [...variantes];
}
