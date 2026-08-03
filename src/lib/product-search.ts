const PRODUCT_SEARCH_STOP_WORDS = new Set([
  "a", "as", "o", "os", "de", "da", "das", "do", "dos", "e", "em",
  "na", "nas", "no", "nos", "para", "por", "com", "um", "uma", "uns",
  "umas",
]);

const GENERAL_SEARCH_FIELDS = [
  "titulo", "descricao", "referencia", "fabricante", "codigobarras", "etiqueta",
  "local", "unidade", "ncm", "cfop", "origem_mercadoria", "csosn", "cst", "cest",
  "cst_pis", "modo_pis", "cst_cofins", "modo_cofins", "cst_ibscbs", "cclass_trib",
  "status_estoque", "conservacao", "tituloMarketplace", "descricaoMarketplace", "grupo",
] as const;

const STRUCTURED_SEARCH_FIELDS = [
  "etiqueta", "referencia", "codigobarras", "codigofornecedor", "ncm", "cest",
] as const;

export type ProductSearchToken = {
  value: string;
  structured: boolean;
};

export const normalizeProductSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");

const isStructuredToken = (value: string) =>
  /[a-z0-9][._/-][a-z0-9]/.test(value);

export const getProductSearchTokens = (value: string): ProductSearchToken[] => {
  const normalized = normalizeProductSearchText(value).trim();
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((token) => token && !PRODUCT_SEARCH_STOP_WORDS.has(token))
    .map((token) => ({ value: token, structured: isStructuredToken(token) }));

  return tokens.length > 0
    ? tokens
    : normalized
      ? [{ value: normalized, structured: false }]
      : [];
};

const collectSearchableValues = (value: unknown): unknown[] => {
  if (value == null || typeof value !== "object") return [value];
  if (Array.isArray(value)) return value.flatMap(collectSearchableValues);
  return Object.values(value as Record<string, unknown>).flatMap(collectSearchableValues);
};

const valuesFromFields = (
  product: Record<string, unknown>,
  fields: readonly string[],
) => fields.flatMap((field) => collectSearchableValues(product[field]));

export const matchesProductSearch = (
  product: Record<string, unknown>,
  tokens: ProductSearchToken[],
) => {
  const productId = normalizeProductSearchText(product.id);
  const generalText = valuesFromFields(product, GENERAL_SEARCH_FIELDS)
    .map(normalizeProductSearchText)
    .join(" ");
  const structuredValues = valuesFromFields(product, STRUCTURED_SEARCH_FIELDS)
    .map(normalizeProductSearchText);

  return tokens.every((token) =>
    token.structured
      ? structuredValues.some((value) => value.includes(token.value))
      : productId === token.value || generalText.includes(token.value),
  );
};
