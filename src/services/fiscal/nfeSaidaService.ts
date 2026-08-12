import { isCfopCompatibleWithOperation } from "@/lib/nfe/cfopOperation";
import {
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
      entrada:entrada_id(
        id, fiscal, status, notachave, fornecedorid, fiscal_dfe_documento_id,
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
      entrada:entrada_id(
        id, fiscal, status, notachave, dataentrada, fornecedorid,
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
      numeroItemReferenciado: item.numeroItemReferenciado ?? null,
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

async function buscarNotaAtivaDaSaida(saidaId: number) {
  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select("id, numero, serie, status")
    .eq("saidaid", saidaId)
    .eq("modelo", "NFE")
    .eq("is_deleted", false)
    .in("status", STATUS_OCUPAM_SAIDA)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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

export async function salvarNFeDaSaida(saidaId: number, input: NFeSaidaDraftInput) {
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
      ...(contexto.finalidade === "DEVOLUCAO" && numberValue(mapping.valor_ipi_devolvido) > 0
        ? {
            percentualDevolucao: numberValue(mapping.percentual_devolucao || 100),
            valorIpiDevolvido: numberValue(mapping.valor_ipi_devolvido),
          }
        : {}),
      informacoesAdicionaisProduto: exigeReferencia
        ? `Documento fiscal de origem: ${chave}; item ${nItem}.`
        : null,
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
    if (!isCfopCompatibleWithOperation(item.cfop, "SAIDA", ufEmitente, destinatario.estado)) {
      errors.push({
        step: "products",
        itemIndex,
        field: "cfop",
        message: `CFOP ${onlyDigits(item.cfop)} é incompatível com a saída para ${destinatario.estado || "a UF informada"}.`,
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
      consumidorFinal: false,
      indicadorPresenca: "0",
      observacoesFiscais:
        cleanText(input.observacoesFiscais) || cleanText(contexto.observacoes_fiscais) || null,
    },
    pagamento: { meio: "90", tipoIntegracao: "2" },
    pagamentos: [{ meio: "90", valor: 0, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    destinatario,
    itens,
  });

}

export { fornecedorToDestinatario };
