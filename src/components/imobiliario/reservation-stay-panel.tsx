"use client";

import Link from "next/link";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  LogIn,
  LogOut,
  Pencil,
  Sparkles,
  User,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RemoteState, useModulePermission, useRemote } from "./shared";
import { type Entity, dateLabel } from "./model";
import { OperationAction } from "./actions-dialog";

type Pessoa = { id: string; nome?: string | null; email?: string | null } | null;
type Estadia = {
  id: number;
  status: string;
  inicio: string;
  fim: string;
  horario_checkin?: string | null;
  horario_checkout?: string | null;
  checkin_em?: string | null;
  checkout_em?: string | null;
  checkin_observacoes?: string | null;
  checkout_observacoes?: string | null;
  registrou_checkin?: Pessoa;
  registrou_checkout?: Pessoa;
  limpeza: {
    id: number;
    status: "PENDENTE" | "CONCLUIDA" | "CANCELADA";
    descricao?: string | null;
    solicitada_em: string;
    concluida_em?: string | null;
    observacoes?: string | null;
    responsavel?: Pessoa;
    solicitante?: Pessoa;
    concluinte?: Pessoa;
  } | null;
};

const FUSO = "America/Fortaleza";
const momento = (valor?: string | null) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO }) : null;
const hhmm = (valor?: string | null) => (valor ? String(valor).slice(0, 5) : null);
const nomeDe = (p?: Pessoa) => p?.nome?.trim() || p?.email?.trim() || null;

/**
 * Registrado × previsto: "1 h 30 min depois do previsto". O previsto é a data da reserva com o
 * horário dela, no fuso do imobiliário (sem horário de verão, UTC−3). Até 15 min é "no horário".
 */
function comparacao(data: string, horario: string | null, registrado: string | null | undefined) {
  if (!registrado || !horario) return null;
  const previsto = Date.parse(`${data.slice(0, 10)}T${horario}:00-03:00`);
  const minutos = Math.round((Date.parse(registrado) - previsto) / 60_000);
  if (Number.isNaN(minutos)) return null;
  if (Math.abs(minutos) <= 15) return { texto: "No horário previsto", tom: "ok" as const };
  const total = Math.abs(minutos);
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const resto = total % 60;
  const partes = [dias ? `${dias} ${dias === 1 ? "dia" : "dias"}` : "", horas ? `${horas} h` : "", !dias && resto ? `${resto} min` : ""]
    .filter(Boolean)
    .join(" ");
  return { texto: `${partes} ${minutos > 0 ? "depois" : "antes"} do previsto`, tom: "aviso" as const };
}

function Linha({ icon: Icon, rotulo, children }: { icon: ComponentType<{ className?: string }>; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <div className="break-words text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

const vazio = (texto: string) => <span className="text-muted-foreground">{texto}</span>;

function Momento({
  titulo,
  icon: Icon,
  tom,
  data,
  horario,
  registrado,
  por,
  observacoes,
  aguardando,
  onEditar,
}: {
  titulo: string;
  icon: ComponentType<{ className?: string }>;
  tom: "emerald" | "sky";
  data: string;
  horario: string | null;
  registrado?: string | null;
  por?: Pessoa;
  observacoes?: string | null;
  /** Texto quando ainda não foi registrado (depende da situação da reserva). */
  aguardando: string;
  /** Sem ele (sem permissão ou etapa não feita), não há botão de editar. */
  onEditar?: () => void;
}) {
  const diferenca = comparacao(data, horario, registrado);
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-8 w-8 place-items-center rounded-full",
              tom === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <h4 className="text-sm font-semibold text-foreground">{titulo}</h4>
        </div>
        <div className="flex items-center gap-1.5">
          {registrado ? (
            <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
              Registrado
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              Não registrado
            </Badge>
          )}
          {onEditar ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${titulo.toLowerCase()}`}
                  onClick={onEditar}
                  className="h-7 w-7 rounded-full text-muted-foreground hover:cursor-pointer hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Editar</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="space-y-3.5">
        <Linha icon={CalendarClock} rotulo="Previsto">
          {dateLabel(data)}
          {horario ? ` às ${horario}` : ""}
        </Linha>
        <Linha icon={Clock} rotulo="Registrado em">
          {registrado ? (
            <span className="flex flex-wrap items-center gap-2">
              {momento(registrado)}
              {diferenca ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    diferenca.tom === "ok"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  )}
                >
                  {diferenca.texto}
                </span>
              ) : null}
            </span>
          ) : (
            vazio(aguardando)
          )}
        </Linha>
        {registrado ? (
          <>
            <Linha icon={UserCheck} rotulo="Registrado por">
              {nomeDe(por) ?? vazio("Não informado")}
            </Linha>
            <Linha icon={FileText} rotulo="Observações">
              {observacoes ? <span className="whitespace-pre-line">{observacoes}</span> : vazio("Nenhuma observação")}
            </Linha>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Aba "Check-in / Check-out" da reserva: entrada, saída e a limpeza pedida no check-out. */
export function ReservationStayPanel({
  reservaId,
  reserva,
  onSaved,
}: {
  reservaId: number;
  /** Reserva aberta no diálogo: imóvel, hóspede e valores do resumo do diálogo de edição. */
  reserva: Entity;
  /** Depois de editar: recarrega a reserva (situação, datas e valores do cadastro). */
  onSaved?: () => void;
}) {
  const { can } = useModulePermission();
  const remote = useRemote<{ item: Estadia }>(`/api/reservas/${reservaId}/estadia`);
  const [editando, setEditando] = useState<"EDITAR_CHECKIN" | "EDITAR_CHECKOUT" | null>(null);
  const estadia = remote.data?.item;
  const cancelada = estadia?.status === "CANCELADA";
  const limpeza = estadia?.limpeza ?? null;
  // Mesma regra do banco: entrada editável em andamento ou concluída; saída, só concluída.
  const podeEditar = can("reservas:checkin_checkout");
  const entradaFeita = estadia ? ["EM_ANDAMENTO", "CONCLUIDA"].includes(estadia.status) : false;
  const saidaFeita = estadia?.status === "CONCLUIDA";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground sm:text-base">Check-in e Check-out</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O que foi registrado na entrada e na saída do hóspede, e a limpeza pedida no check-out.
        </p>
      </div>

      <RemoteState loading={remote.loading && !estadia} error={remote.error} retry={remote.reload}>
        {estadia ? (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Momento
                titulo="Entrada (check-in)"
                icon={LogIn}
                tom="emerald"
                data={estadia.inicio}
                horario={hhmm(estadia.horario_checkin)}
                registrado={estadia.checkin_em}
                por={estadia.registrou_checkin}
                observacoes={estadia.checkin_observacoes}
                aguardando={
                  cancelada
                    ? "A reserva foi cancelada antes da entrada."
                    : entradaFeita
                    ? "Check-in feito sem data e hora gravadas. Edite para informar."
                    : "Ainda não registrado. Use a ação Check-in no topo."
                }
                onEditar={podeEditar && entradaFeita ? () => setEditando("EDITAR_CHECKIN") : undefined}
              />
              <Momento
                titulo="Saída (check-out)"
                icon={LogOut}
                tom="sky"
                data={estadia.fim}
                horario={hhmm(estadia.horario_checkout)}
                registrado={estadia.checkout_em}
                por={estadia.registrou_checkout}
                observacoes={estadia.checkout_observacoes}
                aguardando={
                  cancelada
                    ? "A reserva foi cancelada antes da saída."
                    : saidaFeita
                    ? "Check-out feito sem data e hora gravadas. Edite para informar."
                    : entradaFeita
                    ? "Ainda não registrado. Use a ação Check-out no topo."
                    : "Registrado depois do check-in."
                }
                onEditar={podeEditar && saidaFeita ? () => setEditando("EDITAR_CHECKOUT") : undefined}
              />
            </div>

            <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <h4 className="text-sm font-semibold text-foreground">Limpeza</h4>
                </div>
                {limpeza ? (
                  limpeza.status === "PENDENTE" ? (
                    <Badge className="border border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
                      Pendente
                    </Badge>
                  ) : limpeza.status === "CONCLUIDA" ? (
                    <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                      Concluída
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[11px] text-muted-foreground">
                      Cancelada
                    </Badge>
                  )
                ) : null}
              </div>

              {limpeza ? (
                <>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      <ClipboardList className="h-3.5 w-3.5" />
                      O que fazer
                    </p>
                    <p className="whitespace-pre-line break-words text-sm font-medium text-foreground">
                      {limpeza.descricao || vazio("Nenhuma instrução além da limpeza padrão.")}
                    </p>
                  </div>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Linha icon={User} rotulo="Responsável">
                      {nomeDe(limpeza.responsavel) ?? vazio("Sem responsável")}
                    </Linha>
                    <Linha icon={CalendarClock} rotulo="Pedida em">
                      {momento(limpeza.solicitada_em)}
                      {nomeDe(limpeza.solicitante) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.solicitante)}</span> : null}
                    </Linha>
                    {limpeza.status === "CONCLUIDA" ? (
                      <Linha icon={CheckCircle2} rotulo="Concluída em">
                        {momento(limpeza.concluida_em)}
                        {nomeDe(limpeza.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.concluinte)}</span> : null}
                      </Linha>
                    ) : null}
                    {limpeza.observacoes ? (
                      <Linha icon={FileText} rotulo="Observações da conclusão">
                        <span className="whitespace-pre-line">{limpeza.observacoes}</span>
                      </Linha>
                    ) : null}
                  </div>
                  {limpeza.status === "PENDENTE" ? (
                    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                      <Link href="/execucao">
                        Acompanhar na Execução
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {estadia.checkout_em
                    ? "Nenhuma limpeza foi pedida no check-out desta reserva."
                    : "A limpeza pode ser pedida ao registrar o check-out."}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </RemoteState>

      {/* Mesmo diálogo do registro, com o que foi registrado preenchido (EDITAR_CHECKIN / EDITAR_CHECKOUT). */}
      {editando && estadia ? (
        <OperationAction
          kind="reservas"
          item={{ ...reserva, ...estadia }}
          action={editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            remote.reload();
            onSaved?.();
          }}
        />
      ) : null}
    </div>
  );
}
