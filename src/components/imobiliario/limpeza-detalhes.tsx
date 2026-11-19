"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bath,
  Bed,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  LogOut,
  MapPin,
  RotateCcw,
  User,
  UserCog,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
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
import { requestJson } from "./shared";
import { dateLabel } from "./model";
import { ResponsavelLimpezaSelect } from "./responsavel-limpeza-select";

/*
 * Limpeza (serviço do imóvel) como a Execução e a aba Serviços do imóvel mostram: tipos,
 * formatação, o diálogo de detalhes e os diálogos de concluir, atribuir e voltar para pendente.
 */

export type Pessoa = { id: string; nome?: string | null; email?: string | null } | null;
export type ProximoCheckin = { reserva_id: number; inicio: string; horario_checkin: string | null; hospedes: number; hospede: string | null };
export type Limpeza = {
  id: number;
  imovel_id: number;
  reserva_id: number | null;
  responsavel_id: string | null;
  /** O que foi pedido no check-out (ex.: trocar enxoval completo). */
  descricao: string | null;
  status: "PENDENTE" | "CONCLUIDA" | "CANCELADA";
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

export const momento = (valor: string | null | undefined) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }) : "—";

/** "há 3 h", "há 2 dias": quanto tempo a limpeza está esperando. */
export function espera(desde: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

export function enderecoDe(imovel: Limpeza["imovel"]) {
  const e = imovel?.endereco ?? {};
  const pub = imovel?.endereco_publico ?? {};
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = [e.bairro ?? pub.bairro, [e.cidade ?? pub.cidade, e.estado ?? pub.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [rua && (e.complemento ? `${rua} — ${e.complemento}` : rua), local].filter(Boolean).join(" · ");
}

export const nomeDe = (p: Pessoa | undefined) => p?.nome?.trim() || p?.email?.trim() || null;

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

/**
 * Quanto falta para a próxima entrada: data e horário da reserva no fuso do imobiliário
 * (UTC−3, sem horário de verão). Menos de 6 h é urgente; de 24 h, breve; já passou, atrasado.
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
  const tom = minutos < 360 ? ("urgente" as const) : minutos < 1440 ? ("breve" as const) : ("folga" as const);
  return { tom, curto: `Check-in em ${duracao(minutos)}`, longo: `Próximo check-in em ${duracao(minutos)}`, quando };
}

/** Selo da situação da limpeza, nos mesmos tons da Execução. */
export function SituacaoLimpezaBadge({ status, className }: { status: Limpeza["status"]; className?: string }) {
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
        Concluída
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={`text-[11px] text-muted-foreground ${className ?? ""}`}>
      Cancelada
    </Badge>
  );
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

/**
 * Detalhes da limpeza (Execução e aba Serviços do imóvel). Os botões só aparecem com o handler:
 * concluir (pendente), trocar o responsável (pendente, quem gerencia) e voltar para pendente
 * (concluída ou cancelada).
 */
export function LimpezaDetalhesDialog({
  limpeza,
  agora,
  podeGerenciar,
  onClose,
  onConcluir,
  onAtribuir,
  onReabrir,
}: {
  limpeza: Limpeza;
  agora: number;
  podeGerenciar: boolean;
  onClose: () => void;
  onConcluir?: () => void;
  onAtribuir?: () => void;
  onReabrir?: () => void;
}) {
  const imovel = limpeza.imovel;
  const titulo = imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const endereco = enderecoDe(imovel);
  const pendente = limpeza.status === "PENDENTE";
  const concluida = limpeza.status === "CONCLUIDA";
  const reserva = limpeza.reserva;
  const proximo = limpeza.proximo_checkin;
  const checkin = pendente && proximo ? contagemCheckin(proximo, agora) : null;
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
                <div>
                  {pendente ? (
                    <Badge className="border border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
                      Limpeza pendente · {espera(limpeza.solicitada_em)}
                    </Badge>
                  ) : concluida ? (
                    <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                      Limpeza concluída
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[11px] text-muted-foreground">
                      Limpeza cancelada
                    </Badge>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <ClipboardList className="h-3.5 w-3.5" />
                O que fazer
              </p>
              <p className="whitespace-pre-line break-words text-sm font-medium text-foreground">
                {limpeza.descricao || <span className="font-normal text-muted-foreground">Nenhuma instrução além da limpeza padrão.</span>}
              </p>
            </div>

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
              <Linha icon={CalendarDays} rotulo="Pedida em">
                {momento(limpeza.solicitada_em)}
                {nomeDe(limpeza.solicitante) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.solicitante)}</span> : null}
              </Linha>
              <Linha icon={User} rotulo="Responsável">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={nomeDe(limpeza.responsavel) ? "" : "text-muted-foreground"}>
                    {nomeDe(limpeza.responsavel) ?? "Sem responsável"}
                  </span>
                  {pendente && podeGerenciar && onAtribuir ? (
                    <Button type="button" size="sm" variant="ghost" onClick={onAtribuir} className="h-7 gap-1.5 px-2 text-xs hover:cursor-pointer">
                      <UserCog className="h-3.5 w-3.5" />
                      Alterar
                    </Button>
                  ) : null}
                </div>
              </Linha>
              {concluida ? (
                <Linha icon={CheckCircle2} rotulo="Concluída em">
                  {momento(limpeza.concluida_em)}
                  {nomeDe(limpeza.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.concluinte)}</span> : null}
                </Linha>
              ) : null}
              {limpeza.status === "CANCELADA" ? (
                <Linha icon={XCircle} rotulo="Situação">
                  <span className="text-muted-foreground">Cancelada ao corrigir o check-out da reserva.</span>
                </Linha>
              ) : null}
              {limpeza.observacoes ? (
                <Linha icon={Info} rotulo="Observações da conclusão">
                  <span className="whitespace-pre-line break-words">{limpeza.observacoes}</span>
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
              Limpeza concluída
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConcluirLimpezaServicoDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const [observacoes, setObservacoes] = useState("");
  const [busy, setBusy] = useState(false);
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;

  const concluir = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/concluir`, {
        method: "POST",
        body: JSON.stringify({ observacoes }),
      });
      toast.success("Limpeza concluída", { description: `${titulo} saiu da situação Limpeza.` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível concluir a limpeza", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={semTecladoNoToque}>
        <DialogHeader>
          <DialogTitle>Concluir limpeza</DialogTitle>
          <DialogDescription>
            {titulo} deixa a situação Limpeza e volta a ficar pronto para o próximo hóspede.
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

export function AtribuirLimpezaDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const [responsavel, setResponsavel] = useState<string | null>(limpeza.responsavel_id);
  const [busy, setBusy] = useState(false);
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;

  const salvar = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/atribuir`, {
        method: "POST",
        body: JSON.stringify({ responsavel_id: responsavel }),
      });
      toast.success(responsavel ? "Responsável atribuído" : "Limpeza ficou sem responsável");
      onDone();
    } catch (error) {
      toast.error("Não foi possível atribuir a limpeza", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Responsável pela limpeza</DialogTitle>
          <DialogDescription>{titulo}</DialogDescription>
        </DialogHeader>
        <ResponsavelLimpezaSelect value={responsavel} onValueChange={setResponsavel} disabled={busy} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">Voltar</Button>
          <Button onClick={() => void salvar()} disabled={busy || responsavel === limpeza.responsavel_id} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Momento gravado (timestamptz) como dia e hora no fuso do imobiliário, para o seletor. */
function noFusoImobiliario(iso: string) {
  const valor = new Date(iso);
  return {
    data: valor.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }),
    hora: valor.toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

/**
 * Editar os dados do serviço (aba Serviços do imóvel): descrição e responsável em qualquer
 * situação; na concluída, também a data e hora da conclusão e as observações.
 */
export function EditarLimpezaDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const concluida = limpeza.status === "CONCLUIDA";
  const [descricao, setDescricao] = useState(limpeza.descricao ?? "");
  const [responsavel, setResponsavel] = useState<string | null>(limpeza.responsavel_id);
  const [observacoes, setObservacoes] = useState(limpeza.observacoes ?? "");
  const [conclusao, setConclusao] = useState(() =>
    limpeza.concluida_em ? noFusoImobiliario(limpeza.concluida_em) : { data: "", hora: "" }
  );
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const hoje = new Date().toLocaleDateString("en-CA");

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (concluida && (!conclusao.data || !conclusao.hora)) {
      setErro("Informe a data e a hora da conclusão.");
      return;
    }
    setBusy(true);
    setErro("");
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/editar`, {
        method: "POST",
        body: JSON.stringify({
          descricao: descricao.trim() || null,
          responsavel_id: responsavel,
          ...(concluida
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
            <SituacaoLimpezaBadge status={limpeza.status} />
          </div>
          <DialogDescription>
            Limpeza de {titulo} · pedida em {momento(limpeza.solicitada_em)}
            {limpeza.reserva ? ` · Reserva #${limpeza.reserva.id}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form id="editar-servico" onSubmit={(event) => void salvar(event)} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:px-6">
          <div className="space-y-1.5">
            <label htmlFor="servico-descricao" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ClipboardList className="h-4 w-4 text-primary" />
              O que fazer
            </label>
            <Input
              id="servico-descricao"
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              placeholder="Ex.: trocar enxoval completo"
              maxLength={500}
              disabled={busy}
              className="h-10 text-base sm:text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-primary" />
              Responsável
            </p>
            <ResponsavelLimpezaSelect value={responsavel} onValueChange={setResponsavel} disabled={busy} />
          </div>

          {concluida ? (
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
                  // Registra-se o que já aconteceu, e depois do pedido da limpeza.
                  min={noFusoImobiliario(limpeza.solicitada_em).data}
                  max={hoje}
                  disabled={busy}
                  placeholder="Selecione a data e a hora"
                  className="h-10 w-full"
                />
                {nomeDe(limpeza.concluinte) ? (
                  <p className="text-[11px] text-muted-foreground">Concluída por {nomeDe(limpeza.concluinte)}.</p>
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

/** Confirmação de "Voltar para pendente": a limpeza volta para a Execução e o imóvel, para Limpeza. */
export function ReabrirLimpezaDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;

  const reabrir = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/reabrir`, { method: "POST", body: "{}" });
      toast.success("Limpeza voltou para pendente", { description: `${titulo} voltou para a situação Limpeza.` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível voltar a limpeza para pendente", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Voltar a limpeza para pendente?</AlertDialogTitle>
          <AlertDialogDescription>
            {titulo} volta para a situação Limpeza e o serviço reaparece na Execução
            {nomeDe(limpeza.responsavel) ? ` de ${nomeDe(limpeza.responsavel)}` : ""}.
            {limpeza.status === "CONCLUIDA" ? " A data, quem concluiu e as observações da conclusão saem." : ""}
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
