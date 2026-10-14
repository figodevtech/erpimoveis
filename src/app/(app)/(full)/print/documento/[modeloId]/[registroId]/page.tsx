import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPerm } from "@/app/api/_authz/perms";
import { CATALOGOS } from "@/lib/documentos/catalogo";
import { montarContexto } from "@/lib/documentos/contexto-server";
import { renderizarModelo } from "@/lib/documentos/motor";
import { PERMISSAO_DO_MODULO, buscarDocumento } from "@/lib/documentos/server";
import type { ModuloDocumento } from "@/lib/documentos/tipos";

import { DocumentoView } from "./documento-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ modeloId: string; registroId: string }>;
};

const TELA_DO_MODULO: Record<ModuloDocumento, string> = {
  venda: "/historicovendas",
  os: "/ordens",
  aluguel: "/alugueis",
};

function idValido(valor: string) {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { modeloId, registroId } = await params;
  const id = idValido(modeloId);
  const modelo = id ? await buscarDocumento(id).catch(() => null) : null;
  return { title: modelo ? `${modelo.nome} #${registroId}` : "Documento" };
}

export default async function DocumentoPage({ params }: PageProps) {
  const { modeloId, registroId } = await params;
  const idModelo = idValido(modeloId);
  const idRegistro = idValido(registroId);
  if (!idModelo || !idRegistro) notFound();

  const modelo = await buscarDocumento(idModelo);
  if (!modelo) {
    return <DocumentoView aviso="Este documento foi excluído. Escolha outro na lista de documentos." voltar="/" />;
  }

  // O middleware só garante que a pessoa vê algum dos módulos; aqui vale o
  // módulo do modelo.
  if (!(await hasPerm(PERMISSAO_DO_MODULO[modelo.modulo]))) redirect("/nao-autorizado");

  const voltar = TELA_DO_MODULO[modelo.modulo];
  if (!modelo.ativo) {
    return <DocumentoView aviso={`O documento "${modelo.nome}" está desativado em Configurações > Documentos.`} voltar={voltar} />;
  }

  const session = await auth();
  const usuario = session?.user as { nome?: string | null; name?: string | null; email?: string | null } | undefined;
  const contexto = await montarContexto(modelo.modulo, idRegistro, {
    nomeDocumento: modelo.nome,
    emitidoPor: usuario?.nome ?? usuario?.name ?? usuario?.email ?? null,
    agora: new Date(),
  });
  if (!contexto) notFound();

  return (
    <DocumentoView
      titulo={`${modelo.nome} #${idRegistro}`}
      html={renderizarModelo(modelo.html, contexto, CATALOGOS[modelo.modulo])}
      voltar={voltar}
    />
  );
}
