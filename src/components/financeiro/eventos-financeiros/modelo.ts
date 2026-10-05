import { competenciaEmMesFechado } from "@/app/api/ordens/[id]/eventos-financeiros/_lib/competencia";
import { eventoTemProvenienciaExcluivel } from "@/lib/ordens/exclusao-evento-financeiro";
import { ordenarEventosDaOs } from "@/lib/ordens/eventos-financeiros";
import { eventoManualDoOperador } from "@/lib/financeiro/documento-evento";

/**
 * A leitura de um evento financeiro de OS, do jeito que a tela precisa.
 *
 * Vive fora do dialog da OS porque duas telas mostram a mesma lista: o painel
 * dentro da ordem e a fila global do financeiro. Enquanto a derivação morava
 * inline no dialog, ela também duplicava a ordenação de `ordenarEventosDaOs` —
 * duas cópias de uma regra de dinheiro, esperando divergir.
 */

/** A linha crua, como vem de `/api/ordens/{id}/eventos-financeiros` e de `/api/eventos-financeiros`. */
export type EventoFinanceiroBruto = {
  id: number;
  ordemservicoid?: number | null;
  source_type?: string | null;
  source_id?: number | null;
  venda?: { id: number; status: string; cliente?: { id: number; nomerazaosocial?: string | null } | null } | null;
  /**
   * Texto livre, e não união fechada: o banco aceita origens que esta tela não
   * precisa conhecer (ENTRADA_FISCAL, por exemplo), e uma origem nova não pode
   * quebrar a leitura do painel.
   */
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  status: "ATIVO" | "CANCELADO" | "CONVERTIDO";
  descricao: string;
  detalhe?: string | null;
  valor: number;
  data_evento?: string | null;
  chave_origem?: string | null;
  produtoid?: number | null;
  servicoid?: number | null;
  usuarioid?: string | null;
  /**
   * Saída de estoque que originou o consumo, quando existe.
   *
   * Separa os dois consumos que compartilham a origem `CONSUMO`: o que deu
   * baixa no inventário e o lançado à mão (a fita comprada na hora). Só o
   * primeiro tem estorno para oferecer.
   */
  consumo_saida_id?: number | null;
  consumo_usoconsumo_saida_id?: number | null;
  dados_snapshot?: Record<string, unknown> | null;
  is_manual?: boolean;
  created_by?: string | null;
  criado_por?: { id: string; nome: string } | null;
  pode_gerar_transacao: boolean;
  transacaoid?: number | null;
  /** Boleto que quita esta despesa, quando o pagamento cobre várias ou é parcelado. */
  lancamento_id?: number | null;
  competencia_em?: string | null;
  /** Só a lista global traz: a ordem de cada linha, para o agrupamento. */
  ordem?: {
    id: number;
    status: string;
    dataentrada?: string | null;
    execucao_fim_em?: string | null;
    cliente?: { id: number; nomerazaosocial?: string | null } | null;
  } | null;
};

export type LinhaDeEvento = {
  id: number;
  osId: number | null;
  vendaId?: number | null;
  venda?: EventoFinanceiroBruto["venda"];
  tipo: "ENTRADA" | "SAIDA";
  descricao: string;
  detalhe: string;
  valor: number;
  dataEvento: string | null;
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  status: string;
  produtoid: number | null;
  servicoid: number | null;
  chaveOrigem: string | null;
  isManual: boolean;
  consumoSaidaId: number | null;
  consumoUsoConsumoSaidaId: number | null;
  temBaixaDeEstoque: boolean;
  comissaoAjustada: boolean;
  criadoPorNome: string | null;
  podeGerarTransacao: boolean;
  competenciaFechada: boolean;
  transacaoId: number | null;
  lancamentoId: number | null;
  ordem: EventoFinanceiroBruto["ordem"];
};

export function montarLinhas(
  eventos: EventoFinanceiroBruto[],
  opcoes: { preservarOrdem?: boolean } = {},
): LinhaDeEvento[] {
  const ativos = eventos.filter((evento) => evento.status !== "CANCELADO");
  const ordenados = opcoes.preservarOrdem ? ativos : ordenarEventosDaOs(ativos as any);
  return ordenados.map((evento: any) => ({
    id: evento.id,
    osId: evento.ordemservicoid ?? evento.ordem?.id ?? null,
    vendaId: evento.source_type === "VENDA" ? Number(evento.source_id) : null,
    venda: evento.venda ?? null,
    tipo: (evento.natureza === "RECEITA" ? "ENTRADA" : "SAIDA") as "ENTRADA" | "SAIDA",
    descricao: evento.descricao,
    detalhe: evento.detalhe || evento.origem,
    valor: Number(evento.valor || 0),
    dataEvento: evento.data_evento ?? null,
    origem: evento.origem,
    natureza: evento.natureza,
    status: evento.status,
    produtoid: evento.produtoid ?? null,
    servicoid: evento.servicoid ?? null,
    chaveOrigem: evento.chave_origem ?? null,
    isManual: evento.is_manual === true,
    consumoSaidaId: evento.consumo_saida_id ?? null,
    consumoUsoConsumoSaidaId: evento.consumo_usoconsumo_saida_id ?? null,
    temBaixaDeEstoque:
      evento.consumo_saida_id != null || evento.consumo_usoconsumo_saida_id != null,
    // Comissão corrigida à mão para de seguir o recálculo automático; a
    // linha precisa dizer isso, senão o número parece divergir do cadastro
    // sem explicação.
    comissaoAjustada:
      evento.origem === "COMISSAO"
      && (evento.dados_snapshot as Record<string, unknown> | null)?.comissao_ajustada_a_mao === true,
    criadoPorNome: evento.criado_por?.nome ?? null,
    podeGerarTransacao: evento.pode_gerar_transacao,
    competenciaFechada: competenciaEmMesFechado(evento.competencia_em),
    transacaoId: evento.transacaoid ?? null,
    lancamentoId: evento.lancamento_id ?? null,
    ordem: evento.ordem ?? null,
  }));
}

/**
 * Despesa que ainda pode virar pagamento.
 *
 * `competenciaFechada` de propósito não entra: lançar não reescreve o valor do
 * evento, só o vincula a um pagamento. O mês fechado trava a edição, não a
 * quitação.
 */
export function eventoSelecionavel(linha: Pick<LinhaDeEvento, "podeGerarTransacao" | "status" | "tipo">) {
  return linha.podeGerarTransacao && linha.status === "ATIVO" && linha.tipo === "SAIDA";
}

export function motivoNaoSelecionavel(
  linha: Pick<LinhaDeEvento, "podeGerarTransacao" | "status" | "tipo">,
) {
  if (linha.tipo !== "SAIDA") return "Só despesas podem ser agrupadas num pagamento.";
  if (linha.status !== "ATIVO") return "Esta despesa já foi lançada no financeiro.";
  if (!linha.podeGerarTransacao) return "Lançamento automático não gera transação.";
  return undefined;
}

/**
 * Só snapshot de produto ainda não lançado: a transação vinculada não
 * acompanharia o novo valor.
 */
export function podeSincronizar(linha: Pick<LinhaDeEvento, "origem" | "status" | "produtoid">) {
  return linha.origem === "PRODUTO" && linha.status === "ATIVO" && Boolean(linha.produtoid);
}

export function podeOferecerExclusao(linha: LinhaDeEvento) {
  if (linha.vendaId != null && (!eventoManualDoOperador({ is_manual: linha.isManual, chave_origem: linha.chaveOrigem }) || linha.temBaixaDeEstoque)) return false;
  return eventoTemProvenienciaExcluivel({
    id: linha.id,
    origem: linha.origem,
    natureza: linha.natureza,
    status: linha.status,
    descricao: linha.descricao,
    valor: linha.valor,
    chave_origem: linha.chaveOrigem,
    is_manual: linha.isManual,
    consumo_saida_id: linha.consumoSaidaId,
    consumo_usoconsumo_saida_id: linha.consumoUsoConsumoSaidaId,
  } as any);
}

/** Capacidade da origem: o status comercial da venda não participa. */
export function capacidadesDoEvento(linha: LinhaDeEvento) {
  const manual = eventoManualDoOperador({ is_manual: linha.isManual, chave_origem: linha.chaveOrigem });
  const daOs = linha.osId != null;
  return {
    editar: linha.vendaId != null ? manual && !linha.temBaixaDeEstoque && podeOferecerExclusao(linha)
      : daOs && (linha.tipo === "ENTRADA" || linha.isManual || linha.origem === "COMISSAO"),
    excluir: podeOferecerExclusao(linha),
    editarTextos: linha.origem !== "COMISSAO" && (manual || linha.tipo === "SAIDA"),
    sincronizarSnapshot: daOs && podeSincronizar(linha),
    origemDaOs: daOs,
  };
}

/** As linhas de uma lista global, na ordem em que as OSs devem aparecer. */
export type GrupoDeOs = {
  osId: number | null;
  chave: string;
  rotulo: string;
  cliente: string | null;
  status: string | null;
  linhas: LinhaDeEvento[];
  total: number;
};

export function agruparPorOrdem(linhas: LinhaDeEvento[]): GrupoDeOs[] {
  const grupos = new Map<string, GrupoDeOs>();
  for (const linha of linhas) {
    if (linha.osId == null && linha.vendaId == null) continue;
    const chave = linha.osId != null ? `OS:${linha.osId}` : `VENDA:${linha.vendaId}`;
    const atual = grupos.get(chave) ?? {
      osId: linha.osId,
      chave,
      rotulo: linha.osId != null ? `OS #${linha.osId}` : `Venda #${linha.vendaId}`,
      cliente: (linha.ordem ?? linha.venda)?.cliente?.nomerazaosocial ?? null,
      status: (linha.ordem ?? linha.venda)?.status ?? null,
      linhas: [],
      total: 0,
    };
    atual.linhas.push(linha);
    // O total do cabeçalho é o que a OS custa, não o seu resultado: quem lê a
    // fila está decidindo quanto vai pagar, e receita ali só confundiria.
    if (linha.tipo === "SAIDA") atual.total += linha.valor;
    grupos.set(chave, atual);
  }
  return [...grupos.values()].map((grupo) => ({
    ...grupo,
    // A lista global chega agrupada por OS pelo servidor. Dentro de cada bloco,
    // mantemos a leitura econômica da tela da OS: receita, custos e comissão do
    // mesmo item permanecem juntos.
    linhas: ordenarEventosDaOs(grupo.linhas),
    total: Math.round(grupo.total * 100) / 100,
  }));
}
