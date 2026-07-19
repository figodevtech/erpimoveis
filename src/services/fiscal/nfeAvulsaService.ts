import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildNFePreviewXml, type NFeTransporteOptions } from "@/lib/nfe/buildNFe";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { NFE_HOMOLOGACAO_DESTINATARIO_NOME } from "@/lib/nfe/constants";
import type { EmpresaRow, NFeDestinatario, NFeItem } from "@/lib/nfe/types";
import { resolverNomeMunicipioIbge } from "@/lib/ibge/municipio";

type NFeConfigRow = {
  id: number;
  empresaid: number;
  modelo: string;
  serie: number;
  ultimo_numero: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
};

export type NFeAvulsaItemInput = {
  produtoId?: number | null;
  codigo?: string | null;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string | number;
  valorUnitario: string | number;
  csosn?: string | null;
  cst?: string | null;
  cstPis?: string | null;
  aliquotaPis?: string | number | null;
  cstCofins?: string | null;
  aliquotaCofins?: string | number | null;
  aliquotaIcms?: string | number | null;
  cest?: string | null;
};

export type NFeAvulsaDraftInput = {
  nfeId?: number | null;
  currentStep?: number;
  operacao: {
    tipoOperacao: "SAIDA" | "ENTRADA";
    naturezaOperacao: string;
    finalidade: "NORMAL" | "COMPLEMENTAR" | "AJUSTE" | "DEVOLUCAO";
    consumidorFinal: boolean;
    indicadorPresenca: string;
    observacaoInterna?: string | null;
    observacoesFiscais?: string | null;
  };
  pagamento?: {
    meio?: string | null;
    tipoIntegracao?: "1" | "2" | string | null;
    cnpjCredenciadora?: string | null;
    bandeira?: string | null;
    autorizacao?: string | null;
  } | null;
  transporte?: {
    modFrete?: "0" | "1" | "2" | "3" | "4" | "9" | string | null;
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
  } | null;
  destinatario: {
    clienteId: number | null;
    tipoPessoa?: "FISICA" | "JURIDICA" | "ESTRANGEIRO";
    cpfCnpj?: string | null;
    nomeRazaoSocial?: string | null;
    indicadorIe?: string | null;
    inscricaoEstadual?: string | null;
    inscricaoMunicipal?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    codigoMunicipio?: string | null;
    codigoPais?: string | null;
    nomePais?: string | null;
  };
  itens: NFeAvulsaItemInput[];
};

type ValidationError = {
  step: string;
  field?: string;
  itemIndex?: number;
  message: string;
};

const unidadesPermitidas = new Set(["UN", "JGO", "KIT", "PAR", "CX", "PCT"]);

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function toDecimalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const sanitized = raw.replace(/[^\d,.-]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalDecimal(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return toDecimalNumber(value);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function getDestinatarioSnapshot(input: NFeAvulsaDraftInput, empresa: EmpresaRow): NFeDestinatario {
  const dest = input.destinatario;
  const documento = onlyDigits(dest.cpfCnpj);
  const tipoPessoa =
    dest.tipoPessoa ??
    (documento.length === 14 ? "JURIDICA" : documento.length === 11 ? "FISICA" : "ESTRANGEIRO");
  const isCnpj = tipoPessoa === "JURIDICA" || documento.length === 14;
  const isCpf = tipoPessoa === "FISICA" || documento.length === 11;
  const ie = onlyDigits(dest.inscricaoEstadual);

  return {
    cnpj: isCnpj && documento ? documento : undefined,
    cpf: isCpf && !isCnpj && documento ? documento : undefined,
    razaoSocial:
      empresa.ambiente === "PRODUCAO"
        ? cleanText(dest.nomeRazaoSocial)
        : NFE_HOMOLOGACAO_DESTINATARIO_NOME,
    indIEDest: cleanText(dest.indicadorIe) || (ie ? "1" : "9"),
    inscricaoEstadual: ie || undefined,
    endereco: {
      logradouro: cleanText(dest.endereco) || "NAO INFORMADO",
      numero: cleanText(dest.numero) || "S/N",
      complemento: cleanText(dest.complemento) || undefined,
      bairro: cleanText(dest.bairro) || "CENTRO",
      codigoMunicipio: cleanText(dest.codigoMunicipio) || empresa.codigomunicipio || "0000000",
      nomeMunicipio: cleanText(dest.cidade) || "NAO INFORMADO",
      uf: cleanText(dest.estado) || empresa.uf || "PB",
      cep: onlyDigits(dest.cep) || onlyDigits(empresa.cep) || "00000000",
      codigoPais: cleanText(dest.codigoPais) || "1058",
      nomePais: cleanText(dest.nomePais) || "BRASIL",
      telefone: onlyDigits(dest.telefone) || undefined,
    },
  };
}

function finalidadeToFinNFe(finalidade: NFeAvulsaDraftInput["operacao"]["finalidade"]) {
  if (finalidade === "COMPLEMENTAR") return 2 as const;
  if (finalidade === "AJUSTE") return 3 as const;
  if (finalidade === "DEVOLUCAO") return 4 as const;
  return 1 as const;
}

function getPagamentoFiscal(input: NFeAvulsaDraftInput) {
  const finNFe = finalidadeToFinNFe(input.operacao.finalidade);
  const rawMeio = onlyDigits(input.pagamento?.meio);
  const meioNormalizado = rawMeio ? rawMeio.padStart(2, "0").slice(0, 2) : "01";
  const meio = finNFe === 3 || finNFe === 4 ? "90" : meioNormalizado;

  return {
    tPag: meio,
    tpIntegra: input.pagamento?.tipoIntegracao === "1" ? "1" : "2",
    cnpjCredenciadora: onlyDigits(input.pagamento?.cnpjCredenciadora),
    bandeira: onlyDigits(input.pagamento?.bandeira),
    autorizacao: cleanText(input.pagamento?.autorizacao),
  };
}

function getPagamentoDadosAvulsos(input: NFeAvulsaDraftInput) {
  const pagamento = getPagamentoFiscal(input);

  return {
    meio: pagamento.tPag,
    tipoIntegracao: pagamento.tpIntegra,
    cnpjCredenciadora: pagamento.cnpjCredenciadora,
    bandeira: pagamento.bandeira,
    autorizacao: pagamento.autorizacao,
  };
}

function getTransporteFiscal(input: NFeAvulsaDraftInput): NFeTransporteOptions {
  const rawModFrete = cleanText(input.transporte?.modFrete || "9");
  const modFrete = ["0", "1", "2", "3", "4", "9"].includes(rawModFrete) ? rawModFrete : "9";

  if (modFrete === "9") {
    return { modFrete: "9" };
  }

  return {
    modFrete,
    transportadora: {
      documento: onlyDigits(input.transporte?.transportadora?.documento),
      nome: cleanText(input.transporte?.transportadora?.nome),
      inscricaoEstadual: onlyDigits(input.transporte?.transportadora?.inscricaoEstadual),
      endereco: cleanText(input.transporte?.transportadora?.endereco),
      municipio: cleanText(input.transporte?.transportadora?.municipio),
      uf: cleanText(input.transporte?.transportadora?.uf).toUpperCase().slice(0, 2),
    },
    veiculo: {
      placa: cleanText(input.transporte?.veiculo?.placa).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7),
      uf: cleanText(input.transporte?.veiculo?.uf).toUpperCase().slice(0, 2),
      rntc: cleanText(input.transporte?.veiculo?.rntc),
    },
    volume: {
      quantidade: cleanText(input.transporte?.volume?.quantidade),
      especie: cleanText(input.transporte?.volume?.especie),
      marca: cleanText(input.transporte?.volume?.marca),
      numeracao: cleanText(input.transporte?.volume?.numeracao),
      pesoLiquido: cleanText(input.transporte?.volume?.pesoLiquido),
      pesoBruto: cleanText(input.transporte?.volume?.pesoBruto),
    },
  };
}

function getTransporteDadosAvulsos(input: NFeAvulsaDraftInput) {
  return getTransporteFiscal(input);
}

function validarEmpresa(empresa: EmpresaRow | null, config: NFeConfigRow | null) {
  const erros: string[] = [];
  if (!empresa) return ["Empresa ativa não encontrada."];
  if (onlyDigits(empresa.cnpj).length !== 14) erros.push("CNPJ da empresa inválido ou ausente.");
  if (!empresa.razaosocial) erros.push("Razão social da empresa ausente.");
  if (!empresa.inscricaoestadual) erros.push("Inscrição estadual da empresa ausente.");
  if (!empresa.endereco) erros.push("Endereço da empresa ausente.");
  if (!empresa.numero) erros.push("Número do endereço da empresa ausente.");
  if (!empresa.bairro) erros.push("Bairro da empresa ausente.");
  if (!empresa.codigomunicipio) erros.push("Código IBGE do município da empresa ausente.");
  if (!empresa.uf) erros.push("UF da empresa ausente.");
  if (onlyDigits(empresa.cep).length !== 8) erros.push("CEP da empresa inválido ou ausente.");
  if (!empresa.regimetributario) erros.push("CRT/regime tributário da empresa ausente.");
  if (!empresa.ambiente) erros.push("Ambiente fiscal da empresa ausente.");
  if (!config) erros.push("Configuração de NF-e não encontrada.");
  if (!config?.serie) erros.push("Série de NF-e não configurada.");
  if (!empresa.certificadocaminho) erros.push("Certificado A1 não configurado.");
  if (!empresa.certificadosenha) erros.push("Senha do certificado A1 não configurada.");
  return erros;
}

export function validarDraftAvulso(input: NFeAvulsaDraftInput) {
  const errors: ValidationError[] = [];

  if (!cleanText(input.operacao?.naturezaOperacao)) {
    errors.push({
      step: "operation",
      field: "naturezaOperacao",
      message: "Natureza da operação é obrigatória.",
    });
  }

  const destinatario = input.destinatario ?? {};
  const docDestinatario = onlyDigits(destinatario.cpfCnpj);
  const isExterior = destinatario.tipoPessoa === "ESTRANGEIRO";

  if (!cleanText(destinatario.nomeRazaoSocial)) {
    errors.push({
      step: "recipient",
      field: "nomeRazaoSocial",
      message: "Nome ou razão social do destinatário é obrigatório.",
    });
  }
  if (!isExterior && docDestinatario.length !== 11 && docDestinatario.length !== 14) {
    errors.push({
      step: "recipient",
      field: "cpfCnpj",
      message: "CPF ou CNPJ do destinatário deve ser válido.",
    });
  }
  if (!cleanText(destinatario.endereco)) {
    errors.push({ step: "recipient", field: "endereco", message: "Endereço do destinatário é obrigatório." });
  }
  if (!cleanText(destinatario.bairro)) {
    errors.push({ step: "recipient", field: "bairro", message: "Bairro do destinatário é obrigatório." });
  }
  if (!cleanText(destinatario.cidade)) {
    errors.push({ step: "recipient", field: "cidade", message: "Cidade do destinatário é obrigatória." });
  }
  if (!cleanText(destinatario.estado)) {
    errors.push({ step: "recipient", field: "estado", message: "UF do destinatário é obrigatória." });
  }
  if (!isExterior && onlyDigits(destinatario.cep).length !== 8) {
    errors.push({ step: "recipient", field: "cep", message: "CEP do destinatário deve ter 8 dígitos." });
  }
  if (!isExterior && onlyDigits(destinatario.codigoMunicipio).length !== 7) {
    errors.push({
      step: "recipient",
      field: "codigoMunicipio",
      message: "Código IBGE do município do destinatário deve ter 7 dígitos.",
    });
  }

  if (!Array.isArray(input.itens) || input.itens.length === 0) {
    errors.push({
      step: "products",
      message: "Informe pelo menos um produto.",
    });
  }

  input.itens?.forEach((item, index) => {
    if (!cleanText(item.descricao)) {
      errors.push({ step: "products", itemIndex: index, field: "descricao", message: "Descrição obrigatória." });
    }
    if (onlyDigits(item.ncm).length !== 8) {
      errors.push({ step: "products", itemIndex: index, field: "ncm", message: "NCM deve ter 8 dígitos." });
    }
    if (onlyDigits(item.cfop).length !== 4) {
      errors.push({ step: "products", itemIndex: index, field: "cfop", message: "CFOP deve ter 4 dígitos." });
    }
    if (!unidadesPermitidas.has(cleanText(item.unidade))) {
      errors.push({ step: "products", itemIndex: index, field: "unidade", message: "Unidade inválida." });
    }
    if (toDecimalNumber(item.quantidade) <= 0) {
      errors.push({ step: "products", itemIndex: index, field: "quantidade", message: "Quantidade deve ser maior que zero." });
    }
    if (toDecimalNumber(item.valorUnitario) <= 0) {
      errors.push({ step: "products", itemIndex: index, field: "valorUnitario", message: "Valor unitário deve ser maior que zero." });
    }
  });

  const pagamentoFiscal = getPagamentoFiscal(input);

  if ((pagamentoFiscal.tPag === "03" || pagamentoFiscal.tPag === "04") && pagamentoFiscal.tpIntegra === "1") {
    if (pagamentoFiscal.cnpjCredenciadora.length !== 14) {
      errors.push({
        step: "payment",
        field: "cnpjCredenciadora",
        message: "Informe o CNPJ da credenciadora quando o cartão for integrado ao sistema.",
      });
    }
    if (!pagamentoFiscal.autorizacao) {
      errors.push({
        step: "payment",
        field: "autorizacao",
        message: "Informe o código de autorização quando o cartão for integrado ao sistema.",
      });
    }
  }

  const rawModFrete = cleanText(input.transporte?.modFrete || "9");
  const transporteFiscal = getTransporteFiscal(input);
  if (!["0", "1", "2", "3", "4", "9"].includes(rawModFrete)) {
    errors.push({
      step: "transport",
      field: "modFrete",
      message: "Modalidade de frete invÃ¡lida para NF-e.",
    });
  }

  if (["0", "1", "2"].includes(transporteFiscal.modFrete)) {
    const docTransportadora = onlyDigits(transporteFiscal.transportadora?.documento);
    if (!cleanText(transporteFiscal.transportadora?.nome)) {
      errors.push({
        step: "transport",
        field: "transportadora.nome",
        message: "Nome da transportadora Ã© obrigatÃ³rio quando o frete Ã© contratado.",
      });
    }
    if (docTransportadora.length !== 11 && docTransportadora.length !== 14) {
      errors.push({
        step: "transport",
        field: "transportadora.documento",
        message: "CPF ou CNPJ da transportadora deve ser vÃ¡lido quando o frete Ã© contratado.",
      });
    }
    if (cleanText(transporteFiscal.transportadora?.uf).length !== 2) {
      errors.push({
        step: "transport",
        field: "transportadora.uf",
        message: "UF da transportadora Ã© obrigatÃ³ria quando o frete Ã© contratado.",
      });
    }
  }

  const placa = cleanText(transporteFiscal.veiculo?.placa);
  if (placa && placa.length !== 7) {
    errors.push({
      step: "transport",
      field: "veiculo.placa",
      message: "Placa do veÃ­culo deve ter 7 caracteres.",
    });
  }

  return errors;
}

export async function getNFeAvulsaSetup() {
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id, empresaid, modelo, serie, ultimo_numero, ambiente")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<NFeConfigRow>();

  if (configError) throw configError;

  const { data: empresa, error: empresaError } = config
    ? await supabaseAdmin.from("empresa").select("*").eq("id", config.empresaid).maybeSingle<EmpresaRow>()
    : { data: null, error: null };

  if (empresaError) throw empresaError;

  let certificadoStatus = "Não configurado";
  if (empresa?.certificadocaminho && empresa?.certificadosenha) {
    try {
      await carregarCertificadoA1(empresa);
      certificadoStatus = "Certificado A1 disponível";
    } catch (error: any) {
      certificadoStatus = `Certificado inválido: ${error?.message ?? String(error)}`;
    }
  }

  const { data: clientes, error: clientesError } = await supabaseAdmin
    .from("cliente")
    .select("id, nomerazaosocial, cpfcnpj, cidade, estado")
    .eq("is_deleted", false)
    .order("nomerazaosocial", { ascending: true })
    .limit(200);

  if (clientesError) throw clientesError;

  const { data: produtos, error: produtosError } = await supabaseAdmin
    .from("produto")
    .select("id, titulo, descricao, precovenda, ncm, cfop, unidade, csosn, cst, aliquotaicms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cest")
    .eq("is_deleted", false)
    .order("titulo", { ascending: true })
    .limit(300);

  if (produtosError) throw produtosError;

  return {
    empresa,
    config,
    empresaErros: validarEmpresa(empresa, config),
    certificadoStatus,
    clientes: clientes ?? [],
    produtos: produtos ?? [],
    unidades: Array.from(unidadesPermitidas),
  };
}

async function getConfigAndEmpresa() {
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id, empresaid, modelo, serie, ultimo_numero, ambiente")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<NFeConfigRow>();

  if (configError) throw configError;
  if (!config) throw new Error("Configuração de NF-e não encontrada.");

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .eq("id", config.empresaid)
    .maybeSingle<EmpresaRow>();

  if (empresaError) throw empresaError;
  if (!empresa) throw new Error("Empresa da configuração de NF-e não encontrada.");

  const empresaErros = validarEmpresa(empresa, config);
  if (empresaErros.length > 0) {
    throw new Error(`Corrija o cadastro da empresa antes de emitir: ${empresaErros.join(" ")}`);
  }

  return { config, empresa };
}

async function alocarNumero(configId: number) {
  const { data, error } = await supabaseAdmin.rpc("nfe_alocar_numero", { p_config_id: configId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Não foi possível alocar número de NF-e.");
  return row as {
    numero: number;
    serie: number;
    empresaid: number;
    modelo: string;
    ambiente: string;
  };
}

function mapItemToInsert(item: NFeAvulsaItemInput, index: number, nfeId: number) {
  const quantidade = toDecimalNumber(item.quantidade);
  const valorUnitario = toDecimalNumber(item.valorUnitario);
  const valorTotal = Number((quantidade * valorUnitario).toFixed(2));
  const aliquotaIcms = toOptionalDecimal(item.aliquotaIcms);
  const aliquotaPis = toOptionalDecimal(item.aliquotaPis);
  const aliquotaCofins = toOptionalDecimal(item.aliquotaCofins);

  return {
    nfe_id: nfeId,
    n_item: index + 1,
    produtoid: item.produtoId ?? null,
    descricao: cleanText(item.descricao),
    ncm: onlyDigits(item.ncm),
    cfop: onlyDigits(item.cfop),
    csosn: cleanText(item.csosn) || null,
    cst: cleanText(item.cst) || null,
    cest: onlyDigits(item.cest) || null,
    unidade: cleanText(item.unidade) || "UN",
    quantidade,
    valor_unitario: valorUnitario,
    valor_total: valorTotal,
    aliquotaicms: aliquotaIcms,
    valor_bc_icms: aliquotaIcms === null ? null : valorTotal,
    valor_icms: aliquotaIcms === null ? null : Number((valorTotal * (aliquotaIcms / 100)).toFixed(2)),
    cst_pis: cleanText(item.cstPis) || null,
    aliquota_pis: aliquotaPis,
    valor_pis: aliquotaPis === null ? null : Number((valorTotal * (aliquotaPis / 100)).toFixed(2)),
    cst_cofins: cleanText(item.cstCofins) || null,
    aliquota_cofins: aliquotaCofins,
    valor_cofins: aliquotaCofins === null ? null : Number((valorTotal * (aliquotaCofins / 100)).toFixed(2)),
    updatedat: new Date().toISOString(),
  };
}

function mapItemToXml(row: any, index: number): NFeItem {
  return {
    numeroItem: Number(row.n_item ?? index + 1),
    codigoProduto: row.produtoid != null ? String(row.produtoid) : String(row.n_item ?? index + 1),
    descricao: String(row.descricao ?? ""),
    ncm: String(row.ncm ?? ""),
    cfop: String(row.cfop ?? ""),
    unidade: String(row.unidade ?? "UN"),
    quantidade: Number(row.quantidade ?? 0),
    valorUnitario: Number(row.valor_unitario ?? 0),
    valorTotal: Number(row.valor_total ?? 0),
    codigoBarras: null,
    cest: row.cest ?? null,
    cstIcms: row.cst ?? null,
    cst: row.cst ?? null,
    csosn: row.csosn ?? null,
    aliquotaIcms: row.aliquotaicms == null ? undefined : Number(row.aliquotaicms),
    baseCalculoIcms: row.valor_bc_icms == null ? undefined : Number(row.valor_bc_icms),
    valorIcms: row.valor_icms == null ? undefined : Number(row.valor_icms),
    cstPis: row.cst_pis ?? null,
    aliquotaPis: row.aliquota_pis == null ? undefined : Number(row.aliquota_pis),
    valorPis: row.valor_pis == null ? undefined : Number(row.valor_pis),
    cstCofins: row.cst_cofins ?? null,
    aliquotaCofins: row.aliquota_cofins == null ? undefined : Number(row.aliquota_cofins),
    valorCofins: row.valor_cofins == null ? undefined : Number(row.valor_cofins),
  };
}

export async function salvarNFeAvulsaDraft(input: NFeAvulsaDraftInput) {
  const errors = validarDraftAvulso(input);
  if (errors.length > 0) {
    return { ok: false as const, errors };
  }

  const { config, empresa } = await getConfigAndEmpresa();
  const nomeMunicipioEmitente = await resolverNomeMunicipioIbge(
    empresa.codigomunicipio,
    empresa.uf
  );
  const destinatario = getDestinatarioSnapshot(input, empresa);
  const pagamento = getPagamentoFiscal(input);
  const pagamentoDadosAvulsos = getPagamentoDadosAvulsos(input);
  const transporte = getTransporteFiscal(input);
  const transporteDadosAvulsos = getTransporteDadosAvulsos(input);
  const now = new Date().toISOString();
  const itensInsertBase = input.itens.map((item, index) => mapItemToInsert(item, index, 0));
  const itensXml = itensInsertBase.map(mapItemToXml);

  let nfeId = Number(input.nfeId ?? 0);
  let numero: number;
  let serie: number;
  let chave: string;
  let xml: string;

  if (!nfeId) {
    const allocated = await alocarNumero(Number(config.id));
    numero = Number(allocated.numero);
    serie = Number(allocated.serie);
    ({ xml, chave } = buildNFePreviewXml(empresa, numero, serie, itensXml, destinatario, {
      tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
      nomeMunicipioEmitente,
      natOp: cleanText(input.operacao.naturezaOperacao),
      indFinal: input.operacao.consumidorFinal ? 1 : 0,
      indPres: Number(input.operacao.indicadorPresenca || 1) as any,
      finNFe: finalidadeToFinNFe(input.operacao.finalidade),
      observacoesFiscais: input.operacao.observacoesFiscais,
      pagamento,
      transporte,
    }));

    const { data: nfe, error: insertError } = await supabaseAdmin
      .from("nfe")
      .insert({
        modelo: "NFE",
        serie,
        numero,
        chave_acesso: chave,
        ambiente: allocated.ambiente ?? config.ambiente ?? "HOMOLOGACAO",
        status: "RASCUNHO",
        ordemservicoid: null,
        vendaid: null,
        entradaid: null,
        fornecedorid: null,
        clienteid: null,
        destinatario_snapshot: destinatario,
        emitente_snapshot: {
          id: empresa.id,
          cnpj: empresa.cnpj,
          razaosocial: empresa.razaosocial,
          nomefantasia: empresa.nomefantasia,
          inscricaoestadual: empresa.inscricaoestadual,
          endereco: empresa.endereco,
          numero: empresa.numero,
          bairro: empresa.bairro,
          cidade: empresa.codigomunicipio,
          uf: empresa.uf,
          cep: empresa.cep,
          regimetributario: empresa.regimetributario,
        },
        dados_avulsos: {
          operacao: input.operacao,
          pagamento: pagamentoDadosAvulsos,
          transporte: transporteDadosAvulsos,
          destinatario: input.destinatario,
          clienteSelecionadoId: input.destinatario.clienteId ?? null,
        },
        empresaid: Number(allocated.empresaid ?? config.empresaid),
        dataemissao: now,
        total_produtos: 0,
        total_servicos: 0,
        total_nfe: 0,
        tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
        cfop: onlyDigits(input.itens[0]?.cfop),
        xml_assinado: xml,
        xml_autorizado: null,
      })
      .select("id, numero, serie")
      .single();

    if (insertError || !nfe) {
      throw new Error(`Erro ao criar rascunho de NF-e avulsa: ${insertError?.message ?? "ID não retornado"}`);
    }

    nfeId = Number(nfe.id);
  } else {
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select("id, status, numero, serie")
      .eq("id", nfeId)
      .maybeSingle();

    if (nfeError) throw nfeError;
    if (!nfe) throw new Error("Rascunho de NF-e não encontrado.");
    if (!["RASCUNHO", "REJEITADA"].includes(String(nfe.status))) {
      throw new Error("Somente NF-e em rascunho ou rejeitada pode ser alterada.");
    }

    numero = Number(nfe.numero);
    serie = Number(nfe.serie);
    ({ xml, chave } = buildNFePreviewXml(empresa, numero, serie, itensXml, destinatario, {
      tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
      nomeMunicipioEmitente,
      natOp: cleanText(input.operacao.naturezaOperacao),
      indFinal: input.operacao.consumidorFinal ? 1 : 0,
      indPres: Number(input.operacao.indicadorPresenca || 1) as any,
      finNFe: finalidadeToFinNFe(input.operacao.finalidade),
      observacoesFiscais: input.operacao.observacoesFiscais,
      pagamento,
      transporte,
    }));

    const { error: updateError } = await supabaseAdmin
      .from("nfe")
      .update({
        chave_acesso: chave,
        clienteid: null,
        destinatario_snapshot: destinatario,
        dados_avulsos: {
          operacao: input.operacao,
          pagamento: pagamentoDadosAvulsos,
          transporte: transporteDadosAvulsos,
          destinatario: input.destinatario,
          clienteSelecionadoId: input.destinatario.clienteId ?? null,
        },
        tpNF: input.operacao.tipoOperacao === "ENTRADA" ? 0 : 1,
        cfop: onlyDigits(input.itens[0]?.cfop),
        total_produtos: 0,
        total_nfe: 0,
        xml_assinado: xml,
        updatedat: now,
      })
      .eq("id", nfeId);

    if (updateError) throw updateError;

    const { error: deleteItemsError } = await supabaseAdmin.from("nfe_item").delete().eq("nfe_id", nfeId);
    if (deleteItemsError) throw deleteItemsError;
  }

  const itensInsert = itensInsertBase.map((item) => ({ ...item, nfe_id: nfeId }));
  const { error: itensError } = await supabaseAdmin.from("nfe_item").insert(itensInsert);
  if (itensError) throw itensError;

  const totalProdutos = itensInsert.reduce((sum, item) => sum + Number(item.valor_total ?? 0), 0);
  const { error: totalError } = await supabaseAdmin.rpc("atualizar_totais_nfe", { p_nfe_id: nfeId });
  if (totalError) {
    const { error: updateTotalError } = await supabaseAdmin
      .from("nfe")
      .update({
        total_produtos: totalProdutos,
        total_nfe: totalProdutos,
        updatedat: now,
      })
      .eq("id", nfeId);
    if (updateTotalError) throw updateTotalError;
  }

  const { error: xmlError } = await supabaseAdmin
    .from("nfe")
    .update({
      chave_acesso: chave,
      xml_assinado: xml,
      total_produtos: totalProdutos,
      total_nfe: totalProdutos,
      updatedat: now,
    })
    .eq("id", nfeId);

  if (xmlError) throw xmlError;

  return {
    ok: true as const,
    nfeId,
    numero,
    serie,
    chave,
    total: totalProdutos,
    errors: [],
  };
}

export async function buscarNFeAvulsaDraft(nfeId: number) {
  const { data: nfe, error: nfeError } = await supabaseAdmin
    .from("nfe")
    .select("*, cliente:clienteid (id, nomerazaosocial, cpfcnpj), empresa:empresaid (id, razaosocial, nomefantasia, cnpj)")
    .eq("id", nfeId)
    .maybeSingle();

  if (nfeError) throw nfeError;
  if (!nfe) return null;

  const { data: itens, error: itensError } = await supabaseAdmin
    .from("nfe_item")
    .select("*")
    .eq("nfe_id", nfeId)
    .order("n_item", { ascending: true });

  if (itensError) throw itensError;

  return {
    nfe,
    itens: itens ?? [],
  };
}
