// ./src/app/(app)/(pages)/ordens/components/dialogs/detalhes-os-dialog.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
Dialog,
DialogContent,
DialogDescription,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
AlertTriangle,
ArrowDown,
ArrowUp,
Building2,
Calculator,
Car,
CheckSquare,
Copy,
CreditCard,
Download,
ExternalLink,
FileText,
History,
ImageIcon,
Link2,
ListChecks,
ListTree,
Loader2,
Package,
Paperclip,
Pencil,
RefreshCw,
Eye,
MoreHorizontal,
StickyNote,
Trash2,
Upload,
User2,
Users,
Wrench
} from "lucide-react";
import { Fragment,useCallback,useEffect,useMemo,useRef,useState,type ChangeEvent } from "react";
import { toast } from "@/lib/toast";

import { Checkbox } from "@/components/ui/checkbox";
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
import {
Command,
CommandEmpty,
CommandGroup,
CommandInput,
CommandItem,
CommandList,
} from "@/components/ui/command";
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import {
OS_ANEXO_CATEGORIAS,
getOsAnexoCategoriaLabel,
type OsAnexoCategoria,
} from "@/lib/os-anexo-categorias";

import { carregarDetalhesOS,listarUsuariosAtivos,type UsuarioAtivo } from "../../lib/api";
import {
  arredondarMoeda,
  calcularDescontoAplicado,
  calcularTotalComDesconto,
} from "../orcamento/util";
import ConcluidoAlert from "../../../(financeiro)/fluxodecaixa/components/concluidoAlert";
import TransactionDialog from "../../../(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import ValueInput from "../../../(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { DialogProduto } from "../../../estoque/components/dialog-produto/dialog-produto";
import { Tipo_transacao, type Transaction } from "../../../(financeiro)/fluxodecaixa/types";
import { PAYMENT_METHOD_OPTIONS, type PlannedPayment } from "@/lib/payment-methods";
import { ChecklistImagePreview } from "./checklist-image-preview";

const PUBLIC_APPROVAL_BASE = "/aprovacao";
function approvalUrlFromToken(token: string) {
  if (!token) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${PUBLIC_APPROVAL_BASE}/${token}`;
}

const statusClasses: Record<string, string> = {
  ORCAMENTO: "bg-fuchsia-600/15 text-fuchsia-400",
  APROVACAO_ORCAMENTO: "bg-sky-600/15 text-sky-400",
  EM_ANDAMENTO: "bg-amber-600/15 text-amber-400",
  PAGAMENTO: "bg-indigo-600/15 text-indigo-400",
  SEM_COBRANCA: "bg-cyan-600/15 text-cyan-400",
  CONCLUIDO: "bg-green-600/15 text-green-400",
  CANCELADO: "bg-red-600/15 text-red-400",
};

const prioClasses: Record<string, string> = {
  ALTA: "bg-red-600/15 text-red-500",
  NORMAL: "bg-amber-600/15 text-amber-500",
  BAIXA: "bg-emerald-600/15 text-emerald-500",
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtPercent(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function auditDotClass(tipo: AuditoriaResumoItem["tipo"]) {
  switch (tipo) {
    case "criacao":
      return "bg-sky-500 ring-sky-500/20";
    case "status":
      return "bg-violet-500 ring-violet-500/20";
    case "orcamento":
      return "bg-emerald-500 ring-emerald-500/20";
    case "checklist":
      return "bg-amber-500 ring-amber-500/20";
    case "atribuicao":
      return "bg-cyan-500 ring-cyan-500/20";
    case "execucao":
      return "bg-green-500 ring-green-500/20";
    case "aprovacao":
      return "bg-indigo-500 ring-indigo-500/20";
    case "anexo":
      return "bg-pink-500 ring-pink-500/20";
    case "estoque":
      return "bg-orange-500 ring-orange-500/20";
    default:
      return "bg-muted-foreground ring-muted-foreground/20";
  }
}

function fmtFileSize(value?: number | null) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function fileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "imagem";
    return decodeURIComponent(last);
  } catch {
    const last = url.split("/").pop() || "imagem";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
}

type OS = {
  id: number;
  orcamentototal?: number | null;
  subtotal?: number | null;
  desconto_tipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number | null;
  descricao?: string | null;
  observacoes?: string | null;
  observacoes_fiscais?: string | null;
  forma_pagamento?: string | null;
  parcelas_pagamento?: number | null;
  pagamentos_previstos?: PlannedPayment[] | null;
  descricao_financeiro?: string | null;
  garantia?: string | null;
  status?: string | null;
  statusaprovacao?: string | null;
  prioridade?: "ALTA" | "NORMAL" | "BAIXA" | null;
  dataentrada?: string | null;
  datasaidaprevista?: string | null;
  datasaida?: string | null;
  motivocancelamento?: string | null;
  motivosemcobranca?: string | null;
  setor?: { id: number; nome: string } | null;
  cliente?: { id: number; nomerazaosocial: string } | null;
  veiculo?: { id: number; placa?: string | null; modelo?: string | null; marca?: string | null } | null;
  alvo_tipo?: "VEICULO" | "PECA" | "EQUIPAMENTO" | null;
  peca?: { id: number; titulo: string; lacre?: string | null; descricao?: string | null } | null;
  equipamento?: {
    nome: string;
    patrimonio?: string | null;
    ano?: number | null;
    horimetro?: number | null;
  } | null;
};

type ItemProduto = {
  ordemservicoid: number;
  produtoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number | null;
  custoUnitarioAplicado?: number | null;
  custoEstimado?: boolean;
  produto?: {
    id: number;
    codigo?: string | null;
    descricao?: string | null;
    titulo?: string | null;
    precounitario?: number | null;
    unidade?: string | null;
    ultimovalordecompra?: number | null;
  } | null;
};

type ItemProdutoAvulso = {
  id: number;
  ordemservicoid: number;
  titulo: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type RealizadorLite = {
  id: string;
  nome: string | null;
};

type ItemServico = {
  ordemservicoid: number;
  servicoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number | null;
  servico?: { id: number; codigo?: string | null; descricao?: string | null; precohora?: number | null } | null;

  realizadores?: RealizadorLite[] | null;

  idusuariorealizador?: string | null;
  realizador?: { id: string; nome: string | null } | null;
};

type ChecklistImage = {
  id: number;
  url: string;
  descricao?: string | null;
  createdat?: string | null;
};

type ChecklistUser = {
  id: string;
  nome: string | null;
};

type ChecklistItem = {
  id: number;
  item: string;
  status: "PENDENTE" | "OK" | "ALERTA" | "FALHA";
  observacao?: string | null;
  createdat?: string | null;

  created_by?: string | null;
  usuario?: ChecklistUser | null;

  imagens?: ChecklistImage[];
};

type Aprovacao = {
  id: number;
  token: string;
  expira_em?: string | null;
  usado_em?: string | null;
  created_at?: string | null;
};

type OsAnexo = {
  id: number;
  nome: string;
  tipo?: string | null;
  tamanho?: number | null;
  url: string;
  descricao?: string | null;
  categoria?: string | null;
  createdat?: string | null;
};

type AuditoriaResumoItem = {
  id: string;
  ocorridoEm: string;
  tipo:
    | "criacao"
    | "status"
    | "orcamento"
    | "checklist"
    | "atribuicao"
    | "execucao"
    | "aprovacao"
    | "anexo"
    | "estoque"
    | "dados";
  titulo: string;
  detalhe: string | null;
  usuario: { id: string | null; nome: string };
};

type OSDetalhesResponse = {
  os: OS;
  itensProduto: ItemProduto[];
  itensProdutoAvulso: ItemProdutoAvulso[];
  itensServico: ItemServico[];
  checklist: ChecklistItem[];
  aprovacoes?: Aprovacao[];
  auditoriaResumo?: AuditoriaResumoItem[];
  eventosFinanceiros?: Array<{
    id: number;
    origem: "PRODUTO" | "SERVICO" | "COMISSAO" | "AVULSO";
    natureza: "RECEITA" | "DESPESA";
    status: "ATIVO" | "CANCELADO" | "CONVERTIDO";
    descricao: string;
    detalhe?: string | null;
    valor: number;
    chave_origem?: string | null;
    produtoid?: number | null;
    servicoid?: number | null;
    pode_gerar_transacao: boolean;
    transacaoid?: number | null;
  }>;
  transacoes?: Array<{
    id: number;
    descricao: string;
    valor: number;
    valorLiquido: number;
    data: string;
    tipo: string;
    pendente: boolean;
    metodopagamento?: any;
    banco_id?: number | null;
    plano_de_conta?: string | null;
    plano_de_conta_id?: number | null;
  }>;
  rentabilidade?: {
    valorFinalOs: number;
    recebidoBruto: number;
    recebidoLiquido: number;
    taxasRecebimento: number;
    saldoAReceber: number;
    custoProdutos: number;
    itensCustoEstimado: number;
    itensSemCusto: number;
    produtos: Array<{
      produtoid: number;
      descricao: string;
      quantidade: number;
      receitaLiquida: number;
      custoUnitario: number;
      custoTotal: number;
      lucroBruto: number;
      margemBruta: number;
      custoEstimado: boolean;
      custoNaoInformado: boolean;
    }>;
    despesasComprometidas: number;
    despesasPagas: number;
    despesasPendentes: number;
    totalComissoesServicos: number;
    comissoesServicos: Array<{
      servicoid: number;
      descricao: string;
      valorServico: number;
      receitaLiquida: number;
      valorComissao: number;
      realizadores: Array<{
        usuarioid: string;
        nome: string | null;
        percentual: number;
        valorBase: number;
        valorComissao: number;
      }>;
    }>;
    lucroPrevisto: number;
    lucroRealizado: number;
    margemPrevista: number;
    margemRealizada: number;
  };
};

function uniq(arr: string[]) {
  return [...new Set(arr)];
}

function getIdsFromItem(it: ItemServico): string[] {
  const ids = (it.realizadores ?? []).map((r) => r?.id).filter(Boolean) as string[];
  if (ids.length) return uniq(ids);

  const legacy = typeof it.idusuariorealizador === "string" && it.idusuariorealizador.trim() ? it.idusuariorealizador : "";
  return legacy ? [legacy] : [];
}

function buildRealizadoresFromIds(ids: string[], responsaveis: UsuarioAtivo[]): RealizadorLite[] {
  return ids.map((id) => ({
    id,
    nome: responsaveis.find((u) => u.id === id)?.nome ?? null,
  }));
}

async function putRealizadores(ordemservicoid: number, servicoid: number, usuarioIds: string[]) {
  const r = await fetch(`/api/ordens/${ordemservicoid}/servicos/${servicoid}/responsavel`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuarioIds }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Erro ao atualizar realizadores");
  return j as {
    ordemservicoid: number;
    servicoid: number;
    usuarioIds: string[];
    idusuariorealizador: string | null;
    realizadores: RealizadorLite[];
  };
}

function badgeClassForChecklistStatus(status?: string) {
  switch ((status || "").toUpperCase()) {
    case "OK":
      return "bg-emerald-600/15 text-emerald-500 border-emerald-700/30";
    case "ALERTA":
      return "bg-amber-500/15 text-amber-500 border-amber-700/30";
    case "FALHA":
      return "bg-red-600/15 text-red-500 border-red-700/30";
    default:
      return "bg-muted/30 text-muted-foreground border-muted";
  }
}

function MultiSelectRealizadores({
  disabled,
  responsaveis,
  valueIds,
  onChangeIds,
}: {
  disabled: boolean;
  responsaveis: UsuarioAtivo[];
  valueIds: string[];
  onChangeIds: (nextIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => new Set(valueIds), [valueIds]);

  const label = useMemo(() => {
    if (valueIds.length === 0) return "Sem realizador";
    if (valueIds.length === 1) {
      const u = responsaveis.find((r) => r.id === valueIds[0]);
      return u?.nome ?? valueIds[0];
    }
    return `${valueIds.length} selecionados`;
  }, [valueIds, responsaveis]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeIds(Array.from(next));
  }

  return (
    <Popover modal={true} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="h-8 w-full justify-between">
          <span className="truncate flex items-center gap-2">
            <Users className="h-4 w-4" />
            {label}
          </span>
          <span className="text-xs text-muted-foreground">{valueIds.length || 0}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent 
      onWheel={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                        onOpenAutoFocus={(e) => e.preventDefault()}
      align="start" className="w-[320px] p-0">
        <Command>
          <CommandInput className="text-base" placeholder="Buscar usuário..." />
          <CommandList>
            <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>

            <CommandGroup heading="Usuários ativos">
              {responsaveis.map((u) => {
                const checked = selected.has(u.id);

                return (
                  <CommandItem
                    key={u.id}
                    value={`${u.nome ?? ""} ${u.id}`}
                    onSelect={() => toggle(u.id)}
                    className="flex items-center gap-2"
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <span className="truncate">{u.nome ?? u.id}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        {valueIds.length > 0 && (
          <div className="border-t p-2 flex flex-wrap gap-1">
            {valueIds.slice(0, 6).map((id) => {
              const nome = responsaveis.find((r) => r.id === id)?.nome ?? id;
              return (
                <Badge key={id} variant="secondary" className="truncate max-w-[140px]">
                  {nome}
                </Badge>
              );
            })}
            {valueIds.length > 6 && <Badge variant="outline">+{valueIds.length - 6}</Badge>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 ml-auto"
              onClick={() => onChangeIds([])}
              disabled={disabled}
              title="Limpar realizadores"
            >
              Limpar
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function OSDetalhesDialog({
  open,
  onOpenChange,
  osId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OSDetalhesResponse | null>(null);

  const [responsaveis, setResponsaveis] = useState<UsuarioAtivo[]>([]);
  const [loadingResponsaveis, setLoadingResponsaveis] = useState(false);
  const [savingResponsavelKey, setSavingResponsavelKey] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState("resumo");
  const [eventoDialogOpen, setEventoDialogOpen] = useState(false);
  const [eventoNatureza, setEventoNatureza] = useState<"RECEITA" | "DESPESA">("DESPESA");
  const [eventoDescricao, setEventoDescricao] = useState("");
  const [eventoDetalhe, setEventoDetalhe] = useState("");
  const [eventoValor, setEventoValor] = useState(0);
  const [salvandoEvento, setSalvandoEvento] = useState(false);
  const [eventoEdicao, setEventoEdicao] = useState<{ id: number; descricao: string; valor: number } | null>(null);
  const [valorSnapshotEdicao, setValorSnapshotEdicao] = useState(0);
  const [eventoConvertidoParaEditar, setEventoConvertidoParaEditar] = useState<{
    id: number;
    descricao: string;
    valor: number;
    transacaoId: number;
  } | null>(null);
  const [excluindoTransacaoEvento, setExcluindoTransacaoEvento] = useState(false);
  const [salvandoSnapshot, setSalvandoSnapshot] = useState(false);
  const [sincronizandoCustoId, setSincronizandoCustoId] = useState<number | null>(null);
  const [produtoDialogId, setProdutoDialogId] = useState<number | undefined>();
  const [produtoDialogOpen, setProdutoDialogOpen] = useState(false);
  const [baixaDialogOpen, setBaixaDialogOpen] = useState(false);
  const [despesaParaBaixa, setDespesaParaBaixa] = useState<Transaction | null>(null);
  const [eventoParaLancamento, setEventoParaLancamento] = useState<{
    id: number;
    tipo: "ENTRADA" | "SAIDA";
    descricao: string;
    valor: number;
  } | null>(null);
  const [anexos, setAnexos] = useState<OsAnexo[]>([]);
  const [anexoCategoria, setAnexoCategoria] = useState<OsAnexoCategoria>("OUTROS");
  const [loadingAnexos, setLoadingAnexos] = useState(false);
  const [uploadingAnexo, setUploadingAnexo] = useState(false);
  const [deletingAnexoId, setDeletingAnexoId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canFetch = open && !!osId;
  const maxAnexosPorOs = 10;

  const statusUpper = (data?.os?.status || "").toUpperCase();
  const osFinalizada = ["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"].includes(statusUpper);

  const podeEditarResponsavel = useMemo(
    () => statusUpper === "ORCAMENTO_APROVADO" || statusUpper === "EM_ANDAMENTO",
    [statusUpper]
  );

  const temServicoSemResponsavel = useMemo(() => {
    return (data?.itensServico ?? []).some((s) => getIdsFromItem(s).length === 0);
  }, [data?.itensServico]);

  const mostrarAlertaAntesDeIniciar = useMemo(
    () => statusUpper === "ORCAMENTO_APROVADO" && temServicoSemResponsavel,
    [statusUpper, temServicoSemResponsavel]
  );

  const recarregarDetalhes = useCallback(async () => {
    if (!osId) return;
    try {
      setLoading(true);
      const [j, eventosResponse, auditoriaResponse] = await Promise.all([
        carregarDetalhesOS<OSDetalhesResponse>(osId),
        fetch(`/api/ordens/${osId}/eventos-financeiros`, { cache: "no-store" }),
        fetch(`/api/ordens/${osId}/auditoria-resumo`, { cache: "no-store" }),
      ]);
      const eventosPayload = await eventosResponse.json().catch(() => ({}));
      if (!eventosResponse.ok) throw new Error(eventosPayload?.error || "Erro ao carregar eventos financeiros");
      const auditoriaPayload = await auditoriaResponse.json().catch(() => ({}));
      setData({
        ...j,
        eventosFinanceiros: eventosPayload?.eventos ?? [],
        auditoriaResumo: auditoriaResponse.ok && Array.isArray(auditoriaPayload?.itens)
          ? auditoriaPayload.itens
          : [],
      });
    } catch (e: any) {
      toast.error(e?.message || "Erro ao carregar detalhes");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [osId]);

  useEffect(() => {
    if (canFetch) void recarregarDetalhes();
  }, [canFetch, recarregarDetalhes]);

  const carregarAnexos = useCallback(async () => {
    if (!osId) {
      setAnexos([]);
      return;
    }

    setLoadingAnexos(true);
    try {
      const response = await fetch(`/api/ordens/${osId}/anexos`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao carregar anexos");
      setAnexos(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error: any) {
      setAnexos([]);
      toast.error(error?.message || "Não foi possível carregar os anexos da OS");
    } finally {
      setLoadingAnexos(false);
    }
  }, [osId]);

  useEffect(() => {
    if (!canFetch) {
      setAnexos([]);
      return;
    }

    void carregarAnexos();
  }, [canFetch, carregarAnexos]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      setLoadingResponsaveis(true);
      try {
        const lista = await listarUsuariosAtivos();
        if (!cancelled) setResponsaveis(lista);
      } catch (e: any) {
        if (!cancelled) {
          console.error(e);
          toast.error("Não foi possível carregar os usuários ativos");
        }
      } finally {
        if (!cancelled) setLoadingResponsaveis(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) setCurrentTab("resumo");
  }, [open, osId]);

  const titulo = useMemo(() => (data?.os?.id ? `Detalhes da OS #${data.os.id}` : "Detalhes da OS"), [data?.os?.id]);

  const statusBadge = useMemo(() => {
    const st = (data?.os?.status || "ORCAMENTO").toUpperCase();
    return <Badge className={statusClasses[st] ?? ""}>{st.replaceAll("_", " ")}</Badge>;
  }, [data?.os?.status]);

  const prioBadge = useMemo(() => {
    const p = (data?.os?.prioridade || "").toUpperCase();
    return p ? <Badge className={prioClasses[p] ?? ""}>{p}</Badge> : null;
  }, [data?.os?.prioridade]);

  const totalProdutos = useMemo(
    () =>
      (data?.itensProduto || []).reduce((acc, it) => acc + Number(it.subtotal || 0), 0) +
      (data?.itensProdutoAvulso || []).reduce((acc, it) => acc + Number(it.subtotal || 0), 0),
    [data?.itensProduto, data?.itensProdutoAvulso]
  );
  const totalServicos = useMemo(
    () => (data?.itensServico || []).reduce((acc, it) => acc + Number(it.subtotal || 0), 0),
    [data?.itensServico]
  );
  const subtotalOS = useMemo(
    () => arredondarMoeda(totalProdutos + totalServicos),
    [totalProdutos, totalServicos]
  );
  const descontoGeralAplicado = useMemo(
    () => calcularDescontoAplicado(subtotalOS, data?.os?.desconto_tipo, data?.os?.desconto),
    [data?.os?.desconto, data?.os?.desconto_tipo, subtotalOS]
  );
  const totalGeral = useMemo(
    () => {
      const totalSalvo = Number(data?.os?.orcamentototal);
      if (data?.os?.orcamentototal != null && Number.isFinite(totalSalvo)) return totalSalvo;
      return calcularTotalComDesconto(subtotalOS, data?.os?.desconto_tipo, data?.os?.desconto);
    },
    [data?.os?.desconto, data?.os?.desconto_tipo, data?.os?.orcamentototal, subtotalOS]
  );

  const fluxoOs = useMemo(() => {
    const lancamentos = (data?.eventosFinanceiros ?? [])
      .filter((evento) => evento.status !== "CANCELADO")
      .map((evento) => ({
        id: evento.id,
        tipo: (evento.natureza === "RECEITA" ? "ENTRADA" : "SAIDA") as "ENTRADA" | "SAIDA",
        descricao: evento.descricao,
        detalhe: evento.detalhe || evento.origem,
        valor: Number(evento.valor || 0),
        origem: evento.origem,
        status: evento.status,
        produtoid: evento.produtoid ?? null,
        podeGerarTransacao: evento.pode_gerar_transacao,
        grupo:
          evento.origem === "PRODUTO"
            ? `0-produto-${evento.produtoid ?? evento.chave_origem ?? evento.id}`
            : evento.origem === "SERVICO" || evento.origem === "COMISSAO"
              ? `1-servico-${evento.servicoid ?? evento.chave_origem?.split(":")[0] ?? evento.id}`
              : `2-avulso-${String(evento.id).padStart(12, "0")}`,
        ordemNoGrupo:
          evento.origem === "PRODUTO"
            ? evento.natureza === "DESPESA" ? 0 : 1
            : evento.origem === "SERVICO" ? 0 : evento.origem === "COMISSAO" ? 1 : 0,
      }));

    return lancamentos.sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR", { numeric: true }) || a.ordemNoGrupo - b.ordemNoGrupo || a.id - b.id);
  }, [data?.eventosFinanceiros]);
  const totaisEventos = useMemo(() => {
    const receita = fluxoOs.filter((item) => item.tipo === "ENTRADA").reduce((soma, item) => soma + item.valor, 0);
    const despesa = fluxoOs.filter((item) => item.tipo === "SAIDA").reduce((soma, item) => soma + item.valor, 0);
    return { receita, despesa, liquido: receita - despesa };
  }, [fluxoOs]);

  async function adicionarEventoAvulso() {
    if (!osId) return;
    setSalvandoEvento(true);
    try {
      const response = await fetch(`/api/ordens/${osId}/eventos-financeiros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ natureza: eventoNatureza, descricao: eventoDescricao, detalhe: eventoDetalhe, valor: eventoValor }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao adicionar evento");
      setEventoDialogOpen(false);
      setEventoDescricao(""); setEventoDetalhe(""); setEventoValor(0);
      toast.success("Evento financeiro registrado.");
      await recarregarDetalhes();
    } catch (error: any) { toast.error(error?.message || "Erro ao adicionar evento"); }
    finally { setSalvandoEvento(false); }
  }

  function abrirEdicaoSnapshot(id: number, descricao: string, valor: number, status: string, transacaoId?: number | null) {
    if (status === "CONVERTIDO") {
      if (!transacaoId) {
        toast.error("A transação vinculada não foi localizada.");
        return;
      }
      setEventoConvertidoParaEditar({ id, descricao, valor, transacaoId });
      return;
    }
    setEventoEdicao({ id, descricao, valor });
    setValorSnapshotEdicao(valor);
  }

  async function excluirTransacaoEEditarEvento() {
    if (!eventoConvertidoParaEditar) return;
    setExcluindoTransacaoEvento(true);
    try {
      const response = await fetch(`/api/transaction/${eventoConvertidoParaEditar.transacaoId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao excluir a transação vinculada");
      const evento = eventoConvertidoParaEditar;
      setEventoConvertidoParaEditar(null);
      setEventoEdicao({ id: evento.id, descricao: evento.descricao, valor: evento.valor });
      setValorSnapshotEdicao(evento.valor);
      toast.success("Transação excluída. O evento está disponível para edição e novo lançamento.");
      await recarregarDetalhes();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao excluir a transação vinculada");
    } finally {
      setExcluindoTransacaoEvento(false);
    }
  }

  async function salvarSnapshot() {
    if (!osId || !eventoEdicao) return;
    setSalvandoSnapshot(true);
    try {
      const response = await fetch(`/api/ordens/${osId}/eventos-financeiros/${eventoEdicao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: valorSnapshotEdicao }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao alterar snapshot");
      setEventoEdicao(null);
      toast.success("Valor do snapshot atualizado.");
      await recarregarDetalhes();
    } catch (error: any) { toast.error(error?.message || "Erro ao alterar snapshot"); }
    finally { setSalvandoSnapshot(false); }
  }

  async function sincronizarUltimoCusto(eventoId: number) {
    if (!osId) return;
    setSincronizandoCustoId(eventoId);
    const toastId = toast.loading("Sincronizando último valor de entrada...", { duration: Infinity });
    try {
      const response = await fetch(`/api/ordens/${osId}/eventos-financeiros/${eventoId}/sincronizar-ultimo-custo`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao sincronizar último valor de entrada");
      toast.success("Último valor de entrada sincronizado.", { id: toastId, duration: 3000 });
      await recarregarDetalhes();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao sincronizar último valor de entrada", { id: toastId, duration: 4000 });
    }
    finally { setSincronizandoCustoId(null); }
  }

  async function sincronizarValorVenda(eventoId: number) {
    if (!osId) return;
    setSincronizandoCustoId(eventoId);
    try {
      const response = await fetch(`/api/ordens/${osId}/eventos-financeiros/${eventoId}/sincronizar-valor-venda`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao sincronizar valor de venda");
      toast.success("Valor de venda sincronizado.");
      await recarregarDetalhes();
    } catch (error: any) { toast.error(error?.message || "Erro ao sincronizar valor de venda"); }
    finally { setSincronizandoCustoId(null); }
  }

  function visualizarProduto(produtoid: number) {
    setProdutoDialogId(produtoid);
    setProdutoDialogOpen(true);
  }

  const tabTriggerClass =
    "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

  const checklistAutores = useMemo(() => {
    const nomes = (data?.checklist ?? [])
      .map((c) => c.usuario?.nome)
      .filter((x): x is string => Boolean(x && x.trim()));
    return [...new Set(nomes)];
  }, [data?.checklist]);

  const motivoCancelamento = useMemo(() => {
    const os: any = data?.os;
    return (
      os?.motivoCancelamento ??
      os?.motivo_cancelamento ??
      os?.motivocancelamento ??
      os?.motivo ??
      ""
    );
  }, [data?.os]);

  const motivoSemCobranca = useMemo(() => {
    const os: any = data?.os;
    return os?.motivo_sem_cobranca ?? os?.motivosemcobranca ?? "";
  }, [data?.os]);

  async function salvarRealizadores(item: ItemServico, usuarioIds: string[]) {
    if (!data?.os?.id) return;

    const key = `${item.ordemservicoid}-${item.servicoid}`;
    setSavingResponsavelKey(key);

    const ids = uniq(usuarioIds.filter(Boolean));
    const otimista = buildRealizadoresFromIds(ids, responsaveis);
    const principal = ids[0] ?? null;

    setData((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            itensServico: prev.itensServico.map((s) =>
              s.ordemservicoid === item.ordemservicoid && s.servicoid === item.servicoid
                ? {
                    ...s,
                    realizadores: otimista,
                    idusuariorealizador: principal,
                    realizador: principal ? { id: principal, nome: otimista[0]?.nome ?? null } : null,
                  }
                : s
            ),
          }
    );

    try {
      const resp = await putRealizadores(data.os.id, item.servicoid, ids);

      setData((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              itensServico: prev.itensServico.map((s) =>
                s.ordemservicoid === resp.ordemservicoid && s.servicoid === resp.servicoid
                  ? {
                      ...s,
                      realizadores: resp.realizadores ?? [],
                      idusuariorealizador: resp.idusuariorealizador,
                      realizador: resp.idusuariorealizador
                        ? {
                            id: resp.idusuariorealizador,
                            nome: resp.realizadores?.find((r) => r.id === resp.idusuariorealizador)?.nome ?? null,
                          }
                        : null,
                    }
                  : s
              ),
            }
      );

      toast.success("Realizadores atualizados");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao atualizar realizadores");
    } finally {
      setSavingResponsavelKey(null);
    }
  }

  async function handleAnexoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !osId) return;

    if (anexos.length >= maxAnexosPorOs) {
      toast.error(`Limite de ${maxAnexosPorOs} anexos por OS atingido.`);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("categoria", anexoCategoria);

    setUploadingAnexo(true);
    try {
      const response = await fetch(`/api/ordens/${osId}/anexos`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao anexar arquivo");

      toast.success("Anexo adicionado");
      await carregarAnexos();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível anexar o arquivo");
    } finally {
      setUploadingAnexo(false);
    }
  }

  async function handleDeleteAnexo(anexoId: number) {
    if (!osId) return;

    setDeletingAnexoId(anexoId);
    try {
      const response = await fetch(`/api/ordens/${osId}/anexos/${anexoId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Erro ao remover anexo");

      setAnexos((prev) => prev.filter((anexo) => anexo.id !== anexoId));
      toast.success("Anexo removido");
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível remover o anexo");
    } finally {
      setDeletingAnexoId(null);
    }
  }

  async function baixarImagem(url: string, filename: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Falha ao baixar imagem");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "imagem";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      toast.error("Não foi possível baixar automaticamente. A imagem foi aberta em nova aba.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col rounded-none
          sm:w-[95vw] sm:rounded-lg
          md:max-w-[1100px]
          overflow-hidden
          !gap-0 p-0
        "
        showCloseButton={!loading}
      >
        {!loading ? (
        <div className="shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b relative">
          <DialogHeader className="gap-0 px-5 py-4 pr-12">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Link2 className="h-5 w-5 shrink-0 text-primary" />
                    <span className="truncate">{titulo}</span>
                  </span>
                  {statusBadge}
                  {prioBadge}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  Informações completas da OS, itens, checklist, responsáveis e links de aprovação.
                </DialogDescription>
              </div>

              <span className="grid grid-cols-2 gap-2 text-left sm:ml-auto sm:min-w-[260px] sm:text-right">
                <span className="rounded-md border bg-card px-2.5 py-1.5">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Entrada
                  </span>
                  <span className="block text-xs font-semibold text-foreground">{fmtDate(data?.os?.dataentrada)}</span>
                </span>
                <span className="rounded-md border bg-card px-2.5 py-1.5">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Saída real
                  </span>
                  <span className="block text-xs font-semibold text-foreground">{fmtDate(data?.os?.datasaida)}</span>
                </span>
              </span>
            </div>
          </DialogHeader>
        </div>
        ) : null}

        <div className={loading ? "min-h-0 flex-1 overflow-hidden p-0" : "min-h-0 flex-1 overflow-hidden pb-0"}>
          {loading ? (
            <>
              <div className="sr-only">
                <DialogTitle>{titulo}</DialogTitle>
                <DialogDescription>Carregando detalhes da OS</DialogDescription>
              </div>
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <div className="size-8 animate-spin rounded-full border-t-2 border-primary" />
                <span className="text-sm font-medium text-primary">Carregando</span>
              </div>
            </>
          ) : !data ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Não foi possível carregar os detalhes.</div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <Tabs value={currentTab} onValueChange={setCurrentTab} className="flex-1 min-h-0 overflow-hidden pb-0">
                <div className="sticky top-0 z-10 mt-4 shrink-0">
                  <div className="overflow-x-auto px-2 pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                  <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                    <TabsTrigger value="resumo" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Resumo
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="itens" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Itens
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="checklist" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <ListChecks className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Checklist
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="rentabilidade" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Calculator className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Rentabilidade
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="fluxo-os" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <ListTree className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Eventos Financeiros
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="anexos" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Anexos
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="aprovacao" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                        Aprovação
                      </span>
                    </TabsTrigger>
                  </TabsList>
                  </div>
                </div>

                <TabsContent value="resumo" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5">
              {/* Resumo */}
              <div>
                <h3 className="text-sm font-semibold">Identificação e condições</h3>
                <p className="text-xs text-muted-foreground">Dados principais para consulta rápida da ordem de serviço.</p>
              </div>
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <User2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Cliente</span>
                  </div>
                  <div className="text-sm">{data.os.cliente?.nomerazaosocial ?? "—"}</div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Setor</span>
                  </div>
                  <div className="text-sm">{data.os.setor?.nome ?? "—"}</div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    {data.os.alvo_tipo === "VEICULO" ? <Car className="h-4 w-4 text-primary" /> : <Wrench className="h-4 w-4 text-primary" />}
                    <span className="text-sm font-medium">
                      {data.os.alvo_tipo === "PECA"
                        ? "Peça"
                        : data.os.alvo_tipo === "EQUIPAMENTO"
                          ? "Máquina/Equipamento"
                          : "Veículo"}
                    </span>
                  </div>
                  {data.os.alvo_tipo === "PECA" ? (
                    <div className="text-sm space-y-1">
                      <div>{data.os.peca?.titulo ?? "Peça (detalhes não informados)"}</div>
                      {data.os.peca?.lacre ? (
                        <div className="text-xs text-muted-foreground">Lacre: {data.os.peca.lacre}</div>
                      ) : null}
                      {data.os.peca?.descricao ? (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {data.os.peca.descricao}
                        </div>
                      ) : null}
                    </div>
                  ) : data.os.alvo_tipo === "EQUIPAMENTO" ? (
                    <div className="space-y-1 text-sm">
                      <div className="font-medium">{data.os.equipamento?.nome ?? "Equipamento"}</div>
                      {data.os.equipamento?.patrimonio ? (
                        <div className="text-xs text-muted-foreground">Patrimônio: {data.os.equipamento.patrimonio}</div>
                      ) : null}
                      {data.os.equipamento?.ano != null ? (
                        <div className="text-xs text-muted-foreground">Ano: {data.os.equipamento.ano}</div>
                      ) : null}
                      {data.os.equipamento?.horimetro != null ? (
                        <div className="text-xs text-muted-foreground">Horímetro: {data.os.equipamento.horimetro} h</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-sm">
                      {data.os.veiculo
                        ? `${data.os.veiculo.marca ?? ""} ${data.os.veiculo.modelo ?? ""} • ${data.os.veiculo.placa ?? ""}`.trim()
                        : "—"}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CheckSquare className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Status de Aprovação</span>
                  </div>
                  <div className="text-sm">{data.os.statusaprovacao ?? "—"}</div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CreditCard className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Forma de pagamento prevista</span>
                  </div>
                  {data.os.pagamentos_previstos?.length ? (
                    <div className="space-y-1 text-sm">
                      {data.os.pagamentos_previstos.map((pagamento) => (
                        <div key={pagamento.metodo}>
                          {PAYMENT_METHOD_OPTIONS.find(
                            (method) => method.value === pagamento.metodo,
                          )?.label ?? pagamento.metodo}
                          {pagamento.parcelas ? ` em ${pagamento.parcelas}x` : ""}
                          {" — "}
                          {fmtMoney(pagamento.valor)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm">
                      {PAYMENT_METHOD_OPTIONS.find(
                        (method) => method.value === data.os.forma_pagamento,
                      )?.label ?? "Não informada"}
                      {data.os.parcelas_pagamento
                        ? ` em ${data.os.parcelas_pagamento}x`
                        : ""}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CheckSquare className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Garantia</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {data.os.garantia || "Não informada"}
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 md:col-span-2 xl:col-span-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Descrição para o financeiro</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {data.os.descricao_financeiro || "Não informada"}
                  </div>
                </div>
              </section>

              <div>
                <h3 className="text-sm font-semibold">Informações complementares</h3>
                <p className="text-xs text-muted-foreground">Descrição, observações e justificativas da OS.</p>
              </div>

              {/* Descrição / Observações / Motivo */}
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border bg-card p-4 md:col-span-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Descrição</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{data.os.descricao || "—"}</div>
                </div>

                {data.os.observacoes ? (
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StickyNote className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Observações internas</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{data.os.observacoes}</div>
                  </div>
                ) : null}

                {data.os.observacoes_fiscais ? (
                  <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StickyNote className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Observações fiscais</span>
                  </div>
                    <div className="text-sm whitespace-pre-wrap">{data.os.observacoes_fiscais}</div>
                  </div>
                ) : null}

                {motivoCancelamento ? (
                  <div className="rounded-lg border border-red-500/25 bg-card p-4 md:col-span-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium">Motivo do cancelamento</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{motivoCancelamento}</div>
                  </div>
                ) : null}

                {motivoSemCobranca ? (
                  <div className="rounded-lg border border-amber-500/25 bg-card p-4 md:col-span-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium">Motivo sem cobrança</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{motivoSemCobranca}</div>
                  </div>
                ) : null}
              </section>

              <section className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-start gap-3 border-b px-4 py-4 sm:px-5">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <History className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Histórico de atividades da OS</h3>
                    <p className="text-xs text-muted-foreground">
                      Da criação à finalização, incluindo ações de usuários e respostas do cliente.
                    </p>
                  </div>
                </div>

                {(data.auditoriaResumo ?? []).length ? (
                  <ol className="px-4 py-2 sm:px-5">
                    {(data.auditoriaResumo ?? []).map((evento, index, eventos) => (
                      <li key={evento.id} className="relative flex gap-3 py-3">
                        {index < eventos.length - 1 ? (
                          <span className="absolute bottom-0 left-[5px] top-5 w-px bg-border" aria-hidden="true" />
                        ) : null}
                        <span
                          className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${auditDotClass(evento.tipo)}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="text-sm">
                              <span className="font-semibold">{evento.usuario.nome}</span>
                              <span className="text-muted-foreground"> · {evento.titulo}</span>
                            </div>
                            <time className="shrink-0 text-xs text-muted-foreground">
                              {fmtDate(evento.ocorridoEm)}
                            </time>
                          </div>
                          {evento.detalhe ? (
                            <p className="mt-1 text-xs text-muted-foreground">{evento.detalhe}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <History className="mx-auto h-6 w-6 text-muted-foreground/50" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Ainda não há atividades registradas para esta OS.
                    </p>
                  </div>
                )}
              </section>

              {/* Produtos / Serviços / Totais */}
                </TabsContent>

                <TabsContent value="itens" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5">
              {mostrarAlertaAntesDeIniciar && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-800 dark:bg-amber-500/10  px-4 py-3 text-xs text-amber-100 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" />
                  <div>
                    <div className="font-medium text-amber-100">Defina o responsável pelos serviços antes de iniciar a OS.</div>
                    <div className="text-amber-100/80">
                      Há serviços sem responsável atribuído. Recomenda-se escolher quem irá executar cada serviço antes de clicar em{" "}
                      <b>Iniciar</b>.
                    </div>
                  </div>
                </div>
              )}
              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* PRODUTOS */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Produtos</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      Total: <b>{fmtMoney(totalProdutos)}</b>
                    </span>
                  </div>
                  {(data.itensProduto ?? []).length === 0 && (data.itensProdutoAvulso ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">—</div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {data.itensProduto.map((it, idx) => {
                        const descontoAplicado = calcularDescontoAplicado(
                          Number(it.quantidade || 0) * Number(it.precounitario || 0),
                          it.descontoTipo,
                          it.desconto
                        );

                        return (
                          <li key={`${it.ordemservicoid}-${it.produtoid}-${idx}`} className="flex flex-col gap-1 rounded-md border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                {it.produto?.titulo || it.produto?.descricao || it.produto?.codigo ||  `Produto #${it.produtoid}`}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {it.quantidade} × {fmtMoney(it.precounitario)}
                              </div>
                              {descontoAplicado > 0 ? (
                                <div className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  Desconto: - {fmtMoney(descontoAplicado)}
                                  {it.descontoTipo === "PORCENTAGEM"
                                    ? ` (${fmtPercent(it.desconto)}%)`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                            <div className="shrink-0 font-medium sm:text-right">{fmtMoney(it.subtotal)}</div>
                          </li>
                        );
                      })}
                      {(data.itensProdutoAvulso ?? []).map((it) => (
                        <li key={`avulso-${it.id}`} className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="truncate">{it.titulo}</span>
                              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">Avulso pendente</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{it.quantidade} × {fmtMoney(it.precounitario)}</div>
                          </div>
                          <div className="shrink-0 font-medium sm:text-right">{fmtMoney(it.subtotal)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* SERVIÇOS */}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Wrench className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Serviços</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      Total: <b>{fmtMoney(totalServicos)}</b>
                    </span>
                  </div>

                  {(data.itensServico ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">—</div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {data.itensServico.map((it, idx) => {
                        const rowKey = `${it.ordemservicoid}-${it.servicoid}-${idx}`;
                        const isSaving = savingResponsavelKey === `${it.ordemservicoid}-${it.servicoid}`;
                        const selectedIds = getIdsFromItem(it);
                        const estaSemResponsavel = selectedIds.length === 0;
                        const descontoAplicado = calcularDescontoAplicado(
                          Number(it.quantidade || 0) * Number(it.precounitario || 0),
                          it.descontoTipo,
                          it.desconto
                        );

                        return (
                          <li key={rowKey} className="flex flex-col gap-2 rounded-md border bg-muted/20 px-3 py-2">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                              <div className="min-w-0">
                                <div className="font-medium truncate">
                                  {it.servico?.descricao || it.servico?.codigo || `Serviço #${it.servicoid}`}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {it.quantidade} × {fmtMoney(it.precounitario)}
                                </div>
                                {descontoAplicado > 0 ? (
                                  <div className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                    Desconto: - {fmtMoney(descontoAplicado)}
                                    {it.descontoTipo === "PORCENTAGEM"
                                      ? ` (${fmtPercent(it.desconto)}%)`
                                      : ""}
                                  </div>
                                ) : null}
                              </div>
                              <div className="shrink-0 font-medium sm:text-right">{fmtMoney(it.subtotal)}</div>
                            </div>

                            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                              <div className="flex items-start gap-2">
                                <User2 className="h-3.5 w-3.5 mt-0.5" />

                                {podeEditarResponsavel ? (
                                  <div className="w-full max-w-sm">
                                    <MultiSelectRealizadores
                                      disabled={isSaving || loadingResponsaveis}
                                      responsaveis={responsaveis}
                                      valueIds={selectedIds}
                                      onChangeIds={(ids) => salvarRealizadores(it, ids)}
                                    />
                                  </div>
                                ) : (
                                  <span>
                                    Responsável: <b>{it.realizador?.nome ?? "—"}</b>
                                  </span>
                                )}
                              </div>

                              {podeEditarResponsavel && estaSemResponsavel && statusUpper === "ORCAMENTO_APROVADO" && (
                                <span className="text-[11px] text-amber-400 flex items-center gap-1 ml-5">
                                  <AlertTriangle className="h-3 w-3" />
                                  Selecione o responsável antes de iniciar a OS.
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border bg-card p-4 lg:col-span-2">
                  <div className="mb-3 flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Resumo financeiro</span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>Produtos</span>
                      <span className="tabular-nums">{fmtMoney(totalProdutos)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>Serviços</span>
                      <span className="tabular-nums">{fmtMoney(totalServicos)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="tabular-nums">{fmtMoney(subtotalOS)}</span>
                    </div>
                    {descontoGeralAplicado > 0 ? (
                      <div className="flex items-center justify-between gap-4 font-medium text-emerald-600 dark:text-emerald-400">
                        <span>
                          Desconto geral
                          {data.os.desconto_tipo === "PORCENTAGEM"
                            ? ` (${fmtPercent(data.os.desconto)}%)`
                            : ""}
                        </span>
                        <span className="tabular-nums">- {fmtMoney(descontoGeralAplicado)}</span>
                      </div>
                    ) : null}
                    <Separator />
                    <div className="flex items-center justify-between gap-4 pt-1">
                      <span className="font-medium">Total geral</span>
                      <span className="text-lg font-semibold tabular-nums">{fmtMoney(totalGeral)}</span>
                    </div>
                  </div>
                </div>
              </section>

                </TabsContent>

                <TabsContent value="rentabilidade" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5">
                  {data.rentabilidade ? (
                    <>
                      {/* <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Receipt className="h-4 w-4 text-primary" />
                            <p className="font-medium">Resultado interno da OS</p>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Custos e despesas desta aba não são exibidos ao cliente.
                          </p>
                        </div>
                        <Button type="button" size="sm" onClick={() => setEventoDialogOpen(true)}>
                          Adicionar evento avulso
                        </Button>
                      </div> */}
{/* 
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          ["Valor final da OS", data.rentabilidade.valorFinalOs],
                          ["Recebido bruto", data.rentabilidade.recebidoBruto],
                          ["Taxas de recebimento", data.rentabilidade.taxasRecebimento],
                          ["Recebido líquido", data.rentabilidade.recebidoLiquido],
                          ["Custo dos produtos", data.rentabilidade.custoProdutos],
                          ["Comissões dos serviços", data.rentabilidade.totalComissoesServicos],
                          ["Despesas pagas", data.rentabilidade.despesasPagas],
                          ["Despesas pendentes", data.rentabilidade.despesasPendentes],
                          ["Saldo a receber", data.rentabilidade.saldoAReceber],
                        ].map(([rotulo, valor]) => (
                          <div key={String(rotulo)} className="rounded-xl border bg-card p-3">
                            <p className="text-xs text-muted-foreground">{rotulo}</p>
                            <p className="mt-1 text-lg font-semibold">{fmtMoney(Number(valor))}</p>
                          </div>
                        ))}
                      </div> */}

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-xs text-muted-foreground">Lucro previsto</p>
                          <p className="mt-1 text-2xl font-semibold">{fmtMoney(data.rentabilidade.lucroPrevisto)}</p>
                          <p className="text-xs text-muted-foreground">Margem {data.rentabilidade.margemPrevista.toFixed(2)}%</p>
                        </div>
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-xs text-muted-foreground">Lucro realizado</p>
                          <p className="mt-1 text-2xl font-semibold">{fmtMoney(data.rentabilidade.lucroRealizado)}</p>
                          <p className="text-xs text-muted-foreground">Margem {data.rentabilidade.margemRealizada.toFixed(2)}%</p>
                        </div>
                      </div>

                      {data.rentabilidade.itensCustoEstimado > 0 ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <span>
                            {data.rentabilidade.itensCustoEstimado} produto(s) antigo(s) sem custo registrado na OS; foi usado o último valor de compra atual como estimativa.
                          </span>
                        </div>
                      ) : null}

                      {data.rentabilidade.itensSemCusto > 0 ? (
                        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                          <span>
                            {data.rentabilidade.itensSemCusto} produto(s) sem último valor de compra. O custo foi considerado como zero e deve ser cadastrado para corrigir o lucro.
                          </span>
                        </div>
                      ) : null}

                      <div className="rounded-xl border bg-card p-4">
                        <p className="font-medium">Rentabilidade por produto</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Lucro bruto do item após descontos, antes das demais despesas da OS.
                        </p>
                        <div className="mt-3 space-y-2">
                          {data.rentabilidade.produtos.length ? (
                            data.rentabilidade.produtos.map((produto) => (
                              <div key={produto.produtoid} className="rounded-lg border p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{produto.descricao}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {produto.quantidade} un. · Venda {fmtMoney(produto.receitaLiquida)} · Custo {fmtMoney(produto.custoTotal)}
                                    </p>
                                  </div>
                                  <div className="text-left sm:text-right">
                                    <p className="font-semibold">{fmtMoney(produto.lucroBruto)}</p>
                                    <p className="text-xs text-muted-foreground">Margem {produto.margemBruta.toFixed(2)}%</p>
                                  </div>
                                </div>
                                {produto.custoNaoInformado ? (
                                  <p className="mt-2 text-xs text-red-500">Custo não informado; cálculo provisório.</p>
                                ) : produto.custoEstimado ? (
                                  <p className="mt-2 text-xs text-amber-500">Custo estimado pelo último valor de compra atual.</p>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum produto nesta OS.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-card p-4">
                        <p className="font-medium">Comissões por serviço</p>
                        <div className="mt-3 space-y-2">
                          {data.rentabilidade.comissoesServicos.some(
                            (servico) => servico.realizadores.length > 0,
                          ) ? (
                            data.rentabilidade.comissoesServicos
                              .filter((servico) => servico.realizadores.length > 0)
                              .map((servico) => (
                                <div key={servico.servicoid} className="rounded-lg border p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="truncate text-sm font-medium">{servico.descricao}</p>
                                    <span className="font-medium">{fmtMoney(servico.valorComissao)}</span>
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    {servico.realizadores.map((realizador) => (
                                      <div key={realizador.usuarioid} className="flex justify-between gap-3 text-xs text-muted-foreground">
                                        <span className="truncate">{realizador.nome || "Realizador"} · {realizador.percentual.toFixed(2)}%</span>
                                        <span>{fmtMoney(realizador.valorComissao)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                          ) : (
                            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma comissão de serviço nesta OS.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-card p-4">
                        <p className="font-medium">Despesas vinculadas</p>
                        <div className="mt-3 space-y-2">
                          {(data.transacoes ?? []).filter((t) => t.tipo === "DESPESA").length ? (
                            (data.transacoes ?? []).filter((t) => t.tipo === "DESPESA").map((t) => (
                              <div key={t.id} className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{t.descricao}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {fmtDate(t.data)}{t.plano_de_conta ? ` · ${t.plano_de_conta}` : ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={t.pendente ? "outline" : "default"}>{t.pendente ? "A pagar" : "Pago"}</Badge>
                                  <span className="font-medium">{fmtMoney(t.valor)}</span>
                                  {t.pendente ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setDespesaParaBaixa({ ...t, data: new Date(t.data) } as Transaction);
                                        setBaixaDialogOpen(true);
                                      }}
                                    >
                                      Dar baixa
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma despesa vinculada.</p>
                          )}
                        </div>
                      </div>
                      <ConcluidoAlert
                        isAlertOpen={baixaDialogOpen}
                        setIsAlertOpen={setBaixaDialogOpen}
                        transaction={despesaParaBaixa}
                        onSuccess={() => void recarregarDetalhes()}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Não foi possível calcular a rentabilidade.</p>
                  )}
                </TabsContent>

                <TabsContent value="fluxo-os" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowUp className="size-4 text-emerald-600" /> Receitas</div>
                      <p className="mt-2 text-xl font-semibold text-emerald-600">{fmtMoney(totaisEventos.receita)}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowDown className="size-4 text-red-600" /> Despesas</div>
                      <p className="mt-2 text-xl font-semibold text-red-600">{fmtMoney(totaisEventos.despesa)}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calculator className="size-4 text-primary" /> {osFinalizada ? "Lucro Real" : "Resultado Previsto"}</div>
                      <p className={`mt-2 text-xl font-semibold ${totaisEventos.liquido < 0 ? "text-red-600" : "text-primary"}`}>
                        {fmtMoney(totaisEventos.liquido)}
                      </p>
                    </div>
                  </div>

                  {!osFinalizada ? <div className="flex justify-end">
                    <Button type="button" size="sm" onClick={() => setEventoDialogOpen(true)}>
                      Novo lançamento
                    </Button>
                  </div> : null}

                  <div className="overflow-hidden rounded-xl border bg-card">
                    <div className="hidden grid-cols-[minmax(0,1fr)_130px_130px] gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
                      <span>Lançamento</span>
                      <span className="text-right">Valor</span>
                      <span className="text-right">Ações</span>
                    </div>
                    {fluxoOs.length ? (
                      <div className="divide-y">
                        {fluxoOs.map((lancamento) => (
                          <div key={lancamento.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_130px_130px] sm:items-center">
                            <div className="flex min-w-0 items-start gap-3">
                              <span
                                className={
                                  lancamento.tipo === "ENTRADA"
                                    ? "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400"
                                }
                              >
                                {lancamento.tipo === "ENTRADA" ? (
                                  <ArrowUp className="size-3.5" />
                                ) : (
                                  <ArrowDown className="size-3.5" />
                                )}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium">{lancamento.descricao}</p>
                                  <Badge variant="outline">{lancamento.origem}</Badge>
                                  {lancamento.status === "CONVERTIDO" ? <Badge variant="secondary">Lançado</Badge> : null}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">{lancamento.detalhe}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between sm:block sm:text-right">
                              <span className="text-xs text-muted-foreground sm:hidden">Valor</span>
                              <span className={lancamento.tipo === "ENTRADA" ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-red-600 dark:text-red-400"}>
                                {lancamento.tipo === "ENTRADA" ? "+" : "−"} {fmtMoney(lancamento.valor)}
                              </span>
                            </div>
                            <div className="flex items-center justify-end gap-1 sm:text-right">
                              <span className="mr-auto text-xs text-muted-foreground sm:hidden">Ações</span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Abrir ações do evento">
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                  {!osFinalizada ? (
                                    <DropdownMenuItem onSelect={() => abrirEdicaoSnapshot(
                                      lancamento.id,
                                      lancamento.descricao,
                                      lancamento.valor,
                                      lancamento.status,
                                      data.eventosFinanceiros?.find((item) => item.id === lancamento.id)?.transacaoid,
                                    )}>
                                      <Pencil /> Editar valor do lançamento
                                    </DropdownMenuItem>
                                  ) : null}
                                  {lancamento.produtoid ? (
                                    <DropdownMenuItem onSelect={() => visualizarProduto(lancamento.produtoid!)}>
                                      <Eye /> Visualizar produto
                                    </DropdownMenuItem>
                                  ) : null}
                                  {!osFinalizada && lancamento.origem === "PRODUTO" && lancamento.tipo === "SAIDA" && lancamento.valor === 0 ? (
                                    <DropdownMenuItem disabled={sincronizandoCustoId === lancamento.id} onSelect={() => void sincronizarUltimoCusto(lancamento.id)}>
                                      <RefreshCw className={sincronizandoCustoId === lancamento.id ? "animate-spin" : ""} />
                                      Sincronizar último valor de entrada
                                    </DropdownMenuItem>
                                  ) : null}
                                  {!osFinalizada && lancamento.origem === "PRODUTO" && lancamento.tipo === "ENTRADA" ? (
                                    <DropdownMenuItem disabled={sincronizandoCustoId === lancamento.id} onSelect={() => void sincronizarValorVenda(lancamento.id)}>
                                      <RefreshCw className={sincronizandoCustoId === lancamento.id ? "animate-spin" : ""} />
                                      Sincronizar valor de venda
                                    </DropdownMenuItem>
                                  ) : null}
                                  {lancamento.podeGerarTransacao && lancamento.status === "ATIVO" ? (
                                    <DropdownMenuItem onSelect={() => setEventoParaLancamento({
                                      id: lancamento.id,
                                      tipo: lancamento.tipo,
                                      descricao: lancamento.descricao,
                                      valor: lancamento.valor,
                                    })}>
                                      Lançar no financeiro
                                    </DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="p-6 text-center text-sm text-muted-foreground">Nenhum lançamento disponível para esta OS.</p>
                    )}
                  </div>

                  {eventoParaLancamento ? (
                    <TransactionDialog
                      key={eventoParaLancamento.id}
                      open
                      setOpen={(nextOpen) => {
                        if (!nextOpen) setEventoParaLancamento(null);
                      }}
                      osId={data.os.id}
                      handleGetTransactions={() => void recarregarDetalhes()}
                      internalCompanyExpense={eventoParaLancamento.tipo === "SAIDA"}
                      lockValue
                      initialTransaction={{
                        evento_financeiro_id: eventoParaLancamento.id,
                        tipo: eventoParaLancamento.tipo === "ENTRADA" ? Tipo_transacao.RECEITA : Tipo_transacao.DESPESA,
                        descricao: eventoParaLancamento.descricao,
                        valor: eventoParaLancamento.valor,
                        valorLiquido: eventoParaLancamento.valor,
                        pendente: true,
                        parcelas: 1,
                        data: new Date(),
                      }}
                    />
                  ) : null}

                  <DialogProduto
                    productId={produtoDialogId}
                    isOpen={produtoDialogOpen}
                    setIsOpen={setProdutoDialogOpen}
                    setSelectedProductId={setProdutoDialogId}
                    onAfterSaveProduct={() => void recarregarDetalhes()}
                  />

                  <Dialog open={eventoDialogOpen} onOpenChange={setEventoDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Novo evento financeiro</DialogTitle>
                        <DialogDescription>Registre uma receita ou despesa avulsa vinculada à OS.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 p-4 bg-card rounded-2xl">
                        <label className="block text-sm font-medium">Natureza
                          <select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={eventoNatureza} onChange={(e) => setEventoNatureza(e.target.value as "RECEITA" | "DESPESA")}>
                            <option value="DESPESA">Despesa</option><option value="RECEITA">Receita</option>
                          </select>
                        </label>
                        <label className="block text-sm font-medium">Descrição
                          <input className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={eventoDescricao} onChange={(e) => setEventoDescricao(e.target.value)} />
                        </label>
                        <label className="block text-sm font-medium">Detalhes
                          <input className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={eventoDetalhe} onChange={(e) => setEventoDetalhe(e.target.value)} />
                        </label>
                        <label className="block text-sm font-medium">Valor
                          <ValueInput price={eventoValor} setPrice={setEventoValor} className="mt-1 h-10 w-full" />
                        </label>
                        <Button className="w-full" disabled={salvandoEvento} onClick={() => void adicionarEventoAvulso()}>
                          {salvandoEvento ? "Salvando..." : "Registrar evento"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={Boolean(eventoEdicao)} onOpenChange={(nextOpen) => { if (!nextOpen) setEventoEdicao(null); }}>
                    <DialogContent className="sm:max-w-sm">
                      <DialogHeader>
                        <DialogTitle>Editar valor do snapshot</DialogTitle>
                        <DialogDescription>{eventoEdicao?.descricao}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <label className="block text-sm font-medium">Valor
                          <div className="mt-1">
                            <ValueInput price={valorSnapshotEdicao} setPrice={setValorSnapshotEdicao} />
                          </div>
                        </label>
                        <Button className="w-full" disabled={salvandoSnapshot} onClick={() => void salvarSnapshot()}>
                          {salvandoSnapshot ? "Salvando..." : "Salvar novo valor"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <AlertDialog
                    open={Boolean(eventoConvertidoParaEditar)}
                    onOpenChange={(open) => { if (!open && !excluindoTransacaoEvento) setEventoConvertidoParaEditar(null); }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir transação vinculada?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Este evento já foi lançado no financeiro. Para alterar seu valor, será necessário excluir a transação vinculada. Deseja continuar?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={excluindoTransacaoEvento}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction disabled={excluindoTransacaoEvento} onClick={(event) => { event.preventDefault(); void excluirTransacaoEEditarEvento(); }}>
                          {excluindoTransacaoEvento ? "Excluindo..." : "Excluir e continuar"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TabsContent>

                <TabsContent value="checklist" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6 sm:py-5">
              {/* Checklist */}
              <section className="rounded-lg border bg-card p-4">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 mb-1.5">
                  <ListChecks className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Checklist</span>

                  {checklistAutores.length ? (
                    <span className="text-xs text-muted-foreground sm:ml-auto">
                      Realizado por: <b>{checklistAutores.join(", ")}</b>
                    </span>
                  ) : null}
                </div>

                {(data.checklist ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">—</div>
                ) : (
                  <ul className="text-sm">
                    {data.checklist.map((c, idx) => (
                      <Fragment key={c.id}>
                        {idx > 0 && <Separator className="my-0" />}
                        <li className="py-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="font-medium truncate">{c.item}</div>
                              <div className="text-xs text-muted-foreground">
                                {fmtDate(c.createdat)}
                                {c.usuario?.nome ? ` • por ${c.usuario.nome}` : ""}
                                {c.observacao ? ` • ${c.observacao}` : ""}
                              </div>
                            </div>
                            <Badge variant="outline" className={badgeClassForChecklistStatus(c.status)}>
                              {c.status}
                            </Badge>
                          </div>

                          {Array.isArray(c.imagens) && c.imagens.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <ImageIcon className="h-3.5 w-3.5" />
                                Imagens anexadas
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                {c.imagens.map((img) => {
                                  const name = fileNameFromUrl(img.url);
                                  return (
                                    <div
                                      key={img.id}
                                      className="group relative overflow-hidden rounded-md border bg-muted/20 transition-colors hover:bg-muted"
                                    >
                                      <span className="block aspect-square w-full overflow-hidden bg-muted">
                                        <ChecklistImagePreview
                                          src={img.url}
                                          alt={img.descricao || name}
                                          imageClassName="transition-transform group-hover:scale-[1.02]"
                                        />
                                      </span>
                                      <a
                                        href={img.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex min-w-0 items-center gap-1 px-2 py-1.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                        title="Abrir imagem original em nova aba"
                                      >
                                          <span className="truncate">{img.descricao || name}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                                      </a>
                                      <button
                                        type="button"
                                        className="absolute hover:cursor-pointer right-2 bottom-8 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                                        title="Baixar imagem"
                                        aria-label="Baixar imagem"
                                        onClick={() => void baixarImagem(img.url, name)}
                                      >
                                        <Download className="h-4 w-4" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </li>
                      </Fragment>
                    ))}
                  </ul>
                )}
              </section>

              {/* Links de aprovação */}
                </TabsContent>

                <TabsContent value="anexos" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5">
                  <section className="rounded-lg border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Paperclip className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Anexos da OS</span>
                          <Badge variant="outline">{anexos.length}/{maxAnexosPorOs}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Envie imagens ou PDFs relacionados a esta ordem de serviço, com o tipo de documento definido.
                        </div>
                      </div>

                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px]">
                        <Select
                          value={anexoCategoria}
                          onValueChange={(value) => setAnexoCategoria(value as OsAnexoCategoria)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Tipo do documento" />
                          </SelectTrigger>
                          <SelectContent>
                            {OS_ANEXO_CATEGORIAS.map((categoria) => (
                              <SelectItem key={categoria.value} value={categoria.value}>
                                {categoria.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={handleAnexoChange}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2"
                          disabled={uploadingAnexo || loadingAnexos || anexos.length >= maxAnexosPorOs}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {uploadingAnexo ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          {uploadingAnexo
                            ? "Enviando..."
                            : anexos.length >= maxAnexosPorOs
                              ? "Limite atingido"
                              : "Adicionar anexo"}
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border bg-card p-4">
                    {loadingAnexos ? (
                      <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando anexos...
                      </div>
                    ) : anexos.length === 0 ? (
                      <div className="flex min-h-[180px] items-center justify-center rounded-md border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                        Nenhum anexo adicionado nesta OS.
                      </div>
                    ) : (
                      <div className="divide-y rounded-md border">
                        {anexos.map((anexo) => {
                          const isImage = String(anexo.tipo ?? "").startsWith("image/");
                          const fileSize = fmtFileSize(anexo.tamanho);
                          const deleting = deletingAnexoId === anexo.id;

                          return (
                            <div key={anexo.id} className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                              <a
                                href={anexo.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus:ring-2 focus:ring-primary"
                                title={anexo.nome}
                              >
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                                  {isImage ? (
                                    <span
                                      aria-label={anexo.nome}
                                      className="block h-full w-full bg-cover bg-center"
                                      style={{ backgroundImage: `url(${anexo.url})` }}
                                    />
                                  ) : (
                                    <FileText className="h-5 w-5 text-primary" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <Badge variant="secondary" className="mb-1">
                                    {getOsAnexoCategoriaLabel(anexo.categoria)}
                                  </Badge>
                                  <span className="block truncate text-sm font-medium">{anexo.nome}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {[fileSize, fmtDate(anexo.createdat)].filter(Boolean).join(" • ")}
                                  </span>
                                  {anexo.descricao ? (
                                    <span className="block truncate text-xs text-muted-foreground">{anexo.descricao}</span>
                                  ) : null}
                                </span>
                              </a>

                              <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                                <Button variant="outline" size="sm" asChild className="gap-2">
                                  <a href={anexo.url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                    Abrir
                                  </a>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  title="Remover anexo"
                                  aria-label="Remover anexo"
                                  disabled={deleting}
                                  onClick={() => void handleDeleteAnexo(anexo.id)}
                                >
                                  {deleting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </TabsContent>

                <TabsContent value="aprovacao" className="mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6 sm:py-5">
              {Array.isArray(data.aprovacoes) && (
                <section className="rounded-lg border bg-card p-4">
                  <div className="text-sm font-medium mb-1.5">Links de aprovação</div>
                  {data.aprovacoes.length === 0 ? (
                    <div className="text-sm text-muted-foreground">—</div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {data.aprovacoes.map((a) => {
                        const url = approvalUrlFromToken(a.token);
                        return (
                          <li key={a.id} className="flex flex-col gap-3 rounded-md border bg-muted/20 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate">
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline break-all"
                                  title={url}
                                >
                                  {url}
                                </a>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                criado: {fmtDate(a.created_at)} • expira: {fmtDate(a.expira_em)} • usado: {fmtDate(a.usado_em)}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                title="Copiar link"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(url);
                                    toast.success("Link copiado");
                                  } catch {
                                    toast.error("Não foi possível copiar");
                                  }
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                title="Abrir link"
                                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
