"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionReady } from "@/components/use-session-ready";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/lib/toast";
import { Loader2, Receipt, AlertCircle, CheckCircle2, XCircle, Info, X, Plus, RotateCw, Ellipsis, Download, Package, Paperclip } from "lucide-react";
import { AutorizarNfeButton } from "./autorizarNfe-button";
import { GerarNotaDeOsDialog } from "./gerarNotaDeOsDialog/gerarNotaDeOsDialog";
import { BadgeAgrupada, VinculosNota } from "@/components/fiscal/badges-nota";
import { CustomerDialog } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/customerDialog";
import {
  ehRejeicaoIeDestinatarioInativa,
  ehRejeicaoIndIeDestIsentoNaoPermitido,
  MENSAGEM_REJEICAO_306,
  MENSAGEM_REJEICAO_805,
} from "@/lib/nfe/indIEDest";
import { CancelarNfeButton } from "./cancelarNfeButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExcluirRascunhoNfeButton } from "./excluirRascunhoNfeButton";
import { MODELO_NFCE } from "@/lib/nfe/modeloDocumento";
import type { PermissaoDeEmissao } from "@/lib/nfe/permissaoDeEmissao";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

type NfeResumo = {
  id: number;
  modelo: string | null;
  serie: number | null;
  numero: number | null;
  chave_acesso: string | null;
  ambiente: string | null;
  status: string | null;
  vendaid: number | null;
  clienteid: number | null;
  dataemissao: string | null;
  dataautorizacao: string | null;
  protocolo: string | null;
  total_produtos: number | null;
  total_servicos: number | null;
  total_nfe: number | null;
  xml_assinado?: string | null;
  xml_autorizado?: string | null;
  justificativacancelamento: string | null;
  codigo_rejeicao?: string | null;
  motivo_rejeicao?: string | null;
  rejeitada_em?: string | null;
  createdat: string | null;
  updatedat: string | null;
  empresaid: number | null;
  /**
   * Todas as origens que a nota documenta, inclusive as que estao fora da
   * selecao atual. E o que permite dizer "esta nota tambem cobre a venda #99".
   */
  origens?: Array<{ tipo: "OS" | "VENDA" | "ENTRADA" | "SAIDA"; id: number; ancora: boolean }>;
};

type ListarNfeResponsePorVenda = {
  ok: boolean;
  message?: string;
  vendaId?: number;
  nfes: NfeResumo[];
};

type ListarNfeResponsePorEntrada = {
  ok: boolean;
  message?: string;
  entradaId?: number;
  nfes: NfeResumo[];
};

type ListarNfeResponsePorSaida = {
  ok: boolean;
  message?: string;
  saidaId?: number;
  nfes: NfeResumo[];
};

type EmpresaFiscal = {
  ambiente: string | null;
};

const nfeStatusClasses: Record<string, string> = {
  AUTORIZADA: "bg-emerald-600/15 text-emerald-400",
  AUTORIZADO: "bg-emerald-600/15 text-emerald-400",
  EMITIDA: "bg-emerald-600/15 text-emerald-400",
  REJEITADA: "bg-red-600/15 text-red-400",
  RASCUNHO: "bg-slate-500/20 text-slate-400",
  CANCELADA: "bg-amber-500/20 text-amber-400",
  CANCELADO: "bg-amber-500/20 text-amber-400",
  PROCESSANDO: "bg-sky-600/15 text-sky-400 animate-pulse",
  PROCESSANDO_AUTORIZACAO: "bg-sky-600/15 text-sky-400 animate-pulse",
  // Estados da NFC-e que exigem ação: destaque em âmbar, como o cancelamento,
  // porque nenhum dos dois é desfecho final.
  CONTINGENCIA: "bg-amber-500/20 text-amber-400",
  RESULTADO_INCERTO: "bg-amber-500/20 text-amber-400",
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Horas restantes do prazo de 24h da contingência; `null` se a data faltar. */
function horasRestantesContingencia(dataEmissao?: string | null): number | null {
  if (!dataEmissao) return null;
  const emissao = new Date(dataEmissao);
  if (Number.isNaN(emissao.getTime())) return null;
  return 24 - (Date.now() - emissao.getTime()) / 3_600_000;
}

function buildObservacao(nfe: NfeResumo): string {
  const statusUpper = (nfe.status || "").toUpperCase();
  const doc = nfe.modelo === "NFCE" ? "NFC-e" : nfe.modelo === "NFSE" ? "NFS-e" : "NF-e";

  if (statusUpper === "CANCELADA" || statusUpper === "CANCELADO") {
    if (nfe.justificativacancelamento && nfe.justificativacancelamento.trim()) {
      return `${doc} cancelada. Justificativa: ${nfe.justificativacancelamento}`;
    }
    return `${doc} cancelada. Nenhuma justificativa registrada.`;
  }

  if (statusUpper === "AUTORIZADA" || statusUpper === "AUTORIZADO" || statusUpper === "EMITIDA") {
    const base = `${doc} autorizada pela SEFAZ.`;
    if (nfe.protocolo) {
      return `${base} Protocolo: ${nfe.protocolo}.`;
    }
    return base;
  }

  if (statusUpper === "REJEITADA" || statusUpper === "DENEGADA") {
    const rotulo = statusUpper === "DENEGADA" ? `${doc} denegada` : `${doc} rejeitada`;
    const motivo = nfe.motivo_rejeicao?.trim();
    if (motivo) {
      const codigo = nfe.codigo_rejeicao?.trim();
      return `${rotulo} pela SEFAZ. ${codigo ? `Rejeição ${codigo}: ` : ""}${motivo}`;
    }
    // Notas rejeitadas antes de o motivo passar a ser gravado.
    return `${rotulo} pela SEFAZ. Motivo não registrado — reenvie para obter o retorno atualizado.`;
  }

  if (statusUpper === "RASCUNHO") {
    return `${doc} em rascunho. Ainda não foi enviada para a SEFAZ.`;
  }

  // Resposta perdida depois do envio: o operador NÃO pode emitir outra nota, e
  // sim consultar a chave para descobrir o que a SEFAZ fez com esta.
  if (statusUpper === "RESULTADO_INCERTO") {
    return (
      `${doc} enviada, mas a resposta da SEFAZ não chegou. Não emita outra: ` +
      "use Consultar situação para saber se ela foi autorizada."
    );
  }

  if (statusUpper === "CONTINGENCIA") {
    const horas = horasRestantesContingencia(nfe.dataemissao);
    if (horas == null) {
      return `${doc} emitida em contingência offline. Precisa ser transmitida quando a conexão voltar.`;
    }
    if (horas <= 0) {
      return (
        `${doc} emitida em contingência com o prazo de 24 horas VENCIDO ` +
        `(há ${Math.abs(Math.round(horas))}h). Transmita imediatamente.`
      );
    }
    return (
      `${doc} emitida em contingência offline. Restam ${Math.floor(horas)}h do prazo de ` +
      "24 horas para transmitir."
    );
  }

  if (statusUpper === "PROCESSANDO" || statusUpper === "PROCESSANDO_AUTORIZACAO") {
    return `${doc} em processamento. Aguarde a autorização automática.`;
  }

  return "Nenhuma observação registrada.";
}

export function EmissaoNotaDialog({
  open,
  onOpenChange,
  vendaId,
  vendaIds,
  entradaId,
  saidaId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  /** opcional: uso na tela de venda */
  vendaId?: number | null;

  /** O grupo de vendas da emissao, quando vem da selecao multipla. */
  vendaIds?: number[] | null;

  /** opcional: uso na tela de entrada */
  entradaId?: number | null;

  /**
   * opcional: uso no histórico de estoque, na saída de produto.
   *
   * A saída passou a entrar por aqui em vez de ter um cartão de emissão dentro
   * dos detalhes: a lista de notas e as ações de cada nota são as mesmas —
   * autorizar, consultar, ver DANFE, baixar XML, cancelar, descartar rascunho —
   * e mantê-las duplicadas fazia a saída ficar com metade delas.
   */
  saidaId?: number | null;
}) {
  const { session, ready: sessionReady } = useSessionReady();
  const canNotasFiscais = permissionSetHas(
    (session?.user as { permissoes?: unknown } | undefined)?.permissoes,
    PERMS.FINANCEIRO_NOTAS_FISCAIS,
  );
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const [nfes, setNfes] = useState<NfeResumo[] | null>(null);
  const [avisoListagem, setAvisoListagem] = useState<string | null>(null);
  const [openGerarNfe, setOpenGerarNfe] = useState(false);
  const [openGerarNfce, setOpenGerarNfce] = useState(false);
  /** Id da NFC-e cuja transmissão falhou por rede, liberando a contingência. */
  const [contingenciaOferecida, setContingenciaOferecida] = useState<number | null>(null);
  /** NFC-e rejeitada sendo corrigida: o assistente reabre esse rascunho. */
  const [nfceParaCorrigir, setNfceParaCorrigir] = useState<number | null>(null);
  /**
   * NF-e de saída sendo corrigida ou revisada: o assistente reabre esse
   * rascunho. A saída não passa pelo editor avulso porque a natureza fiscal, o
   * documento de origem e o destinatário só existem lá dentro.
   */
  const [nfeSaidaParaCorrigir, setNfeSaidaParaCorrigir] = useState<number | null>(null);
  const [emitindoContingencia, setEmitindoContingencia] = useState(false);
  const [empresaFiscal, setEmpresaFiscal] = useState<EmpresaFiscal | null>(null);
  // O que a origem pode gerar (`permissaoDeEmissao`). Sem resposta, nada é
  // bloqueado aqui: o servidor recusa do mesmo jeito na geração do rascunho.
  const [permissoes, setPermissoes] = useState<{ nfe: PermissaoDeEmissao; nfce: PermissaoDeEmissao } | null>(null);
  const [downloadingXmlId, setDownloadingXmlId] = useState<number | null>(null);
  const [anexandoDanfeId, setAnexandoDanfeId] = useState<number | null>(null);
  const [clienteEmRevisao, setClienteEmRevisao] = useState<number | null>(null);

  const origem = vendaId
    ? "VENDA"
    : entradaId
      ? "ENTRADA"
      : saidaId
        ? "SAIDA"
        : null;
  const origemId = vendaId ?? entradaId ?? saidaId ?? null;

  /**
   * Todas as origens que esta emissao cobre. A ancora encabeca a lista: e ela
   * que vai para a coluna escalar da nota e que a RPC de vinculo exige que
   * permaneca no grupo.
   */
  const origensDoGrupo = useMemo(() => {
    const lista = origem === "VENDA" ? vendaIds : null;
    const ids = (lista ?? [])
      .map((valor) => Number(valor))
      .filter((valor) => Number.isInteger(valor) && valor > 0);
    if (!origemId) return ids;
    return [...new Set([origemId, ...ids.filter((valor) => valor !== origemId)])];
  }, [origem, vendaIds, origemId]);

  const agrupado = origensDoGrupo.length > 1;

  /**
   * As notas vivas que ja cobrem alguma origem da selecao. Rascunho, cancelada
   * e rejeitada ficam de fora: nenhuma delas impede uma emissao nova, e
   * lista-las so faria ruido no aviso.
   */
  const notasDoGrupo = useMemo(() => {
    if (!agrupado) return [] as NfeResumo[];
    const ignorar = new Set(["RASCUNHO", "CANCELADA", "CANCELADO", "REJEITADA", "DENEGADA"]);
    return (nfes ?? []).filter(
      (nota) => !ignorar.has(String(nota.status ?? "").trim().toUpperCase()),
    );
  }, [agrupado, nfes]);

  const canFetch = open && canNotasFiscais && !!origem && !!origemId;

  useEffect(() => {
    if (!open || !sessionReady || canNotasFiscais) return;
    toast.error("Você não possui permissão para acessar notas fiscais.");
    onOpenChange(false);
  }, [canNotasFiscais, onOpenChange, open, sessionReady]);

  const ambienteProducao = empresaFiscal?.ambiente === "PRODUCAO";
  const ambienteLabel = ambienteProducao ? "Produção" : "Homologação";
  const endpointListar = useMemo(() => {
    if (!origem || !origemId) return null;
    // Com grupo, uma chamada so: a uniao das notas de todas as origens é feita
    // no servidor, que tambem devolve as origens de cada nota.
    if (agrupado && origem === "VENDA") {
      return `/api/nfe/por-origem?tipo=${origem}&ids=${origensDoGrupo.join(",")}`;
    }
    if (origem === "VENDA") return `/api/nfe/por-venda/${origemId}`;
    if (origem === "SAIDA") return `/api/nfe/por-saida/${origemId}`;
    return `/api/nfe/por-entrada/${origemId}`;
  }, [origem, origemId, agrupado, origensDoGrupo]);

  /**
   * Emite a NFC-e offline depois de uma falha de comunicação.
   *
   * O cupom sai na hora para o consumidor; a transmissão fica pendente e tem
   * prazo de 24 horas.
   */
  const emitirEmContingencia = async (nfeId: number) => {
    if (emitindoContingencia) return;
    setEmitindoContingencia(true);
    const toastId = toast.loading("Emitindo NFC-e em contingência...");

    try {
      const response = await fetch(`/api/nfce/contingencia/${nfeId}`, { method: "POST" });
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || "Não foi possível emitir em contingência.");
      }

      toast.success("NFC-e emitida em contingência.", {
        id: toastId,
        description:
          "Imprima o cupom e transmita assim que a conexão voltar — o prazo é de 24 horas.",
      });
      setContingenciaOferecida(null);
      await fetchNfes();
    } catch (error: any) {
      toast.error("Falha ao emitir em contingência.", {
        id: toastId,
        description: error?.message,
      });
    } finally {
      setEmitindoContingencia(false);
    }
  };

  const baixarXmlNfe = async (nfe: NfeResumo) => {
    if (downloadingXmlId === nfe.id) return;

    const toastId = toast.loading("Preparando XML da NF-e...");
    setDownloadingXmlId(nfe.id);

    try {
      const response = await fetch(`/api/fiscal/notas-emitidas/${nfe.id}/xml`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || body?.error || "Não foi possível baixar o XML da NF-e.");
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fallbackName = `nfe-${nfe.chave_acesso || nfe.id}.xml`;
      const filename = filenameMatch?.[1] || fallbackName;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("XML da NF-e baixado com sucesso.", { id: toastId });
    } catch (error: any) {
      toast.error("Não foi possível baixar o XML da NF-e.", {
        id: toastId,
        description: error?.message,
      });
    } finally {
      setDownloadingXmlId(null);
    }
  };

  /**
   * Onde o DANFE sera anexado. Prioriza o vinculo da propria NF-e e cai para a
   * origem do dialog quando a listagem nao trouxer o campo — quem decide de fato
   * e o servidor, que relê o vinculo direto da nota.
   */
  const destinoDoAnexo = (nfe: NfeResumo): "VENDA" | null => {
    if (nfe.vendaid) return "VENDA";
    if (origem === "VENDA" && vendaId) return "VENDA";
    return null;
  };

  /**
   * Gera o DANFE em PDF e grava como anexo "Nota fiscal" na venda.
   */
  const anexarDanfe = async (nfe: NfeResumo) => {
    if (anexandoDanfeId === nfe.id) return;

    const destino = "venda";
    const toastId = toast.loading(`Gerando DANFE e anexando na ${destino}...`);
    setAnexandoDanfeId(nfe.id);

    try {
      const response = await fetch(`/api/nfe/${nfe.id}/danfe/anexar`, { method: "POST" });
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || "Não foi possível anexar o DANFE.");
      }

      toast.success(
        json.jaExistia
          ? `O DANFE já estava anexado nesta ${destino}.`
          : `DANFE anexado na ${destino}.`,
        { id: toastId },
      );
    } catch (error: any) {
      toast.error("Não foi possível anexar o DANFE.", {
        id: toastId,
        description: error?.message,
      });
    } finally {
      setAnexandoDanfeId(null);
    }
  };

  /**
   * Busca as NF-e da origem no backend.
   */
  const fetchNfes = async (signal?: AbortSignal) => {
    if (!endpointListar) return;

    setLoading(true);
    setAvisoListagem(null);
    try {
      const res = await fetch(endpointListar, {
        method: "GET",
        signal,
      });

      const json = (await res.json().catch(() => null)) as
        | ListarNfeResponsePorVenda
        | ListarNfeResponsePorEntrada
        | ListarNfeResponsePorSaida
        | null;

      const erroNfe = !res.ok || !json?.ok
        ? (json as any)?.message || `Erro ao buscar NF-e (HTTP ${res.status}).`
        : null;
      const fetchedNfes = erroNfe ? [] : (json as any).nfes ?? [];
      if (!signal?.aborted) setPermissoes(erroNfe ? null : (json as any).emissao ?? null);

      if (erroNfe) throw new Error(erroNfe);

      if (!signal?.aborted) {
        setNfes(fetchedNfes);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error(e);
      if (!signal?.aborted) {
        toast.error(e?.message || "Erro ao carregar NF-e.");
        setNfes([]);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchEmpresa = async () => {
    try {
      const res = await fetch("/api/fiscal/empresa-contexto", { cache: "no-store" });
      const json = await res.json();
      if (json.ok && json.empresa) {
        const empresa = json.empresa;
        setEmpresaFiscal({ ambiente: empresa.ambiente ?? null });
      }
    } catch (e) {
      console.error("Erro ao buscar ambiente da empresa:", e);
    }
  };

  useEffect(() => {
    if (!canFetch) return;

    const ac = new AbortController();
    fetchNfes(ac.signal);
    fetchEmpresa();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, endpointListar, origensDoGrupo]);

  const titulo = useMemo(() => {
    if (!origem || !origemId) return "Emissão de Nota Fiscal";
    if (origem === "VENDA") return `Emissão de Nota Fiscal - Venda #${origemId}`;
    if (origem === "SAIDA") return `Emissão de Nota Fiscal - Saída #${origemId}`;
    return `Emissão de Nota Fiscal - Entrada #${origemId}`;
  }, [origem, origemId]);

  const bloqueioNfe = origem !== "SAIDA" && permissoes?.nfe.permitido === false ? permissoes.nfe.motivo : null;
  const condicaoNfce = permissoes?.nfce.permitido ? permissoes.nfce.condicao : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setNfes([]);
          setAvisoListagem(null);
          setPermissoes(null);
        }
      }}
    >
      <DialogContent
        className="
          w-[95vw] sm:max-w-3xl
          max-h-[85vh] sm:max-h-[85vh] supports-[height:100svh]:max-h-[85svh]
          overflow-y-auto overscroll-contain min-h-[85vh]
          p-0
        "
      >
        <div className="top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 hover:cursor-pointer"
              aria-label="Fechar"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>

          <DialogHeader className="px-5 pt-5 pb-3 border-b-1">
            <DialogTitle className="flex items-center gap-2 pr-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                {titulo}
              </div>
            </DialogTitle>
            <DialogDescription>Visualize as NF-e vinculadas e gere novas NF-e a partir dos produtos.</DialogDescription>

            <div className="grid gap-2" aria-label="Ambiente de emissão fiscal">
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">NF-e de produto</p>
                    <p className="truncate text-[11px] text-muted-foreground">SEFAZ</p>
                  </div>
                </div>
                <Badge variant="outline" className={ambienteProducao ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600" : "border-amber-500/30 bg-amber-500/15 text-amber-600"}>
                  {empresaFiscal ? ambienteLabel : "Carregando"}
                </Badge>
              </div>

            </div>

            {!!origemId && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  disabled={loading}
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNfes()}
                  className="h-8 gap-2 text-xs hover:cursor-pointer"
                >
                  <RotateCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  Recarregar
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                      disabled={loading || Boolean(bloqueioNfe)}
                      title={bloqueioNfe ?? undefined}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        // Nota nova, e não a revisão de um rascunho: sem limpar,
                        // o assistente reabriria a última nota corrigida.
                        setNfeSaidaParaCorrigir(null);
                        setOpenGerarNfe(true);
                      }}
                      className="h-8 gap-2 text-xs hover:cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />{" "}
                      {origem === "SAIDA" ? "NF-e de saída" : "NF-e (Produto)"}
                    </Button>

                  {/* NFC-e só documenta saída ao consumidor: não aparece em
                      entrada de mercadoria, que é sempre modelo 55. */}
                  {origem === "VENDA" && (
                    <Button
                      disabled={loading}
                      variant="secondary"
                      size="sm"
                      onClick={() => setOpenGerarNfce(true)}
                      className="h-8 gap-2 text-xs hover:cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" /> NFC-e (Consumidor)
                    </Button>
                  )}

                </div>
              </div>
            )}

            {/* Botão desabilitado não mostra `title`: o motivo fica escrito. */}
            {!!origemId && (bloqueioNfe || condicaoNfce) ? (
              <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5">
                  {bloqueioNfe ? <p>{bloqueioNfe}</p> : null}
                  {condicaoNfce ? <p>NFC-e: {condicaoNfce}</p> : null}
                </div>
              </div>
            ) : null}
          </DialogHeader>

          <div className="pt-5 pb-5 space-y-4 relative">
            <div
              className={`${
                origemId && loading && "opacity-100"
              } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
            >
              <div
                className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
                  origemId && loading && "animate-slideIn "
                }`}
              ></div>
            </div>

            {avisoListagem && (
              <div className="mx-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{avisoListagem}</span>
              </div>
            )}

            {/*
              Emissão em lote: antes de gerar, mostra o que já existe para o
              grupo. Sem isto o operador seleciona 5 vendas sem saber que duas já
              têm nota — e descobre no 422 do servidor, com o motivo escondido
              atrás de uma mensagem técnica.
            */}
            {agrupado && (
              <div className="mx-5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-medium">
                      Emissão agrupada: {origensDoGrupo.length}{" "}
                      vendas nesta seleção
                    </div>
                    <div className="opacity-90">
                      {origensDoGrupo
                        .map((id) => `Venda #${id}`)
                        .join(", ")}
                      . Todas sairão numa nota só, com um único destinatário.
                    </div>
                    {notasDoGrupo.length > 0 ? (
                      <div className="space-y-0.5 pt-1">
                        <div className="font-medium">
                          {notasDoGrupo.length} nota(s) já cobrem origens desta seleção:
                        </div>
                        {notasDoGrupo.map((nota) => {
                          const fora = (nota.origens ?? []).filter(
                            (o) => !origensDoGrupo.includes(o.id),
                          );
                          return (
                            <div key={nota.id} className="opacity-90">
                              • {nota.modelo === "NFSE" ? "NFS-e" : nota.modelo === "NFCE" ? "NFC-e" : "NF-e"}{" "}
                              {nota.numero ?? "—"} ({String(nota.status ?? "").toLowerCase()})
                              {fora.length > 0
                                ? ` — também cobre ${fora
                                    .map((o) => `${o.tipo === "OS" ? "OS" : o.tipo === "VENDA" ? "Venda" : o.tipo} #${o.id}`)
                                    .join(", ")}, fora da seleção.`
                                : ""}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {!origemId && (
              <div className="h-24 grid place-items-center text-sm text-muted-foreground">
                Nenhuma origem selecionada.
              </div>
            )}

            {!!origemId && !loading && nfes && nfes.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm flex gap-3 mx-5">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Nenhuma NF-e encontrada</div>
                  <div className="text-muted-foreground text-xs">
                    Clique em <b>Nova Nota</b> para gerar um rascunho a partir dos produtos.
                  </div>
                </div>
              </div>
            )}

            {!!origemId && nfes && nfes.length > 0 && (
              <div className="px-5">
                <ul className="text-sm">
                  {nfes.map((nfe, idx) => {
                    const statusUpper = (nfe.status || "").toUpperCase();
                    const statusClass = nfeStatusClasses[statusUpper] || "bg-muted/40";

                    const isAutorizada =
                      statusUpper === "AUTORIZADA" || statusUpper === "AUTORIZADO" || statusUpper === "EMITIDA";
                    const isRejeitada = statusUpper === "REJEITADA";
                    const isCancelada = statusUpper === "CANCELADA" || statusUpper === "CANCELADO";
                    const isProcessing = statusUpper === "PROCESSANDO" || statusUpper === "PROCESSANDO_AUTORIZACAO";

                    const observacao = buildObservacao(nfe);

                    return (
                      <li key={`${nfe.modelo}-${nfe.id}`}>
                        {idx > 0 && <Separator className="my-3" />}

                        <div className="flex items-start p-3 hover:bg-muted/15 rounded-xl relative">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                className="text-xs hover:cursor-pointer absolute top-2 right-2"
                                size="sm"
                              >
                                <Ellipsis className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>

                            <DropdownMenuContent>
                              <>
                                  {/*
                                    Rascunho e rejeitada não têm número definitivo: ele é
                                    alocado no envio e devolvido para a fila quando a SEFAZ
                                    rejeita. Denegada, ao contrário, consome o número e não
                                    é reaproveitável — por isso fica de fora.
                                  */}
                                  {(nfe.status === "RASCUNHO" || isRejeitada) && (
                                    <div className="flex flex-col gap-1">
                                      {/*
                                        Corrige a nota reaproveitando o mesmo id: sem
                                        rascunho novo e sem consumir outro número.

                                        A NFC-e volta para o assistente do modelo 65. O
                                        editor avulso é exclusivo da NF-e — mandar uma
                                        NFC-e para lá misturaria os dois motores.

                                        Na saída aparece também no rascunho: a saída só
                                        aceita uma nota ativa por vez, então sem esta
                                        porta o rascunho ficaria sem como ser revisado e
                                        emitir de novo só devolveria a recusa do servidor.
                                      */}
                                      {isRejeitada || origem === "SAIDA" ? (
                                        <Button
                                          size="sm"
                                          className="text-xs hover:cursor-pointer"
                                          onClick={() => {
                                            if (nfe.modelo === "NFCE") {
                                              setNfceParaCorrigir(nfe.id);
                                              setOpenGerarNfce(true);
                                              return;
                                            }
                                            // A NF-e de saída volta para o
                                            // assistente: o editor avulso não
                                            // conhece natureza fiscal, entrada
                                            // de origem nem destinatário, que
                                            // é o que a saída precisa revisar.
                                            if (origem === "SAIDA") {
                                              setNfeSaidaParaCorrigir(nfe.id);
                                              setOpenGerarNfe(true);
                                              return;
                                            }
                                            onOpenChange(false);
                                            router.push(`/fiscal/nfe-avulsa?id=${nfe.id}`);
                                          }}
                                        >
                                          {isRejeitada ? "Corrigir dados" : "Revisar emissão"}
                                        </Button>
                                      ) : null}
                                      {!(isRejeitada && ehRejeicaoIndIeDestIsentoNaoPermitido(nfe.codigo_rejeicao)) ? <AutorizarNfeButton
                                        nfeId={nfe.id}
                                        size="sm"
                                        variant="outline"
                                        className="text-xs hover:cursor-pointer"
                                        onAfterAuthorize={() => fetchNfes()}
                                        onContingenciaDisponivel={setContingenciaOferecida}
                                      >
                                        {statusUpper === "CONTINGENCIA"
                                          ? "Transmitir agora"
                                          : isRejeitada
                                            ? "Reenviar sem alterar"
                                            : `Autorizar ${nfe.modelo === "NFCE" ? "NFC-e" : "NF-e"}`}
                                      </AutorizarNfeButton> : null}

                                      {/* Só aparece depois de uma falha de rede
                                          comprovada nesta nota. */}
                                      {contingenciaOferecida === nfe.id ? (
                                        <Button
                                          className="text-xs hover:cursor-pointer"
                                          disabled={emitindoContingencia}
                                          onClick={() => emitirEmContingencia(nfe.id)}
                                          size="sm"
                                          variant="secondary"
                                        >
                                          {emitindoContingencia
                                            ? "Emitindo..."
                                            : "Emitir em contingência"}
                                        </Button>
                                      ) : null}

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/editor`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Editar XML
                                      </Button>

                                      <ExcluirRascunhoNfeButton
                                        nfeId={nfe.id}
                                        status={nfe.status ?? ""}
                                        onAfterDelete={() => fetchNfes()}
                                      />
                                    </div>
                                  )}

                                  {isAutorizada && (
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        disabled={downloadingXmlId === nfe.id}
                                        onClick={() => void baixarXmlNfe(nfe)}
                                      >
                                        {downloadingXmlId === nfe.id ? (
                                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Download className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Baixar XML
                                      </Button>

                                      {destinoDoAnexo(nfe) && (
                                        <Button
                                          className="text-xs hover:cursor-pointer"
                                          variant="outline"
                                          size="sm"
                                          disabled={anexandoDanfeId === nfe.id}
                                          onClick={() => void anexarDanfe(nfe)}
                                        >
                                          {anexandoDanfeId === nfe.id ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                                          )}
                                          Anexar na venda
                                        </Button>
                                      )}

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          toast(
                                            <div className="flex flex-row flex-nowrap items-center gap-2">
                                              <Loader2 className="w-4 h-4 animate-spin" />
                                              <span>Consultando Nota Fiscal</span>
                                            </div>,
                                          );

                                          const res = await fetch(`/api/nfe/consultar/${nfe.id}`, { method: "POST" });
                                          const json = await res.json().catch(() => null);

                                          if (!res.ok || !json?.ok) {
                                            toast.error(json?.message || "Erro ao consultar NF-e na SEFAZ.");
                                            return;
                                          }

                                          toast.success(`SEFAZ: ${json.sefaz?.cStat} - ${json.sefaz?.xMotivo || ""}`);
                                          await fetchNfes();
                                        }}
                                      >
                                        Consultar NF-e
                                      </Button>

                                      <CancelarNfeButton
                                        nfeId={nfe.id}
                                        status={nfe.status ?? ""}
                                        onAfterCancel={() => fetchNfes()}
                                      />
                                    </div>
                                  )}

                                  {nfe.status === "CANCELADA" && (
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          toast(
                                            <div className="flex flex-row flex-nowrap items-center gap-2">
                                              <Loader2 className="w-4 h-4 animate-spin" />
                                              <span>Consultando Nota Fiscal</span>
                                            </div>,
                                          );

                                          const res = await fetch(`/api/nfe/consultar/${nfe.id}`, { method: "POST" });
                                          const json = await res.json().catch(() => null);

                                          if (!res.ok || !json?.ok) {
                                            toast.error(json?.message || "Erro ao consultar NF-e na SEFAZ.");
                                            return;
                                          }

                                          toast.success(`SEFAZ: ${json.sefaz?.cStat} - ${json.sefaz?.xMotivo || ""}`);
                                          await fetchNfes();
                                        }}
                                      >
                                        Consultar NF-e
                                      </Button>
                                    </div>
                                  )}
                              </>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <div className="mr-1.5">
                            {isAutorizada ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                            ) : isRejeitada ? (
                              <XCircle className="h-5 w-5 text-red-400" />
                            ) : isCancelada ? (
                              <AlertCircle className="h-5 w-5 text-amber-400" />
                            ) : isProcessing ? (
                              <Loader2 className="h-5 w-5 text-sky-400 animate-spin" />
                            ) : (
                              <Info className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium">
                                {nfe.modelo === "NFSE" ? "NFS-e" : nfe.modelo === "NFCE" ? "NFC-e" : "NF-e"}{" "}
                                {nfe.numero ?? "—"}
                                {nfe.serie ? `/Série ${nfe.serie}` : ""}
                                {nfe.modelo !== "NFSE" && (statusUpper === "RASCUNHO" || isRejeitada) ? (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    (nº provisório)
                                  </span>
                                ) : null}
                              </div>

                              <Badge className={statusClass}>{statusUpper || "—"}</Badge>

                              {nfe.ambiente && (
                                <Badge variant="outline" className="text-[10px]">
                                  {nfe.ambiente}
                                </Badge>
                              )}

                              <BadgeAgrupada origens={nfe.origens} />
                              <VinculosNota origens={nfe.origens} destaque={origemId} />
                            </div>

                            <div className="text-xs text-muted-foreground space-y-0.5">
                              <div>
                                <span className="text-xs text-muted-foreground">ID: {nfe.id}</span> Emissão:{" "}
                                {fmtDate(nfe.dataemissao)}{" "}
                                {nfe.dataautorizacao && (
                                  <>
                                    {" · "}Autorização: {fmtDate(nfe.dataautorizacao)}
                                  </>
                                )}{" "}
                                {" · "}Total NF-e: <b>{fmtMoney(nfe.total_nfe)}</b>
                              </div>

                              {nfe.chave_acesso && (
                                <div className="break-all">
                                  Chave de acesso: <span className="font-mono text-[11px]">{nfe.chave_acesso}</span>
                                </div>
                              )}

                              {nfe.protocolo && <div>Protocolo: {nfe.protocolo}</div>}
                            </div>

                            {isRejeitada || statusUpper === "DENEGADA" ? (
                              <div className="mt-2 flex items-start gap-2 border border-l-4 border-l-destructive bg-destructive/5 p-2.5 text-xs">
                                <XCircle
                                  aria-hidden="true"
                                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                                />
                                <div className="min-w-0">
                                  <p className="font-semibold text-destructive">
                                    {nfe.codigo_rejeicao?.trim()
                                      ? `Rejeição ${nfe.codigo_rejeicao.trim()}`
                                      : "Motivo da rejeição"}
                                  </p>
                                  <p className="mt-0.5 [overflow-wrap:anywhere]">
                                    {nfe.motivo_rejeicao?.trim()
                                      || "Não registrado. Reenvie a nota para obter o retorno atualizado da SEFAZ."}
                                  </p>
                                  {ehRejeicaoIeDestinatarioInativa(nfe.codigo_rejeicao)
                                    || ehRejeicaoIndIeDestIsentoNaoPermitido(nfe.codigo_rejeicao) ? (
                                    <div className="mt-2 space-y-2 border-l-2 border-l-amber-500 bg-amber-500/5 p-2">
                                      <p className="whitespace-pre-line text-[11px]">
                                        {ehRejeicaoIndIeDestIsentoNaoPermitido(nfe.codigo_rejeicao)
                                          ? MENSAGEM_REJEICAO_805
                                          : MENSAGEM_REJEICAO_306}
                                      </p>
                                      {nfe.clienteid ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-xs"
                                          onClick={() => setClienteEmRevisao(nfe.clienteid)}
                                        >
                                          Revisar dados fiscais do destinatário
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    Corrija os dados e reenvie. Rejeição não consome numeração: o número
                                    voltou para a fila e será atribuído de novo no próximo envio.
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 text-xs">
                                <span className="font-medium">Observações: </span>
                                <span className="text-muted-foreground">{observacao}</span>
                              </div>
                            )}

                            {nfe.createdat && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Registrada em: {fmtDate(nfe.createdat)}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Atalho da rejeição 306: leva direto aos dados fiscais do destinatário. */}
        {clienteEmRevisao ? (
          <CustomerDialog
            customerId={clienteEmRevisao}
            isOpen
            setIsOpen={(aberto) => {
              if (!aberto) setClienteEmRevisao(null);
            }}
            onUpdate={() => {
              setClienteEmRevisao(null);
              fetchNfes();
            }}
          >
            <span className="hidden" />
          </CustomerDialog>
        ) : null}

        {!!origemId && (
          <GerarNotaDeOsDialog
            open={openGerarNfe}
            onOpenChange={(v) => {
              setOpenGerarNfe(v);
              // Fechar encerra a revisão: reabrir pelo botão do cabeçalho volta
              // a criar nota nova, e não a editar o rascunho da saída.
              if (!v) {
                setNfeSaidaParaCorrigir(null);
                fetchNfes();
              }
            }}
            vendaId={vendaId ?? null}
            entradaId={entradaId ?? null}
            saidaId={saidaId ?? null}
            origensAdicionais={origensDoGrupo.slice(1)}
            nfeId={nfeSaidaParaCorrigir}
            onAfterGenerate={() => fetchNfes()}
          />
        )}

        {/* Mesmo assistente, perfil do modelo 65: sem transporte, sem DIFAL e
            com identificação do consumidor opcional. */}
        {!!origemId && origem === "VENDA" && (
          <GerarNotaDeOsDialog
            modelo={MODELO_NFCE}
            nfeId={nfceParaCorrigir}
            open={openGerarNfce}
            onOpenChange={(v) => {
              setOpenGerarNfce(v);
              // Fechar encerra a correção: reabrir pelo botão "Gerar NFC-e"
              // volta a criar nota nova, e não a editar a rejeitada.
              if (!v) {
                setNfceParaCorrigir(null);
                fetchNfes();
              }
            }}
            vendaId={vendaId ?? null}
            entradaId={null}
            onAfterGenerate={() => fetchNfes()}
          />
        )}

      </DialogContent>
    </Dialog>
  );
}
