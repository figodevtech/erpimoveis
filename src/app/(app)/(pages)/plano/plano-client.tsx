"use client";
import { VideoUsage } from "@/components/video-usage";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, FileCheck2, Loader2, ReceiptText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PlatformCharge, PlatformSubscription } from "@/lib/platform-billing/types";
import { PaymentDialog } from "./payment-dialog";

type ChargeFilter = "ALL" | "OPEN" | "PAID";

const statusLabel = { PENDING: "A vencer", PAID: "Paga", OVERDUE: "Vencida", CANCELED: "Cancelada", REFUNDED: "Estornada", ERROR: "Erro" } as const;

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : "—";
}

function statusBadge(charge: PlatformCharge) {
  const style = charge.status === "PAID"
    ? "bg-emerald-600 text-white hover:bg-emerald-600"
    : charge.status === "OVERDUE"
      ? "bg-red-600 text-white hover:bg-red-600"
      : charge.status === "PENDING"
        ? "bg-amber-500 text-slate-950 hover:bg-amber-500"
        : "";
  return <Badge className={`text-xs ${style}`} variant="secondary">{statusLabel[charge.status]}</Badge>;
}

export function PlanoClient({ value, stale }: { value: PlatformSubscription; stale: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<ChargeFilter>("ALL");
  const open = value.charges.filter((charge) => ["PENDING", "OVERDUE"].includes(charge.status));
  const paid = value.charges.filter((charge) => charge.status === "PAID");
  const openAmount = open.reduce((sum, charge) => sum + charge.amount_cents, 0);
  const nextDue = [...open].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const subscriptionState = !value.access.allowed ? "Bloqueada" : value.access.showBanner ? "Em atraso" : "Em dia";
  const filteredCharges = useMemo(() => value.charges.filter((charge) => {
    if (filter === "OPEN") return ["PENDING", "OVERDUE"].includes(charge.status);
    if (filter === "PAID") return charge.status === "PAID";
    return true;
  }), [filter, value.charges]);

  return (
    <div className="w-full space-y-4">
      {value.videos && value.videos.capacityBytes > 0 && <div className="rounded-xl border p-4"><VideoUsage service={value.videos} /><p className="text-sm mt-2">Adicional de vídeos: {money(value.videos.monthlyAmountCents)}/mês{value.videos.scheduled ? ` · Próximo valor: ${money(value.videos.scheduled.amount_cents)} em ${date(value.videos.scheduled.competence)}` : ""}</p></div>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Assinatura do sistema</p>
          <h1 className="text-2xl font-bold tracking-tight">Seu Plano</h1>
          <p className="mt-1 text-sm text-muted-foreground">Consulte vencimentos, pague por Pix ou boleto e acompanhe os pagamentos confirmados.</p>
        </div>
        <Badge variant="outline">{value.company.name}</Badge>
      </div>

      {stale ? <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="size-5 shrink-0" />Exibindo a última situação disponível. A Central será consultada novamente automaticamente.</div> : null}
{value.access.showBanner || !value.access.allowed ? <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"><AlertTriangle className="size-5 shrink-0" /><div><p className="font-semibold">Mensalidade pendente</p><p className="text-sm">{value.access.allowed ? "Consulte as cobranças abaixo para verificar o vencimento e regularizar sua situação. Se já pagou, aguarde a confirmação." : "O acesso está bloqueado. Consulte as cobranças abaixo para regularizar sua situação ou entre em contato com o suporte."}</p>{value.access.blockAt ? <p className="mt-1 text-xs">Bloqueio previsto: {date(value.access.blockAt)}</p> : null}</div></div> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="gap-0 py-3"><CardContent className="flex items-center justify-between gap-3 px-4"><div><p className="text-sm font-medium text-muted-foreground">Mensalidade atual</p><p className="mt-0.5 text-2xl font-bold">{money(value.subscription.monthlyAmountCents)}</p></div><ReceiptText className="size-4 text-primary" /></CardContent></Card>
        <Card className="gap-0 py-3"><CardContent className="flex items-center justify-between gap-3 px-4"><div><p className="text-sm font-medium text-muted-foreground">Próximo vencimento</p><p className="mt-0.5 text-2xl font-bold">{nextDue ? date(nextDue.due_date) : "Em dia"}</p></div><CalendarClock className="size-4 text-amber-600" /></CardContent></Card>
        <Card className="gap-0 py-3"><CardContent className="flex items-center justify-between gap-3 px-4"><div><p className="text-sm font-medium text-muted-foreground">Em aberto</p><p className="mt-0.5 text-2xl font-bold">{money(openAmount)}</p><p className="text-sm font-medium text-muted-foreground">{open.length} cobrança(s)</p></div><AlertTriangle className="size-4 text-orange-600" /></CardContent></Card>
        <Card className="gap-0 py-3"><CardContent className="flex items-center justify-between gap-3 px-4"><div><p className="text-sm font-medium text-muted-foreground">Situação da assinatura</p><p className="mt-0.5 text-2xl font-bold">{subscriptionState}</p><p className="text-sm font-medium text-muted-foreground">{paid.length} pagamento(s) confirmado(s)</p></div>{value.access.allowed && !value.access.showBanner ? <ShieldCheck className="size-4 text-emerald-600" /> : <AlertTriangle className={`size-4 ${value.access.allowed ? "text-amber-600" : "text-red-600"}`} />}</CardContent></Card>
      </div>

      <Card className="gap-0 overflow-hidden">
        <CardHeader className="border-b-2 pb-4">
          <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><CardTitle>Lista de cobranças</CardTitle><CardDescription className="flex items-center gap-2"><button className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())} type="button"><span>Recarregar</span><Loader2 className={refreshing ? "animate-spin" : ""} width={12} /></button></CardDescription></div>
            <div className="flex flex-1 items-center justify-center xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
              <div className="inline-flex h-auto items-center justify-center gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                {([
                  ["ALL", `Todas (${value.charges.length})`],
                  ["OPEN", `Em aberto (${open.length})`],
                  ["PAID", `Pagas (${paid.length})`],
                ] as Array<[ChargeFilter, string]>).map(([key, label]) => (
                  <button
                    className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${filter === key ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-background/50 hover:text-foreground"}`}
                    key={key}
                    onClick={() => setFilter(key)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative min-h-[300px] overflow-x-auto px-4 pb-4 pt-0">
          <div className={`${refreshing ? "opacity-100" : "opacity-0"} absolute left-0 right-0 top-0 h-0.5 overflow-hidden bg-slate-400 transition-all`}>
            <div className={`${refreshing ? "animate-slideIn" : ""} absolute left-0 h-full w-1/2 -translate-x-full rounded-lg bg-primary`} />
          </div>
          <Table className="mt-6 min-w-[1000px] text-xs">
            <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Competência</TableHead><TableHead>Vencimento</TableHead><TableHead>Valor</TableHead><TableHead>Situação</TableHead><TableHead>Pagamento</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredCharges.map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell className="max-w-64"><p className="truncate font-medium" title={charge.description}>{charge.description}</p></TableCell>
                  <TableCell className="font-medium">{charge.competence.slice(0, 7).split("-").reverse().join("/")}</TableCell>
                  <TableCell>{date(charge.due_date)}</TableCell>
                  <TableCell className="font-medium">{money(charge.amount_cents)}</TableCell>
                  <TableCell>{statusBadge(charge)}</TableCell>
                  <TableCell>{charge.status === "PAID" ? date(charge.paid_at) : "—"}</TableCell>
                  <TableCell><div className="flex justify-end gap-2">{["PENDING", "OVERDUE"].includes(charge.status) && charge.pix_copy_paste ? <PaymentDialog code={charge.pix_copy_paste} manual={charge.gateway === "MANUAL"} /> : null}{["PENDING", "OVERDUE"].includes(charge.status) && charge.bank_slip_url ? <Button asChild className="h-8 text-xs" size="sm" variant="outline"><a href={charge.gateway === "C6" ? `/api/plano/cobrancas/${charge.id}/boleto` : charge.bank_slip_url} rel="noreferrer" target="_blank"><ExternalLink /> Boleto</a></Button> : null}{charge.status === "PAID" ? <Button asChild className="h-8 text-xs" size="sm" variant="outline"><a href={`/plano/comprovante/${charge.id}`}><FileCheck2 /> Comprovante</a></Button> : null}</div></TableCell>
                </TableRow>
              ))}
              {!filteredCharges.length ? <TableRow><TableCell className="h-56 text-center text-muted-foreground" colSpan={7}><div className="flex flex-col items-center gap-2"><CheckCircle2 className="size-8 opacity-40" /><span>Nenhuma cobrança encontrada neste filtro.</span></div></TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
