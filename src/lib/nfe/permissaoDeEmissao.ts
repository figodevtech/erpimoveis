// Que nota fiscal uma venda (ou OS) pode gerar.
//
// Uma regra só, lida pelo servidor (`salvarNFeDeOrigem`, que recusa) e pela
// tela de emissão (que desabilita o botão e explica). Hoje o que decide é o
// cliente: o Consumidor Final do sistema não tem documento nem endereço, então
// não pode ser destinatário de NF-e — só de NFC-e, que admite consumidor não
// identificado. O teto de valor da NFC-e sem CPF/CNPJ é regra estadual e vive
// em `fiscalRules`; aqui ele só vira texto para o operador saber antes.

import { MODELO_NFCE } from "./modeloDocumento";
import { PB_NFCE_PISO_IDENTIFICACAO } from "./fiscalRules/pb";
import type { ModeloDocumentoFiscal } from "./types";

export type OrigemDaEmissao = {
  tipo: "OS" | "VENDA";
  /** O cliente da origem é o Consumidor Final do sistema. */
  clienteDoSistema: boolean;
  /** UF do emitente, para descrever o limite estadual da NFC-e. */
  ufEmitente?: string | null;
};

export type PermissaoDeEmissao =
  | { permitido: true; condicao: string | null }
  | { permitido: false; motivo: string };

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Limite de valor da NFC-e sem consumidor identificado na UF, quando há. */
export function pisoDeIdentificacaoNfce(ufEmitente?: string | null): number | null {
  return String(ufEmitente ?? "").trim().toUpperCase() === "PB" ? PB_NFCE_PISO_IDENTIFICACAO : null;
}

export function permissaoDeEmissao(
  modelo: ModeloDocumentoFiscal,
  origem: OrigemDaEmissao,
): PermissaoDeEmissao {
  const rotulo = origem.tipo === "OS" ? "OS" : "venda";

  if (modelo !== MODELO_NFCE) {
    if (origem.clienteDoSistema) {
      return {
        permitido: false,
        motivo:
          `O cliente desta ${rotulo} é o Consumidor Final, sem identificação. ` +
          "A NF-e exige destinatário com CPF/CNPJ e endereço: emita uma NFC-e ou troque o cliente.",
      };
    }
    return { permitido: true, condicao: null };
  }

  if (!origem.clienteDoSistema) return { permitido: true, condicao: null };
  const piso = pisoDeIdentificacaoNfce(origem.ufEmitente);
  return {
    permitido: true,
    condicao: piso
      ? `Sem CPF ou CNPJ do consumidor, só abaixo de ${moeda(piso)}. ` +
        "A partir desse valor, informe o documento de quem comprou na tela da NFC-e."
      : null,
  };
}
