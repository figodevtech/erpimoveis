/**
 * Instituições mais comuns, para preencher o CNPJ da conta com um clique. O
 * CNPJ da conta é o que o registro 1601 do SPED informa como instituição de
 * pagamento (PIX, boleto, transferência e a maquininha do banco da conta).
 *
 * É só atalho de digitação: o ERP nunca deduz o CNPJ pelo título da conta.
 */
import { isValidCnpj, normalizeCnpj } from "@/lib/fiscal-identifiers";

export type InstituicaoFinanceira = { nome: string; cnpj: string };

/** Campo opcional: vazio vira null; preenchido precisa ser CNPJ válido. */
export function lerCnpjInstituicao(value: unknown): { ok: true; cnpj: string | null } | { ok: false } {
  if (value == null || String(value).trim() === "") return { ok: true, cnpj: null };
  const cnpj = normalizeCnpj(value);
  return isValidCnpj(cnpj) ? { ok: true, cnpj } : { ok: false };
}

export const INSTITUICOES_FINANCEIRAS: readonly InstituicaoFinanceira[] = [
  { nome: "Banco do Brasil", cnpj: "00000000000191" },
  { nome: "Caixa Econômica Federal", cnpj: "00360305000104" },
  { nome: "Itaú Unibanco", cnpj: "60701190000104" },
  { nome: "Bradesco", cnpj: "60746948000112" },
  { nome: "Santander", cnpj: "90400888000142" },
  { nome: "Banco do Nordeste", cnpj: "07237373000120" },
  { nome: "Banco Inter", cnpj: "00416968000101" },
  { nome: "C6 Bank", cnpj: "31872495000172" },
  { nome: "Nubank", cnpj: "18236120000158" },
  { nome: "Mercado Pago", cnpj: "10573521000191" },
  { nome: "PagBank (PagSeguro)", cnpj: "08561701000101" },
  { nome: "Stone", cnpj: "16501555000157" },
  { nome: "Sicredi", cnpj: "01181521000155" },
  { nome: "Sicoob", cnpj: "02038232000164" },
];
