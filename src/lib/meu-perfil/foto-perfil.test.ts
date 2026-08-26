import assert from "node:assert/strict";
import test from "node:test";
import {
  FOTO_PERFIL_MAX_BYTES,
  criarPathFotoPerfil,
  pathAnteriorPertenceAoUsuario,
  validarFotoSelecionada,
} from "./foto-perfil";

function arquivo(tipo: string, tamanho = 3): File {
  return new File([new Uint8Array(tamanho)], "perfil", { type: tipo });
}

test("aceita os formatos de imagem suportados", () => {
  for (const tipo of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]) {
    assert.equal(validarFotoSelecionada(arquivo(tipo)), null);
  }
});

test("recusa arquivo vazio, grande ou de formato nao suportado", () => {
  assert.match(validarFotoSelecionada(arquivo("image/jpeg", 0))?.mensagem ?? "", /válida/);
  assert.match(
    validarFotoSelecionada(arquivo("image/jpeg", FOTO_PERFIL_MAX_BYTES + 1))?.mensagem ?? "",
    /8 MB/,
  );
  assert.match(validarFotoSelecionada(arquivo("image/svg+xml"))?.mensagem ?? "", /JPG/);
});

test("gera caminho isolado por usuario e so reconhece arquivos do proprio diretorio", () => {
  assert.equal(criarPathFotoPerfil("usuario-1", "foto-1"), "usuario-1/foto-1.webp");
  assert.equal(pathAnteriorPertenceAoUsuario("usuario-1/foto-antiga.webp", "usuario-1"), true);
  assert.equal(pathAnteriorPertenceAoUsuario("usuario-10/foto.webp", "usuario-1"), false);
  assert.equal(pathAnteriorPertenceAoUsuario("usuario-1/../usuario-2/foto.webp", "usuario-1"), false);
});
