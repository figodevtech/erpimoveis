"use client";

import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import TransactionDialog from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import ValueInput from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { Tipo_transacao } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ImpactoExclusaoEvento } from "@/lib/ordens/exclusao-evento-financeiro";
import {
  LIMITE_SELECAO_EVENTOS,
  type EventoSelecionavelResumido,
  type ResultadoSelecaoDeEventos,
} from "@/lib/financeiro/eventos-financeiros-selection";
import { toast } from "@/lib/toast";

import type { EndpointsDeEventos } from "./endpoints";
import {
  eventoSelecionavel,
  motivoNaoSelecionavel,
  capacidadesDoEvento,
  type LinhaDeEvento,
} from "./modelo";

/**
 * Lista e ações compartilhadas pela fila geral e pelos diálogos de OS e venda.
 * As permissões e os endpoints vêm do contexto. Eventos derivados de vendas
 * são consultados aqui; seus valores são alterados na origem.
 */
function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function resumirEventoSelecionavel(linha: LinhaDeEvento): EventoSelecionavelResumido {
  return {
    id: linha.id,
    osId: linha.osId,
    vendaId: linha.vendaId,
    descricao: linha.descricao,
    valor: linha.valor,
  };
}

type ParcelaDoLancamento = {
  id: number;
  descricao: string;
  valor: number;
  data: string;
  vencimento_em: string | null;
  pendente: boolean;
  pago_em: string | null;
};

export type PermissoesDoPainel = {
  /** Editar valor, criar despesa vinculada e sincronizar snapshot. */
  podeEditar: boolean;
  /** Criação manual; a OS mantém a permissão de edição quando não informada. */
  podeCriar?: boolean;
  /** Excluir o evento. */
  podeExcluir: boolean;
  /** Desfazer dinheiro vinculado exige exclusão financeira, inclusive no contexto da OS. */
  podeDesfazerLancamento?: boolean;
  /** Transformar despesa em título no financeiro. */
  podeLancar: boolean;
};

export function PainelEventosFinanceiros({
  linhas,
  endpoints,
  permissoes,
  osIdUnica,
  vendaIdUnica,
  onChanged,
  acoesExtras,
  onVisualizarProduto,
  transacoesConhecidas,
  vazio,
  totalSelecionaveis,
  escopoSelecao,
  carregarSelecionaveisDoFiltro,
}: {
  linhas: LinhaDeEvento[];
  endpoints: EndpointsDeEventos;
  permissoes: PermissoesDoPainel;
  /** A OS, quando o painel é de uma só. */
  osIdUnica?: number;
  /** A venda, quando o painel é de uma só. Ambos habilitam criação manual. */
  vendaIdUnica?: number;
  onChanged: () => void | Promise<void>;
  /** Botões do dono da tela, ao lado dos do painel (ex.: Consumo de estoque). */
  acoesExtras?: React.ReactNode;
  onVisualizarProduto?: (produtoid: number) => void;
  /** Parcelas já carregadas, quando quem chama as tem. Só enriquece um aviso. */
  transacoesConhecidas?: Array<{ id: number; lancamento_id?: number | null }>;
  vazio?: React.ReactNode;
  /** Total elegível em todas as páginas da fila global. */
  totalSelecionaveis?: number;
  /** Muda quando busca, filtros ou situação mudam; paginação fica de fora. */
  escopoSelecao?: string;
  /** Busca todos os candidatos do filtro global, independentemente da página. */
  carregarSelecionaveisDoFiltro?: () => Promise<ResultadoSelecaoDeEventos>;
}) {
  const documentoUnico = osIdUnica != null ? { tipo: "ORDEM_SERVICO" as const, id: osIdUnica }
    : vendaIdUnica != null ? { tipo: "VENDA" as const, id: vendaIdUnica } : null;
  const podeCriar = permissoes.podeCriar ?? permissoes.podeEditar;
  const [modoSelecao, setModoSelecao] = useState(false);
  const [catalogoSelecionados, setCatalogoSelecionados] = useState<
    Map<number, EventoSelecionavelResumido>
  >(new Map());
  const [carregandoTodos, setCarregandoTodos] = useState(false);

  const [eventoParaLancamento, setEventoParaLancamento] = useState<{
    ids: number[];
    osIds: number[];
    tipo: "ENTRADA" | "SAIDA";
    descricao: string;
    valor: number;
  } | null>(null);

  const [eventoDialogOpen, setEventoDialogOpen] = useState(false);
  const [eventoTipo, setEventoTipo] = useState<"" | "PRODUTO" | "SERVICO" | "CONSUMO">("");
  const [eventoNatureza, setEventoNatureza] = useState<"RECEITA" | "DESPESA">("DESPESA");
  const [eventoDescricao, setEventoDescricao] = useState("");
  const [eventoDetalhe, setEventoDetalhe] = useState("");
  const [eventoValor, setEventoValor] = useState(0);
  const [salvandoEvento, setSalvandoEvento] = useState(false);

  const [receitaParaDespesa, setReceitaParaDespesa] = useState<{
    id: number;
    osId: number | null;
    vendaId: number | null;
    origem: "SERVICO" | "FRETE";
    servicoid?: number | null;
    descricao: string;
  } | null>(null);
  const [despesaVinculadaTitulo, setDespesaVinculadaTitulo] = useState("");
  const [despesaVinculadaDetalhe, setDespesaVinculadaDetalhe] = useState("");
  const [despesaVinculadaValor, setDespesaVinculadaValor] = useState(0);
  const [salvandoDespesaVinculada, setSalvandoDespesaVinculada] = useState(false);

  const [eventoEdicao, setEventoEdicao] = useState<{
    id: number;
    osId: number | null;
    descricao: string;
    detalhe: string;
    valor: number;
    natureza: "RECEITA" | "DESPESA";
    editarTextos: boolean;
    origem: string;
  } | null>(null);
  const [tituloEventoEdicao, setTituloEventoEdicao] = useState("");
  const [detalheEventoEdicao, setDetalheEventoEdicao] = useState("");
  const [valorSnapshotEdicao, setValorSnapshotEdicao] = useState(0);
  const [salvandoSnapshot, setSalvandoSnapshot] = useState(false);

  const [eventoConvertidoParaEditar, setEventoConvertidoParaEditar] = useState<{
    id: number;
    osId: number | null;
    descricao: string;
    detalhe: string;
    valor: number;
    natureza: "RECEITA" | "DESPESA";
    editarTextos: boolean;
    origem: string;
    transacaoId: number | null;
    lancamentoId: number | null;
    parcelas: number;
  } | null>(null);
  const [excluindoTransacaoEvento, setExcluindoTransacaoEvento] = useState(false);

  const [eventoExclusao, setEventoExclusao] = useState<{ id: number; osId: number | null } | null>(null);
  const [impactoExclusao, setImpactoExclusao] = useState<ImpactoExclusaoEvento | null>(null);
  const [carregandoImpactoExclusao, setCarregandoImpactoExclusao] = useState(false);
  const [motivoExclusao, setMotivoExclusao] = useState("");
  const [excluindoEvento, setExcluindoEvento] = useState(false);

  const [sincronizandoId, setSincronizandoId] = useState<number | null>(null);
  const [carregandoTransacaoId, setCarregandoTransacaoId] = useState<number | null>(null);
  const [transacaoEventoId, setTransacaoEventoId] = useState<number | undefined>();
  const [parcelasDoEvento, setParcelasDoEvento] = useState<{
    lancamentoId: number;
    descricao: string;
    parcelas: ParcelaDoLancamento[];
  } | null>(null);

  const selecionaveis = useMemo(
    () => linhas.filter((linha) => eventoSelecionavel(linha)),
    [linhas],
  );
  const selecionados = useMemo(
    () => new Set(catalogoSelecionados.keys()),
    [catalogoSelecionados],
  );
  const escolhidas = useMemo(
    () => [...catalogoSelecionados.values()],
    [catalogoSelecionados],
  );
  const totalSelecionado = useMemo(
    () => Math.round(escolhidas.reduce((soma, item) => soma + item.valor, 0) * 100) / 100,
    [escolhidas],
  );
  const osDaSelecao = useMemo(
    () => escolhidas.some((linha) => linha.vendaId != null) ? [] : [...new Set(escolhidas.map((linha) => linha.osId).filter((id): id is number => id != null))],
    [escolhidas],
  );

  const sairDoModoSelecao = useCallback(() => {
    setModoSelecao(false);
    setCatalogoSelecionados(new Map());
  }, []);

  // Busca, filtros e aba definem o conjunto. Paginar preserva as marcações.
  useEffect(() => {
    if (escopoSelecao !== undefined) sairDoModoSelecao();
  }, [escopoSelecao, sairDoModoSelecao]);

  // Atualiza o resumo das linhas selecionadas que estão na página e remove uma
  // que tenha deixado de ser elegível. IDs de outras páginas permanecem no
  // catálogo; o servidor ainda revalida todos sob lock no lançamento.
  useEffect(() => {
    const porId = new Map(linhas.map((linha) => [linha.id, linha]));
    setCatalogoSelecionados((atual) => {
      if (atual.size === 0) return atual;
      let mudou = false;
      const proximo = new Map(atual);
      for (const [id, linhaAtual] of porId) {
        if (!proximo.has(id)) continue;
        if (!eventoSelecionavel(linhaAtual)) {
          proximo.delete(id);
          mudou = true;
          continue;
        }
        const resumo = resumirEventoSelecionavel(linhaAtual);
        const anterior = proximo.get(id);
        if (
          anterior?.osId !== resumo.osId
          || anterior?.descricao !== resumo.descricao
          || anterior?.valor !== resumo.valor
        ) {
          proximo.set(id, resumo);
          mudou = true;
        }
      }
      return mudou ? proximo : atual;
    });
  }, [linhas]);

  const alternarSelecao = useCallback((linha: LinhaDeEvento) => {
    if (
      !catalogoSelecionados.has(linha.id)
      && catalogoSelecionados.size >= LIMITE_SELECAO_EVENTOS
    ) {
      toast.error(`Selecione no máximo ${LIMITE_SELECAO_EVENTOS} despesas por lançamento.`);
      return;
    }

    setCatalogoSelecionados((atual) => {
      const proximo = new Map(atual);
      if (proximo.has(linha.id)) proximo.delete(linha.id);
      else proximo.set(linha.id, resumirEventoSelecionavel(linha));
      return proximo;
    });
  }, [catalogoSelecionados]);

  const recarregar = useCallback(async () => {
    await onChanged();
  }, [onChanged]);

  async function selecionarTodosDoFiltro() {
    if (!carregarSelecionaveisDoFiltro) return;
    setCarregandoTodos(true);
    try {
      const resultado = await carregarSelecionaveisDoFiltro();
      if (resultado.total === 0) {
        setCatalogoSelecionados(new Map());
        toast.info("Nenhuma despesa elegível neste filtro.");
        return;
      }
      if (resultado.total > resultado.limite || resultado.eventos.length !== resultado.total) {
        throw new Error(
          `Refine o filtro para selecionar no máximo ${resultado.limite} despesas.`,
        );
      }

      setCatalogoSelecionados(
        new Map(resultado.eventos.map((evento) => [evento.id, evento])),
      );
    } catch (error: any) {
      toast.error(error?.message || "Erro ao selecionar as despesas do filtro.");
    } finally {
      setCarregandoTodos(false);
    }
  }

  /**
   * A descrição padrão do boleto.
   *
   * Com uma OS só ela nomeia a ordem, como sempre nomeou. Atravessando ordens,
   * nomear uma delas seria mentira — o que identifica o pagamento é quantas
   * despesas ele cobre.
   */
  function descricaoDoLancamento(
    escolhidasAgora: Array<Pick<EventoSelecionavelResumido, "descricao">>,
    osIds: number[],
  ) {
    if (escolhidasAgora.length === 1) return escolhidasAgora[0].descricao;
    if (osIds.length === 1) return `Despesas da OS #${osIds[0]} (${escolhidasAgora.length} lançamentos)`;
    return `Despesas de OS e vendas (${escolhidasAgora.length} lançamentos)`;
  }

  function lancarSelecao() {
    if (escolhidas.length === 0) return;
    const ids = escolhidas.map((linha) => linha.id).sort((a, b) => a - b);
    setEventoParaLancamento({
      ids,
      osIds: osDaSelecao,
      tipo: "SAIDA",
      valor: totalSelecionado,
      descricao: descricaoDoLancamento(escolhidas, osDaSelecao),
    });
  }

  async function adicionarEventoAvulso() {
    if (!documentoUnico || !podeCriar) return;
    setSalvandoEvento(true);
    try {
      const alvo = endpoints.criar(documentoUnico);
      const response = await fetch(alvo.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...alvo.corpoExtra,
          natureza: eventoNatureza,
          tipo: eventoTipo,
          descricao: eventoDescricao,
          detalhe: eventoDetalhe,
          valor: eventoValor,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao adicionar evento");
      setEventoDialogOpen(false);
      setEventoTipo("");
      setEventoDescricao("");
      setEventoDetalhe("");
      setEventoValor(0);
      toast.success("Evento financeiro registrado.");
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao adicionar evento");
    } finally {
      setSalvandoEvento(false);
    }
  }

  function abrirDespesaVinculada(linha: LinhaDeEvento) {
    if (linha.osId == null && linha.vendaId == null) return;
    const origem = linha.origem === "FRETE" ? "FRETE" : "SERVICO";
    setReceitaParaDespesa({
      id: linha.id,
      osId: linha.osId,
      vendaId: linha.vendaId ?? null,
      origem,
      servicoid: linha.servicoid,
      descricao: linha.descricao,
    });
    if (origem === "FRETE") {
      setDespesaVinculadaTitulo("Despesa de frete");
    } else {
      const nomeServico = linha.descricao.replace(/^Serviço\s*-\s*/i, "").trim();
      setDespesaVinculadaTitulo(nomeServico ? `Despesa - ${nomeServico}` : "Despesa do serviço");
    }
    setDespesaVinculadaDetalhe("");
    setDespesaVinculadaValor(0);
  }

  async function adicionarDespesaVinculada() {
    if (!receitaParaDespesa) return;
    setSalvandoDespesaVinculada(true);
    try {
      const alvo = receitaParaDespesa.vendaId != null
        ? endpoints.criarDespesaVenda?.(receitaParaDespesa.vendaId)
        : receitaParaDespesa.osId != null ? endpoints.criar({ tipo: "ORDEM_SERVICO", id: receitaParaDespesa.osId }) : null;
      if (!alvo) throw new Error("Documento da despesa não encontrado.");
      const response = await fetch(alvo.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...alvo.corpoExtra,
          natureza: "DESPESA",
          descricao: despesaVinculadaTitulo,
          detalhe: despesaVinculadaDetalhe,
          valor: despesaVinculadaValor,
          eventoReceitaId: receitaParaDespesa.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const origem = receitaParaDespesa.origem === "FRETE" ? "frete" : "serviço";
      if (!response.ok) throw new Error(payload?.error || `Erro ao adicionar despesa ao ${origem}`);
      setReceitaParaDespesa(null);
      setDespesaVinculadaTitulo("");
      setDespesaVinculadaDetalhe("");
      setDespesaVinculadaValor(0);
      toast.success(`Despesa vinculada ao ${origem}.`);
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao adicionar despesa vinculada");
    } finally {
      setSalvandoDespesaVinculada(false);
    }
  }

  function fecharExclusaoEvento() {
    if (excluindoEvento) return;
    setEventoExclusao(null);
    setImpactoExclusao(null);
    setMotivoExclusao("");
    setCarregandoImpactoExclusao(false);
  }

  async function abrirExclusaoEvento(linha: LinhaDeEvento) {
    setEventoExclusao({ id: linha.id, osId: linha.osId });
    setImpactoExclusao(null);
    setMotivoExclusao("");
    setCarregandoImpactoExclusao(true);
    try {
      const response = await fetch(endpoints.evento(linha.id, linha.osId), { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao analisar a exclusão");
      setImpactoExclusao(payload.impacto as ImpactoExclusaoEvento);
    } catch (error: any) {
      setEventoExclusao(null);
      setImpactoExclusao(null);
      setMotivoExclusao("");
      toast.error(error?.message || "Erro ao analisar a exclusão do evento");
    } finally {
      setCarregandoImpactoExclusao(false);
    }
  }

  async function excluirEventoFinanceiro() {
    if (!eventoExclusao || !impactoExclusao?.podeExcluir) return;
    setExcluindoEvento(true);
    try {
      const response = await fetch(endpoints.evento(eventoExclusao.id, eventoExclusao.osId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoExclusao }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.impacto) setImpactoExclusao(payload.impacto as ImpactoExclusaoEvento);
        throw new Error(payload?.error || "Erro ao excluir evento financeiro");
      }
      const devolveuEstoque = payload?.resultado?.estoque_devolvido === true;
      setEventoExclusao(null);
      setImpactoExclusao(null);
      setMotivoExclusao("");
      toast.success(
        devolveuEstoque
          ? "Evento excluído e item devolvido ao estoque."
          : "Evento financeiro excluído.",
      );
      if (payload?.aviso) toast.info(payload.aviso);
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao excluir evento financeiro");
    } finally {
      setExcluindoEvento(false);
    }
  }

  /**
   * O que precisa ser desfeito para o evento voltar a ser editável.
   *
   * No vínculo direto é a própria transação. No boleto em grupo não existe "a"
   * transação — são N parcelas —, então o alvo é o lançamento.
   */
  function vinculoDaLinha(linha: LinhaDeEvento) {
    const parcelas =
      linha.lancamentoId == null
        ? 0
        : (transacoesConhecidas ?? []).filter(
            (transacao) => transacao.lancamento_id === linha.lancamentoId,
          ).length;
    return {
      transacaoId: linha.transacaoId ? Number(linha.transacaoId) : null,
      lancamentoId: linha.lancamentoId == null ? null : Number(linha.lancamentoId),
      parcelas,
    };
  }

  async function visualizarTransacaoDoEvento(linha: LinhaDeEvento) {
    const vinculo = vinculoDaLinha(linha);

    if (vinculo.transacaoId != null) {
      setParcelasDoEvento(null);
      setTransacaoEventoId(vinculo.transacaoId);
      return;
    }
    if (vinculo.lancamentoId == null) {
      toast.error("Este evento consta como lançado, mas não possui uma transação financeira vinculada.");
      return;
    }

    setCarregandoTransacaoId(linha.id);
    try {
      const response = await fetch(`/api/lancamento-de-eventos/${vinculo.lancamentoId}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível localizar a transação financeira vinculada.");
      }

      const parcelas: ParcelaDoLancamento[] = Array.isArray(payload?.data?.parcelas)
        ? payload.data.parcelas
            .map((parcela: any) => ({
              id: Number(parcela.id),
              descricao: String(parcela.descricao || `Transação #${parcela.id}`),
              valor: Number(parcela.valor || 0),
              data: String(parcela.data || ""),
              vencimento_em: parcela.vencimento_em ? String(parcela.vencimento_em) : null,
              pendente: Boolean(parcela.pendente),
              pago_em: parcela.pago_em ? String(parcela.pago_em) : null,
            }))
            .filter((parcela: { id: number }) => Number.isSafeInteger(parcela.id) && parcela.id > 0)
        : [];

      if (parcelas.length === 0) {
        throw new Error("O lançamento vinculado não possui transações financeiras ativas.");
      }
      if (parcelas.length === 1) {
        setParcelasDoEvento(null);
        setTransacaoEventoId(parcelas[0].id);
        return;
      }
      setParcelasDoEvento({
        lancamentoId: vinculo.lancamentoId,
        descricao: String(payload?.data?.descricao || `Lançamento #${vinculo.lancamentoId}`),
        parcelas,
      });
    } catch (error: any) {
      toast.error(error?.message || "Erro ao visualizar a transação financeira");
    } finally {
      setCarregandoTransacaoId(null);
    }
  }

  function abrirEdicao(linha: LinhaDeEvento) {
    if (!permissoes.podeEditar || !capacidadesDoEvento(linha).editar) return;
    if (linha.status === "CONVERTIDO" || linha.transacaoId != null || linha.lancamentoId != null) {
      if (!(permissoes.podeDesfazerLancamento ?? permissoes.podeExcluir)) {
        toast.error("É necessária permissão de exclusão financeira para desfazer o lançamento antes de editar.");
        return;
      }
      const vinculo = vinculoDaLinha(linha);
      if (!vinculo.transacaoId && !vinculo.lancamentoId) {
        toast.error("O lançamento vinculado não foi localizado.");
        return;
      }
      setEventoConvertidoParaEditar({
        id: linha.id,
        osId: linha.osId,
        descricao: linha.descricao,
        detalhe: linha.detalhe,
        valor: linha.valor,
        natureza: linha.natureza,
        editarTextos: capacidadesDoEvento(linha).editarTextos,
        origem: linha.origem,
        transacaoId: vinculo.transacaoId,
        lancamentoId: vinculo.lancamentoId,
        parcelas: vinculo.parcelas,
      });
      return;
    }
    setEventoEdicao({
      id: linha.id,
      osId: linha.osId,
      descricao: linha.descricao,
      detalhe: linha.detalhe,
      valor: linha.valor,
      natureza: linha.natureza,
      editarTextos: capacidadesDoEvento(linha).editarTextos,
      origem: linha.origem,
    });
    setTituloEventoEdicao(linha.descricao);
    setDetalheEventoEdicao(linha.detalhe);
    setValorSnapshotEdicao(linha.valor);
  }

  async function excluirTransacaoEEditarEvento() {
    if (!eventoConvertidoParaEditar || !permissoes.podeEditar
      || !(permissoes.podeDesfazerLancamento ?? permissoes.podeExcluir)) return;
    setExcluindoTransacaoEvento(true);
    try {
      // Boleto em grupo some por inteiro; transação avulsa, sozinha. As guardas
      // de parcela paga e de OS finalizada vivem no servidor, então uma recusa
      // aqui já chega com a mensagem certa.
      const alvo = eventoConvertidoParaEditar.lancamentoId
        ? `/api/lancamento-de-eventos/${eventoConvertidoParaEditar.lancamentoId}`
        : `/api/transaction/${eventoConvertidoParaEditar.transacaoId}`;
      const response = await fetch(alvo, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao desfazer o lançamento vinculado");
      const evento = eventoConvertidoParaEditar;
      setEventoConvertidoParaEditar(null);
      setEventoEdicao({
        id: evento.id,
        osId: evento.osId,
        descricao: evento.descricao,
        detalhe: evento.detalhe,
        valor: evento.valor,
        origem: evento.origem,
        natureza: evento.natureza,
        editarTextos: evento.editarTextos,
      });
      setTituloEventoEdicao(evento.descricao);
      setDetalheEventoEdicao(evento.detalhe);
      setValorSnapshotEdicao(evento.valor);
      toast.success("Transação excluída. O evento está disponível para edição e novo lançamento.");
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao excluir a transação vinculada");
    } finally {
      setExcluindoTransacaoEvento(false);
    }
  }

  async function salvarSnapshot() {
    if (!eventoEdicao) return;
    setSalvandoSnapshot(true);
    try {
      const response = await fetch(endpoints.evento(eventoEdicao.id, eventoEdicao.osId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valor: valorSnapshotEdicao,
          // Comissão manda só o valor: título e detalhe dela são gerados pela
          // sincronização ("Comissao - <serviço>" e o nome do realizador), e o
          // diálogo nem oferece os campos. Reenviá-los gravaria o texto achatado
          // que a lista usa por padrão quando o detalhe é nulo.
          ...(eventoEdicao.editarTextos
            ? { descricao: tituloEventoEdicao, detalhe: detalheEventoEdicao }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao alterar snapshot");
      setEventoEdicao(null);
      // O aviso vem do servidor quando a competência do evento é de um mês já
      // encerrado: a alteração recalculou a DRE daquele período.
      toast.success(
        eventoEdicao.origem === "COMISSAO" ? "Comissão corrigida."
          : eventoEdicao.editarTextos ? "Evento financeiro atualizado." : "Valor do snapshot atualizado.",
        { description: payload?.aviso || undefined, duration: payload?.aviso ? 8000 : undefined },
      );
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao alterar snapshot");
    } finally {
      setSalvandoSnapshot(false);
    }
  }

  async function sincronizar(linha: LinhaDeEvento, caminho: string, rotulo: string) {
    setSincronizandoId(linha.id);
    try {
      const response = await fetch(`${endpoints.evento(linha.id, linha.osId)}/${caminho}`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Erro ao sincronizar ${rotulo}`);
      toast.success(`Sincronização concluída: ${rotulo}.`);
      await recarregar();
    } catch (error: any) {
      toast.error(error?.message || `Erro ao sincronizar ${rotulo}`);
    } finally {
      setSincronizandoId(null);
    }
  }

  const quantidadeSelecionaveis = totalSelecionaveis ?? selecionaveis.length;
  const todosDoFiltroSelecionados =
    quantidadeSelecionaveis > 0 && escolhidas.length === quantidadeSelecionaveis;

  function renderLinha(linha: LinhaDeEvento) {
    const podeAdicionarDespesa = linha.tipo === "ENTRADA" && linha.status === "ATIVO"
      && (linha.vendaId != null
        ? permissoes.podeLancar && Boolean(endpoints.criarDespesaVenda) && linha.origem === "FRETE"
        : permissoes.podeEditar && linha.osId != null
          && (linha.origem === "FRETE" || (linha.origem === "SERVICO" && Boolean(linha.servicoid))));
    const capacidades = capacidadesDoEvento(linha);
    const podeEditarLinha = permissoes.podeEditar && capacidades.editar;
    const temVinculoFinanceiro = linha.status === "CONVERTIDO" || linha.transacaoId != null || linha.lancamentoId != null;
    const bloqueioEdicao = !permissoes.podeEditar ? "Requer permissão para editar eventos financeiros."
      : temVinculoFinanceiro && !(permissoes.podeDesfazerLancamento ?? permissoes.podeExcluir)
        ? "Requer exclusão financeira para desfazer o lançamento antes de editar." : null;
    const podeExcluirLinha = permissoes.podeExcluir && capacidades.excluir;
    const mostrarContextoDaOs = osIdUnica == null && vendaIdUnica == null;

    const cliente = linha.ordem?.cliente?.nomerazaosocial || linha.venda?.cliente?.nomerazaosocial;
    const documento = linha.vendaId != null ? `Venda #${linha.vendaId}` : linha.osId != null ? `OS #${linha.osId}` : "Sem documento";
    const origem = ({ COMISSAO: "Comissão", PRODUTO: "Produto", SERVICO: "Serviço", AVULSO: "Avulso", DESCONTO: "Desconto", FRETE: "Frete", CONSUMO: "Consumo", ENTRADA_FISCAL: "Entrada fiscal" } as Record<string, string>)[linha.origem] || linha.origem;
    const situacao = linha.status === "CONVERTIDO" ? "Lançado" : linha.podeGerarTransacao ? "A lançar" : "Automático";
    const classeSituacao = linha.status === "CONVERTIDO"
      ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : linha.podeGerarTransacao
        ? "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300"
        : "border-border bg-muted/50 text-muted-foreground";
    const temAcoes = capacidades.editar || (linha.produtoid && onVisualizarProduto)
      || podeAdicionarDespesa
      || linha.status === "CONVERTIDO"
      || (permissoes.podeEditar && capacidades.origemDaOs && (capacidades.sincronizarSnapshot || linha.origem === "FRETE" || linha.origem === "SERVICO"))
      || (permissoes.podeLancar && linha.podeGerarTransacao && linha.status === "ATIVO")
      || podeExcluirLinha;

    return (
      <div
        key={linha.id}
        data-evento-id={linha.id}
        data-documento={documento}
        className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 transition-colors lg:items-center ${mostrarContextoDaOs ? "lg:grid-cols-[minmax(0,1fr)_160px_106px_136px_32px]" : "lg:grid-cols-[minmax(0,1fr)_106px_136px_32px]"} ${selecionados.has(linha.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}
      >
        <div className="col-span-2 flex min-w-0 items-start gap-3 pr-9 lg:col-span-1 lg:pr-0">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${modoSelecao ? "bg-muted/50" : linha.tipo === "ENTRADA" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"}`}>
            {modoSelecao ? (
              <Checkbox checked={selecionados.has(linha.id)} disabled={!eventoSelecionavel(linha)} onCheckedChange={() => alternarSelecao(linha)} aria-label={`Selecionar ${linha.descricao}`} title={motivoNaoSelecionavel(linha)} />
            ) : linha.tipo === "ENTRADA" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]" title={linha.descricao}>{linha.descricao}</p>
            <p className="truncate text-xs text-muted-foreground" title={linha.detalhe}>{linha.detalhe}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span>{origem}</span>
              {linha.dataEvento ? <><span aria-hidden="true">·</span><time dateTime={linha.dataEvento}>{new Date(linha.dataEvento).toLocaleDateString("pt-BR")}</time></> : null}
              {linha.isManual && linha.criadoPorNome ? <><span aria-hidden="true">·</span><span>Por {linha.criadoPorNome}</span></> : null}
              {linha.comissaoAjustada ? <Badge variant="outline" className="text-[10px]">Comissão ajustada</Badge> : null}
              {linha.competenciaFechada ? <span title="Evento de competência anterior. Alterar o valor recalcula a DRE daquele período.">· Competência anterior</span> : null}
            </div>
            {mostrarContextoDaOs && linha.osId != null ? (
              <p className="text-xs text-muted-foreground">
                {linha.ordem?.execucao_fim_em ? (
                  <>Conclusão da OS: <time dateTime={linha.ordem.execucao_fim_em}>{new Date(linha.ordem.execucao_fim_em).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}</time></>
                ) : "Sem data de conclusão"}
              </p>
            ) : null}
            {mostrarContextoDaOs ? <p className="text-xs text-muted-foreground lg:hidden"><span className="font-medium text-foreground">{documento}</span>{cliente ? ` · ${cliente}` : ""}</p> : null}
          </div>
        </div>
        {mostrarContextoDaOs ? (
          <div className="hidden min-w-0 space-y-1 lg:block">
            <Badge variant="outline" className={linha.vendaId != null ? "border-violet-500/20 bg-violet-500/5 font-medium text-violet-700 dark:text-violet-300" : "bg-muted/40 font-medium"}>{documento}</Badge>
            <p className="truncate text-xs text-muted-foreground" title={cliente || undefined}>{cliente || "Cliente não informado"}</p>
          </div>
        ) : null}
        <div className="col-start-1 lg:col-start-auto">
          <Badge variant="outline" className={`gap-1.5 whitespace-nowrap px-2 py-1 text-[11px] font-medium ${classeSituacao}`} title={situacao === "Automático" ? "Compõe o resultado; não precisa gerar um título no financeiro." : situacao === "Lançado" ? "Título criado no financeiro. Consulte a transação para verificar o pagamento." : "Despesa disponível para lançar no financeiro."}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{situacao}
          </Badge>
        </div>
        <div className="col-start-2 row-start-2 text-right lg:col-start-auto lg:row-start-auto">
          <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${linha.tipo === "ENTRADA" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
            {linha.tipo === "ENTRADA" ? "+" : "−"} {fmtMoney(linha.valor)}
          </span>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{linha.tipo === "ENTRADA" ? "Receita" : "Despesa"}</p>
        </div>
        <div className="absolute right-3 top-3 flex items-center justify-end lg:static">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Ações de ${linha.descricao}`}
                disabled={modoSelecao || !temAcoes}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {capacidades.editar ? (
                <DropdownMenuItem disabled={!podeEditarLinha || Boolean(bloqueioEdicao)} onSelect={() => abrirEdicao(linha)}>
                  <Pencil />{" "}
                  {linha.origem === "COMISSAO"
                    ? "Corrigir valor da comissão"
                    : capacidades.editarTextos ? "Editar evento financeiro" : linha.tipo === "SAIDA"
                      ? "Editar despesa"
                      : "Editar valor do lançamento"}
                </DropdownMenuItem>
              ) : null}
              {capacidades.editar && bloqueioEdicao ? (
                <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">
                  {bloqueioEdicao}
                </DropdownMenuLabel>
              ) : null}
              {linha.produtoid && onVisualizarProduto ? (
                <DropdownMenuItem onSelect={() => onVisualizarProduto(linha.produtoid!)}>
                  <Eye /> Visualizar produto
                </DropdownMenuItem>
              ) : null}
              {/*
                "Lançado" é o único estado em que existe transação para abrir. O
                vínculo pode ser direto (transacaoid) ou pelo grupo do boleto
                (lancamento_id) — quem resolve isso é `visualizarTransacaoDoEvento`.
              */}
              {linha.status === "CONVERTIDO" ? (
                <DropdownMenuItem
                  disabled={carregandoTransacaoId === linha.id}
                  onSelect={() => void visualizarTransacaoDoEvento(linha)}
                >
                  {carregandoTransacaoId === linha.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ExternalLink />
                  )}
                  Visualizar transação
                </DropdownMenuItem>
              ) : null}
              {podeAdicionarDespesa ? (
                <DropdownMenuItem onSelect={() => abrirDespesaVinculada(linha)}>
                  <ArrowDown />{" "}
                  {linha.origem === "FRETE"
                    ? "Adicionar despesa de frete"
                    : "Adicionar despesa ao serviço"}
                </DropdownMenuItem>
              ) : null}
              {capacidades.origemDaOs && linha.origem === "FRETE" && linha.tipo === "ENTRADA" ? (
                <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">
                  Para remover esta receita, edite o orçamento da OS e zere o frete.
                </DropdownMenuLabel>
              ) : null}
              {permissoes.podeEditar && capacidades.sincronizarSnapshot && linha.tipo === "SAIDA" ? (
                <DropdownMenuItem
                  disabled={sincronizandoId === linha.id}
                  onSelect={() => void sincronizar(linha, "sincronizar-ultimo-custo", "custo do produto")}
                >
                  <RefreshCw className={sincronizandoId === linha.id ? "animate-spin" : ""} />
                  Sincronizar custo do produto
                </DropdownMenuItem>
              ) : null}
              {permissoes.podeEditar && capacidades.sincronizarSnapshot && linha.tipo === "ENTRADA" ? (
                <DropdownMenuItem
                  disabled={sincronizandoId === linha.id}
                  onSelect={() => void sincronizar(linha, "sincronizar-valor-venda", "valor de venda")}
                >
                  <RefreshCw className={sincronizandoId === linha.id ? "animate-spin" : ""} />
                  Sincronizar valor de venda
                </DropdownMenuItem>
              ) : null}
              {permissoes.podeLancar && linha.podeGerarTransacao && linha.status === "ATIVO" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setEventoParaLancamento({
                      ids: [linha.id],
                      osIds: linha.osId == null ? [] : [linha.osId],
                      tipo: linha.tipo,
                      descricao: linha.descricao,
                      valor: linha.valor,
                    })
                  }
                >
                  Lançar no financeiro
                </DropdownMenuItem>
              ) : null}
              {podeExcluirLinha ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void abrirExclusaoEvento(linha)}
                >
                  <Trash2 /> Excluir evento
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  const cabecalhoDaTabela = (
    <div className={`hidden gap-4 border-b bg-muted/40 px-4 py-3 text-[11px] font-medium text-muted-foreground lg:grid ${osIdUnica == null && vendaIdUnica == null ? "grid-cols-[minmax(0,1fr)_160px_106px_136px_32px]" : "grid-cols-[minmax(0,1fr)_106px_136px_32px]"}`}>
      <span>Evento</span>
      {osIdUnica == null && vendaIdUnica == null ? <span>Documento / cliente</span> : null}
      <span>Situação</span>
      <span className="text-right">Valor</span>
      <span className="sr-only">Ações</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {podeCriar || permissoes.podeEditar || permissoes.podeLancar ? (
        <div className={`flex flex-wrap items-center justify-end gap-2 rounded-lg border p-3 ${modoSelecao ? "border-primary/20 bg-primary/5" : "bg-muted/20"}`}>
          {modoSelecao ? (
            <>
              <p className="mr-auto text-sm text-muted-foreground">
                {escolhidas.length} de {quantidadeSelecionaveis} despesa(s)
                {escolhidas.length > 0 ? ` · ${fmtMoney(totalSelecionado)}` : null}
              </p>
              {carregarSelecionaveisDoFiltro ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    carregandoTodos
                    || quantidadeSelecionaveis === 0
                    || todosDoFiltroSelecionados
                  }
                  onClick={() => void selecionarTodosDoFiltro()}
                >
                  {carregandoTodos ? <Loader2 className="animate-spin" /> : <ListChecks />}
                  {todosDoFiltroSelecionados ? "Todos selecionados" : "Selecionar todos do filtro"}
                </Button>
              ) : null}
              <Button type="button" size="sm" disabled={escolhidas.length === 0} onClick={lancarSelecao}>
                Lançar selecionadas
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={sairDoModoSelecao}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <p className="mr-auto text-xs text-muted-foreground">{quantidadeSelecionaveis} despesa(s) disponível(is) para lançamento</p>
              {permissoes.podeLancar ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={false}
                  disabled={quantidadeSelecionaveis === 0}
                  title={
                    quantidadeSelecionaveis === 0
                      ? "Nenhuma despesa disponível para lançar."
                      : "Selecionar despesas para lançar juntas no financeiro"
                  }
                  onClick={() => setModoSelecao(true)}
                >
                  <ListChecks /> Selecionar despesas
                </Button>
              ) : null}
              {acoesExtras}
              {podeCriar && documentoUnico ? (
                <Button type="button" size="sm" onClick={() => setEventoDialogOpen(true)}>
                  Novo lançamento
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {linhas.length === 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {vazio ?? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum lançamento disponível.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {cabecalhoDaTabela}
          <div className="divide-y">{linhas.map(renderLinha)}</div>
        </div>
      )}

      {eventoParaLancamento ? (
        <TransactionDialog
          key={eventoParaLancamento.ids.join("-")}
          open
          setOpen={(nextOpen) => {
            if (!nextOpen) setEventoParaLancamento(null);
          }}
          // Com uma OS só o diálogo continua sabendo de qual ordem se trata.
          // Atravessando ordens não há resposta, e o campo fica de fora.
          osId={eventoParaLancamento.osIds.length === 1 ? eventoParaLancamento.osIds[0] : undefined}
          handleGetTransactions={() => void recarregar()}
          internalCompanyExpense={eventoParaLancamento.tipo === "SAIDA"}
          lockValue
          // Despesa vai pelo lançamento em grupo — é o caminho que aceita boleto
          // parcelado e várias despesas num pagamento só. Receita continua no
          // vínculo direto de sempre.
          lancamentoDeEventos={
            eventoParaLancamento.tipo === "SAIDA"
              ? {
                  ordemServicoId:
                    eventoParaLancamento.osIds.length === 1
                      ? eventoParaLancamento.osIds[0]
                      : undefined,
                  eventosIds: eventoParaLancamento.ids,
                  onConcluido: () => sairDoModoSelecao(),
                }
              : undefined
          }
          initialTransaction={{
            ...(eventoParaLancamento.tipo === "ENTRADA"
              ? { evento_financeiro_id: eventoParaLancamento.ids[0] }
              : {}),
            tipo:
              eventoParaLancamento.tipo === "ENTRADA"
                ? Tipo_transacao.RECEITA
                : Tipo_transacao.DESPESA,
            descricao: eventoParaLancamento.descricao,
            valor: eventoParaLancamento.valor,
            valorLiquido: eventoParaLancamento.valor,
            pendente: true,
            parcelas: 1,
            data: new Date(),
          }}
        />
      ) : null}

      {/*
        Sem `editable`, o mesmo diálogo do fluxo de caixa abre em consulta, com o
        selo "Somente leitura" — evita uma segunda tela de transação só para olhar.
      */}
      {transacaoEventoId != null ? (
        <TransactionDialog
          key={`transacao-do-evento-${transacaoEventoId}`}
          open
          setOpen={(nextOpen) => {
            if (!nextOpen) setTransacaoEventoId(undefined);
          }}
          selectedTransactionId={transacaoEventoId}
          setSelectedTransactionId={setTransacaoEventoId}
          handleGetTransactions={() => void recarregar()}
        />
      ) : null}

      {/*
        Boleto parcelado do terceirizado: o evento aponta para o grupo, não para
        uma parcela. Abrir uma delas por conta própria mostraria um valor que não
        é o da despesa.
      */}
      <Dialog open={parcelasDoEvento != null} onOpenChange={(aberto) => !aberto && setParcelasDoEvento(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transações deste lançamento</DialogTitle>
            <DialogDescription>
              {parcelasDoEvento?.descricao} — {parcelasDoEvento?.parcelas.length} parcela(s). Escolha
              qual abrir.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(parcelasDoEvento?.parcelas ?? []).map((parcela, indice) => (
              <button
                key={parcela.id}
                type="button"
                onClick={() => {
                  setParcelasDoEvento(null);
                  setTransacaoEventoId(parcela.id);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left transition hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {indice + 1}/{parcelasDoEvento?.parcelas.length} · {parcela.descricao}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {parcela.vencimento_em
                      ? `Vence em ${fmtDate(parcela.vencimento_em)}`
                      : parcela.data
                        ? fmtDate(parcela.data)
                        : "Sem data"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{fmtMoney(parcela.valor)}</p>
                  <Badge variant="outline" className="mt-0.5 text-[10px]">
                    {parcela.pendente ? "Em aberto" : "Baixada"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={eventoExclusao != null}
        onOpenChange={(aberto) => !aberto && fecharExclusaoEvento()}
      >
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {carregandoImpactoExclusao
                ? "Analisando a exclusão..."
                : impactoExclusao?.podeExcluir
                  ? "Excluir este evento financeiro?"
                  : "Este evento não pode ser excluído"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-left">
                {carregandoImpactoExclusao ? (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="size-4 animate-spin" />
                    Verificando estoque, DRE e vínculos financeiros.
                  </div>
                ) : impactoExclusao ? (
                  <>
                    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-2">
                      <span>
                        <strong className="text-foreground">Evento:</strong> {impactoExclusao.descricao}
                      </span>
                      <span>
                        <strong className="text-foreground">Valor:</strong> {fmtMoney(impactoExclusao.valor)}
                      </span>
                      <span>
                        <strong className="text-foreground">Origem/Natureza:</strong>{" "}
                        {impactoExclusao.origem} ·{" "}
                        {impactoExclusao.natureza === "RECEITA" ? "Receita" : "Despesa"}
                      </span>
                      <span>
                        <strong className="text-foreground">Competência:</strong>{" "}
                        {impactoExclusao.competenciaEm
                          ? fmtDate(impactoExclusao.competenciaEm)
                          : "Ainda não definida"}
                      </span>
                    </div>
                    {impactoExclusao.bloqueio ? (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                        {impactoExclusao.bloqueio}
                      </div>
                    ) : null}
                    <div>
                      <p className="font-medium text-foreground">O que acontecerá:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {impactoExclusao.efeitos.map((efeito) => (
                          <li key={efeito}>{efeito}</li>
                        ))}
                      </ul>
                    </div>
                    {impactoExclusao.exigeMotivo && impactoExclusao.podeExcluir ? (
                      <label className="block font-medium text-foreground">
                        Motivo da devolução ao estoque
                        <textarea
                          className="mt-1 min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm font-normal"
                          value={motivoExclusao}
                          onChange={(evento) => setMotivoExclusao(evento.target.value)}
                          placeholder="Explique por que este consumo está sendo excluído"
                          disabled={excluindoEvento}
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoEvento}>
              {impactoExclusao?.podeExcluir ? "Cancelar" : "Fechar"}
            </AlertDialogCancel>
            {impactoExclusao?.podeExcluir ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={excluindoEvento || (impactoExclusao.exigeMotivo && !motivoExclusao.trim())}
                onClick={(evento) => {
                  evento.preventDefault();
                  void excluirEventoFinanceiro();
                }}
              >
                {excluindoEvento ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 size-4" />
                )}
                Excluir definitivamente
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={eventoDialogOpen} onOpenChange={setEventoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo evento financeiro</DialogTitle>
            <DialogDescription>
              Registre uma receita ou despesa manual e classifique-a como Produto, Serviço ou Consumo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-2xl bg-card p-4">
            <label className="block text-sm font-medium">
              Tipo
              <Select
                value={eventoTipo}
                onValueChange={(value) => {
                  const proximo = value as "PRODUTO" | "SERVICO" | "CONSUMO";
                  setEventoTipo(proximo);
                  // Só existe CONSUMO:DESPESA na DRE (linha 4.4, Materiais
                  // aplicados). Consumo que rende receita não é consumo.
                  if (proximo === "CONSUMO") setEventoNatureza("DESPESA");
                }}
              >
                <SelectTrigger className="mt-1 h-10 w-full" aria-label="Tipo"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRODUTO">Produto</SelectItem>
                  <SelectItem value="SERVICO">Serviço</SelectItem>
                  <SelectItem value="CONSUMO">Consumo (material de uso)</SelectItem>
                </SelectContent>
              </Select>
              {eventoTipo === "CONSUMO" ? (
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Material aplicado sem repasse ao cliente e sem movimentar o estoque.
                </span>
              ) : null}
            </label>
            <label className="block text-sm font-medium">
              Natureza
              <Select
                value={eventoNatureza}
                disabled={eventoTipo === "CONSUMO"}
                onValueChange={(value) => setEventoNatureza(value as "RECEITA" | "DESPESA")}
              >
                <SelectTrigger className="mt-1 h-10 w-full" aria-label="Natureza"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DESPESA">Despesa</SelectItem>
                  <SelectItem value="RECEITA">Receita</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block text-sm font-medium">
              Descrição
              <input
                className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                value={eventoDescricao}
                onChange={(e) => setEventoDescricao(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Detalhes
              <input
                className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                value={eventoDetalhe}
                onChange={(e) => setEventoDetalhe(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Valor
              <ValueInput price={eventoValor} setPrice={setEventoValor} className="mt-1 h-10 w-full" />
            </label>
            <Button
              className="w-full"
              disabled={
                salvandoEvento || !eventoTipo || !eventoDescricao.trim() || eventoValor <= 0
              }
              onClick={() => void adicionarEventoAvulso()}
            >
              {salvandoEvento ? "Salvando..." : "Registrar evento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(receitaParaDespesa)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !salvandoDespesaVinculada) setReceitaParaDespesa(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {receitaParaDespesa?.origem === "FRETE"
                ? "Adicionar despesa de frete"
                : "Adicionar despesa ao serviço"}
            </DialogTitle>
            <DialogDescription>
              {receitaParaDespesa?.origem === "FRETE"
                ? "Registre o custo pago à transportadora. A receita de frete e o valor cobrado do cliente não serão alterados."
                : `Esta despesa ficará vinculada a ${receitaParaDespesa?.descricao ?? "este serviço"} e será separada da comissão automática.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-2xl bg-card p-4">
            <label className="block text-sm font-medium">
              Título da despesa
              <input
                className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                value={despesaVinculadaTitulo}
                onChange={(event) => setDespesaVinculadaTitulo(event.target.value)}
                placeholder={
                  receitaParaDespesa?.origem === "FRETE" ? "Ex.: Transportadora" : "Ex.: Serviço terceirizado"
                }
              />
            </label>
            <label className="block text-sm font-medium">
              Detalhes
              <input
                className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                value={despesaVinculadaDetalhe}
                onChange={(event) => setDespesaVinculadaDetalhe(event.target.value)}
                placeholder="Informação complementar (opcional)"
              />
            </label>
            <label className="block text-sm font-medium">
              Valor
              <ValueInput
                price={despesaVinculadaValor}
                setPrice={setDespesaVinculadaValor}
                className="mt-1 h-10 w-full"
              />
            </label>
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {receitaParaDespesa?.origem === "FRETE"
                ? "Tipo: Frete · Natureza: Despesa · DRE: 4.6 — Serviços terceirizados diretos"
                : "Tipo: Serviço · Natureza: Despesa · DRE: Custo dos serviços prestados"}
            </div>
            <Button
              className="w-full"
              disabled={
                salvandoDespesaVinculada || !despesaVinculadaTitulo.trim() || despesaVinculadaValor <= 0
              }
              onClick={() => void adicionarDespesaVinculada()}
            >
              {salvandoDespesaVinculada
                ? "Salvando..."
                : receitaParaDespesa?.origem === "FRETE"
                  ? "Registrar despesa de frete"
                  : "Registrar despesa do serviço"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(eventoEdicao)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEventoEdicao(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {eventoEdicao?.origem === "COMISSAO"
                ? "Corrigir valor da comissão"
                : eventoEdicao?.editarTextos
                  ? "Editar evento financeiro"
                  : "Editar valor do lançamento"}
            </DialogTitle>
            <DialogDescription>
              {eventoEdicao?.origem === "COMISSAO"
                ? eventoEdicao?.descricao
                : eventoEdicao?.editarTextos
                  ? "Altere o título, a descrição e o valor deste evento financeiro."
                  : eventoEdicao?.descricao}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {eventoEdicao?.origem === "COMISSAO" ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                O valor da comissão é calculado pelo sistema (base × percentual do
                beneficiário). Corrigi-lo aqui congela o número: ele deixa de acompanhar o recálculo
                automático para esse beneficiário. A linha
                fica marcada como &quot;Comissão ajustada&quot;.
              </div>
            ) : null}
            {eventoEdicao?.editarTextos ? (
              <>
                <label className="block text-sm font-medium">
                  Título
                  <input
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                    value={tituloEventoEdicao}
                    onChange={(event) => setTituloEventoEdicao(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Descrição
                  <input
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                    value={detalheEventoEdicao}
                    onChange={(event) => setDetalheEventoEdicao(event.target.value)}
                    placeholder="Informação complementar (opcional)"
                  />
                </label>
              </>
            ) : null}
            <label className="block text-sm font-medium">
              Valor
              <div className="mt-1">
                <ValueInput price={valorSnapshotEdicao} setPrice={setValorSnapshotEdicao} />
              </div>
            </label>
            <Button
              className="w-full"
              disabled={
                salvandoSnapshot
                || (eventoEdicao?.editarTextos
                  && !tituloEventoEdicao.trim())
              }
              onClick={() => void salvarSnapshot()}
            >
              {salvandoSnapshot
                ? "Salvando..."
                : eventoEdicao?.origem === "COMISSAO"
                  ? "Corrigir comissão"
                  : eventoEdicao?.editarTextos
                    ? "Salvar alterações"
                    : "Salvar novo valor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(eventoConvertidoParaEditar)}
        onOpenChange={(open) => {
          if (!open && !excluindoTransacaoEvento) setEventoConvertidoParaEditar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {eventoConvertidoParaEditar?.lancamentoId
                ? "Desfazer o lançamento inteiro?"
                : "Excluir transação vinculada?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {eventoConvertidoParaEditar?.lancamentoId
                ? `Esta despesa foi lançada num pagamento${
                    eventoConvertidoParaEditar.parcelas > 1
                      ? ` de ${eventoConvertidoParaEditar.parcelas} parcelas`
                      : ""
                  } que pode cobrir outras despesas de OS ou vendas. Para alterar seus dados, o lançamento inteiro precisa ser desfeito: as parcelas somem e todas as despesas cobertas por ele voltam a previstas. Deseja continuar?`
                : "Este evento já foi lançado no financeiro. Para alterar seus dados, será necessário excluir a transação vinculada. Deseja continuar?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoTransacaoEvento}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluindoTransacaoEvento || !(permissoes.podeDesfazerLancamento ?? permissoes.podeExcluir)}
              onClick={(event) => {
                event.preventDefault();
                void excluirTransacaoEEditarEvento();
              }}
            >
              {excluindoTransacaoEvento ? "Excluindo..." : "Excluir e continuar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
