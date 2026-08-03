// src/app/(app)/(pages)/(financeiro)/dre/page.tsx
import { DreClient } from "./dre-client";

export const metadata = { title: "Demonstração do Resultado" };

// Tela autenticada e inteiramente client-side; a arvore de `motion/react` nao
// sobrevive ao prerender neste setup de webpack (mesma razao de /meu-perfil).
export const dynamic = "force-dynamic";

export default function Page() {
  return <DreClient />;
}
