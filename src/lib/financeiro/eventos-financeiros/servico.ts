import { NextResponse } from "next/server";
export { comCriadoPor } from "@/lib/financeiro/eventos-autoria";

export type Resultado<T> =
  | { ok: true; corpo: T }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> };

export function responder<T>(resultado: Resultado<T>, status = 200) {
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.error, ...(resultado.extra ?? {}) },
      { status: resultado.status },
    );
  }
  return NextResponse.json(resultado.corpo, { status });
}

export function responderFalha(error: any, mensagemPadrao: string) {
  return NextResponse.json(
    { error: error?.message || mensagemPadrao },
    { status: error?.statusCode || 500 },
  );
}

export function idValido(valor: unknown) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function moduloRemovido(...args: unknown[]): Promise<Resultado<any>> {
  void args; // Assinaturas de rotas antigas: sempre recusam sem consultar o banco.
  return { ok: false, error: "O módulo de ordens de serviço foi removido.", status: 410 };
}

export {
  moduloRemovido as ordemDoEvento,
  moduloRemovido as criarEventoDaOs,
  moduloRemovido as listarEventosDaOs,
  moduloRemovido as analisarExclusaoDoEvento,
  moduloRemovido as excluirEventoDaOs,
  moduloRemovido as editarEventoDaOs,
  moduloRemovido as sincronizarUltimoCustoDoEvento,
  moduloRemovido as sincronizarValorDeVendaDoEvento,
};
