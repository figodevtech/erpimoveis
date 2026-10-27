import { notFound } from "next/navigation";

import { MODELO_EM_BRANCO } from "@/lib/documentos/padrao";
import { buscarDocumento } from "@/lib/documentos/server";
import { ehModuloDocumento } from "@/lib/documentos/tipos";

import { EditorDocumento } from "../components/editor-documento";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ modulo?: string; duplicar?: string }> };

/** Documento novo, em branco ou como cópia de outro (`?duplicar=<id>`). */
export default async function NovoDocumentoPage({ searchParams }: PageProps) {
  const { modulo, duplicar } = await searchParams;

  if (duplicar) {
    const id = Number(duplicar);
    const origem = Number.isSafeInteger(id) && id > 0 ? await buscarDocumento(id) : null;
    if (!origem) notFound();
    return (
      <EditorDocumento
        inicial={{
          id: null,
          codigo_padrao: null,
          nome: `Cópia de ${origem.nome}`.slice(0, 120),
          modulo: origem.modulo,
          html: origem.html,
          ativo: origem.ativo,
          ordem: origem.ordem,
          impressao_rapida: origem.impressao_rapida,
        }}
      />
    );
  }

  return (
    <EditorDocumento
      inicial={{
        id: null,
        codigo_padrao: null,
        nome: "",
        modulo: ehModuloDocumento(modulo) ? modulo : "venda",
        html: MODELO_EM_BRANCO,
        ativo: true,
        ordem: 0,
        impressao_rapida: false,
      }}
    />
  );
}
