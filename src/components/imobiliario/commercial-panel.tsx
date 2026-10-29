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
  StatusBadge,
  requestJson,
  useModulePermission,
  useRemote,
} from "./shared";
import { type Entity, dateLabel, listFrom, titleCase } from "./model";
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  User,
} from "lucide-react";

export function CommercialPanel({
  imovelId,
  type,
}: {
  imovelId: number;
  type: "leads" | "visitas";
}) {
  const { can } = useModulePermission();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Entity | null>(null);

  const remote = useRemote(
    `/api/imobiliario/${type}?imovel_id=${imovelId}&page=${page}&pageSize=10&status=${status}`
  );
  const list = listFrom(remote.data);
  const statuses =
    type === "leads"
      ? ["NOVO", "EM_ATENDIMENTO", "CONVERTIDO", "ARQUIVADO"]
      : ["SOLICITADA", "CONFIRMADA", "REALIZADA", "CANCELADA"];

  const totalPages = Math.max(1, Math.ceil(list.total / 10));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-muted/20 p-4 rounded-xl border border-border/60">
        <div className="flex items-center gap-3">
          <SelectField
            label="Filtrar por situação"
            value={status}
            options={statuses}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </div>
        {can("imoveis:editar") ? (
          <Button
            size="sm"
            onClick={() => setEditing({ imovel_id: imovelId, status: statuses[0], origem: "ERP" })}
            className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{type === "leads" ? "Novo contato / Lead" : "Agendar visita"}</span>
          </Button>
        ) : null}
      </div>

      <RemoteState loading={remote.loading} error={remote.error} retry={remote.reload} empty={!list.items.length}>
        <div className="space-y-3">
          {list.items.map((row) => (
            <article
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-xs hover:border-primary/30 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground text-sm sm:text-base">
                    {type === "leads" ? row.nome : `Visita agendada #${row.id}`}
                  </p>
                  <StatusBadge status={row.status} />
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {type === "leads"
                    ? [row.email, row.telefone, titleCase(row.modalidade)].filter(Boolean).join(" · ")
                    : `${dateLabel(row.inicio)} às ${new Date(row.inicio).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`}
                </p>
                {row.mensagem ?? row.observacoes ? (
                  <p className="mt-1.5 line-clamp-2 text-xs sm:text-sm text-foreground/80 bg-muted/40 p-2 rounded-lg border border-border/40">
                    {row.mensagem ?? row.observacoes}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(row)}
                  className="h-8 text-xs gap-1 hover:cursor-pointer touch-manipulation"
                >
                  <span>Abrir</span>
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </RemoteState>

      {list.total > 10 ? (
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm pt-2">
          <span className="text-muted-foreground">
            Página {page} de {totalPages} ({list.total} registros)
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="h-8 text-xs gap-1 hover:cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Anterior</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="h-8 text-xs gap-1 hover:cursor-pointer"
            >
              <span>Próxima</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <CommercialDialog
          type={type}
          initial={editing}
          editable={can("imoveis:editar")}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            remote.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CommercialDialog({
  type,
  initial,
  editable,
  onClose,
  onSaved,
}: {
  type: "leads" | "visitas";
  initial: Entity;
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Entity>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key: string, field: unknown) => setValue((current) => ({ ...current, [key]: field }));

  const input = (key: string, label: string, inputType = "text", required = false) => (
    <Field label={label}>
      <Input
        type={inputType}
        required={required}
        disabled={!editable}
        value={inputType === "datetime-local" && value[key] ? localDateTime(value[key]) : value[key] ?? ""}
        onChange={(event) => set(key, event.target.value)}
        className="h-11 sm:h-10 text-base sm:text-sm"
      />
    </Field>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload =
        type === "visitas"
          ? {
              ...value,
              inicio: new Date(value.inicio).toISOString(),
              fim: new Date(value.fim).toISOString(),
            }
          : value;

      await requestJson(`/api/imobiliario/${type}${value.id ? `/${value.id}` : ""}`, {
        method: value.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });

      toast.success(type === "leads" ? "Contato atualizado com sucesso!" : "Visita atualizada com sucesso!");
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
      title={type === "leads" ? "Contato e atendimento ao lead" : "Agendamento de visita ao imóvel"}
      description="O registro fica vinculado ao imóvel e mantém o histórico das interações com o cliente."
      className="w-[95vw] max-w-xl max-h-[85vh]"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="h-10 sm:h-9 text-xs hover:cursor-pointer"
          >
            Fechar
          </Button>
          {editable ? (
            <Button
              form="commercial-form"
              type="submit"
              disabled={busy}
              className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Salvando…</span>
                </>
              ) : (
                <span>Salvar informações</span>
              )}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id="commercial-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {type === "leads" ? (
            <>
              {input("nome", "Nome completo", "text", true)}
              {input("email", "E-mail de contato", "email")}
              {input("telefone", "Telefone / WhatsApp", "tel")}
              <SelectField
                label="Interesse"
                value={value.modalidade ?? ""}
                options={["TEMPORADA", "LOCACAO", "VENDA", "PROPRIETARIO"]}
                disabled={!editable}
                onChange={(field) => set("modalidade", field)}
              />
            </>
          ) : (
            <>
              {input("inicio", "Data e hora de início", "datetime-local", true)}
              {input("fim", "Data e hora de término", "datetime-local", true)}
            </>
          )}

          <Lookup
            tipo="clientes"
            label="Cliente vinculado (opcional)"
            required={false}
            disabled={!editable}
            value={value.cliente_id}
            initial={value.cliente}
            onChange={(id) => set("cliente_id", id)}
          />

          <SelectField
            label="Situação do atendimento"
            value={value.status ?? ""}
            required
            disabled={!editable}
            options={
              type === "leads"
                ? ["NOVO", "EM_ATENDIMENTO", "CONVERTIDO", "ARQUIVADO"]
                : ["SOLICITADA", "CONFIRMADA", "REALIZADA", "CANCELADA"]
            }
            onChange={(field) => set("status", field)}
          />
        </div>

        <Field label={type === "leads" ? "Mensagem inicial / Detalhes" : "Observações da visita"}>
          <Textarea
            rows={4}
            disabled={!editable}
            placeholder="Anotações do atendimento, preferências do cliente, dúvidas levantadas..."
            value={value[type === "leads" ? "mensagem" : "observacoes"] ?? ""}
            onChange={(event) => set(type === "leads" ? "mensagem" : "observacoes", event.target.value)}
            className="text-base sm:text-sm"
          />
        </Field>

        {Array.isArray(value.historico) && value.historico.length ? (
          <section className="space-y-2 pt-2">
            <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-primary" />
              <span>Histórico de interações</span>
            </h4>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {value.historico.map((entry: Entity, index: number) => (
                <div key={index} className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground font-mono text-[11px]">
                    <span>{dateLabel(entry.em ?? entry.data ?? entry.created_at)}</span>
                    <span className="font-medium text-foreground">{titleCase(entry.status)}</span>
                  </div>
                  <p className="mt-1 text-foreground/90">{entry.mensagem ?? entry.observacao}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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

function localDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 16);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0"
  )}`;
}
