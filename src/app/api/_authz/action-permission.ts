import type { Permission } from "./permission-constants";

export type ApiPermissionRule = {
  read: Permission;
  create?: Permission;
  edit?: Permission;
  delete?: Permission;
};

/** POST também executa ações sobre documentos existentes; não significa sempre criar. */
export function permissionForAction(pathname: string, method: string, rule: ApiPermissionRule): Permission {
  const verb = method.toUpperCase();
  if (verb === "POST") return rule.create ?? rule.edit ?? rule.read;
  if (verb === "PUT" || verb === "PATCH") return rule.edit ?? rule.read;
  if (verb === "DELETE") return rule.delete ?? rule.edit ?? rule.read;
  return rule.read;
}
