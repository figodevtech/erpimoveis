"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRealtimeTabelas } from "@/hooks/use-realtime-tabelas";

/** Módulo, não literal: um array novo a cada render reiniciaria a inscrição. */
const TABELAS_REALTIME = ["ordemservico"];

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ValueInput from "@/components/ui/value-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Loader,
  Loader2,
  Car,
  Plus,
  Package,
  AlertTriangle,
  Search,
  Send,
  UserRound,
  X,
  Wrench,
  LayoutGrid,
  List,
  Calendar,
  Clock,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { toast } from "@/lib/toast";

import type { StatusOS } from "./ordens-tabs";
import { LinkAprovacaoDialog } from "./dialogs/link-aprovacao-dialog";
import { OSDetalhesDialog } from "./dialogs/detalhes-os-dialog";
import { ChecklistDialog } from "./dialogs/checklist-dialog";
import { ChecklistEditDialog } from "./dialogs/checklist-edit-dialog";
import { RegistrarSaidaDialog } from "./dialogs/registrar-saida-dialog";
import {
  RealizadoresOSDialog,
  type AcaoRealizadoresOSDialog,
} from "./dialogs/realizadores-os-dialog";
import { statusClasses, prioClasses, fmtDate, fmtDuration, useNowTick, safeStatus } from "./ordens-utils";
import { estiloDestaque } from "@/lib/ordens/destaque";
import { useConfig } from "../../config-context";
import { informarCondicoesPagamentoOs } from "@/lib/ordens/financeiro";
import { RowActions } from "./row-actions";
import OsFinancialDialog from "../../(financeiro)/pagamentodeordens/components/osFinancialDialog/osFinancialDialog";
import OsStonePaymentDialog from "../../(financeiro)/pagamentodeordens/components/osStonePaymentDialog/osStonePaymentDialog";

import {
  OrdemComDatas,
  SortKey,
  SortDir,
  PrioFiltro,
  MAX_CLIENTE_CHARS,
  getTempoMs,
  SortableHeader,
  buildPolicy,
} from "./ordens-tabela-helpers";
import { OrdensFilterSheet } from "./ordens-filtros";
import { EmissaoNotaDialog } from "./dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { Label } from "@/components/ui/label";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import type { PaymentMethodOption, PlannedPayment } from "@/lib/payment-methods";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import {
  ImpactoExclusaoFinanceiraOs,
  useImpactoExclusaoFinanceiraOs,
} from "./dialogs/impacto-exclusao-financeira-os";

const MAX_ALVO_CHARS = 48;

/** Parâmetros que a listagem envia ao banco. Filtro e ordenação são server-side. */
type FetchParams = {
  statuses: StatusOS[];
  search: string;
  page: number;
  limit: number;
  apenasMinhas: boolean;
  prioFiltro: PrioFiltro;
  setorFiltro: string;
  alvoFiltro: "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO";
  /** Id de quem abriu a OS, ou TODOS. */
  responsavelFiltro: string;
  /** Id de quem executou algum serviço da OS, ou TODOS. */
  realizadorFiltro: string;
  somenteDestacadas: boolean;
  campoData: CampoData;
  dataInicio?: Date;
  dataFim?: Date;
  sortKey: SortKey;
  sortDir: SortDir;
};

/** Qual data o intervalo mede. */
type CampoData = "entrada" | "saida" | "concluido";

const SEM_FILTRO = "TODOS";

/** Dia local em YYYY-MM-DD (toISOString converteria para UTC e podia trocar o dia). */
function toDiaISO(date: Date) {
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mes}-${dia}`;
}

const formatCurrencyBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const moneyToCents = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100);

function getWhatsAppUrl(telefone?: string | null) {
  const digits = String(telefone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  const numero = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${numero}`;
}

type EstoqueInsuficienteItem = {
  id: number;
  titulo: string;
  disponivel: number;
  solicitado: number;
};

type EstoqueInsuficienteDialog = {
  osId: number;
  message: string;
  itens: EstoqueInsuficienteItem[];
};

// ------------------ COMPONENTE PRINCIPAL ------------------
export function OrdensTabela({
  statuses = [],
  onOpenOrcamento,
  onEditar,
  onNovaOS,
}: {
  statuses?: StatusOS[];
  onOpenOrcamento: (row: OrdemComDatas) => void;
  onEditar: (row: OrdemComDatas) => void;
  onNovaOS: () => void;
}) {
  const { data: session } = useSession();
  const {
    options: paymentMethodOptions,
    isLoading: isLoadingPaymentMethods,
    error: paymentMethodsError,
    reload: reloadPaymentMethods,
  } = usePaymentMethodOptions();
  const [rows, setRows] = useState<OrdemComDatas[]>([]);
  const [destaqueTooltipId, setDestaqueTooltipId] = useState<number | null>(null);
  const [usarPopoverDestaque, setUsarPopoverDestaque] = useState(false);

  // Regras de "destacar OS por status" vindas de Configurações Gerais.
  const config = useConfig();
  const regrasDestaque = config?.destaque_os_por_status ?? {};
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.ORDENS_CRIAR);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [localSearch, setLocalSearch] = useState("");

  const isFinalizadas = useMemo(
    () => statuses.includes("CONCLUIDO") || statuses.includes("SEM_COBRANCA") || statuses.includes("CANCELADO"),
    [statuses]
  );
  const defaultSortKey: SortKey = isFinalizadas ? "concluido" : "prioridade";

  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [filtroAberto, setFiltroAberto] = useState(false);
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const [prioFiltro, setPrioFiltro] = useState<PrioFiltro>("TODAS");
  const [setorFiltro, setSetorFiltro] = useState<string>("TODOS");
  const [alvoFiltro, setAlvoFiltro] = useState<"TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO">("TODOS");
  const [responsavelFiltro, setResponsavelFiltro] = useState<string>(SEM_FILTRO);
  const [realizadorFiltro, setRealizadorFiltro] = useState<string>(SEM_FILTRO);
  const [somenteDestacadas, setSomenteDestacadas] = useState(false);
  const [campoData, setCampoData] = useState<CampoData>("entrada");
  const [dataInicio, setDataInicioState] = useState<Date | undefined>();
  const [dataFim, setDataFimState] = useState<Date | undefined>();
  const [setoresApiOptions, setSetoresApiOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [pessoasOptions, setPessoasOptions] = useState<Array<{ value: string; label: string }>>([]);

  /**
   * "Minhas ordens" e o filtro de responsável são a mesma pergunta feita de dois
   * lugares: no banco viram a mesma coluna, e ligados juntos se anulariam.
   */
  function escolherResponsavel(valor: string) {
    setResponsavelFiltro(valor);
    if (valor !== SEM_FILTRO) setApenasMinhas(false);
  }

  function alternarApenasMinhas(valor: boolean) {
    setApenasMinhas(valor);
    if (valor) setResponsavelFiltro(SEM_FILTRO);
  }

  const [viewMode, setViewMode] = useState<"grid" | "table">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ordens_view_mode");
      if (saved === "grid" || saved === "table") return saved;
    }
    return "table";
  });

  const toggleViewMode = (mode: "grid" | "table") => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("ordens_view_mode", mode);
    }
  };

  const [isLoading, setIsLoading] = useState(true);
  const reqIdRef = useRef(0);
  // Quem acendeu a barra é quem a apaga. O contador acima é compartilhado com
  // as recargas silenciosas (realtime, `os:refresh`, destaque), que passam a
  // ser a requisição mais recente sem nunca mexer na barra — sem este segundo
  // ref, uma recarga silenciosa durante uma visível deixava a barra girando
  // para sempre, mesmo com as OS já na tela.
  const loadingReqIdRef = useRef(0);

  const now = useNowTick(5000);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const atualizarModoDestaque = () => setUsarPopoverDestaque(mediaQuery.matches);
    atualizarModoDestaque();
    mediaQuery.addEventListener("change", atualizarModoDestaque);
    return () => mediaQuery.removeEventListener("change", atualizarModoDestaque);
  }, []);

  const statusesKey = useMemo(() => (statuses?.length ? statuses.join("|") : ""), [statuses]);

  // Toda a filtragem/ordenação acontece no banco, então o realtime precisa repetir
  // exatamente os mesmos parâmetros — por isso tudo passa por este ref.
  const currentParamsRef = useRef<FetchParams>({
    statuses,
    search: "",
    page: 1,
    limit: 25,
    apenasMinhas: false,
    prioFiltro: "TODAS",
    setorFiltro: "TODOS",
    alvoFiltro: "TODOS",
    responsavelFiltro: SEM_FILTRO,
    realizadorFiltro: SEM_FILTRO,
    somenteDestacadas: false,
    campoData: "entrada",
    dataInicio: undefined,
    dataFim: undefined,
    sortKey: defaultSortKey,
    sortDir: "desc",
  });
  useEffect(() => {
    currentParamsRef.current = {
      statuses,
      search: localSearch,
      page,
      limit,
      apenasMinhas,
      prioFiltro,
      setorFiltro,
      alvoFiltro,
      responsavelFiltro,
      realizadorFiltro,
      somenteDestacadas,
      campoData,
      dataInicio,
      dataFim,
      sortKey,
      sortDir,
    };
  }, [
    statuses,
    localSearch,
    page,
    limit,
    apenasMinhas,
    prioFiltro,
    setorFiltro,
    alvoFiltro,
    responsavelFiltro,
    realizadorFiltro,
    somenteDestacadas,
    campoData,
    dataInicio,
    dataFim,
    sortKey,
    sortDir,
  ]);



  async function fetchNow(
    {
      statuses: sts,
      search: q,
      page: pg,
      limit: lm,
      apenasMinhas: somenteMinhas,
      prioFiltro: prio,
      setorFiltro: setor,
      alvoFiltro: alvo,
      responsavelFiltro: responsavel,
      realizadorFiltro: realizador,
      somenteDestacadas: destacadas,
      campoData: campoDaData,
      dataInicio: inicio,
      dataFim: fim,
      sortKey: ordenarPor,
      sortDir: ordenarDir,
    }: FetchParams,
    opts?: { silent?: boolean }
  ) {
    const myId = ++reqIdRef.current;
    const silent = !!opts?.silent;
    if (!silent) {
      loadingReqIdRef.current = myId;
      setIsLoading(true);
    }

    try {
      const url = new URL("/api/ordens", window.location.origin);

      if (sts.length === 1) {
        url.searchParams.set("status", sts[0]);
        url.searchParams.delete("statuses");
      } else if (sts.length > 1) {
        url.searchParams.set("statuses", sts.join(","));
        url.searchParams.delete("status");
      } else {
        url.searchParams.delete("status");
        url.searchParams.delete("statuses");
      }

      if (q?.trim()) url.searchParams.set("q", q.trim());
      else url.searchParams.delete("q");

      if (somenteMinhas) url.searchParams.set("apenasMinhas", "1");
      else url.searchParams.delete("apenasMinhas");

      if (prio && prio !== "TODAS") url.searchParams.set("prioridade", prio);
      if (setor && setor !== "TODOS") url.searchParams.set("setor", setor);
      if (alvo && alvo !== "TODOS") url.searchParams.set("alvoTipo", alvo);
      if (responsavel && responsavel !== SEM_FILTRO) url.searchParams.set("responsavel", responsavel);
      if (realizador && realizador !== SEM_FILTRO) url.searchParams.set("realizador", realizador);
      if (destacadas) url.searchParams.set("destacadas", "1");
      if (inicio) url.searchParams.set("dateFrom", toDiaISO(inicio));
      if (fim) url.searchParams.set("dateTo", toDiaISO(fim));
      // Só acompanha o intervalo: sozinho não recorta nada.
      if (inicio || fim) url.searchParams.set("campoData", campoDaData);

      if (ordenarPor) {
        url.searchParams.set("sort", ordenarPor);
        url.searchParams.set("dir", ordenarDir);
      }

      url.searchParams.set("page", String(pg));
      url.searchParams.set("limit", String(lm));

      const r = await fetch(url.toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({} as any));

      if (myId !== reqIdRef.current) return;

      if (!r.ok) {
        toast.error(j?.error || "Falha ao carregar as ordens");
        setRows([]);
        setTotalPages(1);
        setTotal(0);
        return;
      }

      const items: OrdemComDatas[] = Array.isArray(j.items) ? j.items : [];
      setRows(items);

      const apiTotal = Number(j.total ?? j.totalItems ?? 0);
      const safeTotal = Number.isFinite(apiTotal) ? apiTotal : items.length;
      setTotal(safeTotal);

      const apiTotalPages = Number(j.totalPages ?? 0);
      const safeTotalPages =
        Number.isFinite(apiTotalPages) && apiTotalPages > 0 ? apiTotalPages : Math.max(1, Math.ceil(safeTotal / lm));

      setTotalPages(safeTotalPages);

      if (pg > safeTotalPages) setPage(safeTotalPages);
    } catch (err: any) {
      if (myId !== reqIdRef.current) return;
      if (err?.name !== "AbortError") toast.error(err?.message || "Erro ao carregar as ordens");
      setRows([]);
      setTotalPages(1);
      setTotal(0);
    } finally {
      // Só a última carga visível apaga a barra: uma visível mais nova ainda
      // está em curso e continua dona dela.
      if (!silent && myId === loadingReqIdRef.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => fetchNow(currentParamsRef.current), 300);
    return () => clearTimeout(t);
  }, [
    statusesKey,
    localSearch,
    page,
    limit,
    apenasMinhas,
    prioFiltro,
    setorFiltro,
    alvoFiltro,
    responsavelFiltro,
    realizadorFiltro,
    somenteDestacadas,
    campoData,
    dataInicio,
    dataFim,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    setPage(1);
    const initialSort: SortKey =
      statuses.includes("CONCLUIDO") || statuses.includes("SEM_COBRANCA") || statuses.includes("CANCELADO")
        ? "concluido"
        : "prioridade";
    setSortKey(initialSort);
    setSortDir("desc");
  }, [statuses, statusesKey]);

  useEffect(() => {
    setPage(1);
  }, [localSearch]);

  // Qualquer filtro novo recomeça na primeira página: a página atual pode nem existir
  // no resultado filtrado.
  useEffect(() => {
    setPage(1);
  }, [
    apenasMinhas,
    prioFiltro,
    setorFiltro,
    alvoFiltro,
    responsavelFiltro,
    realizadorFiltro,
    somenteDestacadas,
    campoData,
    dataInicio,
    dataFim,
  ]);

  useRealtimeTabelas(TABELAS_REALTIME, () => {
    void fetchNow(currentParamsRef.current, { silent: true });
  });

  const pageCount = rows.length;
  const start = limit * (page - 1) + (pageCount ? 1 : 0);
  const end = limit * (page - 1) + pageCount;

  useEffect(() => {
    async function loadSetores() {
      try {
        const r = await fetch("/api/tipos/setores?all=1", { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) return;
        const items = Array.isArray(j.items ?? j.data) ? j.items ?? j.data : [];
        const mapped = items
          .map((s: any) => ({
            value: s.id != null ? String(s.id) : "",
            label: s.nome || s.descricao || "Sem setor",
          }))
          .filter((s: any) => s.value);
        if (mapped.length) setSetoresApiOptions(mapped);
      } catch {
        // silencioso para nÇõo poluir com toast em caso de falha
      }
    }
    loadSetores();
  }, []);

  // Mesma lista que o diálogo de realizadores usa. Existe fora de /api/users
  // justamente porque quem opera a oficina não tem a permissão de Usuários.
  useEffect(() => {
    async function loadPessoas() {
      try {
        const r = await fetch("/api/ordens/realizadores", { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) return;
        const mapped = (Array.isArray(j.realizadores) ? j.realizadores : [])
          .map((u: any) => ({ value: String(u.id ?? ""), label: String(u.nome ?? "").trim() || "Sem nome" }))
          .filter((u: any) => u.value);
        if (mapped.length) setPessoasOptions(mapped);
      } catch {
        // silencioso: sem a lista, os dois seletores ficam só com "Todos"
      }
    }
    loadPessoas();
  }, []);

  const setoresFromRows = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      const id = (row as any).setor?.id ?? (row as any).setorid ?? (row as any).setorId;
      const nome =
        row.setor?.nome ?? (row as any).setor_nome ?? (row as any).setor?.descricao ?? (row as any).setorNome ?? "";
      const value = id != null ? String(id) : nome || "";
      if (value) map.set(value, nome || "Sem setor");
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const setoresOptions = useMemo(() => {
    if (setoresApiOptions.length > 0) return setoresApiOptions;
    return setoresFromRows;
  }, [setoresApiOptions, setoresFromRows]);

  const renderTempo = (r: OrdemComDatas) => {
    const ms = getTempoMs(r, now);
    if (!ms) return "-";
    return fmtDuration(ms);
  };

  // dialogs
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkRow, setLinkRow] = useState<OrdemComDatas | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<OrdemComDatas | null>(null);
  const confirmDestino = config?.habilitar_faturamento_os && confirmRow?.status === "PAGAMENTO"
    ? "FATURAMENTO" : "PAGAMENTO";
  const confirmCondicoes = informarCondicoesPagamentoOs(confirmDestino, config?.habilitar_faturamento_os === true);
  const [confirmPaymentMethods, setConfirmPaymentMethods] = useState<
    PaymentMethodOption[]
  >([]);
  const [confirmPaymentAmounts, setConfirmPaymentAmounts] = useState<
    Partial<Record<PaymentMethodOption, number>>
  >({});
  const [confirmPaymentInstallments, setConfirmPaymentInstallments] = useState<
    Partial<Record<PaymentMethodOption, number>>
  >({});
  const [confirmPaymentMethodsOpen, setConfirmPaymentMethodsOpen] = useState(false);
  const [confirmDescricaoFinanceiro, setConfirmDescricaoFinanceiro] = useState("");
  const [confirmGarantia, setConfirmGarantia] = useState("");
  // Preenchida no cadastro da OS e só reeditável aqui: depois do orçamento a
  // tela de edição sai do ar, e é neste momento que a recepção sabe o que a
  // nota precisa dizer.
  const [confirmObservacoesFiscais, setConfirmObservacoesFiscais] = useState("");
  const [confirmSaldoCents, setConfirmSaldoCents] = useState<number | null>(null);
  const [loadingConfirmSaldo, setLoadingConfirmSaldo] = useState(false);
  const [confirmCondicoesOriginais, setConfirmCondicoesOriginais] = useState<string | null>(null);
  const [erroConfirmSaldo, setErroConfirmSaldo] = useState(false);
  // Trava de envio dos diálogos de transição. Fica aqui, e não dentro de
  // `setStatus`, porque o aviso de realizadores só cobre as etapas que exigem
  // executor: a ida para faturamento não passa por ele e ficaria sem retorno
  // nenhum na tela enquanto o PUT corre.
  const [enviandoStatus, setEnviandoStatus] = useState(false);
  const assinaturaCondicoes = (methods: string[], amounts: Partial<Record<string, number>>, installments: Partial<Record<string, number>>, descricao: string) =>
    JSON.stringify([methods.map(method => [method, amounts[method] ?? 0, installments[method] ?? null]), descricao]);

  const confirmTotalCents = confirmSaldoCents ?? moneyToCents(calculateFinancialTotal(
      confirmRow?.orcamentototal,
      confirmRow?.acrescimo_financeiro_tipo,
      confirmRow?.acrescimo_financeiro_valor,
    ));
  const confirmPaymentsTotalCents = confirmPaymentMethods.reduce(
    (totalCents, method) =>
      totalCents + moneyToCents(Number(confirmPaymentAmounts[method] ?? 0)),
    0,
  );
  const confirmPaymentMethodsLabel =
    confirmPaymentMethods.length === 0
      ? "Não informar"
      : paymentMethodOptions.filter((method) =>
          confirmPaymentMethods.includes(method.value),
        )
          .map((method) => method.label)
          .join(", ");

  // A observação fiscal é buscada em toda transição, e não só nas que coletam
  // condições: com o faturamento ligado, o encerramento da execução não pede
  // acordo nenhum e mesmo assim precisa trazer a observação para edição.
  useEffect(() => {
    if (!confirmOpen || !confirmRow?.id) {
      setConfirmSaldoCents(null);
      setLoadingConfirmSaldo(false);
      setErroConfirmSaldo(false);
      setConfirmCondicoesOriginais(null);
      setConfirmObservacoesFiscais("");
      return;
    }

    const controller = new AbortController();
    setLoadingConfirmSaldo(true);
    setErroConfirmSaldo(false);
    setConfirmCondicoesOriginais(null);
    void fetch(`/api/ordens/${confirmRow.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao consultar o saldo da OS.");
        if (controller.signal.aborted) return;
        setConfirmObservacoesFiscais(String(payload.os?.observacoes_fiscais ?? ""));
        if (!confirmCondicoes) return;
        setConfirmSaldoCents(
          moneyToCents(payload?.resumoFinanceiro?.saldoDisponivelParaLancamento ?? 0),
        );
        if (confirmDestino !== "FATURAMENTO") return;
        const previstos: Array<{ metodo: string; valor: number; parcelas?: number | null }> =
          Array.isArray(payload.os?.pagamentos_previstos) && payload.os.pagamentos_previstos.length
            ? payload.os.pagamentos_previstos
            : payload.os?.forma_pagamento
              ? [{ metodo: payload.os.forma_pagamento, valor: Number(payload?.resumoFinanceiro?.saldoDisponivelParaLancamento ?? 0), parcelas: payload.os.parcelas_pagamento }]
              : [];
        const methods = previstos.map(p => p.metodo);
        const amounts = Object.fromEntries(previstos.map(p => [p.metodo, Number(p.valor)]));
        const installments = Object.fromEntries(previstos.filter(p => p.parcelas != null).map(p => [p.metodo, Number(p.parcelas)]));
        const descricao = payload.os?.descricao_financeiro ?? "";
        setConfirmPaymentMethods(methods);
        setConfirmPaymentAmounts(amounts);
        setConfirmPaymentInstallments(installments);
        setConfirmDescricaoFinanceiro(descricao);
        if (previstos.length) setConfirmCondicoesOriginais(assinaturaCondicoes(methods, amounts, installments, descricao));
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        // Sem condições a informar não há o que travar: a transição segue, e
        // só a observação fiscal fica de fora desta vez.
        if (!confirmCondicoes) {
          toast.error("Não foi possível carregar a observação fiscal da OS.");
          return;
        }
        setErroConfirmSaldo(true);
        toast.error(error?.message || "Falha ao consultar o saldo da OS.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingConfirmSaldo(false);
      });

    return () => controller.abort();
  }, [confirmOpen, confirmRow?.id, confirmCondicoes, confirmDestino]);

  const toggleConfirmPaymentMethod = (method: PaymentMethodOption) => {
    setConfirmPaymentMethods((current) => {
      if (current.includes(method)) {
        setConfirmPaymentAmounts((amounts) => {
          const next = { ...amounts };
          delete next[method];
          return next;
        });
        setConfirmPaymentInstallments((installments) => {
          const next = { ...installments };
          delete next[method];
          return next;
        });
        return current.filter((item) => item !== method);
      }

      setConfirmPaymentAmounts((amounts) => ({
        ...amounts,
        [method]: current.length === 0 ? confirmTotalCents / 100 : 0,
      }));
      if (method === "CREDITO" || method === "BOLETO" || method === "PROMISSORIA") {
        setConfirmPaymentInstallments((installments) => ({
          ...installments,
          [method]: 1,
        }));
      }
      return [...current, method];
    });
  };

  const updateConfirmPaymentAmount = (
    method: PaymentMethodOption,
    value: number,
  ) => {
    const otherMethodsTotalCents = confirmPaymentMethods
      .filter((item) => item !== method)
      .reduce(
        (totalCents, item) =>
          totalCents + moneyToCents(Number(confirmPaymentAmounts[item] ?? 0)),
        0,
      );
    const maxCents = Math.max(0, confirmTotalCents - otherMethodsTotalCents);
    const nextCents = Math.min(Math.max(0, moneyToCents(value)), maxCents);

    setConfirmPaymentAmounts((current) => ({
      ...current,
      [method]: nextCents / 100,
    }));
  };

  const [payOpen, setPayOpen] = useState(false);
  const [payRow, setPayRow] = useState<OrdemComDatas | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<number | null>(null);

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistRow, setChecklistRow] = useState<OrdemComDatas | null>(null);
  const [saidaRow, setSaidaRow] = useState<OrdemComDatas | null>(null);

  const [stoneDialogOpen, setStoneDialogOpen] = useState(false);
  const [stoneDialogRow, setStoneDialogRow] = useState<OrdemComDatas | null>(null);

  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveRow, setApproveRow] = useState<OrdemComDatas | null>(null);

  const [emissaoId, setEmissaoId] = useState<number | null>(null);
  const [emissaoOpen, setEmissaoOpen] = useState(false);

  const [approvalToastId, setApprovalToastId] = useState<string | number | null>(null);

  useEffect(() => {
    return () => {
      if (approvalToastId != null) toast.dismiss(approvalToastId);
    };
  }, [approvalToastId]);

  // Guarda a OS e o que fazer depois que os executores forem definidos, para o
  // envio retomar de onde parou (inclusive com os pagamentos já informados).
  const [pendenciaRealizadores, setPendenciaRealizadores] = useState<{
    osId: number;
    acao: AcaoRealizadoresOSDialog;
  } | null>(null);
  // O dialog de pagamento precisa saber se foi a falta de executor que barrou o
  // envio: nesse caso ele sai da frente do seletor, em vez de manter o form.
  const barradoPorRealizadorRef = useRef(false);
  const [estoqueDialog, setEstoqueDialog] = useState<EstoqueInsuficienteDialog | null>(null);

  // ✅ Reset (confirm)
  const [resetOpen, setResetOpen] = useState(false);
  const [resetRow, setResetRow] = useState<OrdemComDatas | null>(null);

  // ✅ Cancelar (motivo obrigatório)
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelRow, setCancelRow] = useState<OrdemComDatas | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState("");

  // Finalizar sem cobrança
  const [noChargeOpen, setNoChargeOpen] = useState(false);
  const [noChargeRow, setNoChargeRow] = useState<OrdemComDatas | null>(null);
  const [noChargeMotivo, setNoChargeMotivo] = useState("");
  const impactoReset = useImpactoExclusaoFinanceiraOs(
    resetOpen ? resetRow?.id : null,
  );
  const impactoCancelamento = useImpactoExclusaoFinanceiraOs(
    cancelOpen ? cancelRow?.id : null,
  );
  const impactoSemCobranca = useImpactoExclusaoFinanceiraOs(
    noChargeOpen ? noChargeRow?.id : null,
  );

  const clearApprovalToast = () => {
    if (approvalToastId != null) {
      toast.dismiss(approvalToastId);
      setApprovalToastId(null);
    }
  };

  type ExtrasStatusOS = {
    formaPagamento?: PaymentMethodOption | null;
    parcelasPagamento?: number | null;
    pagamentosPrevistos?: PlannedPayment[];
    descricaoFinanceiro?: string | null;
    garantia?: string | null;
    observacoesFiscais?: string | null;
  };

  /**
   * Descreve a ação a retomar depois que os executores forem definidos.
   * `EM_ANDAMENTO` exige todos os serviços; `PAGAMENTO` também, porque é a
   * trava final das OS iniciadas pelo módulo de execução, onde o serviço fica
   * legitimamente sem realizador até o mecânico assumir.
   */
  function acaoRealizadoresPara(
    id: number,
    status: StatusOS,
    extras?: ExtrasStatusOS,
  ): AcaoRealizadoresOSDialog {
    const paraPagamento = status === "PAGAMENTO";

    return {
      rotulo: paraPagamento ? "Enviar para pagamento" : "Iniciar OS",
      rotuloComPendencias: paraPagamento ? "Salvar e enviar" : "Salvar e iniciar",
      aviso: paraPagamento
        ? "Selecione ao menos um executor para todos os serviços antes de enviar a OS para pagamento."
        : "Selecione ao menos um executor para todos os serviços antes de iniciar a OS.",
      executar: () => setStatus(id, status, extras),
    };
  }

  async function setStatus(
    id: number,
    status: StatusOS,
    extras?: ExtrasStatusOS,
  ): Promise<boolean> {
    const transicaoFaturamento = status === "FATURAMENTO" || (status === "PAGAMENTO" && rows.some(r => r.id === id && r.status === "FATURAMENTO"));
    const exigeRealizadores = !transicaoFaturamento && (status === "EM_ANDAMENTO" || status === "PAGAMENTO");

    const loadingToastId = exigeRealizadores
      ? toast.loading("Preparando atribuição de realizadores...", {
          description: "Verificando serviços da OS antes de continuar.",
          duration: Infinity,
        })
      : null;

    const closeLoading = () => {
      if (loadingToastId != null) toast.dismiss(loadingToastId);
    };

    const abrirSelecaoDeRealizadores = () => {
      barradoPorRealizadorRef.current = true;
      setPendenciaRealizadores({ osId: id, acao: acaoRealizadoresPara(id, status, extras) });
    };

    // Avulso pendente barra o início no backend. O único lugar para resolver é
    // o orçamento, então o aviso já leva até ele.
    const avisarAvulsosPendentes = (mensagem: string, toastId?: string | number | null) => {
      const row = rows.find((r) => r.id === id);
      toast.error(mensagem, {
        id: toastId ?? undefined,
        duration: 8000,
        action: row ? { label: "Abrir orçamento", onClick: () => onOpenOrcamento(row) } : undefined,
      });
    };

    barradoPorRealizadorRef.current = false;

    if (exigeRealizadores) {
      try {
        const r = await fetch(`/api/ordens/${id}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) throw new Error(j?.error || "Não foi possível validar realizadores da OS.");

        // Antes dos realizadores: atribuir todo mundo e só depois descobrir
        // que a OS não inicia é trabalho jogado fora.
        const avulsosPendentes = Array.isArray(j?.itensProdutoAvulso) ? j.itensProdutoAvulso.length : 0;
        if (status === "EM_ANDAMENTO" && avulsosPendentes > 0) {
          avisarAvulsosPendentes(
            `Existem ${avulsosPendentes} produto(s) avulso(s) pendente(s). Vincule ou cadastre esses produtos no orçamento antes de iniciar a OS.`,
            loadingToastId,
          );
          return false;
        }

        const itens = (j?.itensServico ?? []) as Array<{
          realizadores?: Array<{ id: string; nome: string | null }> | null;
          idusuariorealizador?: string | null;
        }>;

        const temSemRealizador = itens.some((it) => {
          if (Array.isArray(it.realizadores)) return it.realizadores.length === 0;
          return !it.idusuariorealizador;
        });

        if (temSemRealizador) {
          abrirSelecaoDeRealizadores();

          toast.error(
            status === "PAGAMENTO"
              ? "Antes de enviar para pagamento, selecione ao menos 1 realizador para todos os serviços da OS."
              : "Antes de iniciar, selecione ao menos 1 realizador para todos os serviços da OS.",
            { id: loadingToastId ?? undefined, duration: 4000 },
          );
          return false;
        }

        closeLoading();
      } catch (err: any) {
        abrirSelecaoDeRealizadores();

        toast.error(err?.message || "Não foi possível verificar os realizadores. Abra a seleção para conferir.", {
          id: loadingToastId ?? undefined,
          duration: 4000,
        });
        return false;
      }
    }

    try {
      const r = await fetch(`/api/ordens/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, transicaoFaturamento, ...extras }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        closeLoading();
        if (r.status === 409 && j?.codigo === "REALIZADORES_PENDENTES") {
          abrirSelecaoDeRealizadores();
          toast.error(j?.error || "Defina os realizadores dos serviços da OS.", { duration: 5000 });
          return false;
        }
        if (r.status === 409 && j?.codigo === "PRODUTOS_AVULSOS_PENDENTES") {
          avisarAvulsosPendentes(j?.error || "Existem produtos avulsos pendentes no orçamento.");
          return false;
        }
        if (r.status === 409 && Array.isArray(j?.itens)) {
          setEstoqueDialog({
            osId: id,
            message: j?.error || "Produtos do orçamento sem estoque suficiente.",
            itens: j.itens.map((item: any) => ({
              id: Number(item.id),
              titulo: String(item.titulo ?? `Produto #${item.id}`),
              disponivel: Number(item.disponivel ?? 0),
              solicitado: Number(item.solicitado ?? 0),
            })),
          });
          return false;
        }
        toast.error(j?.error || "Falha ao atualizar status");
        return false;
      }

      closeLoading();
      window.dispatchEvent(new CustomEvent("os:refresh"));
      toast.success("Status atualizado");
      return true;
    } catch (e: any) {
      closeLoading();
      toast.error(e?.message || "Falha ao atualizar status");
      return false;
    }
  }

  async function handleSendToApproval(row: OrdemComDatas) {
    const loadingId = toast(`Validando orçamento da OS ${row.id}...`, {
      duration: Infinity,
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    });
    setApprovalToastId(loadingId);

    const fail = (msg: string) => {
      toast.dismiss(loadingId);
      setApprovalToastId(null);
      toast.error(msg, { duration: 4000 });
    };

    try {
      const r = await fetch(`/api/ordens/${row.id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) return fail(j?.error || "Não foi possível verificar o orçamento da OS.");

      const os = j?.os ?? {};
      if (!os?.cliente?.id && !j?.cliente?.id) {
        return fail("Selecione um cliente antes de enviar a OS para aprovação.");
      }

      const alvoTipo = String(os?.alvo_tipo ?? row.alvo_tipo ?? "VEICULO").toUpperCase();
      if (alvoTipo === "VEICULO" && !os?.veiculo?.id && !j?.veiculo?.id) {
        return fail("Selecione um veículo antes de enviar a OS para aprovação.");
      }
      if (alvoTipo === "PECA" && !os?.peca?.id && !j?.peca?.id) {
        return fail("Selecione uma peça antes de enviar a OS para aprovação.");
      }
      if (
        alvoTipo === "EQUIPAMENTO" &&
        !String(os?.equipamento?.nome ?? os?.equipamento_nome ?? "").trim()
      ) {
        return fail("Informe a máquina/equipamento antes de enviar a OS para aprovação.");
      }

      const itensServico = Array.isArray(j?.itensServico) ? j.itensServico : [];
      if (itensServico.length === 0) {
        return fail("Não é possível enviar para aprovação sem ao menos 1 serviço no orçamento.");
      }

      setApproveRow(row);
      setApproveDialogOpen(true);

      toast("Orçamento validado. Revise e confirme o envio para aprovação.", {
        id: loadingId,
        duration: Infinity,
      });
    } catch (err: any) {
      return fail(err?.message || "Não foi possível verificar o orçamento da OS.");
    }
  }

  // ✅ Reset UI (confirma)
  function handleResetOS(row: OrdemComDatas) {
    setResetRow(row);
    setResetOpen(true);
  }

  // ✅ Reset reaproveitando endpoint existente de status
  async function doResetOS(id: number, transacoesFinanceirasEsperadas: string[]) {
    const tId = toast.loading(`Reiniciando OS #${id}...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ORCAMENTO", transacoesFinanceirasEsperadas }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao reiniciar OS");

      toast.success("OS reiniciada (voltou para ORCAMENTO)", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reiniciar OS", { id: tId, duration: 4000 });
      return false;
    }
  }

  // ✅ Cancelar UI (motivo)
  function handleCancelarOS(row: OrdemComDatas) {
    setCancelRow(row);
    setCancelMotivo("");
    setCancelOpen(true);
  }

  async function doCancelarOS(
    id: number,
    motivo: string,
    transacoesFinanceirasEsperadas: string[],
  ) {
    const tId = toast.loading(`Cancelando OS #${id}...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/cancelar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo, transacoesFinanceirasEsperadas }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao cancelar OS");

      toast.success("OS cancelada", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Falha ao cancelar OS", { id: tId, duration: 4000 });
      return false;
    }
  }

  // Finalizar sem cobrança
  function handleFinishNoCharge(row: OrdemComDatas) {
    setNoChargeRow(row);
    setNoChargeMotivo("");
    setNoChargeOpen(true);
  }

  async function doFinishNoCharge(
    id: number,
    motivo: string,
    transacoesFinanceirasEsperadas: string[],
  ) {
    const tId = toast.loading(`Finalizando OS #${id} sem cobrança...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "SEM_COBRANCA",
          semCobranca: true,
          motivoSemCobranca: motivo,
          transacoesFinanceirasEsperadas,
        }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao finalizar sem cobrança");

      toast.success("OS finalizada sem cobrança", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Falha ao finalizar sem cobrança", { id: tId, duration: 4000 });
      return false;
    }
  }

  const handleSetDataInicio = (date?: Date) => {
    if (!date) return setDataInicioState(undefined);
    if (dataFim && date > dataFim) setDataFimState(date);
    setDataInicioState(date);
  };

  const handleSetDataFim = (date?: Date) => {
    if (!date) return setDataFimState(undefined);
    if (dataInicio && date < dataInicio) setDataFimState(date);
    setDataFimState(date);
  };

  const handleLimparFiltros = () => {
    setPrioFiltro("TODAS");
    setSetorFiltro("TODOS");
    setAlvoFiltro("TODOS");
    setResponsavelFiltro(SEM_FILTRO);
    setRealizadorFiltro(SEM_FILTRO);
    setSomenteDestacadas(false);
    setCampoData("entrada");
    setDataInicioState(undefined);
    setDataFimState(undefined);
    setApenasMinhas(false);
  };

  const handleSortChange = (key: SortKey, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  };

  return (
    <TooltipProvider>
      <Card className="min-w-0 max-w-full overflow-hidden bg-card">
        <CardHeader className="min-w-0 border-b-2 pb-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle>Ordens de Serviço</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <button
                  onClick={() => fetchNow(currentParamsRef.current)}
                  className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
                >
                  <span>Recarregar</span>
                  <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
                </button>
              </CardDescription>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
              <div className="relative hidden md:block w-[280px] lg:w-[360px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  placeholder="Buscar... (#ID, @lacre)"
                  title="Digite para buscar. #14 procura o ID exato; @A1B2 procura só pelo lacre da peça."
                  className="pl-8 pr-9"
                />
                {localSearch?.length > 0 && (
                  <button
                    type="button"
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setLocalSearch("")}
                    aria-label="Limpar busca"
                    title="Limpar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Alternador de Visualização Cards / Tabela */}
              <div className="flex items-center rounded-xl border border-border p-0.5 bg-muted/30 shrink-0">
                <Button
                  type="button"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => toggleViewMode("grid")}
                  className="h-8 w-8 rounded-lg hover:cursor-pointer"
                  title="Visualização em Cards"
                  aria-label="Visualização em Cards"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => toggleViewMode("table")}
                  className="h-8 w-8 rounded-lg hover:cursor-pointer"
                  title="Visualização em Tabela"
                  aria-label="Visualização em Tabela"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={apenasMinhas ? "default" : "outline"}
                    size="sm"
                    className="shrink-0 gap-1.5 hover:cursor-pointer"
                    aria-pressed={apenasMinhas}
                    onClick={() => alternarApenasMinhas(!apenasMinhas)}
                  >
                    <UserRound className="h-4 w-4" />
                    <span className="hidden lg:inline">Minhas Ordens de Serviço</span>
                    <span className="hidden sm:inline lg:hidden">Minhas OS</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {apenasMinhas ? "Exibindo apenas minhas OS (clique para ver todas)" : "Filtrar apenas minhas OS"}
                  </p>
                </TooltipContent>
              </Tooltip>

              <OrdensFilterSheet
                open={filtroAberto}
                onOpenChange={setFiltroAberto}
                prioFiltro={prioFiltro}
                setPrioFiltro={setPrioFiltro}
                setorFiltro={setorFiltro}
                setSetorFiltro={setSetorFiltro}
                setores={setoresOptions}
                alvoFiltro={alvoFiltro}
                setAlvoFiltro={setAlvoFiltro}
                pessoas={pessoasOptions}
                responsavelFiltro={responsavelFiltro}
                setResponsavelFiltro={escolherResponsavel}
                realizadorFiltro={realizadorFiltro}
                setRealizadorFiltro={setRealizadorFiltro}
                somenteDestacadas={somenteDestacadas}
                setSomenteDestacadas={setSomenteDestacadas}
                campoData={campoData}
                setCampoData={setCampoData}
                dataInicio={dataInicio}
                dataFim={dataFim}
                onSetInicio={handleSetDataInicio}
                onSetFim={handleSetDataFim}
                onLimpar={handleLimparFiltros}
              />

              {canCreate ? (
                <Button onClick={onNovaOS} size="sm" className="shrink-0 whitespace-nowrap hover:cursor-pointer">
                  <Plus className="h-4 w-4 mr-1" />
                  <span>Nova OS</span>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 min-w-0 md:hidden">
            <div className="relative w-full">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Buscar... (#ID, @lacre)"
                title="Digite para buscar. #14 procura o ID exato; @A1B2 procura só pelo lacre da peça."
                className="pl-8 pr-9"
              />
              {localSearch?.length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setLocalSearch("")}
                  aria-label="Limpar busca"
                  title="Limpar"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative -mt-[24px] min-h-[300px] min-w-0 px-3 pb-4 pt-0 sm:px-4">
          <div
            className={`${
              isLoading && " opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
          >
            <div
              className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
                isLoading && "animate-slideIn "
              } `}
            />
          </div>

          <AnimatePresence mode="wait">
            {viewMode === "grid" ? (
              <motion.div
                key="grid-view"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 bg-muted/20 p-2 sm:p-3 rounded-2xl border border-border/40"
              >
                {rows.map((r) => {
                  const st = safeStatus(r.status) as StatusOS;
                  const clienteNome = r.cliente?.nome ?? "—";
                  const whatsappUrl = getWhatsAppUrl(r.cliente?.telefone);

                  const clienteFull = clienteNome || "—";
                  const veiculoStr = r.veiculo
                    ? `${r.veiculo.marca ?? ""} ${r.veiculo.modelo ?? ""} - ${r.veiculo.placa ?? ""}`.trim()
                    : "";

                  const isPeca = (r as any).alvo_tipo === "PECA" || (r as any).alvoTipo === "PECA";
                  const isEquipamento =
                    (r as any).alvo_tipo === "EQUIPAMENTO" ||
                    (r as any).alvoTipo === "EQUIPAMENTO";
                  const pecaTitulo = (r as any)?.peca?.titulo as string | undefined;
                  const pecaDesc = (r as any)?.peca?.descricao as string | undefined;
                  // O lacre acompanha a peça na linha: é por ele que se procura
                  // a OS (@lacre), e sem ele na tela não dá para conferir.
                  const pecaLacre = (r as any)?.peca?.lacre as string | undefined;
                  const pecaStr = isPeca
                    ? [pecaTitulo || pecaDesc || "Peça", pecaLacre ? `Lacre ${pecaLacre}` : null]
                        .filter(Boolean)
                        .join(" — ")
                    : "";
                  const equipamento = (r as any)?.equipamento;
                  const equipamentoStr = isEquipamento
                    ? [
                        equipamento?.nome,
                        equipamento?.patrimonio
                          ? `Patrimônio ${equipamento.patrimonio}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" — ") || "Equipamento"
                    : "";

                  const alvoStr = isPeca ? pecaStr : isEquipamento ? equipamentoStr : veiculoStr;
                  const descFull = r.descricao || "—";
                  const policy = buildPolicy(st);
                  const dataEntradaFmt = fmtDate((r as any).dataEntrada ?? (r as any).dataentrada);
                  const dataSaidaRaw = (r as any).dataSaida ?? (r as any).datasaida;
                  const isSaidaConcluida = ["PAGAMENTO", "FATURAMENTO", "CONCLUIDO", "SEM_COBRANCA"].includes(String(r.status ?? "").toUpperCase());
                  // O destaque manual é a palavra final: quem marcou a OS à mão
                  // sabe de algo que a regra do status não sabe.
                  const regraDestaque = regrasDestaque[st];
                  const destaqueManual = Boolean(r.destacada);
                  const temDestaque = destaqueManual || Boolean(regraDestaque);
                  const destaqueTexto = destaqueManual
                    ? r.destaque_motivo || null
                    : regraDestaque?.texto ?? null;
                  // Uma regra só-cor não ganha ícone: um alerta "motivo não
                  // informado" em toda OS do status seria puro ruído.
                  const mostrarIconeDestaque = destaqueManual || Boolean(destaqueTexto);
                  const destaqueTitulo = destaqueManual ? "OS destacada" : "Destaque por status";
                  const estilo = estiloDestaque(destaqueManual ? r.destaque_cor : regraDestaque?.cor);

                  return (
                    <div
                      key={r.id}
                      onDoubleClick={() => {
                        setDetailsId(r.id);
                        setDetailsOpen(true);
                      }}
                      className={`group relative flex h-full flex-col justify-between rounded-sm border p-4 sm:p-5 transition-colors shadow-sm hover:shadow-md cursor-pointer select-none ${
                        temDestaque
                          ? estilo.card
                          : "bg-card border-slate-300 dark:border-slate-700/80 hover:border-primary/60 dark:hover:border-primary/50"
                      }`}
                    >
                      {/* Topo do Card */}
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono text-xs font-bold px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700">
                              #{r.id}
                            </Badge>
                            {r.setor?.nome ? (
                              <Badge variant="outline" className="text-[11px] bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30 font-semibold px-2 py-0.5">
                                {r.setor.nome}
                              </Badge>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className={`${statusClasses[st] ?? ""} text-[11px] px-2 py-0.5`}>
                              {st.replaceAll("_", " ")}
                            </Badge>
                            {mostrarIconeDestaque ? (
                              usarPopoverDestaque ? (
                                <Popover
                                  open={destaqueTooltipId === r.id}
                                  onOpenChange={(aberto) =>
                                    setDestaqueTooltipId((atual) =>
                                      aberto ? r.id : atual === r.id ? null : atual,
                                    )
                                  }
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className={`inline-flex size-7 touch-manipulation items-center justify-center rounded-sm outline-none ${estilo.icone}`}
                                      aria-label={`${destaqueTitulo}: ${destaqueTexto || "motivo não informado"}`}
                                    >
                                      <AlertTriangle className={`h-4 w-4 ${estilo.iconeFill}`} />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="end" side="bottom" className="w-64">
                                    <p className="font-semibold text-xs">{destaqueTitulo}</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                                      {destaqueTexto || "Motivo não informado."}
                                    </p>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className={`inline-flex size-7 items-center justify-center rounded-md outline-none ${estilo.icone}`}
                                      aria-label={`${destaqueTitulo}: ${destaqueTexto || "motivo não informado"}`}
                                    >
                                      <AlertTriangle className={`h-4 w-4 ${estilo.iconeFill}`} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="font-semibold text-xs">{destaqueTitulo}</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-xs">
                                      {destaqueTexto || "Motivo não informado."}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              )
                            ) : null}
                          </div>
                        </div>

                        {/* Cliente & WhatsApp */}
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-semibold text-sm sm:text-base text-foreground leading-snug whitespace-normal break-words" title={clienteFull}>
                              {clienteFull}
                            </h3>
                            {r.migracaoReferencia ? (
                              <span className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                                Migrada
                              </span>
                            ) : null}
                            {whatsappUrl ? (
                              <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 dark:bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 transition-colors shadow-2xs mt-0.5"
                                title="Abrir conversa no WhatsApp"
                              >
                                <Send className="h-3 w-3" />
                                <span>WhatsApp</span>
                              </a>
                            ) : null}
                          </div>

                          {/* Alvo / Veículo / Peça / Equipamento */}
                          {alvoStr ? (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                              {isPeca ? (
                                <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                              ) : isEquipamento ? (
                                <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                              ) : (
                                <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                              )}
                              <span className="truncate">{alvoStr}</span>
                            </div>
                          ) : null}
                        </div>

                        {/* Descrição da OS */}
                        {descFull ? (
                          <div className="h-20 w-full overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 p-2.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words scrollbar-thin">
                            {descFull}
                          </div>
                        ) : null}

                        {/* Prioridade & Tempo Duração */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground text-[11px]">Prioridade:</span>
                            {r.prioridade ? (
                              <Badge className={`${prioClasses[(r.prioridade || "").toUpperCase()] ?? ""} text-[10px] px-1.5 py-0`}>
                                {r.prioridade}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>{renderTempo(r)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Rodapé do Card: Datas & Ações */}
                      <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2">
                        <div className="flex flex-wrap items-center justify-between text-[11px] text-muted-foreground gap-2">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground/70" />
                            <span>Entrada: <strong className="font-medium text-foreground">{dataEntradaFmt}</strong></span>
                          </span>

                          {isFinalizadas && ((r as any).finalizadoEm ?? (r as any).finalizado_em) ? (
                            <span>
                              Finalizado: <strong className="font-medium text-foreground">{fmtDate((r as any).finalizadoEm ?? (r as any).finalizado_em)}</strong>
                            </span>
                          ) : null}

                          <span>
                            Saída: {dataSaidaRaw ? (
                              <strong className="font-medium text-foreground">{fmtDate(dataSaidaRaw)}</strong>
                            ) : isSaidaConcluida ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                Não registrada
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>

                        {/* Ações Row */}
                        <div className="flex items-center justify-end pt-1">
                          <RowActions
                            row={r}
                            policy={policy}
                            onOpenOrcamento={onOpenOrcamento}
                            onEditar={onEditar}
                            setStatus={setStatus}
                            onSendToApproval={handleSendToApproval}
                            onResetOS={handleResetOS}
                            onCancelarOS={handleCancelarOS}
                            onFinalizeNoCharge={handleFinishNoCharge}
                            setLinkRow={setLinkRow}
                            setLinkDialogOpen={setLinkDialogOpen}
                            setConfirmRow={setConfirmRow}
                            setConfirmOpen={setConfirmOpen}
                            setPayRow={setPayRow}
                            setPayOpen={setPayOpen}
                            setDetailsId={setDetailsId}
                            setDetailsOpen={setDetailsOpen}
                            setChecklistRow={setChecklistRow}
                            setChecklistOpen={setChecklistOpen}
                            setStoneRow={setStoneDialogRow}
                            setStoneOpen={setStoneDialogOpen}
                            setEmissaoId={setEmissaoId}
                            setEmissaoOpen={setEmissaoOpen}
                            onRegistrarSaida={setSaidaRow}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!isLoading && rows.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground rounded-2xl border border-dashed p-6 bg-card">
                    Nenhuma Ordem de Serviço encontrada.
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="table-view"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="mt-6 min-w-0 max-w-full overflow-hidden rounded-md border"
              >
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[40px]">#</TableHead>
                  <TableHead className="min-w-[240px]">Cliente / Veículo</TableHead>
                  <TableHead className="min-w-[220px]">Descrição</TableHead>

                  <TableHead className="min-w-[100px]">
                    <SortableHeader label="Entrada" columnKey="entrada" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

                  {isFinalizadas ? (
                    <TableHead className="min-w-[110px]">
                      <SortableHeader label="Finalizado em" columnKey="concluido" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                    </TableHead>
                  ) : null}

                  <TableHead className="min-w-[100px]">
                    <SortableHeader label="Saída" columnKey="saida" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

                  <TableHead className="min-w-[120px]">
                    <SortableHeader label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

                  <TableHead className="min-w-[120px]">
                    <SortableHeader label="Prioridade" columnKey="prioridade" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

                  <TableHead className="min-w-[70px]">
                    <SortableHeader label="Tempo Duração" columnKey="tempo" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

                  <TableHead className="min-w-[70px] text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((r) => {
                    const st = safeStatus(r.status) as StatusOS;
                    const clienteNome = r.cliente?.nome ?? "—";
                    const whatsappUrl = getWhatsAppUrl(r.cliente?.telefone);

                    const clienteFull = clienteNome || "—";
                    const clienteShort =
                      clienteFull.length > MAX_CLIENTE_CHARS ? `${clienteFull.slice(0, MAX_CLIENTE_CHARS - 1)}…` : clienteFull;

                    const veiculoStr = r.veiculo
                      ? `${r.veiculo.marca ?? ""} ${r.veiculo.modelo ?? ""} - ${r.veiculo.placa ?? ""}`.trim()
                      : "";

                    const isPeca = (r as any).alvo_tipo === "PECA" || (r as any).alvoTipo === "PECA";
                    const isEquipamento =
                      (r as any).alvo_tipo === "EQUIPAMENTO" ||
                      (r as any).alvoTipo === "EQUIPAMENTO";
                    const pecaTitulo = (r as any)?.peca?.titulo as string | undefined;
                    const pecaDesc = (r as any)?.peca?.descricao as string | undefined;
                    // O lacre acompanha a peça na linha: é por ele que se procura
                    // a OS (@lacre), e sem ele na tela não dá para conferir.
                    const pecaLacre = (r as any)?.peca?.lacre as string | undefined;
                    const pecaStr = isPeca
                      ? [pecaTitulo || pecaDesc || "Peça", pecaLacre ? `Lacre ${pecaLacre}` : null]
                          .filter(Boolean)
                          .join(" — ")
                      : "";
                    const equipamento = (r as any)?.equipamento;
                    const equipamentoStr = isEquipamento
                      ? [
                          equipamento?.nome,
                          equipamento?.patrimonio
                            ? `Patrimônio ${equipamento.patrimonio}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" — ") || "Equipamento"
                      : "";

                    const alvoStr = isPeca ? pecaStr : isEquipamento ? equipamentoStr : veiculoStr;
                    const alvoFull = alvoStr || "";
                    const alvoShort =
                      alvoFull.length > MAX_ALVO_CHARS ? `${alvoFull.slice(0, MAX_ALVO_CHARS - 1)}…` : alvoFull;
                    const showAlvoTooltip = alvoFull.length > MAX_ALVO_CHARS;

                    const descFull = r.descricao || "-";
                    const policy = buildPolicy(st);
                    // Mesma precedência da visão de cards: manual sobrepõe a regra.
                    const regraDestaque = regrasDestaque[st];
                    const destaqueManual = Boolean(r.destacada);
                    const temDestaque = destaqueManual || Boolean(regraDestaque);
                    const destaqueTexto = destaqueManual
                      ? r.destaque_motivo || null
                      : regraDestaque?.texto ?? null;
                    const mostrarIconeDestaque = destaqueManual || Boolean(destaqueTexto);
                    const destaqueTitulo = destaqueManual ? "OS destacada" : "Destaque por status";
                    const estilo = estiloDestaque(destaqueManual ? r.destaque_cor : regraDestaque?.cor);

                    return (
                      <TableRow
                        key={r.id}
                        onDoubleClick={() => {
                          setDetailsId(r.id);
                          setDetailsOpen(true);
                        }}
                        className={`cursor-pointer select-none ${temDestaque ? estilo.linha : ""}`}
                      >
                        <TableCell className="font-mono">
                          <div className="flex items-center gap-1.5">
                            <span>{r.id}</span>
                            {mostrarIconeDestaque ? (
                              usarPopoverDestaque ? (
                                <Popover
                                  open={destaqueTooltipId === r.id}
                                  onOpenChange={(aberto) =>
                                    setDestaqueTooltipId((atual) =>
                                      aberto ? r.id : atual === r.id ? null : atual,
                                    )
                                  }
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className={`inline-flex size-7 touch-manipulation items-center justify-center rounded-md outline-none ${estilo.icone}`}
                                      aria-label={`${destaqueTitulo}: ${destaqueTexto || "motivo não informado"}`}
                                    >
                                      <AlertTriangle className={`h-4 w-4 ${estilo.iconeFill}`} />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="start" side="bottom" className="w-64">
                                    <p className="font-semibold">{destaqueTitulo}</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                                      {destaqueTexto || "Motivo não informado."}
                                    </p>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className={`inline-flex size-7 items-center justify-center rounded-md outline-none ${estilo.icone}`}
                                      aria-label={`${destaqueTitulo}: ${destaqueTexto || "motivo não informado"}`}
                                    >
                                      <AlertTriangle className={`h-4 w-4 ${estilo.iconeFill}`} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <p className="font-semibold">{destaqueTitulo}</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words">
                                      {destaqueTexto || "Motivo não informado."}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              )
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell className="min-w-0">
                          <div className="flex items-center justify-center w-min bg-red-500/20 py-1 px-2 rounded-full">
                            <span className="text-[11px]">{r.setor?.nome ?? "-"}</span>
                          </div>
                          {r.migracaoReferencia ? (
                            <span className="mt-1 inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                              Migrada
                            </span>
                          ) : null}

                          <div className="flex min-w-0 items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate font-medium text-[13px]">{clienteShort}</div>
                              </TooltipTrigger>
                              {clienteFull.length > MAX_CLIENTE_CHARS && (
                                <TooltipContent>
                                  <p className="max-w-xs break-words">{clienteFull}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>

                            {whatsappUrl ? (
                              <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex w-max shrink-0 items-center justify-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] text-primary-foreground"
                                aria-label={`Abrir WhatsApp de ${clienteFull}`}
                                title="Abrir WhatsApp"
                              >
                                WhatsApp
                                <Send className="h-2.5 w-2.5" />
                              </a>
                            ) : null}
                          </div>

                          {alvoStr && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="mt-0.5 flex items-center gap-1  text-muted-foreground">
                                  {isPeca ? (
                                    <Package className="h-3 w-3 shrink-0" />
                                  ) : isEquipamento ? (
                                    <Wrench className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <Car className="h-3 w-3 shrink-0" />
                                  )}
                                  <span className="truncate">{alvoShort}</span>
                                </div>
                              </TooltipTrigger>
                              {showAlvoTooltip && (
                                <TooltipContent className="max-w-xs">
                                  <p className="break-words whitespace-pre-wrap">{alvoFull}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          )}
                        </TableCell>

                        <TableCell className="max-w-[380px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="whitespace-normal break-words line-clamp-2">{descFull}</div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                              <p className="whitespace-pre-wrap break-words">{descFull}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>

                        <TableCell>{fmtDate((r as any).dataEntrada ?? (r as any).dataentrada)}</TableCell>
                        {isFinalizadas ? (
                          <TableCell>
                            {((r as any).finalizadoEm ?? (r as any).finalizado_em)
                              ? fmtDate((r as any).finalizadoEm ?? (r as any).finalizado_em)
                              : "—"}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          {((r as any).dataSaida ?? (r as any).datasaida)
                            ? fmtDate((r as any).dataSaida ?? (r as any).datasaida)
                            : ["PAGAMENTO", "FATURAMENTO", "CONCLUIDO", "SEM_COBRANCA"].includes(String(r.status ?? "").toUpperCase())
                              ? <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">Saída não registrada</Badge>
                              : "—"}
                        </TableCell>

                        <TableCell>
                          <Badge className={statusClasses[st] ?? ""}>{st.replaceAll("_", " ")}</Badge>
                        </TableCell>

                        <TableCell>
                          {r.prioridade ? (
                            <Badge className={prioClasses[(r.prioridade || "").toUpperCase()] ?? ""}>{r.prioridade}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        <TableCell>{renderTempo(r)}</TableCell>

                        <TableCell className="text-center">
                          <RowActions
                            row={r}
                            policy={policy}
                            onOpenOrcamento={onOpenOrcamento}
                            onEditar={onEditar}
                            setStatus={setStatus}
                            onSendToApproval={handleSendToApproval}
                            onResetOS={handleResetOS}
                            onCancelarOS={handleCancelarOS}
                            onFinalizeNoCharge={handleFinishNoCharge}
                            setLinkRow={setLinkRow}
                            setLinkDialogOpen={setLinkDialogOpen}
                            setConfirmRow={setConfirmRow}
                            setConfirmOpen={setConfirmOpen}
                            setPayRow={setPayRow}
                            setPayOpen={setPayOpen}
                            setDetailsId={setDetailsId}
                            setDetailsOpen={setDetailsOpen}
                            setChecklistRow={setChecklistRow}
                            setChecklistOpen={setChecklistOpen}
                            setStoneRow={setStoneDialogRow}
                            setStoneOpen={setStoneDialogOpen}
                            setEmissaoId={setEmissaoId}
                            setEmissaoOpen={setEmissaoOpen}
                            onRegistrarSaida={setSaidaRow}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}

                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Nenhuma OS encontrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </motion.div>
        )}
      </AnimatePresence>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:justify-between">
            <div className="flex flex-nowrap text-xs text-muted-foreground">
              <span>{start || 0}</span> - <span>{end || 0}</span>
              <span className="ml-1 hidden sm:block">de {total}</span>
              <Loader className={`ml-2 h-full w-4 animate-spin transition-all ${isLoading ? "opacity-100" : "opacity-0"}`} aria-label="carregando" />
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button variant="outline" size="icon" aria-label="Primeira página" onClick={() => setPage(1)} disabled={page === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Página anterior" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-nowrap">
                Pg. {page} de {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Próxima página"
                onClick={() => setPage(Math.min(totalPages || 1, page + 1))}
                disabled={page === totalPages || totalPages === 0}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Última página"
                onClick={() => setPage(totalPages || 1)}
                disabled={page === totalPages || totalPages === 0}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="shrink-0">
              <Select
                value={String(limit)}
                onValueChange={(v) => {
                  setPage(1);
                  setLimit(Number(v));
                }}
              >
                <SelectTrigger className="ml-2 hover:cursor-pointer" aria-label="Itens por página">
                  <SelectValue placeholder={limit} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>

        <LinkAprovacaoDialog
          open={linkDialogOpen}
          onOpenChange={(v) => {
            setLinkDialogOpen(v);
            if (!v) setLinkRow(null);
          }}
          osId={linkRow?.id ?? 0}
          clienteNome={linkRow?.cliente?.nome ?? null}
          clienteTelefone={linkRow?.cliente?.telefone}
        />

        {/* Confirmar envio ao financeiro */}
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open && enviandoStatus) return;
            setConfirmOpen(open);
            if (!open) {
              setConfirmRow(null);
              setConfirmPaymentMethods([]);
              setConfirmPaymentAmounts({});
              setConfirmPaymentInstallments({});
              setConfirmPaymentMethodsOpen(false);
              setConfirmDescricaoFinanceiro("");
              setConfirmGarantia("");
              setConfirmObservacoesFiscais("");
              setConfirmSaldoCents(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {confirmDestino === "FATURAMENTO" ? "Enviar para faturamento" : "Encerrar execução da OS"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDestino === "FATURAMENTO"
                  ? <>Informe as condições acertadas com o cliente para enviar a OS <b>#{confirmRow?.id}</b> ao faturamento.</>
                  : <>Esta ação encerra a execução da OS <b>#{confirmRow?.id}</b>. Se pagamentos ou títulos já cobrirem todo o valor, ela será concluída; caso contrário, aguardará pagamento. {config?.habilitar_faturamento_os ? "As condições de pagamento serão informadas ao enviar para faturamento." : ""}</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <fieldset disabled={loadingConfirmSaldo || erroConfirmSaldo || enviandoStatus} className="space-y-4 py-2 bg-card rounded-2xl p-4">
              {confirmDestino === "FATURAMENTO" && confirmCondicoesOriginais && <p className="text-sm text-muted-foreground">As condições já registradas foram carregadas. Se enviar sem alterações, todos os dados de pagamento serão preservados.</p>}
              {erroConfirmSaldo && <p className="text-sm text-destructive">Não foi possível carregar os dados da OS. Feche e abra novamente para tentar de novo.</p>}
              <div className="space-y-2">
                {confirmCondicoes && <>
                <Label>Formas de pagamento</Label>
                {loadingConfirmSaldo ? (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Consultando o saldo ainda não coberto...
                  </div>
                ) : confirmTotalCents === 0 ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                    O valor da OS já está integralmente coberto por pagamentos ou títulos pendentes.
                  </div>
                ) : null}
                <Popover
                  open={confirmPaymentMethodsOpen}
                  onOpenChange={setConfirmPaymentMethodsOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
                      disabled={loadingConfirmSaldo || confirmTotalCents === 0}
                    >
                      <span className="truncate">{confirmPaymentMethodsLabel}</span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          {isLoadingPaymentMethods ? (
                            <CommandItem disabled>Carregando formas de pagamento...</CommandItem>
                          ) : paymentMethodsError ? (
                            <CommandItem onSelect={() => void reloadPaymentMethods()}>
                              Falha ao carregar. Clique para tentar novamente.
                            </CommandItem>
                          ) : paymentMethodOptions.length === 0 ? (
                            <CommandItem disabled>Nenhuma forma de pagamento cadastrada.</CommandItem>
                          ) : paymentMethodOptions.map((method) => (
                            <CommandItem
                              key={method.value}
                              value={method.value}
                              onSelect={() =>
                                toggleConfirmPaymentMethod(method.value)
                              }
                              className="flex items-center gap-3"
                            >
                              <Checkbox
                                checked={confirmPaymentMethods.includes(
                                  method.value,
                                )}
                              />
                              <span>{method.label}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {confirmPaymentMethods.length > 0 && (
                  <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        Valores por forma
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatCurrencyBRL(confirmPaymentsTotalCents / 100)} /{" "}
                        {formatCurrencyBRL(confirmTotalCents / 100)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {confirmPaymentMethods.map((method) => {
                        const methodLabel =
                          paymentMethodOptions.find(
                            (option) => option.value === method,
                          )?.label ?? method;
                        const hasInstallments =
                          method === "CREDITO" ||
                          method === "BOLETO" ||
                          method === "PROMISSORIA";

                        return (
                          <div
                            key={method}
                            className={
                              hasInstallments
                                ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)_90px] sm:items-end"
                                : "grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] sm:items-end"
                            }
                          >
                            <div className="min-w-0 pb-2">
                              <span className="truncate text-sm">{methodLabel}</span>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Valor</Label>
                              <ValueInput
                                value={confirmPaymentAmounts[method] ?? 0}
                                onValueChange={(value) =>
                                  updateConfirmPaymentAmount(method, value)
                                }
                                className="h-9 text-right"
                              />
                            </div>
                            {hasInstallments && (
                              <div className="space-y-1">
                                <Label className="text-xs">Parcelas</Label>
                                <Select
                                  value={String(
                                    confirmPaymentInstallments[method] ?? 1,
                                  )}
                                  onValueChange={(value) =>
                                    setConfirmPaymentInstallments((current) => ({
                                      ...current,
                                      [method]: Number(value),
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-9 w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from(
                                      { length: 12 },
                                      (_, index) => index + 1,
                                    ).map((parcelas) => (
                                      <SelectItem
                                        key={parcelas}
                                        value={String(parcelas)}
                                      >
                                        {parcelas}x
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {confirmPaymentsTotalCents !== confirmTotalCents && (
                      <p className="text-xs text-amber-600">
                        Restante:{" "}
                        {formatCurrencyBRL(
                          Math.max(
                            0,
                            confirmTotalCents - confirmPaymentsTotalCents,
                          ) / 100,
                        )}
                      </p>
                    )}
                  </div>
                )}
                </>}
              </div>

              {confirmCondicoes && <div className="space-y-2">
                <Label>Descrição para o financeiro</Label>
                <Textarea
                  value={confirmDescricaoFinanceiro}
                  onChange={(event) =>
                    setConfirmDescricaoFinanceiro(event.target.value)
                  }
                  placeholder="Ex.: cobrar entrada, vencimento combinado ou outras orientações"
                  rows={3}
                />
              </div>}

              {confirmDestino !== "FATURAMENTO" && <div className="space-y-2">
                <Label>Garantia</Label>
                <Input
                  value={confirmGarantia}
                  maxLength={500}
                  onChange={(event) => setConfirmGarantia(event.target.value)}
                  placeholder="Ex.: 90 dias para peças e serviços"
                />
                <p className="text-right text-xs text-muted-foreground">
                  {confirmGarantia.length}/500
                </p>
              </div>}

              <div className="space-y-2">
                <Label>Observações fiscais</Label>
                <Textarea
                  value={confirmObservacoesFiscais}
                  onChange={(event) => setConfirmObservacoesFiscais(event.target.value)}
                  placeholder="Informações fiscais adicionais..."
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Vem do cadastro da OS e alimenta as informações complementares da nota.
                </p>
              </div>
            </fieldset>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={enviandoStatus}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={loadingConfirmSaldo || erroConfirmSaldo || enviandoStatus}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!confirmRow || enviandoStatus) return;
                  const enviar = async (status: StatusOS, extras?: ExtrasStatusOS) => {
                    setEnviandoStatus(true);
                    try {
                      return await setStatus(confirmRow.id, status, extras);
                    } finally {
                      setEnviandoStatus(false);
                    }
                  };
                  // A observação fiscal viaja em todos os caminhos: ela não faz
                  // parte do acordo financeiro, então não conta como alteração
                  // das condições nem tira o envio do caminho que as preserva.
                  const observacoesFiscais = confirmObservacoesFiscais.trim() || null;
                  if (confirmDestino === "FATURAMENTO" && confirmCondicoesOriginais !== null &&
                    confirmCondicoesOriginais === assinaturaCondicoes(confirmPaymentMethods, confirmPaymentAmounts, confirmPaymentInstallments, confirmDescricaoFinanceiro)) {
                    const updated = await enviar(confirmDestino, { observacoesFiscais });
                    if (updated) setConfirmOpen(false);
                    return;
                  }

                  if (!confirmCondicoes) {
                    const updated = await enviar("PAGAMENTO", {
                      garantia: confirmGarantia.trim() || null,
                      observacoesFiscais,
                    });
                    if (updated || barradoPorRealizadorRef.current) setConfirmOpen(false);
                    return;
                  }
                  if (confirmDestino === "FATURAMENTO" && confirmTotalCents > 0 && confirmPaymentMethods.length === 0) {
                    toast.error("Informe as condições de pagamento acordadas com o cliente.");
                    return;
                  }

                  const pagamentosPrevistos = confirmPaymentMethods.map(
                    (method) => ({
                      metodo: method,
                      valor: Number(confirmPaymentAmounts[method] ?? 0),
                      parcelas:
                        method === "CREDITO" ||
                        method === "BOLETO" ||
                        method === "PROMISSORIA"
                          ? Number(confirmPaymentInstallments[method] ?? 1)
                          : null,
                    }),
                  );
                  if (
                    pagamentosPrevistos.some(
                      (pagamento) => moneyToCents(pagamento.valor) <= 0,
                    )
                  ) {
                    toast.error(
                      "Informe um valor maior que zero para cada forma de pagamento.",
                    );
                    return;
                  }
                  if (
                    pagamentosPrevistos.length > 0 &&
                    confirmPaymentsTotalCents !== confirmTotalCents
                  ) {
                    toast.error("A soma dos pagamentos precisa fechar o total da OS.", {
                      description: `Total informado: ${formatCurrencyBRL(
                        confirmPaymentsTotalCents / 100,
                      )}. Total da OS: ${formatCurrencyBRL(
                        confirmTotalCents / 100,
                      )}.`,
                    });
                    return;
                  }

                  const updated = await enviar(confirmDestino, {
                    pagamentosPrevistos,
                    descricaoFinanceiro:
                      confirmDescricaoFinanceiro.trim() || null,
                    observacoesFiscais,
                    ...(confirmDestino !== "FATURAMENTO" ? { garantia: confirmGarantia.trim() || null } : {}),
                  });
                  // Falta de executor abre o seletor por cima deste dialog: sai
                  // da frente, que a ação guardada retoma o envio com estes
                  // mesmos pagamentos. Outros erros mantêm o form preenchido.
                  if (updated || barradoPorRealizadorRef.current) setConfirmOpen(false);
                }}
              >
                {enviandoStatus ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {enviandoStatus
                  ? "Enviando..."
                  : confirmDestino === "FATURAMENTO" ? "Enviar para faturamento" : "Enviar p/ pagamento"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Enviar para aprovação */}
        <AlertDialog
          open={approveDialogOpen}
          onOpenChange={(open) => {
            if (!open && enviandoStatus) return;
            setApproveDialogOpen(open);
            if (!open) clearApprovalToast();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Confira o orçamento antes de enviar para aprovação
              </AlertDialogTitle>
              <AlertDialogDescription>
                Ao confirmar, a OS <b>#{approveRow?.id}</b> irá alterar o status para <b>APROVACAO_ORCAMENTO</b>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={enviandoStatus}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={enviandoStatus}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!approveRow || enviandoStatus) return;

                  if (approvalToastId != null) toast("Enviando orçamento para aprovação...", { id: approvalToastId });
                  setEnviandoStatus(true);
                  try {
                    await setStatus(approveRow.id, "APROVACAO_ORCAMENTO");
                  } finally {
                    setEnviandoStatus(false);
                  }

                  if (approvalToastId != null) {
                    toast.success("Orçamento enviado para aprovação!", { id: approvalToastId, duration: 3000 });
                    setApprovalToastId(null);
                  }

                  setApproveDialogOpen(false);
                  setApproveRow(null);
                }}
              >
                {enviandoStatus ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {enviandoStatus ? "Enviando..." : "Enviar para aprovação"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ✅ Confirmar reset */}
        <AlertDialog
          open={resetOpen}
          onOpenChange={(open) => {
            if (!open && enviandoStatus) return;
            setResetOpen(open);
            if (!open) setResetRow(null);
          }}
        >
          <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Reiniciar OS</AlertDialogTitle>
              <AlertDialogDescription>
                Isso vai retornar a OS <b>#{resetRow?.id}</b> para <b>ORCAMENTO</b>.
                Os checklists existentes serão mantidos, mas todos os pagamentos e títulos listados abaixo serão excluídos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ImpactoExclusaoFinanceiraOs impacto={impactoReset} />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={enviandoStatus}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!impactoReset.pronto || enviandoStatus}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!resetRow || enviandoStatus) return;
                  setEnviandoStatus(true);
                  const sucesso = await doResetOS(resetRow.id, impactoReset.ids)
                    .finally(() => setEnviandoStatus(false));
                  if (!sucesso) {
                    impactoReset.recarregar();
                    return;
                  }
                  setResetOpen(false);
                  setResetRow(null);
                }}
              >
                {!impactoReset.pronto || enviandoStatus ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {enviandoStatus ? "Reiniciando..." : "Confirmar reinício e exclusão"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ✅ Cancelar com motivo obrigatório */}
        <AlertDialog
          open={cancelOpen}
          onOpenChange={(open) => {
            if (!open && enviandoStatus) return;
            setCancelOpen(open);
            if (!open) {
              setCancelRow(null);
              setCancelMotivo("");
            }
          }}
        >
          <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar OS</AlertDialogTitle>
              <AlertDialogDescription>
                Informe o motivo do cancelamento da OS <b>#{cancelRow?.id}</b>. Todos os pagamentos e títulos listados abaixo serão excluídos.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <ImpactoExclusaoFinanceiraOs impacto={impactoCancelamento} estornaConsumos />

            <div className="mt-2 space-y-2">
              <Label className="">Motivo</Label>
              <Input
                value={cancelMotivo}
                onChange={(e) => setCancelMotivo(e.target.value)}
                placeholder="Ex.: Cliente desistiu / peça indisponível..."
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={enviandoStatus}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={cancelMotivo.trim().length === 0 || !impactoCancelamento.pronto || enviandoStatus}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!cancelRow || enviandoStatus) return;
                  const motivo = cancelMotivo.trim();
                  if (!motivo) return;

                  setEnviandoStatus(true);
                  const sucesso = await doCancelarOS(
                    cancelRow.id,
                    motivo,
                    impactoCancelamento.ids,
                  ).finally(() => setEnviandoStatus(false));
                  if (!sucesso) {
                    impactoCancelamento.recarregar();
                    return;
                  }
                  setCancelOpen(false);
                  setCancelRow(null);
                  setCancelMotivo("");
                }}
              >
                {!impactoCancelamento.pronto || enviandoStatus ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {enviandoStatus ? "Cancelando..." : "Confirmar cancelamento e exclusão"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Finalizar sem cobrança */}
        <AlertDialog
          open={noChargeOpen}
          onOpenChange={(open) => {
            if (!open && enviandoStatus) return;
            setNoChargeOpen(open);
            if (!open) {
              setNoChargeRow(null);
              setNoChargeMotivo("");
            }
          }}
        >
          <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Finalizar sem cobrança</AlertDialogTitle>
              <AlertDialogDescription>
                Informe o motivo para concluir a OS <b>#{noChargeRow?.id}</b> sem cobrança.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Esta ação não pode ser desfeita. Ao confirmar:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>o orçamento é zerado — o total da OS passa a ser R$ 0,00;</li>
                <li>todos os pagamentos e títulos vinculados serão excluídos;</li>
                <li>as receitas de produtos e serviços saem do financeiro da OS;</li>
                <li>
                  os custos são mantidos: as peças aplicadas continuam lançadas como despesa;
                </li>
                <li>as comissões são recalculadas sobre o total zerado;</li>
                <li>a OS é finalizada e seus valores ficam travados para edição.</li>
              </ul>
            </div>

            <ImpactoExclusaoFinanceiraOs impacto={impactoSemCobranca} />

            <div className="mt-2 space-y-2">
              <Label>Motivo</Label>
              <Input
                value={noChargeMotivo}
                onChange={(e) => setNoChargeMotivo(e.target.value)}
                placeholder="Ex.: Garantia, cortesia, brinde..."
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={enviandoStatus}>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={noChargeMotivo.trim().length === 0 || !impactoSemCobranca.pronto || enviandoStatus}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!noChargeRow || enviandoStatus) return;
                  const motivo = noChargeMotivo.trim();
                  if (!motivo) return;

                  setEnviandoStatus(true);
                  const sucesso = await doFinishNoCharge(
                    noChargeRow.id,
                    motivo,
                    impactoSemCobranca.ids,
                  ).finally(() => setEnviandoStatus(false));
                  if (!sucesso) {
                    impactoSemCobranca.recarregar();
                    return;
                  }
                  setNoChargeOpen(false);
                  setNoChargeRow(null);
                  setNoChargeMotivo("");
                }}
              >
                {!impactoSemCobranca.pronto || enviandoStatus ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {enviandoStatus ? "Finalizando..." : "Finalizar sem cobrança e excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <OsFinancialDialog
          open={payOpen}
          onOpenChange={(v) => {
            setPayOpen(v);
            if (!v) setPayRow(null);
          }}
          osId={payRow?.id || 0}
          handleGetOrdens={() => fetchNow(currentParamsRef.current)}
        />

        <EmissaoNotaDialog osId={emissaoId} open={emissaoOpen} onOpenChange={setEmissaoOpen} />

        <OsStonePaymentDialog
          open={stoneDialogOpen}
          onOpenChange={(v) => {
            setStoneDialogOpen(v);
            if (!v) setStoneDialogRow(null);
          }}
          osId={stoneDialogRow?.id || 0}
          handleGetOrdens={() => fetchNow(currentParamsRef.current)}
        />

        <OSDetalhesDialog
          open={detailsOpen}
          onOpenChange={(v) => {
            setDetailsOpen(v);
            if (!v) setDetailsId(null);
          }}
          osId={detailsId ?? 0}
          onDestaqueChange={() => fetchNow(currentParamsRef.current, { silent: true })}
        />

        <RealizadoresOSDialog
          open={pendenciaRealizadores !== null}
          onOpenChange={(v) => {
            if (!v) setPendenciaRealizadores(null);
          }}
          osId={pendenciaRealizadores?.osId ?? null}
          acao={
            pendenciaRealizadores?.acao ?? {
              rotulo: "Iniciar OS",
              rotuloComPendencias: "Salvar e iniciar",
              aviso: "Selecione ao menos um executor para todos os serviços antes de iniciar a OS.",
              executar: async () => false,
            }
          }
        />

        <AlertDialog open={!!estoqueDialog} onOpenChange={(open) => !open && setEstoqueDialog(null)}>
          <AlertDialogContent className="sm:max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Estoque insuficiente para iniciar a OS</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    A OS <b>#{estoqueDialog?.osId}</b> não pode ser iniciada porque existem produtos do orçamento sem
                    estoque suficiente.
                  </p>
                  {estoqueDialog?.message ? <p>{estoqueDialog.message}</p> : null}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]">
                <span>Produto</span>
                <span className="text-right">Disponível</span>
                <span className="text-right">Necessário</span>
              </div>
              {(estoqueDialog?.itens ?? []).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 border-b px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem]"
                >
                  <span className="min-w-0 truncate font-medium">{item.titulo}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{item.disponivel}</span>
                  <span className="text-right tabular-nums font-semibold">{item.solicitado}</span>
                </div>
              ))}
            </div>

            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setEstoqueDialog(null)}>Entendi</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {String(checklistRow?.status ?? "")
          .trim()
          .toUpperCase() === "AGUARDANDO_CHECKLIST" ? (
          <ChecklistDialog
            open={checklistOpen}
            onOpenChange={(v) => {
              setChecklistOpen(v);
              if (!v) setChecklistRow(null);
            }}
            osId={checklistRow?.id ?? 0}
          />
        ) : (
          <ChecklistEditDialog
            open={checklistOpen}
            onOpenChange={(v) => {
              setChecklistOpen(v);
              if (!v) setChecklistRow(null);
            }}
            osId={checklistRow?.id ?? 0}
          />
        )}
        <RegistrarSaidaDialog
          open={saidaRow !== null}
          onOpenChange={(value) => !value && setSaidaRow(null)}
          osId={saidaRow?.id ?? 0}
          onSuccess={() => window.dispatchEvent(new CustomEvent("os:refresh"))}
        />
      </Card>
    </TooltipProvider>
  );
}
