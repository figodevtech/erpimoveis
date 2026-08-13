"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarClock, ClipboardList, PackageMinus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import formatarEmReal from "@/utils/formatarEmReal";
import { BalanceTrail, Field, Metric, MovementDialogShell, Section } from "./movement-dialog-shell";

type Inventory = "produto" | "usoconsumo";

type ExitItem = {
  id?: number;
  produto_id?: number;
  item_id?: number;
  quantidade?: number;
  saldo_anterior?: number;
  saldo_resultante?: number;
  valor_custo_aplicado?: number;
  produto?: { id?: number; titulo?: string | null; referencia?: string | null; unidade?: string | null } | null;
  item?: { id?: number; titulo?: string | null; referencia?: string | null; unidade?: string | null } | null;
};

type ExitDetails = {
  id: number;
  motivo?: string | null;
  observacao?: string | null;
  status?: string | null;
  setor?: string | null;
  funcionario?: string | null;
  created_at?: string;
  cancelada_at?: string | null;
  motivo_cancelamento?: string | null;
  criador?: { id: string; nome: string | null } | null;
  centro_custo?: { id?: number; nome?: string | null } | null;
  itens?: ExitItem[];
};

type Props = {
  exitId: number | null;
  inventory: Inventory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function formatEnum(value: unknown) {
  if (!hasValue(value)) return "Não informado";
  return String(value)
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function formatDateTime(value: unknown) {
  if (!hasValue(value)) return "Não informada";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function statusBadge(status?: string | null) {
  const normalized = status?.toUpperCase();
  if (normalized === "CONFIRMADA") {
    return (
      <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        Confirmada
      </Badge>
    );
  }
  if (normalized === "CANCELADA") {
    return (
      <Badge variant="outline" className="border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300">
        Cancelada
      </Badge>
    );
  }
  return <Badge variant="outline">{formatEnum(status)}</Badge>;
}

export function ExitDetailsDialog({ exitId, inventory, open, onOpenChange }: Props) {
  const [exit, setExit] = useState<ExitDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !exitId) return;

    const controller = new AbortController();
    const endpoint =
      inventory === "produto" ? `/api/estoque/saidas/${exitId}` : `/api/usoconsumo/saidas/${exitId}`;

    // O reset de estado fica dentro da cadeia de promise (e nao no corpo do efeito)
    // para nao disparar renders em cascata — regra react-hooks/set-state-in-effect.
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setExit(null);
        setError(null);
        setLoading(true);
        return fetch(endpoint, { signal: controller.signal });
      })
      .then(async (response) => {
        if (!response) return;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? "Não foi possível consultar a saída.");
        if (!payload?.data) throw new Error("A API não retornou os detalhes da saída.");
        setExit(payload.data as ExitDetails);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Não foi possível consultar a saída.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [exitId, inventory, open]);

  const items = exit?.itens ?? [];
  const totalUnits = items.reduce((total, item) => total + numberValue(item.quantidade), 0);
  const totalCost = items.reduce(
    (total, item) => total + numberValue(item.valor_custo_aplicado) * numberValue(item.quantidade),
    0,
  );
  const autor = exit?.criador?.nome;
  // O destino so existe no fluxo de uso/consumo (setor, funcionario, centro de custo).
  const hasDestino = Boolean(exit?.setor || exit?.funcionario || exit?.centro_custo?.nome);

  return (
    <MovementDialogShell
      open={open}
      onOpenChange={onOpenChange}
      tone="saida"
      kicker={inventory === "produto" ? "Saída de estoque" : "Saída de uso e consumo"}
      movementId={exitId}
      loading={loading}
      loadingLabel="Carregando saída..."
      error={error}
      statusSlot={exit ? statusBadge(exit.status) : null}
      metaSlot={
        exit ? (
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {formatDateTime(exit.created_at)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="size-3.5" />
              {autor || "Autor não registrado"}
            </span>
          </>
        ) : null
      }
    >
      {exit ? (
        <>
          {exit.motivo_cancelamento ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">
                Motivo do cancelamento
              </p>
              <p className="mt-1 text-sm font-medium">{exit.motivo_cancelamento}</p>
              {exit.cancelada_at ? (
                <p className="mt-1 text-xs text-muted-foreground">Cancelada em {formatDateTime(exit.cancelada_at)}</p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Motivo"
              value={<span className="text-base">{formatEnum(exit.motivo)}</span>}
              emphasis
              tone="saida"
              hint={exit.observacao ? "Com observação" : "Sem observação"}
            />
            <Metric
              label="Itens"
              value={items.length.toLocaleString("pt-BR")}
              hint={`${totalUnits.toLocaleString("pt-BR")} unidade(s) retirada(s)`}
            />
            <Metric
              label="Custo baixado"
              value={formatarEmReal(totalCost)}
              hint="Custo aplicado no momento da saída"
            />
          </div>

          {/*
            A NF-e desta saída não mora mais aqui. Este diálogo descreve o que
            saiu do estoque; a nota tem lista própria, com as mesmas ações da
            venda e da OS, aberta por "Emitir NF-e" no menu da linha do
            histórico.
          */}

          <Section title="Dados da saída" icon={ClipboardList}>
            <dl className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Motivo">{formatEnum(exit.motivo)}</Field>
              <Field label="Registrado em">{formatDateTime(exit.created_at)}</Field>
              <Field label="Registrado por">{autor || "Não informado"}</Field>
              <Field label="Situação">{formatEnum(exit.status)}</Field>
              {exit.cancelada_at ? <Field label="Cancelada em">{formatDateTime(exit.cancelada_at)}</Field> : null}
              {exit.observacao ? (
                <Field label="Observação" className="sm:col-span-2 lg:col-span-4">
                  {exit.observacao}
                </Field>
              ) : null}
            </dl>
          </Section>

          {hasDestino ? (
            <Section title="Destino" icon={Building2}>
              <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
                <Field label="Setor">{exit.setor || "Não informado"}</Field>
                <Field label="Funcionário">{exit.funcionario || "Não informado"}</Field>
                <Field label="Centro de custo">{exit.centro_custo?.nome || "Não informado"}</Field>
              </dl>
            </Section>
          ) : null}

          <Section
            title="Itens da saída"
            icon={PackageMinus}
            action={<Badge variant="secondary">{items.length} item(ns)</Badge>}
          >
            <div className="space-y-3">
              {items.map((item, index) => {
                const relatedItem = item.produto || item.item;
                const itemTitle = relatedItem?.titulo || `Item #${item.produto_id || item.item_id || index + 1}`;
                const reference = relatedItem?.referencia;
                const unit = relatedItem?.unidade || "UN";

                return (
                  <article key={item.id ?? index} className="overflow-hidden rounded-lg border">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{itemTitle}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Item #{item.produto_id || item.item_id || relatedItem?.id || item.id}
                          {reference ? ` · Ref. ${reference}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-red-500/25 bg-red-500/10 font-bold tabular-nums text-red-700 dark:text-red-300"
                        >
                          − {numberValue(item.quantidade).toLocaleString("pt-BR")} {unit}
                        </Badge>
                        <BalanceTrail before={item.saldo_anterior} after={item.saldo_resultante} tone="saida" />
                      </div>
                    </div>

                    <dl className="grid gap-3 px-4 py-3 sm:grid-cols-3">
                      <Field label="Custo unitário aplicado">
                        {formatarEmReal(numberValue(item.valor_custo_aplicado))}
                      </Field>
                      <Field label="Custo total do item">
                        {formatarEmReal(numberValue(item.valor_custo_aplicado) * numberValue(item.quantidade))}
                      </Field>
                      <Field label="Quantidade">
                        {numberValue(item.quantidade).toLocaleString("pt-BR")} {unit}
                      </Field>
                    </dl>
                  </article>
                );
              })}

              {!items.length ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Esta saída não possui itens registrados.
                </p>
              ) : null}
            </div>
          </Section>
        </>
      ) : null}
    </MovementDialogShell>
  );
}
