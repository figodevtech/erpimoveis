// src/app/(app)/(pages)/configuracoes/tipos/page.tsx

import TiposConfigPage from "./components/tipos-config-page";
import { auth } from "@/lib/auth";

export default async function Page() {
  const session = await auth();
  const permissoes = (session?.user as { permissoes?: string[] } | undefined)?.permissoes ?? [];
  return <TiposConfigPage permissoes={permissoes} />;
}
