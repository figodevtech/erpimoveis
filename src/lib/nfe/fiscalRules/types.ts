import type { ModeloDocumentoFiscal } from "../types";

/**
 * Contexto que uma regra estadual precisa para decidir. É de propósito pequeno:
 * regra de UF olha o documento pronto, não o meio de montá-lo.
 */
export type ContextoRegraEstadual = {
  modelo: ModeloDocumentoFiscal;
  /** UF do emitente, em maiúsculas. */
  uf: string;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  /** Total do documento (vNF), já com desconto e acréscimos. */
  totalDocumento: number;
  destinatario: {
    cpf?: string | null;
    cnpj?: string | null;
  } | null;
};

export type ViolacaoRegraEstadual = {
  /** Código interno, no padrão dos demais erros fiscais do projeto. */
  code: string;
  /** Campo da tela que o usuário precisa corrigir, quando existe um. */
  field?: string;
  message: string;
  /**
   * Rejeição que a SEFAZ devolveria se o documento fosse transmitido assim.
   * Serve para ligar a mensagem amigável ao código oficial.
   */
  rejeicaoEsperada?: string;
};

export type RegraEstadual = {
  uf: string;
  validar(contexto: ContextoRegraEstadual): ViolacaoRegraEstadual[];
};
