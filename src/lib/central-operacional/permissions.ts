import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { OPERATIONAL_MODULES, type OperationalModule } from "./contracts";

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
