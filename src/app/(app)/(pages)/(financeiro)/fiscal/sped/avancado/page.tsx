import type { Metadata } from "next";

import { SpedWorkspace } from "../sped-workspace";

export const metadata: Metadata = {
  title: "SPED Fiscal · Área avançada",
};

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[\w-]{1,40}$/.test(raw) ? raw : null;
}

export default async function SpedAdvancedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <SpedWorkspace initialCompetenciaId={single(params.competencia)} initialTab={single(params.aba)} />;
}
