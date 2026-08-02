"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { createClient } from "@supabase/supabase-js";

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
} from "lucide-react";

import { toast } from "@/lib/toast";

import type { StatusOS } from "./ordens-tabs";
import { LinkAprovacaoDialog } from "./dialogs/link-aprovacao-dialog";
import { OSDetalhesDialog } from "./dialogs/detalhes-os-dialog";
import { ChecklistDialog } from "./dialogs/checklist-dialog";
import { ChecklistEditDialog } from "./dialogs/checklist-edit-dialog";
import { RealizadoresOSDialog } from "./dialogs/realizadores-os-dialog";
import { statusClasses, prioClasses, fmtDate, fmtDuration, useNowTick, safeStatus } from "./ordens-utils";
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
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethodOption,
  type PlannedPayment,
} from "@/lib/payment-methods";

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
  dataInicio?: Date;
  dataFim?: Date;
  sortKey: SortKey;
  sortDir: SortDir;
};

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
  const [rows, setRows] = useState<OrdemComDatas[]>([]);
  const canCreate = permissionSetHas((session?.user as any)?.permissoes, PERMS.ORDENS_CRIAR);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [localSearch, setLocalSearch] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("prioridade");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [filtroAberto, setFiltroAberto] = useState(false);
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const [prioFiltro, setPrioFiltro] = useState<PrioFiltro>("TODAS");
  const [setorFiltro, setSetorFiltro] = useState<string>("TODOS");
  const [alvoFiltro, setAlvoFiltro] = useState<"TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO">("TODOS");
  const [dataInicio, setDataInicioState] = useState<Date | undefined>();
  const [dataFim, setDataFimState] = useState<Date | undefined>();
  const [setoresApiOptions, setSetoresApiOptions] = useState<Array<{ value: string; label: string }>>([]);

  const [isLoading, setIsLoading] = useState(true);
  const reqIdRef = useRef(0);

  const now = useNowTick(5000);

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
    dataInicio: undefined,
    dataFim: undefined,
    sortKey: "prioridade",
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
    dataInicio,
    dataFim,
    sortKey,
    sortDir,
  ]);

  const lastRealtimeRef = useRef(0);

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
      dataInicio: inicio,
      dataFim: fim,
      sortKey: ordenarPor,
      sortDir: ordenarDir,
    }: FetchParams,
    opts?: { silent?: boolean }
  ) {
    const myId = ++reqIdRef.current;
    const silent = !!opts?.silent;
    if (!silent) setIsLoading(true);

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
      if (inicio) url.searchParams.set("dateFrom", toDiaISO(inicio));
      if (fim) url.searchParams.set("dateTo", toDiaISO(fim));

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
      if (!silent && myId === reqIdRef.current) setIsLoading(false);
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
    dataInicio,
    dataFim,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    setPage(1);
  }, [statusesKey]);

  useEffect(() => {
    setPage(1);
  }, [localSearch]);

  // Qualquer filtro novo recomeça na primeira página: a página atual pode nem existir
  // no resultado filtrado.
  useEffect(() => {
    setPage(1);
  }, [apenasMinhas, prioFiltro, setorFiltro, alvoFiltro, dataInicio, dataFim]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) return;

    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const suffix = statusesKey ? statusesKey.replace(/\|/g, "+") : "all";
    const channelName = `os-realtime-list-${suffix}`;

    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "ordemservico" }, () => {
        const nowTs = Date.now();
        if (nowTs - lastRealtimeRef.current < 700) return;
        lastRealtimeRef.current = nowTs;
        fetchNow(currentParamsRef.current, { silent: true });
      })
      .subscribe();

    const onLocalRefresh = () => fetchNow(currentParamsRef.current, { silent: true });
    window.addEventListener("os:refresh", onLocalRefresh);

    return () => {
      window.removeEventListener("os:refresh", onLocalRefresh);
      supabase.removeChannel(ch);
    };
  }, [statusesKey]);

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

  const confirmTotalCents = moneyToCents(Number(confirmRow?.orcamentototal ?? 0));
  const confirmPaymentsTotalCents = confirmPaymentMethods.reduce(
    (totalCents, method) =>
      totalCents + moneyToCents(Number(confirmPaymentAmounts[method] ?? 0)),
    0,
  );
  const confirmPaymentMethodsLabel =
    confirmPaymentMethods.length === 0
      ? "Não informar"
      : PAYMENT_METHOD_OPTIONS.filter((method) =>
          confirmPaymentMethods.includes(method.value),
        )
          .map((method) => method.label)
          .join(", ");

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
      if (method === "CREDITO" || method === "BOLETO") {
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

  const [realizadoresOpen, setRealizadoresOpen] = useState(false);
  const [realizadoresOsId, setRealizadoresOsId] = useState<number | null>(null);
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

  const clearApprovalToast = () => {
    if (approvalToastId != null) {
      toast.dismiss(approvalToastId);
      setApprovalToastId(null);
    }
  };

  async function setStatus(
    id: number,
    status: StatusOS,
    extras?: {
      formaPagamento?: PaymentMethodOption | null;
      parcelasPagamento?: number | null;
      pagamentosPrevistos?: PlannedPayment[];
      descricaoFinanceiro?: string | null;
      garantia?: string | null;
    },
  ): Promise<boolean> {
    const loadingToastId =
      status === "EM_ANDAMENTO"
        ? toast.loading("Preparando atribuição de realizadores...", {
            description: "Verificando serviços da OS antes de iniciar.",
            duration: Infinity,
          })
        : null;

    const closeLoading = () => {
      if (loadingToastId != null) toast.dismiss(loadingToastId);
    };

    if (status === "EM_ANDAMENTO") {
      try {
        const r = await fetch(`/api/ordens/${id}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) throw new Error(j?.error || "Não foi possível validar realizadores da OS.");

        const itens = (j?.itensServico ?? []) as Array<{
          realizadores?: Array<{ id: string; nome: string | null }> | null;
          idusuariorealizador?: string | null;
        }>;

        const temSemRealizador = itens.some((it) => {
          if (Array.isArray(it.realizadores)) return it.realizadores.length === 0;
          return !it.idusuariorealizador;
        });

        if (temSemRealizador) {
          setRealizadoresOsId(id);
          setRealizadoresOpen(true);

          toast.error("Antes de iniciar, selecione ao menos 1 realizador para todos os serviços da OS.", {
            id: loadingToastId ?? undefined,
            duration: 4000,
          });
          return false;
        }

        closeLoading();
      } catch (err: any) {
        setRealizadoresOsId(id);
        setRealizadoresOpen(true);

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
        body: JSON.stringify({ status, ...extras }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        closeLoading();
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
  async function doResetOS(id: number) {
    const tId = toast.loading(`Reiniciando OS #${id}...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ORCAMENTO" }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao reiniciar OS");

      toast.success("OS reiniciada (voltou para ORCAMENTO)", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reiniciar OS", { id: tId, duration: 4000 });
    }
  }

  // ✅ Cancelar UI (motivo)
  function handleCancelarOS(row: OrdemComDatas) {
    setCancelRow(row);
    setCancelMotivo("");
    setCancelOpen(true);
  }

  async function doCancelarOS(id: number, motivo: string) {
    const tId = toast.loading(`Cancelando OS #${id}...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/cancelar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao cancelar OS");

      toast.success("OS cancelada", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao cancelar OS", { id: tId, duration: 4000 });
    }
  }

  // Finalizar sem cobrança
  function handleFinishNoCharge(row: OrdemComDatas) {
    setNoChargeRow(row);
    setNoChargeMotivo("");
    setNoChargeOpen(true);
  }

  async function doFinishNoCharge(id: number, motivo: string) {
    const tId = toast.loading(`Finalizando OS #${id} sem cobrança...`, { duration: Infinity });
    try {
      const r = await fetch(`/api/ordens/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SEM_COBRANCA", semCobranca: true, motivoSemCobranca: motivo }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.error || "Falha ao finalizar sem cobrança");

      toast.success("OS finalizada sem cobrança", { id: tId, duration: 2500 });
      window.dispatchEvent(new CustomEvent("os:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao finalizar sem cobrança", { id: tId, duration: 4000 });
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
      <Card className="bg-card">
        <CardHeader className="border-b-2 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
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

            <div className="flex items-center gap-2">
              <div className="relative hidden md:block w-[400px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} placeholder="Buscar..." className="pl-8 pr-9" />
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

              <Button
                variant={apenasMinhas ? "default" : "outline"}
                size="sm"
                className="gap-1 hover:cursor-pointer"
                aria-pressed={apenasMinhas}
                title="Mostrar apenas as ordens de serviço criadas por mim"
                onClick={() => setApenasMinhas((atual) => !atual)}
              >
                <UserRound className="h-4 w-4" />
                <span className="hidden lg:inline">Minhas Ordens de Serviço</span>
                <span className="lg:hidden">Minhas OS</span>
              </Button>

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
                dataInicio={dataInicio}
                dataFim={dataFim}
                onSetInicio={handleSetDataInicio}
                onSetFim={handleSetDataFim}
                onLimpar={handleLimparFiltros}
              />

              {canCreate ? (
              <Button onClick={onNovaOS} size="sm" className="hover:cursor-pointer">
                <Plus className="h-4 w-4 mr-1" />
                Nova OS
              </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 md:hidden">
            <div className="relative w-full">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} placeholder="Buscar..." className="pl-8 pr-9" />
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

        <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
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

          <div className="overflow-x-auto rounded-md border mt-6">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[40px]">#</TableHead>
                  <TableHead className="min-w-[240px]">Cliente / Veículo</TableHead>
                  <TableHead className="min-w-[220px]">Descrição</TableHead>

                  <TableHead className="min-w-[100px]">
                    <SortableHeader label="Entrada" columnKey="entrada" sortKey={sortKey} sortDir={sortDir} onChange={handleSortChange} />
                  </TableHead>

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
                    const pecaStr = isPeca ? pecaTitulo || pecaDesc || "Peça" : "";
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

                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.id}</TableCell>

                        <TableCell className="min-w-0">
                          <div className="flex items-center justify-center w-min bg-red-500/20 py-1 px-2 rounded-full">
                            <span className="text-[11px]">{r.setor?.nome ?? "-"}</span>
                          </div>

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
                        <TableCell>{fmtDate((r as any).dataSaida ?? (r as any).datasaida)}</TableCell>

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
          </div>

          <div className="mt-4 flex items-center justify-between">
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

            <div>
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
            setConfirmOpen(open);
            if (!open) {
              setConfirmRow(null);
              setConfirmPaymentMethods([]);
              setConfirmPaymentAmounts({});
              setConfirmPaymentInstallments({});
              setConfirmPaymentMethodsOpen(false);
              setConfirmDescricaoFinanceiro("");
              setConfirmGarantia("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Confirmar envio ao Financeiro
              </AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação mudará o status da OS <b>#{confirmRow?.id}</b> para <b>PAGAMENTO</b>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Formas de pagamento</Label>
                <Popover
                  open={confirmPaymentMethodsOpen}
                  onOpenChange={setConfirmPaymentMethodsOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
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
                          {PAYMENT_METHOD_OPTIONS.map((method) => (
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
                          PAYMENT_METHOD_OPTIONS.find(
                            (option) => option.value === method,
                          )?.label ?? method;
                        const hasInstallments =
                          method === "CREDITO" || method === "BOLETO";

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
              </div>

              <div className="space-y-2">
                <Label>Descrição para o financeiro</Label>
                <Textarea
                  value={confirmDescricaoFinanceiro}
                  onChange={(event) =>
                    setConfirmDescricaoFinanceiro(event.target.value)
                  }
                  placeholder="Ex.: cobrar entrada, vencimento combinado ou outras orientações"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
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
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async (event) => {
                  event.preventDefault();
                  if (!confirmRow) return;

                  const pagamentosPrevistos = confirmPaymentMethods.map(
                    (method) => ({
                      metodo: method,
                      valor: Number(confirmPaymentAmounts[method] ?? 0),
                      parcelas:
                        method === "CREDITO" || method === "BOLETO"
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

                  const updated = await setStatus(confirmRow.id, "PAGAMENTO", {
                    pagamentosPrevistos,
                    descricaoFinanceiro:
                      confirmDescricaoFinanceiro.trim() || null,
                    garantia: confirmGarantia.trim() || null,
                  });
                  if (updated) setConfirmOpen(false);
                }}
              >
                Enviar p/ pagamento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Enviar para aprovação */}
        <AlertDialog
          open={approveDialogOpen}
          onOpenChange={(open) => {
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
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!approveRow) return;

                  if (approvalToastId != null) toast("Enviando orçamento para aprovação...", { id: approvalToastId });
                  await setStatus(approveRow.id, "APROVACAO_ORCAMENTO");

                  if (approvalToastId != null) {
                    toast.success("Orçamento enviado para aprovação!", { id: approvalToastId, duration: 3000 });
                    setApprovalToastId(null);
                  }

                  setApproveDialogOpen(false);
                  setApproveRow(null);
                }}
              >
                Enviar para aprovação
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ✅ Confirmar reset */}
        <AlertDialog
          open={resetOpen}
          onOpenChange={(open) => {
            setResetOpen(open);
            if (!open) setResetRow(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reiniciar OS</AlertDialogTitle>
              <AlertDialogDescription>
                Isso vai retornar a OS <b>#{resetRow?.id}</b> para <b>ORCAMENTO</b>.
                Os checklists existentes serão mantidos. Confirma?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!resetRow) return;
                  await doResetOS(resetRow.id);
                  setResetOpen(false);
                  setResetRow(null);
                }}
              >
                Confirmar reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ✅ Cancelar com motivo obrigatório */}
        <AlertDialog
          open={cancelOpen}
          onOpenChange={(open) => {
            setCancelOpen(open);
            if (!open) {
              setCancelRow(null);
              setCancelMotivo("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar OS</AlertDialogTitle>
              <AlertDialogDescription>
                Informe o motivo do cancelamento da OS <b>#{cancelRow?.id}</b>. Esse campo é obrigatório.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="mt-2 space-y-2">
              <Label className="">Motivo</Label>
              <Input
                value={cancelMotivo}
                onChange={(e) => setCancelMotivo(e.target.value)}
                placeholder="Ex.: Cliente desistiu / peça indisponível..."
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={cancelMotivo.trim().length === 0}
                onClick={async () => {
                  if (!cancelRow) return;
                  const motivo = cancelMotivo.trim();
                  if (!motivo) return;

                  await doCancelarOS(cancelRow.id, motivo);
                  setCancelOpen(false);
                  setCancelRow(null);
                  setCancelMotivo("");
                }}
              >
                Confirmar cancelamento
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Finalizar sem cobrança */}
        <AlertDialog
          open={noChargeOpen}
          onOpenChange={(open) => {
            setNoChargeOpen(open);
            if (!open) {
              setNoChargeRow(null);
              setNoChargeMotivo("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Finalizar sem cobrança</AlertDialogTitle>
              <AlertDialogDescription>
                Informe o motivo para concluir a OS <b>#{noChargeRow?.id}</b> sem cobrança.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="mt-2 space-y-2">
              <Label>Motivo</Label>
              <Input
                value={noChargeMotivo}
                onChange={(e) => setNoChargeMotivo(e.target.value)}
                placeholder="Ex.: Garantia, cortesia, brinde..."
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                disabled={noChargeMotivo.trim().length === 0}
                onClick={async () => {
                  if (!noChargeRow) return;
                  const motivo = noChargeMotivo.trim();
                  if (!motivo) return;

                  await doFinishNoCharge(noChargeRow.id, motivo);
                  setNoChargeOpen(false);
                  setNoChargeRow(null);
                  setNoChargeMotivo("");
                }}
              >
                Finalizar sem cobrança
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
        />

        <RealizadoresOSDialog
          open={realizadoresOpen}
          onOpenChange={(v) => {
            setRealizadoresOpen(v);
            if (!v) setRealizadoresOsId(null);
          }}
          osId={realizadoresOsId}
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
      </Card>
    </TooltipProvider>
  );
}
