export type IdentificacaoEmitente = {
  cnpj: string | null;
  cpf: string | null;
  documento: string | null;
  tipoDocumento: "CNPJ" | "CPF" | null;
};

/**
 * Lê a identificação do emitente da NF-e, que pode ser pessoa jurídica ou
 * física. Embora CNPJ seja o caso comum, a XSD também permite CPF em `emit`.
 */
export function identificarEmitente(
  emitente: Record<string, unknown> | null | undefined,
): IdentificacaoEmitente {
  const cnpj = normalizeCnpj(emitente?.CNPJ) || null;
  const cpf = normalizeCpf(emitente?.CPF) || null;

  if (cnpj) {
    return { cnpj, cpf, documento: cnpj, tipoDocumento: "CNPJ" };
  }

  if (cpf) {
    return { cnpj, cpf, documento: cpf, tipoDocumento: "CPF" };
  }

  return { cnpj, cpf, documento: null, tipoDocumento: null };
}
import { normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";
