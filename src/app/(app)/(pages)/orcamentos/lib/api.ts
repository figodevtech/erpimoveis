import type {
  ListaOrcamentos,
  OrcamentoDetalhe,
  PayloadGerarOS,
  PayloadOrcamento,
  SituacaoOrcamento,
} from "../types";

async function comoJson(resposta: Response, erroPadrao: string) {
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(json?.error || erroPadrao) as Error & {
      status?: number;
      codigo?: string;
      itens?: unknown;
    };
    erro.status = resposta.status;
    erro.codigo = json?.codigo;
    erro.itens = json?.itens;
    throw erro;
  }
  return json;
}

export type FiltrosOrcamentos = {
  situacao?: SituacaoOrcamento;
  q?: string;
  cliente?: string;
  page?: number;
  limit?: number;
};

export async function listarOrcamentos(filtros: FiltrosOrcamentos): Promise<ListaOrcamentos> {
  const qs = new URLSearchParams();
  if (filtros.situacao) qs.set("situacao", filtros.situacao);
  if (filtros.q) qs.set("q", filtros.q);
  if (filtros.cliente) qs.set("cliente", filtros.cliente);
  qs.set("page", String(filtros.page ?? 1));
  qs.set("limit", String(filtros.limit ?? 10));

  const resposta = await fetch(`/api/orcamentos?${qs.toString()}`, { cache: "no-store" });
  return (await comoJson(resposta, "Falha ao listar orçamentos")) as ListaOrcamentos;
}

export async function carregarOrcamento(id: number): Promise<OrcamentoDetalhe> {
  const resposta = await fetch(`/api/orcamentos/${id}`, { cache: "no-store" });
  return (await comoJson(resposta, "Falha ao carregar orçamento")) as OrcamentoDetalhe;
}

export async function criarOrcamento(payload: PayloadOrcamento) {
  const resposta = await fetch("/api/orcamentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await comoJson(resposta, "Falha ao criar orçamento")) as { id: number };
}

export async function salvarOrcamento(id: number, payload: PayloadOrcamento) {
  const resposta = await fetch(`/api/orcamentos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await comoJson(resposta, "Falha ao salvar orçamento")) as { ok: true };
}

export async function descartarOrcamento(id: number) {
  const resposta = await fetch(`/api/orcamentos/${id}`, { method: "DELETE" });
  return (await comoJson(resposta, "Falha ao descartar orçamento")) as { ok: true };
}

export async function gerarOSDoOrcamento(id: number, payload: PayloadGerarOS) {
  const resposta = await fetch(`/api/orcamentos/${id}/gerar-os`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await comoJson(resposta, "Falha ao gerar OS")) as {
    ok: true;
    ordemservicoid: number;
  };
}

// A OS ja resolve setor (incluindo o filtro de inativos); reaproveitamos para
// as duas telas nao divergirem sobre quais setores existem.
export { listarSetores } from "../../ordens/lib/api";
