/**
 * Depois que a SEFAZ homologa o cancelamento (cStat 135/155), o fato já existe
 * lá fora: reenviar devolve 573 (duplicidade) e o ERP nunca mais aprenderia que
 * a nota caiu. Por isso a ordem de prioridade é:
 *
 * 1. preservar o evento e marcar a nota numa só transação (RPC);
 * 2. se isso falhar, marcar a nota como CANCELADA mesmo sem o evento, e avisar;
 * 3. só se nem a marcação passar, falhar dizendo que a SEFAZ já cancelou.
 */
export type PersistenciaCancelamento = {
  registrarEvento: () => Promise<{ error: unknown }>;
  marcarCancelada: () => Promise<{ error: unknown }>;
  registrarFalha?: (etapa: "evento" | "marcacao", error: unknown) => void;
};

export type ResultadoCancelamento = {
  eventoPreservado: boolean;
  aviso: string | null;
};

function mensagem(error: unknown) {
  if (error instanceof Error) return error.message;
  const texto = (error as { message?: unknown } | null)?.message;
  return typeof texto === "string" && texto ? texto : String(error);
}

export async function persistirCancelamentoHomologado(
  protocoloEvento: string | null,
  persistencia: PersistenciaCancelamento,
): Promise<ResultadoCancelamento> {
  let falhaEvento: unknown = null;
  if (protocoloEvento) {
    try {
      const { error } = await persistencia.registrarEvento();
      if (!error) return { eventoPreservado: true, aviso: null };
      falhaEvento = error;
    } catch (error) {
      falhaEvento = error;
    }
  } else {
    falhaEvento = new Error("A SEFAZ homologou o cancelamento sem informar o protocolo do evento.");
  }
  persistencia.registrarFalha?.("evento", falhaEvento);

  let falhaMarcacao: unknown = null;
  try {
    const { error } = await persistencia.marcarCancelada();
    falhaMarcacao = error;
  } catch (error) {
    falhaMarcacao = error;
  }
  if (falhaMarcacao) {
    persistencia.registrarFalha?.("marcacao", falhaMarcacao);
    throw new Error(
      `A SEFAZ homologou o cancelamento, mas o ERP não conseguiu marcar a nota como CANCELADA: ${mensagem(falhaMarcacao)}`,
    );
  }

  return {
    eventoPreservado: false,
    aviso: `Nota marcada como CANCELADA, mas o XML do evento não foi preservado: ${mensagem(falhaEvento)}`,
  };
}
