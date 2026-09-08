// As colunas `id` de ordemservico e orcamento sao `integer` (int4). Um termo de
// busca so de digitos vira filtro por id, mas um CNPJ digitado no campo de busca
// tem 14 digitos e estoura o tipo: o Postgres aborta com 22003 e a consulta
// inteira volta 500. Numero que nao cabe no int4 nao e id — e texto.
const INT4_MAX = 2147483647;

export function idDeBusca(termo: string): number | null {
  const digitos = termo.replace(/\D/g, "");
  if (!digitos) return null;
  const numero = Number(digitos);
  if (!Number.isSafeInteger(numero) || numero <= 0 || numero > INT4_MAX) return null;
  return numero;
}
