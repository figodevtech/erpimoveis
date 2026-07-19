import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ClienteRow } from "@/lib/nfe/types";
import {
  salvarNFeAvulsaDraft,
  type NFeAvulsaDraftInput,
  type NFeAvulsaItemInput,
} from "@/services/fiscal/nfeAvulsaService";

export type NFeOrigemTipo = "OS" | "VENDA";

export type NFeOrigemItemInput = NFeAvulsaItemInput & {
  sourceItemId: string;
};

export type NFeOrigemDraftInput = {
  itens: NFeOrigemItemInput[];
  observacoesFiscais?: string | null;
};

type ProdutoFiscalRow = {
  id: number;
  titulo: string | null;
  descricao: string | null;
  referencia: string | null;
  codigobarras: string | null;
  unidade: string | null;
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

async function loadOs(osId: number) {
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

  const itens: SourceItem[] = (data ?? []).map((row: any) => {
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
  });

  return {
    clienteId: Number(os.clienteid),
    observacoesFiscais: os.observacoes_fiscais as string | null,
    itens,
  };
}

async function loadVenda(vendaId: number) {
  const { data: venda, error: vendaError } = await supabaseAdmin
    .from("venda")
    .select("id, clienteid, observacoes_fiscais")
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

  const itens: SourceItem[] = (data ?? []).map((row: any) => {
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
  });

  return {
    clienteId: Number(venda.clienteid),
    observacoesFiscais: venda.observacoes_fiscais as string | null,
    itens,
  };
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

  const source = tipo === "OS" ? await loadOs(origemId) : await loadVenda(origemId);
  const cliente = await getCliente(source.clienteId);
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
  const clienteUf = String(cliente.estado ?? "").trim().toUpperCase();
  const isOperacaoInterna = Boolean(empresaUf && clienteUf && empresaUf === clienteUf);
  itens.forEach((item, itemIndex) => {
    const cfop = onlyDigits(item.cfop);
    if (empresaUf && clienteUf && cfop) {
      if (isOperacaoInterna && cfop.startsWith("6")) {
        errors.push({
          step: "products",
          itemIndex,
          field: "cfop",
          message: `CFOP ${cfop} é interestadual, mas emitente e destinatário estão em ${empresaUf}.`,
        });
      }
      if (!isOperacaoInterna && cfop.startsWith("5")) {
        errors.push({
          step: "products",
          itemIndex,
          field: "cfop",
          message: `CFOP ${cfop} é interno, mas o destinatário está em ${clienteUf}.`,
        });
      }
    }
  });

  if (errors.length > 0) return { ok: false as const, errors };

  return salvarNFeAvulsaDraft({
    origem: {
      tipo,
      ordemServicoId: tipo === "OS" ? origemId : null,
      vendaId: tipo === "VENDA" ? origemId : null,
      clienteId: source.clienteId,
    },
    operacao: {
      tipoOperacao: "SAIDA",
      naturezaOperacao: "VENDA DE MERCADORIA",
      finalidade: "NORMAL",
      consumidorFinal: true,
      indicadorPresenca: "1",
      observacoesFiscais:
        input.observacoesFiscais?.trim().slice(0, 500) || source.observacoesFiscais || null,
    },
    pagamento: { meio: "01", tipoIntegracao: "2" },
    transporte: { modFrete: "9" },
    destinatario: clienteToDraft(cliente),
    itens,
  });
}
