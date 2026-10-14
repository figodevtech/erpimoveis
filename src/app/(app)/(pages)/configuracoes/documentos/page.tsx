import { ehModuloDocumento } from "@/lib/documentos/tipos";

import { DocumentosLista } from "./components/documentos-lista";

type PageProps = { searchParams: Promise<{ modulo?: string }> };

export default async function DocumentosPage({ searchParams }: PageProps) {
  const { modulo } = await searchParams;
  return <DocumentosLista moduloInicial={ehModuloDocumento(modulo) ? modulo : "venda"} />;
}
