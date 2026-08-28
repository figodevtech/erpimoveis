import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import {
  OPERATIONAL_MODULES,
  type OperationalEventModule,
  type OperationalModule,
} from "./contracts";

export function allowedOperationalModules(permissions: unknown): OperationalModule[] {
  const allowed = new Set<OperationalModule>();

  if (permissionSetHas(permissions, PERMS.ACOMPANHAMENTO)) allowed.add("ORDENS");
  if (permissionSetHas(permissions, PERMS.VENDAS)) allowed.add("VENDAS");
  if (permissionSetHas(permissions, PERMS.FINANCEIRO)) {
    allowed.add("FINANCEIRO");
    allowed.add("CONTAS_RECEBER");
    allowed.add("CONTAS_PAGAR");
  }
  if (permissionSetHas(permissions, PERMS.ESTOQUE)) allowed.add("ESTOQUE");
  if (permissionSetHas(permissions, PERMS.FINANCEIRO_NOTAS_FISCAIS)) allowed.add("FISCAL");

  return OPERATIONAL_MODULES.filter((module) => allowed.has(module));
}

/**
 * O usuário pode abrir o detalhe de um evento deste módulo?
 *
 * `acompanhamento:visualizar` abre a Central, mas não é chave-mestra: o módulo
 * do evento passa pela mesma matriz que filtra o snapshot. Sem isso, quem só
 * acompanha a operação leria o detalhe financeiro e fiscal inteiro — dado que o
 * feed nunca chega a lhe mostrar.
 */
export function canOpenOperationalEvent(
  permissions: unknown,
  module: OperationalEventModule,
): boolean {
  return (allowedOperationalModules(permissions) as string[]).includes(module);
}

/**
 * Nome do cliente no detalhe do evento.
 *
 * A Central nasceu sem nome de cliente em lugar nenhum do feed. Abrir só o nome,
 * e só para quem já tem a permissão de clientes, é o menor relaxamento possível
 * dessa regra — documento, telefone, e-mail e endereço seguem fora, em qualquer
 * perfil.
 */
export function canViewClientName(permissions: unknown): boolean {
  return permissionSetHas(permissions, PERMS.CLIENTES);
}
