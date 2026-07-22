import { isCfopCompatibleWithOperation } from "@/lib/nfe/cfopOperation";
import { normalizeFiscalRecipient } from "@/lib/nfe/recipientNormalization";
import {
  mapSalesChannelToPresence,
  NFE_FREIGHT_OPTIONS,
  NFE_PAYMENT_OPTIONS,
  NFE_PRESENCE_OPTIONS,
} from "@/lib/nfe/originFiscalDefaults";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ClienteRow } from "@/lib/nfe/types";
import {
  salvarNFeAvulsaDraft,
  type NFeAvulsaDraftInput,
  type NFeAvulsaItemInput,
} from "@/services/fiscal/nfeAvulsaService";

export type NFeOrigemTipo = "OS" | "VENDA" | "ENTRADA";

export type NFeOrigemItemInput = NFeAvulsaItemInput & {
  sourceItemId: string;
};

export type NFeOrigemDraftInput = {
  itens: NFeOrigemItemInput[];
  observacoesFiscais?: string | null;
  destinatario?: NFeAvulsaDraftInput["destinatario"];
  configuracaoFiscal?: {
    consumidorFinal?: boolean;
    indicadorPresenca?: string | null;
    pagamentos?: NonNullable<NFeAvulsaDraftInput["pagamentos"]>;
    transporte?: NFeAvulsaDraftInput["transporte"];
  };
};

type ProdutoFiscalRow = {
  id: number;
  titulo: string | null;
  descricao: string | null;
  referencia: string | null;
  codigobarras: string | null;
  unidade: string | null;
};

type FornecedorRow = {
  id: number;
  cpfcnpj: string | null;
  nomerazaosocial: string | null;
  contato: string | null;
  endereco: string | null;
  endereconumero: string | null;
  enderecocomplemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  codigomunicipio: string | null;
};

type SourceItem = {
  sourceItemId: string;
  produtoId: number;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
};

type LoadedSource = {
  clienteId: number | null;
  fornecedorId: number | null;
  partnerUf: string | null;
  tipoOperacao: "SAIDA" | "ENTRADA";
  naturezaOperacao: string;
  finalidade: NFeAvulsaDraftInput["operacao"]["finalidade"];
  observacoesFiscais: string | null;
  destinatario: NFeAvulsaDraftInput["destinatario"] | null;
  consumidorFinal: boolean;
  indicadorPresenca: string;
  transporte: NFeAvulsaDraftInput["transporte"];
  itens: SourceItem[];
};

function normalizeRelation<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clienteToDraft(cliente: ClienteRow): NFeAvulsaDraftInput["destinatario"] {
  const documento = onlyDigits(cliente.cpfcnpj);
  return {
    clienteId: cliente.id,
    tipoPessoa:
      cliente.tipopessoa === "ESTRANGEIRO"
        ? "ESTRANGEIRO"
        : documento.length === 14
          ? "JURIDICA"
          : "FISICA",
    cpfCnpj: documento,
    nomeRazaoSocial: cliente.nomerazaosocial,
    indicadorIe: cliente.inscricaoestadual ? "1" : "9",
    inscricaoEstadual: cliente.inscricaoestadual,
    inscricaoMunicipal: cliente.inscricaomunicipal,
    email: cliente.email,
    telefone: cliente.telefone,
    endereco: cliente.endereco,
    numero: cliente.endereconumero,
    complemento: cliente.enderecocomplemento,
    bairro: cliente.bairro,
    cidade: cliente.cidade,
    estado: cliente.estado,
    cep: cliente.cep,
    codigoMunicipio: cliente.codigomunicipio,
    codigoPais: "1058",
    nomePais: "BRASIL",
  };
}

function fornecedorToDraft(fornecedor: FornecedorRow): NFeAvulsaDraftInput["destinatario"] {
  const documento = onlyDigits(fornecedor.cpfcnpj);
  return {
    clienteId: null,
    tipoPessoa: documento.length === 14 ? "JURIDICA" : "FISICA",
    cpfCnpj: documento,
    nomeRazaoSocial: fornecedor.nomerazaosocial,
    indicadorIe: "9",
    telefone: fornecedor.contato,
    endereco: fornecedor.endereco,
    numero: fornecedor.endereconumero,
    complemento: fornecedor.enderecocomplemento,
    bairro: fornecedor.bairro,
    cidade: fornecedor.cidade,
    estado: fornecedor.estado,
    cep: fornecedor.cep,
    codigoMunicipio: fornecedor.codigomunicipio,
    codigoPais: "1058",
    nomePais: "BRASIL",
  };
}

async function getCliente(clienteId: number) {
  const { data, error } = await supabaseAdmin
    .from("cliente")
    .select(
      "id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio",
    )
    .eq("id", clienteId)
    .maybeSingle<ClienteRow>();

  if (error) throw error;
  if (!data) throw new Error("Cliente da origem não encontrado.");
  return data;
}

async function getFornecedor(fornecedorId: number) {
  const { data, error } = await supabaseAdmin
    .from("fornecedor")
    .select(
      "id, cpfcnpj, nomerazaosocial, contato, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, codigomunicipio",
    )
    .eq("id", fornecedorId)
    .maybeSingle<FornecedorRow>();

  if (error) throw error;
  if (!data) throw new Error("Fornecedor da entrada não encontrado.");
  return data;
}

async function getEmpresaUf() {
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("empresaid")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (configError) throw configError;
  if (!config) throw new Error("Configuração de NF-e não encontrada.");

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("uf")
    .eq("id", config.empresaid)
    .maybeSingle();
  if (empresaError) throw empresaError;
  return String(empresa?.uf ?? "").trim().toUpperCase();
}

async function loadOs(osId: number): Promise<LoadedSource> {
  const { data: os, error: osError } = await supabaseAdmin
    .from("ordemservico")
    .select("id, clienteid, observacoes_fiscais")
    .eq("id", osId)
    .maybeSingle();
  if (osError) throw osError;
  if (!os) throw new Error("Ordem de serviço não encontrada.");
  if (!os.clienteid) throw new Error("A ordem de serviço não possui cliente cadastrado.");

  const { data, error } = await supabaseAdmin
    .from("osproduto")
    .select(`
      ordemservicoid,
      produtoid,
      quantidade,
      precounitario,
      produto:produtoid (id, titulo, descricao, referencia, codigobarras, unidade)
    `)
    .eq("ordemservicoid", osId);
  if (error) throw error;

  const cliente = await getCliente(Number(os.clienteid));
  return {
    clienteId: Number(os.clienteid),
    fornecedorId: null,
    partnerUf: cliente.estado ?? null,
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    observacoesFiscais: os.observacoes_fiscais as string | null,
    destinatario: clienteToDraft(cliente),
    consumidorFinal: true,
    indicadorPresenca: "1",
    transporte: { modFrete: "9" },
    itens: (data ?? []).map((row: any) => {
      const produto = normalizeRelation<ProdutoFiscalRow>(row.produto);
      return {
        sourceItemId: `os:${osId}:${row.produtoid}`,
        produtoId: Number(row.produtoid),
        codigo: String(produto?.referencia || produto?.codigobarras || row.produtoid),
        descricao: String(produto?.titulo || produto?.descricao || `Produto #${row.produtoid}`),
        unidade: String(produto?.unidade || "UN"),
        quantidade: toNumber(row.quantidade),
        valorUnitario: toNumber(row.precounitario),
      };
    }),
  };
}

async function loadVenda(vendaId: number): Promise<LoadedSource> {
  const { data: venda, error: vendaError } = await supabaseAdmin
    .from("venda")
    .select("id, clienteid, observacoes_fiscais, canal")
    .eq("id", vendaId)
    .maybeSingle();
  if (vendaError) throw vendaError;
  if (!venda) throw new Error("Venda não encontrada.");
  if (!venda.clienteid) throw new Error("A venda não possui cliente cadastrado.");

  const { data, error } = await supabaseAdmin
    .from("vendaproduto")
    .select(`
      id,
      produtoid,
      quantidade,
      valor_total,
      produto:produtoid (id, titulo, descricao, referencia, codigobarras, unidade)
    `)
    .eq("venda_id", vendaId);
  if (error) throw error;

  const cliente = await getCliente(Number(venda.clienteid));
  return {
    clienteId: Number(venda.clienteid),
    fornecedorId: null,
    partnerUf: cliente.estado ?? null,
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    observacoesFiscais: venda.observacoes_fiscais as string | null,
    destinatario: clienteToDraft(cliente),
    consumidorFinal: true,
    indicadorPresenca: mapSalesChannelToPresence(venda.canal),
    transporte: { modFrete: "9" },
    itens: (data ?? []).map((row: any) => {
      const produto = normalizeRelation<ProdutoFiscalRow>(row.produto);
      const quantidade = toNumber(row.quantidade);
      const valorTotal = toNumber(row.valor_total);
      return {
        sourceItemId: `venda:${vendaId}:${row.id}`,
        produtoId: Number(row.produtoid),
        codigo: String(produto?.referencia || produto?.codigobarras || row.produtoid),
        descricao: String(produto?.titulo || produto?.descricao || `Produto #${row.produtoid}`),
        unidade: String(produto?.unidade || "UN"),
        quantidade,
        valorUnitario: quantidade > 0 ? valorTotal / quantidade : valorTotal,
      };
    }),
  };
}

async function loadEntrada(entradaId: number): Promise<LoadedSource> {
  const { data: entrada, error: entradaError } = await supabaseAdmin
    .from("entrada")
    .select("id, fornecedorid, tipo")
    .eq("id", entradaId)
    .maybeSingle();
  if (entradaError) throw entradaError;
  if (!entrada) throw new Error("Entrada não encontrada.");
  const { data, error } = await supabaseAdmin
    .from("entradaitens")
    .select(`
      id,
      produto_id,
      quantidade,
      precovenda,
      referencia,
      titulo,
      unidade,
      produto:produto_id (id, titulo, descricao, referencia, codigobarras, unidade)
    `)
    .eq("entrada_id", entradaId);
  if (error) throw error;

  const fornecedor = entrada.fornecedorid
    ? await getFornecedor(Number(entrada.fornecedorid))
    : null;
  const naturezaOperacao =
    entrada.tipo === "DEVOLUCAO"
      ? "ENTRADA POR DEVOLUCAO"
      : entrada.tipo === "COMPRA_PF"
        ? "COMPRA DE PESSOA FISICA"
        : "COMPRA PARA COMERCIALIZACAO";

  return {
    clienteId: null,
    fornecedorId: fornecedor?.id ?? null,
    partnerUf: fornecedor?.estado ?? null,
    tipoOperacao: "ENTRADA",
    naturezaOperacao,
    finalidade: "NORMAL",
    observacoesFiscais: null,
    destinatario: fornecedor ? fornecedorToDraft(fornecedor) : null,
    consumidorFinal: false,
    indicadorPresenca: "0",
    transporte: { modFrete: "9" },
    itens: (data ?? []).map((row: any) => {
      const produto = normalizeRelation<ProdutoFiscalRow>(row.produto);
      return {
        sourceItemId: `entrada:${entradaId}:${row.id}`,
        produtoId: Number(row.produto_id),
        codigo: String(row.referencia || produto?.referencia || produto?.codigobarras || row.produto_id),
        descricao: String(row.titulo || produto?.titulo || produto?.descricao || `Produto #${row.produto_id}`),
        unidade: String(row.unidade || produto?.unidade || "UN"),
        quantidade: toNumber(row.quantidade),
        valorUnitario: toNumber(row.precovenda),
      };
    }),
  };
}

async function loadSource(tipo: NFeOrigemTipo, origemId: number) {
  if (tipo === "OS") return loadOs(origemId);
  if (tipo === "VENDA") return loadVenda(origemId);
  return loadEntrada(origemId);
}

export async function salvarNFeDeOrigem(
  tipo: NFeOrigemTipo,
  origemId: number,
  input: NFeOrigemDraftInput,
) {
  if (!Number.isFinite(origemId) || origemId <= 0) {
    throw new Error("Identificador da origem inválido.");
  }
  if (!Array.isArray(input.itens) || input.itens.length === 0) {
    return {
      ok: false as const,
      errors: [{ step: "products", message: "Selecione pelo menos um produto." }],
    };
  }

  const source = await loadSource(tipo, origemId);
  const rawDestinatario = tipo === "ENTRADA"
    ? input.destinatario ?? source.destinatario
    : source.destinatario;
  if (!rawDestinatario) {
    return {
      ok: false as const,
      errors: [{ step: "recipient", message: "Preencha os dados do fornecedor da NF-e de entrada." }],
    };
  }
  const destinatario = normalizeFiscalRecipient(rawDestinatario);
  const partnerUf = tipo === "ENTRADA"
    ? String(destinatario.estado ?? "").trim().toUpperCase()
    : source.partnerUf;
  const sourceById = new Map(source.itens.map((item) => [item.sourceItemId, item]));
  const requestedIds = new Set<string>();
  const errors: Array<{ step: string; itemIndex?: number; field?: string; message: string }> = [];

  const itens = input.itens.flatMap((item, itemIndex) => {
    if (requestedIds.has(item.sourceItemId)) {
      errors.push({ step: "products", itemIndex, message: "A mesma linha foi selecionada mais de uma vez." });
      return [];
    }
    requestedIds.add(item.sourceItemId);

    const sourceItem = sourceById.get(item.sourceItemId);
    if (!sourceItem || sourceItem.produtoId !== Number(item.produtoId)) {
      errors.push({ step: "products", itemIndex, message: "O item não pertence mais à origem selecionada." });
      return [];
    }

    return [{
      ...item,
      produtoId: sourceItem.produtoId,
      codigo: sourceItem.codigo,
      descricao: sourceItem.descricao,
      unidade: item.unidade || sourceItem.unidade,
      quantidade: sourceItem.quantidade,
      valorUnitario: sourceItem.valorUnitario,
    } satisfies NFeAvulsaItemInput];
  });

  const empresaUf = await getEmpresaUf();
  itens.forEach((item, itemIndex) => {
    const cfop = onlyDigits(item.cfop);
    if (
      empresaUf &&
      partnerUf &&
      cfop &&
      !isCfopCompatibleWithOperation(cfop, source.tipoOperacao, empresaUf, partnerUf)
    ) {
      errors.push({
        step: "products",
        itemIndex,
        field: "cfop",
        message: `CFOP ${cfop} é incompatível com esta operação de ${source.tipoOperacao === "ENTRADA" ? "entrada" : "saída"}.`,
      });
    }
  });

  const requestedFiscalConfig = tipo === "ENTRADA" ? undefined : input.configuracaoFiscal;
  const consumidorFinal = typeof requestedFiscalConfig?.consumidorFinal === "boolean"
    ? requestedFiscalConfig.consumidorFinal
    : source.consumidorFinal;
  const indicadorPresenca = String(requestedFiscalConfig?.indicadorPresenca ?? source.indicadorPresenca);
  const transporte = requestedFiscalConfig?.transporte ?? source.transporte;
  const modFrete = String(transporte?.modFrete ?? "9");
  const totalProdutos = itens.reduce(
    (total, item) => total + toNumber(item.quantidade) * toNumber(item.valorUnitario),
    0,
  );
  const pagamentos = tipo === "ENTRADA"
    ? [{ meio: "90", valor: 0, tipoIntegracao: "2" }]
    : (requestedFiscalConfig?.pagamentos ?? []).map((pagamento) => ({
        ...pagamento,
        meio: String(pagamento.meio ?? ""),
        valor: requestedFiscalConfig?.pagamentos?.length === 1
          ? Number(totalProdutos.toFixed(2))
          : Number(toNumber(pagamento.valor).toFixed(2)),
        tipoIntegracao: "2",
      }));

  if (!NFE_PRESENCE_OPTIONS.some((option) => option.value === indicadorPresenca)) {
    errors.push({ step: "operation", field: "indicadorPresenca", message: "Indicador de presença inválido para NF-e." });
  }
  if (pagamentos.length === 0) {
    errors.push({ step: "payment", field: "pagamentos", message: "Selecione pelo menos um método de pagamento." });
  }
  if (new Set(pagamentos.map((pagamento) => pagamento.meio)).size !== pagamentos.length) {
    errors.push({
      step: "payment",
      field: "pagamentos",
      message: "O mesmo método de pagamento não pode ser informado mais de uma vez.",
    });
  }
  pagamentos.forEach((pagamento, paymentIndex) => {
    if (
      tipo !== "ENTRADA" &&
      (pagamento.meio === "90" ||
        !NFE_PAYMENT_OPTIONS.some((option) => option.value === pagamento.meio))
    ) {
      errors.push({
        step: "payment",
        field: `pagamentos.${paymentIndex}.meio`,
        message: "Método de pagamento inválido para esta emissão.",
      });
    }
    if (pagamentos.length > 1 && toNumber(pagamento.valor) <= 0) {
      errors.push({
        step: "payment",
        field: `pagamentos.${paymentIndex}.valor`,
        message: "Informe um valor maior que zero para cada método de pagamento.",
      });
    }
  });
  if (
    pagamentos.length > 1 &&
    Math.abs(pagamentos.reduce((total, pagamento) => total + toNumber(pagamento.valor), 0) - totalProdutos) > 0.01
  ) {
    errors.push({
      step: "payment",
      field: "pagamentos",
      message: "A soma dos métodos de pagamento deve ser igual ao total dos produtos selecionados.",
    });
  }
  if (!NFE_FREIGHT_OPTIONS.some((option) => option.value === modFrete)) {
    errors.push({ step: "transport", field: "modFrete", message: "Modalidade de frete inválida para NF-e." });
  }

  if (errors.length > 0) return { ok: false as const, errors };

  return salvarNFeAvulsaDraft({
    origem: {
      tipo,
      ordemServicoId: tipo === "OS" ? origemId : null,
      vendaId: tipo === "VENDA" ? origemId : null,
      entradaId: tipo === "ENTRADA" ? origemId : null,
      clienteId: source.clienteId,
      fornecedorId: source.fornecedorId,
    },
    operacao: {
      tipoOperacao: source.tipoOperacao,
      naturezaOperacao: source.naturezaOperacao,
      finalidade: source.finalidade,
      consumidorFinal,
      indicadorPresenca,
      observacoesFiscais:
        input.observacoesFiscais?.trim().slice(0, 500) || source.observacoesFiscais || null,
    },
    pagamento: {
      meio: pagamentos[0]?.meio ?? "90",
      tipoIntegracao: "2",
    },
    pagamentos: tipo === "ENTRADA" ? undefined : pagamentos,
    transporte,
    destinatario,
    itens,
  });
}
