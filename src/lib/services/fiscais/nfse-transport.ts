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
 * nacional no emissor próprio, e a Sefin a recusa com E0039.
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

export class NFSeTransporteIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NFSeTransporteIndisponivelError";
  }
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
  readonly autorizador = "FOCUS_NACIONAL" as const;
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

export const MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO =
  "A emissão pelo novo emissor de João Pessoa (DPS no padrão nacional, emissor próprio da prefeitura) "
  + "ainda não está integrada: a Focus NFe não o suporta, e o contrato do webservice da prefeitura "
  + "não é público. Nada foi enviado. Até a integração, emita esta nota pelo portal da prefeitura.";

/**
 * Novo emissor de João Pessoa (DSF, DPS nacional) — SEM integração.
 *
 * Verificado em 02/10/2026:
 * - a Focus só tem João Pessoa no provedor antigo (`GET /v2/municipios/2507507`
 *   → `provedor_nfse: "DsfAbrasf"`, sem data de reimplementação), que é o
 *   emissor encerrado para o regime normal (L999);
 * - `/v2/nfsen` vai para a Sefin Nacional, que recusa a cidade (E0039);
 * - o webservice da prefeitura existe (`nfse2-jpa.dsfweb.com.br/notafiscal-adn-ws/
 *   api/adn/dps`, só POST), mas autenticação, assinatura, XML, consulta,
 *   cancelamento e numeração estão em manuais dentro do portal autenticado.
 *
 * Por isso este transporte não monta XML nem chama rede: recusa tudo. Quando
 * houver documentação oficial (ou suporte da Focus), a implementação entra
 * aqui sem tocar na política nem no mapeador.
 */
class JoaoPessoaDpsTransport implements NFSeTransport {
  readonly autorizador = "JOAO_PESSOA_DSF_DPS" as const;
  readonly modeloEmissao = "DPS_JOAO_PESSOA";
  readonly disponivel = false;
  readonly motivoIndisponivel = MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO;
  emitir(): Promise<ResultadoEnvio> {
    return Promise.reject(new NFSeTransporteIndisponivelError(MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO));
  }
  consultar(): ReturnType<NFSeService["consultar"]> {
    return Promise.reject(new NFSeTransporteIndisponivelError(MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO));
  }
  cancelar(): ReturnType<NFSeService["cancelar"]> {
    return Promise.reject(new NFSeTransporteIndisponivelError(MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO));
  }
}

/** Transporte de uma emissão NOVA, pelo autorizador que a política escolheu. */
export function transportDaPolitica(
  politica: Pick<PoliticaNFSe, "modelo" | "autorizador">,
  service: NFSeService,
): NFSeTransport {
  if (politica.autorizador === "FOCUS_NACIONAL") return new FocusNacionalTransport(service);
  if (politica.autorizador === "JOAO_PESSOA_DSF_DPS") return new JoaoPessoaDpsTransport();
  return new FocusMunicipalTransport(service, politica.modelo);
}

/**
 * Transporte de uma nota JÁ registrada: sai do `modelo_emissao` gravado nela,
 * nunca da política de hoje. Nota municipal antiga segue em `/v2/nfse` mesmo
 * depois da mudança da regra; valor desconhecido ou nulo é municipal.
 */
export function transportDoRegistro(modeloEmissao: unknown, service: NFSeService): NFSeTransport {
  const modelo = String(modeloEmissao ?? "").trim().toUpperCase();
  if (modelo === "NACIONAL") return new FocusNacionalTransport(service);
  if (modelo === "DPS_JOAO_PESSOA") return new JoaoPessoaDpsTransport();
  return new FocusMunicipalTransport(service, modelo || "MUNICIPAL");
}
