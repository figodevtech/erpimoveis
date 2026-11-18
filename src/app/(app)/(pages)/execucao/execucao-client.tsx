"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bath,
  Bed,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Info,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
  Sparkles,
  User,
  UserCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestJson } from "@/components/imobiliario/shared";
import { dateLabel } from "@/components/imobiliario/model";
import { ResponsavelLimpezaSelect } from "@/components/imobiliario/responsavel-limpeza-select";

type Pessoa = { id: string; nome?: string | null; email?: string | null } | null;
type Limpeza = {
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
};
type Resposta = { items: Limpeza[]; total: number; page: number; pageSize: number; escopo: Escopo; podeGerenciar: boolean };
type Situacao = "PENDENTE" | "CONCLUIDA";
type Escopo = "minhas" | "todas" | "sem_responsavel";

const PAGE_SIZE = 30;
const momento = (valor: string | null | undefined) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }) : "—";

/** "há 3 h", "há 2 dias": quanto tempo a limpeza está esperando. */
function espera(desde: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

function enderecoDe(imovel: Limpeza["imovel"]) {
  const e = imovel?.endereco ?? {};
  const pub = imovel?.endereco_publico ?? {};
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = [e.bairro ?? pub.bairro, [e.cidade ?? pub.cidade, e.estado ?? pub.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [rua && (e.complemento ? `${rua} — ${e.complemento}` : rua), local].filter(Boolean).join(" · ");
}

const nomeDe = (p: Pessoa) => p?.nome?.trim() || p?.email?.trim() || null;

export function ExecucaoClient() {
  const [situacao, setSituacao] = useState<Situacao>("PENDENTE");
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [concluindo, setConcluindo] = useState<Limpeza | null>(null);
  const [atribuindo, setAtribuindo] = useState<Limpeza | null>(null);
  const [detalhes, setDetalhes] = useState<Limpeza | null>(null);
  const sequencia = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++sequencia.current;
    setCarregando(true);
    setErro("");
    try {
      // Pede todas: quem gerencia limpezas vê as de todos (inclusive sem responsável); o servidor
      // devolve só as do próprio usuário para quem não tem a permissão.
      const params = new URLSearchParams({ status: situacao, escopo: "todas", page: String(page), pageSize: String(PAGE_SIZE) });
      const resposta = (await requestJson(`/api/execucao/limpezas?${params}`)) as Resposta;
      if (id === sequencia.current) setDados(resposta);
    } catch (error) {
      if (id === sequencia.current) setErro((error as Error).message);
    } finally {
      if (id === sequencia.current) setCarregando(false);
    }
  }, [situacao, page]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const podeGerenciar = dados?.podeGerenciar ?? false;
  const itens = dados?.items ?? [];
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />
            Limpezas
          </h1>
          <p className="text-sm text-muted-foreground">
            {podeGerenciar
              ? "Limpezas pedidas no check-out das reservas, de toda a equipe. O responsável muda nos detalhes."
              : "Imóveis em limpeza sob a sua responsabilidade. Conclua quando o imóvel estiver pronto."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando} className="gap-1.5 self-start hover:cursor-pointer sm:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex justify-center">
        <Tabs value={situacao} onValueChange={(v) => { setSituacao(v as Situacao); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="PENDENTE" className="px-4 hover:cursor-pointer">Pendentes</TabsTrigger>
            <TabsTrigger value="CONCLUIDA" className="px-4 hover:cursor-pointer">Concluídas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {erro ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{erro}</span>
          <Button variant="outline" size="sm" onClick={() => void carregar()} className="hover:cursor-pointer">Tentar de novo</Button>
        </div>
      ) : carregando && !dados ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl sm:h-80" />)}
        </div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="font-medium">
            {situacao === "PENDENTE" ? "Nenhuma limpeza pendente" : "Nenhuma limpeza concluída ainda"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {situacao === "PENDENTE"
              ? podeGerenciar
                ? "Nenhum imóvel aguardando limpeza."
                : "Quando um check-out pedir limpeza com você como responsável, o imóvel aparece aqui."
              : "As limpezas concluídas aparecem aqui, das mais recentes para as mais antigas."}
          </p>
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3 ${carregando ? "opacity-60" : ""}`}>
          {itens.map((limpeza) => (
            <LimpezaCard
              key={limpeza.id}
              limpeza={limpeza}
              onConcluir={() => setConcluindo(limpeza)}
              onDetalhes={() => setDetalhes(limpeza)}
            />
          ))}
        </div>
      )}

      {dados && dados.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPaginas} · {dados.total} limpezas
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || carregando} onClick={() => setPage((p) => p - 1)} className="hover:cursor-pointer">Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPaginas || carregando} onClick={() => setPage((p) => p + 1)} className="hover:cursor-pointer">Próxima</Button>
          </div>
        </div>
      ) : null}

      {/* Um diálogo por vez: concluir ou trocar o responsável a partir dos detalhes fecha os detalhes. */}
      {detalhes ? (
        <DetalhesDialog
          limpeza={detalhes}
          podeGerenciar={podeGerenciar}
          onClose={() => setDetalhes(null)}
          onConcluir={() => {
            setDetalhes(null);
            setConcluindo(detalhes);
          }}
          onAtribuir={() => {
            setDetalhes(null);
            setAtribuindo(detalhes);
          }}
        />
      ) : null}

      {concluindo ? (
        <ConcluirDialog
          limpeza={concluindo}
          onClose={() => setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            void carregar();
          }}
        />
      ) : null}

      {atribuindo ? (
        <AtribuirDialog
          limpeza={atribuindo}
          onClose={() => setAtribuindo(null)}
          onDone={() => {
            setAtribuindo(null);
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}

function LimpezaCard({
  limpeza,
  onConcluir,
  onDetalhes,
}: {
  limpeza: Limpeza;
  onConcluir: () => void;
  onDetalhes: () => void;
}) {
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const endereco = enderecoDe(limpeza.imovel);
  const responsavel = nomeDe(limpeza.responsavel);
  const pendente = limpeza.status === "PENDENTE";

  const foto = limpeza.imovel?.foto_capa;

  // No celular são dois cartões por linha (~170px cada): espaçamentos, textos e botões encolhem.
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden py-0">
      {/* Foto de capa do imóvel: quem vai limpar reconhece o imóvel de relance. */}
      <div className="relative aspect-[4/3] w-full shrink-0 bg-muted sm:aspect-[16/9]">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL pública do Storage, como nos cards de imóveis.
          <img src={foto} alt={titulo} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <Building2 className="h-8 w-8 sm:h-10 sm:w-10" />
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 sm:left-2 sm:top-2">
          {pendente ? (
            <Badge className="border border-amber-500/40 bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 shadow-sm hover:bg-amber-100 sm:px-2 sm:text-[11px] dark:bg-amber-950 dark:text-amber-300">
              Pendente
            </Badge>
          ) : (
            <Badge className="border border-emerald-500/40 bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 sm:px-2 sm:text-[11px] dark:bg-emerald-950 dark:text-emerald-300">
              Concluída
            </Badge>
          )}
        </div>
      </div>
      <CardHeader className="space-y-1 border-b p-2.5 sm:space-y-1.5 sm:p-4">
        <CardTitle className="flex min-w-0 items-start gap-2 text-sm leading-snug sm:items-center sm:text-base">
          <Building2 className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
          <span className="line-clamp-2 sm:truncate">{titulo}</span>
        </CardTitle>
        {limpeza.imovel?.codigo ? (
          <span className="w-fit rounded border border-border/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            #{limpeza.imovel.codigo}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-2.5 text-xs sm:gap-2.5 sm:p-4 sm:text-sm">
        {limpeza.descricao ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 p-2 font-medium text-foreground sm:gap-2 sm:p-2.5">
            <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
            <span className="whitespace-pre-line break-words">{limpeza.descricao}</span>
          </p>
        ) : null}
        {endereco ? (
          <p className="flex items-start gap-1.5 text-muted-foreground sm:gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2 sm:line-clamp-none">{endereco}</span>
          </p>
        ) : null}
        {pendente ? (
          <p className="flex items-start gap-1.5 sm:items-center sm:gap-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 sm:mt-0 dark:text-amber-400" />
            <span>
              Aguardando {espera(limpeza.solicitada_em)}
              <span className="hidden text-muted-foreground sm:inline"> ({momento(limpeza.solicitada_em)})</span>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 sm:items-center sm:gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 sm:mt-0 dark:text-emerald-400" />
            <span>
              Concluída em {momento(limpeza.concluida_em)}
              {nomeDe(limpeza.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.concluinte)}</span> : null}
            </span>
          </p>
        )}
        {limpeza.reserva ? (
          <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground sm:gap-2">
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              <span className="hidden sm:inline">Saída </span>
              {limpeza.reserva.cliente?.nomerazaosocial ? (
                <>
                  <span className="hidden sm:inline">de </span>
                  {limpeza.reserva.cliente.nomerazaosocial}
                </>
              ) : (
                `Reserva #${limpeza.reserva.id}`
              )}
              {limpeza.reserva.cliente?.nomerazaosocial ? <span className="hidden sm:inline"> · Reserva #{limpeza.reserva.id}</span> : null}
            </span>
          </p>
        ) : null}
        <p className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {responsavel ? <span className="truncate">{responsavel}</span> : <span className="text-muted-foreground">Sem responsável</span>}
        </p>
        {limpeza.observacoes ? (
          <p className="rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground sm:text-xs">{limpeza.observacoes}</p>
        ) : null}

        {/* mt-auto: os botões ficam no pé do cartão, alinhados entre cartões da mesma linha. */}
        <div className="mt-auto flex flex-col gap-1.5 pt-1.5 sm:flex-row sm:flex-wrap sm:gap-2 sm:pt-2">
          {pendente ? (
            <Button size="sm" onClick={onConcluir} className="h-8 gap-1.5 px-2 text-xs hover:cursor-pointer sm:h-9 sm:flex-1 sm:text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span className="sm:hidden">Concluída</span>
              <span className="hidden sm:inline">Limpeza concluída</span>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={onDetalhes}
            className={`h-8 gap-1.5 px-2 text-xs hover:cursor-pointer sm:h-9 sm:text-sm ${pendente ? "" : "sm:flex-1"}`}
          >
            <Info className="h-4 w-4" />
            Detalhes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Uma informação dos detalhes: ícone, rótulo pequeno e o valor embaixo. */
function Linha({ icon: Icon, rotulo, children }: { icon: typeof Info; rotulo: string; children: React.ReactNode }) {
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

function DetalhesDialog({
  limpeza,
  podeGerenciar,
  onClose,
  onConcluir,
  onAtribuir,
}: {
  limpeza: Limpeza;
  podeGerenciar: boolean;
  onClose: () => void;
  onConcluir: () => void;
  onAtribuir: () => void;
}) {
  const imovel = limpeza.imovel;
  const titulo = imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const endereco = enderecoDe(imovel);
  const pendente = limpeza.status === "PENDENTE";
  const reserva = limpeza.reserva;
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
                  ) : (
                    <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                      Limpeza concluída
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
                  {pendente && podeGerenciar ? (
                    <Button type="button" size="sm" variant="ghost" onClick={onAtribuir} className="h-7 gap-1.5 px-2 text-xs hover:cursor-pointer">
                      <UserCog className="h-3.5 w-3.5" />
                      Alterar
                    </Button>
                  ) : null}
                </div>
              </Linha>
              {!pendente ? (
                <Linha icon={CheckCircle2} rotulo="Concluída em">
                  {momento(limpeza.concluida_em)}
                  {nomeDe(limpeza.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.concluinte)}</span> : null}
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
          {pendente ? (
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

function ConcluirDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
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
      <DialogContent className="sm:max-w-md">
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

function AtribuirDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
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
