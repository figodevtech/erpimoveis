// src/lib/nfe/buildNFe.ts

import type {
  EmpresaRow,
  ModeloDocumentoFiscal,
  NFeIde,
  NFeDestinatario,
  NFeDocumentoReferenciado,
  NFeItem,
} from './types';
import { MODELO_NFE, MODELO_NFCE, modeloParaCodigo } from './modeloDocumento';
import { buildIdeXml } from './xmlIde';
import { resolverReferenciasNFe } from './referencias-nfe';
import { buildEmitXml } from './xmlEmitente';
import { buildDestXml } from './xmlDest';
import { buildDetXml } from './xmlItem';
import { gerarCNF, gerarChaveAcesso } from './chaveAcesso';
import { mapEmpresaToEmitente } from './mapEmpresaToEmitente';
import { getCodigoUF } from './ufUtils';
import { calcularTotaisNFe, normalizarCRT, valorTotalItemNFe } from './fiscal';
import { deveGerarICMSUFDest, validarDifalCanonicoDoItem } from './difal';
import { escapeXml, truncateNfeXNome } from './xmlUtils';
import { resolverCobrancaNFe, type NFeCobrancaInput, type NFeCobrancaNormalizada } from './duplicatas';
import { validarInscricaoEstadualDestinatario } from './indIEDest';
import { buildInfIntermedXml, indicadorIntermediador, type NFeIntermediador } from './intermediador';
import { avaliarRegraE16a30Xml } from './regraE16a30Xml';
import { CODE_E16A30, mensagemBloqueioE16a30 } from './regraE16a30';
import {
  NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO,
  NFE_HOMOLOGACAO_DESTINATARIO_NOME,
} from './constants';
import { normalizeCnpj, normalizeCpfOrCnpj } from '@/lib/fiscal-identifiers';

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
  /**
   * Modelo do documento. Omitido = 55 (NF-e), que mantém o comportamento de
   * todos os chamadores que existiam antes da NFC-e.
   */
  modelo?: ModeloDocumentoFiscal;
  /**
   * Ambiente do documento. Omitido, cai no da empresa.
   *
   * O ambiente fiscal é único e definido no cadastro da empresa — NF-e e NFC-e
   * seguem juntas. Este parâmetro serve para o chamador declarar o ambiente já
   * resolvido, garantindo que o `tpAmb` e as regras de homologação (nome do
   * destinatário na NF-e, descrição do 1º item na NFC-e) usem exatamente o
   * mesmo valor.
   */
  ambiente?: "HOMOLOGACAO" | "PRODUCAO" | null;
  nomeMunicipioEmitente?: string;
  tpNF?: 0 | 1;
  idDest?: 1 | 2 | 3;
  natOp?: string;
  indFinal?: 0 | 1;
  indPres?: 0 | 1 | 2 | 3 | 4 | 5 | 9;
  /**
   * Plataforma de terceiros que intermediou a venda. Só vale em operação não
   * presencial; nela, ausente significa "sem intermediador" (indIntermed 0).
   */
  intermediador?: NFeIntermediador | null;
  finNFe?: 1 | 2 | 3 | 4;
  tpImp?: 1 | 2 | 3 | 4 | 5;
  /** 1 = normal, 9 = contingência offline da NFC-e. */
  tpEmis?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  observacoesFiscais?: string | null;
  pagamento?: NFePagamentoOptions | null;
  pagamentos?: NFePagamentoOptions[] | null;
  cobranca?: NFeCobrancaInput | null;
  transporte?: NFeTransporteOptions | null;
  /**
   * Local de entrega/retirada, quando diferente do endereço do destinatário
   * (grupo `<entrega>`). A pessoa indicada para receber ou retirar a
   * mercadoria não substitui o destinatário fiscal — ver `buildEntregaXml`.
   */
  entrega?: NFeEntregaOptions | null;
  documentosReferenciados?: NFeDocumentoReferenciado[] | null;
}

export type NFePagamentoOptions = {
  tPag: string;
  valor?: string | number | null;
  tpIntegra?: "1" | "2" | string | null;
  cnpjCredenciadora?: string | null;
  bandeira?: string | null;
  autorizacao?: string | null;
  xPag?: string | null;
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

export type NFeEntregaOptions = {
  /** CPF (11 dígitos) ou CNPJ (14 dígitos) da pessoa indicada para entrega/retirada. */
  documento?: string | null;
  nome?: string | null;
  endereco?: {
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    codigoMunicipio?: string | null;
    nomeMunicipio?: string | null;
    uf?: string | null;
    cep?: string | null;
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
  const documento = normalizeCpfOrCnpj(transportadora?.documento);
  const nome = truncateNfeXNome(cleanText(transportadora?.nome));
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
    (cleanText(params.transporte.transportadora.nome) || normalizeCpfOrCnpj(params.transporte.transportadora.documento))
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

/**
 * Monta o grupo `<entrega>` — local de entrega/retirada diferente do
 * endereço do destinatário, com a pessoa indicada para recebê-la. Só sai no
 * XML quando documento e endereço estão completos: um grupo pela metade é
 * pior que não mandar, porque a SEFAZ valida cada campo presente.
 */
function buildEntregaXml(entrega?: NFeEntregaOptions | null): string {
  const documento = normalizeCpfOrCnpj(entrega?.documento);
  const nome = truncateNfeXNome(cleanText(entrega?.nome));
  const logradouro = cleanText(entrega?.endereco?.logradouro);
  const numero = cleanText(entrega?.endereco?.numero);
  const complemento = cleanText(entrega?.endereco?.complemento);
  const bairro = cleanText(entrega?.endereco?.bairro);
  const codigoMunicipio = cleanText(entrega?.endereco?.codigoMunicipio);
  const nomeMunicipio = cleanText(entrega?.endereco?.nomeMunicipio);
  const uf = cleanText(entrega?.endereco?.uf).toUpperCase();
  const cep = onlyDigits(entrega?.endereco?.cep);

  const documentoValido = documento.length === 11 || documento.length === 14;
  const enderecoCompleto = Boolean(
    logradouro && numero && bairro && codigoMunicipio && nomeMunicipio && uf.length === 2,
  );
  if (!documentoValido || !enderecoCompleto) return "";

  return (
    "<entrega>" +
    (documento.length === 14 ? `<CNPJ>${documento}</CNPJ>` : `<CPF>${documento}</CPF>`) +
    (nome ? `<xNome>${escapeXml(nome)}</xNome>` : "") +
    `<xLgr>${escapeXml(logradouro)}</xLgr>` +
    `<nro>${escapeXml(numero)}</nro>` +
    (complemento ? `<xCpl>${escapeXml(complemento)}</xCpl>` : "") +
    `<xBairro>${escapeXml(bairro)}</xBairro>` +
    `<cMun>${codigoMunicipio}</cMun>` +
    `<xMun>${escapeXml(nomeMunicipio)}</xMun>` +
    `<UF>${uf}</UF>` +
    (cep.length === 8 ? `<CEP>${cep}</CEP>` : "") +
    "</entrega>"
  );
}

function buildPagXml(params: {
  pagamento?: NFePagamentoOptions | null;
  pagamentos?: NFePagamentoOptions[] | null;
  vNF: string;
  finNFe: 1 | 2 | 3 | 4;
}) {
  const pagamentos = params.finNFe === 3 || params.finNFe === 4
    ? [{ tPag: "90", valor: 0 }]
    : params.pagamentos?.length
      ? params.pagamentos
      : [params.pagamento ?? { tPag: "01" }];

  const detalhes = pagamentos.map((pagamento, index) => {
    const tPag = onlyDigits(pagamento.tPag || "01").padStart(2, "0").slice(0, 2);
    const valorInformado = Number(pagamento.valor);
    const vPag = tPag === "90"
      ? "0.00"
      : Number.isFinite(valorInformado) && valorInformado >= 0
        ? valorInformado.toFixed(2)
        : pagamentos.length === 1 && index === 0
          ? params.vNF
          : "0.00";
    // NT 2025.001 (RV YA04-10, agora obrigatória): o grupo <card> passou a ser
    // exigido também no PIX (tPag=17), não só em cartão de crédito/débito.
    // Sem ele a SEFAZ devolve a rejeição 391.
    const isCartao = tPag === "03" || tPag === "04" || tPag === "17";
    const tpIntegra = pagamento.tpIntegra === "1" ? "1" : "2";
    const cnpjCredenciadora = normalizeCnpj(pagamento.cnpjCredenciadora);
    const bandeira = onlyDigits(pagamento.bandeira);
    const autorizacao = String(pagamento.autorizacao ?? "").trim();
    const xPag = String(pagamento.xPag ?? "").trim();
    // SEFAZ só aceita/exige xPag quando tPag = 99 (Outros).
    const xPagXml = tPag === "99" && xPag ? `<xPag>${escapeXml(xPag)}</xPag>` : "";
    const cardXml = isCartao
      ? '<card>' +
        `<tpIntegra>${tpIntegra}</tpIntegra>` +
        (tpIntegra === "1" && cnpjCredenciadora.length === 14 ? `<CNPJ>${cnpjCredenciadora}</CNPJ>` : "") +
        (bandeira ? `<tBand>${bandeira}</tBand>` : "") +
        (tpIntegra === "1" && autorizacao ? `<cAut>${escapeXml(autorizacao)}</cAut>` : "") +
        '</card>'
      : "";

    return '<detPag>' + `<tPag>${tPag}</tPag>` + xPagXml + `<vPag>${vPag}</vPag>` + cardXml + '</detPag>';
  });

  const totalPago = pagamentos.reduce((total, pagamento) => {
    const valor = Number(pagamento.valor);
    return total + (Number.isFinite(valor) ? valor : 0);
  }, 0);
  const troco = totalPago - Number(params.vNF);

  return '<pag>' + detalhes.join('') + (troco > 0.009 ? `<vTroco>${troco.toFixed(2)}</vTroco>` : '') + '</pag>';
}

export function buildCobrancaXml(cobranca: NFeCobrancaNormalizada | null, numeroNota?: number): string {
  if (!cobranca) return "";
  const total = (cobranca.totalCentavos / 100).toFixed(2);
  const numeroFatura = Number.isInteger(numeroNota) && Number(numeroNota) > 0
    ? `<nFat>${escapeXml(String(numeroNota))}</nFat>` : "";
  const fatura = `<fat>${numeroFatura}<vOrig>${total}</vOrig><vDesc>0.00</vDesc><vLiq>${total}</vLiq></fat>`;
  const duplicatas = cobranca.duplicatas.map((duplicata) =>
    `<dup><nDup>${escapeXml(duplicata.numero)}</nDup><dVenc>${escapeXml(duplicata.vencimento)}</dVenc><vDup>${duplicata.valor.toFixed(2)}</vDup></dup>`,
  ).join("");
  return `<cobr>${fatura}${duplicatas}</cobr>`;
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

  const tpAmb: 1 | 2 = (options?.ambiente ?? empresa.ambiente) === 'PRODUCAO' ? 1 : 2;
  const cNF = gerarCNF(numeroNota);

  // PB defaults to 25 if not found, but now we try to read from company
  const cUF = getCodigoUF(empresa.uf || undefined);
  const modelo = options?.modelo ?? MODELO_NFE;
  const mod = modeloParaCodigo(modelo);
  const nfce = modelo === MODELO_NFCE;
  // 1 = emissão normal; 9 = contingência offline (só NFC-e).
  const tpEmis = options?.tpEmis ?? 1;

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

  // indFinal da NF-e de saída vem da decisão da emissão (destino da
  // mercadoria). Ser venda não faz de ninguém consumidor final, então não há
  // valor padrão: sem a decisão, a nota não é montada.
  if (!nfce && (options?.tpNF ?? 1) === 1 && options?.indFinal === undefined) {
    throw new Error('NFE_INDFINAL_REQUIRED: informe se a operação é com consumidor final (destino da mercadoria).');
  }

  // 2) Monta objeto ide completo
  //
  // A NFC-e tem três campos sem escolha: só documenta operação interna
  // (idDest 1), é sempre para consumidor final (indFinal 1) e o DANFE é o
  // formato próprio dela (tpImp 4). Fixar aqui evita que uma origem descuidada
  // monte um documento que a SEFAZ rejeitaria.
  const ide: NFeIde = {
    cUF,
    cNF,
    natOp: options?.natOp || (nfce ? 'VENDA AO CONSUMIDOR' : 'VENDA DE MERCADORIA'),
    mod,
    serie,
    nNF: numeroNota,
    dhEmi: formatDateTimeNFe(agora),
    tpNF: options?.tpNF ?? 1,
    idDest: nfce ? 1 : options?.idDest ?? 1,
    cMunFG: empresa.codigomunicipio,
    tpImp: nfce ? 4 : options?.tpImp ?? 1,
    tpEmis,
    cDV: dv,
    tpAmb,
    finNFe: options?.finNFe ?? 1,
    indFinal: nfce ? 1 : options?.indFinal ?? (options?.tpNF === 0 ? 0 : 1),
    indPres: options?.indPres ?? 1,
    indIntermed: indicadorIntermediador(options?.indPres ?? 1, options?.intermediador ?? null),
    procEmi: 0,
    verProc: 'ERPImoveis 2026.1',
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
  // Contrato do fluxo moderno: os itens chegam com ICMS, DIFAL e RTC já
  // resolvidos por `prepararItemFiscal`. Este builder valida a coerência do
  // canônico e serializa; não recalcula DIFAL nem RTC. A compatibilidade para
  // ICMS ausente usa somente `resolverIcmsDoItem`, que delega ao mesmo motor
  // canônico central. Chamadores legados devem passar explicitamente pelos
  // mesmos resolvedores antes desta função.
  const modelo = options?.modelo ?? MODELO_NFE;
  const nfce = modelo === MODELO_NFCE;
  // Ambiente do documento, não da empresa: as regras de homologação (nome do
  // destinatário na NF-e, descrição do 1º item na NFC-e) precisam seguir o
  // mesmo ambiente que vai para o tpAmb.
  const ambienteDocumento = options?.ambiente ?? empresa.ambiente;
  const empresaUf = String(empresa.uf ?? "").trim().toUpperCase();
  const destinatarioUf = String(destinatario?.endereco?.uf ?? "").trim().toUpperCase();
  const destinatarioPais = String(destinatario?.endereco?.codigoPais ?? "").trim();
  const destinatarioExterior =
    Boolean(destinatario) &&
    ((destinatarioPais !== "" && destinatarioPais !== "1058") || destinatarioUf === "EX");
  // NFC-e só documenta operação interna: o destino nunca muda o idDest.
  const idDest = nfce
    ? 1
    : destinatarioExterior
      ? 3
      : empresaUf && destinatarioUf && empresaUf !== destinatarioUf
        ? 2
        : 1;
  const { ide, chave, id } = criarIdeParaEmpresa(
    empresa,
    numeroNota,
    serie,
    { ...options, idDest: nfce ? 1 : options?.idDest ?? idDest }
  );

  const nomeMunicipioEmitente = cleanText(options?.nomeMunicipioEmitente);
  if (!nomeMunicipioEmitente) {
    throw new Error('Nome do município do emitente não foi resolvido pelo código IBGE.');
  }
  const emitente = mapEmpresaToEmitente(empresa, nomeMunicipioEmitente);
  const crt = normalizarCRT(emitente.crt);

  // A NFC-e pode ser emitida sem consumidor identificado — nesse caso o grupo
  // <dest> simplesmente não existe. O destinatário de teste abaixo é o
  // comportamento histórico da NF-e, que sempre exige destinatário; para a
  // NFC-e ele nunca é usado, porque inventar CPF é proibido.
  const destBase: NFeDestinatario | undefined =
    destinatario ??
    (nfce
      ? undefined
      : {
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
        });

  let dest: NFeDestinatario | undefined = destBase;

  // REGRA DE HOMOLOGAÇÃO:
  // Na NF-e, o nome do destinatário deve ser fixo conforme norma. Na NFC-e a
  // marcação é outra — vai na descrição do primeiro item, mais abaixo — porque
  // o destinatário pode nem existir.
  if (dest && !nfce && ambienteDocumento !== 'PRODUCAO') {
    // Clonamos para não afetar o objeto original (se passado por referência)
    // Nota: endereco e outros sub-objetos ainda são referencias, mas razaoSocial é primitivo.
    dest = { ...dest, razaoSocial: NFE_HOMOLOGACAO_DESTINATARIO_NOME };
  }

  // Barreira única: nenhum XML sai daqui sem a situação fiscal do destinatário
  // definida no cadastro. Fica depois do ajuste de homologação para validar
  // exatamente o objeto que vai ser serializado.
  if (dest) {
    validarInscricaoEstadualDestinatario({
      indIEDest: dest.indIEDest,
      inscricaoEstadual: dest.inscricaoEstadual,
    });
  }


  // Se itensOverride não for passado, usa o item de teste (compatibilidade)
  if (!itensOverride?.length) {
    throw new Error('NFE_ITEMS_REQUIRED: informe ao menos um item com tributacao explicita.');
  }
  const itensBase: NFeItem[] = itensOverride;

  // Garante nº do item em cada item
  const itensNumerados: NFeItem[] = itensBase.map((item, index) => ({
    ...item,
    numeroItem: item.numeroItem ?? index + 1,
    // Homologação da NFC-e: a marcação de "sem valor fiscal" vai na descrição
    // do primeiro item, e não no nome do destinatário como na NF-e.
    ...(nfce && ambienteDocumento !== 'PRODUCAO' && index === 0
      ? { descricao: NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO }
      : {}),
  }));

  // DIFAL: saida interestadual a consumidor final nao contribuinte exige o grupo
  // ICMSUFDest em todos os itens. Sem ele a SEFAZ devolve a rejeicao 694.
  // A NFC-e nunca gera o grupo: por definição é operação interna.
  const ufDestino = String(dest?.endereco?.uf ?? "");
  const exigeDifal = !nfce && deveGerarICMSUFDest({
    ufEmitente: empresaUf,
    ufDestinatario: ufDestino,
    indFinal: ide.indFinal ?? 1,
    indIEDest: dest?.indIEDest ?? "9",
    tpNF: ide.tpNF ?? 1,
  });

  const itens: NFeItem[] = itensNumerados.map((item) => {
    if (nfce) {
      if (item.icmsUfDest) {
        throw new Error(
          `NFE_DIFAL_CANONICO_DESATUALIZADO: item ${item.numeroItem}; NFC-e não admite ICMSUFDest. `
            + 'Recalcule/regrave o item fiscal antes de emitir.',
        );
      }
      return item;
    }
    // CRT e modelo entram no contexto porque entram na incidência (NA01-20,
    // exceção 12, e NA01-10). O snapshot do item guarda os dois; omiti-los aqui
    // faria toda nota recém-resolvida parecer decidida em outro contexto.
    validarDifalCanonicoDoItem(item, {
      ufEmitente: empresaUf,
      ufDestinatario: ufDestino,
      indFinal: ide.indFinal ?? 1,
      indIEDest: dest?.indIEDest ?? '9',
      tpNF: ide.tpNF ?? 1,
      finNFe: ide.finNFe,
      ufEntrega: options?.entrega?.endereco?.uf,
      crt,
      modelo,
    });
    return item;
  });

  const ideXml = buildIdeXml(
    ide,
    resolverReferenciasNFe(ide, itens, options?.documentosReferenciados ?? []),
  );
  const emitXml = buildEmitXml(emitente);
  // Consumidor não identificado: sem grupo <dest>. Só a NFC-e chega aqui sem
  // destinatário — na NF-e o placeholder acima garante que sempre existe um.
  const destXml = dest ? buildDestXml(dest) : '';
  // Venda ao consumidor é balcão: sem local de entrega/retirada diferente.
  const entregaXml = nfce ? '' : buildEntregaXml(options?.entrega);
  const detXml = itens
    .map((item) => buildDetXml(item, crt, ide.dhEmi))
    .join('');

  // =========================
  // Totais (ICMSTot)
  // =========================
  const soma = calcularTotaisNFe(itens, crt);

  const vProd = soma.vProd.toFixed(2);
  const vDesc = soma.vDesc.toFixed(2);
  const vBC = soma.vBC.toFixed(2);
  const vICMS = soma.vICMS.toFixed(2);
  const vPIS = soma.vPIS.toFixed(2);
  const vCOFINS = soma.vCOFINS.toFixed(2);
  const valorFrete = itens.reduce((total, item) => total + Number(Number(item.valorFrete ?? 0).toFixed(2)), 0);
  if (valorFrete > 0 && (nfce || (options?.transporte?.modFrete ?? '9') === '9')) {
    throw new Error('NFE_FRETE_SEM_TRANSPORTE: frete cobrado é incompatível com modFrete 9. Corrija a modalidade ou o valor. Regra de coerência do ERP.');
  }
  const vFrete = valorFrete.toFixed(2);
  // vNF inclui o IPI devolvido quando a operação usa o grupo impostoDevol.
  const vNF = (
    soma.vProd - soma.vDesc + valorFrete + soma.vST + soma.vFCPST + soma.vIPI + soma.vIPIDevol
  ).toFixed(2);
  const vNFTot = (itens.reduce((total, item) =>
    total + Math.round(valorTotalItemNFe(item, crt, ide.dhEmi) * 100), 0) / 100).toFixed(2);

  // Totais do DIFAL. Ficam entre vICMSDeson e vFCP, na ordem do leiaute 4.00,
  // e so aparecem quando a nota realmente gerou o grupo nos itens.
  const difalTotaisXml = exigeDifal
    ? (() => {
        const somar = (pegar: (grupo: NonNullable<NFeItem['icmsUfDest']>) => number) =>
          itens.reduce((total, item) => total + (item.icmsUfDest ? pegar(item.icmsUfDest) : 0), 0);
        return (
          `<vFCPUFDest>${somar((g) => g.vFCPUFDest).toFixed(2)}</vFCPUFDest>` +
          `<vICMSUFDest>${somar((g) => g.vICMSUFDest).toFixed(2)}</vICMSUFDest>` +
          `<vICMSUFRemet>${somar((g) => g.vICMSUFRemet).toFixed(2)}</vICMSUFRemet>`
        );
      })()
    : '';

  const isTotXml = soma.vIS > 0
    ? `<ISTot><vIS>${soma.vIS.toFixed(2)}</vIS></ISTot>`
    : '';
  const somarDiferimento = (grupo: 'ibsUf' | 'ibsMunicipio' | 'cbs') => (
    itens.reduce((total, item) => total + Math.round(Number(Number(item.rtc?.[grupo].valorDiferido ?? 0).toFixed(2)) * 100), 0) / 100
  ).toFixed(2);
  // Estrutura de TIBSCBSMonoTot: gIBS e gCBS exigem vCredPres e vCredPresCondSus
  // alem dos valores apurados. Omiti-los gera rejeicao 225 apontando IBSCBSTot/gIBS.
  const ibsCbsTotXml = itens.some((item) => item.rtc)
    ? '<IBSCBSTot>' +
      `<vBCIBSCBS>${soma.vBCIBSCBS.toFixed(2)}</vBCIBSCBS>` +
      '<gIBS>' +
      `<gIBSUF><vDif>${somarDiferimento('ibsUf')}</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${soma.vIBSUF.toFixed(2)}</vIBSUF></gIBSUF>` +
      `<gIBSMun><vDif>${somarDiferimento('ibsMunicipio')}</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>${soma.vIBSMun.toFixed(2)}</vIBSMun></gIBSMun>` +
      `<vIBS>${soma.vIBS.toFixed(2)}</vIBS>` +
      '<vCredPres>0.00</vCredPres>' +
      '<vCredPresCondSus>0.00</vCredPresCondSus>' +
      '</gIBS>' +
      '<gCBS>' +
      `<vDif>${somarDiferimento('cbs')}</vDif>` +
      '<vDevTrib>0.00</vDevTrib>' +
      `<vCBS>${soma.vCBS.toFixed(2)}</vCBS>` +
      '<vCredPres>0.00</vCredPres>' +
      '<vCredPresCondSus>0.00</vCredPresCondSus>' +
      '</gCBS>' +
      '</IBSCBSTot>'
    : '';

  const totalXml =
    '<total>' +
    '<ICMSTot>' +
    `<vBC>${vBC}</vBC>` +
    `<vICMS>${vICMS}</vICMS>` +
    `<vICMSDeson>${soma.vICMSDeson.toFixed(2)}</vICMSDeson>` +
    difalTotaisXml +
    `<vFCP>${soma.vFCP.toFixed(2)}</vFCP>` +
    `<vBCST>${soma.vBCST.toFixed(2)}</vBCST>` +
    `<vST>${soma.vST.toFixed(2)}</vST>` +
    `<vFCPST>${soma.vFCPST.toFixed(2)}</vFCPST>` +
    `<vFCPSTRet>${soma.vFCPSTRet.toFixed(2)}</vFCPSTRet>` +
    `<vProd>${vProd}</vProd>` +
    `<vFrete>${vFrete}</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>${vDesc}</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>${soma.vIPI.toFixed(2)}</vIPI>` +
    `<vIPIDevol>${soma.vIPIDevol.toFixed(2)}</vIPIDevol>` +
    `<vPIS>${vPIS}</vPIS>` +
    `<vCOFINS>${vCOFINS}</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF>` +
    '</ICMSTot>' +
    isTotXml +
    ibsCbsTotXml +
    // W60-10: soma dos vItem; em 2026 a exceção da VB01-10 exclui IBS/CBS/IS.
    (ibsCbsTotXml ? `<vNFTot>${vNFTot}</vNFTot>` : '') +
    '</total>';

  // Venda ao consumidor é entrega no balcão: a NFC-e sai sempre sem ocorrência
  // de transporte, independentemente do que a origem tenha gravado.
  const transpXml = nfce
    ? '<transp><modFrete>9</modFrete></transp>'
    : buildTranspXml({
        empresa,
        destinatario: dest,
        transporte: options?.transporte,
      });

  const pagXml = buildPagXml({
    pagamento: options?.pagamento,
    pagamentos: options?.pagamentos,
    vNF,
    finNFe: ide.finNFe,
  });
  const cobrancaResolvida = resolverCobrancaNFe({
    modelo,
    finNFe: ide.finNFe,
    pagamentos: options?.pagamentos?.length ? options.pagamentos : [options?.pagamento ?? { tPag: "01" }],
    cobranca: options?.cobranca,
    valorNota: vNF,
  });
  if (cobrancaResolvida.erros.length) throw new Error(cobrancaResolvida.erros[0]);
  const cobrXml = buildCobrancaXml(cobrancaResolvida.cobranca, numeroNota);
  // O <ide> já decidiu: o grupo só existe quando a nota declara plataforma de
  // terceiros. Venda que virou presencial na tela sai sem ele.
  const infIntermedXml = ide.indIntermed === 1 ? buildInfIntermedXml(options?.intermediador ?? null) : '';

  const rotulo = nfce ? 'NFC-e' : 'NF-e';
  const natOpText = options?.natOp
    ? `${rotulo} de ${options.natOp.toLowerCase()}.`
    : nfce
      ? 'NFC-e de venda ao consumidor.'
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
    entregaXml +
    detXml +
    totalXml +
    transpXml +
    cobrXml +
    pagXml +
    infIntermedXml +
    infAdicXml +
    infRespTec +
    '</infNFe>';

  const nfeXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
    infNFeXml +
    '</NFe>';

  const e16a30 = avaliarRegraE16a30Xml(nfeXml);
  if (e16a30.bloqueia) {
    throw new Error(`${CODE_E16A30}: ${mensagemBloqueioE16a30(destinatarioUf)}`);
  }

  return { xml: nfeXml, chave, id };
}
