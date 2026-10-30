"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  EntityShell,
  Field,
  Lookup,
  RemoteState,
  SelectField,
  StatusBadge,
  requestJson,
  useRemote,
} from "./shared";
import {
  type Entity,
  type ModuleKind,
  clientName,
  dateInput,
  dateLabel,
  endpoint,
  money,
  propertyName,
  titleCase,
} from "./model";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  Receipt,
  User,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getNights(inicio?: string | null, fim?: string | null): number | null {
  if (!inicio || !fim) return null;
  const d1 = new Date(`${String(inicio).slice(0, 10)}T12:00:00`);
  const d2 = new Date(`${String(fim).slice(0, 10)}T12:00:00`);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return isNaN(diffDays) || diffDays <= 0 ? null : diffDays;
}

export function OperationAction({
  kind,
  item,
  action,
  onClose,
  onSaved,
}: {
  kind: ModuleKind;
  item: Entity;
  action: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Entity>({
    motivo: "",
    tratamento_pendentes: "CANCELAR_PENDENTES",
    tratamento_recebidos: "ESTORNAR",
    percentual: "",
    inicio: dateInput(item.proximo_reajuste),
    fim: new Date().toLocaleDateString("en-CA"),
    competencia_inicio: "",
    competencia_fim: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Entity>>({});
  const [reviewed, setReviewed] = useState(false);
  const concluding = kind === "vendas-imobiliarias" && action === "CONCLUIR";
  const operations = useRemote(
    concluding ? `/api/imoveis/${item.imovel_id}/disponibilidade?inicio=${dateInput(item.data_venda)}` : null
  );

  const entries: Entity[] = (operations.data?.items ?? [])
    .filter((row: Entity) => {
      const type = String(row.tipo ?? row.origem ?? row.tipo_origem ?? "").toUpperCase();
      return (
        (row.reserva_id || row.locacao_id || type.includes("RESERVA") || type.includes("LOCACAO")) &&
        !["CANCELADA", "ENCERRADA", "CONCLUIDA"].includes(row.status) &&
        (!row.fim || dateInput(row.fim) > dateInput(item.data_venda))
      );
    })
    .map((row: Entity) => ({
      ...row,
      tipo: row.reserva_id
        ? "RESERVA"
        : row.locacao_id
        ? "LOCACAO"
        : String(row.tipo ?? row.origem ?? row.tipo_origem).toUpperCase().includes("RESERVA")
        ? "RESERVA"
        : "LOCACAO",
      id: row.reserva_id ?? row.locacao_id ?? row.origem_id ?? row.id,
    }));

  const isReservaCancel = kind === "reservas" && action === "CANCELAR";
  const isReservaCheckin = kind === "reservas" && action === "CHECKIN";
  const isReservaCheckout = kind === "reservas" && action === "CHECKOUT";
  const destructive = action === "CANCELAR" || action === "ENCERRAR";
  const nights = getNights(item.inicio, item.fim);

  const set = (key: string, value: unknown) => setData((current) => ({ ...current, [key]: value }));

  const titleNode = isReservaCancel ? (
    <div className="flex items-center gap-2 text-destructive">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span>Cancelar Reserva</span>
    </div>
  ) : isReservaCheckin ? (
    <div className="flex items-center gap-2 text-primary">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>Registrar Check-in da Reserva</span>
    </div>
  ) : isReservaCheckout ? (
    <div className="flex items-center gap-2 text-primary">
      <LogOut className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
      <span>Registrar Check-out da Reserva</span>
    </div>
  ) : destructive ? (
    <div className="flex items-center gap-2 text-destructive">
      <XCircle className="h-5 w-5 shrink-0" />
      <span>
        {action === "ENCERRAR" ? "Encerrar Contrato de Locação" : "Cancelar Operação"}
      </span>
    </div>
  ) : (
    <span>
      {({
        GERAR_COBRANCAS: "Gerar cobranças mensais",
        REAJUSTAR: "Reajustar valor do contrato",
        ATIVAR: "Ativar contrato de locação",
        CONCLUIR: "Concluir venda imobiliária",
      } as Record<string, string>)[action] ?? titleCase(action)}
    </span>
  );

  const headerDescription = isReservaCancel
    ? `Confirmação de cancelamento da Reserva #${item.codigo || item.id}`
    : kind === "reservas"
    ? `Reserva #${item.codigo || item.id} · Período de ${dateLabel(item.inicio)} até ${dateLabel(item.fim)}`
    : `Operação #${item.id} · Situação: ${titleCase(item.status)}`;

  const headerBadges = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <StatusBadge status={item.status} />
      {item.financeiro_status ? <StatusBadge status={item.financeiro_status} /> : null}
    </div>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (concluding && (operations.loading || operations.error)) {
      setError("Carregue todas as operações antes de concluir.");
      return;
    }
    if (concluding && entries.some((row) => !decisions[`${row.tipo}-${row.id}`]?.decisao)) {
      setError("Defina o destino de cada reserva e locação ativa do imóvel.");
      return;
    }
    if (concluding && !reviewed) {
      setError("Revise o resumo das decisões e confirme a conclusão da venda.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const operacoes = entries.map((row) => ({
        tipo: row.tipo,
        id: row.id,
        ...decisions[`${row.tipo}-${row.id}`],
      }));
      await requestJson(`${endpoint(kind, item.id)}/acoes`, {
        method: "POST",
        body: JSON.stringify({
          acao: action,
          ...data,
          ...(concluding ? { operacoes, decisoes: operacoes } : {}),
          tratamento_financeiro: data.tratamento_recebidos || undefined,
        }),
      });
      toast.success(
        isReservaCancel
          ? "Reserva cancelada com sucesso!"
          : isReservaCheckin
          ? "Check-in registrado com sucesso!"
          : isReservaCheckout
          ? "Check-out registrado com sucesso!"
          : "Ação registrada com sucesso!"
      );
      onSaved();
    } catch (error) {
      setError((error as Error).message);
      operations.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntityShell
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={titleNode}
      description={headerDescription}
      badge={headerBadges}
      className="p-0 overflow-hidden flex flex-col w-[95vw] max-w-2xl max-h-[90vh] sm:rounded-2xl"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 w-full">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="h-11 sm:h-9 text-xs sm:text-sm font-medium hover:cursor-pointer w-full sm:w-auto"
          >
            {isReservaCancel ? "Voltar / Não Cancelar" : "Voltar"}
          </Button>

          <Button
            type="submit"
            form="operation-action"
            variant={destructive ? "destructive" : "default"}
            disabled={
              busy ||
              (concluding && (operations.loading || Boolean(operations.error))) ||
              (destructive && !data.motivo?.trim())
            }
            className="h-11 sm:h-9 text-xs sm:text-sm gap-2 font-semibold hover:cursor-pointer shadow-xs w-full sm:w-auto"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>
                  {isReservaCancel
                    ? "Cancelando reserva…"
                    : isReservaCheckin
                    ? "Registrando entrada…"
                    : isReservaCheckout
                    ? "Registrando saída…"
                    : "Processando…"}
                </span>
              </>
            ) : isReservaCancel ? (
              <>
                <XCircle className="h-4 w-4 shrink-0" />
                <span>Confirmar Cancelamento da Reserva</span>
              </>
            ) : isReservaCheckin ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Confirmar Check-in</span>
              </>
            ) : isReservaCheckout ? (
              <>
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Confirmar Check-out</span>
              </>
            ) : destructive ? (
              <>
                <XCircle className="h-4 w-4 shrink-0" />
                <span>
                  {action === "ENCERRAR" ? "Confirmar Encerramento" : "Confirmar Cancelamento"}
                </span>
              </>
            ) : concluding && !reviewed ? (
              <span>Revisar conclusão</span>
            ) : (
              <span>Confirmar ação</span>
            )}
          </Button>
        </div>
      }
    >
      <form
        id="operation-action"
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4 sm:space-y-5"
        onSubmit={(event) => {
          if (concluding && !reviewed) {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) setReviewed(true);
          } else {
            void submit(event);
          }
        }}
      >
        {/* ========================================================================= */}
        {/* CARD DE RESUMO DA RESERVA / OPERAÇÃO                                      */}
        {/* ========================================================================= */}
        {kind === "reservas" ? (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              {/* Imóvel e Código */}
              <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-foreground">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-sm sm:text-base text-foreground truncate">
                      {propertyName(item)}
                    </p>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/40 shrink-0">
                      #{item.codigo || item.id}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 truncate">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                    <span className="font-medium text-foreground/90 truncate">{clientName(item)}</span>
                    {item.cliente?.cpfcnpj ? (
                      <span className="font-mono text-[11px] shrink-0">({item.cliente.cpfcnpj})</span>
                    ) : null}
                  </p>
                </div>
              </div>

              {/* Valores e Noites */}
              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-border/40 w-full sm:w-auto">
                <span className="text-xs text-muted-foreground sm:hidden">Total da Reserva:</span>
                <div className="text-right">
                  <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                    {money(item.valor_total ?? item.diaria)}
                  </p>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    {nights ? `${nights} ${nights === 1 ? "noite" : "noites"} de estadia` : "Período da reserva"}
                  </p>
                </div>
              </div>
            </div>

            {/* Datas e Hóspedes em Grid Responsivo */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2.5 border-t border-border/50 text-xs">
              <div className="flex flex-col bg-card/60 sm:bg-transparent rounded-lg sm:rounded-none p-2 sm:p-0 border sm:border-0 border-border/40">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-muted-foreground/70" />
                  Check-in
                </span>
                <span className="font-semibold text-foreground mt-0.5">{dateLabel(item.inicio)}</span>
              </div>
              <div className="flex flex-col bg-card/60 sm:bg-transparent rounded-lg sm:rounded-none p-2 sm:p-0 border sm:border-0 border-border/40">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-muted-foreground/70" />
                  Check-out
                </span>
                <span className="font-semibold text-foreground mt-0.5">{dateLabel(item.fim)}</span>
              </div>
              <div className="flex flex-col col-span-2 sm:col-span-1 bg-card/60 sm:bg-transparent rounded-lg sm:rounded-none p-2 sm:p-0 border sm:border-0 border-border/40">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground/70" />
                  Hóspedes
                </span>
                <span className="font-semibold text-foreground mt-0.5">
                  {item.hospedes ?? 1} {Number(item.hospedes) === 1 ? "hóspede" : "hóspedes"}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* BANNER DE ALERTA DE CANCELAMENTO OU OPERAÇÃO                              */}
        {/* ========================================================================= */}
        {isReservaCancel ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 sm:p-4 text-xs sm:text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Atenção: Ação de Cancelamento</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                O cancelamento mudará a situação desta reserva para <strong>CANCELADA</strong> e liberará as datas do imóvel no calendário de reservas. Defina as diretrizes financeiras abaixo e informe a justificativa.
              </p>
            </div>
          </div>
        ) : isReservaCheckin ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div className="space-y-1">
              <p className="font-semibold">Confirmação de Check-in</p>
              <p className="text-xs leading-relaxed">
                A entrada do hóspede será registrada oficialmente e a situação da reserva passará para <strong>EM ANDAMENTO</strong>.
              </p>
            </div>
          </div>
        ) : isReservaCheckout ? (
          <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-sky-800 dark:text-sky-300">
            <LogOut className="h-5 w-5 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
            <div className="space-y-1">
              <p className="font-semibold">Confirmação de Check-out</p>
              <p className="text-xs leading-relaxed">
                O término da hospedagem será registrado oficialmente, concluindo a reserva e liberando o imóvel no calendário para limpeza e novas estadias.
              </p>
            </div>
          </div>
        ) : destructive ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 sm:p-4 text-xs sm:text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Atenção ao Encerramento</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Defina como tratar cobranças pendentes e valores já recebidos. O estorno registra a obrigação de reembolso para conciliação contábil no ERP.
              </p>
            </div>
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* TRATAMENTO FINANCEIRO                                                     */}
        {/* ========================================================================= */}
        {destructive ? (
          <div className="space-y-4">
            <FinancialTreatment value={data} onChange={setData} />

            {kind === "locacoes-imobiliarias" ? (
              <Field label="Data efetiva do encerramento do contrato">
                <Input
                  type="date"
                  required
                  min={dateInput(item.inicio)}
                  value={data.fim}
                  onChange={(event) => set("fim", event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* CONCLUIR VENDA (MANTÉM OPERAÇÕES VIGENTES)                                */}
        {/* ========================================================================= */}
        {concluding ? (
          <>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
              <p className="font-semibold text-sm sm:text-base text-foreground">
                {reviewed ? "Revisão da conclusão da venda" : "Destino das operações vigentes do imóvel"}
              </p>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                A conclusão da venda preserva o histórico de lançamentos. Cada reserva e contrato vigente ou futuro
                precisa de uma decisão definida antes de prosseguir.
              </p>
              <div className="mt-3 flex items-center gap-4 text-xs sm:text-sm">
                <span>
                  Valor negociado: <strong>{money(item.valor_total)}</strong>
                </span>
                <span>·</span>
                <span>
                  Data da venda: <strong>{dateLabel(item.data_venda)}</strong>
                </span>
              </div>
            </div>

            <RemoteState loading={operations.loading} error={operations.error} retry={operations.reload}>
              {entries.length ? (
                <div className="space-y-4">
                  {entries.map((row) => {
                    const key = `${row.tipo}-${row.id}`;
                    const decision = decisions[key] ?? {};
                    const update = (field: string, val: unknown) => {
                      setReviewed(false);
                      setDecisions((current) => ({
                        ...current,
                        [key]: { ...current[key], [field]: val },
                      }));
                    };

                    return (
                      <section
                        key={key}
                        className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-xs"
                      >
                        <div>
                          <h4 className="font-semibold text-sm text-foreground">
                            {titleCase(row.tipo)} #{row.id}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {dateLabel(row.inicio)} a {dateLabel(row.fim)} · {titleCase(row.status)}
                          </p>
                        </div>

                        <SelectField
                          label="Destino desta operação"
                          value={decision.decisao ?? ""}
                          options={[
                            { value: "MANTER", label: "Manter operação" },
                            { value: "ENCERRAR", label: "Encerrar / cancelar operação" },
                          ]}
                          required
                          onChange={(value) => update("decisao", value)}
                        />

                        {decision.decisao === "MANTER" ? (
                          <div className="space-y-4 border-t border-border/40 pt-3">
                            <Lookup
                              tipo="proprietarios"
                              label="Novo proprietário beneficiário do repasse"
                              value={decision.beneficiario_proprietario_id}
                              onChange={(value) => update("beneficiario_proprietario_id", value)}
                            />
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field label="Benefício válido a partir de">
                                <Input
                                  type="date"
                                  required
                                  value={decision.vigencia_inicio ?? ""}
                                  onChange={(event) => update("vigencia_inicio", event.target.value)}
                                  className="h-11 sm:h-10 text-base sm:text-sm"
                                />
                              </Field>
                              <Field label="Até (opcional)">
                                <Input
                                  type="date"
                                  value={decision.vigencia_fim ?? ""}
                                  min={decision.vigencia_inicio || undefined}
                                  onChange={(event) => update("vigencia_fim", event.target.value)}
                                  className="h-11 sm:h-10 text-base sm:text-sm"
                                />
                              </Field>
                            </div>
                          </div>
                        ) : decision.decisao === "ENCERRAR" ? (
                          <div className="border-t border-border/40 pt-3">
                            <FinancialTreatment
                              value={decision}
                              onChange={(next) => {
                                setReviewed(false);
                                setDecisions((current) => ({ ...current, [key]: next }));
                              }}
                            />
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Não há reservas ou locações vigentes ou futuras ativas para este imóvel.
                </div>
              )}
            </RemoteState>

            {reviewed ? (
              <div
                role="status"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-800 dark:text-emerald-300"
              >
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  <div>
                    <p className="font-semibold">Revisão completa das decisões</p>
                    <p className="mt-1">
                      A propriedade será registrada como vendida em {dateLabel(item.data_venda)}. As {entries.length}{" "}
                      operação(ões) vigentes seguirão as definições informadas acima.
                    </p>
                    <Button
                      type="button"
                      className="mt-3 h-8 text-xs"
                      size="sm"
                      variant="outline"
                      onClick={() => setReviewed(false)}
                    >
                      Voltar e revisar decisões
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ========================================================================= */}
        {/* OUTRAS AÇÕES ESPECÍFICAS                                                  */}
        {/* ========================================================================= */}
        {action === "GERAR_COBRANCAS" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Competência inicial (mês/ano)">
              <Input
                type="month"
                required
                value={data.competencia_inicio}
                onChange={(event) => set("competencia_inicio", event.target.value)}
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </Field>
            <Field label="Competência final (mês/ano)">
              <Input
                type="month"
                required
                min={data.competencia_inicio || undefined}
                value={data.competencia_fim}
                onChange={(event) => set("competencia_fim", event.target.value)}
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </Field>
          </div>
        ) : null}

        {action === "REAJUSTAR" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Percentual de reajuste (%)">
                <Input
                  type="number"
                  min="-100"
                  step="0.01"
                  required
                  placeholder="Ex: 5.5"
                  value={data.percentual}
                  onChange={(event) => set("percentual", Number(event.target.value))}
                  className="h-11 sm:h-10 text-base sm:text-sm font-semibold"
                />
              </Field>
              <Field label="Vigência do novo valor">
                <Input
                  type="date"
                  required
                  value={data.inicio}
                  onChange={(event) => set("inicio", event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm"
                />
              </Field>
              <Field label="Data prevista do próximo reajuste">
                <Input
                  type="date"
                  value={data.proximo_reajuste ?? ""}
                  onChange={(event) => set("proximo_reajuste", event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm"
                />
              </Field>
            </div>
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* JUSTIFICATIVA / OBSERVAÇÕES                                               */}
        {/* ========================================================================= */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-2.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-semibold text-foreground">
              {destructive
                ? "Motivo e Justificativa Obrigatória *"
                : concluding || action === "REAJUSTAR"
                ? "Justificativa Obrigatória *"
                : "Observações da Operação"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isReservaCancel
              ? "Registre a razão do cancelamento para histórico, auditoria e conciliação financeira."
              : "Descreva o motivo ou anotações importantes para o histórico deste registro."}
          </p>

          <Textarea
            required={destructive || concluding || action === "REAJUSTAR"}
            placeholder={
              isReservaCancel
                ? "Ex: Desistência pelo hóspede devido a imprevisto pessoal; cancelamento conforme prazo da política de cancelamento..."
                : "Detalhe o motivo ou registre observações importantes sobre esta ação..."
            }
            value={data.motivo}
            onChange={(event) => set("motivo", event.target.value)}
            className="text-base sm:text-sm min-h-[90px] leading-relaxed resize-y"
            rows={3}
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs sm:text-sm text-destructive font-medium"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </form>
    </EntityShell>
  );
}

function FinancialTreatment({
  value,
  onChange,
}: {
  value: Entity;
  onChange: (value: Entity) => void;
}) {
  const pendente = value.tratamento_pendentes || "CANCELAR_PENDENTES";
  const recebido = value.tratamento_recebidos || "ESTORNAR";

  const setField = (field: string, val: string) => {
    onChange({
      ...value,
      [field]: val,
      ...(field === "tratamento_recebidos" ? { tratamento_financeiro: val } : {}),
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Cobranças Pendentes (A receber) */}
      <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary shrink-0" />
          <h4 className="text-sm font-semibold text-foreground">
            Cobranças Pendentes (A receber) *
          </h4>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Como deseja tratar as parcelas futuras em aberto desta operação:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1" role="radiogroup" aria-label="Tratamento de cobranças pendentes">
          <button
            type="button"
            role="radio"
            aria-checked={pendente === "CANCELAR_PENDENTES"}
            onClick={() => setField("tratamento_pendentes", "CANCELAR_PENDENTES")}
            className={cn(
              "flex flex-col text-left p-3.5 rounded-xl border transition-all hover:cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              pendente === "CANCELAR_PENDENTES"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                : "border-border/60 hover:bg-muted/40 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                Cancelar cobranças pendentes
              </span>
              {pendente === "CANCELAR_PENDENTES" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/80 shrink-0" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Remove os títulos em aberto do Contas a Receber (Recomendado).
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={pendente === "MANTER"}
            onClick={() => setField("tratamento_pendentes", "MANTER")}
            className={cn(
              "flex flex-col text-left p-3.5 rounded-xl border transition-all hover:cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              pendente === "MANTER"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                : "border-border/60 hover:bg-muted/40 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                Manter cobranças para recebimento
              </span>
              {pendente === "MANTER" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/80 shrink-0" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Mantém títulos em aberto para cobrança posterior de taxas ou multas.
            </span>
          </button>
        </div>
      </div>

      {/* 2. Valores Já Recebidos (Pagos) */}
      <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-primary shrink-0" />
          <h4 className="text-sm font-semibold text-foreground">
            Valores Já Recebidos / Pagos *
          </h4>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Como tratar os pagamentos já registrados e recebidos desta operação:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1" role="radiogroup" aria-label="Tratamento de valores já recebidos">
          <button
            type="button"
            role="radio"
            aria-checked={recebido === "ESTORNAR"}
            onClick={() => setField("tratamento_recebidos", "ESTORNAR")}
            className={cn(
              "flex flex-col text-left p-3.5 rounded-xl border transition-all hover:cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              recebido === "ESTORNAR"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                : "border-border/60 hover:bg-muted/40 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                Registrar estorno / reembolso
              </span>
              {recebido === "ESTORNAR" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/80 shrink-0" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Gera pendência no Contas a Pagar para devolução ao hóspede.
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={recebido === "CREDITO"}
            onClick={() => setField("tratamento_recebidos", "CREDITO")}
            className={cn(
              "flex flex-col text-left p-3.5 rounded-xl border transition-all hover:cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              recebido === "CREDITO"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                : "border-border/60 hover:bg-muted/40 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                Converter em crédito
              </span>
              {recebido === "CREDITO" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/80 shrink-0" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Gera saldo de crédito vinculado ao cliente para estadias futuras.
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={recebido === "MANTER"}
            onClick={() => setField("tratamento_recebidos", "MANTER")}
            className={cn(
              "flex flex-col text-left p-3.5 rounded-xl border transition-all hover:cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              recebido === "MANTER"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                : "border-border/60 hover:bg-muted/40 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                Reter valor recebido
              </span>
              {recebido === "MANTER" ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/80 shrink-0" />
              )}
            </div>
            <span className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Mantém o valor na conta (sem reembolso, conforme política de cancelamento).
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
