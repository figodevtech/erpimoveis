// types/usuario.ts
import type { Perfil } from "./perfil";
import type { Setor } from "./setor";
import type { EnumPermissoes } from "./enum";

export interface Usuario {
  id: string;                    // uuid (FK -> auth.users.id)
  email: string;
  username?: string | null;
  nome: string;
  setorid?: number | null;
  perfilid?: number | null;
  createdat?: string | null;
  updatedat?: string | null;
}

/** Forma “expandida” para o front e para a API */
export interface UsuarioExpandido extends Usuario {
  perfil?: Pick<Perfil, "id" | "nome"> | null;
  setor?: Pick<Setor, "id" | "nome"> | null;
  permissoes?: EnumPermissoes[];     // herdadas do perfil

  // campos camelCase que a API pode devolver
  createdAt?: string | null;
  updatedAt?: string | null;

  // helpers que a API devolve e/ou o front usa
  perfilId?: number;
  setorId?: number;
}
