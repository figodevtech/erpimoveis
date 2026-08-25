/**
 * Leitura de valores do XML da NF-e já convertido pelo `fast-xml-parser`.
 *
 * O parser converte o que parece número em número, então o mesmo campo chega ora
 * como `119`, ora como `"119,00"` (emitente que usa vírgula). Nó com filho único
 * não vira array. Todo módulo que lê NF-e tropeça nas mesmas duas coisas, então
 * elas moram aqui.
 */

/** `"119,00"` e `119` viram o mesmo `119`. Texto que não é número vira `null`. */
export function paraNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  const limpo = valor.trim().replace(",", ".");
  if (!limpo) return null;

  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

export function paraTexto(valor: unknown): string | null {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

/**
 * `dVenc` é data pura (AAAA-MM-DD) na especificação, mas aparece com hora colada
 * em emissor que reaproveita campo de timestamp. Cortar em 10 evita que o
 * vencimento ande um dia ao virar `Date` no fuso do navegador.
 */
export function paraDia(valor: unknown): string | null {
  const texto = paraTexto(valor);
  if (!texto) return null;

  const encontrado = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return encontrado ? encontrado[0].slice(0, 10) : null;
}

/** Um nó do fast-xml-parser vira lista: filho único não vem em array. */
export function comoLista(valor: unknown): unknown[] {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/** Caminha por nós aninhados: `caminho(infNFe, "total", "ICMSTot")`. */
export function caminho(
  raiz: unknown,
  ...chaves: string[]
): Record<string, unknown> | null {
  let atual = registro(raiz);
  for (const chave of chaves) {
    if (!atual) return null;
    atual = registro(atual[chave]);
  }
  return atual;
}
