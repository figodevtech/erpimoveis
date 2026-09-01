export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPerm, PERMS, requireOSAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CHECKLIST_DOCUMENTOS_BUCKET,
  ChecklistDocumentoError,
  loadChecklistDocumento,
} from "@/lib/ordens/checklist-documentos-server";
import { ChecklistReport } from "./checklist-report";

type PageProps = { params: Promise<{ publicId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;
  return { title: `Checklist ${publicId.slice(0, 8)}` };
}

export default async function ChecklistPrintPage({ params }: PageProps) {
  await requireOSAccess();
  const { publicId } = await params;
  let document;
  try {
    // A comparação com a fonte atual baixa e normaliza todas as fotografias.
    // Ela roda após o primeiro paint pela API de divergência, fora do stream RSC.
    document = await loadChecklistDocumento(publicId, { checkCurrentContent: false });
  } catch (error) {
    if (error instanceof ChecklistDocumentoError && error.statusCode === 404) notFound();
    throw error;
  }

  const paths = Array.from(new Set([
    ...(document.snapshot.empresa.logo ? [document.snapshot.empresa.logo.storagePath] : []),
    ...document.snapshot.checklist.itens.flatMap((item) => item.fotos.map((photo) => photo.storagePath)),
    ...(document.assinatura ? [document.assinatura.assinaturaPath] : []),
  ]));
  const assetUrls: Record<string, string> = {};
  if (paths.length) {
    const signed = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).createSignedUrls(paths, 60 * 60);
    if (signed.error) throw signed.error;
    for (const item of signed.data ?? []) {
      if (item.signedUrl && item.path) assetUrls[item.path] = item.signedUrl;
    }
    const missing = paths.filter((path) => !assetUrls[path]);
    if (missing.length) throw new Error("Um ativo preservado do checklist não pôde ser exibido.");
  }

  const canSign = await hasPerm(PERMS.ORDENS_EDITAR);
  return <ChecklistReport document={document} assetUrls={assetUrls} canSign={canSign} />;
}
