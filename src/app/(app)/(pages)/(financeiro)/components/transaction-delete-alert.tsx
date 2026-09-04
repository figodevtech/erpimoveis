"use client";

import { useState, type ReactNode } from "react";
import { Ban, Loader2, TriangleAlert } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ImpactTarget = { tipo: "OS" | "VENDA"; id: number };
type Bloqueio = { bloqueado: true; motivo: string; quantidade?: number };
/** Título liquidado: não sai enquanto o pagamento existir, mas dá para tirá-lo do fluxo. */
type Liquidado = {
  bloqueado: true;
  estornavel: true;
  motivo: string;
  sentido: "RECEBER" | "PAGAR";
  valorReaberto: number;
  acrescimos: number;
  /** Nunca passou pelo banco — foi perdoado, não pago. Muda o aviso do estorno. */
  abonado: boolean;
  /** Pago com a carteira do cliente: estornar devolve o crédito para ela. */
  creditoCliente: boolean;
};
/** Antecipação que pode ser desfeita: excluí-la reabre os títulos que liquidou. */
type Adiantamento = {
  bloqueado: boolean;
  motivo: string;
  quantidade?: number;
  desfaz?: boolean;
  sentido?: "RECEBER" | "PAGAR";
  titulos?: Array<{ id: number; descricao: string | null; valor: number }>;
};
/**
 * Transferência entre contas: a linha é uma das duas pernas.
 *
 * Não bloqueia nada — excluir é legítimo. O que muda é o alcance: a pessoa
 * clicou numa linha e vão embora duas, e isso ela precisa saber antes.
 */
type Transferencia = {
  id: number;
  valor: number;
  origem: string | null;
  destino: string | null;
  motivo: string;
};
type PagamentoMultiplo = {
  id: number;
  valorTotal: number;
  modo: string;
  documentos: ImpactTarget[];
  quantidadeBaixada: number;
  bloqueado: boolean;
  motivo?: string;
};

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor || 0);

/**
 * Confirmação de exclusão de transação.
 *
 * A verificação de impacto pode chegar a três respostas, e as três precisam
 * aparecer:
 *
 *   - **bloqueio**: a transação faz parte de uma antecipação e não sai;
 *   - **impacto**: a exclusão reabre uma OS ou venda já concluída;
 *   - **sem impacto**: sai sem mexer em documento nenhum.
 *
 * Havia uma quarta, invisível: quando a verificação **falhava**, o componente
 * caía no texto de "sem impacto" e o usuário confirmava achando que estava
 * verificado. Falha agora é um estado próprio, e o botão sai do caminho fácil.
 */
export function TransactionDeleteAlert({
  children,
  transactionId,
  onDelete,
  onDeleteGrupo,
  onEstornar,
}: {
  children: ReactNode;
  transactionId: number;
  onDelete: (id: number) => void;
  /** Desfazer o pagamento múltiplo inteiro, quando a linha pertence a um. */
  onDeleteGrupo?: (grupoId: number) => void;
  /**
   * Tirar do fluxo de caixa. Sem esta prop a recusa de título liquidado apenas
   * explica o motivo — é o caso das telas que listam transação sem oferecer a
   * operação, onde um botão levaria a lugar nenhum.
   */
  onEstornar?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targets, setTargets] = useState<ImpactTarget[]>([]);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [liquidado, setLiquidado] = useState<Liquidado | null>(null);
  const [adiantamento, setAdiantamento] = useState<Adiantamento | null>(null);
  const [grupo, setGrupo] = useState<PagamentoMultiplo | null>(null);
  const [transferencia, setTransferencia] = useState<Transferencia | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;

    setLoading(true);
    setTargets([]);
    setBloqueio(null);
    setLiquidado(null);
    setAdiantamento(null);
    setGrupo(null);
    setFalhou(null);

    try {
      const response = await fetch(`/api/transaction/${transactionId}/delete-impact`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFalhou(payload?.error ?? "Não foi possível verificar o impacto da exclusão.");
        return;
      }

      setTargets(Array.isArray(payload.targets) ? payload.targets : []);
      setBloqueio(payload?.adiantamento?.bloqueado ? payload.adiantamento : null);
      setLiquidado(payload?.liquidado ?? null);
      setAdiantamento(payload?.adiantamento?.desfaz ? payload.adiantamento : null);
      setGrupo(payload?.pagamentoMultiplo ?? null);
      setTransferencia(payload?.transferencia ?? null);
    } catch {
      setFalhou("Não foi possível verificar o impacto da exclusão.");
    } finally {
      setLoading(false);
    }
  }

  const hasImpact = targets.length > 0;
  // O grupo bloqueado usa o mesmo caminho do adiantamento: não há o que prosseguir.
  const travado =
    bloqueio ??
    (grupo?.bloqueado ? { bloqueado: true as const, motivo: grupo.motivo ?? "" } : null) ??
    liquidado;
  // Único bloqueio com saída na própria tela: em vez de só recusar, o diálogo
  // oferece o passo que destrava — tirar do fluxo e reabrir o título.
  const podeEstornar = Boolean(travado && liquidado && travado === liquidado && onEstornar);
  const desfazGrupo = Boolean(grupo && !grupo.bloqueado && onDeleteGrupo);

  const reabrePara = adiantamento?.sentido === "PAGAR" ? "a pagar" : "a receber";

  const titulo = podeEstornar
    ? liquidado?.abonado
      ? "Desfazer abono"
      : "Estornar pagamento liquidado"
    : travado
    ? "Esta transação não pode ser excluída"
    : falhou
      ? "Não foi possível verificar"
      : transferencia
        ? "Isto apaga as duas pernas da transferência"
        : adiantamento
        ? `Isto devolve ${adiantamento.quantidade} título(s) para ${reabrePara}`
        : desfazGrupo
          ? "Isto desfaz o pagamento inteiro"
          : hasImpact
            ? "Esta exclusão reabrirá um pagamento"
            : "Excluir transação?";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Verificando o impacto da
                  exclusão...
                </span>
              ) : podeEstornar && liquidado ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      {liquidado.abonado ? (
                        <>
                          Este título foi <strong>abonado</strong> — nunca passou pelo banco
                          nem pelo fluxo de caixa. Desfazer o abono devolve o título para{" "}
                          <strong>{liquidado.sentido === "PAGAR" ? "a pagar" : "a receber"}</strong>.
                        </>
                      ) : liquidado.creditoCliente ? (
                        <>
                          Este título foi quitado com o <strong>crédito do cliente</strong>,
                          sem passar por banco. O estorno devolve o valor para a carteira
                          dele e o título volta para{" "}
                          <strong>{liquidado.sentido === "PAGAR" ? "a pagar" : "a receber"}</strong>.
                        </>
                      ) : (
                        <>
                          Este título está liquidado e o pagamento aparece no fluxo de caixa.
                          O estorno retira a baixa do fluxo e devolve o título para{" "}
                          <strong>{liquidado.sentido === "PAGAR" ? "a pagar" : "a receber"}</strong>.
                        </>
                      )}
                    </span>
                  </span>
                  {liquidado.acrescimos > 0 ? (
                    <span className="block">
                      Os juros lançados na baixa saem junto com ela: o título reabre valendo{" "}
                      <strong>{moeda(liquidado.valorReaberto)}</strong>, sem os{" "}
                      {moeda(liquidado.acrescimos)} de acréscimo.
                    </span>
                  ) : null}
                  <span>O lançamento continuará registrado como título em aberto.</span>
                </>
              ) : travado ? (
                <span className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                  {travado.motivo}
                </span>
              ) : transferencia ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">{transferencia.motivo}</span>
                  </span>
                  <span className="block">
                    Sai da lista a saída de <strong>{transferencia.origem ?? "origem"}</strong>{" "}
                    e a entrada em <strong>{transferencia.destino ?? "destino"}</strong>, as
                    duas de {moeda(transferencia.valor)}. O saldo das duas contas volta ao que
                    era antes da transferência.
                  </span>
                  <span>Deseja realmente prosseguir? Esta ação não pode ser desfeita.</span>
                </>
              ) : adiantamento ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Esta é a antecipação que liquidou {adiantamento.quantidade} título(s).
                    Excluí-la remove o lançamento do caixa e devolve todos eles para{" "}
                    <strong>{reabrePara}</strong>, em aberto.
                  </span>
                  <span className="block">Voltam a ficar em aberto:</span>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {(adiantamento.titulos ?? []).map((titulo) => (
                      <li key={titulo.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          #{titulo.id} {titulo.descricao ?? ""}
                        </span>
                        <span className="shrink-0 tabular-nums">{moeda(titulo.valor)}</span>
                      </li>
                    ))}
                  </ul>
                  <span>Deseja realmente prosseguir? Esta ação não pode ser desfeita.</span>
                </>
              ) : desfazGrupo && grupo ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      Esta linha faz parte do pagamento múltiplo #{grupo.id}, de{" "}
                      {moeda(grupo.valorTotal)}. Excluir apaga o pagamento{" "}
                      <strong>inteiro</strong>, em {grupo.documentos.length} documento
                      {grupo.documentos.length === 1 ? "" : "s"} — não só esta parcela.
                    </span>
                  </span>
                  <span className="block">
                    Voltarão a ficar em aberto:{" "}
                    {grupo.documentos.map((documento) => `${documento.tipo} #${documento.id}`).join(", ")}.
                  </span>
                  <span>Deseja realmente prosseguir? Esta ação não pode ser desfeita.</span>
                </>
              ) : falhou ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {falhou}
                  </span>
                  <span>
                    Sem essa conferência não dá para saber se a exclusão reabre uma OS ou
                    venda. Feche e tente de novo.
                  </span>
                </>
              ) : hasImpact ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Ao excluir este pagamento, os valores serão recalculados e{" "}
                    {targets.map((target) => `${target.tipo} #${target.id}`).join(" e ")}{" "}
                    voltará para o status PAGAMENTO.
                  </span>
                  <span>Deseja realmente prosseguir? Esta ação não pode ser desfeita.</span>
                </>
              ) : (
                <span>Esta ação não pode ser desfeita e removerá a transação.</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{travado ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {/*
            Bloqueio esconde o botão em vez de desabilitá-lo: não há o que
            prosseguir, e um botão apagado convida a insistir. Falha na
            verificação apenas desabilita — o problema pode ser momentâneo.
          */}
          {podeEstornar ? (
            <AlertDialogAction onClick={() => onEstornar?.(transactionId)}>
              {liquidado?.abonado ? "Desfazer abono" : "Estornar pagamento"}
            </AlertDialogAction>
          ) : travado ? null : (
            <AlertDialogAction
              disabled={loading || Boolean(falhou)}
              onClick={() =>
                desfazGrupo && grupo ? onDeleteGrupo?.(grupo.id) : onDelete(transactionId)
              }
            >
              {desfazGrupo
                ? "Excluir o pagamento inteiro"
                : transferencia
                  ? "Excluir a transferência"
                  : adiantamento
                  ? "Excluir e reabrir os títulos"
                  : "Prosseguir"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
