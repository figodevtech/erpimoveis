"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { toast } from "sonner";
import {
  EntityShell,
  Field,
  Lookup,
  RemoteState,
  SelectField,
  StatusBadge,
  requestJson,
  useModulePermission,
  useRemote,
} from "./shared";
import { type Entity, dateLabel, money, titleCase } from "./model";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";

const ServiceInvoiceDialog = dynamic(() => import("./service-invoice-dialog"), {
  loading: () => (
    <div className="flex items-center justify-center p-8 gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span>Carregando NFS-e…</span>
    </div>
  ),
});

export function FinancePanel({ context, permission }: { context: Entity; permission: string }) {
  const { can } = useModulePermission();
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const query = new URLSearchParams(
    Object.entries(context)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)])
  );
  if (inicio) query.set("inicio", inicio);
  if (fim) query.set("fim", fim);

  const remote = useRemote(can(permission) ? `/api/imobiliario/financeiro?${query}` : null);
  const [action, setAction] = useState<{ tipo: string; row?: Entity } | null>(null);
  const [invoice, setInvoice] = useState(false);

  if (!can(permission))
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso ao módulo financeiro desta entidade.
      </div>
    );

  const totals = remote.data?.totais ?? {};
  const rows = remote.data?.items ?? [];
  const charges = remote.data?.cobrancas ?? [];

  return (
    <div className="space-y-6">
      {/* Barra de Filtros e Ações Financeiras */}
      <div className="flex flex-wrap items-end justify-between gap-3 bg-muted/20 p-4 rounded-xl border border-border/60">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Data inicial">
            <Input
              type="date"
              value={inicio}
              onChange={(event) => setInicio(event.target.value)}
              className="h-10 sm:h-9 text-xs sm:text-sm bg-background"
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={fim}
              onChange={(event) => setFim(event.target.value)}
              className="h-10 sm:h-9 text-xs sm:text-sm bg-background"
            />
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={remote.reload}
            className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Atualizar</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can("financeiro:criar") || can(permission) ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAction({ tipo: "DESPESA" })}
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation text-destructive hover:bg-destructive/10"
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                <span>Registrar despesa</span>
              </Button>
              {context.proprietario_id || context.imovel_id ? (
                <Button
                  size="sm"
                  onClick={() => setAction({ tipo: "REPASSE" })}
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>Registrar repasse</span>
                </Button>
              ) : null}
            </>
          ) : null}
          {can("financeiro:notas_fiscais") ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInvoice(true)}
              className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
            >
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span>NFS-e de serviços</span>
            </Button>
          ) : null}
        </div>
      </div>

      <RemoteState loading={remote.loading} error={remote.error} retry={remote.reload}>
        {/* KPI Cards Financeiros */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { key: "recebido", label: "Total Recebido", color: "text-emerald-600 dark:text-emerald-400" },
            {
              key: "receita_administradora",
              label: "Comissão / Adm",
              color: "text-blue-600 dark:text-blue-400",
            },
            { key: "despesas", label: "Despesas e Custos", color: "text-rose-600 dark:text-rose-400" },
            { key: "repassado", label: "Total Repassado", color: "text-indigo-600 dark:text-indigo-400" },
            { key: "saldo_repassar", label: "Saldo a Repassar", color: "text-amber-600 dark:text-amber-400" },
          ].map(({ key, label, color }) => (
            <div key={key} className="rounded-xl border border-border/60 bg-card p-4 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className={`mt-2 text-lg font-bold tracking-tight ${color}`}>{money(totals[key])}</p>
            </div>
          ))}
        </div>

        {/* Tabela de Cobranças */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm sm:text-base text-foreground flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Cobranças e Faturas
            </h3>
            <span className="text-xs text-muted-foreground">{charges.length} registro(s)</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 sm:px-4">Cobrança</th>
                    <th className="p-3.5 sm:px-4">Vencimento</th>
                    <th className="p-3.5 sm:px-4">Valor</th>
                    <th className="p-3.5 sm:px-4">Pago</th>
                    <th className="p-3.5 sm:px-4">Situação</th>
                    <th className="p-3.5 sm:px-4 text-right">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {charges.map((row: Entity) => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3.5 sm:px-4 font-medium text-foreground">
                        {row.descricao ?? `Fatura #${row.id}`}
                      </td>
                      <td className="p-3.5 sm:px-4 text-muted-foreground">
                        {dateLabel(row.vencimento ?? row.data_vencimento)}
                      </td>
                      <td className="p-3.5 sm:px-4 font-semibold text-foreground">
                        {money(row.valor ?? row.valor_total)}
                      </td>
                      <td className="p-3.5 sm:px-4 text-muted-foreground">{money(row.valor_pago)}</td>
                      <td className="p-3.5 sm:px-4">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="p-3.5 sm:px-4 text-right">
                        {(can("financeiro:editar") || can(permission)) &&
                        !["PAGO", "CANCELADA", "CANCELADO"].includes(row.status) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1 hover:cursor-pointer touch-manipulation"
                            onClick={() => setAction({ tipo: "BAIXA", row })}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Receber</span>
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!charges.length ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                        Nenhuma cobrança registrada neste período.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Tabela de Movimentações e Extrato */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm sm:text-base text-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Movimentações e Extrato da Conta
            </h3>
            <span className="text-xs text-muted-foreground">{rows.length} lançamento(s)</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 sm:px-4">Data</th>
                    <th className="p-3.5 sm:px-4">Descrição</th>
                    <th className="p-3.5 sm:px-4">Tipo</th>
                    <th className="p-3.5 sm:px-4">Valor</th>
                    <th className="p-3.5 sm:px-4">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((row: Entity, index: number) => (
                    <tr key={row.id ?? index} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3.5 sm:px-4 text-muted-foreground">{dateLabel(row.data ?? row.created_at)}</td>
                      <td className="p-3.5 sm:px-4 font-medium text-foreground">
                        {row.descricao ?? row.observacoes ?? `Lançamento #${row.id}`}
                      </td>
                      <td className="p-3.5 sm:px-4 text-xs font-medium text-muted-foreground">
                        {titleCase(row.tipo ?? row.natureza ?? row.origem)}
                      </td>
                      <td className="p-3.5 sm:px-4 font-bold text-foreground">{money(row.valor)}</td>
                      <td className="p-3.5 sm:px-4">
                        <StatusBadge status={row.status ?? (row.pendente ? "PENDENTE" : "PAGO")} />
                      </td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                        Nenhuma movimentação no período selecionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </RemoteState>

      {action ? (
        <FinancialAction
          action={action}
          context={context}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            remote.reload();
          }}
        />
      ) : null}

      {invoice ? (
        <ServiceInvoiceDialog context={context} onClose={() => setInvoice(false)} onSaved={remote.reload} />
      ) : null}
    </div>
  );
}

function FinancialAction({
  action,
  context,
  onClose,
  onSaved,
}: {
  action: { tipo: string; row?: Entity };
  context: Entity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Entity>({
    tipo: action.tipo,
    idempotency_key: crypto.randomUUID(),
    data: new Date().toLocaleDateString("en-CA"),
    valor:
      action.tipo === "BAIXA"
        ? Math.max(0, Number(action.row?.valor ?? action.row?.valor_total ?? 0) - Number(action.row?.valor_pago ?? 0))
        : "",
    metodo_pagamento: "PIX",
    descricao: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson(
        action.tipo === "BAIXA"
          ? `/api/imobiliario/cobrancas/${action.row?.id}/baixar`
          : "/api/imobiliario/financeiro",
        {
          method: "POST",
          body: JSON.stringify({ ...context, ...value, valor: Number(value.valor) }),
        }
      );
      toast.success(action.tipo === "BAIXA" ? "Recebimento registrado com sucesso!" : "Movimentação registrada com sucesso!");
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, field: unknown) =>
    setValue((current) => ({ ...current, [key]: field, idempotency_key: crypto.randomUUID() }));

  return (
    <EntityShell
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={
        action.tipo === "BAIXA"
          ? "Registrar recebimento de cobrança"
          : action.tipo === "REPASSE"
          ? "Registrar repasse ao proprietário"
          : "Registrar despesa / custo"
      }
      description="O lançamento financeiro será vinculado à conta e ao extrato contábil do imóvel."
      className="w-[95vw] max-w-xl max-h-[85vh]"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="h-10 sm:h-9 text-xs hover:cursor-pointer"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="financial-action"
            disabled={busy}
            className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Registrando…</span>
              </>
            ) : (
              <span>Confirmar lançamento</span>
            )}
          </Button>
        </div>
      }
    >
      <form id="financial-action" onSubmit={submit} className="space-y-4">
        {context.proprietario_id && !context.imovel_id && action.tipo !== "BAIXA" ? (
          <Lookup
            tipo="imoveis"
            label="Imóvel vinculado ao movimento"
            value={value.imovel_id}
            onChange={(id) => update("imovel_id", id)}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor">
            <ValueInput
              required
              placeholder="R$ 0,00"
              value={value.valor != null && value.valor !== "" ? Number(value.valor) : null}
              onValueChange={(val) => update("valor", val)}
              onEmpty={() => update("valor", "")}
              allowEmpty
              className="h-11 sm:h-10 text-base sm:text-sm font-semibold"
            />
          </Field>
          <Field label="Data da operação">
            <Input
              type="date"
              required
              value={value.data}
              onChange={(event) => update("data", event.target.value)}
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </Field>
          <Lookup
            tipo="bancos"
            label="Conta bancária do ERP"
            value={value.banco_id}
            required
            onChange={(id) => update("banco_id", id)}
          />
          <SelectField
            label="Método de pagamento"
            value={value.metodo_pagamento}
            options={["PIX", "DINHEIRO", "TRANSFERENCIA", "CARTAO", "BOLETO"]}
            required
            onChange={(field) => update("metodo_pagamento", field)}
          />
        </div>

        <Field label="Descrição / Justificativa">
          <Textarea
            required
            placeholder="Descreva detalhes ou anote referências deste lançamento..."
            value={value.descricao}
            onChange={(event) => update("descricao", event.target.value)}
            className="text-base sm:text-sm"
            rows={3}
          />
        </Field>

        {error ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </form>
    </EntityShell>
  );
}
