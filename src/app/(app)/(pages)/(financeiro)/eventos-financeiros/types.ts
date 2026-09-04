import type { EventoFinanceiroBruto } from "@/components/financeiro/eventos-financeiros/modelo";

export type { EventoFinanceiroBruto };

/**
 * As três visões da fila.
 *
 * A tela abre em `NAO_LANCADO` porque é o que ela existe para responder: o que a
 * recepção lançou na OS e o financeiro ainda não transformou em título. As
 * outras duas servem para conferir o que já foi feito.
 */
export type SituacaoEvento = "NAO_LANCADO" | "LANCADO" | "TODOS";

export const SITUACAO_TABS: { value: SituacaoEvento; label: string }[] = [
  { value: "NAO_LANCADO", label: "Não lançados" },
  { value: "LANCADO", label: "Lançados" },
  { value: "TODOS", label: "Todos" },
];

export type FiltrosDeEventos = {
  natureza: "" | "RECEITA" | "DESPESA";
  origem: string;
  osId: string;
  usuarioId: string;
  dateFrom: string;
  dateTo: string;
};

export const FILTROS_VAZIOS: FiltrosDeEventos = {
  natureza: "",
  origem: "",
  osId: "",
  usuarioId: "",
  dateFrom: "",
  dateTo: "",
};

export type UsuarioDeEvento = {
  id: string;
  nome: string | null;
  email: string | null;
  ativo: boolean;
};

export const ORIGENS_DISPONIVEIS = [
  "PRODUTO",
  "SERVICO",
  "COMISSAO",
  "AVULSO",
  "DESCONTO",
  "FRETE",
  "CONSUMO",
] as const;

export type TotaisDaFila = {
  receita: number;
  despesa: number;
  liquido: number;
  quantidade: number;
  ordens: number;
  selecionaveis: number;
};

export type Paginacao = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
