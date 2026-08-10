// Validações específicas do modelo 65.
//
// Rodam ANTES da transmissão. A NFC-e é emitida com o cliente no balcão: cada
// rejeição da SEFAZ é uma venda parada, um número de nota queimado e um
// operador refazendo o processo. Tudo que dá para saber sem perguntar à SEFAZ
// é verificado aqui.
//
// O que NÃO está aqui: tributação de item (ICMS/PIS/COFINS/IBS/CBS), que é a
// mesma da NF-e e continua em `taxRules.ts`. Duplicar aquilo seria criar um
// segundo motor tributário.

import { MODELO_NFCE } from "../modeloDocumento";
import { validarRegrasEstaduais, type ViolacaoRegraEstadual } from "../fiscalRules";
import { isValidCnpj, isValidCpf } from "../recipientNormalization";
import type { NFeItem } from "../types";

export type ConsumidorNfce = {
  cpf?: string | null;
  cnpj?: string | null;
  nome?: string | null;
};

export type ContextoNfce = {
  uf: string;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  /** 1 = normal, 9 = contingência offline. */
  tpEmis: number;
  indPres: number | string;
  finNFe: number;
  tipoOperacao: "SAIDA" | "ENTRADA";
  consumidor: ConsumidorNfce | null;
  itens: NFeItem[];
  /** Soma dos pagamentos declarados. */
  totalPago: number;
  /** vNF calculado a partir dos itens. */
  totalDocumento: number;
};

export type ViolacaoNfce = ViolacaoRegraEstadual;

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Indicadores de presença compatíveis com a NFC-e.
 *
 * `0` (não se aplica) e `9` (outros) não descrevem uma venda ao consumidor, e
 * `4` (entrega a domicílio) é o caso do delivery.
 */
const IND_PRES_VALIDOS = new Set(["1", "2", "3", "4", "5"]);

export function validarNfce(contexto: ContextoNfce): ViolacaoNfce[] {
  const violacoes: ViolacaoNfce[] = [];

  // --- operação ------------------------------------------------------------
  if (contexto.tipoOperacao !== "SAIDA") {
    violacoes.push({
      code: "NFCE_SOMENTE_SAIDA",
      field: "operacao.tipoOperacao",
      message: "NFC-e documenta apenas operação de saída.",
    });
  }

  if (contexto.finNFe !== 1) {
    violacoes.push({
      code: "NFCE_FINALIDADE_INVALIDA",
      field: "operacao.finalidade",
      message:
        "NFC-e aceita apenas finalidade normal. Complementar, ajuste e devolução exigem NF-e modelo 55.",
    });
  }

  if (!IND_PRES_VALIDOS.has(String(contexto.indPres))) {
    violacoes.push({
      code: "NFCE_IND_PRES_INVALIDO",
      field: "operacao.indicadorPresenca",
      message: "Indicador de presença inválido para NFC-e: a operação precisa ser ao consumidor.",
    });
  }

  // --- itens ---------------------------------------------------------------
  if (contexto.itens.length === 0) {
    violacoes.push({
      code: "NFCE_SEM_ITENS",
      field: "itens",
      message: "Selecione pelo menos um produto para a NFC-e.",
    });
  }

  contexto.itens.forEach((item, index) => {
    // Não é operação interestadual: DIFAL na NFC-e é erro de montagem.
    if (item.icmsUfDest) {
      violacoes.push({
        code: "NFCE_DIFAL_NAO_APLICAVEL",
        field: "itens",
        message: `Item ${index + 1}: NFC-e é operação interna e não admite partilha de ICMS (DIFAL).`,
      });
    }

    if (Number(item.valorTotal ?? 0) <= 0) {
      violacoes.push({
        code: "NFCE_ITEM_SEM_VALOR",
        field: "itens",
        message: `Item ${index + 1}: valor do produto deve ser maior que zero.`,
      });
    }
  });

  // --- consumidor ----------------------------------------------------------
  // Consumidor não identificado é legítimo na NFC-e. Mas se veio documento, ele
  // precisa ser válido: CPF inventado é pior que consumidor anônimo.
  const cpf = onlyDigits(contexto.consumidor?.cpf);
  const cnpj = onlyDigits(contexto.consumidor?.cnpj);

  if (cpf && !isValidCpf(cpf)) {
    violacoes.push({
      code: "NFCE_CPF_INVALIDO",
      field: "destinatario.cpfCnpj",
      message: "CPF do consumidor é inválido.",
    });
  }

  if (cnpj && !isValidCnpj(cnpj)) {
    violacoes.push({
      code: "NFCE_CNPJ_INVALIDO",
      field: "destinatario.cpfCnpj",
      message: "CNPJ do consumidor é inválido.",
    });
  }

  if (cpf && cnpj) {
    violacoes.push({
      code: "NFCE_DOCUMENTO_DUPLICADO",
      field: "destinatario.cpfCnpj",
      message: "Informe CPF ou CNPJ do consumidor, nunca os dois.",
    });
  }

  // --- pagamento -----------------------------------------------------------
  // vPag < vNF sem complemento deixa a nota sem lastro de pagamento.
  if (contexto.totalPago + 0.009 < contexto.totalDocumento) {
    violacoes.push({
      code: "NFCE_PAGAMENTO_INSUFICIENTE",
      field: "pagamentos",
      message:
        `A soma dos pagamentos (R$ ${contexto.totalPago.toFixed(2)}) é menor que o total da ` +
        `NFC-e (R$ ${contexto.totalDocumento.toFixed(2)}).`,
    });
  }

  // --- regras da UF do emitente -------------------------------------------
  violacoes.push(
    ...validarRegrasEstaduais({
      modelo: MODELO_NFCE,
      uf: contexto.uf,
      ambiente: contexto.ambiente,
      totalDocumento: contexto.totalDocumento,
      destinatario: contexto.consumidor,
    }),
  );

  return violacoes;
}
