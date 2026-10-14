import {
  NFSeService,
  type NFSeEmitirParams,
  type NFSeNacionalEmitirParams,
  type NFSeRetornoBruto,
} from "./nfse-service";
import type { AutorizadorNFSe, NFSeModeloEmissao, PoliticaNFSe } from "./nfse-politica";

/**
 * Transporte da NFS-e: COMO a nota chega ao autorizador. A política decide o
 * autorizador; o mapeador decide o layout/payload; o transporte só envia,
 * consulta e cancela. Os três não se conhecem além disto.
 *
 * Antes "NACIONAL" queria dizer ao mesmo tempo layout DPS, `/v2/nfsen` e
 * Emissor Público Nacional. Para João Pessoa isso não vale: a cidade usa DPS
 * nacional no emissor próprio, integrado pela Focus na mesma família de endpoint.
 */

type ResultadoEnvio = {
  ok: boolean;
  status?: string;
  referencia?: string;
  message?: string;
  erros?: unknown;
  payload: unknown;
  retornoBruto: NFSeRetornoBruto;
};

export interface NFSeTransport {
  readonly autorizador: AutorizadorNFSe;
  /** Valor gravado em `nfse.modelo_emissao` pelas notas deste transporte. */
  readonly modeloEmissao: string;
  /** Falso quando não há integração: nada é enviado, e a emissão é recusada antes. */
  readonly disponivel: boolean;
  readonly motivoIndisponivel: string | null;
  emitir(params: unknown): Promise<ResultadoEnvio>;
  consultar(referencia: string): ReturnType<NFSeService["consultar"]>;
  cancelar(referencia: string, justificativa?: string): ReturnType<NFSeService["cancelar"]>;
}

/** Focus `/v2/nfse`: emissores municipais antigos (João Pessoa legado, Cabedelo). */
class FocusMunicipalTransport implements NFSeTransport {
  readonly autorizador = "FOCUS_MUNICIPAL" as const;
  readonly modeloEmissao: string;
  readonly disponivel = true;
  readonly motivoIndisponivel = null;
  constructor(private readonly service: NFSeService, modeloEmissao: NFSeModeloEmissao | string) {
    this.modeloEmissao = modeloEmissao;
  }
  emitir(params: unknown) {
    return this.service.emitir(params as NFSeEmitirParams);
  }
  consultar(referencia: string) {
    return this.service.consultar(referencia, "MUNICIPAL");
  }
  cancelar(referencia: string, justificativa?: string) {
    return this.service.cancelar(referencia, justificativa, "MUNICIPAL");
  }
}

/** Focus `/v2/nfsen`: Emissor Público Nacional (Sefin). Só para município habilitado nele. */
class FocusNacionalTransport implements NFSeTransport {
  readonly autorizador: AutorizadorNFSe = "FOCUS_NACIONAL";
  readonly modeloEmissao = "NACIONAL";
  readonly disponivel = true;
  readonly motivoIndisponivel = null;
  constructor(private readonly service: NFSeService) {}
  emitir(params: unknown) {
    return this.service.emitirNacional(params as NFSeNacionalEmitirParams);
  }
  consultar(referencia: string) {
    return this.service.consultar(referencia, "NACIONAL");
  }
  cancelar(referencia: string, justificativa?: string) {
    return this.service.cancelar(referencia, justificativa, "NACIONAL");
  }
}

/** Formato nacional via Focus em ambiente municipal próprio, com NFSe padrão ativa
 * e Ambiente da NFSe Nacional desabilitado no painel. Reutiliza `/v2/nfsen`. */
class FocusFormatoNacionalMunicipalTransport extends FocusNacionalTransport {
  readonly autorizador = "FOCUS_FORMATO_NACIONAL_MUNICIPAL" as const;
}

/**
 * Rota decidida e ainda fechada (Lucena antes de 01/11/2026). Não chama nada:
 * quem pede emissão recebe o motivo antes de qualquer gravação.
 */
class TransporteBloqueado implements NFSeTransport {
  readonly disponivel = false;
  readonly modeloEmissao: string;
  constructor(readonly autorizador: AutorizadorNFSe, modeloEmissao: string, readonly motivoIndisponivel: string) {
    this.modeloEmissao = modeloEmissao;
  }
  private recusar(): never {
    throw new Error(this.motivoIndisponivel);
  }
  async emitir(): Promise<ResultadoEnvio> {
    return this.recusar();
  }
  async consultar(): ReturnType<NFSeService["consultar"]> {
    return this.recusar();
  }
  async cancelar(): ReturnType<NFSeService["cancelar"]> {
    return this.recusar();
  }
}

/** Transporte de uma emissão NOVA, pelo autorizador que a política escolheu. */
export function transportDaPolitica(
  politica: Pick<PoliticaNFSe, "modelo" | "autorizador"> & Partial<Pick<PoliticaNFSe, "bloqueio">>,
  service: NFSeService,
): NFSeTransport {
  if (politica.bloqueio) return new TransporteBloqueado(politica.autorizador, politica.modelo, politica.bloqueio);
  if (politica.autorizador === "FOCUS_NACIONAL") return new FocusNacionalTransport(service);
  if (politica.autorizador === "FOCUS_FORMATO_NACIONAL_MUNICIPAL") {
    return new FocusFormatoNacionalMunicipalTransport(service);
  }
  return new FocusMunicipalTransport(service, politica.modelo);
}

/**
 * Transporte de uma nota JÁ registrada: sai do `modelo_emissao` gravado nela,
 * nunca da política de hoje. Nota municipal antiga segue em `/v2/nfse` mesmo
 * depois da mudança da regra; valor desconhecido ou nulo é municipal.
 * NACIONAL representa a família de endpoint/layout, inclusive o ambiente
 * municipal de João Pessoa; o registro não identifica o Emissor Público Nacional.
 */
export function transportDoRegistro(modeloEmissao: unknown, service: NFSeService): NFSeTransport {
  const modelo = String(modeloEmissao ?? "").trim().toUpperCase();
  if (modelo === "NACIONAL") return new FocusNacionalTransport(service);
  return new FocusMunicipalTransport(service, modelo || "MUNICIPAL");
}
