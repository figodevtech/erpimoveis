"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { FileText, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarDia, mensagemDeErro } from "./apresentacao";
import type { ImportacaoResumida } from "./types";

export function HistoricoImportacoes({
  onAbrirPendencias,
  onImportar,
  bancos,
}: {
  onAbrirPendencias: (id: number) => void;
  onImportar: () => void;
  bancos: { id: number; titulo: string }[];
}) {
  const [pagina, setPagina] = useState(1);
  const [bancoId, setBancoId] = useState("TODOS");
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<{
    carregando: boolean;
    erro: string | null;
    items: ImportacaoResumida[];
    paginas: number;
  }>({ carregando: true, erro: null, items: [], paginas: 1 });
  useEffect(() => {
    const controller = new AbortController();
    axios
      .get<{ data: ImportacaoResumida[]; pagination: { totalPages: number } }>(
        "/api/financeiro/conciliacao/ofx",
        {
          params: {
            page: pagina,
            limit: 20,
            bancoId: bancoId === "TODOS" ? undefined : bancoId,
          },
          signal: controller.signal,
        },
      )
      .then((res) => {
        if (!controller.signal.aborted)
          setEstado({
            carregando: false,
            erro: null,
            items: res.data.data,
            paginas: Math.max(1, res.data.pagination.totalPages),
          });
      })
      .catch((e) => {
        if (!axios.isCancel(e))
          setEstado({
            carregando: false,
            erro: mensagemDeErro(
              e,
              "Não foi possível carregar as importações.",
            ),
            items: [],
            paginas: 1,
          });
      });
    return () => controller.abort();
  }, [pagina, bancoId, tentativa]);
  function carregando() {
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
  }
  function progresso(i: ImportacaoResumida) {
    const resolvidos = i.situacoes.conciliados + i.situacoes.ignorados;
    const total = resolvidos + i.situacoes.pendentes;
    return (
      <div className="min-w-28 space-y-1">
        <p className="text-xs">
          {resolvidos} resolvidos · {i.situacoes.pendentes} pendentes
        </p>
        <Progress
          aria-label={`Progresso de ${i.arquivo_nome}`}
          value={total ? (resolvidos / total) * 100 : 100}
          className="h-1.5"
        />
        <p className="text-[10px] text-muted-foreground">
          {i.situacoes.ignorados} ignorados incluídos
        </p>
      </div>
    );
  }
  function status(i: ImportacaoResumida) {
    return (
      <Badge
        variant="outline"
        className={
          i.situacoes.pendentes
            ? "text-amber-700 dark:text-amber-300"
            : "text-emerald-700 dark:text-emerald-300"
        }
      >
        {i.situacoes.pendentes ? "Em andamento" : "Concluída"}
      </Badge>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Histórico de importações</h3>
          <p className="text-xs text-muted-foreground">
            Retome uma conciliação ou consulte os movimentos resolvidos.
          </p>
        </div>
        <Select
          value={bancoId}
          onValueChange={(id) => {
            carregando();
            setBancoId(id);
            setPagina(1);
          }}
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label="Filtrar histórico por conta"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todas as contas</SelectItem>
            {bancos.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {estado.carregando ? (
        <div role="status" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Carregando importações…
          </p>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : estado.erro ? (
        <div role="alert" className="rounded-lg border p-5">
          <p className="text-sm text-destructive">{estado.erro}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              carregando();
              setTentativa((n) => n + 1);
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : !estado.items.length ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <History className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nenhuma conciliação bancária encontrada</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Importe um arquivo OFX para comparar seu extrato bancário com o
            financeiro do ERP.
          </p>
          <Button className="mt-4" onClick={onImportar}>
            Importar OFX
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden rounded-lg border md:block">
            <Table className="text-xs">
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Arquivo / Conta</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Movimentos</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Importado em / Usuário</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estado.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="max-w-60">
                      <button
                        className="block w-full text-left hover:underline"
                        onClick={() => onAbrirPendencias(i.id)}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{i.arquivo_nome}</span>
                        </span>
                      </button>
                      <p className="mt-1 truncate text-muted-foreground">
                        {i.banco?.titulo ?? "Conta removida"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {formatarDia(i.periodo_inicio)}
                      <br />
                      {formatarDia(i.periodo_fim)}
                    </TableCell>
                    <TableCell>
                      {i.quantidade_importados} novos
                      {i.quantidade_repetidos > 0 && (
                        <p className="text-muted-foreground">
                          {i.quantidade_repetidos} já conhecidos
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{progresso(i)}</TableCell>
                    <TableCell>{status(i)}</TableCell>
                    <TableCell>
                      {new Date(i.created_at).toLocaleDateString("pt-BR")}
                      <p className="text-muted-foreground">
                        {i.usuario ?? "Usuário não informado"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onAbrirPendencias(i.id)}
                      >
                        {i.situacoes.pendentes
                          ? "Continuar"
                          : "Ver conciliação"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {estado.items.map((i) => (
              <div key={i.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all text-sm font-medium">
                    {i.arquivo_nome}
                  </p>
                  {status(i)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {i.banco?.titulo ?? "Conta removida"} ·{" "}
                  {formatarDia(i.periodo_inicio)} → {formatarDia(i.periodo_fim)}
                </p>
                {progresso(i)}
                <p className="text-xs text-muted-foreground">
                  {i.quantidade_importados} novos · {i.quantidade_repetidos} já
                  conhecidos
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(i.created_at).toLocaleDateString("pt-BR")} ·{" "}
                  {i.usuario ?? "Usuário não informado"}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => onAbrirPendencias(i.id)}
                >
                  {i.situacoes.pendentes
                    ? "Continuar conciliação"
                    : "Ver conciliação"}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Página {pagina} de {estado.paginas}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pagina === 1}
                onClick={() => {
                  carregando();
                  setPagina((p) => p - 1);
                }}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pagina === estado.paginas}
                onClick={() => {
                  carregando();
                  setPagina((p) => p + 1);
                }}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
