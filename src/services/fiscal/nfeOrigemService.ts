import { validateCfopForEmission } from "@/lib/nfe/cfopOperation";
import { descontoPorItem, distribuirDinheiro } from "@/lib/nfe/descontoOrigem";
import { normalizarIndIEDest } from "@/lib/nfe/indIEDest";
import {
  LIMITE_OBSERVACOES_FISCAIS,
  resolverObservacoesFiscais,
} from "@/lib/nfe/observacoesFiscais";
import { normalizeFiscalRecipient } from "@/lib/nfe/recipientNormalization";
import {
  mapSalesChannelToPresence,
  NFE_FREIGHT_OPTIONS,
  NFE_PAYMENT_OPTIONS,
  NFE_PRESENCE_OPTIONS,
} from "@/lib/nfe/originFiscalDefaults";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";
import { inferirDescontoGeralOs } from "@/lib/ordens/totais";
import { MODELO_NFE, MODELO_NFCE, modeloParaDb, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";
import type { ClienteRow, ModeloDocumentoFiscal } from "@/lib/nfe/types";
import type { DestinoMercadoria } from "@/lib/nfe/destinoMercadoria";
import {
  salvarNFeAvulsaDraft,
  type NFeAvulsaDraftInput,
  type NFeAvulsaItemInput,
} from "@/services/fiscal/nfeAvulsaService";
import { buscarFiscalConfig } from "@/services/fiscal/nfeConfigService";

export type NFeOrigemTipo = "OS" | "VENDA" | "ENTRADA";

/** Colunas de vínculo com a origem, por tipo. */
const COLUNA_ORIGEM: Record<NFeOrigemTipo, "ordemservicoid" | "vendaid" | "entradaid"> = {
  OS: "ordemservicoid",
  VENDA: "vendaid",
  ENTRADA: "entradaid",
};

/**
 * Estados em que a nota ainda "ocupa" a origem para impedir dois rascunhos ou
 * duas transmissões concorrentes.
 *
 * REJEITADA fica de fora porque é nota que não existe na SEFAZ: o fluxo normal
 * é corrigir e retransmitir o mesmo rascunho. AUTORIZADA, CANCELADA e DENEGADA
 * também liberam a origem para uma nova emissão deliberada; a nota anterior
 * permanece vinculada e intacta.
 */
const STATUS_OCUPAM_ORIGEM = [
  "RASCUNHO",
  "ASSINADA",
  "ENVIADA",
  "PENDENTE_ENVIO",
  "CONTINGENCIA",
  "RESULTADO_INCERTO",
];

export function statusOcupaOrigem(status: unknown) {
  return STATUS_OCUPAM_ORIGEM.includes(String(status ?? "").trim().toUpperCase());
}

async function buscarNotaAtivaDaOrigem(
  tipo: NFeOrigemTipo,
  origemId: number,
  modelo: ModeloDocumentoFiscal,
  ignorarNfeId?: number | null,
) {
  type NotaAtiva = { id: number; numero: number; serie: number; status: string };

  const colunas = "id, numero, serie, status";

  // A junção primeiro: é ela que enxerga a origem agregada, que nunca aparece
  // na coluna escalar da nota. Entrada e NFC-e não têm junção e caem direto no
  // caminho legado.
  if (tipo !== "ENTRADA" && modelo !== MODELO_NFCE) {
    const { data: vinculo, error: vinculoError } = await supabaseAdmin
      .from("nfe_origem_vinculo")
      .select("nfe_id")
      .eq("tipo", tipo)
      .eq("origem_id", origemId)
      .eq("modelo", modeloParaDb(modelo))
      .eq("ativo", true)
      .order("nfe_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (vinculoError) throw vinculoError;

    if (vinculo?.nfe_id && Number(vinculo.nfe_id) !== Number(ignorarNfeId ?? 0)) {
      const { data, error } = await supabaseAdmin
        .from("nfe")
        .select(colunas)
        .eq("id", Number(vinculo.nfe_id))
        .maybeSingle();
      if (error) throw error;
      if (data) return data as NotaAtiva;
    }
  }

  // Fallback legado: notas emitidas antes da junção existir só têm a coluna
  // escalar preenchida.
  let query = supabaseAdmin
    .from("nfe")
    .select(colunas)
    .eq(COLUNA_ORIGEM[tipo], origemId)
    .eq("modelo", modeloParaDb(modelo))
    .eq("is_deleted", false)
    .in("status", STATUS_OCUPAM_ORIGEM);

  if (ignorarNfeId) query = query.neq("id", Number(ignorarNfeId));

  const { data, error } = await query
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as NotaAtiva | null;
}

export type NFeOrigemItemInput = NFeAvulsaItemInput & {
  sourceItemId: string;
};

export type NFeOrigemDraftInput = {
  /** Preenchido ao reabrir um rascunho já criado desta origem. */
  nfeId?: number | null;
  /**
   * Outras OS/vendas que esta mesma nota documenta, além da âncora que abriu a
   * emissão. Todas precisam ser do mesmo cliente: a NF-e tem um único
   * destinatário. Só vale para NF-e 55 de OS ou de venda.
   */
  origensAdicionais?: number[];
  itens: NFeOrigemItemInput[];
  observacoesFiscais?: string | null;
  /** Desconto geral confirmado na tela; já chega rateado nos itens. */
  descontoGeral?: string | number | null;
  destinatario?: NFeAvulsaDraftInput["destinatario"];
  configuracaoFiscal?: {
    /**
     * Destino da mercadoria escolhido na emissão. É dele que sai o indFinal;
     * a origem (venda ou OS) não diz se o comprador revende ou consome.
     */
    destinoMercadoria?: DestinoMercadoria | null;
    /** Só lido quando o destino é "OUTRO". */
    consumidorFinal?: boolean;
    indicadorPresenca?: string | null;
    pagamentos?: NonNullable<NFeAvulsaDraftInput["pagamentos"]>;
    transporte?: NFeAvulsaDraftInput["transporte"] & {
      /**
       * Frete da nota inteiro, confirmado na tela. Vem da venda, mas continua
       * editável — e pode ser informado numa origem que não guarda frete.
       * O serviço rateia sobre os itens emitidos.
       */
      valorFrete?: string | number | null;
    };
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
  /** Preço de tabela, sem desconto: é ele que vai para vUnCom na NF-e. */
  valorUnitario: number;
  /** Desconto do item somado à parcela do desconto geral rateada para ele. */
  valorDesconto?: number;
  valorFrete?: number;
};

type LoadedSource = {
  clienteId: number | null;
  fornecedorId: number | null;
  partnerUf: string | null;
  tipoOperacao: "SAIDA" | "ENTRADA";
  naturezaOperacao: string;
  finalidade: NFeAvulsaDraftInput["operacao"]["finalidade"];
  observacoesFiscais: string | null;
  garantia: string | null;
  destinatario: NFeAvulsaDraftInput["destinatario"] | null;
  /**
   * Só a entrada fixa o indicador: é a própria empresa documentando a compra.
   * Venda e OS deixam `null` — quem decide é o destino escolhido na emissão.
   */
  consumidorFinal: boolean | null;
  indicadorPresenca: string;
  transporte: NFeAvulsaDraftInput["transporte"];
  itens: SourceItem[];
};

/**
 * Uma das origens que a nota documenta. Guarda o texto fiscal de cada uma
 * porque, na nota agrupada, observações e garantia precisam ser compostas
 * origem a origem — não dá para ler só as da âncora.
 */
type OrigemDoGrupo = {
  tipo: NFeOrigemTipo;
  id: number;
  observacoesFiscais: string | null;
  garantia: string | null;
};

/** `LoadedSource` já resolvido para uma ou mais origens. */
type LoadedGroup = LoadedSource & { origens: OrigemDoGrupo[] };

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
  const documento = normalizeCpfOrCnpj(cliente.cpfcnpj);
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
    // Só o cadastro classifica. Cliente sem `ind_ie_dest` chega vazio aqui e a
    // validação do draft cobra a escolha — deduzir pela IE preenchida é o que
    // mandava <indIEDest>1</indIEDest> para inscrição baixada (rejeição 306).
    indicadorIe: normalizarIndIEDest(cliente.ind_ie_dest)?.toString() ?? "",
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
  const documento = normalizeCpfOrCnpj(fornecedor.cpfcnpj);
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
      "id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, ind_ie_dest, inscricaomunicipal, codigomunicipio",
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
    .select("id, clienteid, observacoes_fiscais, garantia, subtotal, orcamentototal, valor_frete")
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
      subtotal,
      produto:produtoid (id, titulo, descricao, referencia, codigobarras, unidade)
    `)
    .eq("ordemservicoid", osId);
  if (error) throw error;

  const { data: servicos, error: servicosError } = await supabaseAdmin
    .from("osservico")
    .select("subtotal")
    .eq("ordemservicoid", osId);
  if (servicosError) throw servicosError;

  const rows = data ?? [];
  // `osproduto.subtotal` já vem líquido do desconto do item; o bruto é
  // quantidade × preço unitário. A diferença é o desconto do próprio item.
  const brutoPorItem = rows.map((row: any) => toNumber(row.quantidade) * toNumber(row.precounitario));
  const liquidoPorItem = rows.map((row: any, index: number) => {
    const liquido = toNumber(row.subtotal);
    return liquido > 0 ? Math.min(liquido, brutoPorItem[index]) : brutoPorItem[index];
  });
  // Só deduz o desconto geral quando a OS tem total fechado. Sem essa guarda,
  // uma OS com `orcamentototal` ainda zerado viraria 100% de desconto.
  const descontoGeral = inferirDescontoGeralOs({
    subtotal: os.subtotal,
    orcamentoTotal: os.orcamentototal,
    valorFrete: os.valor_frete,
  });
  const descontoPorLinha = descontoPorItem(
    brutoPorItem.map((bruto, index) => ({ bruto, liquido: liquidoPorItem[index] })),
    descontoGeral,
    (servicos ?? []).map((servico: any) => toNumber(servico.subtotal)),
  );
  const freight = Math.max(0, toNumber(os.valor_frete));
  const freightByItem = distribuirDinheiro(freight, liquidoPorItem);

  const cliente = await getCliente(Number(os.clienteid));
  return {
    clienteId: Number(os.clienteid),
    fornecedorId: null,
    partnerUf: cliente.estado ?? null,
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    observacoesFiscais: os.observacoes_fiscais as string | null,
    garantia: os.garantia as string | null,
    destinatario: clienteToDraft(cliente),
    consumidorFinal: null,
    indicadorPresenca: "1",
    transporte: { modFrete: freight > 0 ? "0" : "9" },
    itens: rows.map((row: any, index: number) => {
      const produto = normalizeRelation<ProdutoFiscalRow>(row.produto);
      return {
        sourceItemId: `os:${osId}:${row.produtoid}`,
        produtoId: Number(row.produtoid),
        codigo: String(produto?.referencia || produto?.codigobarras || row.produtoid),
        descricao: String(produto?.titulo || produto?.descricao || `Produto #${row.produtoid}`),
        unidade: String(produto?.unidade || "UN"),
        quantidade: toNumber(row.quantidade),
        valorUnitario: toNumber(row.precounitario),
        valorDesconto: descontoPorLinha[index] ?? 0,
        valorFrete: freightByItem[index] ?? 0,
      };
    }),
  };
}

async function loadVenda(vendaId: number): Promise<LoadedSource> {
  const { data: venda, error: vendaError } = await supabaseAdmin
    .from("venda")
    .select("id, clienteid, observacoes_fiscais, garantia, canal, valor_frete, valortotal")
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
      sub_total,
      valor_total,
      produto:produtoid (id, titulo, descricao, referencia, codigobarras, unidade)
    `)
    .eq("venda_id", vendaId);
  if (error) throw error;

  const cliente = await getCliente(Number(venda.clienteid));
  const rows = data ?? [];
  const freight = Math.max(0, toNumber(venda.valor_frete));
  // `sub_total` é o bruto do item e `valor_total` o líquido do desconto do item.
  const brutoPorItem = rows.map((row: any) => {
    const bruto = toNumber(row.sub_total);
    return bruto > 0 ? bruto : toNumber(row.valor_total);
  });
  const liquidoPorItem = rows.map((row: any, index: number) =>
    Math.min(toNumber(row.valor_total), brutoPorItem[index]),
  );
  // O desconto geral sai da diferença entre o total dos itens já líquidos e o
  // total comercial gravado na venda (que é o líquido acrescido do frete).
  // Só vale com o total fechado: sem a guarda, uma venda com `valortotal`
  // ainda zerado viraria 100% de desconto.
  const totalLiquidoItens = liquidoPorItem.reduce((sum, valor) => sum + valor, 0);
  const totalComercial = toNumber(venda.valortotal);
  const descontoGeral = totalComercial > 0
    ? Math.max(0, Math.min(totalLiquidoItens, totalLiquidoItens + freight - totalComercial))
    : 0;
  const descontoPorLinha = descontoPorItem(
    brutoPorItem.map((bruto, index) => ({ bruto, liquido: liquidoPorItem[index] })),
    descontoGeral,
  );
  const freightByItem = distribuirDinheiro(freight, liquidoPorItem);
  return {
    clienteId: Number(venda.clienteid),
    fornecedorId: null,
    partnerUf: cliente.estado ?? null,
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    observacoesFiscais: venda.observacoes_fiscais as string | null,
    garantia: venda.garantia as string | null,
    destinatario: clienteToDraft(cliente),
    consumidorFinal: null,
    indicadorPresenca: mapSalesChannelToPresence(venda.canal),
    transporte: { modFrete: freight > 0 ? "0" : "9" },
    itens: rows.map((row: any, index: number) => {
      const produto = normalizeRelation<ProdutoFiscalRow>(row.produto);
      const quantidade = toNumber(row.quantidade);
      const bruto = brutoPorItem[index];
      return {
        sourceItemId: `venda:${vendaId}:${row.id}`,
        produtoId: Number(row.produtoid),
        codigo: String(produto?.referencia || produto?.codigobarras || row.produtoid),
        descricao: String(produto?.titulo || produto?.descricao || `Produto #${row.produtoid}`),
        unidade: String(produto?.unidade || "UN"),
        quantidade,
        // Preço de tabela: o desconto sai destacado em vDesc, e não diluído no
        // unitário, para a nota espelhar o que foi negociado com o cliente.
        valorUnitario: quantidade > 0 ? bruto / quantidade : bruto,
        valorDesconto: descontoPorLinha[index] ?? 0,
        valorFrete: freightByItem[index] ?? 0,
      };
    }),
  };
}

async function loadEntrada(entradaId: number): Promise<LoadedSource> {
  const { data: entrada, error: entradaError } = await supabaseAdmin
    .from("entrada")
    .select("id, fornecedorid, tipo, status, origem")
    .eq("id", entradaId)
    .maybeSingle();
  if (entradaError) throw entradaError;
  if (!entrada) throw new Error("Entrada não encontrada.");
  if (entrada.status !== "CONFIRMADA") throw new Error("Somente entradas confirmadas podem originar uma NF-e.");
  if (entrada.origem === "NFE_TERCEIRO") {
    throw new Error("Uma NF-e recebida de terceiro não pode originar outra NF-e de entrada.");
  }
  const { data, error } = await supabaseAdmin
    .from("entradaitens")
    .select(`
      id,
      produto_id,
      quantidade,
      precovenda, valor_unitario_compra,
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
    garantia: null,
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
        valorUnitario: toNumber(row.valor_unitario_compra ?? row.precovenda),
      };
    }),
  };
}

async function loadSource(tipo: NFeOrigemTipo, origemId: number): Promise<LoadedGroup> {
  const source =
    tipo === "OS"
      ? await loadOs(origemId)
      : tipo === "VENDA"
        ? await loadVenda(origemId)
        : await loadEntrada(origemId);

  return {
    ...source,
    origens: [
      {
        tipo,
        id: origemId,
        observacoesFiscais: source.observacoesFiscais,
        garantia: source.garantia,
      },
    ],
  };
}

/**
 * Carrega várias origens e funde numa só, para a nota consolidada.
 *
 * A fusão tem uma invariante dura e algumas conciliações. A dura é o cliente:
 * uma NF-e tem um único destinatário e `nfe.clienteid` é NOT NULL, então
 * origens de clientes diferentes não cabem na mesma nota e o erro é de
 * emissão, não de conserto automático. As conciliações — presença, frete —
 * viram aviso, porque têm um valor neutro defensável e a tela deixa corrigir.
 */
async function loadSourceGrupo(
  tipo: NFeOrigemTipo,
  ids: number[],
): Promise<
  | { ok: true; source: LoadedGroup; avisos: string[] }
  | { ok: false; errors: Array<{ step: string; field?: string; message: string }> }
> {
  const fontes: LoadedGroup[] = [];
  for (const id of ids) {
    fontes.push(await loadSource(tipo, id));
  }

  const [principal, ...demais] = fontes;
  if (demais.length === 0) return { ok: true, source: principal, avisos: [] };

  const rotulo = tipo === "OS" ? "OS" : "venda";
  const avisos: string[] = [];

  const divergentes = fontes.filter((fonte) => fonte.clienteId !== principal.clienteId);
  if (divergentes.length > 0) {
    const detalhe = fontes
      .map((fonte, index) => `${rotulo} #${ids[index]} (cliente ${fonte.clienteId ?? "sem cadastro"})`)
      .join(", ");
    return {
      ok: false,
      errors: [{
        step: "recipient",
        field: "destinatario",
        message:
          `Uma NF-e tem um único destinatário, e a seleção mistura clientes: ${detalhe}. ` +
          "Emita uma nota para cada cliente.",
      }],
    };
  }

  // Hoje estes três são constantes por tipo de origem. A checagem existe para
  // que, no dia em que deixarem de ser, a nota não saia com a natureza de uma
  // origem e os itens de outra.
  const heterogeneo = fontes.find(
    (fonte) =>
      fonte.tipoOperacao !== principal.tipoOperacao ||
      fonte.naturezaOperacao !== principal.naturezaOperacao ||
      fonte.finalidade !== principal.finalidade,
  );
  if (heterogeneo) {
    return {
      ok: false,
      errors: [{
        step: "operation",
        message:
          `Todas as ${rotulo === "OS" ? "OS" : "vendas"} agrupadas precisam ter a mesma natureza de operação e finalidade.`,
      }],
    };
  }

  // O indicador de presença da venda vem do canal, então duas vendas de canais
  // diferentes divergem de verdade. "9 — Outros" é o neutro do leiaute, e a
  // tela mostra o campo para o operador corrigir antes de transmitir.
  const presencas = [...new Set(fontes.map((fonte) => fonte.indicadorPresenca))];
  const indicadorPresenca = presencas.length === 1 ? presencas[0] : "9";
  if (presencas.length > 1) {
    avisos.push(
      "As origens selecionadas têm indicadores de presença diferentes. " +
        'A nota saiu com "9 — Outros"; confira antes de transmitir.',
    );
  }

  const itens = fontes.flatMap((fonte) => fonte.itens);
  const freteTotal = itens.reduce((total, item) => total + Math.max(0, toNumber(item.valorFrete)), 0);
  const modFretes = [...new Set(fontes.map((fonte) => String(fonte.transporte?.modFrete ?? "9")))];
  if (modFretes.length > 1) {
    avisos.push(
      "Só parte das origens selecionadas tem frete. O frete das que têm foi somado na nota.",
    );
  }

  return {
    ok: true,
    avisos,
    source: {
      ...principal,
      indicadorPresenca,
      transporte: { ...principal.transporte, modFrete: freteTotal > 0 ? "0" : "9" },
      itens,
      origens: fontes.flatMap((fonte) => fonte.origens),
    },
  };
}

/**
 * Grava o leque de origens da nota.
 *
 * Espelha `vincularResultadoAsSaidas`: o vínculo é gravado DEPOIS do rascunho,
 * e não na mesma transação. Se o índice da junção recusar — porque outra
 * emissão levou uma das origens no meio do caminho — o rascunho recém-criado
 * não pode ficar órfão. Ele ainda não foi transmitido, então apagá-lo é
 * seguro; um rascunho que já existia antes (reabertura) é preservado.
 */
async function vincularResultadoAsOrigens(
  resultado: Awaited<ReturnType<typeof salvarNFeAvulsaDraft>>,
  tipo: NFeOrigemTipo,
  origens: number[],
  reabrindo: boolean,
  modelo: ModeloDocumentoFiscal,
) {
  if (!resultado.ok) return resultado;
  // A entrada não entra na junção: ela documenta uma compra, não tem cliente
  // e nunca é agrupada.
  if (tipo === "ENTRADA") return resultado;
  // A NFC-e também fica de fora. Ela nunca é agrupada e o destinatário pode ser
  // o consumidor que se identificou no caixa, diferente do cliente da venda —
  // a junção exige que os dois sejam o mesmo e recusaria a emissão.
  if (modelo === MODELO_NFCE) return resultado;

  const { error } = await supabaseAdmin.rpc("vincular_nfe_origens", {
    p_nfe_id: resultado.nfeId,
    p_origens: origens.map((id) => ({ tipo, origem_id: id })),
  });
  if (!error) return resultado;

  if (!reabrindo) {
    await supabaseAdmin
      .from("nfe")
      .delete()
      .eq("id", resultado.nfeId)
      .eq("status", "RASCUNHO");
  }

  const rotulo = tipo === "OS" ? "Uma das OS" : "Uma das vendas";
  return {
    ok: false as const,
    errors: [{
      step: "operation",
      message: error.message?.includes("duplicate key")
        ? `${rotulo} foi usada por outra NF-e durante a emissão. Refaça a seleção.`
        : error.message || `${rotulo} não pôde ser vinculada à NF-e.`,
    }],
  };
}

export async function salvarNFeDeOrigem(
  tipo: NFeOrigemTipo,
  origemId: number,
  input: NFeOrigemDraftInput,
  modelo: ModeloDocumentoFiscal = MODELO_NFE,
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

  const isNfce = modelo === MODELO_NFCE;

  // NFC-e é documento de saída ao consumidor. Entrada de mercadoria é sempre
  // NF-e modelo 55.
  if (isNfce && tipo === "ENTRADA") {
    return {
      ok: false as const,
      errors: [{
        step: "operation",
        message: "Entrada de mercadoria não pode ser documentada por NFC-e. Use NF-e modelo 55.",
      }],
    };
  }

  // A âncora encabeça o grupo: é ela que vai para a coluna escalar da nota e
  // para `dados_avulsos.origem`, e é ela que a RPC exige que permaneça.
  const origensAdicionais = [
    ...new Set(
      (input.origensAdicionais ?? [])
        .map((valor) => Number(valor))
        .filter((valor) => Number.isInteger(valor) && valor > 0 && valor !== origemId),
    ),
  ];
  const origens = [origemId, ...origensAdicionais];

  if (origensAdicionais.length > 0 && (isNfce || tipo === "ENTRADA")) {
    return {
      ok: false as const,
      errors: [{
        step: "operation",
        message: isNfce
          ? "NFC-e documenta uma venda de balcão por vez e não pode agrupar origens."
          : "Entrada de mercadoria não pode ser agrupada com outras origens.",
      }],
    };
  }

  // Idempotência: uma origem não pode ter duas notas do mesmo modelo em curso.
  // Sem isso, o duplo clique em "Emitir" abre dois rascunhos, cada um reserva
  // seu número na transmissão. Uma nota já AUTORIZADA não entra nesta trava:
  // o usuário pode iniciar outra emissão deliberadamente para a mesma origem.
  //
  // Vale para todas as origens do grupo, não só para a âncora — uma OS
  // agregada ocupada bloqueia a emissão inteira.
  for (const candidata of origens) {
    const emAndamento = await buscarNotaAtivaDaOrigem(tipo, candidata, modelo, input.nfeId);
    if (emAndamento) {
      const rotuloOrigem =
        tipo === "OS" ? "ordem de serviço" : tipo === "VENDA" ? "venda" : "entrada";
      return {
        ok: false as const,
        errors: [{
          step: "operation",
          message:
            `A ${rotuloOrigem} #${candidata} já tem ` +
            `${rotuloModelo(modelo)} ${emAndamento.status.toLowerCase()} (nº ${emAndamento.numero}). ` +
            "Cancele ou exclua a nota existente antes de emitir outra.",
        }],
      };
    }
  }

  const grupo = await loadSourceGrupo(tipo, origens);
  if (!grupo.ok) return grupo;
  const source = grupo.source;
  const fiscalConfig = await buscarFiscalConfig(modelo);
  const incluirGarantia =
    tipo === "OS"
      ? Boolean(fiscalConfig?.incluir_garantia_os)
      : tipo === "VENDA"
        ? Boolean(fiscalConfig?.incluir_garantia_venda)
        : false;
  // Cada origem traz seu texto fiscal e sua garantia. Com uma só, o resultado
  // é exatamente o de sempre; com várias, cada bloco é rotulado, senão o
  // destinatário lê observações de três OS emendadas sem saber de qual é qual.
  const blocosPorOrigem = source.origens.map((origem) =>
    comporObservacoesComGarantia({
      observacoes: origem.observacoesFiscais,
      garantia: origem.garantia,
      incluir: incluirGarantia,
    }),
  );
  const observacoesFiscaisOrigem =
    source.origens.length === 1
      ? blocosPorOrigem[0]
      : blocosPorOrigem
          .map((bloco, index) => {
            const texto = String(bloco ?? "").trim();
            if (!texto) return "";
            const origem = source.origens[index];
            return `${origem.tipo === "OS" ? "OS" : "Venda"} #${origem.id}: ${texto}`;
          })
          .filter(Boolean)
          .join("\n") || null;
  // Na NFC-e quem manda é a tela: o operador decide se o consumidor se
  // identifica. Sem bloco de destinatário na requisição, a nota sai sem
  // consumidor identificado — que é o caso normal do balcão. O cadastro do
  // cliente da venda só serve para pré-preencher o campo, nunca para
  // identificar alguém à revelia.
  const rawDestinatario = isNfce
    ? input.destinatario ?? { clienteId: source.clienteId ?? null }
    : tipo === "ENTRADA"
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
  const observacoesFiscais = resolverObservacoesFiscais(
    input.observacoesFiscais,
    observacoesFiscaisOrigem,
  );
  if ((observacoesFiscais?.length ?? 0) > LIMITE_OBSERVACOES_FISCAIS) {
    errors.push({
      step: "operation",
      field: "observacoesFiscais",
      message:
        `As observações fiscais devem possuir no máximo ${LIMITE_OBSERVACOES_FISCAIS} caracteres. ` +
        "Reduza o texto antes de gerar a nota.",
    });
  }

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
      // A descrição é o xProd da nota, e pode ser ajustada só para ela — do
      // mesmo jeito que quantidade, valor e desconto logo abaixo. Vazia, vale
      // a da origem. Identidade (produtoId e codigo) continua fixada aqui: o
      // navegador ajusta o texto do documento, nunca de qual produto ele é.
      descricao: String(item.descricao ?? "").trim() || sourceItem.descricao,
      unidade: item.unidade || sourceItem.unidade,
      // Em OS e venda, quantidade, valor e desconto podem ser ajustados
      // exclusivamente para a NF-e — o desconto rateado da origem é só uma
      // sugestão. Entradas continuam usando os valores registrados na origem.
      quantidade: tipo === "ENTRADA" ? sourceItem.quantidade : item.quantidade,
      valorUnitario: tipo === "ENTRADA" ? sourceItem.valorUnitario : item.valorUnitario,
      valorDesconto: tipo === "ENTRADA"
        ? sourceItem.valorDesconto ?? 0
        : item.valorDesconto ?? sourceItem.valorDesconto ?? 0,
      valorFrete: tipo === "ENTRADA" ? item.valorFrete : sourceItem.valorFrete ?? item.valorFrete ?? 0,
    } satisfies NFeAvulsaItemInput];
  });

  const empresaUf = await getEmpresaUf();
  itens.forEach((item, itemIndex) => {
    const cfop = onlyDigits(item.cfop);
    const validation = validateCfopForEmission({
      value: cfop,
      modelo,
      operation: source.tipoOperacao,
      emitterUf: empresaUf,
      // NFC-e é sempre interna, mesmo quando o consumidor identificado mora
      // em outra UF; a UF dele não pode transformar o CFOP em interestadual.
      partnerUf: isNfce ? empresaUf : partnerUf,
    });
    if (!validation.valid) {
      errors.push({
        step: "products",
        itemIndex,
        field: "cfop",
        message: validation.message ?? `CFOP ${cfop} inválido.`,
      });
    }
  });

  const requestedFiscalConfig = tipo === "ENTRADA" ? undefined : input.configuracaoFiscal;
  const destinoMercadoria = isNfce || tipo === "ENTRADA"
    ? null
    : requestedFiscalConfig?.destinoMercadoria ?? null;
  const consumidorFinal = typeof requestedFiscalConfig?.consumidorFinal === "boolean"
    ? requestedFiscalConfig.consumidorFinal
    : source.consumidorFinal;
  const indicadorPresenca = String(requestedFiscalConfig?.indicadorPresenca ?? source.indicadorPresenca);
  // Venda ao consumidor sai pelo balcão: a NFC-e não carrega frete nem
  // transportadora, e o valor de frete gravado na origem não pode inflar o vNF
  // de um documento que não documenta transporte.
  const transporte = isNfce
    ? { modFrete: "9" as const }
    : requestedFiscalConfig?.transporte ?? source.transporte;
  const modFrete = String(transporte?.modFrete ?? "9");

  // O frete confirmado na tela manda; sem ele, vale o que a origem gravou para
  // as linhas emitidas. Como o leiaute 4.00 só tem vFrete por item, o valor da
  // nota é rateado proporcionalmente ao líquido de cada item.
  const freteInformado = isNfce ? null : requestedFiscalConfig?.transporte?.valorFrete;
  const itensDaNota = isNfce
    ? itens.map((item) => ({ ...item, valorFrete: 0 }))
    : freteInformado == null || freteInformado === ""
    ? itens
    : (() => {
        const liquidos = itens.map((item) =>
          Math.max(
            0,
            toNumber(item.quantidade) * toNumber(item.valorUnitario) -
              Math.max(0, toNumber(item.valorDesconto)),
          ),
        );
        const rateio = distribuirDinheiro(Math.max(0, toNumber(freteInformado)), liquidos);
        return itens.map((item, index) => ({ ...item, valorFrete: rateio[index] ?? 0 }));
      })();

  const totalProdutos = itensDaNota.reduce(
    (total, item) => total + toNumber(item.quantidade) * toNumber(item.valorUnitario),
    0,
  );
  const totalDesconto = itensDaNota.reduce(
    (total, item) => total + Math.max(0, toNumber(item.valorDesconto)),
    0,
  );
  const totalFrete = itensDaNota.reduce(
    (total, item) => total + Math.max(0, toNumber(item.valorFrete)),
    0,
  );
  const totalNota = totalProdutos - totalDesconto + totalFrete;
  const pagamentos = tipo === "ENTRADA"
    ? [{ meio: "90", valor: 0, tipoIntegracao: "2" }]
    : (requestedFiscalConfig?.pagamentos ?? []).map((pagamento) => ({
        ...pagamento,
        meio: String(pagamento.meio ?? ""),
        valor: requestedFiscalConfig?.pagamentos?.length === 1
          ? Number(totalNota.toFixed(2))
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
    Math.abs(pagamentos.reduce((total, pagamento) => total + toNumber(pagamento.valor), 0) - totalNota) > 0.01
  ) {
    errors.push({
      step: "payment",
      field: "pagamentos",
      message: "A soma dos métodos de pagamento deve ser igual ao total da NF-e, já com desconto e frete.",
    });
  }
  if (!NFE_FREIGHT_OPTIONS.some((option) => option.value === modFrete)) {
    errors.push({ step: "transport", field: "modFrete", message: "Modalidade de frete inválida para NF-e." });
  }

  if (errors.length > 0) return { ok: false as const, errors };

  const resultado = await salvarNFeAvulsaDraft({
    nfeId: input.nfeId ?? null,
    modelo,
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
      naturezaOperacao: isNfce ? "VENDA AO CONSUMIDOR" : source.naturezaOperacao,
      finalidade: source.finalidade,
      destinoMercadoria,
      // NFC-e é sempre para consumidor final, por definição do modelo. Na NF-e
      // de venda/OS o indicador sai do destino (`resolverIndFinalDaOperacao`).
      consumidorFinal: isNfce ? true : consumidorFinal,
      indicadorPresenca,
      observacoesFiscais,
    },
    pagamento: {
      meio: pagamentos[0]?.meio ?? "90",
      tipoIntegracao: "2",
    },
    pagamentos: tipo === "ENTRADA" ? undefined : pagamentos,
    // Sem o valor da tela, guarda o que os itens somam — é o mesmo número
    // quando ninguém mexeu no rateio.
    descontoGeral: input.descontoGeral ?? totalDesconto,
    transporte,
    destinatario,
    itens: itensDaNota,
  });

  // O vínculo é gravado sempre, inclusive na emissão de uma origem só: é o que
  // faz a leitura e a listagem não precisarem distinguir nota agrupada de nota
  // simples.
  const vinculado = await vincularResultadoAsOrigens(
    resultado,
    tipo,
    origens,
    Boolean(input.nfeId),
    modelo,
  );
  if (!vinculado.ok) return vinculado;
  return { ...vinculado, avisos: grupo.avisos };
}
