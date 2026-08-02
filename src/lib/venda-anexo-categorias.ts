export const VENDA_ANEXO_CATEGORIAS = [
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

export type VendaAnexoCategoria =
  (typeof VENDA_ANEXO_CATEGORIAS)[number]["value"];

export const VENDA_ANEXO_CATEGORIA_VALUES = VENDA_ANEXO_CATEGORIAS.map(
  (categoria) => categoria.value
);

export function getVendaAnexoCategoriaLabel(value?: string | null) {
  const categoria = VENDA_ANEXO_CATEGORIAS.find((item) => item.value === value);
  return categoria?.label ?? "Outros";
}
