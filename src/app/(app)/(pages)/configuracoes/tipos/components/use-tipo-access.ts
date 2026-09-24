"use client";

import { useSession } from "next-auth/react";
import { permissionSetHas, tipoPermission, type TipoId } from "@/app/api/_authz/permission-constants";

export function useTipoAccess(id: TipoId) {
  const { data: session } = useSession();
  const permissoes = (session?.user as { permissoes?: string[] } | undefined)?.permissoes;
  return {
    canCreate: permissionSetHas(permissoes, tipoPermission(id, "criar")),
    canEdit: permissionSetHas(permissoes, tipoPermission(id, "editar")),
    canDelete: permissionSetHas(permissoes, tipoPermission(id, "excluir")),
  };
}
