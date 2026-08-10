// src/app/(app)/(pages)/ordens/components/orcamento/servicos/api-orcamento.ts
import { ItemProduto, ItemProdutoAvulso, ItemServico, ProdutoBusca, ServicoBusca, TipoDesconto } from "../tipos";

/** Util */
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Erro específico p/ falta de estoque */
export type EstoqueInsuficienteItem = {
  id: number;
  titulo: string;
  disponivel: number;
  solicitado: number;
};

export class EstoqueInsuficienteError extends Error {
  itens: EstoqueInsuficienteItem[];
  constructor(message: string, itens: EstoqueInsuficienteItem[]) {
    super(message);
    this.name = "EstoqueInsuficienteError";
    this.itens = itens;
  }
}

/* =========================
 * BUSCAS
 * ========================= */
export async function buscarProdutosAPI(params: { q?: string; codigo?: string }) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.codigo) qs.set("codigo", params.codigo);

  const r = await fetch(`/api/produtos/buscar?${qs.toString()}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Erro ao buscar produtos");

  const arr = Array.isArray(j?.produtos) ? j.produtos : Array.isArray(j?.items) ? j.items : [];
  const produtos: ProdutoBusca[] = arr.map((p: any) => ({
    id: Number(p.id),
    codigo: String(p.codigo ?? p.referencia ?? ""),
    referencia: String(p.referencia ?? p.codigo ?? "").trim() || null,
    etiqueta: String(p.etiqueta ?? "").trim() || null,
    descricao: String(p.descricao ?? p.titulo ?? ""),
    precounitario: toNum(p.precounitario ?? p.precovenda ?? 0),
    estoque: toNum(p.estoque ?? 0),
  }));
  return produtos;
}

export async function buscarServicosAPI(params: { q?: string; codigo?: string }) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.codigo) qs.set("codigo", params.codigo);

  const r = await fetch(`/api/servicos/buscar?${qs.toString()}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Erro ao buscar serviços");

  const arr = Array.isArray(j?.servicos) ? j.servicos : Array.isArray(j?.items) ? j.items : [];
  const servicos: ServicoBusca[] = arr.map((s: any) => ({
    id: Number(s.id),
    codigo: String(s.codigo ?? ""),
    referencia: String(s.codigo ?? "").trim() || null,
    descricao: String(s.descricao ?? ""),
    precohora: toNum(s.precohora ?? 0),
  }));
  return servicos;
}

/* =========================
 * CARREGAR ITENS DA OS
 * ========================= */
export async function carregarItensDaOSAPI(osId: number) {
  const r = await fetch(`/api/ordens/${osId}/orcamento`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Falha ao carregar orçamento");

  const produtos: ItemProduto[] = (j?.produtos ?? []).map((p: any) => ({
    produtoid: Number(p.produtoid),
    descricao: String(p.descricao ?? ""),
    referencia: String(p.referencia ?? "").trim() || null,
    etiqueta: String(p.etiqueta ?? "").trim() || null,
    quantidade: toNum(p.quantidade ?? 1),
    precounitario: toNum(p.precounitario ?? 0),
    subtotal: toNum(p.subtotal ?? toNum(p.quantidade ?? 1) * toNum(p.precounitario ?? 0)),
    descontoTipo: (p.descontoTipo ?? null) as TipoDesconto | null,
    desconto: toNum(p.desconto ?? 0),
  }));

  const servicos: ItemServico[] = (j?.servicos ?? []).map((s: any) => ({
    servicoid: Number(s.servicoid),
    descricao: String(s.descricao ?? ""),
    referencia: String(s.referencia ?? "").trim() || null,
    descricaoServico: s.descricaoServico ?? null,
    quantidade: toNum(s.quantidade ?? 1),
    precounitario: toNum(s.precounitario ?? 0),
    subtotal: toNum(s.subtotal ?? toNum(s.quantidade ?? 1) * toNum(s.precounitario ?? 0)),
    descontoTipo: (s.descontoTipo ?? null) as TipoDesconto | null,
    desconto: toNum(s.desconto ?? 0),
  }));

  const produtosAvulsos: ItemProdutoAvulso[] = (j?.produtosAvulsos ?? []).map((p: any) => ({
    id: Number(p.id),
    titulo: String(p.titulo ?? ""),
    quantidade: toNum(p.quantidade ?? 1),
    precounitario: toNum(p.precounitario ?? 0),
    subtotal: toNum(p.subtotal ?? 0),
    descontoTipo: (p.descontoTipo ?? null) as TipoDesconto | null,
    desconto: toNum(p.desconto ?? 0),
  }));

  return {
    produtos,
    produtosAvulsos,
    servicos,
    descontoTipo: (j?.descontoTipo ?? null) as TipoDesconto | null,
    desconto: toNum(j?.desconto ?? 0),
    valorFrete: toNum(j?.valorFrete ?? 0),
  };
}

/* =========================
 * SALVAR ORÇAMENTO
 * - backend valida/baixa/estorna estoque;
 * - em caso de estoque insuficiente, retorna 400 com { itens: [...] }.
 * ========================= */
export async function salvarOrcamentoAPI(
  osId: number,
  itensProduto: ItemProduto[],
  itensProdutoAvulso: ItemProdutoAvulso[],
  itensServico: ItemServico[],
  descontoTipo?: TipoDesconto | null,
  desconto?: number,
  valorFrete?: number,
) {
  const body = {
    produtos: itensProduto.map((p) => ({
      produtoid: p.produtoid,
      quantidade: p.quantidade,
      precounitario: p.precounitario,
      subtotal: p.subtotal,
      descontoTipo: p.descontoTipo ?? null,
      desconto: p.desconto ?? 0,
    })),
    produtosAvulsos: itensProdutoAvulso.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      quantidade: p.quantidade,
      precounitario: p.precounitario,
      descontoTipo: p.descontoTipo ?? null,
      desconto: p.desconto ?? 0,
    })),
    servicos: itensServico.map((s) => ({
      servicoid: s.servicoid,
      descricao: s.descricaoServico ?? null,
      quantidade: s.quantidade,
      precounitario: s.precounitario,
      subtotal: s.subtotal,
      descontoTipo: s.descontoTipo ?? null,
      desconto: s.desconto ?? 0,
    })),
    descontoTipo: descontoTipo ?? null,
    desconto: desconto ?? 0,
    valorFrete: Math.max(0, toNum(valorFrete)),
  };

  const r = await fetch(`/api/ordens/${osId}/orcamento`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // estoque insuficiente tratado especialmente
    if ((r.status === 400 || r.status === 409) && Array.isArray(j?.itens)) {
      const itens: EstoqueInsuficienteItem[] = j.itens.map((it: any) => ({
        id: Number(it.id),
        titulo: String(it.titulo ?? `Produto #${it.id}`),
        disponivel: toNum(it.disponivel),
        solicitado: toNum(it.solicitado),
      }));
      throw new EstoqueInsuficienteError(j?.error || "Estoque insuficiente", itens);
    }
    throw new Error(j?.error || "Falha ao salvar orçamento");
  }

  return j as { ok: true; totalGeral: number; aviso?: string | null };
}

export async function vincularProdutoAvulsoAPI(osId: number, avulsoId: number, produtoId: number) {
  const response = await fetch(`/api/ordens/${osId}/produtos-avulsos/${avulsoId}/vincular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ produtoId }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error || "Falha ao vincular produto avulso");
  return json;
}

/* =========================
 * ATUALIZAR STATUS DA OS
 * (o backend já estorna quando muda para ORCAMENTO_RECUSADO)
 * ========================= */
export async function atualizarStatusOS(osId: number, status: string) {
  const r = await fetch(`/api/ordens/${osId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Falha ao atualizar status da OS");
  return j as { ok: true; id?: number; status?: string };
}
