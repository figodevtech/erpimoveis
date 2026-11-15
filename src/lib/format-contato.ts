import { formatCnpj, formatCpf, normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";

export type TipoPessoa = "FISICA" | "JURIDICA";

/*
 * Dois usos diferentes:
 *  - máscara de campo (mascara*): formata enquanto a pessoa digita, sem separador sobrando no
 *    fim, para o Backspace apagar o dígito e não ficar preso num ")" ou "-";
 *  - exibição (exibir*): só formata o número completo. Telefone antigo sem DDD ou com outro
 *    tamanho aparece como foi gravado, em vez de ganhar parênteses no lugar errado.
 * O valor gravado é sempre o canônico: só dígitos (CNPJ: letras maiúsculas e dígitos).
 */

/** Telefone como é gravado: DDD + número, só dígitos, até 11. */
export function telefoneDigitos(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

/** "(83", "(83) 9999", "(83) 3333-4444", "(83) 99999-4444" conforme a digitação avança. */
export function mascaraTelefone(value: unknown): string {
  const d = telefoneDigitos(value);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Telefone completo (10 ou 11 dígitos) formatado; outro tamanho volta como foi gravado. */
export function exibirTelefone(value: unknown): string {
  const raw = String(value ?? "").trim();
  const d = raw.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? mascaraTelefone(d) : raw;
}

/** CEP como é gravado: 8 dígitos. */
export function cepDigitos(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

/** "58030", "58030-1", "58030-190" conforme a digitação avança. */
export function mascaraCep(value: unknown): string {
  const d = cepDigitos(value);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** CPF (11 dígitos) ou CNPJ (14 caracteres, aceita o alfanumérico) como é gravado. */
export function documentoCanonico(value: unknown, tipo: TipoPessoa): string {
  return tipo === "JURIDICA"
    ? normalizeCnpj(value).replace(/[^A-Z0-9]/g, "").slice(0, 14)
    : normalizeCpf(value).slice(0, 11);
}

/** Máscara progressiva de CPF ou CNPJ, conforme o tipo de pessoa. */
export function mascaraDocumento(value: unknown, tipo: TipoPessoa): string {
  const canonical = documentoCanonico(value, tipo);
  return tipo === "JURIDICA" ? formatCnpj(canonical) : formatCpf(canonical);
}

/** CPF ou CNPJ completo formatado pelo tamanho; outro valor volta como foi gravado. */
export function exibirDocumento(value: unknown): string {
  const raw = String(value ?? "").trim();
  const cnpj = normalizeCnpj(raw);
  if (cnpj.length === 14) return formatCnpj(cnpj);
  const cpf = normalizeCpf(raw);
  if (cpf.length === 11 && cpf.length === cnpj.length) return formatCpf(cpf);
  return raw;
}
