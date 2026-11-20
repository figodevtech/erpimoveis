"use client";

import { useState } from "react";
import { CheckCircle2, Hourglass, LogOut, MoreHorizontal, Pencil, Plus, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RemoteState, useModulePermission, useRemote } from "./shared";
import {
  ConcluirServicoDialog,
  EditarServicoDialog,
  IconeServico,
  ReabrirServicoDialog,
  SituacaoServicoBadge,
  SolicitarServicoDialog,
  contagemPrazo,
  ehLimpeza,
  espera,
  momento,
  nomeDe,
  nomeDoServico,
  useTiposServico,
  type ServicoImovel,
} from "./servico-detalhes";

const PAGE_SIZE = 20;
type Filtro = "TODOS" | "PENDENTE" | "CONCLUIDA" | "CANCELADA";
const FILTROS: { value: Filtro; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PENDENTE", label: "Pendentes" },
  { value: "CONCLUIDA", label: "Concluídos" },
  { value: "CANCELADA", label: "Cancelados" },
];
const TODOS_OS_TIPOS = "todos";

/** Cores do texto do prazo, nos tons da contagem da Execução. */
const COR_DO_PRAZO = {
  atrasado: "text-red-700 dark:text-red-400",
  urgente: "text-orange-700 dark:text-orange-400",
  breve: "text-amber-700 dark:text-amber-300",
  folga: "text-emerald-700 dark:text-emerald-400",
} as const;

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

/** Data principal da linha: a conclusão, quando houver; senão, o pedido (e o prazo, se pendente). */
function datas(servico: ServicoImovel) {
  if (servico.status === "CONCLUIDA") {
    return { rotulo: "Concluído", principal: momento(servico.concluida_em), secundaria: `Pedido ${momento(servico.solicitada_em)}`, prazo: null };
  }
  if (servico.status === "PENDENTE") {
    const prazo = servico.prazo_em ? contagemPrazo(servico.prazo_em, Date.now()) : null;
    return { rotulo: "Pedido", principal: momento(servico.solicitada_em), secundaria: `Aguardando ${espera(servico.solicitada_em)}`, prazo };
  }
  return { rotulo: "Pedido", principal: momento(servico.solicitada_em), secundaria: "Cancelado", prazo: null };
}

function Responsavel({ servico }: { servico: ServicoImovel }) {
  const nome = nomeDe(servico.responsavel);
  if (!nome) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <User className="h-3.5 w-3.5" />
        Sem responsável
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar className="h-6 w-6 shrink-0 border border-border/50">
        <AvatarFallback className="bg-primary/10 text-[10px] font-bold text-primary">{iniciais(nome)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{nome}</span>
    </span>
  );
}

function Servico({ servico }: { servico: ServicoImovel }) {
  const hospede = servico.reserva?.cliente?.nomerazaosocial;
  const limpeza = ehLimpeza(servico.servico);
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          limpeza ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
        )}
      >
        <IconeServico tipo={servico.servico} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-foreground">{nomeDoServico(servico)}</p>
        <p className="line-clamp-1 text-[11px] text-muted-foreground">{servico.descricao || "Sem instruções além do serviço padrão"}</p>
        {servico.reserva ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <LogOut className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {hospede ? `Saída de ${hospede} · ` : ""}Reserva #{servico.reserva.id}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Prazo do serviço pendente: quando e quanto falta, no tom da contagem. */
function Prazo({ prazo, className }: { prazo: ReturnType<typeof contagemPrazo>; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1 text-[11px] font-medium", COR_DO_PRAZO[prazo.tom], className)}>
      <Hourglass className="h-3 w-3 shrink-0" />
      <span>
        {prazo.curto} · {prazo.quando}
      </span>
    </p>
  );
}

function Acoes({
  servico,
  podeEditar,
  podeConcluir,
  onEditar,
  onConcluir,
  onReabrir,
}: {
  servico: ServicoImovel;
  podeEditar: boolean;
  podeConcluir: boolean;
  onEditar: () => void;
  onConcluir: () => void;
  onReabrir: () => void;
}) {
  const pendente = servico.status === "PENDENTE";
  // Sem permissão de editar, concluir ou reabrir, o menu ficaria vazio.
  if (!podeEditar && !podeConcluir) return null;
  return (
    // modal={false}: o diálogo aberto pelo menu não briga com o foco do menu ao fechar.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 hover:cursor-pointer"
          aria-label="Ações do serviço"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {podeEditar ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onEditar();
            }}
          >
            <Pencil className="h-4 w-4" />
            <span>Editar</span>
          </DropdownMenuItem>
        ) : null}
        {podeEditar && podeConcluir ? <DropdownMenuSeparator /> : null}
        {podeConcluir && pendente ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onConcluir();
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Concluir serviço</span>
          </DropdownMenuItem>
        ) : null}
        {podeConcluir && !pendente ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onReabrir();
            }}
          >
            <RotateCcw className="h-4 w-4" />
            <span>Voltar para pendente</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Carregamento: mesmas colunas e alturas da tabela (e dos cartões no celular), para nada pular. */
function ServicosSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border/60 bg-card sm:block">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_7rem_minmax(0,1.2fr)_3rem] gap-4 border-b bg-muted/40 px-4 py-3">
          {["w-16", "w-20", "w-14", "w-12", "w-8"].map((w, i) => (
            <Skeleton key={i} className={cn("h-3.5", w)} />
          ))}
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_7rem_minmax(0,1.2fr)_3rem] items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
            <div className="flex items-start gap-2.5">
              <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="mx-auto h-8 w-8 rounded-md" />
          </div>
        ))}
      </div>
      <div className="space-y-2.5 sm:hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <Skeleton className="h-7 w-7 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Aba Serviços do imóvel: os serviços pedidos (limpeza, manutenção...) e o andamento de cada um. */
export function ImovelServicosPanel({
  imovelId,
  imovel,
  onChanged,
}: {
  imovelId: number;
  /** Para o cabeçalho do "Solicitar serviço" e o aviso de limpeza já pendente. */
  imovel?: { titulo?: string | null; codigo?: string | null; situacao_operacional?: string | null };
  onChanged?: () => void;
}) {
  const { can } = useModulePermission();
  // Pedir e editar: quem edita imóveis. Concluir e voltar para pendente: também quem vê as
  // tarefas de todos na Execução (o servidor confere de novo).
  const podeEditar = can("imoveis:editar");
  const podeConcluir = podeEditar || can("execucao:ver_todas");
  const { tipos } = useTiposServico();
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [tipo, setTipo] = useState(TODOS_OS_TIPOS);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ status: filtro, page: String(page), pageSize: String(PAGE_SIZE) });
  if (tipo !== TODOS_OS_TIPOS) params.set("servico_id", tipo);
  const remote = useRemote<{ items: ServicoImovel[]; total: number }>(`/api/imoveis/${imovelId}/servicos?${params}`);
  const [solicitando, setSolicitando] = useState(false);
  const [editando, setEditando] = useState<ServicoImovel | null>(null);
  const [concluindo, setConcluindo] = useState<ServicoImovel | null>(null);
  const [reabrindo, setReabrindo] = useState<ServicoImovel | null>(null);

  const itens = remote.data?.items ?? [];
  const total = remote.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const carregandoPrimeira = !remote.data && !remote.error;
  const recarregando = Boolean(remote.data && remote.loading);
  const filtrando = filtro !== "TODOS" || tipo !== TODOS_OS_TIPOS;

  // Dois cliques na linha também editam, para quem pode.
  const abrirEdicao = (servico: ServicoImovel) => {
    if (podeEditar) setEditando(servico);
  };
  // Pedir, concluir ou reabrir uma limpeza muda a situação do imóvel (Limpeza): o cadastro recarrega junto.
  const depoisDeAgir = () => {
    remote.reload();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground sm:text-base">Serviços do imóvel</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Limpezas dos check-outs e os demais serviços pedidos, com o responsável e o andamento de cada um.
          </p>
        </div>
        {podeEditar ? (
          <Button size="sm" onClick={() => setSolicitando(true)} className="h-9 gap-1.5 self-start hover:cursor-pointer sm:self-auto">
            <Plus className="h-4 w-4" />
            Solicitar serviço
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Filtrar serviços pela situação"
          className="inline-flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border bg-muted/40 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FILTROS.map((opcao) => {
            const ativo = filtro === opcao.value;
            return (
              <button
                key={opcao.value}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => {
                  setFiltro(opcao.value);
                  setPage(1);
                }}
                className={cn(
                  "h-7 shrink-0 rounded-lg px-3 text-xs font-medium transition-all hover:cursor-pointer",
                  ativo ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                {opcao.label}
              </button>
            );
          })}
        </div>
        <Select
          value={tipo}
          onValueChange={(valor) => {
            setTipo(valor);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filtrar pelo tipo de serviço" className="h-9 w-full text-xs hover:cursor-pointer sm:w-52">
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
      </div>

      {carregandoPrimeira ? (
        <ServicosSkeleton />
      ) : (
        <RemoteState error={remote.data ? null : remote.error} retry={remote.reload}>
          {itens.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card p-10 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <IconeServico tipo={null} className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {filtrando ? "Nenhum serviço com esses filtros" : "Nenhum serviço neste imóvel"}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                As limpezas pedidas no check-out e os serviços solicitados aqui aparecem nesta aba, dos mais recentes para os mais antigos.
              </p>
              {podeEditar && !filtrando ? (
                <Button size="sm" variant="outline" onClick={() => setSolicitando(true)} className="mt-1 gap-1.5 hover:cursor-pointer">
                  <Plus className="h-4 w-4" />
                  Solicitar serviço
                </Button>
              ) : null}
            </div>
          ) : (
            <div className={cn("space-y-3 transition-opacity", recarregando && "opacity-60")}>
              {/* Desktop: tabela. Dois cliques na linha abrem a edição, como nas outras listas. */}
              <div className="hidden overflow-x-auto rounded-lg border border-border/60 bg-card sm:block">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-semibold">Serviço</TableHead>
                      <TableHead className="font-semibold">Responsável</TableHead>
                      <TableHead className="font-semibold">Situação</TableHead>
                      <TableHead className="font-semibold">Data</TableHead>
                      <TableHead className="w-[60px] text-center font-semibold">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.map((servico) => {
                      const d = datas(servico);
                      return (
                        <TableRow
                          key={servico.id}
                          className={cn("group transition-colors hover:bg-muted/30", podeEditar && "hover:cursor-pointer")}
                          onDoubleClick={() => abrirEdicao(servico)}
                        >
                          <TableCell className="max-w-[280px] py-3">
                            <Servico servico={servico} />
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <Responsavel servico={servico} />
                          </TableCell>
                          <TableCell>
                            <SituacaoServicoBadge status={servico.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <p className="text-foreground">
                              <span className="text-muted-foreground">{d.rotulo} </span>
                              {d.principal}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{d.secundaria}</p>
                            {d.prazo ? <Prazo prazo={d.prazo} className="mt-0.5" /> : null}
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Acoes
                              servico={servico}
                              podeEditar={podeEditar}
                              podeConcluir={podeConcluir}
                              onEditar={() => abrirEdicao(servico)}
                              onConcluir={() => setConcluindo(servico)}
                              onReabrir={() => setReabrindo(servico)}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Celular: cartões com as mesmas informações. */}
              <div className="space-y-2.5 sm:hidden">
                {itens.map((servico) => {
                  const d = datas(servico);
                  return (
                    <div key={servico.id} className="space-y-3 rounded-xl border bg-card p-3.5 text-xs shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <Servico servico={servico} />
                        <Acoes
                          servico={servico}
                          podeEditar={podeEditar}
                          podeConcluir={podeConcluir}
                          onEditar={() => abrirEdicao(servico)}
                          onConcluir={() => setConcluindo(servico)}
                          onReabrir={() => setReabrindo(servico)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <SituacaoServicoBadge status={servico.status} />
                        <span className="text-muted-foreground">
                          {d.rotulo} {d.principal}
                        </span>
                      </div>
                      {d.prazo ? <Prazo prazo={d.prazo} /> : null}
                      <div className="border-t border-border/50 pt-2.5">
                        <Responsavel servico={servico} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {total > PAGE_SIZE ? (
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    Página {page} de {totalPaginas} · {total} serviços
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1 || remote.loading} onClick={() => setPage((p) => p - 1)} className="h-8 hover:cursor-pointer">
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPaginas || remote.loading} onClick={() => setPage((p) => p + 1)} className="h-8 hover:cursor-pointer">
                      Próxima
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </RemoteState>
      )}

      {solicitando ? (
        <SolicitarServicoDialog
          imovel={{ id: imovelId, ...imovel }}
          onClose={() => setSolicitando(false)}
          onDone={() => {
            setSolicitando(false);
            depoisDeAgir();
          }}
        />
      ) : null}

      {editando ? (
        <EditarServicoDialog
          servico={editando}
          onClose={() => setEditando(null)}
          onDone={() => {
            setEditando(null);
            depoisDeAgir();
          }}
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
