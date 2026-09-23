import { aliquotaInterestadual, deveGerarICMSUFDest } from "./difal";

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
  crt?: number | string | null;
  modelo?: number | string | null;
};

/**
 * Reavalia a exigência do DIFAL para um item já montado, quando muda algo do
 * contexto (UF do destinatário, indicador de contribuinte, CFOP).
 *
 * Preenche apenas o que se deduz sem cadastro: a alíquota interestadual, que
 * sai da origem da mercadoria e da geografia, e a partilha de 100%. A alíquota
 * interna do destino e o FCP NÃO entram aqui — eles vêm do motor de regras
 * (`/api/fiscal/difal/resolver`), com vigência e fonte.
 *
 * Antes esta função preenchia a interna com ALIQUOTA_INTERNA_POR_UF. O efeito
 * colateral era pior do que o campo vazio: o item passava a ter alíquota
 * "informada", a emissão parava de bloquear e a nota saía com um número de
 * tabela genérica — sem NCM, sem benefício, sem vigência — como se fosse
 * decisão fiscal.
 *
 * Ao deixar de ser exigido, desliga a seção sem apagar o que foi preenchido,
 * para que religar não perca o trabalho.
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
      crt: contexto.crt,
      modelo: contexto.modelo,
    });

  if (!exige) {
    return item.difalHabilitado ? { ...item, difalHabilitado: false } : item;
  }

  const preencherSeVazio = (atual: string, sugestao: string) => (atual.trim() ? atual : sugestao);

  return {
    ...item,
    difalHabilitado: true,
    difalAliquotaInterestadual: preencherSeVazio(
      item.difalAliquotaInterestadual,
      String(aliquotaInterestadual(ufEmitente, ufDestino, item.orig)),
    ),
    difalPercentualPartilha: preencherSeVazio(item.difalPercentualPartilha, "100"),
  };
}
