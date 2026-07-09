/**
 * Constantes puras de permissoes.
 * Este arquivo nao importa auth/supabase e pode ser usado em client components.
 */
export const PERMS = {
  DASHBOARD: "dashboard:visualizar",

  CLIENTES: "clientes:visualizar",
  CLIENTES_CRIAR: "clientes:criar",
  CLIENTES_EDITAR: "clientes:editar",
  CLIENTES_EXCLUIR: "clientes:excluir",

  ORDENS: "ordens:visualizar",
  ORDENS_CRIAR: "ordens:criar",
  ORDENS_EDITAR: "ordens:editar",
  ORDENS_EXCLUIR: "ordens:excluir",

  ESTOQUE: "estoque:visualizar",
  ESTOQUE_CRIAR: "estoque:criar",
  ESTOQUE_EDITAR: "estoque:editar",
  ESTOQUE_EXCLUIR: "estoque:excluir",

  FINANCEIRO: "financeiro:visualizar",
  FINANCEIRO_CRIAR: "financeiro:criar",
  FINANCEIRO_EDITAR: "financeiro:editar",
  FINANCEIRO_EXCLUIR: "financeiro:excluir",

  RELATORIOS: "relatorios:visualizar",

  AGENDAMENTOS: "agendamentos:visualizar",
  AGENDAMENTOS_CRIAR: "agendamentos:criar",
  AGENDAMENTOS_EDITAR: "agendamentos:editar",
  AGENDAMENTOS_EXCLUIR: "agendamentos:excluir",

  CONFIG: "configuracoes:visualizar",
  CONFIG_EDITAR: "configuracoes:editar",

  USUARIOS: "usuarios:visualizar",
  USUARIOS_CRIAR: "usuarios:criar",
  USUARIOS_EDITAR: "usuarios:editar",
  USUARIOS_EXCLUIR: "usuarios:excluir",

  PERMISSOES: "permissoes:visualizar",
  PERMISSOES_CRIAR: "permissoes:criar",
  PERMISSOES_EDITAR: "permissoes:editar",
  PERMISSOES_EXCLUIR: "permissoes:excluir",

  ACOMPANHAMENTO: "acompanhamento:visualizar",

  VENDAS: "vendas:visualizar",
  VENDAS_CRIAR: "vendas:criar",
  VENDAS_EDITAR: "vendas:editar",
  VENDAS_EXCLUIR: "vendas:excluir",

  VEICULOS: "veiculos:visualizar",
  VEICULOS_CRIAR: "veiculos:criar",
  VEICULOS_EDITAR: "veiculos:editar",
  VEICULOS_EXCLUIR: "veiculos:excluir",

  DESMANCHE: "desmanche:visualizar",
  DESMANCHE_CRIAR: "desmanche:criar",
  DESMANCHE_EDITAR: "desmanche:editar",
  DESMANCHE_EXCLUIR: "desmanche:excluir",

  EXECUCAO_OS: "execucao_os:visualizar",
  EXECUCAO_OS_EDITAR: "execucao_os:editar",
} as const;

export type Permission = (typeof PERMS)[keyof typeof PERMS];

export function normalizePermission(perm: unknown) {
  return String(perm ?? "").trim().toUpperCase();
}

export function expandPermissions(permissoes: unknown): string[] {
  const raw = Array.isArray(permissoes) ? permissoes : [];
  const expanded = new Set<string>();

  for (const perm of raw) {
    const normalized = normalizePermission(perm);
    if (!normalized) continue;
    expanded.add(normalized);
  }

  return Array.from(expanded);
}

export function permissionSetHas(permissoes: unknown, perm: Permission | string) {
  const target = normalizePermission(perm);
  return expandPermissions(permissoes).includes(target);
}
