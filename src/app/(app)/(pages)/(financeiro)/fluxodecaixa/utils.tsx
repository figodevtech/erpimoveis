import { TransactionCategoryIcon } from "@/lib/transaction-category-icons";
import { Tipo_transacao } from "./types";

export const getTypeColor = (tipo: Tipo_transacao) => {
  switch (tipo) {
    case Tipo_transacao.RECEITA:
    case Tipo_transacao.DEPOSITO:
      return "text-green-400 not-dark:text-green-700";
    case Tipo_transacao.DESPESA:
    case Tipo_transacao.SAQUE:
      return "text-red-400 not-dark:text-red-700";
    default:
      return "text-gray-500";
  }
};

const LEGACY_CATEGORY_ICONS: Record<string, string> = {
  ALUGUEL: "warehouse",
  COMISSÃO: "commission",
  EQUIPAMENTO: "equipment",
  FERRAMENTA: "wrench",
  IMPOSTO: "landmark",
  TAXA: "landmark",
  PEÇA: "part",
  PRODUTO: "purchase",
  SALÁRIO: "salary",
  REMUNERAÇÃO: "salary",
  SERVIÇO: "handshake",
  TRANSFERÊNCIA: "banknote",
  TRANSPORTE: "truck",
  LOGÍSTICA: "truck",
  UTILIDADE: "utility",
  OUTROS: "other",
};

export const getCategoryIcon = (categoria: string, icone?: string | null) => (
  <TransactionCategoryIcon
    name={icone ?? LEGACY_CATEGORY_ICONS[categoria] ?? "other"}
    className="text-black-500 size-4"
  />
);

export const formatCpfCnpj = (value: string) => {
  const numbers = value.replace(/\D/g, "");

  if (numbers.length <= 11) {
    return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  return numbers.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5",
  );
};
