// lib/api.ts
"use client";

export type Perfil = { id: number; nome: string };
export type Setor = { id: number; nome: string };

export type Usuario = {
  id: number | string;
  nome: string;
  email: string;
  username?: string | null;

  // ids “normalizados” pro front
  perfilid?: number | null;
  setorid?: number | null;

  // relações (quando vierem)
  perfil?: Perfil | null;
  setor?: Setor | null;

  ativo?: boolean;

  // novos campos
  salario?: number | null;
  comissao_percent?: number | null;
  comissao_venda_percent?: number | null;
  comissao_criacao_servico_percent?: number | null;
  comissao_criacao_produto_percent?: number | null;
  comissao_criacao_somente_comissionaveis?: boolean;
  data_admissao?: string | null;
  data_demissao?: string | null;
};

export type UsuarioPayload = {
  nome: string;
  email: string;
  username: string;
  perfilid?: number | null;
  setorid?: number | null;
  ativo?: boolean;

  salario?: number | null;
  comissao_percent?: number | null;
  comissao_venda_percent?: number | null;
  comissao_criacao_servico_percent?: number | null;
  comissao_criacao_produto_percent?: number | null;
  comissao_criacao_somente_comissionaveis?: boolean;
  data_admissao?: string | null;
  data_demissao?: string | null;
};

// 🔹 Busca perfis e setores para o cadastro de usuários
export async function buscarListasUsuarios(): Promise<{
  perfis: Perfil[];
  setores: Setor[];
}> {
  const r = await fetch("/api/users/lookup", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Falha ao carregar listas auxiliares");

  const perfis: Perfil[] = Array.isArray(j?.perfis) ? j.perfis : [];
  const setores: Setor[] = Array.isArray(j?.setores) ? j.setores : [];
  return { perfis, setores };
}

// 🔹 Lista usuários
export async function buscarUsuarios(): Promise<Usuario[]> {
  const r = await fetch("/api/users", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Falha ao carregar usuários");

  const arr: any[] = Array.isArray(j?.users) ? j.users : [];

  return arr.map((u) => {
    const perfilIdNorm = u.perfilid ?? u.perfilId ?? u?.perfil?.id ?? u?.perfil?.Id ?? null;

    const setorIdNorm = u.setorid ?? u.setorId ?? u?.setor?.id ?? u?.setor?.Id ?? null;

    const salarioNorm = u.salario ?? u.salario_valor ?? null;

    const comissaoNorm = u.comissao_percent ?? u.comissaoPercent ?? u.comissao ?? null;
    const comissaoVendaNorm =
      u.comissao_venda_percent ?? u.comissaoVendaPercent ?? u.comissao_venda ?? null;

    const admissaoNorm = u.data_admissao ?? u.dataAdmissao ?? null;

    const demissaoNorm = u.data_demissao ?? u.dataDemissao ?? null;

    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      username: u.username ?? null,

      perfilid: typeof perfilIdNorm === "number" ? perfilIdNorm : perfilIdNorm ? Number(perfilIdNorm) : null,
      setorid: typeof setorIdNorm === "number" ? setorIdNorm : setorIdNorm ? Number(setorIdNorm) : null,

      perfil: u.perfil ?? null,
      setor: u.setor ?? null,

      ativo: typeof u.ativo === "boolean" ? u.ativo : true,

      salario: salarioNorm != null ? Number(salarioNorm) : null,
      comissao_percent: comissaoNorm != null ? Number(comissaoNorm) : null,
      comissao_venda_percent:
        comissaoVendaNorm != null ? Number(comissaoVendaNorm) : null,
      comissao_criacao_servico_percent:
        u.comissao_criacao_servico_percent != null
          ? Number(u.comissao_criacao_servico_percent)
          : null,
      comissao_criacao_produto_percent:
        u.comissao_criacao_produto_percent != null
          ? Number(u.comissao_criacao_produto_percent)
          : null,
      comissao_criacao_somente_comissionaveis:
        u.comissao_criacao_somente_comissionaveis === true,
      data_admissao: admissaoNorm ? String(admissaoNorm) : null,
      data_demissao: demissaoNorm ? String(demissaoNorm) : null,
    } as Usuario;
  });
}

// 🔹 Cria usuário
export async function criarUsuario(payload: UsuarioPayload) {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: payload.nome,
      email: payload.email,
      username: payload.username,

      // seu backend aceita perfilid/setorid (e também perfilId/setorId)
      perfilid: payload.perfilid ?? null,
      setorid: payload.setorid ?? null,

      ativo: payload.ativo,

      // novos campos (precisa tratar no backend / banco)
      salario: payload.salario ?? null,
      comissao_percent: payload.comissao_percent ?? null,
      comissao_venda_percent: payload.comissao_venda_percent ?? null,
      comissao_criacao_servico_percent: payload.comissao_criacao_servico_percent ?? null,
      comissao_criacao_produto_percent: payload.comissao_criacao_produto_percent ?? null,
      comissao_criacao_somente_comissionaveis:
        payload.comissao_criacao_somente_comissionaveis === true,
      data_admissao: payload.data_admissao ?? null,
      data_demissao: payload.data_demissao ?? null,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao criar usuário");

  // você já trabalha com backend retornando { users }
  return data.users;
}

// 🔹 Atualiza usuário
export async function atualizarUsuario(id: string | number, payload: UsuarioPayload) {
  const res = await fetch(`/api/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: payload.nome,
      email: payload.email,
      username: payload.username,

      // seu backend atual usa perfilId/setorId no PUT
      perfilId: payload.perfilid ?? null,
      setorId: payload.setorid ?? null,

      ativo: payload.ativo,

      // novos campos (precisa tratar no backend / banco)
      salario: payload.salario ?? null,
      comissao_percent: payload.comissao_percent ?? null,
      comissao_venda_percent: payload.comissao_venda_percent ?? null,
      comissao_criacao_servico_percent: payload.comissao_criacao_servico_percent ?? null,
      comissao_criacao_produto_percent: payload.comissao_criacao_produto_percent ?? null,
      comissao_criacao_somente_comissionaveis:
        payload.comissao_criacao_somente_comissionaveis === true,
      data_admissao: payload.data_admissao ?? null,
      data_demissao: payload.data_demissao ?? null,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao atualizar usuário");
  return data.users;
}

// 🔹 Exclui usuário
export async function excluirUsuario(id: string | number): Promise<void> {
  const r = await fetch(`/api/users/${id}`, { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Erro ao remover usuário");
}

// 🔹 Enviar convite (e-mail de definição/redefinição de senha)
export async function enviarConviteUsuario(id: string | number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "convite" }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao enviar convite");
}

// 🔹 Definir diretamente a senha do usuário
export async function definirSenhaUsuario(id: string | number, senha: string): Promise<void> {
  const res = await fetch(`/api/users/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "definir_senha", senha }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Erro ao definir senha do usuário");
}

export type ComissaoMes = {
  month: string; // "YYYY-MM"
  servicos: number; // soma de quantidade (ou “itens”)
  faturamento: number; // soma dos subtotais
  comissao: number; // faturamento * comissao_percent / 100
};

export type ComissaoUsuarioResumo = {
  comissao_percent: number;
  totalServicos: number;
  totalFaturamento: number;
  totalComissao: number;
  meses: ComissaoMes[];
};

export async function buscarComissaoUsuario(
  id: string | number,
  opts?: { dateFrom?: string; dateTo?: string }
): Promise<ComissaoUsuarioResumo> {
  const params = new URLSearchParams();
  if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) params.set("dateTo", opts.dateTo);

  const url = `/api/users/${id}/comissao${params.toString() ? `?${params}` : ""}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Falha ao carregar comissão do usuário");

  return {
    comissao_percent: Number(j?.comissao_percent ?? 0),
    totalServicos: Number(j?.totalServicos ?? 0),
    totalFaturamento: Number(j?.totalFaturamento ?? 0),
    totalComissao: Number(j?.totalComissao ?? 0),
    meses: Array.isArray(j?.meses) ? j.meses : [],
  };
}
