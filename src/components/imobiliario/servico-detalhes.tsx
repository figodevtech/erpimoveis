"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bath,
  Bed,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  Info,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  RotateCcw,
  Sparkles,
  User,
  UserCog,
  Users,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOptionalConfig } from "@/app/(app)/(pages)/config-context";
import { cn } from "@/lib/utils";
import { EntityShell, requestJson } from "./shared";
import { dateLabel, endpoint } from "./model";
import { ResponsavelServicoSelect } from "./responsavel-servico-select";

/*
 * Serviços do imóvel (limpeza do check-out, manutenção, vistoria...) como a Execução e a aba
 * Serviços do imóvel mostram: tipos, formatação, o diálogo de detalhes, os de concluir, trocar o
 * realizador, editar e voltar para pendente, e o de solicitar serviço.
 */

export type Pessoa = { id: string; nome?: string | null; email?: string | null } | null;
export type ProximoCheckin = { reserva_id: number; inicio: string; horario_checkin: string | null; hospedes: number; hospede: string | null };
/** Tipo de serviço do catálogo (Configurações > Tipos > Serviços). */
export type TipoServico = { id: number; codigo?: string | null; descricao: string; chave_sistema?: string | null; ativo?: boolean | null };
export type ServicoImovel = {
  id: number;
  imovel_id: number;
  servico_id: number;
  servico: TipoServico | null;
  reserva_id: number | null;
  responsavel_id: string | null;
  /** O que fazer, informado no pedido (ex.: trocar enxoval completo). */
  descricao: string | null;
  status: "PENDENTE" | "CONCLUIDA" | "CANCELADA";
  /** Prazo opcional para o serviço ficar pronto. */
  prazo_em: string | null;
  solicitada_em: string;
  concluida_em: string | null;
  observacoes: string | null;
  imovel: {
    id: number;
    titulo?: string | null;
    codigo?: string | null;
    endereco?: Record<string, string> | null;
    endereco_publico?: Record<string, string> | null;
    /** Primeira foto da galeria do imóvel. */
    foto_capa?: string | null;
    quartos?: number | null;
    banheiros?: number | null;
    capacidade?: number | null;
  } | null;
  reserva: { id: number; inicio: string; fim: string; checkout_em: string | null; hospedes: number; cliente: { id: number; nomerazaosocial: string } | null } | null;
  responsavel: Pessoa;
  solicitante: Pessoa;
  concluinte: Pessoa;
  /** Próxima reserva confirmada do imóvel (ainda sem check-in); nula se não houver. */
  proximo_checkin: ProximoCheckin | null;
};

const FUSO = "America/Fortaleza";

export const momento = (valor: string | null | undefined) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO }) : "—";

/** "há 3 h", "há 2 dias": quanto tempo o serviço está esperando. */
export function espera(desde: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

export function enderecoDe(imovel: ServicoImovel["imovel"]) {
  const e = imovel?.endereco ?? {};
  const pub = imovel?.endereco_publico ?? {};
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = [e.bairro ?? pub.bairro, [e.cidade ?? pub.cidade, e.estado ?? pub.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [rua && (e.complemento ? `${rua} — ${e.complemento}` : rua), local].filter(Boolean).join(" · ");
}

export const nomeDe = (p: Pessoa | undefined) => p?.nome?.trim() || p?.email?.trim() || null;

/** A limpeza do sistema (a que o check-out pede e que deixa o imóvel em LIMPEZA). */
export const ehLimpeza = (tipo: TipoServico | null | undefined) => tipo?.chave_sistema === "LIMPEZA";

/** Nome do tipo de serviço, como cadastrado em Tipos. */
export const nomeDoServico = (servico: Pick<ServicoImovel, "servico" | "servico_id">) =>
  servico.servico?.descricao?.trim() || `Serviço #${servico.servico_id}`;

export const tituloDoImovel = (servico: Pick<ServicoImovel, "imovel" | "imovel_id">) =>
  servico.imovel?.titulo || `Imóvel #${servico.imovel_id}`;

/** Ícone do tipo: o da limpeza, ou uma ferramenta para os outros serviços. */
export function IconeServico({ tipo, className }: { tipo: TipoServico | null | undefined; className?: string }) {
  const Icone = ehLimpeza(tipo) ? Sparkles : Wrench;
  return <Icone className={className} />;
}

/** "2 dias 3 h", "5 h 20 min", "40 min". */
export function duracao(minutos: number) {
  const total = Math.max(0, Math.round(minutos));
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const resto = total % 60;
  if (dias) return `${dias} ${dias === 1 ? "dia" : "dias"}${horas ? ` ${horas} h` : ""}`;
  if (horas) return `${horas} h${resto ? ` ${resto} min` : ""}`;
  return `${resto} min`;
}

export const TONS_CHECKIN = {
  atrasado: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  urgente: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  breve: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  folga: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
} as const;

type Tom = keyof typeof TONS_CHECKIN;
/** Menos de 6 h é urgente; de 24 h, breve; já passou, atrasado. */
const tomPara = (minutos: number): Tom => (minutos <= 0 ? "atrasado" : minutos < 360 ? "urgente" : minutos < 1440 ? "breve" : "folga");

/**
 * Quanto falta para a próxima entrada: data e horário da reserva no fuso do imobiliário
 * (UTC−3, sem horário de verão).
 */
export function contagemCheckin(proximo: ProximoCheckin, agora: number) {
  const horario = proximo.horario_checkin ?? "14:00";
  const previsto = Date.parse(`${proximo.inicio.slice(0, 10)}T${horario}:00-03:00`);
  const minutos = (previsto - agora) / 60_000;
  const quando = `${new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(`${proximo.inicio.slice(0, 10)}T12:00:00Z`)
  )} às ${horario}`;
  if (minutos <= 0) {
    return { tom: "atrasado" as const, curto: `Check-in há ${duracao(-minutos)}`, longo: `Check-in previsto há ${duracao(-minutos)}`, quando };
  }
  return { tom: tomPara(minutos), curto: `Check-in em ${duracao(minutos)}`, longo: `Próximo check-in em ${duracao(minutos)}`, quando };
}

/** "sex., 20/11 às 14:00", no fuso do imobiliário. */
function diaEHora(iso: string) {
  const valor = new Date(iso);
  const dia = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: FUSO }).format(valor);
  const hora = valor.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${dia} às ${hora}`;
}

/** Quanto falta para o prazo do serviço, nos mesmos tons da contagem do check-in. */
export function contagemPrazo(prazo: string, agora: number) {
  const minutos = (Date.parse(prazo) - agora) / 60_000;
  const quando = diaEHora(prazo);
  if (minutos <= 0) {
    return { tom: "atrasado" as const, curto: `Vencido há ${duracao(-minutos)}`, longo: `Prazo vencido há ${duracao(-minutos)}`, quando };
  }
  return { tom: tomPara(minutos), curto: `Vence em ${duracao(minutos)}`, longo: `Prazo em ${duracao(minutos)}`, quando };
}

/** Selo da situação do serviço, nos mesmos tons da Execução. */
export function SituacaoServicoBadge({ status, className }: { status: ServicoImovel["status"]; className?: string }) {
  if (status === "PENDENTE") {
    return (
      <Badge className={`border border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 ${className ?? ""}`}>
        Pendente
      </Badge>
    );
  }
  if (status === "CONCLUIDA") {
    return (
      <Badge className={`border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 ${className ?? ""}`}>
        Concluído
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={`text-[11px] text-muted-foreground ${className ?? ""}`}>
      Cancelado
    </Badge>
  );
}

// --------------------------------------------------------------------------- catálogo de tipos
// O catálogo muda pouco: uma leitura por sessão da página serve à aba Serviços, à Execução e ao
// diálogo de solicitar serviço.
let tiposPendentes: Promise<TipoServico[]> | null = null;
function carregarTipos() {
  if (!tiposPendentes) {
    tiposPendentes = requestJson("/api/tipos/servicos")
      .then((r) => ((r.items ?? []) as TipoServico[]).map((t) => ({ ...t, ativo: t.ativo ?? true })))
      .catch((error) => {
        tiposPendentes = null;
        throw error;
      });
  }
  return tiposPendentes;
}

const ORDENADOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/**
 * Tipos de serviço do catálogo: a limpeza do sistema primeiro, depois os outros pelo nome. Com
 * `soAtivos`, só os que podem ser pedidos agora; sem, todos (os filtros também acham o histórico
 * de um tipo que foi desativado).
 */
export function useTiposServico({ soAtivos = false }: { soAtivos?: boolean } = {}) {
  const [tipos, setTipos] = useState<TipoServico[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let ativo = true;
    carregarTipos()
      .then((lista) => ativo && setTipos(lista))
      .catch((error) => ativo && setErro((error as Error).message));
    return () => {
      ativo = false;
    };
  }, []);
  const ordenados = useMemo(
    () =>
      tipos
        ? [...tipos]
            .filter((t) => !soAtivos || t.ativo !== false)
            .sort((a, b) => Number(ehLimpeza(b)) - Number(ehLimpeza(a)) || ORDENADOR.compare(a.descricao, b.descricao))
        : null,
    [tipos, soAtivos]
  );
  return { tipos: ordenados, erro };
}

/**
 * No toque, abrir o diálogo não foca o primeiro campo de texto: o teclado subiria por cima do
 * diálogo antes de a pessoa decidir escrever (as observações são opcionais). Quem quiser
 * escrever toca no campo. No mouse, o foco automático continua (mesmo padrão do SearchCombobox).
 */
function semTecladoNoToque(event: Event) {
  if (window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
}

/** Uma informação dos detalhes: ícone, rótulo pequeno e o valor embaixo. */
function Linha({ icon: Icon, rotulo, children }: { icon: ComponentType<{ className?: string }>; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Momento gravado (timestamptz) como dia e hora no fuso do imobiliário, para o seletor. */
function noFusoImobiliario(iso: string) {
  const valor = new Date(iso);
  return {
    data: valor.toLocaleDateString("en-CA", { timeZone: FUSO }),
    hora: valor.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

const hojeNoFuso = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO });

/** Prazo opcional: o seletor de dia e hora e o botão de tirar o prazo. */
function CampoPrazo({
  id,
  valor,
  onChange,
  min,
  disabled,
}: {
  id: string;
  valor: { data: string; hora: string };
  onChange: (valor: { data: string; hora: string }) => void;
  min?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <DateTimePicker
        id={id}
        date={valor.data}
        time={valor.hora}
        onDateChange={(data) => onChange({ data, hora: valor.hora || "18:00" })}
        onTimeChange={(hora) => onChange({ data: valor.data || hojeNoFuso(), hora })}
        min={min}
        disabled={disabled}
        placeholder="Sem prazo"
        className="h-10 w-full"
      />
      {valor.data ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange({ data: "", hora: "" })}
          disabled={disabled}
          aria-label="Tirar o prazo"
          className="h-10 w-10 shrink-0 hover:cursor-pointer"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Detalhes do serviço (Execução e aba Serviços do imóvel). Os botões só aparecem com o handler:
 * concluir (pendente), trocar o realizador (pendente) e voltar para pendente (concluído ou
 * cancelado).
 */
export function ServicoDetalhesDialog({
  servico,
  agora,
  onClose,
  onConcluir,
  onTrocarRealizador,
  onReabrir,
}: {
  servico: ServicoImovel;
  agora: number;
  onClose: () => void;
  onConcluir?: () => void;
  onTrocarRealizador?: () => void;
  onReabrir?: () => void;
}) {
  const imovel = servico.imovel;
  const titulo = tituloDoImovel(servico);
  const tipo = nomeDoServico(servico);
  const endereco = enderecoDe(imovel);
  const pendente = servico.status === "PENDENTE";
  const concluido = servico.status === "CONCLUIDA";
  const reserva = servico.reserva;
  const proximo = servico.proximo_checkin;
  const checkin = pendente && proximo ? contagemCheckin(proximo, agora) : null;
  const prazo = pendente && servico.prazo_em ? contagemPrazo(servico.prazo_em, agora) : null;
  const comodos = [
    imovel?.quartos ? { icon: Bed, texto: `${imovel.quartos} ${Number(imovel.quartos) === 1 ? "quarto" : "quartos"}` } : null,
    imovel?.banheiros ? { icon: Bath, texto: `${imovel.banheiros} ${Number(imovel.banheiros) === 1 ? "banheiro" : "banheiros"}` } : null,
    imovel?.capacidade ? { icon: Users, texto: `até ${imovel.capacidade} ${Number(imovel.capacidade) === 1 ? "hóspede" : "hóspedes"}` } : null,
  ].filter((c): c is { icon: typeof Bed; texto: string } => Boolean(c));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative aspect-[16/9] w-full bg-muted">
            {imovel?.foto_capa ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL pública do Storage, como nos cards de imóveis.
              <img src={imovel.foto_capa} alt={titulo} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                <Building2 className="h-12 w-12" />
              </div>
            )}
          </div>

          <div className="space-y-5 p-4 sm:p-6">
            <DialogHeader className="space-y-1.5 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg">{titulo}</DialogTitle>
                {imovel?.codigo ? (
                  <span className="rounded border border-border/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    #{imovel.codigo}
                  </span>
                ) : null}
              </div>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <IconeServico tipo={servico.servico} className="h-4 w-4 text-primary" />
                    {tipo}
                  </span>
                  <SituacaoServicoBadge status={servico.status} />
                  {pendente ? <span className="text-xs text-muted-foreground">pedido {espera(servico.solicitada_em)}</span> : null}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <ClipboardList className="h-3.5 w-3.5" />
                O que fazer
              </p>
              <p className="whitespace-pre-line break-words text-sm font-medium text-foreground">
                {servico.descricao || <span className="font-normal text-muted-foreground">Nenhuma instrução além do serviço padrão.</span>}
              </p>
            </div>

            {prazo ? (
              <div className={`flex items-start gap-2.5 rounded-xl border p-3.5 ${TONS_CHECKIN[prazo.tom]}`}>
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{prazo.longo}</p>
                  <p className="text-xs opacity-85">{prazo.quando}</p>
                </div>
              </div>
            ) : null}

            {pendente ? (
              checkin && proximo ? (
                <div className={`flex items-start gap-2.5 rounded-xl border p-3.5 ${TONS_CHECKIN[checkin.tom]}`}>
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{checkin.longo}</p>
                    <p className="text-xs opacity-85">
                      {checkin.quando}
                      {proximo.hospede ? ` · ${proximo.hospede}` : ""}
                      {` · ${proximo.hospedes} ${proximo.hospedes === 1 ? "hóspede" : "hóspedes"}`}
                      {` · Reserva #${proximo.reserva_id}`}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  Nenhum check-in agendado para este imóvel.
                </p>
              )
            ) : null}

            <div className="space-y-3.5">
              {endereco ? (
                <Linha icon={MapPin} rotulo="Endereço">
                  {endereco}
                </Linha>
              ) : null}
              {comodos.length ? (
                <div className="flex flex-wrap gap-2 pl-6.5">
                  {comodos.map(({ icon: Icon, texto }) => (
                    <span key={texto} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-foreground">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {texto}
                    </span>
                  ))}
                </div>
              ) : null}
              {reserva ? (
                <Linha icon={LogOut} rotulo="Saída do hóspede">
                  <span className="block">{reserva.cliente?.nomerazaosocial || "Hóspede não identificado"}</span>
                  <span className="block text-xs text-muted-foreground">
                    Reserva #{reserva.id} · {dateLabel(reserva.inicio)} a {dateLabel(reserva.fim)}
                    {reserva.hospedes ? ` · ${reserva.hospedes} ${Number(reserva.hospedes) === 1 ? "hóspede" : "hóspedes"}` : ""}
                  </span>
                  {reserva.checkout_em ? (
                    <span className="block text-xs text-muted-foreground">Check-out registrado em {momento(reserva.checkout_em)}</span>
                  ) : null}
                </Linha>
              ) : null}
              <Linha icon={CalendarDays} rotulo="Pedido em">
                {momento(servico.solicitada_em)}
                {nomeDe(servico.solicitante) ? <span className="text-muted-foreground"> por {nomeDe(servico.solicitante)}</span> : null}
              </Linha>
              {!pendente && servico.prazo_em ? (
                <Linha icon={Hourglass} rotulo="Prazo">
                  {momento(servico.prazo_em)}
                </Linha>
              ) : null}
              <Linha icon={User} rotulo="Responsável">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={nomeDe(servico.responsavel) ? "" : "text-muted-foreground"}>
                    {nomeDe(servico.responsavel) ?? "Sem responsável"}
                  </span>
                  {pendente && onTrocarRealizador ? (
                    <Button type="button" size="sm" variant="ghost" onClick={onTrocarRealizador} className="h-7 gap-1.5 px-2 text-xs hover:cursor-pointer">
                      <UserCog className="h-3.5 w-3.5" />
                      Trocar realizador
                    </Button>
                  ) : null}
                </div>
              </Linha>
              {concluido ? (
                <Linha icon={CheckCircle2} rotulo="Concluído em">
                  {momento(servico.concluida_em)}
                  {nomeDe(servico.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(servico.concluinte)}</span> : null}
                </Linha>
              ) : null}
              {servico.status === "CANCELADA" ? (
                <Linha icon={XCircle} rotulo="Situação">
                  <span className="text-muted-foreground">
                    {servico.reserva_id ? "Cancelado ao corrigir o check-out da reserva." : "Cancelado."}
                  </span>
                </Linha>
              ) : null}
              {servico.observacoes ? (
                <Linha icon={Info} rotulo="Observações da conclusão">
                  <span className="whitespace-pre-line break-words">{servico.observacoes}</span>
                </Linha>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-4 sm:px-6">
          <Button variant="outline" onClick={onClose} className="hover:cursor-pointer">Fechar</Button>
          {!pendente && onReabrir ? (
            <Button variant="secondary" onClick={onReabrir} className="gap-1.5 hover:cursor-pointer">
              <RotateCcw className="h-4 w-4" />
              Voltar para pendente
            </Button>
          ) : null}
          {pendente && onConcluir ? (
            <Button onClick={onConcluir} className="gap-1.5 hover:cursor-pointer">
              <CheckCircle2 className="h-4 w-4" />
              Serviço concluído
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConcluirServicoDialog({ servico, onClose, onDone }: { servico: ServicoImovel; onClose: () => void; onDone: () => void }) {
  const [observacoes, setObservacoes] = useState("");
  const [busy, setBusy] = useState(false);
  const titulo = tituloDoImovel(servico);
  const tipo = nomeDoServico(servico);
  const limpeza = ehLimpeza(servico.servico);

  const concluir = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/servicos/${servico.id}/concluir`, {
        method: "POST",
        body: JSON.stringify({ observacoes }),
      });
      toast.success("Serviço concluído", { description: limpeza ? `${titulo} saiu da situação Limpeza.` : `${tipo} · ${titulo}` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível concluir o serviço", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={semTecladoNoToque}>
        <DialogHeader>
          <DialogTitle>Concluir {tipo.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {limpeza
              ? `${titulo} deixa a situação Limpeza e volta a ficar pronto para o próximo hóspede.`
              : `${titulo}: o serviço sai das pendências da Execução.`}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Observações (opcional): itens repostos, algo a reparar..."
          rows={3}
          maxLength={2000}
          className="text-base sm:text-sm"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">Voltar</Button>
          <Button onClick={() => void concluir()} disabled={busy} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar conclusão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Trocar realizador": passa o serviço pendente para outra pessoa (ou deixa sem responsável). */
export function TrocarRealizadorDialog({ servico, onClose, onDone }: { servico: ServicoImovel; onClose: () => void; onDone: () => void }) {
  const [responsavel, setResponsavel] = useState<string | null>(servico.responsavel_id);
  const [busy, setBusy] = useState(false);

  const salvar = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/servicos/${servico.id}/atribuir`, {
        method: "POST",
        body: JSON.stringify({ responsavel_id: responsavel }),
      });
      toast.success(responsavel ? "Realizador trocado" : "Serviço ficou sem responsável");
      onDone();
    } catch (error) {
      toast.error("Não foi possível trocar o realizador", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trocar realizador</DialogTitle>
          <DialogDescription>
            {nomeDoServico(servico)} · {tituloDoImovel(servico)}
            {nomeDe(servico.responsavel) ? ` · hoje com ${nomeDe(servico.responsavel)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ResponsavelServicoSelect value={responsavel} onValueChange={setResponsavel} disabled={busy} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">Voltar</Button>
          <Button onClick={() => void salvar()} disabled={busy || responsavel === servico.responsavel_id} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Editar os dados do serviço (aba Serviços do imóvel): descrição, responsável e prazo em qualquer
 * situação; no concluído, também a data e hora da conclusão e as observações.
 */
export function EditarServicoDialog({ servico, onClose, onDone }: { servico: ServicoImovel; onClose: () => void; onDone: () => void }) {
  const concluido = servico.status === "CONCLUIDA";
  const [descricao, setDescricao] = useState(servico.descricao ?? "");
  const [responsavel, setResponsavel] = useState<string | null>(servico.responsavel_id);
  const [prazo, setPrazo] = useState(() => (servico.prazo_em ? noFusoImobiliario(servico.prazo_em) : { data: "", hora: "" }));
  const [observacoes, setObservacoes] = useState(servico.observacoes ?? "");
  const [conclusao, setConclusao] = useState(() =>
    servico.concluida_em ? noFusoImobiliario(servico.concluida_em) : { data: "", hora: "" }
  );
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const titulo = tituloDoImovel(servico);
  const hoje = new Date().toLocaleDateString("en-CA");

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (concluido && (!conclusao.data || !conclusao.hora)) {
      setErro("Informe a data e a hora da conclusão.");
      return;
    }
    setBusy(true);
    setErro("");
    try {
      await requestJson(`/api/execucao/servicos/${servico.id}/editar`, {
        method: "POST",
        body: JSON.stringify({
          descricao: descricao.trim() || null,
          responsavel_id: responsavel,
          prazo_data: prazo.data || null,
          prazo_hora: prazo.data ? prazo.hora || null : null,
          ...(concluido
            ? { observacoes: observacoes.trim() || null, data_conclusao: conclusao.data, hora_conclusao: conclusao.hora }
            : {}),
        }),
      });
      toast.success("Serviço atualizado", { description: titulo });
      onDone();
    } catch (error) {
      setErro((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg" onOpenAutoFocus={semTecladoNoToque}>
        <DialogHeader className="space-y-1.5 border-b p-4 text-left sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-base">Editar serviço</DialogTitle>
            <SituacaoServicoBadge status={servico.status} />
          </div>
          <DialogDescription>
            {nomeDoServico(servico)} de {titulo} · pedido em {momento(servico.solicitada_em)}
            {servico.reserva ? ` · Reserva #${servico.reserva.id}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form id="editar-servico" onSubmit={(event) => void salvar(event)} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:px-6">
          <div className="space-y-1.5">
            <label htmlFor="servico-descricao" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ClipboardList className="h-4 w-4 text-primary" />
              O que fazer
            </label>
            <Textarea
              id="servico-descricao"
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              placeholder="Ex.: trocar enxoval completo"
              rows={2}
              maxLength={500}
              disabled={busy}
              className="text-base sm:text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-primary" />
              Responsável
            </p>
            <ResponsavelServicoSelect value={responsavel} onValueChange={setResponsavel} disabled={busy} />
          </div>

          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Hourglass className="h-4 w-4 text-primary" />
              Prazo
            </p>
            <CampoPrazo
              id="servico-prazo"
              valor={prazo}
              onChange={setPrazo}
              min={noFusoImobiliario(servico.solicitada_em).data}
              disabled={busy}
            />
          </div>

          {concluido ? (
            <>
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Data e hora da conclusão *
                </p>
                <DateTimePicker
                  id="servico-conclusao"
                  date={conclusao.data}
                  time={conclusao.hora}
                  onDateChange={(data) => setConclusao((atual) => ({ ...atual, data }))}
                  onTimeChange={(hora) => setConclusao((atual) => ({ ...atual, hora }))}
                  // Registra-se o que já aconteceu, e depois do pedido do serviço.
                  min={noFusoImobiliario(servico.solicitada_em).data}
                  max={hoje}
                  disabled={busy}
                  placeholder="Selecione a data e a hora"
                  className="h-10 w-full"
                />
                {nomeDe(servico.concluinte) ? (
                  <p className="text-[11px] text-muted-foreground">Concluído por {nomeDe(servico.concluinte)}.</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="servico-observacoes" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Info className="h-4 w-4 text-primary" />
                  Observações da conclusão
                </label>
                <Textarea
                  id="servico-observacoes"
                  value={observacoes}
                  onChange={(event) => setObservacoes(event.target.value)}
                  placeholder="Itens repostos, algo a reparar..."
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                  className="text-base sm:text-sm"
                />
              </div>
            </>
          ) : null}

          {erro ? (
            <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              {erro}
            </p>
          ) : null}
        </form>

        <DialogFooter className="shrink-0 gap-2 border-t p-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">
            Cancelar
          </Button>
          <Button type="submit" form="editar-servico" disabled={busy} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmação de "Voltar para pendente": o serviço volta para a Execução (e a limpeza, o imóvel para Limpeza). */
export function ReabrirServicoDialog({ servico, onClose, onDone }: { servico: ServicoImovel; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const titulo = tituloDoImovel(servico);
  const tipo = nomeDoServico(servico);
  const limpeza = ehLimpeza(servico.servico);

  const reabrir = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/servicos/${servico.id}/reabrir`, { method: "POST", body: "{}" });
      toast.success("Serviço voltou para pendente", { description: limpeza ? `${titulo} voltou para a situação Limpeza.` : `${tipo} · ${titulo}` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível voltar o serviço para pendente", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Voltar o serviço para pendente?</AlertDialogTitle>
          <AlertDialogDescription>
            {tipo} de {titulo} reaparece na Execução
            {nomeDe(servico.responsavel) ? ` de ${nomeDe(servico.responsavel)}` : ""}
            {limpeza ? " e o imóvel volta para a situação Limpeza" : ""}.
            {servico.status === "CONCLUIDA" ? " A data, quem concluiu e as observações da conclusão saem." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={busy} className="w-full hover:cursor-pointer sm:w-auto">Voltar</AlertDialogCancel>
          {/* Botão comum: o diálogo só fecha depois da resposta. */}
          <Button onClick={() => void reabrir()} disabled={busy} className="w-full gap-1.5 hover:cursor-pointer sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Voltar para pendente
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * "Solicitar serviço" da aba Serviços do imóvel, no visual do check-out: o tipo, quem faz, o que
 * fazer e o prazo. É o que o responsável vê na Execução.
 */
export function SolicitarServicoDialog({
  imovel,
  onClose,
  onDone,
}: {
  imovel: { id: number; titulo?: string | null; codigo?: string | null; situacao_operacional?: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const config = useOptionalConfig();
  const { tipos, erro: erroTipos } = useTiposServico({ soAtivos: true });
  const [servicoId, setServicoId] = useState("");
  const [responsavel, setResponsavel] = useState<string | null>(null);
  // O responsável padrão da limpeza (Configurações > Geral) vem junto só enquanto a pessoa não escolheu outro.
  const [responsavelEscolhido, setResponsavelEscolhido] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState({ data: "", hora: "" });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const titulo = imovel.titulo?.trim() || `Imóvel #${imovel.id}`;
  const tipo = tipos?.find((t) => String(t.id) === servicoId) ?? null;
  const limpeza = ehLimpeza(tipo);
  const emLimpeza = imovel.situacao_operacional === "LIMPEZA";

  const escolherTipo = (valor: string) => {
    setServicoId(valor);
    if (responsavelEscolhido) return;
    const escolhido = tipos?.find((t) => String(t.id) === valor);
    setResponsavel(ehLimpeza(escolhido) ? config?.limpeza_responsavel_padrao_id ?? null : null);
  };

  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!servicoId) {
      setErro("Escolha o tipo de serviço.");
      return;
    }
    setBusy(true);
    setErro("");
    try {
      await requestJson(`${endpoint("imoveis", imovel.id)}/servicos`, {
        method: "POST",
        body: JSON.stringify({
          servico_id: Number(servicoId),
          responsavel_id: responsavel,
          descricao: descricao.trim() || null,
          prazo_data: prazo.data || null,
          prazo_hora: prazo.data ? prazo.hora || null : null,
        }),
      });
      toast.success("Serviço solicitado", {
        description: `${tipo?.descricao ?? "Serviço"} · ${titulo}${responsavel ? " · já aparece na Execução do responsável." : " · sem responsável por enquanto."}`,
      });
      onDone();
    } catch (error) {
      setErro((error as Error).message);
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
      title={
        <div className="flex items-center gap-2 text-primary">
          <Wrench className="h-5 w-5 shrink-0" />
          <span>Solicitar serviço</span>
        </div>
      }
      description={`${titulo}${imovel.codigo ? ` · #${imovel.codigo}` : ""}`}
      className="p-0 overflow-hidden flex flex-col w-[95vw] max-w-2xl max-h-[90vh] sm:rounded-2xl"
      footer={
        <div className="flex w-full flex-col-reverse items-stretch justify-between gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="h-11 w-full text-xs font-medium hover:cursor-pointer sm:h-9 sm:w-auto sm:text-sm"
          >
            Voltar
          </Button>
          <Button
            type="submit"
            form="solicitar-servico"
            disabled={busy || !tipos}
            className="h-11 w-full gap-2 text-xs font-semibold shadow-xs hover:cursor-pointer sm:h-9 sm:w-auto sm:text-sm"
          >
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Plus className="h-4 w-4 shrink-0" />}
            <span>{busy ? "Solicitando…" : "Solicitar serviço"}</span>
          </Button>
        </div>
      }
    >
      <form
        id="solicitar-servico"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 sm:space-y-5 sm:p-6"
        onSubmit={(event) => void enviar(event)}
      >
        <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 text-xs text-sky-800 sm:p-4 sm:text-sm dark:text-sky-300">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="space-y-1">
            <p className="font-semibold">Pedido para a Execução</p>
            <p className="text-xs leading-relaxed">
              O responsável vê o tipo, o que fazer e o prazo na Execução, com a foto e o endereço do imóvel, e conclui por lá.
            </p>
          </div>
        </div>

        {/* TIPO DE SERVIÇO */}
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs sm:p-4">
          <div className="flex items-center gap-2">
            <IconeServico tipo={tipo} className="h-4 w-4 shrink-0 text-primary" />
            <label htmlFor="solicitar-tipo" className="text-sm font-semibold text-foreground">Tipo de serviço *</label>
          </div>
          {erroTipos ? (
            <p className="text-xs text-destructive">Não foi possível carregar os tipos de serviço: {erroTipos}</p>
          ) : (
            <Select value={servicoId} onValueChange={escolherTipo} disabled={busy || !tipos}>
              <SelectTrigger id="solicitar-tipo" className="h-10 w-full hover:cursor-pointer">
                <SelectValue placeholder={tipos ? "Escolha o serviço" : "Carregando os serviços..."} />
              </SelectTrigger>
              <SelectContent>
                {(tipos ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="hover:cursor-pointer">
                    {t.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Os tipos vêm de Configurações › Tipos › Serviços.
          </p>
          {limpeza ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {emLimpeza
                ? "Este imóvel já tem uma limpeza pendente: o pedido se soma a ela (o que fazer e o prazo mais curto)."
                : <>O imóvel fica em <strong>LIMPEZA</strong> até a limpeza ser concluída.</>}
            </p>
          ) : null}
        </div>

        {/* RESPONSÁVEL */}
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs sm:p-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-semibold text-foreground">Responsável</p>
          </div>
          <ResponsavelServicoSelect
            value={responsavel}
            onValueChange={(id) => {
              setResponsavel(id);
              setResponsavelEscolhido(true);
            }}
            disabled={busy}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">Sem responsável, o serviço fica para quem vê as tarefas de todos atribuir.</p>
        </div>

        {/* O QUE FAZER */}
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs sm:p-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
            <label htmlFor="solicitar-descricao" className="text-sm font-semibold text-foreground">O que fazer</label>
          </div>
          <Textarea
            id="solicitar-descricao"
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
            placeholder={limpeza ? "Ex.: trocar enxoval completo" : "Ex.: trocar a resistência do chuveiro do banheiro social"}
            rows={3}
            maxLength={500}
            disabled={busy}
            className="min-h-[80px] resize-y text-base leading-relaxed sm:text-sm"
          />
          <p className="text-right text-[11px] text-muted-foreground tabular-nums">{descricao.length}/500</p>
        </div>

        {/* PRAZO */}
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs sm:p-4">
          <div className="flex items-center gap-2">
            <Hourglass className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-semibold text-foreground">Prazo (opcional)</p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quando o serviço precisa estar pronto. A Execução mostra quanto falta e põe os de prazo mais curto primeiro.
          </p>
          <CampoPrazo id="solicitar-prazo" valor={prazo} onChange={setPrazo} min={hojeNoFuso()} disabled={busy} />
        </div>

        {erro ? (
          <div
            role="alert"
            className={cn("flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs font-medium text-destructive sm:text-sm")}
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        ) : null}
      </form>
    </EntityShell>
  );
}
