export type OrigemCobranca = "OS" | "VENDA";

export type MetodoPagamentoResumo = {
  metodo: string;
  valor: number;
  parcelas?: number | null;
};

export type CobrancaItem = {
  chave: string;
  origem: OrigemCobranca;
  id: number;
  status: string;
  cliente: string;
  setor: { id: number; nome: string } | null;
  responsavel: string | null;
  descricao: string | null;
  referencia: string | null;
  data: string | null;
  atualizadoEm: string | null;
  total: number;
  pago: number;
  saldo: number;
  percentual: number;
  ultimoPagamentoEm: string | null;
  pagamentosPrevistos: MetodoPagamentoResumo[] | null;
  pagamentosExecutados: MetodoPagamentoResumo[] | null;
};

export type QuadroFinanceiro = {
  aguardando: CobrancaItem[];
  parciais: CobrancaItem[];
  recebidos: CobrancaItem[];
  resumo: {
    quantidade: number;
    aReceber: number;
    recebido: number;
    total: number;
  };
  meta: {
    setorId: number | null;
    origem: OrigemCobranca | "TODAS";
    horasRecentes: number;
    atualizadoEm: string;
  };
};

export async function listarAcompanhamentoFinanceiro(params: {
  setorId?: number;
  origem?: OrigemCobranca | "TODAS";
  horasRecentes?: number;
}): Promise<QuadroFinanceiro> {
  const url = new URL("/api/acompanhamento/financeiro", window.location.origin);
  if (params.setorId) url.searchParams.set("setorId", String(params.setorId));
  if (params.origem) url.searchParams.set("origem", params.origem);
  if (params.horasRecentes) url.searchParams.set("horasRecentes", String(params.horasRecentes));

  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Falha ao carregar pagamentos");
  return body as QuadroFinanceiro;
}

export async function listarSetoresFinanceiro() {
  const response = await fetch("/api/tipos/setores", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Falha ao carregar setores");
  return (Array.isArray(body?.items) ? body.items : []).filter((item: any) => item?.ativo === true) as Array<{
    id: number;
    nome: string;
  }>;
}
