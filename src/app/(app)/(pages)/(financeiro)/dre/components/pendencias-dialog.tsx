"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import TransactionDialog from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { ItemPendencia, PendenciaDre, PeriodoDre } from "../types";
import { ClassificarCadastroDialog, type AlvoClassificacao } from "./classificar-cadastro-dialog";
import { CorrigirCustoDialog } from "./corrigir-custo-dialog";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

/**
 * Motivos que descrevem estado legítimo ou situação sem conserto automático.
 * A lista continua valendo — saber *quais* já é metade da pergunta —, mas não há
 * botão: oferecer um que não resolve nada é pior que não oferecer.
 */
const SEM_CORRECAO = new Set(["EVENTO_OS_EM_ABERTO", "EVENTO_SEM_FONTE", "EVENTO_SEM_COMPETENCIA"]);

const EXPLICACAO: Record<string, string> = {
  EVENTO_OS_EM_ABERTO:
    "A competência é carimbada quando a execução da OS encerra. Estes lançamentos entram na DRE do mês em que o serviço terminar — não há o que corrigir aqui.",
  EVENTO_SEM_FONTE:
    "Sem documento de origem não há de onde herdar a competência, e nenhuma ação nesta tela resolve. Estes casos precisam de análise no banco.",
  EVENTO_SEM_COMPETENCIA:
    "A OS já encerrou, mas o lançamento ficou sem competência. Corrigir exige reabrir o período, o que reescreveria um mês possivelmente fechado.",
};

/**
 * Lista os itens de uma pendência e leva cada um ao formulário que o resolve.
 *
 * A fila já sabia quais eram os itens desde que `dre_pendencias_itens` existe —
 * o que faltava era alguém perguntar. Sem esta porta, "108 contas sem
 * classificação" obriga o usuário a adivinhar em que tela mexer, e o aviso vira
 * paisagem.
 */
export function PendenciasDialog({
  pendencia,
  periodo,
  emLegado,
  onFechar,
  onCorrigido,
}: {
  pendencia: PendenciaDre | null;
  periodo: PeriodoDre;
  emLegado: boolean;
  onFechar: () => void;
  /** Dispara o recarregamento da DRE: o total e a tarja acompanham na hora. */
  onCorrigido: () => void;
}) {
  const { data: session } = useSession();
  const podeEditarEstoque = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ESTOQUE_EDITAR,
  );

  const motivo = pendencia?.motivo ?? "";
  const chave = pendencia ? `${motivo}|${periodo.de}|${periodo.ate}` : "";
  const [resultado, setResultado] = useState<{ chave: string; itens: ItemPendencia[] }>({
    chave: "",
    itens: [],
  });
  const [recarregar, setRecarregar] = useState(0);

  const [custoAberto, setCustoAberto] = useState<number | null>(null);
  const [cadastroAberto, setCadastroAberto] = useState<AlvoClassificacao>(null);
  const [transacaoAberta, setTransacaoAberta] = useState<number | undefined>(undefined);

  const carregando = !!pendencia && resultado.chave !== chave;
  const itens = carregando ? null : resultado.itens;

  useEffect(() => {
    if (!pendencia) return;
    const controller = new AbortController();

    fetch(
      `/api/dre/pendencias?motivo=${encodeURIComponent(motivo)}&de=${periodo.de}&ate=${periodo.ate}&limite=200`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((r) => r.json())
      .then((corpo: { itens?: ItemPendencia[] }) => {
        if (controller.signal.aborted) return;
        setResultado({ chave, itens: corpo.itens ?? [] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResultado({ chave, itens: [] });
      });

    return () => controller.abort();
  }, [chave, motivo, pendencia, periodo.ate, periodo.de, recarregar]);

  /** Depois de gravar, a lista e a DRE precisam refletir o que mudou. */
  const apósCorrigir = useCallback(() => {
    setResultado((atual) => ({ ...atual, chave: "" }));
    setRecarregar((n) => n + 1);
    onCorrigido();
  }, [onCorrigido]);

  function abrirCorrecao(item: ItemPendencia) {
    if (motivo === "ITEM_SEM_CUSTO") {
      setCustoAberto(item.referencia_id);
      return;
    }
    if (item.referencia_tipo === "CONTA" || item.referencia_tipo === "GRUPO") {
      setCadastroAberto({
        tipo: item.referencia_tipo,
        id: item.referencia_id,
        nome: item.descricao ?? item.conta ?? item.grupo ?? `#${item.referencia_id}`,
      });
      return;
    }
    if (item.referencia_tipo === "TRANSACAO") {
      setTransacaoAberta(item.referencia_id);
    }
  }

  const temCorrecao = !SEM_CORRECAO.has(motivo);

  return (
    <>
      <Dialog open={!!pendencia} onOpenChange={(aberto) => !aberto && onFechar()}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{pendencia?.descricao}</DialogTitle>
            <DialogDescription>
              {pendencia?.escopo === "CADASTRO"
                ? "Pendência de cadastro — não depende do período."
                : pendencia?.escopo === "GERAL"
                  ? "Vale para toda a base, não só para o período exibido."
                  : `${periodo.de} a ${periodo.ate}`}
              {" · "}
              {pendencia?.quantidade ?? 0} item(ns)
            </DialogDescription>
          </DialogHeader>

          {EXPLICACAO[motivo] && (
            <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              {EXPLICACAO[motivo]}
            </p>
          )}

          <div className="max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Competência</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-40">Onde</TableHead>
                  <TableHead className="w-28 text-right">Valor</TableHead>
                  {temCorrecao && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!itens ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: temCorrecao ? 5 : 4 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : itens.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={temCorrecao ? 5 : 4}
                      className="h-24 text-center text-sm text-muted-foreground"
                    >
                      Nada pendente aqui.
                    </TableCell>
                  </TableRow>
                ) : (
                  itens.map((item) => (
                    <TableRow key={`${item.referencia_tipo}-${item.referencia_id}`}>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {item.competencia ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.descricao ?? `#${item.referencia_id}`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[item.grupo, item.conta].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.valor === null ? "—" : brl(item.valor)}
                      </TableCell>
                      {temCorrecao && (
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => abrirCorrecao(item)}>
                            Corrigir
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <CorrigirCustoDialog
        eventoId={custoAberto}
        podeEditarEstoque={podeEditarEstoque}
        onFechar={() => setCustoAberto(null)}
        onCorrigido={apósCorrigir}
      />

      <ClassificarCadastroDialog
        alvo={cadastroAberto}
        emLegado={emLegado}
        onFechar={() => setCadastroAberto(null)}
        onClassificado={apósCorrigir}
      />

      {/* O formulário do financeiro, com a transação já carregada — o mesmo que
          o usuário usa no fluxo de caixa, para não aprender outro aqui. */}
      <TransactionDialog
        open={transacaoAberta !== undefined}
        setOpen={(aberto) => !aberto && setTransacaoAberta(undefined)}
        selectedTransactionId={transacaoAberta}
        setSelectedTransactionId={setTransacaoAberta}
        editable
        handleGetTransactions={apósCorrigir}
      />
    </>
  );
}
