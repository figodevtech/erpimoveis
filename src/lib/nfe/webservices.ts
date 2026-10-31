import { decomporChaveAcesso } from "./chaveAcesso";
import { MODELO_NFCE, rotuloModelo } from "./modeloDocumento";
import type { ModeloDocumentoFiscal } from "./types";
import { dataServicoSefaz, motivoInutilizacaoDesativada } from "./politicaServicosSefaz";

type AmbienteNfe = "HOMOLOGACAO" | "PRODUCAO" | null | undefined;

type AmbienteUrls = {
  producao: string;
  homologacao: string;
};

/** Serviços do webservice fiscal, iguais para NF-e e NFC-e. */
export type ServicoSefaz =
  | "autorizacao"
  | "retAutorizacao"
  | "consulta"
  | "statusServico"
  | "recepcaoEvento"
  | "inutilizacao";

const SVRS_CONSULTA_PROTOCOLO: AmbienteUrls = {
  producao: "https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
  homologacao: "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
};

const SVC_AN_CONSULTA_PROTOCOLO: AmbienteUrls = {
  producao: "https://www.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
  homologacao: "https://hom.svc.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
};

const CONSULTA_PROTOCOLO_POR_CUF: Record<string, AmbienteUrls> = {
  "13": {
    producao: "https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4",
    homologacao: "https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4",
  },
  "29": {
    producao: "https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
    homologacao: "https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
  },
  "31": {
    producao: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
    homologacao: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
  },
  "35": {
    producao: "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
    homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
  },
  "41": {
    producao: "https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4",
    homologacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4",
  },
  "43": {
    producao: "https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    homologacao: "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
  },
  "50": {
    producao: "https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
    homologacao: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
  },
  "51": {
    producao: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
    homologacao: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
  },
  "52": {
    producao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
    homologacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
  },
  "26": {
    producao: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
    homologacao: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
  },
};

function pickAmbienteUrl(urls: AmbienteUrls, ambiente: AmbienteNfe) {
  return ambiente === "PRODUCAO" ? urls.producao : urls.homologacao;
}

// ---------------------------------------------------------------------------
// Resolver de endpoints por modelo, UF, ambiente e serviço
//
// A URL do webservice não pode nascer espalhada pelo motor: a autorização vinha
// com o host da SVRS escrito dentro da própria rota, o que impedia a NFC-e de
// existir e travaria qualquer outra UF. Aqui fica a tabela única.
// ---------------------------------------------------------------------------

/** SVRS — NF-e modelo 55. Autorizador da PB e de boa parte das UFs. */
const SVRS_NFE: Record<ServicoSefaz, AmbienteUrls> = {
  autorizacao: {
    producao: "https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    homologacao: "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  },
  retAutorizacao: {
    producao: "https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
    homologacao:
      "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  },
  consulta: SVRS_CONSULTA_PROTOCOLO,
  statusServico: {
    producao: "https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    homologacao:
      "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
  },
  recepcaoEvento: {
    producao: "https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
    homologacao: "https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  },
  inutilizacao: {
    producao: "https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
    homologacao: "https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
  },
};

/**
 * SVRS — NFC-e modelo 65.
 *
 * Hosts diferentes dos da NF-e (`nfce.svrs` em vez de `nfe.svrs`): mandar a 65
 * para o endereço da 55 devolve rejeição de modelo inválido.
 */
const SVRS_NFCE: Record<ServicoSefaz, AmbienteUrls> = {
  autorizacao: {
    producao: "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    homologacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  },
  retAutorizacao: {
    producao: "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
    homologacao:
      "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  },
  consulta: {
    producao: "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    homologacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
  },
  statusServico: {
    producao: "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    homologacao:
      "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
  },
  recepcaoEvento: {
    producao: "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
    homologacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
  },
  inutilizacao: {
    producao: "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
    homologacao: "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
  },
};

type Autorizador = "SVRS";

const AUTORIZADORES: Record<Autorizador, Record<ModeloDocumentoFiscal, Record<ServicoSefaz, AmbienteUrls>>> = {
  SVRS: { 55: SVRS_NFE, 65: SVRS_NFCE },
};

/**
 * Qual autorizador atende cada UF, por modelo.
 *
 * Só entra UF cujo autorizador foi confirmado na documentação oficial. UF que
 * não está aqui falha com mensagem clara em vez de ser mandada para a SVRS por
 * suposição — emitir contra o autorizador errado é rejeição na certa.
 */
const AUTORIZADOR_POR_UF: Record<ModeloDocumentoFiscal, Record<string, Autorizador>> = {
  55: { PB: "SVRS" },
  65: { PB: "SVRS" },
};

export function resolveSefazEndpoint(params: {
  modelo: ModeloDocumentoFiscal;
  uf: string;
  ambiente: AmbienteNfe;
  servico: ServicoSefaz;
  data?: string;
}): string {
  const uf = String(params.uf ?? "").trim().toUpperCase();
  if (uf.length !== 2) {
    throw new Error(`UF do emitente inválida para resolver o webservice: "${params.uf ?? ""}".`);
  }

  if (params.servico === "inutilizacao") {
    const motivo = motivoInutilizacaoDesativada({
      uf, modelo: params.modelo,
      ambiente: params.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO",
      data: params.data ?? dataServicoSefaz(uf),
    });
    if (motivo) throw new Error(motivo);
  }

  const autorizador = AUTORIZADOR_POR_UF[params.modelo]?.[uf];
  if (!autorizador) {
    throw new Error(
      `Autorizador de ${rotuloModelo(params.modelo)} não configurado para a UF ${uf}. ` +
        "Confirme o autorizador vigente na documentação oficial antes de emitir.",
    );
  }

  const urls = AUTORIZADORES[autorizador][params.modelo][params.servico];
  return pickAmbienteUrl(urls, params.ambiente);
}

/**
 * Endereço do QR Code da NFC-e (tag ZX02).
 *
 * ATENÇÃO AO PROTOCOLO: é `http://`, e não `https://`. Esta URL não é um
 * endereço de navegação — ela é comparada literalmente pela SEFAZ na regra
 * ZX02-20 ("Endereço do site da UF para a Consulta via QR-Code difere do
 * previsto"), cuja violação devolve a rejeição 395. Trocar por HTTPS "porque o
 * site tem certificado" derruba a nota.
 *
 * Produção e homologação usam CAMINHOS diferentes na PB: /nfce e /nfcehom.
 *
 * Fonte: comunicados da SEFAZ-PB sobre o endereço único do QR Code da NFC-e.
 */
const URL_QRCODE_NFCE_POR_UF: Record<string, AmbienteUrls> = {
  PB: {
    producao: "http://www.sefaz.pb.gov.br/nfce",
    homologacao: "http://www.sefaz.pb.gov.br/nfcehom",
  },
};

/**
 * Endereço de consulta por chave de acesso (tag ZX03, `urlChave`).
 *
 * É finalidade DIFERENTE da URL do QR Code: aqui o consumidor digita os 44
 * dígitos, lá ele aponta a câmera. O Manual v6.0 (itens 3.1.4 e 4.8) trata as
 * duas separadamente, e por isso elas vivem em tabelas separadas — mesmo quando
 * uma UF publica o mesmo endereço para as duas.
 */
const URL_CHAVE_NFCE_POR_UF: Record<string, AmbienteUrls> = {
  PB: {
    producao: "http://www.sefaz.pb.gov.br/nfce",
    homologacao: "http://www.sefaz.pb.gov.br/nfcehom",
  },
};

function resolverUrlEstadual(
  tabela: Record<string, AmbienteUrls>,
  descricao: string,
  uf: string,
  ambiente: AmbienteNfe,
): string {
  const chave = String(uf ?? "").trim().toUpperCase();
  const urls = tabela[chave];
  if (!urls) {
    throw new Error(
      `${descricao} não configurada para a UF ${chave || "(vazia)"}. ` +
        "Cadastre o endereço publicado pela SEFAZ do estado antes de emitir.",
    );
  }
  return pickAmbienteUrl(urls, ambiente);
}

/** URL base do QR Code (ZX02). */
export function resolveUrlQrCodeNfce(uf: string, ambiente: AmbienteNfe): string {
  return resolverUrlEstadual(URL_QRCODE_NFCE_POR_UF, "URL do QR Code da NFC-e", uf, ambiente);
}

/** URL de consulta por chave de acesso (ZX03). */
export function resolveUrlChaveNfce(uf: string, ambiente: AmbienteNfe): string {
  return resolverUrlEstadual(
    URL_CHAVE_NFCE_POR_UF,
    "URL de consulta por chave da NFC-e",
    uf,
    ambiente,
  );
}

/** UFs cuja emissão está liberada para o modelo — usado por tela e diagnóstico. */
export function ufsSuportadas(modelo: ModeloDocumentoFiscal): string[] {
  return Object.keys(AUTORIZADOR_POR_UF[modelo] ?? {}).sort();
}

export function suportaModelo(modelo: ModeloDocumentoFiscal, uf: string): boolean {
  return Boolean(AUTORIZADOR_POR_UF[modelo]?.[String(uf ?? "").trim().toUpperCase()]);
}

/** Atalho legível para o caso mais comum. */
export function isNfceSuportadaNaUf(uf: string): boolean {
  return suportaModelo(MODELO_NFCE, uf);
}

export function getNfeConsultaProtocoloUrl(params: {
  chaveAcesso: string;
  ambiente: AmbienteNfe;
}) {
  const chave = params.chaveAcesso.replace(/\D/g, "");
  const { cUF, tpEmis } = decomporChaveAcesso(chave);

  if (tpEmis === "6") {
    return pickAmbienteUrl(SVC_AN_CONSULTA_PROTOCOLO, params.ambiente);
  }

  if (tpEmis === "7") {
    return pickAmbienteUrl(SVRS_CONSULTA_PROTOCOLO, params.ambiente);
  }

  return pickAmbienteUrl(
    CONSULTA_PROTOCOLO_POR_CUF[cUF] ?? SVRS_CONSULTA_PROTOCOLO,
    params.ambiente,
  );
}
