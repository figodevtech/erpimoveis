import { PERMS, tipoPermission, type Permission, type TipoId } from "./permission-constants";

const API_TIPO: Record<string, TipoId> = {
  "grupos-produto": "grupos",
  "grupos-usoconsumo": "grupos_usoconsumo",
  "unidades-medida": "unidades",
  servicos: "servicos",
  fornecedores: "fornecedores",
  setores: "setores",
  bancos: "bancos",
  "categorias-transacao": "categorias",
  bandeiras: "bandeiras",
  "planos-de-conta": "planos_conta",
  "grupos-planos-de-conta": "planos_conta",
  "centros-de-custo": "centros_custo",
  "categorias-venda": "categorias_venda",
  "tipos-entrada": "tipos_entrada",
  "motivos-saida": "motivos_saida",
};

/** Leituras continuam disponíveis para formulários de outros módulos. */
export function tipoMutationPermission(pathname: string, method: string): Permission | null {
  if (!pathname.startsWith("/api/tipos/")) return null;
  const verb = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(verb)) return null;

  const resource = pathname.split("/")[3];
  const id = API_TIPO[resource];
  if (!id) return PERMS.CONFIG_EDITAR;

  if (verb === "POST") return tipoPermission(id, "criar");
  if (verb === "PUT" || verb === "PATCH") return tipoPermission(id, "editar");
  if (verb === "DELETE") return tipoPermission(id, "excluir");
  return PERMS.CONFIG_EDITAR;
}
