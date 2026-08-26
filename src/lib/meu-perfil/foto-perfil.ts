export const FOTO_PERFIL_MAX_BYTES = 8 * 1024 * 1024;
export const FOTO_PERFIL_OUTPUT_SIZE = 512;
export const FOTO_PERFIL_BUCKET = "usuario-avatar";

const TIPOS_ACEITOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

export type ErroValidacaoFoto = {
  status: 400;
  mensagem: string;
};

export function validarFotoSelecionada(file: File): ErroValidacaoFoto | null {
  if (file.size <= 0) {
    return { status: 400, mensagem: "Selecione uma imagem válida." };
  }
  if (file.size > FOTO_PERFIL_MAX_BYTES) {
    return { status: 400, mensagem: "A imagem deve ter no máximo 8 MB." };
  }
  if (!TIPOS_ACEITOS.has(file.type.toLowerCase())) {
    return {
      status: 400,
      mensagem: "Use uma imagem JPG, PNG, WebP, AVIF ou HEIC.",
    };
  }
  return null;
}

export function criarPathFotoPerfil(usuarioId: string, identificador: string): string {
  return `${usuarioId}/${identificador}.webp`;
}

export function pathAnteriorPertenceAoUsuario(path: unknown, usuarioId: string): path is string {
  return typeof path === "string" && path.startsWith(`${usuarioId}/`) && !path.includes("..", usuarioId.length + 1);
}
