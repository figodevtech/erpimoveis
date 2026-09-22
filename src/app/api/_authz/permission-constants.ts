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
  ORDENS_RENTABILIDADE: "ordens:rentabilidade",
  ORDENS_EVENTOS_FINANCEIROS: "ordens:eventos_financeiros",
  ORDENS_FINALIZAR_SEM_COBRANCA: "ordens:finalizar_sem_cobranca",
  ORDENS_EXCLUIR_CHECKLIST_ASSINADO: "ordens:excluir_checklist_assinado",
  // Troca o criador e transfere a comissao de criacao. Sem backfill: concedida a dedo.
  ORDENS_ALTERAR_CRIADOR: "ordens:alterar_criador",

  ORCAMENTOS: "orcamentos:visualizar",
  ORCAMENTOS_CRIAR: "orcamentos:criar",
  ORCAMENTOS_EDITAR: "orcamentos:editar",
  ORCAMENTOS_EXCLUIR: "orcamentos:excluir",

  ESTOQUE: "estoque:visualizar",
  ESTOQUE_CRIAR: "estoque:criar",
  ESTOQUE_EDITAR: "estoque:editar",
  ESTOQUE_EXCLUIR: "estoque:excluir",

  USOCONSUMO: "usoconsumo:visualizar",
  USOCONSUMO_CRIAR: "usoconsumo:criar",
  USOCONSUMO_EDITAR: "usoconsumo:editar",
  USOCONSUMO_EXCLUIR: "usoconsumo:excluir",
  USOCONSUMO_ENTRADA: "usoconsumo:entrada",
  USOCONSUMO_SAIDA: "usoconsumo:saida",
  USOCONSUMO_CANCELAR: "usoconsumo:cancelar_movimento",

  FINANCEIRO: "financeiro:visualizar",
  FINANCEIRO_CRIAR: "financeiro:criar",
  FINANCEIRO_EDITAR: "financeiro:editar",
  FINANCEIRO_EXCLUIR: "financeiro:excluir",
  FINANCEIRO_NOTAS_FISCAIS: "financeiro:notas_fiscais",
  // Modificador da listagem do fluxo de caixa, nao um segundo "visualizar":
  // sem ela a pessoa ve o que criou (e o que nao tem dono), com ela ve tudo.
  // Fica fora de IMPLIED_PERMISSIONS de proposito — conceder esta nao pode
  // valer como conceder o acesso ao financeiro.
  FINANCEIRO_VER_TODAS_TRANSACOES: "financeiro:ver_todas_transacoes",
  FISCAL_SPED: "fiscal:sped",
  FISCAL_SPED_GERENCIAR: "fiscal:sped_gerenciar",
  // Regras de DIFAL/FCP por UF: alterar uma muda o imposto de toda nota futura.
  FISCAL_DIFAL: "fiscal:difal",
  FISCAL_DIFAL_GERENCIAR: "fiscal:difal_gerenciar",

  RELATORIOS: "relatorios:visualizar",

  RADIOS: "radios:visualizar",
  RADIOS_CRIAR: "radios:criar",
  RADIOS_EDITAR: "radios:editar",
  RADIOS_EXCLUIR: "radios:excluir",

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
  // Navegar entre perfis em /meu-perfil. Independe de USUARIOS, que abre o
  // cadastro com salario e comissoes.
  USUARIOS_VER_PERFIS: "usuarios:ver-perfis",

  PERMISSOES: "permissoes:visualizar",
  PERMISSOES_CRIAR: "permissoes:criar",
  PERMISSOES_EDITAR: "permissoes:editar",
  PERMISSOES_EXCLUIR: "permissoes:excluir",

  ACOMPANHAMENTO: "acompanhamento:visualizar",

  VENDAS: "vendas:visualizar",
  VENDAS_CRIAR: "vendas:criar",
  VENDAS_EDITAR: "vendas:editar",
  VENDAS_EXCLUIR: "vendas:excluir",
  // Troca o vendedor e transfere a comissao. Sem backfill: concedida a dedo,
  // pela mesma razao de ORDENS_ALTERAR_CRIADOR.
  VENDAS_ALTERAR_VENDEDOR: "vendas:alterar_vendedor",

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

const IMPLIED_PERMISSIONS: Record<string, Permission[]> = {
  [normalizePermission(PERMS.FISCAL_SPED_GERENCIAR)]: [PERMS.FISCAL_SPED],
  [normalizePermission(PERMS.FISCAL_DIFAL_GERENCIAR)]: [PERMS.FISCAL_DIFAL],
  [normalizePermission(PERMS.FINANCEIRO_NOTAS_FISCAIS)]: [PERMS.FINANCEIRO],
  [normalizePermission(PERMS.ESTOQUE)]: [PERMS.USOCONSUMO],
  [normalizePermission(PERMS.ESTOQUE_CRIAR)]: [PERMS.USOCONSUMO_CRIAR, PERMS.USOCONSUMO_ENTRADA],
  [normalizePermission(PERMS.ESTOQUE_EDITAR)]: [
    PERMS.USOCONSUMO_EDITAR,
    PERMS.USOCONSUMO_SAIDA,
    PERMS.USOCONSUMO_CANCELAR,
  ],
  [normalizePermission(PERMS.ESTOQUE_EXCLUIR)]: [PERMS.USOCONSUMO_EXCLUIR],
};

export function expandPermissions(permissoes: unknown): string[] {
  const raw = Array.isArray(permissoes) ? permissoes : [];
  const expanded = new Set<string>();

  for (const perm of raw) {
    const normalized = normalizePermission(perm);
    if (!normalized) continue;
    expanded.add(normalized);
    for (const implied of IMPLIED_PERMISSIONS[normalized] ?? []) {
      expanded.add(normalizePermission(implied));
    }
  }

  return Array.from(expanded);
}

export function permissionSetHas(permissoes: unknown, perm: Permission | string) {
  const target = normalizePermission(perm);
  return expandPermissions(permissoes).includes(target);
}
