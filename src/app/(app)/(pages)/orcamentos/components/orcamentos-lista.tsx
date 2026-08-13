"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ClipboardList,
  FileEdit,
  Loader2,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

import { descartarOrcamento, listarOrcamentos } from "../lib/api";
import type { OrcamentoLinha, SituacaoOrcamento } from "../types";
import { OrcamentoAvulsoDialog } from "./orcamento-avulso-dialog";
import { GerarOSDialog } from "./gerar-os-dialog";

const dinheiro = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);

const dataHora = (valor?: string | null) => {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const ABAS: Array<{
  chave: SituacaoOrcamento;
  rotulo: string;
  ponto: string;
  ativo: string;
}> = [
  {
    chave: "ABERTO",
    rotulo: "Abertos",
    ponto: "bg-fuchsia-500",
    ativo:
      "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-300",
  },
  {
    chave: "CONVERTIDO",
    rotulo: "Finalizados",
    ponto: "bg-emerald-600",
    ativo:
      "border-emerald-600/40 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
  },
];

const LIMITE = 10;

export function OrcamentosLista() {
  const router = useRouter();
  const { data: session } = useSession();
  const permissoes = (session?.user as any)?.permissoes;
  const podeCriar = permissionSetHas(permissoes, PERMS.ORCAMENTOS_CRIAR);
  const podeEditar = permissionSetHas(permissoes, PERMS.ORCAMENTOS_EDITAR);
  const podeExcluir = permissionSetHas(permissoes, PERMS.ORCAMENTOS_EXCLUIR);

  const [situacao, setSituacao] = useState<SituacaoOrcamento>("ABERTO");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);

  const [itens, setItens] = useState<OrcamentoLinha[]>([]);
  const [contadores, setContadores] = useState<Record<SituacaoOrcamento, number>>({
    ABERTO: 0,
    CONVERTIDO: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [carregando, setCarregando] = useState(true);

  const [dialogAberto, setDialogAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<number | undefined>(undefined);
  const [gerarAberto, setGerarAberto] = useState(false);
  const [paraGerar, setParaGerar] = useState<OrcamentoLinha | null>(null);
  const [paraDescartar, setParaDescartar] = useState<OrcamentoLinha | null>(null);
  const [descartando, setDescartando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await listarOrcamentos({
        situacao,
        q: buscaAplicada || undefined,
        page: pagina,
        limit: LIMITE,
      });
      setItens(resposta.items ?? []);
      setContadores(resposta.counters ?? { ABERTO: 0, CONVERTIDO: 0 });
      setTotal(resposta.total ?? 0);
      setTotalPaginas(resposta.totalPages ?? 1);
    } catch (erro: any) {
      toast.error(erro?.message ?? "Falha ao carregar orçamentos");
    } finally {
      setCarregando(false);
    }
  }, [situacao, buscaAplicada, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar de aba ou de busca reinicia a paginação: manter a página 3 ao mudar
  // de filtro costuma cair numa lista vazia sem explicação.
  useEffect(() => {
    setPagina(1);
  }, [situacao, buscaAplicada]);

  const vazio = !carregando && itens.length === 0;

  const tituloVazio = useMemo(() => {
    if (buscaAplicada) return "Nenhum orçamento encontrado para esta busca.";
    return situacao === "ABERTO"
      ? "Nenhum orçamento em aberto."
      : "Nenhum orçamento finalizado ainda.";
  }, [buscaAplicada, situacao]);

  async function confirmarDescarte() {
    if (!paraDescartar) return;
    setDescartando(true);
    try {
      await descartarOrcamento(paraDescartar.id);
      toast.success("Orçamento descartado.");
      setParaDescartar(null);
      await carregar();
    } catch (erro: any) {
      toast.error(erro?.message ?? "Falha ao descartar orçamento");
    } finally {
      setDescartando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">
            Cotações avulsas. Não movimentam estoque — só quando viram uma OS.
          </p>
        </div>

        {podeCriar ? (
          <Button
            onClick={() => {
              setEmEdicao(undefined);
              setDialogAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo orçamento
          </Button>
        ) : null}
      </div>

      {/* Os dois badges do topo: abertos e finalizados (já convertidos em OS). */}
      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map((aba) => {
          const ativo = situacao === aba.chave;
          return (
            <button
              key={aba.chave}
              type="button"
              onClick={() => setSituacao(aba.chave)}
              className={[
                "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors",
                ativo
                  ? aba.ativo
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              ].join(" ")}
              aria-pressed={ativo}
            >
              <span className={`h-2 w-2 rounded-full ${aba.ponto}`} />
              <span className="font-medium">{aba.rotulo}</span>
              <Badge variant="secondary" className="tabular-nums">
                {contadores[aba.chave] ?? 0}
              </Badge>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(evento) => {
              evento.preventDefault();
              setBuscaAplicada(busca.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar por número ou descrição"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Nº</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {carregando ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : vazio ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                      <ClipboardList className="mx-auto mb-2 h-6 w-6" />
                      {tituloVazio}
                    </TableCell>
                  </TableRow>
                ) : (
                  itens.map((linha) => (
                    <TableRow key={linha.id}>
                      <TableCell className="font-medium tabular-nums">#{linha.id}</TableCell>
                      <TableCell>
                        {linha.cliente?.nomerazaosocial?.trim() || (
                          <span className="text-muted-foreground">Sem cliente</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">
                        {linha.descricao?.trim() || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {dataHora(linha.created_at)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {dinheiro(linha.total)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <span className="sr-only">Ações</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>

                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Ações</DropdownMenuLabel>

                            <DropdownMenuItem
                              onClick={() => window.open(`/print/orcamento/${linha.id}`, "_blank")}
                            >
                              <Printer className="mr-2 h-4 w-4" />
                              Imprimir
                            </DropdownMenuItem>

                            {linha.status === "ABERTO" && podeEditar ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEmEdicao(linha.id);
                                    setDialogAberto(true);
                                  }}
                                >
                                  <FileEdit className="mr-2 h-4 w-4" />
                                  Editar orçamento
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                  onClick={() => {
                                    setParaGerar(linha);
                                    setGerarAberto(true);
                                  }}
                                >
                                  <Wrench className="mr-2 h-4 w-4" />
                                  Gerar OS
                                </DropdownMenuItem>
                              </>
                            ) : null}

                            {linha.status === "CONVERTIDO" ? (
                              <DropdownMenuItem onClick={() => router.push("/ordens")}>
                                <Wrench className="mr-2 h-4 w-4" />
                                Ver ordens de serviço
                              </DropdownMenuItem>
                            ) : null}

                            {linha.status === "ABERTO" && podeExcluir ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setParaDescartar(linha)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Descartar
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPaginas > 1 ? (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total} {total === 1 ? "orçamento" : "orçamentos"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina <= 1 || carregando}
                  onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
                >
                  Anterior
                </Button>
                <span className="tabular-nums">
                  {pagina} / {totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina >= totalPaginas || carregando}
                  onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))}
                >
                  Próxima
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <OrcamentoAvulsoDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        orcamentoId={emEdicao}
        onConcluido={() => void carregar()}
      />

      <GerarOSDialog
        open={gerarAberto}
        onOpenChange={setGerarAberto}
        orcamento={paraGerar}
        onGerada={() => {
          void carregar();
          // Depois de converter, o orçamento sai de "Abertos": levar o usuário
          // para a aba onde ele agora está evita a impressão de que sumiu.
          setSituacao("CONVERTIDO");
        }}
      />

      <AlertDialog
        open={Boolean(paraDescartar)}
        onOpenChange={(aberto) => (aberto ? null : setParaDescartar(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar orçamento #{paraDescartar?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele sai da lista e não poderá mais gerar uma OS. Nada de estoque ou financeiro é
              afetado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={descartando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                void confirmarDescarte();
              }}
              disabled={descartando}
            >
              {descartando ? "Descartando..." : "Descartar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default OrcamentosLista;
