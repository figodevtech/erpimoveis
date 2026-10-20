// src/app/(app)/(pages)/configuracoes/tipos/page.tsx

import TiposConfigPage from "./components/tipos-config-page";
import { auth } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ aba?: string | string[] }> }) {
  const session = await auth();
  const permissoes = (session?.user as { permissoes?: string[] } | undefined)?.permissoes ?? [];
  const { aba } = await searchParams;
  return <TiposConfigPage permissoes={permissoes} abaInicial={Array.isArray(aba) ? aba[0] : aba} />;
}
