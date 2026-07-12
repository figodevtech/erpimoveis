import { decomporChaveAcesso } from "./chaveAcesso";

type AmbienteNfe = "HOMOLOGACAO" | "PRODUCAO" | null | undefined;

type AmbienteUrls = {
  producao: string;
  homologacao: string;
};

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
