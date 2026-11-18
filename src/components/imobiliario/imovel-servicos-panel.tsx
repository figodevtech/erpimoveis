"use client";

import { useState } from "react";
import { CheckCircle2, LogOut, MoreHorizontal, Pencil, RotateCcw, Sparkles, User } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RemoteState, useModulePermission, useRemote } from "./shared";
import {
  ConcluirLimpezaServicoDialog,
  EditarLimpezaDialog,
  ReabrirLimpezaDialog,
  SituacaoLimpezaBadge,
  espera,
  momento,
  nomeDe,
  type Limpeza,
} from "./limpeza-detalhes";

const PAGE_SIZE = 20;
type Filtro = "TODOS" | "PENDENTE" | "CONCLUIDA" | "CANCELADA";
const FILTROS: { value: Filtro; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PENDENTE", label: "Pendentes" },
  { value: "CONCLUIDA", label: "Concluídos" },
  { value: "CANCELADA", label: "Cancelados" },
];

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

/** Data principal da linha: a conclusão, quando houver; senão, o pedido. */
function datas(limpeza: Limpeza) {
  if (limpeza.status === "CONCLUIDA") {
    return { rotulo: "Concluída", principal: momento(limpeza.concluida_em), secundaria: `Pedida ${momento(limpeza.solicitada_em)}` };
  }
  if (limpeza.status === "PENDENTE") {
    return { rotulo: "Pedida", principal: momento(limpeza.solicitada_em), secundaria: `Aguardando ${espera(limpeza.solicitada_em)}` };
  }
  return { rotulo: "Pedida", principal: momento(limpeza.solicitada_em), secundaria: "Cancelada" };
}

function Responsavel({ limpeza }: { limpeza: Limpeza }) {
  const nome = nomeDe(limpeza.responsavel);
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

function Servico({ limpeza }: { limpeza: Limpeza }) {
  const hospede = limpeza.reserva?.cliente?.nomerazaosocial;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-foreground">Limpeza</p>
        <p className="line-clamp-1 text-[11px] text-muted-foreground">{limpeza.descricao || "Limpeza padrão"}</p>
        {limpeza.reserva ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <LogOut className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {hospede ? `Saída de ${hospede} · ` : ""}Reserva #{limpeza.reserva.id}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Acoes({
  limpeza,
  podeAgir,
  onEditar,
  onConcluir,
  onReabrir,
}: {
  limpeza: Limpeza;
  podeAgir: boolean;
  onEditar: () => void;
  onConcluir: () => void;
  onReabrir: () => void;
}) {
  const pendente = limpeza.status === "PENDENTE";
  // Sem permissão de editar, concluir ou reabrir, o menu ficaria vazio.
  if (!podeAgir) return null;
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
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onEditar();
          }}
        >
          <Pencil className="h-4 w-4" />
          <span>Editar</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {pendente ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onConcluir();
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Concluir limpeza</span>
          </DropdownMenuItem>
        ) : null}
        {!pendente ? (
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

/** Aba Serviços do imóvel: as limpezas (pendentes, concluídas e canceladas) e o andamento de cada uma. */
export function ImovelServicosPanel({ imovelId, onChanged }: { imovelId: number; onChanged?: () => void }) {
  const { can } = useModulePermission();
  // Editar, concluir e voltar para pendente: quem edita imóveis ou gerencia limpezas (o servidor confere de novo).
  const podeAgir = can("imoveis:editar") || can("limpezas:gerenciar");
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [page, setPage] = useState(1);
  const remote = useRemote<{ items: Limpeza[]; total: number }>(
    `/api/imoveis/${imovelId}/servicos?status=${filtro}&page=${page}&pageSize=${PAGE_SIZE}`
  );
  const [editando, setEditando] = useState<Limpeza | null>(null);
  const [concluindo, setConcluindo] = useState<Limpeza | null>(null);
  const [reabrindo, setReabrindo] = useState<Limpeza | null>(null);

  const itens = remote.data?.items ?? [];
  const total = remote.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const carregandoPrimeira = !remote.data && !remote.error;
  const recarregando = Boolean(remote.data && remote.loading);

  // Dois cliques na linha também editam, para quem pode.
  const abrirEdicao = (limpeza: Limpeza) => {
    if (podeAgir) setEditando(limpeza);
  };
  // Concluir ou reabrir muda a situação do imóvel (Limpeza): o cadastro recarrega junto.
  const depoisDeAgir = () => {
    remote.reload();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground sm:text-base">Serviços do imóvel</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Limpezas pedidas nos check-outs das reservas, com o responsável e o andamento de cada uma.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Filtrar serviços pela situação"
          className="inline-flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border bg-muted/40 p-1 [scrollbar-width:none] sm:self-auto [&::-webkit-scrollbar]:hidden"
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
      </div>

      {carregandoPrimeira ? (
        <ServicosSkeleton />
      ) : (
        <RemoteState error={remote.data ? null : remote.error} retry={remote.reload}>
          {itens.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card p-10 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {filtro === "TODOS" ? "Nenhum serviço neste imóvel" : "Nenhum serviço nesta situação"}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                As limpezas pedidas no check-out das reservas aparecem aqui, das mais recentes para as mais antigas.
              </p>
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
                    {itens.map((limpeza) => {
                      const d = datas(limpeza);
                      return (
                        <TableRow
                          key={limpeza.id}
                          className={cn("group transition-colors hover:bg-muted/30", podeAgir && "hover:cursor-pointer")}
                          onDoubleClick={() => abrirEdicao(limpeza)}
                        >
                          <TableCell className="max-w-[280px] py-3">
                            <Servico limpeza={limpeza} />
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <Responsavel limpeza={limpeza} />
                          </TableCell>
                          <TableCell>
                            <SituacaoLimpezaBadge status={limpeza.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <p className="text-foreground">
                              <span className="text-muted-foreground">{d.rotulo} </span>
                              {d.principal}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{d.secundaria}</p>
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Acoes
                              limpeza={limpeza}
                              podeAgir={podeAgir}
                              onEditar={() => abrirEdicao(limpeza)}
                              onConcluir={() => setConcluindo(limpeza)}
                              onReabrir={() => setReabrindo(limpeza)}
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
                {itens.map((limpeza) => {
                  const d = datas(limpeza);
                  return (
                    <div key={limpeza.id} className="space-y-3 rounded-xl border bg-card p-3.5 text-xs shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <Servico limpeza={limpeza} />
                        <Acoes
                          limpeza={limpeza}
                          podeAgir={podeAgir}
                          onEditar={() => abrirEdicao(limpeza)}
                          onConcluir={() => setConcluindo(limpeza)}
                          onReabrir={() => setReabrindo(limpeza)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <SituacaoLimpezaBadge status={limpeza.status} />
                        <span className="text-muted-foreground">
                          {d.rotulo} {d.principal}
                        </span>
                      </div>
                      <div className="border-t border-border/50 pt-2.5">
                        <Responsavel limpeza={limpeza} />
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

      {editando ? (
        <EditarLimpezaDialog
          limpeza={editando}
          onClose={() => setEditando(null)}
          onDone={() => {
            setEditando(null);
            depoisDeAgir();
          }}
        />
      ) : null}

      {concluindo ? (
        <ConcluirLimpezaServicoDialog
          limpeza={concluindo}
          onClose={() => setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            depoisDeAgir();
          }}
        />
      ) : null}

      {reabrindo ? (
        <ReabrirLimpezaDialog
          limpeza={reabrindo}
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
