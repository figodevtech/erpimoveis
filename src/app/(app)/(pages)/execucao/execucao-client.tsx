"use client";

import { PageLoading } from "@/components/page-loading";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Hourglass,
  Info,
  LogOut,
  MapPin,
  RefreshCw,
  User,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestJson } from "@/components/imobiliario/shared";
import { carregarUsuarios, nomeExibido, type Usuario } from "@/components/imobiliario/responsavel-servico-select";
// Mesmos diálogos de detalhes e de ações da aba Serviços do imóvel.
import {
  ConcluirServicoDialog,
  IconeServico,
  ReabrirServicoDialog,
  ServicoDetalhesDialog,
  TONS_CHECKIN,
  TrocarRealizadorDialog,
  contagemCheckin,
  contagemPrazo,
  enderecoDe,
  espera,
  momento,
  nomeDe,
  nomeDoServico,
  tituloDoImovel,
  useTiposServico,
  type ServicoImovel,
} from "@/components/imobiliario/servico-detalhes";

type Situacao = "PENDENTE" | "CONCLUIDA";
/** todas · minhas · sem_responsavel · o id de um executor. */
type Escopo = string;
type Resposta = {
  items: ServicoImovel[];
  total: number;
  page: number;
  pageSize: number;
  escopo: Escopo;
  permissoes: { verTodas: boolean; trocarRealizador: boolean };
};

const PAGE_SIZE = 30;
const TODOS_OS_TIPOS = "todos";
const ORDENADOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function ExecucaoClient() {
  const [situacao, setSituacao] = useState<Situacao>("PENDENTE");
  const [tipo, setTipo] = useState(TODOS_OS_TIPOS);
  // Quem vê as tarefas de todos começa vendo todas; sem a permissão, o servidor devolve só as próprias.
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [concluindo, setConcluindo] = useState<ServicoImovel | null>(null);
  const [trocando, setTrocando] = useState<ServicoImovel | null>(null);
  const [reabrindo, setReabrindo] = useState<ServicoImovel | null>(null);
  const [detalhes, setDetalhes] = useState<ServicoImovel | null>(null);
  const { tipos } = useTiposServico();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  // Relógio das contagens (prazo e próximo check-in): atualiza a cada minuto sem buscar de novo.
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
      const params = new URLSearchParams({ status: situacao, escopo, page: String(page), pageSize: String(PAGE_SIZE) });
      if (tipo !== TODOS_OS_TIPOS) params.set("servico_id", tipo);
      const resposta = (await requestJson(`/api/execucao/servicos?${params}`)) as Resposta;
      if (id === sequencia.current) setDados(resposta);
    } catch (error) {
      if (id === sequencia.current) setErro((error as Error).message);
    } finally {
      if (id === sequencia.current) setCarregando(false);
    }
  }, [situacao, escopo, tipo, page]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const verTodas = dados?.permissoes.verTodas ?? false;
  const trocarRealizador = dados?.permissoes.trocarRealizador ?? false;

  // A lista de executores só serve ao filtro de quem vê as tarefas de todos.
  useEffect(() => {
    if (!verTodas || usuarios) return;
    let ativo = true;
    carregarUsuarios()
      .then((lista) => ativo && setUsuarios(lista))
      .catch(() => ativo && setUsuarios([]));
    return () => {
      ativo = false;
    };
  }, [verTodas, usuarios]);

  const executores = useMemo(
    () => [...(usuarios ?? [])].sort((a, b) => ORDENADOR.compare(nomeExibido(a), nomeExibido(b))),
    [usuarios]
  );

  const itens = dados?.items ?? [];
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / PAGE_SIZE)) : 1;
  const filtrando = tipo !== TODOS_OS_TIPOS || (verTodas && escopo !== "todas");

  // Só a primeira carga ocupa a tela; trocar filtro ou atualizar mantém os cartões, esmaecidos.
  if (!dados && !erro) return <PageLoading />;

  const depoisDeAgir = () => void carregar();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Execução de serviços
          </h1>
          <p className="text-sm text-muted-foreground">
            {verTodas
              ? "Serviços dos imóveis de toda a equipe: limpezas dos check-outs, manutenções e o que mais for pedido."
              : "Os serviços sob a sua responsabilidade. Conclua quando o serviço estiver feito."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando} className="gap-1.5 self-start hover:cursor-pointer sm:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={situacao} onValueChange={(v) => { setSituacao(v as Situacao); setPage(1); }} className="self-center md:self-auto">
          <TabsList>
            <TabsTrigger value="PENDENTE" className="px-4 hover:cursor-pointer">Pendentes</TabsTrigger>
            <TabsTrigger value="CONCLUIDA" className="px-4 hover:cursor-pointer">Concluídos</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:items-center">
          <Select value={tipo} onValueChange={(v) => { setTipo(v); setPage(1); }}>
            <SelectTrigger aria-label="Filtrar pelo tipo de serviço" className="h-9 w-full hover:cursor-pointer md:w-52">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS_OS_TIPOS} className="hover:cursor-pointer">Todos os tipos</SelectItem>
              {(tipos ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)} className="hover:cursor-pointer">
                  {t.descricao}
                  {t.ativo === false ? " (inativo)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {verTodas ? (
            <Select value={escopo} onValueChange={(v) => { setEscopo(v); setPage(1); }}>
              <SelectTrigger aria-label="Filtrar pelo executor" className="h-9 w-full hover:cursor-pointer md:w-56">
                <SelectValue placeholder="Todos os executores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas" className="hover:cursor-pointer">Todos os executores</SelectItem>
                <SelectItem value="minhas" className="hover:cursor-pointer">Minhas tarefas</SelectItem>
                <SelectItem value="sem_responsavel" className="hover:cursor-pointer">Sem responsável</SelectItem>
                {executores.length ? <SelectSeparator /> : null}
                {executores.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="hover:cursor-pointer">
                    {nomeExibido(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {erro ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{erro}</span>
          <Button variant="outline" size="sm" onClick={() => void carregar()} className="hover:cursor-pointer">Tentar de novo</Button>
        </div>
      ) : itens.length === 0 ? (
        <div className={`flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center ${carregando ? "opacity-60" : ""}`}>
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="font-medium">
            {situacao === "PENDENTE"
              ? filtrando ? "Nenhum serviço pendente com esses filtros" : "Nenhum serviço pendente"
              : filtrando ? "Nenhum serviço concluído com esses filtros" : "Nenhum serviço concluído ainda"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {situacao === "PENDENTE"
              ? verTodas
                ? "Nenhum imóvel aguardando serviço."
                : "Quando um serviço for pedido com você como responsável, ele aparece aqui."
              : "Os serviços concluídos aparecem aqui, dos mais recentes para os mais antigos."}
          </p>
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-2.5 transition-opacity sm:gap-4 xl:grid-cols-3 ${carregando ? "opacity-60" : ""}`}>
          {itens.map((servico) => (
            <ServicoCard
              key={servico.id}
              servico={servico}
              agora={agora}
              onConcluir={() => setConcluindo(servico)}
              onTrocarRealizador={trocarRealizador ? () => setTrocando(servico) : undefined}
              onDetalhes={() => setDetalhes(servico)}
            />
          ))}
        </div>
      )}

      {dados && dados.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPaginas} · {dados.total} serviços
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || carregando} onClick={() => setPage((p) => p - 1)} className="hover:cursor-pointer">Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPaginas || carregando} onClick={() => setPage((p) => p + 1)} className="hover:cursor-pointer">Próxima</Button>
          </div>
        </div>
      ) : null}

      {/* Um diálogo por vez: concluir ou trocar o realizador a partir dos detalhes fecha os detalhes. */}
      {detalhes ? (
        <ServicoDetalhesDialog
          servico={detalhes}
          agora={agora}
          onClose={() => setDetalhes(null)}
          onConcluir={() => {
            setDetalhes(null);
            setConcluindo(detalhes);
          }}
          onTrocarRealizador={
            trocarRealizador
              ? () => {
                  setDetalhes(null);
                  setTrocando(detalhes);
                }
              : undefined
          }
          // Reabrir um concluído pela Execução fica com quem vê as tarefas de todos.
          onReabrir={
            verTodas
              ? () => {
                  setDetalhes(null);
                  setReabrindo(detalhes);
                }
              : undefined
          }
        />
      ) : null}

      {concluindo ? (
        <ConcluirServicoDialog
          servico={concluindo}
          onClose={() => setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            depoisDeAgir();
          }}
        />
      ) : null}

      {trocando ? (
        <TrocarRealizadorDialog
          servico={trocando}
          onClose={() => setTrocando(null)}
          onDone={() => {
            setTrocando(null);
            depoisDeAgir();
          }}
        />
      ) : null}

      {reabrindo ? (
        <ReabrirServicoDialog
          servico={reabrindo}
          onClose={() => setReabrindo(null)}
          onDone={() => {
            setReabrindo(null);
            depoisDeAgir();
          }}
        />
      ) : null}
    </div>
  );
}

function ServicoCard({
  servico,
  agora,
  onConcluir,
  onTrocarRealizador,
  onDetalhes,
}: {
  servico: ServicoImovel;
  agora: number;
  onConcluir: () => void;
  /** Só com a permissão de trocar o realizador. */
  onTrocarRealizador?: () => void;
  onDetalhes: () => void;
}) {
  const titulo = tituloDoImovel(servico);
  const tipo = nomeDoServico(servico);
  const endereco = enderecoDe(servico.imovel);
  const responsavel = nomeDe(servico.responsavel);
  const pendente = servico.status === "PENDENTE";
  // Só no pendente: o prazo do pedido, quando houver; senão, a próxima entrada de hóspede.
  const prazo = pendente && servico.prazo_em ? contagemPrazo(servico.prazo_em, agora) : null;
  const checkin = pendente && !prazo && servico.proximo_checkin ? contagemCheckin(servico.proximo_checkin, agora) : null;
  const contagem = prazo ?? checkin;

  const foto = servico.imovel?.foto_capa;

  // No celular são dois cartões por linha (~170px cada): espaçamentos, textos e botões encolhem.
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden py-0">
      {/* Foto de capa do imóvel: quem vai executar reconhece o imóvel de relance. */}
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
              Concluído
            </Badge>
          )}
        </div>
        {/* O tipo do serviço em cima da foto: limpeza, manutenção... */}
        <div className="absolute bottom-1.5 left-1.5 right-1.5 sm:bottom-2 sm:left-2 sm:right-auto">
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background/95 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-sm sm:gap-1.5 sm:px-2 sm:text-xs">
            <IconeServico tipo={servico.servico} className="h-3 w-3 shrink-0 text-primary sm:h-3.5 sm:w-3.5" />
            <span className="truncate">{tipo}</span>
          </span>
        </div>
      </div>
      <CardHeader className="space-y-1 border-b p-2.5 sm:space-y-1.5 sm:p-4">
        <CardTitle className="flex min-w-0 items-start gap-2 text-sm leading-snug sm:items-center sm:text-base">
          <Building2 className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
          <span className="line-clamp-2 sm:truncate">{titulo}</span>
        </CardTitle>
        {servico.imovel?.codigo ? (
          <span className="w-fit rounded border border-border/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            #{servico.imovel.codigo}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-2.5 text-xs sm:gap-2.5 sm:p-4 sm:text-sm">
        {pendente ? (
          contagem ? (
            <div className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 sm:gap-2 sm:px-2.5 sm:py-2 ${TONS_CHECKIN[contagem.tom]}`}>
              {prazo ? (
                <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              ) : (
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              )}
              <div className="min-w-0 leading-tight">
                <p className="font-semibold">
                  <span className="sm:hidden">{contagem.curto}</span>
                  <span className="hidden sm:inline">{contagem.longo}</span>
                </p>
                <p className="mt-0.5 text-[11px] opacity-80 sm:text-xs">{contagem.quando}</p>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-muted-foreground sm:gap-2 sm:px-2.5">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span>Sem prazo nem check-in</span>
            </p>
          )
        ) : null}
        {servico.descricao ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 p-2 font-medium text-foreground sm:gap-2 sm:p-2.5">
            <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
            <span className="whitespace-pre-line break-words">{servico.descricao}</span>
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
              Aguardando {espera(servico.solicitada_em)}
              <span className="hidden text-muted-foreground sm:inline"> ({momento(servico.solicitada_em)})</span>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 sm:items-center sm:gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 sm:mt-0 dark:text-emerald-400" />
            <span>
              Concluído em {momento(servico.concluida_em)}
              {nomeDe(servico.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(servico.concluinte)}</span> : null}
            </span>
          </p>
        )}
        {servico.reserva ? (
          <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground sm:gap-2">
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              <span className="hidden sm:inline">Saída </span>
              {servico.reserva.cliente?.nomerazaosocial ? (
                <>
                  <span className="hidden sm:inline">de </span>
                  {servico.reserva.cliente.nomerazaosocial}
                </>
              ) : (
                `Reserva #${servico.reserva.id}`
              )}
              {servico.reserva.cliente?.nomerazaosocial ? <span className="hidden sm:inline"> · Reserva #{servico.reserva.id}</span> : null}
            </span>
          </p>
        ) : null}
        <p className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {responsavel ? <span className="truncate">{responsavel}</span> : <span className="text-muted-foreground">Sem responsável</span>}
        </p>
        {servico.observacoes ? (
          <p className="rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground sm:text-xs">{servico.observacoes}</p>
        ) : null}

        {/* mt-auto: os botões ficam no pé do cartão, alinhados entre cartões da mesma linha. */}
        <div className="mt-auto flex flex-col gap-1.5 pt-1.5 sm:flex-row sm:flex-wrap sm:gap-2 sm:pt-2">
          {pendente ? (
            <Button size="sm" onClick={onConcluir} className="h-8 gap-1.5 px-2 text-xs hover:cursor-pointer sm:h-9 sm:flex-1 sm:text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span className="sm:hidden">Concluir</span>
              <span className="hidden sm:inline">Concluir serviço</span>
            </Button>
          ) : null}
          {pendente && onTrocarRealizador ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onTrocarRealizador}
              className="h-8 gap-1.5 px-2 text-xs hover:cursor-pointer sm:h-9 sm:text-sm"
            >
              <UserCog className="h-4 w-4" />
              <span className="sm:hidden">Trocar</span>
              <span className="hidden sm:inline">Trocar realizador</span>
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
