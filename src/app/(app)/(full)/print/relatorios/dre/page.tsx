export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { apurarDre, periodoValido } from "@/app/api/dre/_calculo";
import { fetchLogoEmpresaDataUrl } from "@/lib/empresa-logo";
import { fetchEmpresaDaImpressao } from "@/lib/print/empresa-server";

import { DreReport } from "./dre-report";
import { emissaoEmTexto } from "./report-model";

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

function um(valor: string | string[] | undefined) {
  return (Array.isArray(valor) ? valor[0] ?? "" : valor ?? "").trim();
}

/** O título vira o nome sugerido quando a folha é salva como PDF pelo navegador. */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const de = um(params.de);
  const ate = um(params.ate);
  return { title: periodoValido(de, ate) ? `DRE ${de} a ${ate}` : "DRE — impressão" };
}

export default async function DrePrintPage({ searchParams }: PageProps) {
  await requireFinanceirosAccess();

  const params = await searchParams;
  const de = um(params.de);
  const ate = um(params.ate);
  if (!periodoValido(de, ate)) notFound();

  // A DRE é a mesma apuração de /api/dre; empresa e logo, as mesmas da OS.
  const [dre, empresa, logoUrl] = await Promise.all([
    apurarDre(de, ate),
    fetchEmpresaDaImpressao(),
    fetchLogoEmpresaDataUrl(),
  ]);

  return (
    <DreReport
      periodo={dre.periodo}
      template={dre.template}
      linhas={dre.linhas}
      indicadores={dre.indicadorPorCodigo}
      empresa={empresa}
      logoUrl={logoUrl}
      emitidoEm={emissaoEmTexto(new Date())}
    />
  );
}
