// ./src/app/(app)/(pages)/ordens/lib/api.ts

const JSONH = { "Content-Type": "application/json" };

// Helper genérico
async function handleJson<T>(r: Response, defaultError: string): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as any;

  if (!r.ok) {
    const msg = j?.error || j?.message || defaultError;
    throw new Error(msg);
  }

  return j as T;
}

/* =========================================================================
 * OS - criação / edição
 * ========================================================================= */
export async function criarOrdem(payload: any): Promise<{ id: number }> {
  const r = await fetch("/api/ordens/criar", {
    method: "POST",
    headers: JSONH,
    body: JSON.stringify(payload),
  });

  return handleJson<{ id: number }>(r, "Falha ao criar OS");
}

export async function editarOrdem(id: number, payload: any) {
  const r = await fetch(`/api/ordens/${id}`, {
    method: "PUT",
    headers: JSONH,
    body: JSON.stringify(payload),
  });

  return handleJson<any>(r, "Falha ao salvar OS");
}

/* =========================================================================
 * OS - status
 * ========================================================================= */
export type StatusOSApi =
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "AGUARDANDO_CHECKLIST"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FATURAMENTO"
  | "CONCLUIDO"
  | "CANCELADO";

export async function atualizarStatusOS(id: number, status: StatusOSApi) {
  const r = await fetch(`/api/ordens/${id}/status`, {
    method: "PUT",
    headers: JSONH,
    body: JSON.stringify({ status }),
  });

  return handleJson<any>(r, "Falha ao atualizar status da OS");
}

/* =========================================================================
 * OS - detalhes
 * ========================================================================= */
export async function carregarDetalhesOS<T = any>(osId: number): Promise<T> {
  const r = await fetch(`/api/ordens/${osId}`, { cache: "no-store" });
  return handleJson<T>(r, "Falha ao carregar OS");
}

/* =========================================================================
 * Responsáveis / usuários
 * ========================================================================= */
export type UsuarioAtivo = {
  id: string;
  nome: string | null;
  email?: string;
  setor?: { id: number; nome: string } | null;
  perfil?: { id: number; nome: string } | null;
  comissao_percent?: number | null;
};

/**
 * Lista os usuários que podem ser realizadores de um serviço da OS.
 * Usa a rota própria de ordens (permissão de OS) em vez de /api/users,
 * que exige a permissão de Usuários.
 */
export async function listarRealizadoresDisponiveis(): Promise<UsuarioAtivo[]> {
  const r = await fetch("/api/ordens/realizadores", { cache: "no-store" });
  const j = await handleJson<any>(r, "Falha ao listar realizadores");

  const items = Array.isArray(j) ? j : j.realizadores ?? [];
  return items.map((u: any) => ({
    id: String(u.id),
    nome: u.nome ?? u.email ?? null,
    email: u.email ?? undefined,
    setor: u.setor ?? null,
    perfil: u.perfil ?? null,
    comissao_percent: u.comissao_percent ?? null,
  }));
}

// NOVO (N:N)
export type AtualizarResponsaveisServicoResponse = {
  ordemservicoid: number;
  servicoid: number;
  usuarioIds: string[];
  idusuariorealizador: string | null;
  realizadores: Array<{ id: string; nome: string | null }>;
  /** A comissão recalculada alcançou mês já fechado na DRE. */
  aviso?: string | null;
};

/**
 * Atualiza os realizadores (N:N) de um serviço da OS
 */
export async function atualizarResponsaveisServico(
  osId: number,
  servicoId: number,
  usuarioIds: string[]
): Promise<AtualizarResponsaveisServicoResponse> {
  const r = await fetch(`/api/ordens/${osId}/servicos/${servicoId}/responsavel`, {
    method: "PUT",
    headers: JSONH,
    body: JSON.stringify({ usuarioIds }),
  });

  return handleJson<AtualizarResponsaveisServicoResponse>(r, "Falha ao salvar realizadores");
}

/* =========================================================================
 * Tipos / auxiliares (setores, checklist)
 * ========================================================================= */
export async function listarSetores(): Promise<{ id: number; nome: string }[]> {
  const r = await fetch("/api/tipos/setores", { cache: "no-store" });
  const j = await handleJson<any>(r, "Falha ao listar setores");

  const items = Array.isArray(j) ? j : j?.items ?? [];
  return items
    .filter((s: any) => s.ativo !== false) // só ativos
    .map((s: any) => ({
      id: Number(s.id),
      nome: String(s.nome ?? ""),
    }));
}

export type ChecklistTemplateItem = {
  titulo: string;
  descricao?: string | null;
  obrigatorio?: boolean;
};

export type ChecklistTemplateModel = {
  id: string;
  nome: string;
  itens: ChecklistTemplateItem[];
};

/**
 * Lista modelos de checklist.
 * - onlyAtivos=true => adiciona ?ativos=1 na query
 */
export async function listarChecklistModelos(onlyAtivos: boolean = true): Promise<ChecklistTemplateModel[]> {
  const qs = onlyAtivos ? "?ativos=1" : "";
  const r = await fetch(`/api/checklist-modelos${qs}`, { cache: "no-store" });
  const j = await handleJson<any>(r, "Falha ao listar modelos de checklist");

  const raw = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
  return raw.map((t: any) => ({
    id: String(t.id ?? t.uuid ?? ""),
    nome: String(t.nome ?? t.titulo ?? ""),
    itens: Array.isArray(t.itens)
      ? t.itens.map((it: any) => ({
          titulo: String(it.titulo ?? it.nome ?? ""),
          descricao: it.descricao ?? null,
          obrigatorio: it.obrigatorio ?? false,
        }))
      : [],
  }));
}
