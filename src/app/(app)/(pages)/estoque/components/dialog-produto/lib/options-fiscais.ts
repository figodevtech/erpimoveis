import { Estoque_status } from "../../../types";

export type CstCsosn = { cod: string; desc: string };

export const CST_OPTIONS: CstCsosn[] = [
  { cod: "00", desc: "Tributada Integralmente" },
  { cod: "10", desc: "Tributada e com cobrança do ICMS por ST" },
  { cod: "20", desc: "Com redução de base de cálculo" },
  { cod: "30", desc: "Isenta/Não tributada e com cobrança do ICMS por ST" },
  { cod: "40", desc: "Isenta" },
  { cod: "41", desc: "Não Tributada" },
  { cod: "50", desc: "Com Suspensão" },
  { cod: "51", desc: "Com Diferimento" },
  { cod: "60", desc: "ICMS Cobrado na Operação Anterior por Substituição Tributária" },
  { cod: "70", desc: "Com redução de base de cálculo no ICMS ST" },
  { cod: "90", desc: "Outras Operações" },
];

export const CSOSN_OPTIONS: CstCsosn[] = [
  { cod: "101", desc: "Tributada pelo Simples Nacional com permissão de crédito" },
  { cod: "102", desc: "Tributada pelo Simples Nacional sem permissão de crédito" },
  { cod: "103", desc: "Isenção do ICMS no Simples Nacional para faixa de receita" },
  { cod: "201", desc: "Tributada com permissão de crédito e com ST" },
  { cod: "202", desc: "Tributada sem permissão de crédito e com ST" },
  { cod: "203", desc: "Isenção no Simples por faixa de receita e com ST" },
  { cod: "300", desc: "Imune" },
  { cod: "400", desc: "Não Tributada" },
  { cod: "500", desc: "ICMS cobrado anteriormente por substituição tributária (ST)" },
  { cod: "900", desc: "Outros" },
];

export const CST_PIS_OPTIONS: CstCsosn[] = [
  { cod: "01", desc: "Operação Tributável com Alíquota Básica." },
  { cod: "02", desc: "Operação Tributável com Alíquota Diferenciada." },
  { cod: "03", desc: "Operação Tributável com Alíquota por Unidade de Medida de Produto." },
  { cod: "04", desc: "Operação Tributável Monofásica - Revenda a Alíquota Zero." },
  { cod: "05", desc: "Operação Tributável por Substituição Tributária." },
  { cod: "06", desc: "Operação Tributável a Alíquota Zero." },
  { cod: "07", desc: "Operação Isenta de Contribuição." },
  { cod: "08", desc: "Operação sem Incidência da Contribuição." },
  { cod: "09", desc: "Operação com Suspensão da Contribuição." },
  { cod: "49", desc: "Outras Operações de Saída" },
  { cod: "99", desc: "Outras Operações" },
];

export const ESTOQUE_STATUS_BADGES: {
  value: Estoque_status;
  badge?: "default" | "secondary" | "destructive" | "outline";
}[] = [
  { value: Estoque_status.OK, badge: "outline" },
  { value: Estoque_status.BAIXO, badge: "secondary" },
  { value: Estoque_status.CRITICO, badge: "destructive" },
  { value: Estoque_status.SEM_ESTOQUE, badge: "default" },
];
