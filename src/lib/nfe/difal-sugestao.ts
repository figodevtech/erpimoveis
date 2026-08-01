import { ALIQUOTA_INTERNA_POR_UF, aliquotaInterestadual, deveGerarICMSUFDest } from "./difal";

/** Campos de DIFAL que as telas de emissão mantêm como texto editável. */
export type ItemComDifal = {
  orig?: string | number | null;
  cfop?: string | number | null;
  difalHabilitado: boolean;
  difalAliquotaInterna: string;
  difalAliquotaInterestadual: string;
  difalPercentualPartilha: string;
};

export type DifalContexto = {
  ufEmitente?: string | null;
  ufDestinatario?: string | null;
  tipoOperacao?: "SAIDA" | "ENTRADA";
  indFinal?: number | string;
  indIEDest?: number | string;
};

/**
 * Reavalia a exigência do DIFAL para um item já montado.
 *
 * Preserva o que o usuário digitou: só sugere valor em campo ainda vazio. Ao
 * deixar de ser exigido, desliga a seção sem apagar o que foi preenchido, para
 * que religar não perca o trabalho.
 */
export function aplicarSugestaoDifal<T extends ItemComDifal>(item: T, contexto: DifalContexto): T {
  const ufEmitente = String(contexto.ufEmitente ?? "");
  const ufDestino = String(contexto.ufDestinatario ?? "");
  const exige =
    (contexto.tipoOperacao ?? "SAIDA") === "SAIDA" &&
    Boolean(ufEmitente && ufDestino) &&
    deveGerarICMSUFDest({
      ufEmitente,
      ufDestinatario: ufDestino,
      indFinal: contexto.indFinal ?? 1,
      indIEDest: contexto.indIEDest ?? 9,
      tpNF: 1,
      cfop: item.cfop,
    });

  if (!exige) {
    return item.difalHabilitado ? { ...item, difalHabilitado: false } : item;
  }

  const interna = ALIQUOTA_INTERNA_POR_UF[ufDestino.trim().toUpperCase()];
  const preencherSeVazio = (atual: string, sugestao: string) => (atual.trim() ? atual : sugestao);

  return {
    ...item,
    difalHabilitado: true,
    difalAliquotaInterna: preencherSeVazio(
      item.difalAliquotaInterna,
      interna == null ? "" : String(interna),
    ),
    difalAliquotaInterestadual: preencherSeVazio(
      item.difalAliquotaInterestadual,
      String(aliquotaInterestadual(ufEmitente, ufDestino, item.orig)),
    ),
    difalPercentualPartilha: preencherSeVazio(item.difalPercentualPartilha, "100"),
  };
}
