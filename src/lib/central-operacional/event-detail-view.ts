/**
 * Montagem do detalhe de um evento operacional.
 *
 * Aqui não entra Supabase nem `server-only`: tudo é função pura sobre linhas já
 * lidas, no mesmo formato de `aggregates.ts` e `attention-rules.ts`. É o que
 * torna o contrato de privacidade testável — os testes alimentam fixtures com
 * CPF, telefone e endereço de propósito e conferem que nada disso sai daqui.
 *
 * Regra que vale para o arquivo inteiro: nenhum `...linha`. Todo campo que sai
 * é escrito um a um, de propósito. Espalhar a linha é como esse tipo de
 * vazamento acontece de verdade.
 */

import { parsePostgresIntegerId } from "@/lib/postgres-id";
import {
  origemDaTransacao,
  rotuloDaOrigem,
  saldoEmAberto,
  valorDeFace,
  valorLiquidoEfetivo,
  ehBaixaParcial,
  ehTransferencia,
} from "@/lib/financeiro/transacao";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { resolveOrdemVehicle } from "@/lib/ordens/vehicle-snapshot";
import {
  operationalEventDetailSchema,
  type OperationalDetailField,
  type OperationalDetailIndicator,
  type OperationalDetailLink,
  type OperationalDetailRestriction,
  type OperationalDetailSection,
  type OperationalEntityType,
  type OperationalEvent,
  type OperationalEventDetail,
} from "./contracts";

/** O que este usuário pode ver, resolvido uma vez e passado a todo builder. */
export type DetailGrants = {
  verCliente: boolean;
  verFinanceiro: boolean;
  verVendas: boolean;
};

const MAX_INDICADORES = 4;
const MAX_SECOES = 6;
const MAX_CAMPOS = 12;
const MAX_VINCULOS = 6;

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */

function texto(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
}

function campoTexto(chave: string, rotulo: string, valor: unknown): OperationalDetailField | null {
  const conteudo = texto(valor);
  if (!conteudo) return null;
  return { chave, rotulo, tipo: "TEXTO", texto: conteudo, numero: null, sufixo: null };
}

function campoMoeda(
  chave: string,
  rotulo: string,
  valor: unknown,
  { omitirZero = false }: { omitirZero?: boolean } = {},
): OperationalDetailField | null {
  const convertido = numero(valor);
  if (convertido === null) return null;
  if (omitirZero && convertido === 0) return null;
  return { chave, rotulo, tipo: "MOEDA", texto: null, numero: convertido, sufixo: null };
}

function campoQuantidade(
  chave: string,
  rotulo: string,
  valor: unknown,
  sufixo: string | null = null,
): OperationalDetailField | null {
  const convertido = numero(valor);
  if (convertido === null) return null;
  return { chave, rotulo, tipo: "QUANTIDADE", texto: null, numero: convertido, sufixo };
}

function campoData(
  chave: string,
  rotulo: string,
  valor: unknown,
  comHora = false,
): OperationalDetailField | null {
  const iso = texto(valor);
  if (!iso) return null;
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;
  return {
    chave,
    rotulo,
    tipo: comHora ? "DATAHORA" : "DATA",
    texto: instante.toISOString(),
    numero: null,
    sufixo: null,
  };
}

/** Descarta campo nulo e devolve `null` quando a seção ficaria vazia. */
function secao(
  id: string,
  titulo: string,
  campos: Array<OperationalDetailField | null>,
): OperationalDetailSection | null {
  const presentes = campos.filter((campo): campo is OperationalDetailField => campo !== null);
  if (presentes.length === 0) return null;
  return { id, titulo, campos: presentes.slice(0, MAX_CAMPOS) };
}

function indicadorMoeda(chave: string, rotulo: string, valor: unknown): OperationalDetailIndicator | null {
  const convertido = numero(valor);
  if (convertido === null) return null;
  return { chave, rotulo, tipo: "MOEDA", valor: convertido, sufixo: null };
}

function indicadorQuantidade(
  chave: string,
  rotulo: string,
  valor: unknown,
  sufixo: string | null = null,
): OperationalDetailIndicator | null {
  const convertido = numero(valor);
  if (convertido === null) return null;
  return { chave, rotulo, tipo: "QUANTIDADE", valor: convertido, sufixo };
}

function compactar<T>(itens: Array<T | null>, limite: number): T[] {
  return itens.filter((item): item is T => item !== null).slice(0, limite);
}

/** `ORCAMENTO_APROVADO` → `Orçamento Aprovado`. Mesmo tratamento das impressões. */
export function rotuloDeStatus(codigo: unknown): string | null {
  const bruto = texto(codigo);
  if (!bruto) return null;
  return bruto
    .replace(/_/g, " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s)\p{L}/gu, (letra) => letra.toLocaleUpperCase("pt-BR"));
}

/** `"3h20"`. Devolve `null` quando falta uma das pontas ou a ordem é impossível. */
export function formatarDuracao(inicio: unknown, fim: unknown): string | null {
  const de = texto(inicio);
  const ate = texto(fim);
  if (!de || !ate) return null;
  const decorrido = new Date(ate).getTime() - new Date(de).getTime();
  if (!Number.isFinite(decorrido) || decorrido < 0) return null;
  const horas = Math.floor(decorrido / 3_600_000);
  const minutos = Math.floor((decorrido % 3_600_000) / 60_000);
  return `${horas}h${String(minutos).padStart(2, "0")}`;
}

/**
 * Situação do saldo, na mesma régua do gatilho `central_evento_produto_estoque`
 * (`estoque <= estoqueminimo`), para o card não discordar do evento que o abriu.
 */
export function situacaoDeEstoque(estoque: unknown, minimo: unknown): "ZERADO" | "BAIXO" | "NORMAL" {
  const atual = numero(estoque) ?? 0;
  const piso = numero(minimo) ?? 0;
  if (atual <= 0) return "ZERADO";
  return atual <= piso ? "BAIXO" : "NORMAL";
}

/**
 * Primeira mensagem de erro de uma NFS-e, truncada.
 *
 * `nfse.erros` não tem formato fixo — vem lista de string, lista de objeto ou
 * texto solto. Serializar o bruto é que não pode: o retorno da prefeitura anda
 * junto de `payload_enviado`, que carrega documento e endereço do tomador.
 */
export function resumirErrosNfse(erros: unknown): string | null {
  const primeiro = Array.isArray(erros) ? erros[0] : erros;
  if (primeiro === null || primeiro === undefined) return null;

  let mensagem: string | null = null;
  if (typeof primeiro === "string") {
    mensagem = primeiro;
  } else if (typeof primeiro === "object") {
    const registro = primeiro as Record<string, unknown>;
    mensagem =
      texto(registro.mensagem) ??
      texto(registro.message) ??
      texto(registro.descricao) ??
      texto(registro.erro);
  }

  const limpo = texto(mensagem);
  if (!limpo) return null;
  return limpo.length > 200 ? `${limpo.slice(0, 199)}…` : limpo;
}

/**
 * `entidade_id` é texto no log, mas as tabelas de destino não são todas iguais:
 * `transacao.id` é `bigint` e não sobrevive a um `Number()`, enquanto as demais
 * são `integer` e precisam recusar valores acima do teto do Postgres.
 */
export function parseOperationalEntityId(
  entidadeTipo: OperationalEntityType,
  entidadeId: unknown,
): string | null {
  const bruto = texto(entidadeId);
  if (!bruto) return null;

  if (entidadeTipo === "TRANSACAO") {
    return /^[1-9]\d{0,18}$/.test(bruto) ? bruto : null;
  }

  const inteiro = parsePostgresIntegerId(bruto);
  return inteiro === null ? null : String(inteiro);
}

export function isOperationalEntityType(valor: unknown): valor is OperationalEntityType {
  return (
    valor === "ORDEM_SERVICO" ||
    valor === "VENDA" ||
    valor === "TRANSACAO" ||
    valor === "PRODUTO" ||
    valor === "NFE" ||
    valor === "NFSE"
  );
}

/* ------------------------------------------------------------------ */
/* Linhas de entrada                                                   */
/* ------------------------------------------------------------------ */

type ClienteRow = { nomerazaosocial?: string | null } | null;

export type TransacaoResumoRow = {
  tipo?: string | null;
  pendente?: boolean | null;
  evento_financeiro_id?: number | string | null;
  valor?: number | string | null;
  valor_acrescimos?: number | string | null;
  valor_baixado?: number | string | null;
  is_deleted?: boolean | null;
};

export type OrdemDetailRow = {
  id: number;
  status?: string | null;
  descricao?: string | null;
  prioridade?: string | null;
  dataentrada?: string | null;
  datasaida?: string | null;
  execucao_inicio_em?: string | null;
  execucao_fim_em?: string | null;
  finalizado_em?: string | null;
  orcamentototal?: number | string | null;
  acrescimo_financeiro_tipo?: string | null;
  acrescimo_financeiro_valor?: number | string | null;
  forma_pagamento?: string | null;
  parcelas_pagamento?: number | null;
  garantia?: string | null;
  motivo_cancelamento?: string | null;
  veiculo_snapshot?: unknown;
  setor?: { nome?: string | null } | null;
  veiculo?: {
    id?: number | null;
    placa?: string | null;
    placa_formatada?: string | null;
    marca?: string | null;
    modelo?: string | null;
    ano?: number | null;
    ano_modelo?: number | null;
    cor?: string | null;
    kmatual?: number | null;
    chassi?: string | null;
  } | null;
  cliente?: ClienteRow;
  transacoes?: TransacaoResumoRow[] | null;
};

export type VendaDetailRow = {
  id: number;
  status?: string | null;
  canal?: string | null;
  datavenda?: string | null;
  valortotal?: number | string | null;
  acrescimo_financeiro_tipo?: string | null;
  acrescimo_financeiro_valor?: number | string | null;
  forma_pagamento?: string | null;
  parcelas_pagamento?: number | null;
  descricao?: string | null;
  garantia?: string | null;
  motivo_cancelamento?: string | null;
  status_entrega?: string | null;
  codigo_rastreio?: string | null;
  cliente?: ClienteRow;
  vendedor_rel?: { nome?: string | null } | null;
  itens?: Array<{ id: number }> | null;
  transacoes?: TransacaoResumoRow[] | null;
};

export type TransacaoDetailRow = {
  id: number | string;
  descricao?: string | null;
  tipo?: string | null;
  pendente?: boolean | null;
  metodopagamento?: string | null;
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  valor_acrescimos?: number | string | null;
  valor_descontos?: number | string | null;
  valor_baixado?: number | string | null;
  data?: string | null;
  vencimento_em?: string | null;
  pago_em?: string | null;
  ordemservicoid?: number | null;
  vendaid?: number | null;
  adiantamento_id?: number | null;
  parcelamento_id?: number | null;
  pagamento_multiplo_id?: number | null;
  baixa_de_transacao_id?: number | string | null;
  transferencia_id?: number | null;
  banco?: { titulo?: string | null } | null;
  cliente?: ClienteRow;
  fornecedor?: { nomerazaosocial?: string | null } | null;
};

export type ProdutoDetailRow = {
  id: number;
  titulo?: string | null;
  referencia?: string | null;
  codigobarras?: string | null;
  unidade?: string | null;
  estoque?: number | string | null;
  estoqueminimo?: number | string | null;
  precovenda?: number | string | null;
  precocompra?: number | string | null;
};

export type NfeDetailRow = {
  id: number;
  modelo?: string | number | null;
  serie?: string | number | null;
  numero?: number | null;
  chave_acesso?: string | null;
  ambiente?: string | null;
  status?: string | null;
  dataemissao?: string | null;
  dataautorizacao?: string | null;
  protocolo?: string | null;
  total_nfe?: number | string | null;
  codigo_rejeicao?: string | null;
  motivo_rejeicao?: string | null;
  ordemservicoid?: number | null;
  vendaid?: number | null;
  cliente?: ClienteRow;
};

export type NfseDetailRow = {
  id: number;
  numero?: string | null;
  status?: string | null;
  valor_total?: number | string | null;
  dataemissao?: string | null;
  protocolo?: string | null;
  erros?: unknown;
  ordemservicoid?: number | null;
  cliente?: ClienteRow;
};

/** Rótulo/estado de um documento vinculado, já lido pelo servidor. */
export type VinculoResumo = {
  id: number;
  status?: string | null;
  total?: number | string | null;
  descricao?: string | null;
};

export type OperationalDetailSource =
  | { entidadeTipo: "ORDEM_SERVICO"; ordem: OrdemDetailRow; produtos: number; servicos: number }
  | { entidadeTipo: "VENDA"; venda: VendaDetailRow }
  | {
      entidadeTipo: "TRANSACAO";
      transacao: TransacaoDetailRow;
      ordem?: VinculoResumo | null;
      venda?: VinculoResumo | null;
    }
  | { entidadeTipo: "PRODUTO"; produto: ProdutoDetailRow }
  | { entidadeTipo: "NFE"; nfe: NfeDetailRow }
  | { entidadeTipo: "NFSE"; nfse: NfseDetailRow };

/* ------------------------------------------------------------------ */
/* Blocos compartilhados                                               */
/* ------------------------------------------------------------------ */

function secaoCliente(
  cliente: ClienteRow | undefined,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
  titulo = "Cliente",
): OperationalDetailSection | null {
  if (!grants.verCliente) {
    restricoes.push("CLIENTE_SEM_PERMISSAO");
    return null;
  }
  return secao("cliente", titulo, [campoTexto("cliente.nome", "Nome", cliente?.nomerazaosocial)]);
}

function vinculoOs(resumo: VinculoResumo | null | undefined): OperationalDetailLink | null {
  if (!resumo) return null;
  const status = rotuloDeStatus(resumo.status);
  return {
    tipo: "ORDEM_SERVICO",
    id: String(resumo.id),
    rotulo: `OS #${resumo.id}`,
    detalhe: [status, texto(resumo.descricao)].filter(Boolean).join(" · ") || null,
    valor: numero(resumo.total),
    href: `/print/ordemservico/${resumo.id}`,
  };
}

/**
 * Venda vinculada.
 *
 * Sem `vendas:visualizar` sobra só o rótulo — que o próprio título do evento já
 * diz. Status, total e link ficam de fora, porque o feed também não entregaria
 * esse evento a quem não tem o módulo.
 */
function vinculoVenda(
  resumo: VinculoResumo | null | undefined,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): OperationalDetailLink | null {
  if (!resumo) return null;
  if (!grants.verVendas) {
    restricoes.push("VENDAS_SEM_PERMISSAO");
    return {
      tipo: "VENDA",
      id: String(resumo.id),
      rotulo: `Venda #${resumo.id}`,
      detalhe: null,
      valor: null,
      href: null,
    };
  }
  return {
    tipo: "VENDA",
    id: String(resumo.id),
    rotulo: `Venda #${resumo.id}`,
    detalhe: rotuloDeStatus(resumo.status),
    valor: numero(resumo.total),
    href: `/print/venda/${resumo.id}/orcamento`,
  };
}

function transacoesVivas(linhas: TransacaoResumoRow[] | null | undefined) {
  return (linhas ?? []).filter((linha) => linha.is_deleted !== true);
}

/* ------------------------------------------------------------------ */
/* Builders por entidade                                               */
/* ------------------------------------------------------------------ */

type Montagem = {
  referencia: string;
  titulo: string;
  subtitulo: string | null;
  status: OperationalEventDetail["status"];
  indicadores: OperationalDetailIndicator[];
  secoes: OperationalDetailSection[];
  vinculos: OperationalDetailLink[];
};

function montarOrdem(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "ORDEM_SERVICO" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { ordem, produtos, servicos } = fonte;
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: ordem.orcamentototal,
    acrescimoFinanceiroTipo: ordem.acrescimo_financeiro_tipo,
    acrescimoFinanceiroValor: ordem.acrescimo_financeiro_valor,
    transacoes: transacoesVivas(ordem.transacoes),
  });
  const veiculo = resolveOrdemVehicle(ordem.veiculo, ordem.veiculo_snapshot);

  const indicadores = [indicadorMoeda("os.total", "Total", resumo.totalDevido)];
  if (grants.verFinanceiro) {
    indicadores.push(
      indicadorMoeda("os.recebido", "Recebido", resumo.valorRecebido),
      indicadorMoeda("os.saldo", "Saldo a receber", resumo.saldoAReceber),
    );
  } else {
    restricoes.push("FINANCEIRO_SEM_PERMISSAO");
  }

  const secoes = [
    secao("execucao", "Execução", [
      campoData("os.entrada", "Entrada", ordem.dataentrada),
      campoData("os.execucao_inicio", "Início", ordem.execucao_inicio_em, true),
      campoData("os.execucao_fim", "Conclusão", ordem.execucao_fim_em, true),
      campoData("os.saida", "Saída", ordem.datasaida),
      campoTexto(
        "os.duracao",
        "Duração",
        formatarDuracao(ordem.execucao_inicio_em, ordem.execucao_fim_em),
      ),
    ]),
    secao("composicao", "Composição", [
      campoQuantidade("os.produtos", "Peças", produtos),
      campoQuantidade("os.servicos", "Serviços", servicos),
      campoTexto("os.prioridade", "Prioridade", rotuloDeStatus(ordem.prioridade)),
      campoTexto("os.forma_pagamento", "Pagamento", rotuloDeStatus(ordem.forma_pagamento)),
      campoQuantidade("os.parcelas", "Parcelas", ordem.parcelas_pagamento),
      campoTexto("os.garantia", "Garantia", ordem.garantia),
      campoTexto("os.motivo_cancelamento", "Motivo do cancelamento", ordem.motivo_cancelamento),
    ]),
    veiculo
      ? secao("veiculo", "Veículo", [
          campoTexto(
            "os.veiculo",
            "Modelo",
            [veiculo.marca, veiculo.modelo].filter(Boolean).join(" "),
          ),
          campoTexto("os.placa", "Placa", veiculo.placa ?? veiculo.placa_formatada),
          campoTexto("os.cor", "Cor", veiculo.cor),
          campoQuantidade("os.ano", "Ano", veiculo.ano),
          campoQuantidade("os.km", "Quilometragem", veiculo.kmatual, "km"),
          veiculo.historico
            ? campoTexto("os.historico", "Origem", "Dados históricos da OS migrada")
            : null,
        ])
      : null,
    secaoCliente(ordem.cliente, grants, restricoes),
  ];

  return {
    referencia: `OS #${ordem.id}`,
    titulo: texto(ordem.descricao)?.slice(0, 120) ?? `OS #${ordem.id}`,
    subtitulo: texto(ordem.setor?.nome),
    status: montarStatus(ordem.status, evento),
    indicadores: compactar(indicadores, MAX_INDICADORES),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar(
      [vinculoOs({ id: ordem.id, status: ordem.status, total: resumo.totalDevido })],
      MAX_VINCULOS,
    ),
  };
}

function montarVenda(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "VENDA" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { venda } = fonte;
  const resumo = calcularResumoFinanceiroOs({
    totalComercial: venda.valortotal,
    acrescimoFinanceiroTipo: venda.acrescimo_financeiro_tipo,
    acrescimoFinanceiroValor: venda.acrescimo_financeiro_valor,
    transacoes: transacoesVivas(venda.transacoes),
  });

  const indicadores = [indicadorMoeda("venda.total", "Total", resumo.totalDevido)];
  if (grants.verFinanceiro) {
    indicadores.push(
      indicadorMoeda("venda.recebido", "Recebido", resumo.valorRecebido),
      indicadorMoeda("venda.saldo", "Saldo a receber", resumo.saldoAReceber),
    );
  } else {
    restricoes.push("FINANCEIRO_SEM_PERMISSAO");
  }

  const secoes = [
    secao("venda", "Venda", [
      campoData("venda.data", "Data", venda.datavenda),
      campoTexto("venda.canal", "Canal", rotuloDeStatus(venda.canal)),
      campoTexto("venda.forma_pagamento", "Pagamento", rotuloDeStatus(venda.forma_pagamento)),
      campoQuantidade("venda.parcelas", "Parcelas", venda.parcelas_pagamento),
      campoTexto("venda.vendedor", "Vendedor", venda.vendedor_rel?.nome),
      campoQuantidade("venda.itens", "Itens", venda.itens?.length ?? null),
      campoTexto("venda.garantia", "Garantia", venda.garantia),
      campoTexto("venda.motivo_cancelamento", "Motivo do cancelamento", venda.motivo_cancelamento),
    ]),
    secao("entrega", "Entrega", [
      campoTexto("venda.status_entrega", "Situação", rotuloDeStatus(venda.status_entrega)),
      campoTexto("venda.rastreio", "Rastreio", venda.codigo_rastreio),
    ]),
    secaoCliente(venda.cliente, grants, restricoes),
  ];

  return {
    referencia: `Venda #${venda.id}`,
    titulo: texto(venda.descricao)?.slice(0, 120) ?? `Venda #${venda.id}`,
    subtitulo: null,
    status: montarStatus(venda.status, evento),
    indicadores: compactar(indicadores, MAX_INDICADORES),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar(
      [
        vinculoVenda(
          { id: venda.id, status: venda.status, total: resumo.totalDevido },
          grants,
          restricoes,
        ),
      ],
      MAX_VINCULOS,
    ),
  };
}

function montarTransacao(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "TRANSACAO" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { transacao, ordem, venda } = fonte;
  const pendente = transacao.pendente === true;
  const codigoStatus = pendente
    ? ehBaixaParcial(transacao)
      ? "BAIXA_PARCIAL"
      : "PENDENTE"
    : "PAGO";
  const origem = origemDaTransacao(transacao);

  const indicadores = [
    indicadorMoeda("transacao.valor", "Valor", valorDeFace(transacao)),
    indicadorMoeda("transacao.liquido", "Líquido", valorLiquidoEfetivo(transacao)),
    pendente ? indicadorMoeda("transacao.aberto", "Em aberto", saldoEmAberto(transacao)) : null,
  ];

  const naturezas = [
    ehTransferencia(transacao)
      ? campoTexto("transacao.transferencia", "Natureza", "Transferência entre contas")
      : null,
    transacao.parcelamento_id != null
      ? campoTexto("transacao.parcelamento", "Parcelamento", "Parcela de um parcelamento")
      : null,
    transacao.pagamento_multiplo_id != null
      ? campoTexto("transacao.pagamento_multiplo", "Pagamento", "Parte de um pagamento múltiplo")
      : null,
    transacao.baixa_de_transacao_id != null
      ? campoTexto("transacao.baixa", "Baixa", "Baixa de um título")
      : null,
    transacao.adiantamento_id != null
      ? campoTexto("transacao.adiantamento", "Antecipação", "Título antecipado")
      : null,
  ];

  const secoes = [
    secao("lancamento", "Lançamento", [
      campoTexto("transacao.tipo", "Tipo", rotuloDeStatus(transacao.tipo)),
      campoTexto("transacao.metodo", "Método", rotuloDeStatus(transacao.metodopagamento)),
      campoTexto("transacao.banco", "Conta", transacao.banco?.titulo),
      campoData("transacao.data", "Data", transacao.data),
      campoData("transacao.vencimento", "Vencimento", transacao.vencimento_em),
      campoData("transacao.pago_em", "Pago em", transacao.pago_em, true),
    ]),
    secao("valores", "Valores", [
      campoMoeda("transacao.acrescimos", "Acréscimos", transacao.valor_acrescimos, {
        omitirZero: true,
      }),
      campoMoeda("transacao.descontos", "Descontos", transacao.valor_descontos, {
        omitirZero: true,
      }),
      campoMoeda("transacao.baixado", "Já baixado", transacao.valor_baixado, { omitirZero: true }),
    ]),
    secao("natureza", "Natureza", naturezas),
    secao("contraparte", "Contraparte", [
      grants.verCliente ? campoTexto("cliente.nome", "Cliente", transacao.cliente?.nomerazaosocial) : null,
      campoTexto("transacao.fornecedor", "Fornecedor", transacao.fornecedor?.nomerazaosocial),
    ]),
  ];

  if (!grants.verCliente) restricoes.push("CLIENTE_SEM_PERMISSAO");

  return {
    referencia: `Lançamento #${transacao.id}`,
    titulo: texto(transacao.descricao)?.slice(0, 120) ?? `Lançamento #${transacao.id}`,
    subtitulo: origem ? `Origem: ${rotuloDaOrigem(origem)}` : null,
    status: {
      codigo: codigoStatus,
      rotulo: rotuloDeStatus(codigoStatus) ?? codigoStatus,
      prioridade: evento.prioridade,
    },
    indicadores: compactar(indicadores, MAX_INDICADORES),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar([vinculoOs(ordem), vinculoVenda(venda, grants, restricoes)], MAX_VINCULOS),
  };
}

function montarProduto(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "PRODUTO" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { produto } = fonte;
  const unidade = texto(produto.unidade);
  const situacao = situacaoDeEstoque(produto.estoque, produto.estoqueminimo);
  const estoqueNoEvento = numero(evento.metadata.estoqueAtual);
  const estoqueAgora = numero(produto.estoque);

  const precos = [campoMoeda("produto.preco_venda", "Preço de venda", produto.precovenda)];
  if (grants.verFinanceiro) {
    precos.push(campoMoeda("produto.preco_compra", "Custo", produto.precocompra));
  } else {
    restricoes.push("FINANCEIRO_SEM_PERMISSAO");
  }

  const secoes = [
    secao("identificacao", "Identificação", [
      campoTexto("produto.referencia", "Referência", produto.referencia),
      campoTexto("produto.codigobarras", "Código de barras", produto.codigobarras),
      campoTexto("produto.unidade", "Unidade", unidade),
    ]),
    secao("estoque", "Estoque", [
      campoQuantidade("produto.estoque", "Saldo atual", produto.estoque, unidade),
      campoQuantidade("produto.minimo", "Mínimo", produto.estoqueminimo, unidade),
      campoTexto("produto.situacao", "Situação", rotuloDeStatus(situacao)),
      // A metadata magra ganha utilidade aqui: se o saldo já mudou de novo, o
      // card avisa em vez de contradizer silenciosamente o evento que o abriu.
      estoqueNoEvento !== null && estoqueAgora !== null && estoqueNoEvento !== estoqueAgora
        ? campoTexto(
            "produto.movimento_posterior",
            "Atenção",
            `Houve movimento posterior a este evento (saldo era ${estoqueNoEvento})`,
          )
        : null,
    ]),
    secao("precos", "Preços", precos),
  ];

  return {
    referencia: texto(produto.referencia) ?? `Produto #${produto.id}`,
    titulo: texto(produto.titulo) ?? `Produto #${produto.id}`,
    subtitulo: null,
    status: {
      codigo: situacao,
      rotulo: rotuloDeStatus(situacao) ?? situacao,
      prioridade: evento.prioridade,
    },
    indicadores: compactar(
      [
        indicadorQuantidade("produto.estoque", "Saldo atual", produto.estoque, unidade),
        indicadorQuantidade("produto.minimo", "Mínimo", produto.estoqueminimo, unidade),
        indicadorQuantidade("produto.movimento", "Movimento", evento.quantidade, unidade),
      ],
      MAX_INDICADORES,
    ),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: [],
  };
}

function montarNfe(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "NFE" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { nfe } = fonte;
  const numeroDocumento = texto(nfe.numero) ?? String(nfe.id);
  const rejeitada = ["REJEITADA", "DENEGADA"].includes(String(nfe.status ?? "").toUpperCase());

  const secoes = [
    secao("documento", "Documento", [
      campoTexto("nfe.modelo", "Modelo", nfe.modelo),
      campoTexto("nfe.serie", "Série", nfe.serie),
      campoTexto("nfe.numero", "Número", numeroDocumento),
      campoTexto("nfe.ambiente", "Ambiente", rotuloDeStatus(nfe.ambiente)),
      campoTexto("nfe.chave", "Chave de acesso", nfe.chave_acesso),
      campoTexto("nfe.protocolo", "Protocolo", nfe.protocolo),
      campoData("nfe.emissao", "Emissão", nfe.dataemissao, true),
      campoData("nfe.autorizacao", "Autorização", nfe.dataautorizacao, true),
    ]),
    // A razão de existir de um evento fiscal CRITICO é dizer por que falhou.
    rejeitada
      ? secao("rejeicao", "Rejeição", [
          campoTexto("nfe.codigo_rejeicao", "Código", nfe.codigo_rejeicao),
          campoTexto("nfe.motivo_rejeicao", "Motivo", nfe.motivo_rejeicao),
        ])
      : null,
    secaoCliente(nfe.cliente, grants, restricoes, "Destinatário"),
  ];

  return {
    referencia: `NF-e #${numeroDocumento}`,
    titulo: `NF-e #${numeroDocumento}`,
    subtitulo: rotuloDeStatus(nfe.status),
    status: montarStatus(nfe.status, evento),
    indicadores: compactar([indicadorMoeda("nfe.total", "Total", nfe.total_nfe)], MAX_INDICADORES),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar(
      [
        nfe.ordemservicoid != null ? vinculoOs({ id: nfe.ordemservicoid }) : null,
        nfe.vendaid != null ? vinculoVenda({ id: nfe.vendaid }, grants, restricoes) : null,
      ],
      MAX_VINCULOS,
    ),
  };
}

function montarNfse(
  evento: OperationalEvent,
  fonte: Extract<OperationalDetailSource, { entidadeTipo: "NFSE" }>,
  grants: DetailGrants,
  restricoes: OperationalDetailRestriction[],
): Montagem {
  const { nfse } = fonte;
  const numeroDocumento = texto(nfse.numero) ?? String(nfse.id);

  const secoes = [
    secao("documento", "Documento", [
      campoTexto("nfse.numero", "Número", numeroDocumento),
      campoTexto("nfse.protocolo", "Protocolo", nfse.protocolo),
      campoData("nfse.emissao", "Emissão", nfse.dataemissao, true),
    ]),
    secao("erro", "Retorno da prefeitura", [
      campoTexto("nfse.erro", "Mensagem", resumirErrosNfse(nfse.erros)),
    ]),
    secaoCliente(nfse.cliente, grants, restricoes, "Tomador"),
  ];

  return {
    referencia: `NFS-e #${numeroDocumento}`,
    titulo: `NFS-e #${numeroDocumento}`,
    subtitulo: rotuloDeStatus(nfse.status),
    status: montarStatus(nfse.status, evento),
    indicadores: compactar(
      [indicadorMoeda("nfse.total", "Total", nfse.valor_total)],
      MAX_INDICADORES,
    ),
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar(
      [nfse.ordemservicoid != null ? vinculoOs({ id: nfse.ordemservicoid }) : null],
      MAX_VINCULOS,
    ),
  };
}

function montarStatus(codigo: unknown, evento: OperationalEvent): OperationalEventDetail["status"] {
  const bruto = texto(codigo);
  if (!bruto) return null;
  return { codigo: bruto, rotulo: rotuloDeStatus(bruto) ?? bruto, prioridade: evento.prioridade };
}

/* ------------------------------------------------------------------ */
/* Entradas públicas                                                   */
/* ------------------------------------------------------------------ */

export function buildOperationalEventDetail(
  evento: OperationalEvent,
  fonte: OperationalDetailSource,
  grants: DetailGrants,
  geradoEm = new Date().toISOString(),
): OperationalEventDetail {
  const restricoes: OperationalDetailRestriction[] = [];

  const montagem =
    fonte.entidadeTipo === "ORDEM_SERVICO"
      ? montarOrdem(evento, fonte, grants, restricoes)
      : fonte.entidadeTipo === "VENDA"
        ? montarVenda(evento, fonte, grants, restricoes)
        : fonte.entidadeTipo === "TRANSACAO"
          ? montarTransacao(evento, fonte, grants, restricoes)
          : fonte.entidadeTipo === "PRODUTO"
            ? montarProduto(evento, fonte, grants, restricoes)
            : fonte.entidadeTipo === "NFE"
              ? montarNfe(evento, fonte, grants, restricoes)
              : montarNfse(evento, fonte, grants, restricoes);

  return operationalEventDetailSchema.parse({
    evento,
    entidadeTipo: fonte.entidadeTipo,
    estado: "DISPONIVEL",
    referencia: montagem.referencia,
    titulo: montagem.titulo,
    subtitulo: montagem.subtitulo,
    status: montagem.status,
    indicadores: montagem.indicadores,
    secoes: montagem.secoes,
    vinculos: montagem.vinculos,
    restricoes: Array.from(new Set(restricoes)),
    geradoEm,
  });
}

/**
 * O registro de origem sumiu — apagado, ou fora do alcance desta instalação.
 *
 * Isso é 200, não erro: o log guarda 90 dias e as linhas de negócio são
 * apagadas por marcação, então um evento antigo apontando para o vazio é
 * comportamento previsto. Renderiza com o que o próprio evento carrega,
 * lembrando que `jsonb_strip_nulls` deixa as chaves de vínculo AUSENTES.
 */
export function buildIndisponivelDetail(
  evento: OperationalEvent,
  entidadeTipo: OperationalEntityType,
  geradoEm = new Date().toISOString(),
): OperationalEventDetail {
  const ordemId = parsePostgresIntegerId(evento.metadata.ordemServicoId);
  const vendaId = parsePostgresIntegerId(evento.metadata.vendaId);

  const secoes = [
    secao("evento", "Registrado no evento", [
      campoTexto("evento.status", "Situação", rotuloDeStatus(evento.metadata.status)),
      campoTexto("evento.numero", "Número", evento.metadata.numero),
      campoQuantidade("evento.estoque", "Saldo no evento", evento.metadata.estoqueAtual),
      campoQuantidade("evento.minimo", "Mínimo no evento", evento.metadata.estoqueMinimo),
      campoMoeda("evento.valor", "Valor", evento.valor),
      campoQuantidade("evento.quantidade", "Quantidade", evento.quantidade),
      campoData("evento.ocorrido_em", "Ocorrido em", evento.ocorridoEm, true),
    ]),
  ];

  return operationalEventDetailSchema.parse({
    evento,
    entidadeTipo,
    estado: "ENTIDADE_INDISPONIVEL",
    referencia: evento.titulo,
    titulo: evento.titulo,
    subtitulo: "Registro de origem não está mais disponível",
    status: null,
    indicadores: [],
    secoes: compactar(secoes, MAX_SECOES),
    vinculos: compactar(
      [
        ordemId !== null ? vinculoOs({ id: ordemId }) : null,
        vendaId !== null
          ? {
              tipo: "VENDA" as const,
              id: String(vendaId),
              rotulo: `Venda #${vendaId}`,
              detalhe: null,
              valor: null,
              href: `/print/venda/${vendaId}/orcamento`,
            }
          : null,
      ],
      MAX_VINCULOS,
    ),
    restricoes: [],
    geradoEm,
  });
}
