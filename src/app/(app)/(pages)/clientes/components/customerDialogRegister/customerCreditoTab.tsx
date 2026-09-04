"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Receipt,
  RefreshCw,
  Undo2,
  WalletCards,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import type { Customer, SaldoMovimentoCliente } from "../../types";

type CustomerCreditoTabProps = {
  customer: Customer;
};

type SaldoResponse = {
  data: {
    saldo: number;
    movimentos: SaldoMovimentoCliente[];
    total: number;
  };
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatarQuando(valor: string) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : dataHora.format(data);
}

/**
 * O que a linha do razão quer dizer, em uma frase.
 *
 * O motivo gravado já descreve o caso vindo de transação ("Baixa do título
 * #12"); o que falta é o manual sem motivo, que sem isto apareceria como uma
 * linha muda.
 */
function descrever(movimento: SaldoMovimentoCliente) {
  if (movimento.motivo) return movimento.motivo;
  if (movimento.origem === "MANUAL") {
    return movimento.sentido === "CREDITO" ? "Crédito adicionado à mão" : "Crédito removido à mão";
  }
  return "Movimentação de título";
}

function LoadingState() {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-label="Carregando crédito do cliente">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div
      className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/60 p-6 text-center dark:border-red-900 dark:bg-red-950/20"
      role="alert"
    >
      <AlertCircle className="size-7 text-red-600 dark:text-red-400" aria-hidden="true" />
      <p className="mt-3 font-medium">Não foi possível carregar o crédito do cliente</p>
      <p className="mt-1 text-sm text-muted-foreground">Tente novamente em alguns instantes.</p>
      <Button type="button" variant="outline" className="mt-4 min-h-11" onClick={retry}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
}

/**
 * O ajuste manual do saldo.
 *
 * Fica num diálogo próprio, e não em campo solto na aba, porque não é edição de
 * cadastro: cada confirmação vira uma linha no razão que ninguém apaga depois.
 */
function AjusteDialog({
  aberto,
  sentido,
  saldoAtual,
  salvando,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  sentido: "CREDITO" | "DEBITO";
  saldoAtual: number;
  salvando: boolean;
  onFechar: () => void;
  onConfirmar: (valor: number, motivo: string) => void;
}) {
  // Nasce zerado a cada abertura: quem monta este componente troca a `key`
  // quando o diálogo abre, então não há estado velho a limpar.
  const [valor, setValor] = useState(0);
  const [motivo, setMotivo] = useState("");

  const adicionando = sentido === "CREDITO";
  const excede = !adicionando && valor > saldoAtual;
  const saldoDepois = adicionando ? saldoAtual + valor : saldoAtual - valor;

  return (
    <AlertDialog open={aberto} onOpenChange={(next) => { if (!next && !salvando) onFechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {adicionando ? "Adicionar crédito" : "Remover crédito"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              <span className="block">
                {adicionando
                  ? "O valor entra na carteira do cliente e fica disponível para quitar cobranças."
                  : "O valor sai da carteira do cliente."}
              </span>
              <span className="block text-muted-foreground">
                Saldo hoje: <strong className="tabular-nums">{moeda.format(saldoAtual)}</strong>
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ajuste-valor">
              Valor <span className="text-destructive">*</span>
            </Label>
            <ValueInput id="ajuste-valor" value={valor} onValueChange={setValor} disabled={salvando} />
            {excede ? (
              <p className="text-xs text-destructive">
                O cliente tem {moeda.format(saldoAtual)}: não dá para remover mais que isso.
              </p>
            ) : valor > 0 ? (
              <p className="text-xs text-muted-foreground">
                O saldo fica em <strong className="tabular-nums">{moeda.format(saldoDepois)}</strong>.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ajuste-motivo">Motivo (opcional)</Label>
            <Textarea
              id="ajuste-motivo"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder={
                adicionando
                  ? "Ex.: sobra de pagamento, acordo comercial…"
                  : "Ex.: crédito usado fora do sistema, correção de lançamento…"
              }
              rows={3}
              disabled={salvando}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            disabled={salvando || valor <= 0 || excede}
            onClick={() => onConfirmar(valor, motivo)}
          >
            {salvando && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {adicionando ? "Adicionar crédito" : "Remover crédito"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function CustomerCreditoTab({ customer }: CustomerCreditoTabProps) {
  const { data: session } = useSession();
  const podeAjustar = permissionSetHas(
    (session?.user as { permissoes?: string[] } | undefined)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );

  const [dados, setDados] = useState<SaldoResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [ajuste, setAjuste] = useState<"CREDITO" | "DEBITO" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    if (!customer.id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);

    try {
      const response = await fetch(`/api/customers/${customer.id}/saldo?limit=50`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Falha ao carregar o crédito do cliente.");
      setDados((body as SaldoResponse).data);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => {
    setDados(null);
    setError(false);
    abortRef.current?.abort();
  }, [customer.id]);

  useEffect(() => {
    if (customer.id && !dados && !loading && !error) {
      void carregar();
    }
  }, [carregar, customer.id, dados, error, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function confirmarAjuste(valor: number, motivo: string) {
    if (!ajuste || salvando) return;
    setSalvando(true);
    try {
      const response = await fetch(`/api/customers/${customer.id}/saldo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentido: ajuste, valor, motivo: motivo.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Não foi possível ajustar o crédito.");

      toast.success(
        ajuste === "CREDITO" ? "Crédito adicionado." : "Crédito removido.",
      );
      setAjuste(null);
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível ajustar o crédito.");
    } finally {
      setSalvando(false);
    }
  }

  const saldo = dados?.saldo ?? 0;
  const movimentos = dados?.movimentos ?? [];

  return (
    <TabsContent value="Credito" className="h-full min-h-0 overflow-hidden p-0">
      <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState retry={() => void carregar()} />
        ) : (
          <div className="space-y-4">
            {/* O saldo, e o que fazer com ele */}
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <WalletCards className="size-4" aria-hidden="true" />
                    Crédito disponível
                  </p>
                  <p
                    className={cn(
                      "mt-2 text-3xl font-semibold tabular-nums",
                      saldo > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    {moeda.format(saldo)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pode quitar uma cobrança deste cliente pelo método Crédito do cliente,
                    sem passar por banco.
                  </p>
                </div>

                {podeAjustar && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setAjuste("CREDITO")}
                    >
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                      Adicionar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={saldo <= 0}
                      onClick={() => setAjuste("DEBITO")}
                    >
                      <ArrowDownLeft className="size-4" aria-hidden="true" />
                      Remover
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* O razão */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Movimentações</h3>
                  <p className="text-sm text-muted-foreground">
                    Toda entrada e saída de crédito fica registrada aqui.
                  </p>
                </div>
                {dados ? (
                  <Badge variant="outline" className="tabular-nums">
                    {dados.total} no total
                  </Badge>
                ) : null}
              </div>

              {movimentos.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
                  <WalletCards className="size-7 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium">Nenhuma movimentação ainda</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Este cliente nunca teve crédito adicionado nem consumido.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {movimentos.map((movimento) => {
                    const entrada = movimento.sentido === "CREDITO";
                    return (
                      <li key={movimento.id} className="rounded-xl border bg-card p-4 shadow-xs">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-medium">
                              {movimento.acao === "ESTORNO" ? (
                                <Undo2 className="size-4 text-muted-foreground" aria-hidden="true" />
                              ) : entrada ? (
                                <ArrowUpRight
                                  className="size-4 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ArrowDownLeft className="size-4 text-destructive" aria-hidden="true" />
                              )}
                              {descrever(movimento)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatarQuando(movimento.created_at)}
                              {movimento.transacao_id ? (
                                <>
                                  {" · "}
                                  <span className="inline-flex items-center gap-1">
                                    <Receipt className="size-3" aria-hidden="true" />
                                    Lançamento #{movimento.transacao_id}
                                  </span>
                                </>
                              ) : null}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p
                              className={cn(
                                "font-semibold tabular-nums",
                                entrada
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-destructive",
                              )}
                            >
                              {entrada ? "+" : "−"} {moeda.format(movimento.valor)}
                            </p>
                            {movimento.saldo_resultante != null ? (
                              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                Saldo: {moeda.format(movimento.saldo_resultante)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <AjusteDialog
        key={ajuste ?? "fechado"}
        aberto={ajuste !== null}
        sentido={ajuste ?? "CREDITO"}
        saldoAtual={saldo}
        salvando={salvando}
        onFechar={() => setAjuste(null)}
        onConfirmar={confirmarAjuste}
      />
    </TabsContent>
  );
}
