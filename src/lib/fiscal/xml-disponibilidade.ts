import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ReferenciaXmlEntrada = {
  entradaId: number;
  documentoId?: number | null;
  chave?: string | null;
};

type DocumentoDfe = {
  id: number;
  chave_acesso: string | null;
  schema: string | null;
  xml: string | null;
};

function chaveAcesso(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 44 ? digits : null;
}

function xmlCompleto(documento: DocumentoDfe) {
  const schema = String(documento.schema ?? "");
  const xml = String(documento.xml ?? "").trim();
  return (
    xml.length > 0 &&
    (schema.startsWith("procNFe") || /<(?:\w+:)?(?:nfeProc|NFe)\b/i.test(xml))
  );
}

async function documentosPorIds(ids: number[]) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id,chave_acesso,schema,xml")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as DocumentoDfe[];
}

async function documentosPorChaves(chaves: string[]) {
  if (!chaves.length) return [];
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id,chave_acesso,schema,xml")
    .in("chave_acesso", chaves);
  if (error) throw error;
  return (data ?? []) as DocumentoDfe[];
}

/**
 * Retorna as entradas que possuem XML completo salvo. Um documento `resNFe`
 * pode ser o ID ligado a entrada e o `procNFe` completo estar em outra linha;
 * por isso a segunda busca tambem considera a chave encontrada no documento.
 */
export async function entradasComXmlCompleto(referencias: ReferenciaXmlEntrada[]) {
  const refs = referencias.filter(
    (referencia) => Number.isInteger(referencia.entradaId) && referencia.entradaId > 0,
  );
  if (!refs.length) return new Set<number>();

  const documentoIds = [
    ...new Set(
      refs
        .map((referencia) => Number(referencia.documentoId))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  const documentosDiretos = await documentosPorIds(documentoIds);
  const documentoDiretoPorId = new Map(
    documentosDiretos.map((documento) => [Number(documento.id), documento]),
  );

  const chaves = new Set<string>();
  for (const referencia of refs) {
    const chave = chaveAcesso(referencia.chave);
    if (chave) chaves.add(chave);
  }
  for (const documento of documentosDiretos) {
    const chave = chaveAcesso(documento.chave_acesso);
    if (chave) chaves.add(chave);
  }

  const documentosDaChave = await documentosPorChaves([...chaves]);
  const chavesComXml = new Set(
    documentosDaChave
      .filter(xmlCompleto)
      .map((documento) => chaveAcesso(documento.chave_acesso))
      .filter((chave): chave is string => Boolean(chave)),
  );

  const resultado = new Set<number>();
  for (const referencia of refs) {
    const documentoId = Number(referencia.documentoId);
    const documentoDireto = documentoDiretoPorId.get(documentoId);
    const chave =
      chaveAcesso(referencia.chave) ?? chaveAcesso(documentoDireto?.chave_acesso);

    if (
      (documentoDireto && xmlCompleto(documentoDireto)) ||
      (chave && chavesComXml.has(chave))
    ) {
      resultado.add(referencia.entradaId);
    }
  }

  return resultado;
}
