/**
 * Tipos de documento aceitos nos anexos de OS.
 *
 * Espelha a lista da venda (`venda-anexo-categorias`) de proposito: o usuario ja
 * conhece esses rotulos e as duas telas anexam os mesmos documentos. Os valores
 * precisam bater com a constraint `osanexo_categoria_check`.
 */
export const OS_ANEXO_CATEGORIAS = [
  { value: "NOTA_FISCAL", label: "Nota fiscal" },
  { value: "COMPROVANTE_PAGAMENTO", label: "Comprovante de pagamento" },
  { value: "DOCUMENTO_PESSOAL", label: "Documento pessoal" },
  { value: "COMPROVANTE_ENTREGA", label: "Comprovante de entrega" },
  { value: "COMPROVANTE_ENVIO", label: "Comprovante de envio" },
  { value: "COMUNICACAO_CLIENTE", label: "Comunicação com o cliente" },
  { value: "CANCELAMENTO_ESTORNO", label: "Cancelamento / Estorno" },
  { value: "AUTORIZACAO_PROCURACAO", label: "Autorização / Procuração" },
  { value: "OUTROS", label: "Outros" },
] as const;

export type OsAnexoCategoria = (typeof OS_ANEXO_CATEGORIAS)[number]["value"];

export const OS_ANEXO_CATEGORIA_VALUES = OS_ANEXO_CATEGORIAS.map(
  (categoria) => categoria.value
);

export function getOsAnexoCategoriaLabel(value?: string | null) {
  const categoria = OS_ANEXO_CATEGORIAS.find((item) => item.value === value);
  return categoria?.label ?? "Outros";
}
