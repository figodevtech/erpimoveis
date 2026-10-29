"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EntityShell,
  Field,
  Lookup,
  RemoteState,
  SelectField,
  requestJson,
  useRemote,
} from "./shared";
import {
  type Entity,
  type ModuleKind,
  dateInput,
  dateLabel,
  endpoint,
  money,
  titleCase,
} from "./model";
import { AlertCircle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";

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
    tratamento_pendentes: "",
    tratamento_recebidos: "",
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

  const destructive = action === "CANCELAR" || action === "ENCERRAR";
  const set = (key: string, value: unknown) => setData((current) => ({ ...current, [key]: value }));

  const title =
    ({
      CHECKIN: "Registrar check-in da reserva",
      CHECKOUT: "Registrar check-out da reserva",
      CANCELAR: "Cancelar operação",
      ENCERRAR: "Encerrar contrato de locação",
      GERAR_COBRANCAS: "Gerar cobranças mensais",
      REAJUSTAR: "Reajustar valor do contrato",
      ATIVAR: "Ativar contrato de locação",
      CONCLUIR: "Concluir venda imobiliária",
    } as Record<string, string>)[action] ?? titleCase(action);

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
      toast.success("Ação registrada com sucesso!");
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
      title={title}
      description={`Operação #${item.id} · Situação: ${titleCase(item.status)}`}
      className="w-[95vw] max-w-2xl max-h-[90vh]"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="h-10 sm:h-9 text-xs hover:cursor-pointer"
          >
            Voltar
          </Button>
          <Button
            type="submit"
            form="operation-action"
            disabled={busy || (concluding && (operations.loading || Boolean(operations.error)))}
            className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Processando…</span>
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
        className="space-y-5"
        onSubmit={(event) => {
          if (concluding && !reviewed) {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) setReviewed(true);
          } else {
            void submit(event);
          }
        }}
      >
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
                    const update = (field: string, value: unknown) => {
                      setReviewed(false);
                      setDecisions((current) => ({
                        ...current,
                        [key]: { ...current[key], [field]: value },
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

        {destructive ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-xs sm:text-sm text-muted-foreground">
              Defina como tratar cobranças pendentes e valores já recebidos. O estorno registra a obrigação de
              reembolso para conciliação contábil no ERP.
            </div>
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

        {action === "CHECKIN" || action === "CHECKOUT" ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-xs sm:text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
            Será registrado o {action === "CHECKIN" ? "início oficial (check-in)" : "término oficial (check-out)"} da
            hospedagem, atualizando a situação da reserva e preservando o extrato financeiro.
          </div>
        ) : null}

        <Field
          label={
            destructive || concluding || action === "REAJUSTAR"
              ? "Justificativa obrigatória"
              : "Observações da ação"
          }
        >
          <Textarea
            required={destructive || concluding || action === "REAJUSTAR"}
            placeholder="Detalhe o motivo ou registre observações importantes sobre esta ação..."
            value={data.motivo}
            onChange={(event) => set("motivo", event.target.value)}
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

function FinancialTreatment({
  value,
  onChange,
}: {
  value: Entity;
  onChange: (value: Entity) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Tratamento de cobranças pendentes"
        required
        value={value.tratamento_pendentes ?? ""}
        options={[
          { value: "CANCELAR_PENDENTES", label: "Cancelar cobranças pendentes" },
          { value: "MANTER", label: "Manter cobranças para recebimento futuro" },
        ]}
        onChange={(field) => onChange({ ...value, tratamento_pendentes: field })}
      />
      <SelectField
        label="Tratamento de valores já recebidos"
        required
        value={value.tratamento_recebidos ?? ""}
        options={[
          { value: "MANTER", label: "Manter recebimentos na conta" },
          { value: "ESTORNAR", label: "Registrar obrigação de estorno / reembolso" },
          { value: "CREDITO", label: "Converter em crédito para o cliente" },
        ]}
        onChange={(field) =>
          onChange({
            ...value,
            tratamento_recebidos: field,
            tratamento_financeiro: field,
          })
        }
      />
    </div>
  );
}
