import { CheckCircle2 } from "lucide-react";
import { notFound } from "next/navigation";
import { getPlatformSubscription } from "@/lib/platform-billing/client";
import { PrintButton } from "./print-button";

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

export default async function ComprovantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPlatformSubscription();
  const charge = result.data?.charges.find((item) => item.id === id && item.status === "PAID");
  if (!charge || !result.data) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end"><PrintButton /></div>
      <div className="rounded-2xl border bg-card p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="flex items-center gap-3 border-b pb-6"><CheckCircle2 className="size-10 text-emerald-600" /><div><p className="text-sm text-muted-foreground">Confirmação de pagamento</p><h1 className="text-2xl font-bold">{charge.description}</h1></div></div>
        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Empresa</dt><dd className="mt-1 font-medium">{result.data.company.name}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Competência</dt><dd className="mt-1 font-medium">{charge.competence.slice(0, 7).split("-").reverse().join("/")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Valor confirmado</dt><dd className="mt-1 font-medium">{money(charge.received_amount_cents ?? charge.amount_cents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Pago em</dt><dd className="mt-1 font-medium">{date(charge.paid_at!)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Forma de cobrança</dt><dd className="mt-1 font-medium">{charge.gateway}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Identificador</dt><dd className="mt-1 break-all font-mono text-xs">{charge.id}</dd></div>
        </dl>
        <p className="mt-8 border-t pt-5 text-xs text-muted-foreground">Este documento confirma o registro do pagamento na Central Financeira da assinatura.</p>
      </div>
    </div>
  );
}
