import type { MovimentoPorPlanoDeConta } from "@/lib/financeiro/plano-contas/movimento-por-conta";

export type ResumoFinanceiro = {
  periodo: { inicio: string; fim: string };
  totais: { receita: number; despesa: number; saldo: number; receitaPendente: number };
  pendencias: {
    aPagar: number;
    aPagarVencido: number;
    aReceber: number;
    aReceberVencido: number;
  };
  fluxoDiario: { data: string; receita: number; despesa: number; saldoAcumulado: number }[];
  porCategoria: { categoria: string; receita: number; despesa: number }[];
  porMetodoPagamento: { metodo: string; valor: number }[];
  porPlanoDeConta: MovimentoPorPlanoDeConta[];
};

export type PropriedadesDashboardFinanceiro = {
  className?: string;
  endpoint?: string; // default: /api/dashboard/financeiro
  autoAtualizarMs?: number;
};

export type TipoSerieFluxo = "TODOS" | "ENTRADAS" | "SAIDAS" | "SALDO";
