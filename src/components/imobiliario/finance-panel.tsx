"use client";

import { useState, type ElementType, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { RemoteState, requestJson, useModulePermission, useRemote } from "./shared";
import { type Entity, dateLabel, money, titleCase } from "./model";
import { Tipo_transacao, type Transaction } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import {
  CheckCircle2,
  Clock3,
  Eye,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";

// Os mesmos diálogos do fluxo de caixa: ver/editar a transação e dar baixa nela.
const TransactionDialog = dynamic(
  () => import("@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog"),
  { ssr: false }
);
const ConcluidoAlert = dynamic(
  () => import("@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/concluidoAlert"),
  { ssr: false }
);

type Scheme = "blue" | "emerald" | "amber" | "sky";

const schemes: Record<Scheme, { icon: string; hover: string }> = {
  blue: { icon: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400", hover: "hover:border-blue-500/30" },
  emerald: { icon: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400", hover: "hover:border-emerald-500/30" },
  amber: { icon: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400", hover: "hover:border-amber-500/30" },
  sky: { icon: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400", hover: "hover:border-sky-500/30" },
};

function CartaoResumo({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  scheme,
  loading,
}: {
  titulo: string;
  valor: number;
  detalhe: string;
  icon: ElementType;
  scheme: Scheme;
  loading: boolean;
}) {
  return (
    <div className={`group rounded-xl border bg-card/95 p-4 shadow-sm transition-all duration-200 hover:shadow-md ${schemes[scheme].hover}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</span>
        <div className={`rounded-lg p-2 transition-transform duration-200 group-hover:scale-105 ${schemes[scheme].icon}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground">{money(valor)}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
      </div>
    </div>
  );
}

/** Quanto das cobranças já entrou, quanto falta. */
function ProgressoRecebimento({ total, recebido, loading }: { total: number; recebido: number; loading: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((recebido / total) * 100))) : 0;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
            <TrendingUp className="size-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">Progresso de recebimento</h4>
            {loading ? (
              <Skeleton className="mt-1 h-3 w-40" />
            ) : (
              <p className="text-xs text-muted-foreground">
                {pct}% recebido de {money(total)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500" />
            Recebido ({pct}%)
          </span>
          <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
            <span className="size-2 rounded-full bg-amber-500" />
            A receber ({100 - pct}%)
          </span>
        </div>
      </div>
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-amber-500/25">
        <div
          style={{ width: `${loading ? 0 : pct}%` }}
          className="bg-emerald-500 transition-all duration-500 ease-out"
          title={`Recebido: ${money(recebido)} (${pct}%)`}
        />
      </div>
    </div>
  );
}

function Situacao({ row }: { row: Entity }) {
  const [classe, Icon, rotulo] =
    row.status === "PAGO" || row.pendente === false
      ? ["border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", CheckCircle2, "Recebido"]
      : row.status === "PARCIAL"
        ? ["border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", Clock3, "Parcial"]
        : ["border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", Clock3, "A receber"];
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${classe}`}>
      <Icon className="size-3 shrink-0" />
      {rotulo}
    </Badge>
  );
}

/** Vencimento enquanto está em aberto; data do pagamento depois de pago. */
function DataDoTitulo({ row }: { row: Entity }) {
  return (
    <>
      <p className="font-medium text-foreground">
        {dateLabel(row.pendente ? row.vencimento_em ?? row.vencimento ?? row.data : row.pago_em ?? row.data)}
      </p>
      <p className="text-xs text-muted-foreground">{row.pendente ? "Vencimento" : "Pagamento"}</p>
    </>
  );
}

function ContaEMetodo({ row }: { row: Entity }) {
  return (
    <>
      <p className="truncate font-medium text-foreground">{row.banco?.titulo || "Conta não informada"}</p>
      <p className="text-xs text-muted-foreground">{row.metodopagamento ? titleCase(row.metodopagamento) : "Método não informado"}</p>
    </>
  );
}

function TabelaCarregando() {
  return (
    <div className="space-y-3 p-4" aria-hidden>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }, (_, col) => (
            <Skeleton key={col} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Acoes({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 opacity-80 group-hover:opacity-100" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Aba Pagamentos: o que o cliente deve pagar pela reserva e o que
 * já pagou. As cobranças já são transações a receber no financeiro; aqui se acompanha e dá
 * baixa nelas, com os mesmos diálogos do fluxo de caixa.
 *
 * Na reserva é como no pagamento da OS: os pagamentos são lançados aqui (à vista ou a
 * prazo, em quantas transações forem) até o total da reserva, e podem ser editados e
 * excluídos. Cada transação nasce ligada à reserva.
 */
export function FinancePanel({ context, permission }: { context: Entity; permission: string }) {
  const { can } = useModulePermission();
  const config = useConfig();
  const query = new URLSearchParams(
    Object.entries(context)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)])
  );

  const remote = useRemote(can(permission) ? `/api/imobiliario/financeiro?${query}` : null);
  // Título carregado do financeiro para a baixa, e qual linha está buscando o seu.
  const [baixa, setBaixa] = useState<Transaction | null>(null);
  const [abrindo, setAbrindo] = useState<number | null>(null);
  // Transação aberta no diálogo do fluxo de caixa (ver ou editar), e o cadastro de um pagamento novo.
  const [aberta, setAberta] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);
  const [excluindo, setExcluindo] = useState<Entity | null>(null);
  const [excluindoBusy, setExcluindoBusy] = useState(false);

  // Baixa e edição são as do fluxo de caixa, com as permissões dele.
  const podeVer = can("financeiro:visualizar");
  const podeBaixar = podeVer && can("financeiro:editar");
  const podeEditar = podeBaixar && config?.habilitar_edicao_transacoes === true;
  // Lançar e excluir pagamento só na reserva; no proprietário a aba só acompanha.
  const naReserva = Boolean(context.reserva_id);
  const podeCriar = naReserva && podeVer && can("financeiro:criar");
  const podeExcluir = naReserva && podeVer && can("financeiro:excluir");

  const excluir = async () => {
    if (!excluindo) return;
    setExcluindoBusy(true);
    try {
      await requestJson(`/api/transaction/${excluindo.id}`, { method: "DELETE" });
      toast.success("Pagamento excluído.");
      setExcluindo(null);
      remote.reload();
    } catch (error) {
      toast.error("Não foi possível excluir o pagamento", { description: (error as Error).message });
    } finally {
      setExcluindoBusy(false);
    }
  };

  const darBaixa = async (row: Entity) => {
    setAbrindo(Number(row.id));
    try {
      const response = await requestJson(`/api/transaction/${row.id}`);
      setBaixa(response.data as Transaction);
    } catch (error) {
      toast.error("Não foi possível abrir a transação", { description: (error as Error).message });
    } finally {
      setAbrindo(null);
    }
  };

  if (!can(permission))
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso aos pagamentos desta entidade.
      </div>
    );

  const loading = remote.loading;
  // Só o que o cliente paga: reembolso, comissão e o que é do proprietário ficam fora.
  const charges: Entity[] = (remote.data?.cobrancas ?? []).filter(
    (row: Entity) => (row.imovel_natureza ?? "RECEBIMENTO") === "RECEBIMENTO"
  );
  const totalCobrado = charges.reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const totalRecebido = charges.reduce((sum, row) => sum + Number(row.valor_pago ?? 0), 0);
  const aReceber = Math.max(totalCobrado - totalRecebido, 0);
  // Na reserva o total é o dela: o que ainda não virou transação fica disponível para lançar.
  const reserva: Entity | null = remote.data?.reserva ?? null;
  const totalDevido = reserva ? Number(reserva.valor_total ?? 0) : totalCobrado;
  const saldoParaLancar = reserva ? Math.max(Math.round((totalDevido - totalCobrado) * 100) / 100, 0) : 0;
  const cancelada = reserva?.status === "CANCELADA";
  const podeLancar = podeCriar && !cancelada && saldoParaLancar > 0;
  // A receita da reserva só é reconhecida no check-out: antes dele, o que o hóspede paga é
  // pagamento ou adiantamento da estadia.
  const rotuloPagamento = reserva && reserva.status !== "CONCLUIDA" ? "pagamento/adiantamento" : "pagamento";

  const menu = (row: Entity) =>
    podeVer || podeBaixar || podeExcluir ? (
      <Acoes label={`Ações da transação ${row.id}`}>
        {podeVer ? (
          <DropdownMenuItem onSelect={() => setAberta(Number(row.id))}>
            {podeEditar ? <Pencil className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
            {podeEditar ? "Editar transação" : "Visualizar transação"}
          </DropdownMenuItem>
        ) : null}
        {row.pendente && podeBaixar ? (
          <DropdownMenuItem onSelect={() => void darBaixa(row)}>
            <CheckCircle2 className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
            Dar baixa
          </DropdownMenuItem>
        ) : null}
        {podeExcluir ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => setExcluindo(row)}
            >
              <Trash2 className="mr-2 size-4" />
              Excluir
            </DropdownMenuItem>
          </>
        ) : null}
      </Acoes>
    ) : null;

  const botaoReceber = (row: Entity) =>
    row.pendente && podeBaixar ? (
      <Button
        size="sm"
        variant="outline"
        disabled={abrindo === Number(row.id)}
        className="h-8 gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300"
        onClick={() => void darBaixa(row)}
      >
        {abrindo === Number(row.id) ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
        Receber
      </Button>
    ) : null;

  if (remote.error && !remote.data) return <RemoteState error={remote.error} retry={remote.reload} />;

  return (
    <div className="space-y-4" aria-busy={loading}>
      <ProgressoRecebimento total={totalDevido} recebido={totalRecebido} loading={loading} />

      {naReserva ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoResumo titulo="Total da reserva" valor={totalDevido} icon={Receipt} scheme="blue" loading={loading} detalhe="Diárias e taxas" />
          <CartaoResumo titulo="Recebido" valor={totalRecebido} icon={CheckCircle2} scheme="emerald" loading={loading} detalhe="Já pago pelo cliente" />
          <CartaoResumo titulo="Títulos pendentes" valor={aReceber} icon={Clock3} scheme="amber" loading={loading} detalhe="Lançados a prazo" />
          <CartaoResumo titulo="Saldo a lançar" valor={saldoParaLancar} icon={Sparkles} scheme="sky" loading={loading} detalhe="Ainda sem transação" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <CartaoResumo titulo="Total cobrado" valor={totalCobrado} icon={Receipt} scheme="blue" loading={loading} detalhe="Soma das cobranças" />
          <CartaoResumo titulo="Recebido" valor={totalRecebido} icon={CheckCircle2} scheme="emerald" loading={loading} detalhe="Já pago pelo cliente" />
          <CartaoResumo titulo="A receber" valor={aReceber} icon={Clock3} scheme="amber" loading={loading} detalhe="Em aberto" />
        </div>
      )}

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <WalletCards className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold tracking-tight text-foreground">Cobranças</h3>
              {loading ? (
                <Skeleton className="h-5 w-6 rounded-full" />
              ) : (
                <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs font-semibold">
                  {charges.length}
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={remote.reload}
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
              Atualizar dados
            </button>
          </div>
        </div>
        {podeCriar ? (
          <Button disabled={loading || !podeLancar} className="w-full gap-2 sm:w-auto" onClick={() => setNovo(true)}>
            <Plus className="size-4" /> Registrar {rotuloPagamento}
          </Button>
        ) : null}
        </div>

        {naReserva && !loading ? (
          cancelada ? (
            <div className="flex items-center gap-2 border-b bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
              <Info className="size-4 shrink-0" />
              <span>Reserva cancelada: não recebe novos pagamentos.</span>
            </div>
          ) : saldoParaLancar <= 0 && totalDevido > 0 ? (
            <div className="flex items-center gap-2 border-b bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Todo o valor da reserva já foi recebido ou está coberto por títulos pendentes.</span>
            </div>
          ) : null
        ) : null}

        {loading ? (
          <TabelaCarregando />
        ) : !charges.length ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="rounded-full bg-muted p-4 text-muted-foreground">
              <WalletCards className="size-8" />
            </div>
            <h4 className="mt-4 font-semibold">{naReserva ? "Nenhum pagamento lançado" : "Nenhuma cobrança"}</h4>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {naReserva
                ? "Lance os pagamentos do cliente, à vista ou a prazo, em quantas transações forem até o total da reserva."
                : "As cobranças do cliente aparecem aqui quando a reserva é registrada."}
            </p>
            {podeLancar ? (
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setNovo(true)}>
                <Plus className="size-4" /> Registrar primeiro {rotuloPagamento}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento / Pagamento</TableHead>
                    <TableHead>Conta e Método</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.map((row) => (
                    <TableRow key={row.id} className="group transition-colors hover:bg-muted/40">
                      <TableCell>
                        <Situacao row={row} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">{row.descricao || `Transação #${row.id}`}</p>
                        <p className="text-[11px] text-muted-foreground/80">Transação #{row.id} · lançada no financeiro</p>
                      </TableCell>
                      <TableCell>
                        <DataDoTitulo row={row} />
                      </TableCell>
                      <TableCell className="max-w-48">
                        <ContaEMetodo row={row} />
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold tabular-nums text-foreground">{money(row.valor)}</p>
                        {Number(row.valor_pago ?? 0) > 0 && row.status !== "PAGO" ? (
                          <p className="text-[11px] tabular-nums text-muted-foreground">Recebido {money(row.valor_pago)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{menu(row)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y sm:hidden">
              {charges.map((row) => (
                <div key={row.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Situacao row={row} />
                        <span className="font-mono text-xs text-muted-foreground">#{row.id}</span>
                      </div>
                      <h4 className="text-sm font-semibold leading-snug text-foreground">{row.descricao || `Transação #${row.id}`}</h4>
                    </div>
                    {menu(row)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-2.5 text-xs">
                    <div>
                      <DataDoTitulo row={row} />
                    </div>
                    <div className="min-w-0">
                      <ContaEMetodo row={row} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/50 pt-2">
                    <div>
                      <span className="text-xs text-muted-foreground">Valor</span>
                      <p className="text-base font-bold tabular-nums text-foreground">{money(row.valor)}</p>
                    </div>
                    {botaoReceber(row)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {aberta != null ? (
        <TransactionDialog
          open
          setOpen={(open) => {
            if (!open) setAberta(null);
          }}
          selectedTransactionId={aberta}
          setSelectedTransactionId={(id) => {
            if (id == null) setAberta(null);
          }}
          editable={podeEditar}
          handleGetTransactions={() => remote.reload()}
        />
      ) : null}

      {novo && reserva ? (
        <TransactionDialog
          open
          setOpen={(open) => {
            if (!open) setNovo(false);
          }}
          handleGetTransactions={() => remote.reload()}
          maximumAmount={saldoParaLancar}
          initialTransaction={{
            tipo: Tipo_transacao.RECEITA,
            reserva_imovel_id: Number(reserva.id),
            valor: saldoParaLancar,
            valorLiquido: saldoParaLancar,
            descricao: `Pagamento da Reserva #${reserva.id}`,
            data: new Date(),
            pendente: false,
            parcelas: 1,
            // O hóspede é o pagador provável; dá para trocar no diálogo.
            cliente_id: reserva.cliente_id ?? null,
            nomepagador: reserva.cliente?.nomerazaosocial ?? undefined,
            cpfcnpjpagador: reserva.cliente?.cpfcnpj ?? undefined,
          }}
        />
      ) : null}

      <AlertDialog
        open={Boolean(excluindo)}
        onOpenChange={(open) => {
          if (!open && !excluindoBusy) setExcluindo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A transação #{excluindo?.id} ({money(excluindo?.valor)}) será excluída do financeiro. O valor volta ao saldo
              a lançar da reserva e, se já tinha sido recebido, o extrato do proprietário registra o estorno.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluindoBusy}
              onClick={(event) => {
                event.preventDefault();
                void excluir();
              }}
            >
              {excluindoBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {baixa ? (
        <ConcluidoAlert
          isAlertOpen
          setIsAlertOpen={(open) => {
            if (!open) setBaixa(null);
          }}
          transaction={baixa}
          onSuccess={remote.reload}
        />
      ) : null}
    </div>
  );
}
