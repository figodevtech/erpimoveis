"use client";

import { useInitialPageLoading } from "@/hooks/use-initial-page-loading";
import { PageLoading } from "@/components/page-loading";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Info,
  LogOut,
  MapPin,
  RefreshCw,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestJson } from "@/components/imobiliario/shared";
// Mesmo diálogo de detalhes e de ações da aba Serviços do imóvel.
import {
  AtribuirLimpezaDialog,
  ConcluirLimpezaServicoDialog,
  LimpezaDetalhesDialog,
  ReabrirLimpezaDialog,
  TONS_CHECKIN,
  contagemCheckin,
  enderecoDe,
  espera,
  momento,
  nomeDe,
  type Limpeza,
} from "@/components/imobiliario/limpeza-detalhes";

type Resposta = { items: Limpeza[]; total: number; page: number; pageSize: number; escopo: Escopo; podeGerenciar: boolean };
type Situacao = "PENDENTE" | "CONCLUIDA";
type Escopo = "minhas" | "todas" | "sem_responsavel";

const PAGE_SIZE = 30;

export function ExecucaoClient() {
  const [situacao, setSituacao] = useState<Situacao>("PENDENTE");
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [concluindo, setConcluindo] = useState<Limpeza | null>(null);
  const [atribuindo, setAtribuindo] = useState<Limpeza | null>(null);
  const [reabrindo, setReabrindo] = useState<Limpeza | null>(null);
  const [detalhes, setDetalhes] = useState<Limpeza | null>(null);
  // Relógio da contagem até o próximo check-in: atualiza a cada minuto sem buscar de novo.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(relogio);
  }, []);
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

  const initialPageLoading = useInitialPageLoading(carregando);

  if (initialPageLoading) return <PageLoading />;

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
              agora={agora}
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
        <LimpezaDetalhesDialog
          limpeza={detalhes}
          agora={agora}
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
          // Reabrir uma concluída pela Execução fica com quem gerencia limpezas.
          onReabrir={
            podeGerenciar
              ? () => {
                  setDetalhes(null);
                  setReabrindo(detalhes);
                }
              : undefined
          }
        />
      ) : null}

      {concluindo ? (
        <ConcluirLimpezaServicoDialog
          limpeza={concluindo}
          onClose={() => setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            void carregar();
          }}
        />
      ) : null}

      {atribuindo ? (
        <AtribuirLimpezaDialog
          limpeza={atribuindo}
          onClose={() => setAtribuindo(null)}
          onDone={() => {
            setAtribuindo(null);
            void carregar();
          }}
        />
      ) : null}

      {reabrindo ? (
        <ReabrirLimpezaDialog
          limpeza={reabrindo}
          onClose={() => setReabrindo(null)}
          onDone={() => {
            setReabrindo(null);
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}

function LimpezaCard({
  limpeza,
  agora,
  onConcluir,
  onDetalhes,
}: {
  limpeza: Limpeza;
  agora: number;
  onConcluir: () => void;
  onDetalhes: () => void;
}) {
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const endereco = enderecoDe(limpeza.imovel);
  const responsavel = nomeDe(limpeza.responsavel);
  const pendente = limpeza.status === "PENDENTE";
  // Só faz sentido na limpeza pendente: é o prazo para o imóvel ficar pronto.
  const checkin = pendente && limpeza.proximo_checkin ? contagemCheckin(limpeza.proximo_checkin, agora) : null;

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
        {pendente ? (
          checkin ? (
            <div className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 sm:gap-2 sm:px-2.5 sm:py-2 ${TONS_CHECKIN[checkin.tom]}`}>
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <div className="min-w-0 leading-tight">
                <p className="font-semibold">
                  <span className="sm:hidden">{checkin.curto}</span>
                  <span className="hidden sm:inline">{checkin.longo}</span>
                </p>
                <p className="mt-0.5 text-[11px] opacity-80 sm:text-xs">{checkin.quando}</p>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-muted-foreground sm:gap-2 sm:px-2.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span>Sem check-in agendado</span>
            </p>
          )
        ) : null}
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
