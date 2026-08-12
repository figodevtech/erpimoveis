"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import {
  ArrowRightLeft,
  ChevronDown,
  Eye,
  Loader2,
  PackageMinus,
  PackagePlus,
  Receipt,
  Undo2,
} from "lucide-react";
import { Produto } from "../../../types";
import { formatDate } from "@/utils/formatDate";
import { EmissaoNotaDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { toast } from "@/lib/toast";
import { EntryDetailsDialog } from "../../entry-details-dialog";
import { ExitDetailsDialog } from "../../exit-details-dialog";
import { CancelMovementDialog, type CancelTarget } from "../../cancel-movement-dialog";
import { CancelarEntradaDialog } from "@/components/entrada-fiscal/cancelar-entrada-dialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import EntradaDialog from "../../dialog-entrada/dialog-entrada-unica";
import SaidaDialog from "../../dialog-saida/dialog-saida-unica";

/**
 * Movimentacoes do produto, lidas do razao de estoque.
 *
 * A tela mostra as quatro origens que mexem em saldo — entrada, saida manual,
 * venda e ordem de servico. Antes so entrada e saida apareciam, porque venda e
 * OS nao deixavam registro de movimento em lugar nenhum.
 */

type Movimento = {
  id: number;
  produto_id: number;
  sentido: "ENTRADA" | "SAIDA";
  origem: "ENTRADA" | "SAIDA_MANUAL" | "VENDA" | "ORDEM_SERVICO" | "NAO_IDENTIFICADA";
  acao: "REGISTRO" | "ESTORNO";
  quantidade: number;
  saldo_anterior: number | null;
  saldo_resultante: number | null;
  entrada_id: number | null;
  saida_id: number | null;
  venda_id: number | null;
  ordemservicoid: number | null;
  documento_label: string | null;
  observacao: string | null;
  reconstruido: boolean;
  created_at: string;
  criador: { nome: string | null } | null;
  entrada: {
    id: number;
    status: string | null;
    origem: string | null;
    fiscal: boolean | null;
    numero_nota: string | null;
    fornecedor: { nomerazaosocial?: string | null } | null;
  } | null;
  saida: { id: number; status: string | null; motivo: string | null; observacao: string | null } | null;
};

const ROTULO_ORIGEM: Record<Movimento["origem"], string> = {
  ENTRADA: "Entrada",
  SAIDA_MANUAL: "Saída manual",
  VENDA: "Venda",
  ORDEM_SERVICO: "Ordem de serviço",
  NAO_IDENTIFICADA: "Sem origem",
};

const COR_ORIGEM: Record<Movimento["origem"], string> = {
  ENTRADA: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  SAIDA_MANUAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  VENDA: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  ORDEM_SERVICO: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  NAO_IDENTIFICADA: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

function descricaoMovimento(movimento: Movimento) {
  if (movimento.origem === "ENTRADA" && movimento.entrada) {
    const fornecedor = movimento.entrada.fornecedor?.nomerazaosocial;
    if (fornecedor) return fornecedor;
    if (movimento.entrada.fiscal && movimento.entrada.numero_nota) {
      return `NF ${movimento.entrada.numero_nota}`;
    }
  }
  if (movimento.origem === "SAIDA_MANUAL" && movimento.saida) {
    const motivo = String(movimento.saida.motivo ?? "").replace(/_/g, " ");
    return movimento.saida.observacao || motivo || "Saída";
  }
  return movimento.documento_label || ROTULO_ORIGEM[movimento.origem];
}

export function TabFluxo({ produto, onAfterChange }: { produto: Produto; onAfterChange?: () => void | Promise<void> }) {
  const produtoId = Number((produto as any)?.id);
  const estoqueAtual = Number(produto.estoque ?? 0);
  const descricaoProduto = produto.titulo || produto.descricao || `Produto #${produtoId}`;
  const { data: session } = useSession();
  const permissoes = (session?.user as { permissoes?: unknown } | undefined)?.permissoes;
  const podeRegistrarEntrada = permissionSetHas(permissoes, PERMS.ESTOQUE_CRIAR);
  const podeRegistrarSaida = permissionSetHas(permissoes, PERMS.ESTOQUE_EDITAR);

  const [movimentacoes, setMovimentacoes] = useState<Movimento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [saidaOpen, setSaidaOpen] = useState(false);
  const [nfeDialogEntradaId, setNfeDialogEntradaId] = useState<number | null>(null);
  const [detailsEntradaId, setDetailsEntradaId] = useState<number | null>(null);
  const [detailsSaidaId, setDetailsSaidaId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelando, setCancelando] = useState(false);
  /** Entradas usam o dialogo detalhado, que resolve nota mista e lista o que sera desfeito. */
  const [entradaCancelamentoId, setEntradaCancelamentoId] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      setMovimentacoes([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/estoque/movimentos?produtoId=${produtoId}&limit=200`);
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível carregar as movimentações.");
      setMovimentacoes((corpo.data ?? []) as Movimento[]);
    } catch (error: any) {
      toast.error("Movimentações não carregadas", { description: error?.message });
      setMovimentacoes([]);
    } finally {
      setCarregando(false);
    }
  }, [produtoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const aposMudanca = async () => {
    await carregar();
    await onAfterChange?.();
  };

  const cancelarMovimento = async (motivo: string) => {
    if (!cancelTarget) return;
    setCancelando(true);
    try {
      const endpoint =
        cancelTarget.kind === "entrada"
          ? `/api/entradas/${cancelTarget.id}/cancelar`
          : `/api/estoque/saidas/${cancelTarget.id}/cancelar`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível cancelar a movimentação.");
      toast.success(
        cancelTarget.kind === "entrada"
          ? "Entrada cancelada e estoque estornado."
          : "Saída cancelada e estoque devolvido.",
      );
      setCancelTarget(null);
      await aposMudanca();
    } catch (error: any) {
      toast.error("Erro ao cancelar movimentação", { description: error?.message });
    } finally {
      setCancelando(false);
    }
  };

  const getStatusBadge = (movimento: Movimento) => {
    const status = movimento.entrada?.status ?? movimento.saida?.status ?? null;

    if (!status) {
      // Venda e OS nao tem status proprio de movimento: o que importa e se a
      // linha e uma baixa ou a devolucao dela.
      return movimento.acao === "ESTORNO" ? (
        <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">
          Estornado
        </Badge>
      ) : (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
          Confirmada
        </Badge>
      );
    }

    const upper = status.toUpperCase();
    const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

    switch (upper) {
      case "CONCLUIDA":
      case "CONCLUÍDA":
      case "EFETIVADA":
      case "CONFIRMADA":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Confirmada</Badge>;
      case "PENDENTE":
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{formatted}</Badge>;
      case "CANCELADA":
        return <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Cancelada</Badge>;
      default:
        return <Badge variant="outline">{formatted}</Badge>;
    }
  };

  return (
    <TabsContent value="Fluxo" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      <EntradaDialog
        isOpen={entradaOpen}
        setIsOpen={setEntradaOpen}
        productId={produtoId}
        productDescription={descricaoProduto}
        currentQuantity={estoqueAtual}
        onSuccess={aposMudanca}
      />
      <SaidaDialog
        isOpen={saidaOpen}
        setIsOpen={setSaidaOpen}
        productId={produtoId}
        productDescription={descricaoProduto}
        currentQuantity={estoqueAtual}
        onSuccess={aposMudanca}
      />
      <EmissaoNotaDialog
        open={!!nfeDialogEntradaId}
        onOpenChange={(v) => !v && setNfeDialogEntradaId(null)}
        entradaId={nfeDialogEntradaId}
      />
      <EntryDetailsDialog
        entryId={detailsEntradaId}
        inventory="produto"
        open={detailsEntradaId !== null}
        onOpenChange={(open) => !open && setDetailsEntradaId(null)}
      />
      <ExitDetailsDialog
        exitId={detailsSaidaId}
        inventory="produto"
        open={detailsSaidaId !== null}
        onOpenChange={(open) => !open && setDetailsSaidaId(null)}
      />
      <CancelMovementDialog
        target={cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={cancelarMovimento}
        canceling={cancelando}
      />
      <CancelarEntradaDialog
        open={entradaCancelamentoId !== null}
        onOpenChange={(open) => !open && setEntradaCancelamentoId(null)}
        entradaId={entradaCancelamentoId}
        origem="ESTOQUE"
        onCancelada={() => aposMudanca()}
      />
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Movimentações do Estoque
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Entradas, saídas, vendas e ordens de serviço deste produto.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {podeRegistrarEntrada ? (
              <Button
                type="button"
                size="sm"
                className="min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:min-h-9 sm:w-auto"
                onClick={() => setEntradaOpen(true)}
              >
                <PackagePlus className="h-4 w-4" aria-hidden="true" />
                Entrada
              </Button>
            ) : null}
            {podeRegistrarSaida ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 w-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 sm:min-h-9 sm:w-auto"
                disabled={estoqueAtual <= 0}
                onClick={() => setSaidaOpen(true)}
              >
                <PackageMinus className="h-4 w-4" aria-hidden="true" />
                Saída
              </Button>
            ) : null}
            <div className="flex min-h-11 items-center justify-center gap-2 rounded-md border bg-background px-3 py-1.5 shadow-sm sm:min-h-9">
              <span className="text-xs font-medium text-muted-foreground">Total:</span>
              <span className="text-sm font-bold">{movimentacoes.length}</span>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-card overflow-x-auto">
          <Table className="text-xs">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {carregando ? (
                <TableRow>
                  <TableCell className="text-center h-24 text-muted-foreground" colSpan={8}>
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando movimentações...
                    </div>
                  </TableCell>
                </TableRow>
              ) : movimentacoes.length > 0 ? (
                movimentacoes.map((movimento) => {
                  const entradaInfo = movimento.entrada;
                  const isEntrada = movimento.sentido === "ENTRADA";

                  return (
                    <TableRow key={movimento.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="whitespace-nowrap">{formatDate(movimento.created_at)}</TableCell>

                      <TableCell>
                        <Badge variant="outline" className={COR_ORIGEM[movimento.origem]}>
                          {ROTULO_ORIGEM[movimento.origem]}
                        </Badge>
                        {movimento.acao === "ESTORNO" ? (
                          <span className="ml-1 text-[10px] uppercase text-muted-foreground">estorno</span>
                        ) : null}
                      </TableCell>

                      <TableCell className="max-w-[220px] truncate" title={descricaoMovimento(movimento)}>
                        {descricaoMovimento(movimento)}
                        {movimento.reconstruido ? (
                          <span
                            className="ml-1 text-[10px] uppercase text-muted-foreground"
                            title="Linha reconstruída na migração do histórico; saldo da época não registrado."
                          >
                            reconstruído
                          </span>
                        ) : null}
                      </TableCell>

                      <TableCell className="max-w-[140px] truncate" title={movimento.criador?.nome ?? undefined}>
                        {movimento.criador?.nome || <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell>{getStatusBadge(movimento)}</TableCell>

                      <TableCell className={`text-right font-bold ${isEntrada ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                        {isEntrada ? "+" : "-"} {movimento.quantidade}
                      </TableCell>

                      <TableCell className="text-right text-muted-foreground">
                        {movimento.saldo_resultante ?? "—"}
                      </TableCell>

                      <TableCell>
                        {movimento.origem === "SAIDA_MANUAL" && movimento.saida_id ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer rounded-full">
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[180px]">
                              <DropdownMenuItem onClick={() => setDetailsSaidaId(movimento.saida_id!)}>
                                <Eye className="mr-2 h-4 w-4" />
                                Detalhes
                              </DropdownMenuItem>
                              {movimento.saida?.status === "CONFIRMADA" && movimento.acao === "REGISTRO" ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setCancelTarget({ id: movimento.saida_id!, kind: "saida", inventory: "produto" })
                                  }
                                >
                                  <Undo2 className="mr-2 h-4 w-4" />
                                  Cancelar Saída
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}

                        {movimento.origem === "ENTRADA" && movimento.entrada_id ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer rounded-full">
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[180px]">
                              <DropdownMenuItem onClick={() => setDetailsEntradaId(movimento.entrada_id!)}>
                                <Eye className="mr-2 h-4 w-4" />
                                Detalhes
                              </DropdownMenuItem>
                              {entradaInfo?.status === "CONFIRMADA" && entradaInfo.origem !== "NFE_TERCEIRO" ? (
                                <Button
                                  onClick={() => setNfeDialogEntradaId(entradaInfo.id)}
                                  variant="ghost"
                                  className="w-full justify-start cursor-pointer px-2 text-xs"
                                >
                                  <Receipt className="mr-2 h-4 w-4 text-emerald-500" />
                                  Emitir Nota
                                </Button>
                              ) : null}
                              {entradaInfo?.status === "CONFIRMADA" && movimento.acao === "REGISTRO" ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setEntradaCancelamentoId(entradaInfo.id)}
                                >
                                  <Undo2 className="mr-2 h-4 w-4" />
                                  Cancelar Entrada
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell className="text-center h-24 text-muted-foreground" colSpan={8}>
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ArrowRightLeft className="h-8 w-8 opacity-20" />
                      <p>Produto não possui histórico de movimentação no estoque</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TabsContent>
  );
}
