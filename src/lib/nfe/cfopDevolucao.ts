// CFOP da devolução, derivado da operação de compra original.
//
// Duas armadilhas motivaram este módulo:
//
// 1. Trocar o primeiro dígito do CFOP não serve. Uma compra com ST viraria
//    5.403 ("venda sujeita a ST na condição de substituto"), que descreve uma
//    venda, não um retorno.
//
// 2. O XML da NF-e recebida traz o CFOP do FORNECEDOR — a venda dele, tipo
//    5.405 — e não o CFOP de entrada do comprador (1.403). Esse 1.403 é
//    atribuído na escrituração e não existe no documento. Tentar reconstruí-lo
//    para depois mapear é um desvio desnecessário.
//
// O que o CFOP de devolução realmente depende é de duas coisas: o destino que a
// mercadoria teve na compra (comercialização, industrialização, uso e consumo,
// ativo) e se a operação teve substituição tributária. É isso que separa 5.202
// de 5.411, e as duas informações estão no documento de origem.

import { expectedCfopPrefix } from "./cfopOperation";

/** Para que a mercadoria foi comprada — decide a linha da tabela. */
export type DestinoDaCompra =
  | "COMERCIALIZACAO"
  | "INDUSTRIALIZACAO"
  | "USO_CONSUMO"
  | "ATIVO_IMOBILIZADO";

/** O que o documento de origem informa sobre a tributação do item. */
export type TributacaoDaCompra = {
  /** CFOP do item na NF-e do fornecedor, ou o de entrada, se houver. */
  cfop?: unknown;
  /** CST de ICMS, quando o fornecedor é do regime normal. */
  cst?: unknown;
  /** CSOSN, quando o fornecedor é do Simples Nacional. */
  csosn?: unknown;
};

/** Sufixos por destino: [sem ST, com ST]. */
const SUFIXO_POR_DESTINO: Record<DestinoDaCompra, { semSt: string; comSt: string }> = {
  COMERCIALIZACAO: { semSt: "202", comSt: "411" },
  INDUSTRIALIZACAO: { semSt: "201", comSt: "410" },
  USO_CONSUMO: { semSt: "556", comSt: "413" },
  ATIVO_IMOBILIZADO: { semSt: "553", comSt: "412" },
};

export const DESCRICAO_CFOP_DEVOLUCAO: Record<string, string> = {
  "201": "Devolução de compra para industrialização",
  "202": "Devolução de compra para comercialização",
  "410": "Devolução de compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária",
  "411": "Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária",
  "412": "Devolução de bem do ativo imobilizado, em operação com mercadoria sujeita ao regime de substituição tributária",
  "413": "Devolução de mercadoria destinada ao uso ou consumo, em operação com mercadoria sujeita ao regime de substituição tributária",
  "553": "Devolução de compra de bem para o ativo imobilizado",
  "556": "Devolução de compra de material de uso ou consumo",
};

/**
 * CST de ICMS que indicam mercadoria com o imposto retido por substituição.
 * 10 e 70 são do substituto; 30 e 60, do substituído — em qualquer um deles a
 * mercadoria circula com ICMS já retido, e a devolução é do grupo x.4xx.
 */
const CST_COM_ST = new Set(["10", "30", "60", "70"]);
/** CSOSN equivalentes no Simples Nacional. */
const CSOSN_COM_ST = new Set(["201", "202", "203", "500"]);

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function codigo(value: unknown, tamanho: number) {
  const texto = onlyDigits(value);
  return texto ? texto.padStart(tamanho, "0") : "";
}

/**
 * A compra circulou com ICMS retido por substituição tributária?
 *
 * Olha o CST/CSOSN antes do CFOP porque a tributação do item é a informação
 * direta; o CFOP entra como confirmação para os casos em que o fornecedor não
 * preencheu o grupo de ICMS de forma reconhecível.
 */
export function compraTeveSubstituicaoTributaria(tributacao: TributacaoDaCompra): boolean {
  if (CST_COM_ST.has(codigo(tributacao.cst, 2))) return true;
  if (CSOSN_COM_ST.has(codigo(tributacao.csosn, 3))) return true;

  // Grupo x.4xx da tabela: operações com mercadoria sujeita a ST, tanto na
  // venda do fornecedor (5.401–5.415) quanto na entrada (1.401–1.415).
  const cfop = onlyDigits(tributacao.cfop);
  if (cfop.length !== 4) return false;
  const sufixo = Number(cfop.slice(1));
  return sufixo >= 401 && sufixo <= 415;
}

export type CfopDevolucaoSugerido = {
  cfop: string;
  descricao: string;
  /** Se a sugestão considerou a operação como sujeita a ST. */
  comSubstituicaoTributaria: boolean;
};

/**
 * CFOP da devolução de uma compra.
 *
 * O prefixo vem da UF das partes (5 interna, 6 interestadual, 7 exterior); o
 * sufixo, do destino da compra combinado com a presença de ST.
 */
export function sugerirCfopDevolucaoDeCompra(
  tributacao: TributacaoDaCompra,
  destino: DestinoDaCompra,
  ufEmitente?: string | null,
  ufDestinatario?: string | null,
): CfopDevolucaoSugerido | null {
  const sufixos = SUFIXO_POR_DESTINO[destino];
  if (!sufixos) return null;

  const comSt = compraTeveSubstituicaoTributaria(tributacao);
  const sufixo = comSt ? sufixos.comSt : sufixos.semSt;
  const prefixo = expectedCfopPrefix("SAIDA", ufEmitente, ufDestinatario);

  return {
    cfop: `${prefixo}${sufixo}`,
    descricao: DESCRICAO_CFOP_DEVOLUCAO[sufixo] ?? "",
    comSubstituicaoTributaria: comSt,
  };
}

/** Destino da compra a partir do código da natureza fiscal da saída. */
export function destinoDaCompraPorOperacao(codigoOperacao: unknown): DestinoDaCompra | null {
  const valor = String(codigoOperacao ?? "").toUpperCase();
  if (valor === "DEVOLUCAO_COMPRA_COMERCIALIZACAO") return "COMERCIALIZACAO";
  if (valor === "DEVOLUCAO_COMPRA_INDUSTRIALIZACAO") return "INDUSTRIALIZACAO";
  return null;
}
