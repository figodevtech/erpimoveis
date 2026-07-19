// src/lib/nfe/buildNFe.ts

import type {
  EmpresaRow,
  NFeIde,
  NFeDestinatario,
  NFeItem,
} from './types';
import { buildIdeXml } from './xmlIde';
import { buildEmitXml } from './xmlEmitente';
import { buildDestXml } from './xmlDest';
import { buildDetXml } from './xmlItem';
import { gerarCNF, gerarChaveAcesso } from './chaveAcesso';
import { mapEmpresaToEmitente } from './mapEmpresaToEmitente';
import { getCodigoUF } from './ufUtils';
import { calcularTotaisNFe, normalizarCRT } from './fiscal';
import { escapeXml } from './xmlUtils';
import { NFE_HOMOLOGACAO_DESTINATARIO_NOME } from './constants';

/**
 * Formata data/hora para o padrão da NF-e 4.00:
 * AAAA-MM-DDThh:mm:ss-03:00
 */
function formatDateTimeNFe(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  // Usa a HORA LOCAL do ambiente (Node) aqui:
  const ano = date.getFullYear();
  const mes = pad(date.getMonth() + 1);
  const dia = pad(date.getDate());
  const hora = pad(date.getHours());
  const minuto = pad(date.getMinutes());
  const segundo = pad(date.getSeconds());

  // Timezone baseado no ambiente (getTimezoneOffset):
  // ex.: Fortaleza (UTC-3) => getTimezoneOffset() = 180
  const offsetMinutes = date.getTimezoneOffset(); // em minutos
  const total = Math.abs(offsetMinutes);

  const offsetHours = pad(Math.floor(total / 60));
  const offsetMins = pad(total % 60);
  const sign = offsetMinutes > 0 ? '-' : '+';
  // em Fortaleza: offsetMinutes = 180 => sign = '-' => "-03:00"

  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${sign}${offsetHours}:${offsetMins}`;
}


/**
 * Cria o bloco <ide> da NF-e, calculando cNF, chave de acesso e cDV.
 */
export interface IdeOptions {
  nomeMunicipioEmitente?: string;
  tpNF?: 0 | 1;
  idDest?: 1 | 2 | 3;
  natOp?: string;
  indFinal?: 0 | 1;
  indPres?: 0 | 1 | 2 | 3 | 4 | 9;
  finNFe?: 1 | 2 | 3 | 4;
  tpImp?: 1 | 2 | 3 | 4 | 5;
  observacoesFiscais?: string | null;
  pagamento?: NFePagamentoOptions | null;
  transporte?: NFeTransporteOptions | null;
}

export type NFePagamentoOptions = {
  tPag: string;
  tpIntegra?: "1" | "2" | string | null;
  cnpjCredenciadora?: string | null;
  bandeira?: string | null;
  autorizacao?: string | null;
};

export type NFeTransporteOptions = {
  modFrete: "0" | "1" | "2" | "3" | "4" | "9" | string;
  transportadora?: {
    documento?: string | null;
    nome?: string | null;
    inscricaoEstadual?: string | null;
    endereco?: string | null;
    municipio?: string | null;
    uf?: string | null;
  } | null;
  veiculo?: {
    placa?: string | null;
    uf?: string | null;
    rntc?: string | null;
  } | null;
  volume?: {
    quantidade?: string | number | null;
    especie?: string | null;
    marca?: string | null;
    numeracao?: string | null;
    pesoLiquido?: string | number | null;
    pesoBruto?: string | number | null;
  } | null;
};

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function formatDecimal(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return null;

  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(3) : null;
}

function buildTransportaXml(transportadora?: NFeTransporteOptions["transportadora"] | null) {
  const documento = onlyDigits(transportadora?.documento);
  const nome = cleanText(transportadora?.nome);
  const ie = cleanText(transportadora?.inscricaoEstadual);
  const endereco = cleanText(transportadora?.endereco);
  const municipio = cleanText(transportadora?.municipio);
  const uf = cleanText(transportadora?.uf).toUpperCase();

  if (!documento && !nome && !ie && !endereco && !municipio && !uf) return "";

  return (
    "<transporta>" +
    (documento.length === 14 ? `<CNPJ>${documento}</CNPJ>` : "") +
    (documento.length === 11 ? `<CPF>${documento}</CPF>` : "") +
    (nome ? `<xNome>${escapeXml(nome)}</xNome>` : "") +
    (ie ? `<IE>${escapeXml(ie)}</IE>` : "") +
    (endereco ? `<xEnder>${escapeXml(endereco)}</xEnder>` : "") +
    (municipio ? `<xMun>${escapeXml(municipio)}</xMun>` : "") +
    (uf.length === 2 ? `<UF>${escapeXml(uf)}</UF>` : "") +
    "</transporta>"
  );
}

function buildVeicTranspXml(veiculo?: NFeTransporteOptions["veiculo"] | null) {
  const placa = cleanText(veiculo?.placa).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const uf = cleanText(veiculo?.uf).toUpperCase();
  const rntc = cleanText(veiculo?.rntc);

  if (!placa) return "";

  return (
    "<veicTransp>" +
    `<placa>${escapeXml(placa.slice(0, 7))}</placa>` +
    (uf.length === 2 ? `<UF>${escapeXml(uf)}</UF>` : "") +
    (rntc ? `<RNTC>${escapeXml(rntc)}</RNTC>` : "") +
    "</veicTransp>"
  );
}

function buildVolXml(volume?: NFeTransporteOptions["volume"] | null) {
  const quantidade = formatDecimal(volume?.quantidade);
  const especie = cleanText(volume?.especie);
  const marca = cleanText(volume?.marca);
  const numeracao = cleanText(volume?.numeracao);
  const pesoLiquido = formatDecimal(volume?.pesoLiquido);
  const pesoBruto = formatDecimal(volume?.pesoBruto);

  if (!quantidade && !especie && !marca && !numeracao && !pesoLiquido && !pesoBruto) return "";

  return (
    "<vol>" +
    (quantidade ? `<qVol>${escapeXml(quantidade)}</qVol>` : "") +
    (especie ? `<esp>${escapeXml(especie)}</esp>` : "") +
    (marca ? `<marca>${escapeXml(marca)}</marca>` : "") +
    (numeracao ? `<nVol>${escapeXml(numeracao)}</nVol>` : "") +
    (pesoLiquido ? `<pesoL>${pesoLiquido}</pesoL>` : "") +
    (pesoBruto ? `<pesoB>${pesoBruto}</pesoB>` : "") +
    "</vol>"
  );
}

function getTransportadoraPropria(
  modFrete: string,
  empresa: EmpresaRow,
  destinatario?: NFeDestinatario,
): NFeTransporteOptions["transportadora"] | null {
  if (modFrete === "3") {
    return {
      documento: empresa.cnpj,
      nome: empresa.razaosocial,
      inscricaoEstadual: empresa.inscricaoestadual,
      endereco: [empresa.endereco, empresa.numero].filter(Boolean).join(", "),
      municipio: "",
      uf: empresa.uf,
    };
  }

  if (modFrete === "4" && destinatario) {
    return {
      documento: destinatario.cnpj ?? destinatario.cpf ?? "",
      nome: destinatario.razaoSocial,
      inscricaoEstadual: destinatario.inscricaoEstadual,
      endereco: [destinatario.endereco.logradouro, destinatario.endereco.numero].filter(Boolean).join(", "),
      municipio: destinatario.endereco.nomeMunicipio,
      uf: destinatario.endereco.uf,
    };
  }

  return null;
}

function buildTranspXml(params: {
  empresa: EmpresaRow;
  destinatario?: NFeDestinatario;
  transporte?: NFeTransporteOptions | null;
}) {
  const rawModFrete = cleanText(params.transporte?.modFrete || "9");
  const modFrete = ["0", "1", "2", "3", "4", "9"].includes(rawModFrete) ? rawModFrete : "9";

  if (modFrete === "9") {
    return "<transp><modFrete>9</modFrete></transp>";
  }

  const transportadora =
    params.transporte?.transportadora &&
    (cleanText(params.transporte.transportadora.nome) || onlyDigits(params.transporte.transportadora.documento))
      ? params.transporte.transportadora
      : getTransportadoraPropria(modFrete, params.empresa, params.destinatario);

  return (
    "<transp>" +
    `<modFrete>${modFrete}</modFrete>` +
    buildTransportaXml(transportadora) +
    buildVeicTranspXml(params.transporte?.veiculo) +
    buildVolXml(params.transporte?.volume) +
    "</transp>"
  );
}

function buildPagXml(params: { pagamento?: NFePagamentoOptions | null; vNF: string; finNFe: 1 | 2 | 3 | 4 }) {
  const tPag = params.finNFe === 3 || params.finNFe === 4
    ? "90"
    : onlyDigits(params.pagamento?.tPag || "01").padStart(2, "0").slice(0, 2);
  const vPag = tPag === "90" ? "0.00" : params.vNF;
  const isCartao = tPag === "03" || tPag === "04";
  const tpIntegra = params.pagamento?.tpIntegra === "1" ? "1" : "2";
  const cnpjCredenciadora = onlyDigits(params.pagamento?.cnpjCredenciadora);
  const bandeira = onlyDigits(params.pagamento?.bandeira);
  const autorizacao = String(params.pagamento?.autorizacao ?? "").trim();

  const cardXml = isCartao
    ? '<card>' +
      `<tpIntegra>${tpIntegra}</tpIntegra>` +
      (tpIntegra === "1" && cnpjCredenciadora.length === 14 ? `<CNPJ>${cnpjCredenciadora}</CNPJ>` : "") +
      (bandeira ? `<tBand>${bandeira}</tBand>` : "") +
      (tpIntegra === "1" && autorizacao ? `<cAut>${escapeXml(autorizacao)}</cAut>` : "") +
      '</card>'
    : "";

  return (
    '<pag>' +
    '<detPag>' +
    `<tPag>${tPag}</tPag>` +
    `<vPag>${vPag}</vPag>` +
    cardXml +
    '</detPag>' +
    '</pag>'
  );
}

export function criarIdeParaEmpresa(
  empresa: EmpresaRow,
  numeroNota: number,
  serie: number,
  options?: IdeOptions
): { ide: NFeIde; cNF: string; chave: string; id: string } {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;

  const tpAmb: 1 | 2 = empresa.ambiente === 'PRODUCAO' ? 1 : 2;
  const cNF = gerarCNF(numeroNota);

  // PB defaults to 25 if not found, but now we try to read from company
  const cUF = getCodigoUF(empresa.uf || undefined);
  const mod = '55'; // NF-e
  const tpEmis = 1; // emissão normal

  // 1) Gera chave de acesso (44 dígitos) e cDV
  const { chave, id, dv } = gerarChaveAcesso({
    cUF,
    ano,
    mes,
    cnpj: empresa.cnpj,
    mod,
    serie,
    nNF: numeroNota,
    tpEmis,
    cNF,
  });

  // 2) Monta objeto ide completo
  const ide: NFeIde = {
    cUF,
    cNF,
    natOp: options?.natOp || 'VENDA DE MERCADORIA',
    mod,
    serie,
    nNF: numeroNota,
    dhEmi: formatDateTimeNFe(agora),
    tpNF: options?.tpNF ?? 1,
    idDest: options?.idDest ?? 1,
    cMunFG: empresa.codigomunicipio,
    tpImp: options?.tpImp ?? 1,
    tpEmis,
    cDV: dv,
    tpAmb,
    finNFe: options?.finNFe ?? 1,
    indFinal: options?.indFinal ?? (options?.tpNF === 0 ? 0 : 1),
    indPres: options?.indPres ?? 1,
    procEmi: 0,
    verProc: 'ERPOficina 2026.1',
  };

  return { ide, cNF, chave, id };
}

/**
 * Monta o XML completo da NFe (sem assinatura).
 *
 * IMPORTANTE (Lucro Presumido):
 * - Se você passar "itensOverride", é ESSENCIAL preencher os campos
 *   de imposto do NFeItem (cst, csosn, aliquotaIcms, cstPis, cstCofins, etc)
 *   já calculados a partir de produto/nfe_item.
 *
 * Se "itensOverride" for informado, ele será usado para gerar os <det>.
 * Caso contrário, é usado um item de teste fixo (comportamento antigo).
 */
export function buildNFePreviewXml(
  empresa: EmpresaRow,
  numeroNota: number,
  serie: number,
  itensOverride?: NFeItem[],
  destinatario?: NFeDestinatario,
  options?: IdeOptions
): { xml: string; chave: string; id: string } {
  const empresaUf = String(empresa.uf ?? "").trim().toUpperCase();
  const destinatarioUf = String(destinatario?.endereco?.uf ?? "").trim().toUpperCase();
  const destinatarioPais = String(destinatario?.endereco?.codigoPais ?? "").trim();
  const destinatarioExterior =
    Boolean(destinatario) &&
    ((destinatarioPais !== "" && destinatarioPais !== "1058") || destinatarioUf === "EX");
  const idDest = destinatarioExterior
    ? 3
    : empresaUf && destinatarioUf && empresaUf !== destinatarioUf
      ? 2
      : 1;
  const { ide, chave, id } = criarIdeParaEmpresa(
    empresa,
    numeroNota,
    serie,
    { ...options, idDest: options?.idDest ?? idDest }
  );

  const nomeMunicipioEmitente = cleanText(options?.nomeMunicipioEmitente);
  if (!nomeMunicipioEmitente) {
    throw new Error('Nome do município do emitente não foi resolvido pelo código IBGE.');
  }
  const emitente = mapEmpresaToEmitente(empresa, nomeMunicipioEmitente);
  const crt = normalizarCRT(emitente.crt);

  const destBase: NFeDestinatario =
    destinatario ??
    {
      cpf: '12345678909', // pode deixar assim mesmo em homologacao
      razaoSocial: NFE_HOMOLOGACAO_DESTINATARIO_NOME,
      indIEDest: '9',
      endereco: {
        logradouro: 'RUA TESTE',
        numero: '100',
        complemento: '',
        bairro: 'BAIRRO TESTE',
        codigoMunicipio: empresa.codigomunicipio,
        nomeMunicipio: 'JOAO PESSOA',
        uf: 'PB',
        cep: '58000000',
        codigoPais: '1058',
        nomePais: 'BRASIL',
        telefone: '',
      },
    };

  let dest: NFeDestinatario = destBase;

  // REGRA DE HOMOLOGAÇÃO:
  // Se não for produção, o nome do destinatário deve ser fixo conforme norma.
  if (empresa.ambiente !== 'PRODUCAO') {
    // Clonamos para não afetar o objeto original (se passado por referência)
    // Nota: endereco e outros sub-objetos ainda são referencias, mas razaoSocial é primitivo.
    // Como dest é const, precisamos garantir que podemos alterar ou redefinir.
    // Aqui estamos alterando a PROPRIEDADE do objeto referenciado por dest.
    dest = { ...dest, razaoSocial: NFE_HOMOLOGACAO_DESTINATARIO_NOME };
  }


  // Se itensOverride não for passado, usa o item de teste (compatibilidade)
  if (!itensOverride?.length) {
    throw new Error('NFE_ITEMS_REQUIRED: informe ao menos um item com tributacao explicita.');
  }
  const itensBase: NFeItem[] = itensOverride;

  // Garante nº do item em cada item
  const itens: NFeItem[] = itensBase.map((item, index) => ({
    ...item,
    numeroItem: item.numeroItem ?? index + 1,
  }));

  const ideXml = buildIdeXml(ide);
  const emitXml = buildEmitXml(emitente);
  const destXml = buildDestXml(dest);
  const detXml = itens
    .map((item) => buildDetXml(item, crt))
    .join('');

  // =========================
  // Totais (ICMSTot)
  // =========================
  const soma = calcularTotaisNFe(itens, crt);

  const vProd = soma.vProd.toFixed(2);
  const vBC = soma.vBC.toFixed(2);
  const vICMS = soma.vICMS.toFixed(2);
  const vPIS = soma.vPIS.toFixed(2);
  const vCOFINS = soma.vCOFINS.toFixed(2);
  const vNF = (soma.vProd + soma.vST + soma.vFCPST + soma.vIPI).toFixed(2);

  const isTotXml = soma.vIS > 0
    ? `<ISTot><vIS>${soma.vIS.toFixed(2)}</vIS></ISTot>`
    : '';
  const ibsCbsTotXml = itens.some((item) => item.rtc)
    ? '<IBSCBSTot>' +
      `<vBCIBSCBS>${soma.vBCIBSCBS.toFixed(2)}</vBCIBSCBS>` +
      '<gIBS>' +
      `<gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${soma.vIBSUF.toFixed(2)}</vIBSUF></gIBSUF>` +
      `<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>${soma.vIBSMun.toFixed(2)}</vIBSMun></gIBSMun>` +
      `<vIBS>${soma.vIBS.toFixed(2)}</vIBS>` +
      '</gIBS>' +
      `<gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${soma.vCBS.toFixed(2)}</vCBS></gCBS>` +
      '</IBSCBSTot>'
    : '';

  const totalXml =
    '<total>' +
    '<ICMSTot>' +
    `<vBC>${vBC}</vBC>` +
    `<vICMS>${vICMS}</vICMS>` +
    `<vICMSDeson>${soma.vICMSDeson.toFixed(2)}</vICMSDeson>` +
    `<vFCP>${soma.vFCP.toFixed(2)}</vFCP>` +
    `<vBCST>${soma.vBCST.toFixed(2)}</vBCST>` +
    `<vST>${soma.vST.toFixed(2)}</vST>` +
    `<vFCPST>${soma.vFCPST.toFixed(2)}</vFCPST>` +
    `<vFCPSTRet>${soma.vFCPSTRet.toFixed(2)}</vFCPSTRet>` +
    `<vProd>${vProd}</vProd>` +
    `<vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>0.00</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>${soma.vIPI.toFixed(2)}</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>${vPIS}</vPIS>` +
    `<vCOFINS>${vCOFINS}</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF>` +
    '</ICMSTot>' +
    isTotXml +
    ibsCbsTotXml +
    '</total>';

  const transpXml = buildTranspXml({
    empresa,
    destinatario: dest,
    transporte: options?.transporte,
  });

  const pagXml = buildPagXml({
    pagamento: options?.pagamento,
    vNF,
    finNFe: ide.finNFe,
  });

  const natOpText = options?.natOp
    ? `NF-e de ${options.natOp.toLowerCase()}.`
    : 'NF-e de venda de mercadoria.';

  const obsRaw = (options?.observacoesFiscais ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  const obsSanitized = obsRaw.slice(0, 500);

  const infCplText = obsSanitized
    ? `${natOpText} ${obsSanitized}`
    : natOpText;

  const infAdicXml =
    '<infAdic>' +
    `<infCpl>${escapeXml(infCplText)}</infCpl>` +
    '</infAdic>';

  const infRespTec =
    '<infRespTec>' +
    '<CNPJ>58598900000162</CNPJ>' +
    '<xContato>FIGO Softwares</xContato>' +
    '<email>figo.devtech@gmail.com</email>' +
    '<fone>83987872668</fone>' +
    '</infRespTec>';

  const infNFeXml =
    `<infNFe Id="${id}" versao="4.00">` +
    ideXml +
    emitXml +
    destXml +
    detXml +
    totalXml +
    transpXml +
    pagXml +
    infAdicXml +
    infRespTec +
    '</infNFe>';

  const nfeXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
    infNFeXml +
    '</NFe>';

  return { xml: nfeXml, chave, id };
}
