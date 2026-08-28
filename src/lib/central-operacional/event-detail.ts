import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  operationalEventSchema,
  type OperationalEntityType,
  type OperationalEvent,
  type OperationalEventDetail,
} from "./contracts";
import {
  buildIndisponivelDetail,
  buildOperationalEventDetail,
  isOperationalEntityType,
  parseOperationalEntityId,
  type DetailGrants,
  type NfeDetailRow,
  type NfseDetailRow,
  type OperationalDetailSource,
  type OrdemDetailRow,
  type ProdutoDetailRow,
  type TransacaoDetailRow,
  type VendaDetailRow,
  type VinculoResumo,
} from "./event-detail-view";
import {
  allowedOperationalModules,
  canOpenOperationalEvent,
  canViewClientName,
} from "./permissions";
import { resolveOperationalTenant } from "./tenant";

/**
 * Erro com status próprio, no formato que as rotas do módulo já traduzem.
 *
 * `EVENTO_NAO_ENCONTRADO` cobre de propósito três casos distintos — id
 * inexistente, outro tenant e módulo sem permissão. Responder 403 no último
 * confirmaria "existe um evento com esse UUID num módulo que você não vê"; como
 * o snapshot nunca envia esses eventos, um cliente legítimo jamais tem esse id.
 */
export class OperationalEventDetailError extends Error {
  statusCode: number;

  constructor(code: string, statusCode: number) {
    super(code);
    this.name = "OperationalEventDetailError";
    this.statusCode = statusCode;
  }
}

const EVENT_COLUMNS =
  "id, tipo, modulo, entidade_tipo, entidade_id, titulo, descricao, valor, quantidade, prioridade, metadata, ocorrido_em";

/**
 * Monta um `select` a partir de partes, descartando as vazias.
 *
 * É o que permite omitir o embed de cliente por permissão: sem
 * `clientes:visualizar`, a coluna do nome não entra na consulta e portanto nem
 * sai do banco. Também devolve `string` simples de propósito — um template
 * literal interpolado faz o parser de tipos do supabase-js tropeçar.
 */
function selecionar(...partes: Array<string | false | null>) {
  return partes.filter((parte): parte is string => Boolean(parte)).join(", ");
}

/**
 * O supabase-js infere o tipo da linha a partir do literal do `select`. Como as
 * consultas daqui são montadas em tempo de execução, essa inferência não existe
 * — quem garante a forma é o Zod na saída do builder.
 */
function linhaDe<T>(data: unknown): T {
  return data as T;
}

function numeroOuNulo(valor: unknown) {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

function metadataRecord(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function eventoDaLinha(linha: Record<string, unknown>): OperationalEvent {
  return operationalEventSchema.parse({
    id: linha.id,
    tipo: linha.tipo,
    modulo: linha.modulo,
    entidadeTipo: linha.entidade_tipo,
    entidadeId: linha.entidade_id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    valor: linha.valor === null ? null : numeroOuNulo(linha.valor),
    quantidade: linha.quantidade === null ? null : numeroOuNulo(linha.quantidade),
    prioridade: linha.prioridade,
    metadata: metadataRecord(linha.metadata),
    ocorridoEm: linha.ocorrido_em,
  });
}

/* ------------------------------------------------------------------ */
/* Busca por entidade                                                  */
/* ------------------------------------------------------------------ */

async function carregarOrdem(
  id: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  const [ordem, produtos, servicos] = await Promise.all([
    supabaseAdmin
      .from("ordemservico")
      .select(
        selecionar(
          "id, status, descricao, prioridade, dataentrada, datasaida",
          "execucao_inicio_em, execucao_fim_em, finalizado_em",
          "orcamentototal, acrescimo_financeiro_tipo, acrescimo_financeiro_valor",
          "forma_pagamento, parcelas_pagamento, garantia, motivo_cancelamento",
          "veiculo_snapshot",
          "setor:setorid ( nome )",
          "veiculo:veiculoid ( id, placa, placa_formatada, marca, modelo, ano, ano_modelo, cor, kmatual, chassi )",
          grants.verCliente && "cliente:clienteid ( nomerazaosocial )",
          "transacoes:transacao!transacao_ordemservicoid_fkey ( tipo, pendente, evento_financeiro_id, valor, valor_acrescimos, valor_baixado, is_deleted )",
        ),
      )
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle(),
    supabaseAdmin
      .from("osproduto")
      .select("ordemservicoid", { count: "exact", head: true })
      .eq("ordemservicoid", id),
    supabaseAdmin
      .from("osservico")
      .select("ordemservicoid", { count: "exact", head: true })
      .eq("ordemservicoid", id),
  ]);

  if (ordem.error) throw ordem.error;
  if (!ordem.data) return null;

  return {
    entidadeTipo: "ORDEM_SERVICO",
    ordem: linhaDe<OrdemDetailRow>(ordem.data),
    produtos: produtos.count ?? 0,
    servicos: servicos.count ?? 0,
  };
}

async function carregarVenda(
  id: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  const venda = await supabaseAdmin
    .from("venda")
    .select(
      selecionar(
        "id, status, canal, datavenda, valortotal",
        "acrescimo_financeiro_tipo, acrescimo_financeiro_valor",
        "forma_pagamento, parcelas_pagamento, descricao, garantia",
        "motivo_cancelamento, status_entrega, codigo_rastreio",
        grants.verCliente && "cliente:clienteid ( nomerazaosocial )",
        "vendedor_rel:vendedor ( nome )",
        "itens:vendaproduto ( id )",
        "transacoes:transacao!transacao_vendaid_fkey ( tipo, pendente, evento_financeiro_id, valor, valor_acrescimos, valor_baixado, is_deleted )",
      ),
    )
    .eq("id", id)
    .maybeSingle();

  if (venda.error) throw venda.error;
  if (!venda.data) return null;

  return { entidadeTipo: "VENDA", venda: linhaDe<VendaDetailRow>(venda.data) };
}

async function carregarVinculoOrdem(id: unknown): Promise<VinculoResumo | null> {
  if (id === null || id === undefined) return null;
  const resultado = await supabaseAdmin
    .from("ordemservico")
    .select("id, status, orcamentototal, descricao")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (resultado.error || !resultado.data) return null;
  const linha = linhaDe<Record<string, unknown>>(resultado.data);
  return {
    id: Number(linha.id),
    status: linha.status as string | null,
    total: linha.orcamentototal as number | null,
    descricao: linha.descricao as string | null,
  };
}

async function carregarVinculoVenda(id: unknown): Promise<VinculoResumo | null> {
  if (id === null || id === undefined) return null;
  const resultado = await supabaseAdmin
    .from("venda")
    .select("id, status, valortotal")
    .eq("id", id)
    .maybeSingle();
  if (resultado.error || !resultado.data) return null;
  const linha = linhaDe<Record<string, unknown>>(resultado.data);
  return {
    id: Number(linha.id),
    status: linha.status as string | null,
    total: linha.valortotal as number | null,
  };
}

async function carregarTransacao(
  id: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  // Query estreita de propósito: a rota `/api/transaction/[id]/contexto` já faz
  // algo parecido, mas seleciona CPF/CNPJ, telefone, e-mail e endereço do
  // cliente e do fornecedor. Reaproveitá-la colocaria esses campos a um refactor
  // de distância de vazarem num card de feed.
  const transacao = await supabaseAdmin
    .from("transacao")
    .select(
      selecionar(
        "id, descricao, tipo, pendente, metodopagamento",
        // `valorLiquido` é a única coluna camelCase do schema; sem as aspas o
        // Postgres a rebaixaria para `valorliquido` e não acharia nada.
        'valor, "valorLiquido", valor_acrescimos, valor_descontos, valor_baixado',
        "data, vencimento_em, pago_em",
        "ordemservicoid, vendaid, adiantamento_id, parcelamento_id",
        "pagamento_multiplo_id, baixa_de_transacao_id, transferencia_id",
        "banco:bancoconta!transacao_banco_id_fkey ( titulo )",
        grants.verCliente && "cliente:cliente!transacao_cliente_id_fkey ( nomerazaosocial )",
        "fornecedor:fornecedor!transacao_fornecedor_id_fkey ( nomerazaosocial )",
      ),
    )
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (transacao.error) throw transacao.error;
  if (!transacao.data) return null;

  const linha = linhaDe<Record<string, unknown>>(transacao.data);
  const [ordem, venda] = await Promise.all([
    carregarVinculoOrdem(linha.ordemservicoid),
    grants.verVendas ? carregarVinculoVenda(linha.vendaid) : Promise.resolve(null),
  ]);

  return {
    entidadeTipo: "TRANSACAO",
    transacao: linhaDe<TransacaoDetailRow>(transacao.data),
    ordem,
    // Sem `vendas:visualizar` o vínculo ainda aparece, mas só com o rótulo — o
    // builder cuida disso a partir do id cru.
    venda: venda ?? (linha.vendaid != null ? { id: Number(linha.vendaid) } : null),
  };
}

async function carregarProduto(id: string): Promise<OperationalDetailSource | null> {
  const produto = await supabaseAdmin
    .from("produto")
    .select("id, titulo, referencia, codigobarras, unidade, estoque, estoqueminimo, precovenda, precocompra")
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (produto.error) throw produto.error;
  if (!produto.data) return null;

  return { entidadeTipo: "PRODUTO", produto: linhaDe<ProdutoDetailRow>(produto.data) };
}

async function carregarNfe(
  id: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  const nfe = await supabaseAdmin
    .from("nfe")
    .select(
      selecionar(
        "id, modelo, serie, numero, chave_acesso, ambiente, status",
        "dataemissao, dataautorizacao, protocolo, total_nfe",
        "codigo_rejeicao, motivo_rejeicao, ordemservicoid, vendaid",
        grants.verCliente && "cliente:clienteid ( nomerazaosocial )",
      ),
    )
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (nfe.error) throw nfe.error;
  if (!nfe.data) return null;

  return { entidadeTipo: "NFE", nfe: linhaDe<NfeDetailRow>(nfe.data) };
}

async function carregarNfse(
  id: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  // `url_pdf`, `url_consulta`, `url_xml`, `payload_enviado` e `retorno_bruto`
  // ficam fora por decisão: as URLs são de terceiro e sem autenticação, e o
  // payload carrega documento e endereço completos do tomador.
  const nfse = await supabaseAdmin
    .from("nfse")
    .select(
      selecionar(
        "id, numero, status, valor_total, dataemissao, protocolo, erros, ordemservicoid",
        grants.verCliente && "cliente:clienteid ( nomerazaosocial )",
      ),
    )
    .eq("id", id)
    .maybeSingle();

  if (nfse.error) throw nfse.error;
  if (!nfse.data) return null;

  return { entidadeTipo: "NFSE", nfse: linhaDe<NfseDetailRow>(nfse.data) };
}

function carregarFonte(
  entidadeTipo: OperationalEntityType,
  entidadeId: string,
  grants: DetailGrants,
): Promise<OperationalDetailSource | null> {
  switch (entidadeTipo) {
    case "ORDEM_SERVICO":
      return carregarOrdem(entidadeId, grants);
    case "VENDA":
      return carregarVenda(entidadeId, grants);
    case "TRANSACAO":
      return carregarTransacao(entidadeId, grants);
    case "PRODUTO":
      return carregarProduto(entidadeId);
    case "NFE":
      return carregarNfe(entidadeId, grants);
    case "NFSE":
      return carregarNfse(entidadeId, grants);
  }
}

/* ------------------------------------------------------------------ */
/* Entrada pública                                                     */
/* ------------------------------------------------------------------ */

export async function createOperationalEventDetail(
  eventId: string,
  permissions: unknown,
): Promise<OperationalEventDetail> {
  const tenant = await resolveOperationalTenant();
  const eventoResultado = await supabaseAdmin
    .from("central_evento_operacional")
    .select(EVENT_COLUMNS)
    .eq("tenant_id", tenant.id)
    .eq("id", eventId)
    .maybeSingle();

  if (eventoResultado.error) throw eventoResultado.error;
  if (!eventoResultado.data) {
    throw new OperationalEventDetailError("EVENTO_NAO_ENCONTRADO", 404);
  }

  const evento = eventoDaLinha(linhaDe<Record<string, unknown>>(eventoResultado.data));

  // `acompanhamento:visualizar` abre a Central, mas não é chave-mestra.
  if (!canOpenOperationalEvent(permissions, evento.modulo)) {
    throw new OperationalEventDetailError("EVENTO_NAO_ENCONTRADO", 404);
  }

  if (!isOperationalEntityType(evento.entidadeTipo)) {
    throw new OperationalEventDetailError("ENTIDADE_NAO_SUPORTADA", 404);
  }

  const entidadeId = parseOperationalEntityId(evento.entidadeTipo, evento.entidadeId);
  if (entidadeId === null) {
    throw new OperationalEventDetailError("ENTIDADE_NAO_SUPORTADA", 404);
  }

  const modulos = allowedOperationalModules(permissions);
  const grants: DetailGrants = {
    verCliente: canViewClientName(permissions),
    verFinanceiro: modulos.includes("FINANCEIRO"),
    verVendas: modulos.includes("VENDAS"),
  };

  const fonte = await carregarFonte(evento.entidadeTipo, entidadeId, grants);
  if (!fonte) return buildIndisponivelDetail(evento, evento.entidadeTipo);

  return buildOperationalEventDetail(evento, fonte, grants);
}
