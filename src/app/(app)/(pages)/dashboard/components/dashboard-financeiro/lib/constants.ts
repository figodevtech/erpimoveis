import { ResumoFinanceiro } from "./types";

export const RESUMO_INICIAL: ResumoFinanceiro = {
  periodo: { inicio: new Date().toISOString(), fim: new Date().toISOString() },
  totais: { receita: 0, despesa: 0, saldo: 0, receitaPendente: 0 },
  pendencias: { aPagar: 0, aPagarVencido: 0, aReceber: 0, aReceberVencido: 0 },
  fluxoDiario: [],
  porCategoria: [],
  porMetodoPagamento: [],
  porPlanoDeConta: [],
};

export const formatarMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const COR_RECEITA = "hsl(142 76% 36%)";
export const COR_DESPESA = "hsl(0 72% 51%)";
export const COR_SALDO_POSITIVO = "hsl(221 83% 53%)";
export const COR_SALDO_NEGATIVO = "hsl(24 94% 50%)";

export const CORES_METODOS = [
  "hsl(221 83% 53%)",
  "hsl(142 76% 36%)",
  "hsl(24 94% 50%)",
  "hsl(0 72% 51%)",
  "hsl(262 83% 58%)",
  "hsl(196 100% 50%)",
  "hsl(48 96% 53%)",
];
