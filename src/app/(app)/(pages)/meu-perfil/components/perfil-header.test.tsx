import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeuPerfil } from "../types";
import { PerfilHeader } from "./perfil-header";

const perfil: MeuPerfil = {
  id: "d87ee7be-dd48-4bb6-b4c7-859dc4f64754",
  nome: "Maria Santos",
  email: "maria@example.com",
  fotoUrl: "https://example.com/maria.webp",
  ativo: true,
  dataAdmissao: null,
  perfil: { id: 1, nome: "Administradora" },
  setor: { id: 2, nome: "Oficina" },
};

test("card renderiza o controle que abre o seletor nativo", () => {
  const html = renderToStaticMarkup(
    <PerfilHeader
      perfil={perfil}
      carregando={false}
      onFotoSelecionada={async () => undefined}
    />,
  );

  assert.match(html, /type="file"/);
  assert.match(html, /Alterar foto de Maria Santos/);
  assert.match(html, /image\/avif/);
  assert.doesNotMatch(html, /image\/heic/);
});

test("card mantem iniciais como fallback e bloqueia o lapis durante o envio", () => {
  const html = renderToStaticMarkup(
    <PerfilHeader
      perfil={{ ...perfil, fotoUrl: null }}
      carregando={false}
      enviandoFoto
      onFotoSelecionada={async () => undefined}
    />,
  );

  assert.match(html, />MS</);
  assert.match(html, /disabled=""/);
});
