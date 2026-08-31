import { validateCfopForEmission } from "@/lib/nfe/cfopOperation";
import {
  destinoDaCompraPorOperacao,
  sugerirCfopDevolucaoDeCompra,
} from "@/lib/nfe/cfopDevolucao";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { resolverObservacoesFiscais } from "@/lib/nfe/observacoesFiscais";
import {
  ORIGEM_NFE_ENTRADA,
  resolverPadraoFiscalItem,
  type CamposFiscaisResolvidos,
} from "@/lib/nfe/padraoFiscalItem";
import { extrairItemFiscalNfe } from "@/services/fiscal/dfeXmlParser";
import { buscarContextoPadraoFiscal, buscarFiscalConfig } from "@/services/fiscal/nfeConfigService";
import {
  montarReferenciasFiscaisSaida,
  normalizarNumeroItemReferenciado,
  OPERACOES_FISCAIS_SAIDA,
  type FinalidadeFiscalSaida,
  validarReferenciaFiscalSaida,
} from "@/lib/nfe/saidaFiscal";
import {
  isValidCnpj,
  isValidCpf,
  normalizeFiscalRecipient,
  type FiscalRecipientInput,
} from "@/lib/nfe/recipientNormalization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  salvarNFeAvulsaDraft,
  type NFeAvulsaDraftInput,
  type NFeAvulsaItemInput,
} from "@/services/fiscal/nfeAvulsaService";

const STATUS_OCUPAM_SAIDA = [
  "RASCUNHO",
  "ASSINADA",
  "ENVIADA",
  "AUTORIZADA",
  "PENDENTE_ENVIO",
  "CONTINGENCIA",
  "RESULTADO_INCERTO",
];

export type SaidaFiscalItemInput = {
  /** Saída física dona do item. Omitido mantém compatibilidade com o fluxo antigo. */
  saidaId?: number | null;
  saidaItemId: number;
  entradaItemOrigemId?: number | null;
  numeroItemReferenciado?: number | null;
  percentualDevolucao?: number | null;
  valorIpiDevolvido?: number | null;
};

export type SalvarContextoFiscalSaidaInput = {
  operacaoFiscalCodigo: string;
  naturezaOperacao?: string | null;
  finalidade?: FinalidadeFiscalSaida | null;
  documentoReferenciadoObrigatorio?: boolean;
  chaveAcessoReferenciada?: string | null;
  observacoesFiscais?: string | null;
  destinatario: FiscalRecipientInput & { fornecedorId?: number | null };
  itens: SaidaFiscalItemInput[];
};

export type NFeSaidaDraftInput = {
  nfeId?: number | null;
  itens: Array<NFeAvulsaItemInput & { sourceItemId: string }>;
  destinatario: NFeAvulsaDraftInput["destinatario"];
  observacoesFiscais?: string | null;
  /**
   * Natureza fiscal, documento de origem e vínculo item↔entrada, escolhidos no
   * diálogo de emissão. Quando vem preenchido, é gravado antes de montar a nota
   * — assim a emissão inteira acontece numa chamada só, sem depender de um PUT
   * anterior. Omitido, vale o contexto já gravado.
   */
  contextoFiscal?: Omit<SalvarContextoFiscalSaidaInput, "destinatario"> | null;
};

type DestinatarioFiscalSaida = NFeAvulsaDraftInput["destinatario"] & {
  fornecedorId?: number | null;
};

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function validarDestinatarioFiscalSaida(value: FiscalRecipientInput) {
  const destinatario = normalizeFiscalRecipient(value);
  const exterior = destinatario.tipoPessoa === "ESTRANGEIRO";
  const documento = onlyDigits(destinatario.cpfCnpj);

  if (!cleanText(destinatario.nomeRazaoSocial)) {
    throw new Error("Informe o fornecedor ou destinatário da NF-e de saída.");
  }
  if (
    !exterior &&
    ((destinatario.tipoPessoa === "FISICA" && !isValidCpf(documento)) ||
      (destinatario.tipoPessoa !== "FISICA" && !isValidCnpj(documento)))
  ) {
    throw new Error(`${destinatario.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} do destinatário é inválido.`);
  }
  if (!["1", "2", "9"].includes(cleanText(destinatario.indicadorIe))) {
    throw new Error("Indicador de inscrição estadual do destinatário é inválido.");
  }
  if (destinatario.indicadorIe === "1" && !onlyDigits(destinatario.inscricaoEstadual)) {
    throw new Error("Informe a inscrição estadual do destinatário contribuinte de ICMS.");
  }
  if (!cleanText(destinatario.endereco) || !cleanText(destinatario.bairro)) {
    throw new Error("Complete o endereço e o bairro do destinatário.");
  }
  if (!cleanText(destinatario.cidade) || !/^[A-Z]{2}$/.test(cleanText(destinatario.estado))) {
    throw new Error("Complete a cidade e a UF do destinatário.");
  }
  if (!exterior && onlyDigits(destinatario.cep).length !== 8) {
    throw new Error("CEP do destinatário deve ter 8 dígitos.");
  }
  if (!exterior && onlyDigits(destinatario.codigoMunicipio).length !== 7) {
    throw new Error("Código IBGE do município do destinatário deve ter 7 dígitos.");
  }
  if (
    cleanText(destinatario.email) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(destinatario.email))
  ) {
    throw new Error("E-mail do destinatário é inválido.");
  }

  return destinatario;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export type OperacaoFiscalSaidaConfig = {
  codigo: string;
  label: string;
  naturezaOperacao: string;
  finalidade: FinalidadeFiscalSaida;
  cfopInterno: string;
  cfopInterestadual: string;
  exigeDocumentoReferenciado: boolean;
};

export async function buscarOperacoesFiscaisSaida(): Promise<OperacaoFiscalSaidaConfig[]> {
  const { data, error } = await supabaseAdmin
    .from("fiscal_nfe_saida_operacao")
    .select("codigo, nome, natureza_operacao, finalidade, cfop_interno, cfop_interestadual, exige_documento_referenciado")
    .eq("ativo", true)
    .order("ordem", { ascending: true });
  if (error) throw error;
  if (data?.length) {
    return data.map((row: any) => ({
      codigo: String(row.codigo),
      label: String(row.nome),
      naturezaOperacao: String(row.natureza_operacao ?? ""),
      finalidade: row.finalidade as FinalidadeFiscalSaida,
      cfopInterno: String(row.cfop_interno ?? ""),
      cfopInterestadual: String(row.cfop_interestadual ?? ""),
      exigeDocumentoReferenciado: Boolean(row.exige_documento_referenciado),
    }));
  }
  return Object.values(OPERACOES_FISCAIS_SAIDA) as OperacaoFiscalSaidaConfig[];
}

export async function buscarOperacaoFiscalSaida(codigo: unknown) {
  const operacoes = await buscarOperacoesFiscaisSaida();
  return operacoes.find((operacao) => operacao.codigo === String(codigo)) ?? null;
}

function fornecedorToDestinatario(fornecedor: any): DestinatarioFiscalSaida {
  const documento = onlyDigits(fornecedor?.cpfcnpj);
  return {
    fornecedorId: Number(fornecedor?.id ?? 0) || null,
    clienteId: null,
    tipoPessoa: documento.length === 11 ? "FISICA" : "JURIDICA",
    cpfCnpj: documento,
    nomeRazaoSocial: fornecedor?.nomerazaosocial ?? "",
    // O cadastro atual de fornecedor não guarda a situação de IE. A tela
    // assistida exige a confirmação explícita antes de gerar o rascunho.
    indicadorIe: "9",
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    email: "",
    telefone: fornecedor?.contato ?? "",
    endereco: fornecedor?.endereco ?? "",
    numero: fornecedor?.endereconumero ?? "",
    complemento: fornecedor?.enderecocomplemento ?? "",
    bairro: fornecedor?.bairro ?? "",
    cidade: fornecedor?.cidade ?? "",
    estado: fornecedor?.estado ?? "",
    cep: onlyDigits(fornecedor?.cep),
    codigoMunicipio: onlyDigits(fornecedor?.codigomunicipio),
    codigoPais: "1058",
    nomePais: "BRASIL",
  };
}

async function carregarSaida(saidaId: number) {
  const { data, error } = await supabaseAdmin
    .from("estoque_saida")
    .select(`
      id, motivo, observacao, status, created_at,
      itens:estoque_saida_item(
        id, produto_id, quantidade, valor_custo_aplicado,
        produto:produto_id(
          id, titulo, descricao, referencia, codigobarras, unidade, ncm, cfop,
          origem_mercadoria, csosn, cst, cest, aliquotaicms,
          cst_pis, aliquota_pis, modo_pis, aliquota_por_unidade_pis,
          cst_cofins, aliquota_cofins, modo_cofins, aliquota_por_unidade_cofins,
          rtc_habilitado, cst_ibscbs, cclass_trib,
          aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs
        )
      )
    `)
    .eq("id", saidaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Saída de estoque não encontrada.");
  if (data.status !== "CONFIRMADA") {
    throw new Error("Somente saídas confirmadas podem originar uma NF-e.");
  }
  return { ...data, itens: (data.itens ?? []).sort((a: any, b: any) => Number(a.id) - Number(b.id)) };
}

async function carregarEntradaItem(entradaItemId: number) {
  const { data, error } = await supabaseAdmin
    .from("entradaitens")
    .select(`
      id, entrada_id, produto_id, quantidade, valor_unitario_compra, precovenda,
      numero_item_fiscal,
      entrada:entrada_id(
        id, fiscal, status, notachave, fornecedorid, fiscal_dfe_documento_id, created_at,
        fornecedor:fornecedorid(
          id, cpfcnpj, nomerazaosocial, contato, endereco, endereconumero,
          enderecocomplemento, bairro, cidade, estado, cep, codigomunicipio
        )
      )
    `)
    .eq("id", entradaItemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function buscarContextoFiscalSaida(saidaId: number) {
  const saida = await carregarSaida(saidaId);
  const { data: contexto, error } = await supabaseAdmin
    .from("estoque_saida_fiscal")
    .select("*, itens:estoque_saida_item_fiscal(*)")
    .eq("saida_id", saidaId)
    .maybeSingle();
  if (error) throw error;

  let destinatario = contexto?.destinatario_snapshot ?? null;
  if (!destinatario && contexto?.entrada_origem_id) {
    const { data: entrada, error: entradaError } = await supabaseAdmin
      .from("entrada")
      .select(`
        fornecedor:fornecedorid(
          id, cpfcnpj, nomerazaosocial, contato, endereco, endereconumero,
          enderecocomplemento, bairro, cidade, estado, cep, codigomunicipio
        )
      `)
      .eq("id", contexto.entrada_origem_id)
      .maybeSingle();
    if (entradaError) throw entradaError;
    const fornecedor = relationOne<any>(entrada?.fornecedor);
    destinatario = fornecedor ? fornecedorToDestinatario(fornecedor) : null;
  }

  return { saida, contexto, destinatario };
}

export async function buscarEntradasCandidatasDaSaida(saidaId: number) {
  const saida = await carregarSaida(saidaId);
  const produtoIds = Array.from(new Set((saida.itens ?? []).map((item: any) => Number(item.produto_id))));
  if (!produtoIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from("entradaitens")
    .select(`
      id, entrada_id, produto_id, quantidade, valor_unitario_compra, precovenda, titulo,
      numero_item_fiscal,
      entrada:entrada_id(
        id, fiscal, status, notachave, created_at, fornecedorid,
        fornecedor:fornecedorid(
          id, cpfcnpj, nomerazaosocial, nomefantasia, contato, endereco,
          endereconumero, enderecocomplemento, bairro, cidade, estado, cep,
          codigomunicipio
        )
      )
    `)
    .in("produto_id", produtoIds)
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).filter((row: any) => {
    const entrada = relationOne<any>(row.entrada);
    return entrada?.status === "CONFIRMADA" && onlyDigits(entrada?.notachave).length === 44;
  });
}

export type SaidaRelacionadaDaEntrada = {
  saidaId: number;
  saidaItemId: number;
  sourceItemId: string;
  entradaItemOrigemId: number | null;
  numeroItemReferenciado: number | null;
  confianca: "VINCULO_EXISTENTE" | "PRODUTO_UNICO" | "AMBIGUA";
  selecionavel: boolean;
  motivoIndisponivel: string | null;
  produto: any;
  quantidade: number;
  valorUnitario: number;
  createdAt: string | null;
  entradaCandidata: any | null;
};

/**
 * Encontra outras baixas físicas que podem ser documentadas junto da saída que
 * abriu o diálogo. A busca nunca cria vínculo: ela oferece somente saídas
 * confirmadas, posteriores à entrada e ainda sem documento ativo.
 *
 * Para dados antigos, em que o lote não foi gravado na baixa, produto repetido
 * em mais de uma linha da NF-e é ambíguo e fica apenas informativo. Isso evita
 * atribuir silenciosamente uma saída à linha fiscal errada.
 */
export async function buscarSaidasRelacionadasDaEntrada(
  saidaId: number,
  saidaItemId: number,
  entradaItemOrigemId: number,
): Promise<SaidaRelacionadaDaEntrada[]> {
  const saidaAtual = await carregarSaida(saidaId);
  const itemAtual = (saidaAtual.itens ?? []).find((item: any) => Number(item.id) === saidaItemId);
  if (!itemAtual) throw new Error("O item não pertence à saída selecionada.");

  const origemSelecionada = await carregarEntradaItem(entradaItemOrigemId);
  const entrada = relationOne<any>(origemSelecionada?.entrada);
  if (
    !origemSelecionada ||
    Number(origemSelecionada.produto_id) !== Number(itemAtual.produto_id) ||
    entrada?.status !== "CONFIRMADA" ||
    onlyDigits(entrada?.notachave).length !== 44
  ) {
    throw new Error("A origem escolhida não é uma entrada fiscal confirmada deste produto.");
  }

  const { data: entradaItens, error: entradaItensError } = await supabaseAdmin
    .from("entradaitens")
    .select("id, entrada_id, produto_id, quantidade, valor_unitario_compra, precovenda, numero_item_fiscal")
    .eq("entrada_id", Number(origemSelecionada.entrada_id))
    .order("id", { ascending: true });
  if (entradaItensError) throw entradaItensError;

  const itensDaEntrada = entradaItens ?? [];
  const produtoIds = Array.from(new Set(itensDaEntrada.map((item: any) => Number(item.produto_id))));
  if (!produtoIds.length) return [];

  const { data: saidaItens, error: saidaItensError } = await supabaseAdmin
    .from("estoque_saida_item")
    .select(`
      id, saida_id, produto_id, quantidade, valor_custo_aplicado,
      saida:saida_id(id, status, created_at),
      produto:produto_id(
        id, titulo, descricao, referencia, codigobarras, unidade, ncm, cfop,
        origem_mercadoria, csosn, cst, cest, aliquotaicms,
        cst_pis, aliquota_pis, modo_pis, aliquota_por_unidade_pis,
        cst_cofins, aliquota_cofins, modo_cofins, aliquota_por_unidade_cofins,
        rtc_habilitado, cst_ibscbs, cclass_trib,
        aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs
      )
    `)
    .in("produto_id", produtoIds)
    .order("id", { ascending: true });
  if (saidaItensError) throw saidaItensError;

  const candidatas = (saidaItens ?? []).filter((row: any) => {
    const saida = relationOne<any>(row.saida);
    return Number(row.saida_id) !== saidaId &&
      saida?.status === "CONFIRMADA" &&
      (!entrada?.created_at || !saida?.created_at || String(saida.created_at) >= String(entrada.created_at));
  });
  if (!candidatas.length) return [];

  const candidataItemIds = candidatas.map((row: any) => Number(row.id));
  const candidataSaidaIds = Array.from(new Set(candidatas.map((row: any) => Number(row.saida_id))));
  const entradaItemIds = itensDaEntrada.map((row: any) => Number(row.id));

  const [{ data: vinculosAtivos, error: vinculosError }, { data: notasLegadas, error: notasError }, { data: mapeamentos, error: mapeamentosError }] =
    await Promise.all([
      supabaseAdmin
        .from("nfe_saida_item_vinculo")
        .select("saida_item_id")
        .in("saida_item_id", candidataItemIds)
        .eq("ativo", true),
      supabaseAdmin
        .from("nfe")
        .select("saidaid")
        .in("saidaid", candidataSaidaIds)
        .eq("modelo", "NFE")
        .eq("is_deleted", false)
        .in("status", STATUS_OCUPAM_SAIDA),
      supabaseAdmin
        .from("estoque_saida_item_fiscal")
        .select("saida_item_id, entrada_item_origem_id")
        .in("entrada_item_origem_id", entradaItemIds),
    ]);
  if (vinculosError) throw vinculosError;
  if (notasError) throw notasError;
  if (mapeamentosError) throw mapeamentosError;

  const ocupados = new Set((vinculosAtivos ?? []).map((row: any) => Number(row.saida_item_id)));
  const saidasLegadasOcupadas = new Set((notasLegadas ?? []).map((row: any) => Number(row.saidaid)));
  const origemPorSaidaItem = new Map(
    (mapeamentos ?? []).map((row: any) => [Number(row.saida_item_id), Number(row.entrada_item_origem_id)]),
  );
  const entradaItensPorProduto = new Map<number, any[]>();
  itensDaEntrada.forEach((item: any) => {
    const produtoId = Number(item.produto_id);
    entradaItensPorProduto.set(produtoId, [...(entradaItensPorProduto.get(produtoId) ?? []), item]);
  });

  // Quantidade ainda atribuível por linha de entrada. Vínculos fiscais já
  // gravados são descontados; a saída atual também reserva a sua quantidade se
  // ainda não tinha contexto persistido.
  const restantePorEntradaItem = new Map(
    itensDaEntrada.map((item: any) => [Number(item.id), numberValue(item.quantidade)]),
  );
  for (const row of saidaItens ?? []) {
    const origemId = origemPorSaidaItem.get(Number(row.id));
    if (origemId && restantePorEntradaItem.has(origemId)) {
      restantePorEntradaItem.set(
        origemId,
        Math.max(0, numberValue(restantePorEntradaItem.get(origemId)) - numberValue(row.quantidade)),
      );
    }
  }
  if (!origemPorSaidaItem.has(saidaItemId)) {
    restantePorEntradaItem.set(
      entradaItemOrigemId,
      Math.max(0, numberValue(restantePorEntradaItem.get(entradaItemOrigemId)) - numberValue(itemAtual.quantidade)),
    );
  }

  return candidatas.map((row: any) => {
    const saida = relationOne<any>(row.saida);
    const produto = relationOne<any>(row.produto);
    const origemExistenteId = origemPorSaidaItem.get(Number(row.id)) ?? null;
    const linhasDoProduto = entradaItensPorProduto.get(Number(row.produto_id)) ?? [];
    const linhaInferida = origemExistenteId
      ? itensDaEntrada.find((item: any) => Number(item.id) === origemExistenteId) ?? null
      : linhasDoProduto.length === 1
        ? linhasDoProduto[0]
        : null;
    const ambigua = !linhaInferida;
    const quantidade = numberValue(row.quantidade);
    const restante = linhaInferida
      ? numberValue(restantePorEntradaItem.get(Number(linhaInferida.id)))
      : 0;
    const semSaldoNaOrigem = !origemExistenteId && Boolean(linhaInferida) && quantidade > restante;
    const jaOcupada = ocupados.has(Number(row.id)) || saidasLegadasOcupadas.has(Number(row.saida_id));
    const selecionavel = !ambigua && !semSaldoNaOrigem && !jaOcupada;

    if (selecionavel && !origemExistenteId && linhaInferida) {
      restantePorEntradaItem.set(Number(linhaInferida.id), Math.max(0, restante - quantidade));
    }

    return {
      saidaId: Number(row.saida_id),
      saidaItemId: Number(row.id),
      sourceItemId: `saida:${row.saida_id}:${row.id}`,
      entradaItemOrigemId: linhaInferida ? Number(linhaInferida.id) : null,
      numeroItemReferenciado: linhaInferida?.numero_item_fiscal
        ? Number(linhaInferida.numero_item_fiscal)
        : null,
      confianca: origemExistenteId
        ? "VINCULO_EXISTENTE" as const
        : linhaInferida
          ? "PRODUTO_UNICO" as const
          : "AMBIGUA" as const,
      selecionavel,
      motivoIndisponivel: jaOcupada
        ? "Esta saída já está vinculada a outra NF-e ativa."
        : ambigua
          ? "O produto aparece em mais de uma linha da NF-e de origem; confirme a linha fiscal manualmente."
          : semSaldoNaOrigem
            ? "A quantidade ultrapassa o saldo ainda atribuível ao item da NF-e de origem."
            : null,
      produto,
      quantidade,
      valorUnitario: numberValue(
        linhaInferida?.valor_unitario_compra ?? linhaInferida?.precovenda ?? row.valor_custo_aplicado,
      ),
      createdAt: saida?.created_at ?? null,
      entradaCandidata: linhaInferida
        ? {
            ...linhaInferida,
            entrada: {
              ...entrada,
              fornecedor: relationOne<any>(entrada?.fornecedor),
            },
          }
        : null,
    };
  });
}

export async function salvarContextoFiscalSaida(
  saidaId: number,
  input: SalvarContextoFiscalSaidaInput,
  userId?: string | null,
) {
  const saida = await carregarSaida(saidaId);
  const operacao = await buscarOperacaoFiscalSaida(input.operacaoFiscalCodigo);
  if (!operacao) throw new Error("Selecione uma natureza fiscal válida para a saída.");

  const finalidade = (operacao.codigo === "OUTRA"
    ? input.finalidade
    : operacao.finalidade) as FinalidadeFiscalSaida | null | undefined;
  if (!finalidade || !["NORMAL", "COMPLEMENTAR", "AJUSTE", "DEVOLUCAO"].includes(finalidade)) {
    throw new Error("Finalidade fiscal inválida.");
  }
  const naturezaOperacao = cleanText(
    operacao.codigo === "OUTRA" ? input.naturezaOperacao : operacao.naturezaOperacao,
  );
  if (!naturezaOperacao) throw new Error("Informe a natureza da operação.");
  const exigeReferencia = operacao.codigo === "OUTRA"
    ? Boolean(input.documentoReferenciadoObrigatorio || finalidade === "DEVOLUCAO")
    : operacao.exigeDocumentoReferenciado;
  const destinatario = validarDestinatarioFiscalSaida(input.destinatario ?? {});

  const saidaItemById = new Map((saida.itens ?? []).map((item: any) => [Number(item.id), item]));
  if (!Array.isArray(input.itens) || input.itens.length !== saidaItemById.size) {
    throw new Error("Revise a origem fiscal de todos os itens da saída.");
  }
  const repetidos = new Set<number>();
  let entradaOrigemId: number | null = null;
  let chave = onlyDigits(input.chaveAcessoReferenciada) || null;
  let documentoFornecedorOrigem: string | null = null;
  const itensNormalizados: Array<SaidaFiscalItemInput> = [];

  for (const [index, item] of input.itens.entries()) {
    const saidaItemId = Number(item.saidaItemId);
    const saidaItem = saidaItemById.get(saidaItemId);
    if (!saidaItem || repetidos.has(saidaItemId)) {
      throw new Error(`O item fiscal ${index + 1} não corresponde à saída selecionada.`);
    }
    repetidos.add(saidaItemId);

    const entradaItemId = Number(item.entradaItemOrigemId ?? 0) || null;
    let numeroItemReferenciado = normalizarNumeroItemReferenciado(
      null,
      item.numeroItemReferenciado,
    );
    if (exigeReferencia && !entradaItemId) {
      throw new Error(`Vincule o item ${index + 1} à entrada fiscal que originou a mercadoria.`);
    }
    if (entradaItemId) {
      const entradaItem = await carregarEntradaItem(entradaItemId);
      const entrada = relationOne<any>(entradaItem?.entrada);
      const chaveEntrada = onlyDigits(entrada?.notachave);
      if (!entradaItem || Number(entradaItem.produto_id) !== Number(saidaItem.produto_id)) {
        throw new Error(`A entrada vinculada ao item ${index + 1} pertence a outro produto.`);
      }
      if (entrada?.status !== "CONFIRMADA" || chaveEntrada.length !== 44) {
        throw new Error(`A origem do item ${index + 1} não é uma entrada fiscal confirmada.`);
      }
      if (
        entrada?.created_at &&
        saida.created_at &&
        new Date(saida.created_at).getTime() < new Date(entrada.created_at).getTime()
      ) {
        throw new Error(`A saída do item ${index + 1} ocorreu antes da entrada fiscal escolhida.`);
      }
      if (numberValue(saidaItem.quantidade) > numberValue(entradaItem.quantidade)) {
        throw new Error(`A quantidade do item ${index + 1} supera a quantidade registrada na entrada escolhida.`);
      }
      if (entradaOrigemId != null && entradaOrigemId !== Number(entrada.id)) {
        throw new Error("Nesta versão, todos os itens da saída devem referenciar a mesma entrada fiscal.");
      }
      if (chave && chave !== chaveEntrada) {
        throw new Error("A chave informada não corresponde à entrada fiscal selecionada.");
      }
      entradaOrigemId = Number(entrada.id);
      chave = chaveEntrada;
      const fornecedorOrigem = relationOne<any>(entrada?.fornecedor);
      const documentoOrigem = onlyDigits(fornecedorOrigem?.cpfcnpj);
      if (documentoOrigem) documentoFornecedorOrigem = documentoOrigem;
      numeroItemReferenciado = normalizarNumeroItemReferenciado(
        entradaItem.numero_item_fiscal,
        item.numeroItemReferenciado,
      );
    }

    const percentualDevolucao = numberValue(item.percentualDevolucao ?? 100);
    const valorIpiDevolvido = numberValue(item.valorIpiDevolvido);
    if (finalidade === "DEVOLUCAO" && !(percentualDevolucao > 0 && percentualDevolucao <= 100)) {
      throw new Error(`O percentual devolvido do item ${index + 1} deve estar entre 0,01 e 100.`);
    }
    if (valorIpiDevolvido < 0) {
      throw new Error(`O IPI devolvido do item ${index + 1} não pode ser negativo.`);
    }

    itensNormalizados.push({
      saidaItemId,
      entradaItemOrigemId: entradaItemId,
      numeroItemReferenciado,
      percentualDevolucao: finalidade === "DEVOLUCAO"
        ? percentualDevolucao
        : null,
      valorIpiDevolvido,
    });
  }

  const referenciaErros = validarReferenciaFiscalSaida({
    finalidade,
    exigeDocumentoReferenciado: exigeReferencia,
    chaveAcesso: chave,
    itens: itensNormalizados,
  });
  if (referenciaErros.length) throw new Error(referenciaErros[0]);
  if (
    finalidade === "DEVOLUCAO" &&
    documentoFornecedorOrigem &&
    onlyDigits(destinatario.cpfCnpj) !== documentoFornecedorOrigem
  ) {
    throw new Error("Na devolução, o destinatário deve ser o fornecedor da entrada fiscal selecionada.");
  }

  const { error: saveError } = await supabaseAdmin.rpc("salvar_contexto_fiscal_saida", {
    p_contexto: {
      saida_id: saidaId,
      operacao_fiscal_codigo: operacao.codigo,
      natureza_operacao: naturezaOperacao,
      finalidade,
      documento_referenciado_obrigatorio: exigeReferencia,
      entrada_origem_id: entradaOrigemId,
      chave_acesso_referenciada: chave,
      destinatario_snapshot: destinatario,
      observacoes_fiscais: cleanText(input.observacoesFiscais) || null,
      user_id: userId ?? null,
    },
    p_itens: itensNormalizados.map((item) => ({
      saida_id: saidaId,
      saida_item_id: item.saidaItemId,
      entrada_item_origem_id: item.entradaItemOrigemId ?? null,
      numero_item_referenciado: item.numeroItemReferenciado ?? null,
      percentual_devolucao: item.percentualDevolucao ?? null,
      valor_ipi_devolvido: item.valorIpiDevolvido ?? 0,
    })),
  });
  if (saveError) throw saveError;

  return buscarContextoFiscalSaida(saidaId);
}

export type EspelhoFiscalItemInput = {
  saidaItemId: number;
  entradaItemOrigemId?: number | null;
  numeroItemReferenciado?: number | null;
};

export type EspelhoFiscalItem = {
  saidaItemId: number;
  campos: CamposFiscaisResolvidos;
  procedencia: Record<string, string>;
  /** Preço unitário da compra, para a devolução sair pelo valor que entrou. */
  valorUnitario: number | null;
  /** Descrição do item na NF-e original, quando ela existir. */
  descricaoOrigem: string | null;
  /** ST retida na entrada — precisa voltar na devolução de mercadoria de ST. */
  substituicaoTributaria: {
    vBCSTRet: number | null;
    vICMSSTRet: number | null;
    pST: number | null;
  } | null;
  /** Por que o espelho não pôde ser usado, quando for o caso. */
  aviso: string | null;
};

/** Carrega o XML da NF-e que originou a entrada, se ele estiver no sistema. */
async function carregarXmlDaEntrada(entrada: any): Promise<string | null> {
  const documentoId = Number(entrada?.fiscal_dfe_documento_id ?? 0) || null;
  const chave = onlyDigits(entrada?.notachave);

  const query = supabaseAdmin.from("fiscal_dfe_documento").select("xml");
  const { data, error } = documentoId
    ? await query.eq("id", documentoId).maybeSingle()
    : chave.length === 44
      ? await query.eq("chave_acesso", chave).limit(1).maybeSingle()
      : { data: null, error: null };

  if (error) throw error;
  return cleanText(data?.xml) || null;
}

/**
 * Perfil tributário de cada item da saída, espelhando a NF-e de entrada.
 *
 * A devolução deve repetir a operação de compra — mesmo CST/CSOSN, mesma
 * tributação de PIS/COFINS, mesmo valor unitário —, e só o XML da nota recebida
 * conta isso. Quando ele não está no sistema, cai para o cadastro do produto e
 * o perfil da empresa, e a procedência devolvida diz qual fonte venceu campo a
 * campo, para a tela poder marcar na tela o que veio de onde.
 */
export async function montarEspelhoFiscalSaida(
  saidaId: number,
  itens: EspelhoFiscalItemInput[],
  ufDestinatario?: string | null,
  /**
   * Natureza fiscal escolhida na tela. Decide o destino que a mercadoria teve
   * na compra e, com isso, a linha da tabela de CFOP de devolução. Fora de
   * devolução de compra não há CFOP a espelhar: vale o da própria natureza.
   */
  operacaoFiscalCodigo?: string | null,
): Promise<EspelhoFiscalItem[]> {
  const destinoDaCompra = destinoDaCompraPorOperacao(operacaoFiscalCodigo);
  const saida = await carregarSaida(saidaId);
  const saidaItemById = new Map((saida.itens ?? []).map((item: any) => [Number(item.id), item]));
  const config = await buscarFiscalConfig(MODELO_NFE);
  // Devolução, remessa e retorno não são venda: o padrão que preenche o vão
  // aqui é o de saída sem venda, não o da 5102.
  const { padrao, crt, rotuloPadrao } = await buscarContextoPadraoFiscal(
    MODELO_NFE,
    "SAIDA_NAO_VENDA",
    config?.empresaid,
  );
  const ufEmitente = await buscarUfEmitente();
  // Sem UF de destino ainda escolhida, trata como operação interna: é o caso
  // mais comum da devolução ao fornecedor e o prefixo é corrigido de novo
  // quando a tela souber a UF do destinatário.
  const ufDestino = cleanText(ufDestinatario).toUpperCase() || ufEmitente;

  const resultado: EspelhoFiscalItem[] = [];

  for (const entradaItem of itens) {
    const saidaItemId = Number(entradaItem.saidaItemId);
    const saidaItem = saidaItemById.get(saidaItemId);
    if (!saidaItem) continue;
    const produto = relationOne<any>(saidaItem.produto);

    let origem: Awaited<ReturnType<typeof extrairItemFiscalNfe>> = null;
    let aviso: string | null = null;

    const entradaItemId = Number(entradaItem.entradaItemOrigemId ?? 0) || null;
    if (entradaItemId) {
      const linha = await carregarEntradaItem(entradaItemId);
      const entrada = relationOne<any>(linha?.entrada);
      const xml = entrada ? await carregarXmlDaEntrada(entrada) : null;
      const nItem = normalizarNumeroItemReferenciado(
        linha?.numero_item_fiscal,
        entradaItem.numeroItemReferenciado,
      );

      if (!xml) {
        aviso = "A NF-e desta entrada não está guardada no sistema; os tributos vieram do cadastro do produto.";
      } else if (!nItem) {
        aviso = "Informe o nº do item na NF-e recebida para espelhar os tributos da compra.";
      } else {
        origem = extrairItemFiscalNfe(xml, nItem);
        if (!origem) {
          aviso = `A NF-e de origem não tem o item ${nItem}; os tributos vieram do cadastro do produto.`;
        }
      }
    }

    // O CFOP da devolução vem da compra original, por tabela — e não trocando o
    // primeiro dígito, que transformaria a compra com ST 1.403 em 5.403 (uma
    // venda) em vez de 5.411. É esse mapeamento que separa 5.202 de 5.411.
    //
    // Fora de devolução (remessa, retorno) não existe correspondência a aplicar:
    // vale o CFOP da natureza escolhida, e o da compra é descartado.
    let cfopEspelhado: string | null = null;
    if (origem && destinoDaCompra) {
      const sugerido = sugerirCfopDevolucaoDeCompra(
        {
          cfop: origem.valoresFiscais.cfop,
          cst: origem.valoresFiscais.cst,
          csosn: origem.valoresFiscais.csosn,
        },
        destinoDaCompra,
        ufEmitente,
        ufDestino,
      );
      if (sugerido) {
        cfopEspelhado = sugerido.cfop;
        if (sugerido.comSubstituicaoTributaria) {
          aviso = [
            aviso,
            `A compra teve ICMS retido por substituição tributária, então a devolução ` +
              `sai com CFOP ${sugerido.cfop}. Confira os valores de ST com a contabilidade.`,
          ].filter(Boolean).join(" ");
        }
      }
    }

    const valoresOrigem = origem
      ? { ...origem.valoresFiscais, cfop: cfopEspelhado }
      : null;

    const { campos, procedencia } = resolverPadraoFiscalItem({
      fontes: [
        { origem: ORIGEM_NFE_ENTRADA, valores: valoresOrigem },
        { origem: "PRODUTO", valores: produto },
      ],
      padrao,
      crt,
      rotuloPadrao,
    });

    resultado.push({
      saidaItemId,
      campos,
      procedencia,
      valorUnitario: origem?.valorUnitario ?? null,
      descricaoOrigem: origem?.descricao ?? null,
      substituicaoTributaria: origem?.substituicaoTributaria ?? null,
      aviso,
    });
  }

  return resultado;
}

async function buscarNotaAtivaDaSaida(saidaId: number, ignorarNfeId?: number | null) {
  const { data: vinculo, error: vinculoError } = await supabaseAdmin
    .from("nfe_saida_item_vinculo")
    .select("nfe_id")
    .eq("saida_id", saidaId)
    .eq("ativo", true)
    .order("nfe_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vinculoError) throw vinculoError;

  if (vinculo?.nfe_id && Number(vinculo.nfe_id) !== Number(ignorarNfeId ?? 0)) {
    const { data: vinculada, error: vinculadaError } = await supabaseAdmin
      .from("nfe")
      .select("id, numero, serie, status")
      .eq("id", vinculo.nfe_id)
      .maybeSingle();
    if (vinculadaError) throw vinculadaError;
    if (vinculada) return vinculada;
  }

  let query = supabaseAdmin
    .from("nfe")
    .select("id, numero, serie, status")
    .eq("saidaid", saidaId)
    .eq("modelo", "NFE")
    .eq("is_deleted", false)
    .in("status", STATUS_OCUPAM_SAIDA)
    .order("id", { ascending: false })
    .limit(1);
  if (ignorarNfeId) query = query.neq("id", ignorarNfeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

function parseSaidaSourceItemId(value: unknown) {
  const match = /^saida:(\d+):(\d+)$/.exec(String(value ?? ""));
  if (!match) return null;
  const parsed = { saidaId: Number(match[1]), saidaItemId: Number(match[2]) };
  return parsed.saidaId > 0 && parsed.saidaItemId > 0 ? parsed : null;
}

async function buscarUfEmitente() {
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("empresaid")
    .eq("modelo", "NFE")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (configError) throw configError;
  if (!config) throw new Error("Configuração de NF-e não encontrada.");
  const { data: empresa, error } = await supabaseAdmin
    .from("empresa")
    .select("uf")
    .eq("id", config.empresaid)
    .maybeSingle();
  if (error) throw error;
  return cleanText(empresa?.uf).toUpperCase();
}

async function salvarNFeDaSaidaUnica(saidaId: number, input: NFeSaidaDraftInput) {
  if (!input.nfeId) {
    const existente = await buscarNotaAtivaDaSaida(saidaId);
    if (existente) {
      return {
        ok: false as const,
        errors: [{
          step: "operation",
          message: `Esta saída já tem NF-e ${String(existente.status).toLowerCase()} (nº ${existente.numero}).`,
        }],
      };
    }
  }

  // A origem fiscal escolhida na tela é gravada aqui, antes de montar a nota.
  // `salvarContextoFiscalSaida` já valida a entrada vinculada, a chave e o
  // casamento entre destinatário e fornecedor da entrada — e lança com uma
  // mensagem pronta quando algo não fecha.
  if (input.contextoFiscal) {
    try {
      await salvarContextoFiscalSaida(saidaId, {
        ...input.contextoFiscal,
        destinatario: input.destinatario as SalvarContextoFiscalSaidaInput["destinatario"],
      });
    } catch (error: any) {
      return {
        ok: false as const,
        errors: [{
          step: "operation",
          message: error?.message ?? "Não foi possível salvar a origem fiscal da saída.",
        }],
      };
    }
  }

  const { saida, contexto } = await buscarContextoFiscalSaida(saidaId);
  if (!contexto) {
    return {
      ok: false as const,
      errors: [{ step: "operation", message: "Defina a natureza e a origem fiscal da saída antes de emitir." }],
    };
  }
  if (!Array.isArray(input.itens) || !input.itens.length) {
    return { ok: false as const, errors: [{ step: "products", message: "Selecione pelo menos um produto." }] };
  }

  const sourceById = new Map((saida.itens ?? []).map((item: any) => [`saida:${saidaId}:${item.id}`, item]));
  const mappingByItemId = new Map<number, any>(
    (contexto.itens ?? []).map((item: any) => [Number(item.saida_item_id), item]),
  );
  const requested = new Set<string>();
  const errors: Array<{ step: string; itemIndex?: number; field?: string; message: string }> = [];
  const exigeReferencia = Boolean(contexto.documento_referenciado_obrigatorio) || contexto.finalidade === "DEVOLUCAO";
  const chave = onlyDigits(contexto.chave_acesso_referenciada);

  const itens = input.itens.flatMap((item, itemIndex) => {
    if (requested.has(item.sourceItemId)) {
      errors.push({ step: "products", itemIndex, message: "A mesma linha foi selecionada mais de uma vez." });
      return [];
    }
    requested.add(item.sourceItemId);
    const source = sourceById.get(item.sourceItemId);
    if (!source || Number(source.produto_id) !== Number(item.produtoId)) {
      errors.push({ step: "products", itemIndex, message: "O item não pertence mais à saída selecionada." });
      return [];
    }
    const mapping = mappingByItemId.get(Number(source.id));
    if (!mapping) {
      errors.push({ step: "products", itemIndex, message: "O item ainda não possui contexto fiscal configurado." });
      return [];
    }
    const nItem = Number(mapping.numero_item_referenciado ?? 0);
    if (exigeReferencia && (chave.length !== 44 || !Number.isInteger(nItem) || nItem <= 0)) {
      errors.push({ step: "products", itemIndex, message: "Informe a chave e o número do item fiscal de origem." });
      return [];
    }

    return [{
      ...item,
      produtoId: Number(source.produto_id),
      codigo: String(source.produto?.referencia || source.produto?.codigobarras || source.produto_id),
      descricao: String(source.produto?.titulo || source.produto?.descricao || `Produto #${source.produto_id}`),
      unidade: item.unidade || source.produto?.unidade || "UN",
      // A quantidade documentada deve reconciliar exatamente com a baixa que
      // originou a nota. Valor e tributação continuam revisáveis no assistente.
      quantidade: numberValue(source.quantidade),
      valorUnitario: item.valorUnitario,
      valorDesconto: item.valorDesconto ?? 0,
      valorFrete: 0,
      ...(exigeReferencia
        ? { dfeReferenciado: { chaveAcesso: chave, nItem } }
        : {}),
      // O grupo impostoDevol carrega os dois campos juntos. Condicionar ao IPI
      // descartava o percentual devolvido no caso normal do Simples, em que o
      // IPI é zero mas a devolução ainda pode ser parcial.
      ...(contexto.finalidade === "DEVOLUCAO"
        ? {
            percentualDevolucao: numberValue(mapping.percentual_devolucao || 100),
            valorIpiDevolvido: numberValue(mapping.valor_ipi_devolvido),
          }
        : {}),
      // O que o operador escreveu no editor manda. Só preenche sozinho quando o
      // campo vem vazio — antes, qualquer observação de item era sobrescrita.
      informacoesAdicionaisProduto:
        cleanText(item.informacoesAdicionaisProduto) ||
        (exigeReferencia ? `Documento fiscal de origem: ${chave}; item ${nItem}.` : null),
    } satisfies NFeAvulsaItemInput];
  });

  const destinatario = normalizeFiscalRecipient(input.destinatario);
  const referenciaErros = validarReferenciaFiscalSaida({
    finalidade: contexto.finalidade,
    exigeDocumentoReferenciado: Boolean(contexto.documento_referenciado_obrigatorio),
    chaveAcesso: chave,
    itens: itens.map((item) => ({ numeroItemReferenciado: item.dfeReferenciado?.nItem })),
  });
  referenciaErros.forEach((message) => errors.push({ step: "operation", message }));

  const ufEmitente = await buscarUfEmitente();
  itens.forEach((item, itemIndex) => {
    const validation = validateCfopForEmission({
      value: item.cfop,
      modelo: MODELO_NFE,
      operation: "SAIDA",
      emitterUf: ufEmitente,
      partnerUf: destinatario.estado,
    });
    if (!validation.valid) {
      errors.push({
        step: "products",
        itemIndex,
        field: "cfop",
        message: validation.message ?? `CFOP ${onlyDigits(item.cfop)} inválido.`,
      });
    }
  });
  if (errors.length) return { ok: false as const, errors };

  const { error: snapshotError } = await supabaseAdmin
    .from("estoque_saida_fiscal")
    .update({ destinatario_snapshot: destinatario, updated_at: new Date().toISOString() })
    .eq("saida_id", saidaId);
  if (snapshotError) throw snapshotError;

  return salvarNFeAvulsaDraft({
    nfeId: input.nfeId ?? null,
    modelo: 55,
    origem: { tipo: "SAIDA", saidaId },
    operacao: {
      tipoOperacao: "SAIDA",
      naturezaOperacao: contexto.natureza_operacao,
      finalidade: contexto.finalidade,
      consumidorFinal: destinatario.indicadorIe === "9",
      indicadorPresenca: "0",
      observacoesFiscais: resolverObservacoesFiscais(
        input.observacoesFiscais,
        contexto.observacoes_fiscais,
      ),
    },
    pagamento: { meio: "90", tipoIntegracao: "2" },
    pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    documentosReferenciados: montarReferenciasFiscaisSaida({
      finalidade: contexto.finalidade,
      exigeDocumentoReferenciado: Boolean(contexto.documento_referenciado_obrigatorio),
      chaveAcesso: chave,
      // Cada item já cita a origem no DFeReferenciado. Repetir no cabeçalho é a
      // rejeição 1010: os dois níveis de referenciamento são excludentes.
      temReferenciaPorItem: itens.some((item) => item.dfeReferenciado),
    }),
    destinatario,
    itens,
  });

}

async function vincularResultadoAsSaidas(
  resultado: Awaited<ReturnType<typeof salvarNFeAvulsaDraft>>,
  input: NFeSaidaDraftInput,
  origens: Array<{ saidaId: number; saidaItemId: number; source: any; mapping: any }>,
) {
  if (!resultado.ok) return resultado;
  const { error } = await supabaseAdmin.rpc("vincular_nfe_saidas", {
    p_nfe_id: resultado.nfeId,
    p_itens: origens.map((origem) => ({
      saida_id: origem.saidaId,
      saida_item_id: origem.saidaItemId,
      entrada_item_origem_id: origem.mapping?.entrada_item_origem_id ?? null,
      quantidade: numberValue(origem.source.quantidade),
    })),
  });
  if (!error) return resultado;

  // O índice da tabela de vínculo é a última guarda contra duas emissões
  // concorrentes. Um rascunho recém-criado que perdeu a corrida não pode ficar
  // órfão; neste ponto ele ainda não foi transmitido.
  if (!input.nfeId) {
    await supabaseAdmin
      .from("nfe")
      .delete()
      .eq("id", resultado.nfeId)
      .eq("status", "RASCUNHO");
  }
  return {
    ok: false as const,
    errors: [{
      step: "operation",
      message: error.message || "Uma das saídas foi usada por outra NF-e durante a emissão.",
    }],
  };
}

/**
 * Emite uma única NF-e para uma ou mais saídas físicas. O caminho unitário
 * continua usando o motor já existente; o caminho agrupado replica as mesmas
 * validações para cada saída e só então grava o vínculo transacional.
 */
export async function salvarNFeDaSaida(saidaId: number, input: NFeSaidaDraftInput) {
  if (!Array.isArray(input.itens) || !input.itens.length) {
    return { ok: false as const, errors: [{ step: "products", message: "Selecione pelo menos um produto." }] };
  }

  const referencias = input.itens.map((item, itemIndex) => ({
    item,
    itemIndex,
    referencia: parseSaidaSourceItemId(item.sourceItemId),
  }));
  const invalida = referencias.find(({ referencia }) => !referencia);
  if (invalida) {
    return {
      ok: false as const,
      errors: [{ step: "products", itemIndex: invalida.itemIndex, message: "A origem física do item é inválida." }],
    };
  }
  const chaves = new Set<string>();
  for (const { referencia, itemIndex } of referencias) {
    const chave = `${referencia!.saidaId}:${referencia!.saidaItemId}`;
    if (chaves.has(chave)) {
      return {
        ok: false as const,
        errors: [{ step: "products", itemIndex, message: "A mesma linha foi selecionada mais de uma vez." }],
      };
    }
    chaves.add(chave);
  }
  if (!referencias.some(({ referencia }) => referencia!.saidaId === saidaId)) {
    return {
      ok: false as const,
      errors: [{ step: "products", message: "A saída que abriu a emissão precisa permanecer na nota." }],
    };
  }

  const saidaIds = Array.from(new Set(referencias.map(({ referencia }) => referencia!.saidaId)));
  if (saidaIds.length === 1) {
    const resultado = await salvarNFeDaSaidaUnica(saidaId, input);
    if (!resultado.ok) return resultado;
    const dados = await buscarContextoFiscalSaida(saidaId);
    const mappingById = new Map(
      (dados.contexto?.itens ?? []).map((item: any) => [Number(item.saida_item_id), item]),
    );
    const sourceById = new Map((dados.saida.itens ?? []).map((item: any) => [Number(item.id), item]));
    return vincularResultadoAsSaidas(
      resultado,
      input,
      referencias.map(({ referencia }) => ({
        saidaId,
        saidaItemId: referencia!.saidaItemId,
        source: sourceById.get(referencia!.saidaItemId),
        mapping: mappingById.get(referencia!.saidaItemId),
      })),
    );
  }

  for (const candidataId of saidaIds) {
    const existente = await buscarNotaAtivaDaSaida(candidataId, input.nfeId);
    if (existente) {
      return {
        ok: false as const,
        errors: [{
          step: "operation",
          message: `A saída #${candidataId} já tem NF-e ${String(existente.status).toLowerCase()} (nº ${existente.numero}).`,
        }],
      };
    }
  }

  if (input.contextoFiscal) {
    try {
      const contextoPorSaida = new Map<number, SaidaFiscalItemInput[]>();
      for (const item of input.contextoFiscal.itens ?? []) {
        const itemSaidaId = Number(item.saidaId ?? saidaId);
        if (!chaves.has(`${itemSaidaId}:${Number(item.saidaItemId)}`)) continue;
        contextoPorSaida.set(itemSaidaId, [...(contextoPorSaida.get(itemSaidaId) ?? []), item]);
      }
      for (const candidataId of saidaIds) {
        const itensDaSaida = contextoPorSaida.get(candidataId) ?? [];
        if (!itensDaSaida.length) {
          throw new Error(`Revise a origem fiscal dos itens da saída #${candidataId}.`);
        }
        await salvarContextoFiscalSaida(candidataId, {
          ...input.contextoFiscal,
          itens: itensDaSaida,
          destinatario: input.destinatario as SalvarContextoFiscalSaidaInput["destinatario"],
        });
      }
    } catch (error: any) {
      return {
        ok: false as const,
        errors: [{ step: "operation", message: error?.message ?? "Não foi possível salvar a origem fiscal das saídas." }],
      };
    }
  }

  const dadosPorSaida = new Map(
    await Promise.all(saidaIds.map(async (id) => [id, await buscarContextoFiscalSaida(id)] as const)),
  );
  const contexto = dadosPorSaida.get(saidaId)?.contexto;
  if (!contexto) {
    return {
      ok: false as const,
      errors: [{ step: "operation", message: "Defina a natureza e a origem fiscal da saída antes de emitir." }],
    };
  }

  const chaveOrigem = onlyDigits(contexto.chave_acesso_referenciada);
  const entradaOrigemId = Number(contexto.entrada_origem_id ?? 0) || null;
  for (const candidataId of saidaIds) {
    const outro = dadosPorSaida.get(candidataId)?.contexto;
    if (
      !outro ||
      String(outro.operacao_fiscal_codigo) !== String(contexto.operacao_fiscal_codigo) ||
      String(outro.finalidade) !== String(contexto.finalidade) ||
      onlyDigits(outro.chave_acesso_referenciada) !== chaveOrigem ||
      (Number(outro.entrada_origem_id ?? 0) || null) !== entradaOrigemId
    ) {
      return {
        ok: false as const,
        errors: [{
          step: "operation",
          message: "Todas as saídas agrupadas devem pertencer à mesma entrada e operação fiscal.",
        }],
      };
    }
  }

  const sourceById = new Map<string, { saidaId: number; saidaItemId: number; source: any; mapping: any }>();
  for (const [id, dados] of dadosPorSaida) {
    const mappingById = new Map(
      (dados.contexto?.itens ?? []).map((item: any) => [Number(item.saida_item_id), item]),
    );
    for (const source of dados.saida.itens ?? []) {
      sourceById.set(`saida:${id}:${source.id}`, {
        saidaId: id,
        saidaItemId: Number(source.id),
        source,
        mapping: mappingById.get(Number(source.id)),
      });
    }
  }

  const errors: Array<{ step: string; itemIndex?: number; field?: string; message: string }> = [];
  const exigeReferencia = Boolean(contexto.documento_referenciado_obrigatorio) || contexto.finalidade === "DEVOLUCAO";
  const itens = input.itens.flatMap((item, itemIndex) => {
    const origem = sourceById.get(item.sourceItemId);
    const source = origem?.source;
    if (!origem || !source || Number(source.produto_id) !== Number(item.produtoId)) {
      errors.push({ step: "products", itemIndex, message: "O item não pertence mais a uma das saídas selecionadas." });
      return [];
    }
    if (!origem.mapping) {
      errors.push({ step: "products", itemIndex, message: "O item ainda não possui contexto fiscal configurado." });
      return [];
    }
    const nItem = Number(origem.mapping.numero_item_referenciado ?? 0);
    if (exigeReferencia && (chaveOrigem.length !== 44 || !Number.isInteger(nItem) || nItem <= 0)) {
      errors.push({ step: "products", itemIndex, message: "Informe a chave e o número do item fiscal de origem." });
      return [];
    }
    return [{
      ...item,
      produtoId: Number(source.produto_id),
      codigo: String(source.produto?.referencia || source.produto?.codigobarras || source.produto_id),
      descricao: String(source.produto?.titulo || source.produto?.descricao || `Produto #${source.produto_id}`),
      unidade: item.unidade || source.produto?.unidade || "UN",
      quantidade: numberValue(source.quantidade),
      valorUnitario: item.valorUnitario,
      valorDesconto: item.valorDesconto ?? 0,
      valorFrete: 0,
      ...(exigeReferencia ? { dfeReferenciado: { chaveAcesso: chaveOrigem, nItem } } : {}),
      ...(contexto.finalidade === "DEVOLUCAO"
        ? {
            percentualDevolucao: numberValue(origem.mapping.percentual_devolucao || 100),
            valorIpiDevolvido: numberValue(origem.mapping.valor_ipi_devolvido),
          }
        : {}),
      informacoesAdicionaisProduto:
        cleanText(item.informacoesAdicionaisProduto) ||
        (exigeReferencia ? `Documento fiscal de origem: ${chaveOrigem}; item ${nItem}.` : null),
    } satisfies NFeAvulsaItemInput];
  });

  const destinatario = normalizeFiscalRecipient(input.destinatario);
  validarReferenciaFiscalSaida({
    finalidade: contexto.finalidade,
    exigeDocumentoReferenciado: Boolean(contexto.documento_referenciado_obrigatorio),
    chaveAcesso: chaveOrigem,
    itens: itens.map((item) => ({ numeroItemReferenciado: item.dfeReferenciado?.nItem })),
  }).forEach((message) => errors.push({ step: "operation", message }));

  const ufEmitente = await buscarUfEmitente();
  itens.forEach((item, itemIndex) => {
    const validation = validateCfopForEmission({
      value: item.cfop,
      modelo: MODELO_NFE,
      operation: "SAIDA",
      emitterUf: ufEmitente,
      partnerUf: destinatario.estado,
    });
    if (!validation.valid) {
      errors.push({
        step: "products",
        itemIndex,
        field: "cfop",
        message: validation.message ?? `CFOP ${onlyDigits(item.cfop)} inválido.`,
      });
    }
  });
  if (errors.length) return { ok: false as const, errors };

  const { error: snapshotError } = await supabaseAdmin
    .from("estoque_saida_fiscal")
    .update({ destinatario_snapshot: destinatario, updated_at: new Date().toISOString() })
    .in("saida_id", saidaIds);
  if (snapshotError) throw snapshotError;

  const resultado = await salvarNFeAvulsaDraft({
    nfeId: input.nfeId ?? null,
    modelo: 55,
    origem: { tipo: "SAIDA", saidaId },
    operacao: {
      tipoOperacao: "SAIDA",
      naturezaOperacao: contexto.natureza_operacao,
      finalidade: contexto.finalidade,
      consumidorFinal: destinatario.indicadorIe === "9",
      indicadorPresenca: "0",
      observacoesFiscais: resolverObservacoesFiscais(
        input.observacoesFiscais,
        contexto.observacoes_fiscais,
      ),
    },
    pagamento: { meio: "90", tipoIntegracao: "2" },
    pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    documentosReferenciados: montarReferenciasFiscaisSaida({
      finalidade: contexto.finalidade,
      exigeDocumentoReferenciado: Boolean(contexto.documento_referenciado_obrigatorio),
      chaveAcesso: chaveOrigem,
      temReferenciaPorItem: itens.some((item) => item.dfeReferenciado),
    }),
    destinatario,
    itens,
  });

  return vincularResultadoAsSaidas(
    resultado,
    input,
    referencias.map(({ item }) => sourceById.get(item.sourceItemId)!),
  );
}

export { fornecedorToDestinatario };
