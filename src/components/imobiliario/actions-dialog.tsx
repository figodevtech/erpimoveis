"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { useOptionalConfig } from "@/app/(app)/(pages)/config-context";
import {
  EntityShell,
  StatusBadge,
  requestJson,
} from "./shared";
import { ResponsavelLimpezaSelect } from "./responsavel-limpeza-select";
import {
  type Entity,
  type ModuleKind,
  clientName,
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
  Clock,
  FileText,
  Loader2,
  LogOut,
  Receipt,
  Sparkles,
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
  });
  // Momento da entrada/saída: começa no agora e pode voltar no tempo, para registrar depois
  // uma entrada que já aconteceu. O banco lê no fuso do imobiliário e recusa o futuro.
  const [momento, setMomento] = useState(() => {
    const agora = new Date();
    return {
      data: agora.toLocaleDateString("en-CA"),
      hora: `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`,
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Limpeza do check-out: os padrões vêm de Configurações > Geral; o operador muda na hora.
  // Sem a migration 20261118120000 a configuração não traz o campo e o banco não abriria a limpeza.
  const config = useOptionalConfig();
  const limpezaDisponivel = typeof config?.limpeza_sempre_solicitar === "boolean";
  const [limpeza, setLimpeza] = useState(() => ({
    solicitar: limpezaDisponivel && config?.limpeza_sempre_solicitar === true,
    responsavel: config?.limpeza_responsavel_padrao_id ?? null,
  }));
  const isReservaCancel = kind === "reservas" && action === "CANCELAR";
  const isReservaCheckin = kind === "reservas" && action === "CHECKIN";
  const isReservaCheckout = kind === "reservas" && action === "CHECKOUT";
  const limpezaPendente = isReservaCheckin && item.imovel?.situacao_operacional === "LIMPEZA";
  const destructive = action === "CANCELAR";
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
      <span>Cancelar Operação</span>
    </div>
  ) : (
    <span>{titleCase(action)}</span>
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
    if ((isReservaCheckin || isReservaCheckout) && (!momento.data || !momento.hora)) {
      setError(`Informe a data e a hora do ${isReservaCheckin ? "check-in" : "check-out"}.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await requestJson(`${endpoint(kind, item.id)}/acoes`, {
        method: "POST",
        body: JSON.stringify({
          acao: action,
          ...data,
          ...(isReservaCheckin || isReservaCheckout ? { data_registro: momento.data, hora_registro: momento.hora } : {}),
          ...(isReservaCheckout
            ? {
                solicitar_limpeza: limpeza.solicitar,
                responsavel_limpeza_id: limpeza.solicitar ? limpeza.responsavel : null,
              }
            : {}),
          tratamento_financeiro: data.tratamento_recebidos || undefined,
        }),
      });
      toast.success(
        isReservaCancel
          ? "Reserva cancelada com sucesso!"
          : isReservaCheckin
          ? "Check-in registrado com sucesso!"
          : isReservaCheckout
          ? limpeza.solicitar
            ? "Check-out registrado e limpeza solicitada!"
            : "Check-out registrado com sucesso!"
          : "Ação registrada com sucesso!"
      );
      onSaved();
    } catch (error) {
      setError((error as Error).message);
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
            disabled={busy || (destructive && !data.motivo?.trim())}
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
                <span>Confirmar Cancelamento</span>
              </>
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
        onSubmit={(event) => void submit(event)}
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
                O término da hospedagem será registrado oficialmente e a reserva será concluída.
                {limpeza.solicitar
                  ? <> O imóvel fica em <strong>LIMPEZA</strong> até a limpeza ser concluída.</>
                  : null}
              </p>
            </div>
          </div>
        ) : null}

        {limpezaPendente ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-amber-800 dark:text-amber-300">
            <Sparkles className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-semibold">Limpeza pendente neste imóvel</p>
              <p className="text-xs leading-relaxed">
                A limpeza da última saída ainda não foi concluída. Você pode registrar o check-in mesmo assim.
              </p>
            </div>
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* DATA E HORA DO CHECK-IN / CHECK-OUT                                       */}
        {/* ========================================================================= */}
        {isReservaCheckin || isReservaCheckout ? (
          <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground">
                {isReservaCheckin ? "Data e hora da entrada *" : "Data e hora da saída *"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Já vem com o momento atual. Ajuste para registrar uma {isReservaCheckin ? "entrada" : "saída"} que já aconteceu.
            </p>
            <DateTimePicker
              id="momento-registro"
              date={momento.data}
              time={momento.hora}
              onDateChange={(dia) => setMomento((atual) => ({ ...atual, data: dia }))}
              onTimeChange={(hora) => setMomento((atual) => ({ ...atual, hora }))}
              // Registra-se o que já aconteceu; a saída não vem antes da entrada.
              max={new Date().toLocaleDateString("en-CA")}
              min={isReservaCheckout && item.checkin_em ? new Date(item.checkin_em).toLocaleDateString("en-CA") : undefined}
              placeholder="Selecione a data e a hora"
              className="h-11 sm:h-10 w-full"
            />
            {isReservaCheckout && item.checkin_em ? (
              <p className="text-[11px] text-muted-foreground">
                Check-in registrado em{" "}
                {new Date(item.checkin_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* LIMPEZA DO IMÓVEL (CHECK-OUT)                                             */}
        {/* ========================================================================= */}
        {isReservaCheckout && limpezaDisponivel ? (
          <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-3 shadow-2xs">
            <label htmlFor="solicitar-limpeza" className="flex items-start gap-3 hover:cursor-pointer">
              <Checkbox
                id="solicitar-limpeza"
                checked={limpeza.solicitar}
                onCheckedChange={(value) => setLimpeza((atual) => ({ ...atual, solicitar: value === true }))}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  Solicitar limpeza
                </span>
                <span className="block text-xs text-muted-foreground leading-relaxed">
                  O imóvel fica em Limpeza e aparece na Execução do responsável até a limpeza ser concluída.
                </span>
              </span>
            </label>
            {limpeza.solicitar ? (
              <div className="space-y-1.5 pl-7">
                <p className="text-xs font-medium text-foreground">Responsável pela limpeza</p>
                <ResponsavelLimpezaSelect
                  value={limpeza.responsavel}
                  onValueChange={(responsavel) => setLimpeza((atual) => ({ ...atual, responsavel }))}
                  disabled={busy}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ========================================================================= */}
        {/* TRATAMENTO FINANCEIRO                                                     */}
        {/* ========================================================================= */}
        {destructive ? <FinancialTreatment value={data} onChange={setData} /> : null}

        {/* ========================================================================= */}
        {/* JUSTIFICATIVA / OBSERVAÇÕES                                               */}
        {/* ========================================================================= */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 sm:p-4 space-y-2.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-semibold text-foreground">
              {destructive ? "Motivo e Justificativa Obrigatória *" : "Observações da Operação"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isReservaCancel
              ? "Registre a razão do cancelamento para histórico, auditoria e conciliação financeira."
              : "Descreva o motivo ou anotações importantes para o histórico deste registro."}
          </p>

          <Textarea
            required={destructive}
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
