// QR Code da NFC-e.
//
// Fica isolado de propósito: o DANFE só desenha o que este módulo devolve, e o
// XML só carrega o que este módulo montou. Espalhar a montagem no renderer é o
// caminho mais curto para o QR impresso divergir do <infNFeSupl> assinado.
//
// Fonte: NT 2025.001 v1.00, item "04. Preenchimento da URL do QR Code" e as
// regras ZX02-220 a ZX02-338. O arquivo está em docs/sefaz/.
//
// ---------------------------------------------------------------------------
// Leiaute por versão (separador "|", prefixo "?p=")
//
//   v2 online   chave | 2 | tpAmb | idCSC | hash
//   v2 offline  chave | 2 | tpAmb | diaEmissao | vNF | digVal | idCSC | hash
//   v3 online   chave | 3 | tpAmb
//   v3 offline  chave | 3 | tpAmb | diaEmissao | vNF | tpIdDest | idDest | assinatura
//
// A v3 acaba com o CSC na emissão normal: a autenticidade passa a ser conferida
// pela própria SEFAZ na consulta, e só a contingência carrega assinatura. É por
// isso que o QR v3 online tem apenas três campos.
// ---------------------------------------------------------------------------
//
// O QR só pode ser gerado DEPOIS da numeração definitiva: ele carrega a chave
// de acesso, e a chave muda quando o número muda.

import { createHash } from "crypto";

import { normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";
import { assinarPayloadQrCode } from "./assinaturaQrCode";

export const QRCODE_VERSAO_2 = 2;
export const QRCODE_VERSAO_3 = 3;

/**
 * Tipo de identificação do destinatário no QR Code v3 offline (`tp_idDest`).
 *
 * A ordem é 1=CNPJ, 2=CPF, 3=idEstrangeiro — e não a intuitiva "CPF primeiro".
 * Fonte: tabela de parâmetros da SEFAZ-PR para o QR Code 3.0 offline
 * (https://sped.fazenda.pr.gov.br/NFCe/Pagina/QR-Code).
 *
 * Consumidor não identificado: campo vazio, mas o separador permanece.
 */
export const TP_ID_DEST = {
  CNPJ: "1",
  CPF: "2",
  ESTRANGEIRO: "3",
} as const;

export type QrCodeNfceParams = {
  /** Chave de acesso de 44 dígitos, já definitiva. */
  chaveAcesso: string;
  /** 1 = produção, 2 = homologação. */
  tpAmb: 1 | 2;
  /** 1 = normal (online), 9 = contingência offline. */
  tpEmis: number;
  /** URL base do QR Code (ZX02), exatamente como a UF publica — inclusive o protocolo. */
  urlConsulta: string;
  /**
   * URL de consulta por chave (ZX03). Finalidade diferente da do QR Code.
   * Omitida, repete a do QR Code — que é o caso de UFs que publicam só uma.
   */
  urlChave?: string;
  versao?: number;

  // --- só na v2 ---
  /** Identificador do CSC (`cIdToken`). Obrigatório na v2, ignorado na v3. */
  idCsc?: string;
  /** CSC em claro. Nunca aparece no QR: só entra no cálculo do hash. */
  csc?: string;

  // --- só na contingência offline (tpEmis = 9) ---
  /** dhEmi como está no XML; daqui sai o dia da emissão. */
  dhEmi?: string;
  /**
   * vNF exatamente como está no XML (`W16`), com ponto decimal e sem separador
   * de milhar. Não recalcular: os bytes assinados têm que ser os mesmos.
   */
  vNF?: string;
  /** DigestValue da assinatura do XML. Só a v2 usa. */
  digVal?: string;
  /** CPF ou CNPJ do consumidor, quando identificado. */
  documentoDestinatario?: string | null;
  /** idEstrangeiro do consumidor, quando for o caso. Só a v3 usa. */
  idEstrangeiro?: string | null;
  /** Chave privada do certificado da empresa. Só a v3 offline usa. */
  privateKeyPem?: string;
};

export type QrCodeNfce = {
  /** Conteúdo do elemento <qrCode>, e o que é desenhado no DANFE. */
  qrCode: string;
  /** Conteúdo do elemento <urlChave>: onde o consumidor consulta a nota. */
  urlChave: string;
  versao: number;
};

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * digVal viaja em hexadecimal no QR Code offline da v2 — em MINÚSCULAS.
 *
 * A caixa importa: este hex entra na string que sofre o SHA-1, então trocá-la
 * muda o hash e a SEFAZ recusa. O exemplo oficial (Manual v6.0, seção 4.3.6.2)
 * converte `yzGYhUx1/XYYzksWB+fPR3Qc50c=` em
 * `797a4759685578312f5859597a6b7357422b6650523351633530633d`, minúsculo, e é
 * esse valor que reproduz o hash publicado. O hash em si sai em maiúsculas.
 */
function paraHex(valor: string): string {
  return Buffer.from(valor, "utf8").toString("hex");
}

function sha1Hex(valor: string): string {
  return createHash("sha1").update(valor, "utf8").digest("hex").toUpperCase();
}

/**
 * Dia do mês da emissão, com 2 dígitos.
 *
 * As regras ZX02-260/268 falam em "Dia da Data de Emissão" e comparam com o dia
 * de `dhEmi` — não é o timestamp inteiro, que era o formato da versão 1.
 */
function diaDaEmissao(dhEmi: string): string {
  // Lê o dia direto da representação fiscal. Passar por `new Date()` deixaria o
  // timezone do servidor decidir o dia, e uma emissão às 00:30 -03:00 viraria
  // o dia seguinte em UTC — divergindo do dia declarado no documento
  // (ZX02-268).
  const match = String(dhEmi ?? "").match(/^\d{4}-\d{2}-(\d{2})/);
  if (!match) {
    throw new Error(`dhEmi inválido para compor o QR Code da NFC-e: "${dhEmi}".`);
  }
  return match[1];
}

/**
 * vNF como ele já está no XML.
 *
 * O campo aceita até 15 bytes, com ponto decimal e sem separador de milhar.
 * Reformatar aqui (tirar centavos, trocar vírgula) mudaria os bytes assinados
 * e a SEFAZ recusaria com a rejeição 583.
 */
function validarVnf(vNF: unknown): string {
  const valor = String(vNF ?? "").trim();

  if (!/^\d{1,12}\.\d{2}$/.test(valor)) {
    throw new Error(
      `vNF inválido para o QR Code da NFC-e: "${valor}". ` +
        'Esperado o valor do XML, com ponto decimal e 2 casas (ex.: "150.00").',
    );
  }
  if (valor.length > 15) {
    throw new Error(`vNF excede os 15 bytes do QR Code da NFC-e: "${valor}".`);
  }

  return valor;
}

/**
 * Parâmetros 6 e 7: tipo e identificação do consumidor.
 *
 * Consumidor não identificado devolve os dois vazios — os separadores continuam
 * na string, e é isso que a ZX02-328 confere contra o grupo <dest> da nota.
 */
function identificarDestinatario(params: QrCodeNfceParams): {
  tipo: string;
  identificacao: string;
} {
  // Estrangeiro: o TIPO é 3, mas a identificação fica VAZIA. O Manual v6.0
  // (Tabela 7, parâmetro 7º) é explícito: "Identificação do Destinatário CPF ou
  // CNPJ na NFC-e. Caso Destinatário estrangeiro ou não identificado, informar
  // apenas o separador '|'". O campo 7 só carrega CPF ou CNPJ.
  const estrangeiro = String(params.idEstrangeiro ?? "").trim();
  if (estrangeiro) {
    return { tipo: TP_ID_DEST.ESTRANGEIRO, identificacao: "" };
  }

  const documentoBruto = String(params.documentoDestinatario ?? "").trim();
  if (!documentoBruto) return { tipo: "", identificacao: "" };

  // O documento entra no payload assinado. Remover `\D` aqui corromperia um
  // CNPJ alfanumérico sem deixar qualquer vestígio para validação posterior.
  const cnpj = normalizeCnpj(documentoBruto);
  if ((/[A-Z]/.test(cnpj) || cnpj.length === 14) && cnpj.length === 14) {
    return { tipo: TP_ID_DEST.CNPJ, identificacao: cnpj };
  }

  const cpf = normalizeCpf(documentoBruto);
  if (cpf.length === 11) {
    return { tipo: TP_ID_DEST.CPF, identificacao: cpf };
  }

  throw new Error(
    `Documento do consumidor inválido para o QR Code da NFC-e: "${documentoBruto}" ` +
      "(esperado CPF com 11 ou CNPJ com 14 dígitos).",
  );
}

export function gerarQrCodeNfce(params: QrCodeNfceParams): QrCodeNfce {
  // Padrão é a versão 3: em produção na SVRS — autorizadora da PB — desde
  // 01/09/2025, e sem a dependência operacional do CSC. A versão 2 segue
  // aceita e continua disponível como compatibilidade.
  const versao = params.versao ?? QRCODE_VERSAO_3;

  if (versao !== QRCODE_VERSAO_2 && versao !== QRCODE_VERSAO_3) {
    throw new Error(`Versão de QR Code da NFC-e não suportada: ${versao}.`);
  }

  const chave = onlyDigits(params.chaveAcesso);
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso inválida para o QR Code da NFC-e: "${params.chaveAcesso}".`);
  }

  if (params.tpAmb !== 1 && params.tpAmb !== 2) {
    throw new Error(`tpAmb inválido para o QR Code da NFC-e: "${params.tpAmb}".`);
  }

  const urlBase = String(params.urlConsulta ?? "").trim().replace(/\?+$/, "");
  if (!urlBase) throw new Error("URL estadual de consulta da NFC-e não configurada.");

  const offline = Number(params.tpEmis) === 9;
  const campos: string[] = [chave, String(versao), String(params.tpAmb)];

  if (versao === QRCODE_VERSAO_3) {
    // ZX02-330: fora de contingência o parâmetro assinatura NÃO pode existir —
    // e nada de CSC. São três campos, só isso.
    if (!offline) return montar(urlBase, campos, versao, params.urlChave);

    // --- v3 offline: parâmetros 4 a 7, depois a assinatura ------------------
    campos.push(diaDaEmissao(String(params.dhEmi ?? "")));
    campos.push(validarVnf(params.vNF));

    const { tipo, identificacao } = identificarDestinatario(params);
    campos.push(tipo);
    campos.push(identificacao);

    // ZX02-334/338: a assinatura cobre os parâmetros 1 a 7 concatenados com
    // "|", inclusive os separadores dos campos vazios do consumidor não
    // identificado. Ela própria NÃO entra no que é assinado.
    const payload = campos.join("|");
    campos.push(assinarPayloadQrCode(payload, String(params.privateKeyPem ?? "")));

    return montar(urlBase, campos, versao, params.urlChave);
  }

  // --- versão 2 -------------------------------------------------------------
  const csc = String(params.csc ?? "").trim();
  // "Deve ser informado sem os '0' (zeros) não significativos" — Manual v6.0,
  // Tabelas 2 e 3. O idCSC entra na string do hash: mandar "000001" no lugar de
  // "1" produz hash diferente do que a SEFAZ calcula (rejeição 100).
  const idCsc = onlyDigits(params.idCsc).replace(/^0+/, "");
  if (!csc) throw new Error("CSC não informado: sem ele o QR Code versão 2 não pode ser assinado.");
  if (!idCsc) throw new Error("ID do CSC não informado para o QR Code versão 2 da NFC-e.");

  if (offline) {
    campos.push(diaDaEmissao(String(params.dhEmi ?? "")));
    campos.push(String(params.vNF ?? ""));
    campos.push(paraHex(String(params.digVal ?? "")));
  }

  campos.push(idCsc);

  const semHash = campos.join("|");
  campos.push(sha1Hex(`${semHash}${csc}`));

  return montar(urlBase, campos, versao, params.urlChave);
}

function montar(
  urlBase: string,
  campos: string[],
  versao: number,
  urlChave?: string,
): QrCodeNfce {
  const separador = urlBase.includes("?") ? "&" : "?";
  return {
    // A URL sai literal, com o protocolo publicado pela UF. Nada de "promover"
    // http para https: a SEFAZ compara o endereço (ZX02-20, rejeição 395).
    qrCode: `${urlBase}${separador}p=${campos.join("|")}`,
    urlChave: urlChave?.trim() || urlBase,
    versao,
  };
}

/** A v3 dispensa CSC: útil para a configuração avisar o que ainda é exigido. */
export function versaoExigeCsc(versao: number): boolean {
  return versao === QRCODE_VERSAO_2;
}

/**
 * Injeta <infNFeSupl> no XML já montado.
 *
 * Posição é obrigatória pelo schema: depois de </infNFe> e antes da assinatura.
 * Como a assinatura ainda não existe neste ponto do fluxo, basta emendar logo
 * após o fechamento de infNFe.
 *
 * O CDATA continua: a NT diz que a v2/v3 dispensam a seção porque o separador
 * "|" não traz caractere reservado, mas a URL de consulta de algumas UF já vem
 * com query string, e aí o "&" que separa nosso `p=` precisaria de escape.
 * Manter o CDATA cobre esse caso sem mudar o conteúdo lido pelo parser.
 */
export function injetarInfNFeSupl(xml: string, qr: QrCodeNfce): string {
  if (xml.includes("<infNFeSupl>")) {
    throw new Error("XML da NFC-e já possui <infNFeSupl>.");
  }
  if (!xml.includes("</infNFe>")) {
    throw new Error("XML da NFC-e não tem </infNFe> para ancorar o <infNFeSupl>.");
  }

  const supl =
    "<infNFeSupl>" +
    `<qrCode><![CDATA[${qr.qrCode}]]></qrCode>` +
    `<urlChave>${qr.urlChave}</urlChave>` +
    "</infNFeSupl>";

  return xml.replace("</infNFe>", `</infNFe>${supl}`);
}
