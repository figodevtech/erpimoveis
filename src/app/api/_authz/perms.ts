// app/api/_authz/perms.ts
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
export { PERMS, type Permission } from "./permission-constants";
import { expandPermissions, PERMS, permissionSetHas, type Permission } from "./permission-constants";

/**
 * Mapa centralizado de permissões (mesmo nome que está no banco).
 * Mantemos tudo em CAIXA ALTA e tipado.
 */
/**
 * Lê as permissões do usuário logado (por perfil) e retorna como Set em caixa alta.
 * Faz fallback por email se necessário.
 */
export async function getUserPermissionSet(): Promise<Set<string>> {
  const session = await auth();
  if (!session?.user) throw new Error("Não autenticado");

  const uid = (session.user as any).id as string;
  const email = (session.user as any).email as string | undefined;

  // 1) tenta por id
  let perfilId: number | null = null;
  {
    const byId = await supabaseAdmin.from("usuario").select("perfilid").eq("id", uid).maybeSingle();

    if (byId.data?.perfilid) {
      perfilId = Number(byId.data.perfilid);
    } else if (email) {
      // 2) fallback por email
      const byEmail = await supabaseAdmin.from("usuario").select("perfilid").eq("email", email).maybeSingle();
      if (byEmail.data?.perfilid) perfilId = Number(byEmail.data.perfilid);
    }
  }

  if (!perfilId) return new Set<string>();

  const { data, error } = await supabaseAdmin
    .from("perfilpermissao")
    .select("permissao:permissaoid ( nome )")
    .eq("perfilid", perfilId);

  if (error) throw error;

  const list = expandPermissions((data ?? []).map((r: any) => r?.permissao?.nome));

  return new Set(list);
}

/* -------------------- Funções genéricas -------------------- */

export async function requireAuthenticated() {
  const session = await auth();
  if (!session?.user) {
    const error = new Error("Não autenticado");
    (error as any).statusCode = 401;
    throw error;
  }
  return session;
}

export async function hasPerm(perm: Permission): Promise<boolean> {
  const perms = await getUserPermissionSet();
  return permissionSetHas(Array.from(perms), perm);
}

export async function requirePerm(perm: Permission) {
  const ok = await hasPerm(perm);
  if (!ok) {
    const err = new Error(`Permissão negada (requer ${perm})`);
    (err as any).statusCode = 403;
    throw err;
  }
}

export async function hasAny(permsToCheck: Permission[]): Promise<boolean> {
  const perms = await getUserPermissionSet();
  return permsToCheck.some((p) => permissionSetHas(Array.from(perms), p));
}

export async function requireAny(permsToCheck: Permission[]) {
  const ok = await hasAny(permsToCheck);
  if (!ok) {
    const err = new Error(`Permissão negada (requer uma de: ${permsToCheck.join(", ")})`);
    (err as any).statusCode = 403;
    throw err;
  }
}

export async function hasAll(permsToCheck: Permission[]): Promise<boolean> {
  const perms = await getUserPermissionSet();
  return permsToCheck.every((p) => permissionSetHas(Array.from(perms), p));
}

export async function requireAll(permsToCheck: Permission[]) {
  const ok = await hasAll(permsToCheck);
  if (!ok) {
    const err = new Error(`Permissão negada (requer todas: ${permsToCheck.join(", ")})`);
    (err as any).statusCode = 403;
    throw err;
  }
}

/* -------------------- Atalhos por área (conveniência) -------------------- */
// Ordens
export async function hasOSAccess() {
  return hasPerm(PERMS.ORDENS);
}
export async function requireOSAccess() {
  return requirePerm(PERMS.ORDENS);
}

// Dashboard
export async function hasDashboardAccess() {
  return hasPerm(PERMS.DASHBOARD);
}
export async function requireDashboardAccess() {
  return requirePerm(PERMS.DASHBOARD);
}

// Clientes
export async function hasClientesAccess() {
  return hasPerm(PERMS.CLIENTES);
}
export async function requireClientesAccess() {
  return requirePerm(PERMS.CLIENTES);
}
export async function requireClientesCreate() {
  return requirePerm(PERMS.CLIENTES_CRIAR);
}
export async function requireClientesEdit() {
  return requirePerm(PERMS.CLIENTES_EDITAR);
}
export async function requireClientesDelete() {
  return requirePerm(PERMS.CLIENTES_EXCLUIR);
}

// Usuários
export async function hasUsuariosAccess() {
  return hasPerm(PERMS.USUARIOS);
}
export async function requireUsuariosAccess() {
  return requirePerm(PERMS.USUARIOS);
}
export async function requireUsuariosCreate() {
  return requirePerm(PERMS.USUARIOS_CRIAR);
}
export async function requireUsuariosEdit() {
  return requirePerm(PERMS.USUARIOS_EDITAR);
}
export async function requireUsuariosDelete() {
  return requirePerm(PERMS.USUARIOS_EXCLUIR);
}

// Config
export async function hasConfigAccess() {
  return hasPerm(PERMS.CONFIG);
}
export async function requireConfigAccess() {
  return requirePerm(PERMS.CONFIG);
}
export async function requireConfigEdit() {
  return requirePerm(PERMS.CONFIG_EDITAR);
}

// Estoque
export async function hasEstoqueAccess() {
  return hasPerm(PERMS.ESTOQUE);
}
export async function requireEstoqueAccess() {
  return requirePerm(PERMS.ESTOQUE);
}
export async function requireEstoqueCreate() {
  return requirePerm(PERMS.ESTOQUE_CRIAR);
}
export async function requireEstoqueEdit() {
  return requirePerm(PERMS.ESTOQUE_EDITAR);
}
export async function requireEstoqueDelete() {
  return requirePerm(PERMS.ESTOQUE_EXCLUIR);
}

// Estoque de uso e consumo
export async function requireUsoConsumoAccess() {
  return requirePerm(PERMS.USOCONSUMO);
}
export async function requireUsoConsumoCreate() {
  return requirePerm(PERMS.USOCONSUMO_CRIAR);
}
export async function requireUsoConsumoEdit() {
  return requirePerm(PERMS.USOCONSUMO_EDITAR);
}
export async function requireUsoConsumoDelete() {
  return requirePerm(PERMS.USOCONSUMO_EXCLUIR);
}
export async function requireUsoConsumoEntrada() {
  return requirePerm(PERMS.USOCONSUMO_ENTRADA);
}
export async function requireUsoConsumoSaida() {
  return requirePerm(PERMS.USOCONSUMO_SAIDA);
}
export async function requireUsoConsumoCancelar() {
  return requirePerm(PERMS.USOCONSUMO_CANCELAR);
}

// Acompanhamento
export async function hasAcompanhamentoAccess() {
  return hasPerm(PERMS.ACOMPANHAMENTO);
}
export async function requireAcompanhamentoAccess() {
  return requirePerm(PERMS.ACOMPANHAMENTO);
}

// Relatórios
export async function hasRelatoriosAccess() {
  return hasPerm(PERMS.RELATORIOS);
}
export async function requireRelatoriosAccess() {
  return requirePerm(PERMS.RELATORIOS);
}

// Radios
export async function hasRadiosAccess() {
  return hasPerm(PERMS.RADIOS);
}
export async function requireRadiosAccess() {
  return requirePerm(PERMS.RADIOS);
}
export async function requireRadiosCreate() {
  return requirePerm(PERMS.RADIOS_CRIAR);
}
export async function requireRadiosEdit() {
  return requirePerm(PERMS.RADIOS_EDITAR);
}
export async function requireRadiosDelete() {
  return requirePerm(PERMS.RADIOS_EXCLUIR);
}

export async function hasAgendamentosAccess() {
  return hasPerm(PERMS.AGENDAMENTOS);
}
export async function requireAgendamentosAccess() {
  return requirePerm(PERMS.AGENDAMENTOS);
}
export async function requireAgendamentosCreate() {
  return requirePerm(PERMS.AGENDAMENTOS_CRIAR);
}
export async function requireAgendamentosEdit() {
  return requirePerm(PERMS.AGENDAMENTOS_EDITAR);
}
export async function requireAgendamentosDelete() {
  return requirePerm(PERMS.AGENDAMENTOS_EXCLUIR);
}

export async function hasFinanceiroAccess() {
  return hasPerm(PERMS.FINANCEIRO);
}
export async function requireFinanceirosAccess() {
  return requirePerm(PERMS.FINANCEIRO);
}
export async function requireFinanceiroCreate() {
  return requirePerm(PERMS.FINANCEIRO_CRIAR);
}
export async function requireFinanceiroEdit() {
  return requirePerm(PERMS.FINANCEIRO_EDITAR);
}
export async function requireFinanceiroDelete() {
  return requirePerm(PERMS.FINANCEIRO_EXCLUIR);
}

export async function hasVendasAccess() {
  return hasPerm(PERMS.VENDAS);
}
export async function requireVendasAccess() {
  return requirePerm(PERMS.VENDAS);
}
export async function requireVendasCreate() {
  return requirePerm(PERMS.VENDAS_CRIAR);
}
export async function requireVendasEdit() {
  return requirePerm(PERMS.VENDAS_EDITAR);
}
export async function requireVendasDelete() {
  return requirePerm(PERMS.VENDAS_EXCLUIR);
}

/* -------------------- Emissão fiscal -------------------- */

/**
 * Quem pode transmitir, cancelar ou consultar um documento fiscal.
 *
 * A mesma rota atende notas nascidas de OS, venda, entrada e emissão avulsa,
 * então a permissão aceita qualquer uma das áreas que já pode criar o rascunho
 * correspondente — exigir só FINANCEIRO trancaria quem emite pela tela da OS.
 *
 * Antes disso estas rotas não tinham checagem nenhuma: bastava estar logado
 * para autorizar ou cancelar nota na SEFAZ.
 */
export async function requireEmissaoFiscalAccess() {
  return requirePerm(PERMS.FINANCEIRO_NOTAS_FISCAIS);
}

export async function hasVeiculosAccess() {
  return hasPerm(PERMS.VEICULOS);
}
export async function requireVeiculosAccess() {
  return requirePerm(PERMS.VEICULOS);
}
export async function requireVeiculosCreate() {
  return requirePerm(PERMS.VEICULOS_CRIAR);
}
export async function requireVeiculosEdit() {
  return requirePerm(PERMS.VEICULOS_EDITAR);
}
export async function requireVeiculosDelete() {
  return requirePerm(PERMS.VEICULOS_EXCLUIR);
}

export async function hasOrcamentosAccess() {
  return hasPerm(PERMS.ORCAMENTOS);
}
export async function requireOrcamentosAccess() {
  return requirePerm(PERMS.ORCAMENTOS);
}
export async function requireOrcamentosCreate() {
  return requirePerm(PERMS.ORCAMENTOS_CRIAR);
}
export async function requireOrcamentosEdit() {
  return requirePerm(PERMS.ORCAMENTOS_EDITAR);
}
export async function requireOrcamentosDelete() {
  return requirePerm(PERMS.ORCAMENTOS_EXCLUIR);
}

export async function hasDesmancheAccess() {
  return hasPerm(PERMS.DESMANCHE);
}
export async function requireDesmancheAccess() {
  return requirePerm(PERMS.DESMANCHE);
}
export async function requireDesmancheCreate() {
  return requirePerm(PERMS.DESMANCHE_CRIAR);
}
export async function requireDesmancheEdit() {
  return requirePerm(PERMS.DESMANCHE_EDITAR);
}
export async function requireDesmancheDelete() {
  return requirePerm(PERMS.DESMANCHE_EXCLUIR);
}

export async function hasExecucaoOSAccess() {
  return hasPerm(PERMS.EXECUCAO_OS);
}
export async function requireExecucaoOSAccess() {
  return requirePerm(PERMS.EXECUCAO_OS);
}
export async function requireOSCreate() {
  return requirePerm(PERMS.ORDENS_CRIAR);
}
export async function hasOSRentabilidade() {
  return hasPerm(PERMS.ORDENS_RENTABILIDADE);
}
export async function requireOSRentabilidade() {
  return requirePerm(PERMS.ORDENS_RENTABILIDADE);
}
export async function hasOSFinalizarSemCobranca() {
  return hasPerm(PERMS.ORDENS_FINALIZAR_SEM_COBRANCA);
}
export async function requireOSFinalizarSemCobranca() {
  return requirePerm(PERMS.ORDENS_FINALIZAR_SEM_COBRANCA);
}
export async function hasOSEventosFinanceiros() {
  return hasPerm(PERMS.ORDENS_EVENTOS_FINANCEIROS);
}
export async function requireOSEventosFinanceiros() {
  return requirePerm(PERMS.ORDENS_EVENTOS_FINANCEIROS);
}
export async function requireOSEdit() {
  return requirePerm(PERMS.ORDENS_EDITAR);
}
export async function requireOSDelete() {
  return requirePerm(PERMS.ORDENS_EXCLUIR);
}

