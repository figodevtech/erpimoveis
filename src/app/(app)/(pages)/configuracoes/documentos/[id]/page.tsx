import { notFound } from "next/navigation";

import { buscarDocumento } from "@/lib/documentos/server";

import { EditorDocumento } from "../components/editor-documento";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditarDocumentoPage({ params }: PageProps) {
  const id = Number((await params).id);
  const documento = Number.isSafeInteger(id) && id > 0 ? await buscarDocumento(id) : null;
  if (!documento) notFound();

  return (
    <EditorDocumento
      key={documento.id}
      inicial={{
        id: documento.id,
        codigo_padrao: documento.codigo_padrao,
        nome: documento.nome,
        modulo: documento.modulo,
        html: documento.html,
        ativo: documento.ativo,
        ordem: documento.ordem,
      }}
    />
  );
}
