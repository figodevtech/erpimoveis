"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import formatarEmReal from "@/utils/formatarEmReal";
import type {
  Decisao,
  MovimentoAnalisado,
  ResultadoConciliacao,
} from "./types";
import { descricaoMovimento } from "./apresentacao";

const rotulos = {
  VINCULAR: "Vínculos com transações existentes",
  LIQUIDAR: "Títulos a liquidar",
  CRIAR: "Novas transações",
  IGNORAR: "Movimentos a ignorar",
};

export function ConciliacaoConfirmacao({
  aberto,
  onAberto,
  decisoes,
  linhas,
  conta,
  arquivo,
  novaImportacao,
  ocupado,
  onConfirmar,
  erro,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  decisoes: Decisao[];
  linhas: MovimentoAnalisado[];
  conta: string;
  arquivo: string;
  novaImportacao: boolean;
  ocupado: boolean;
  onConfirmar: () => void;
  erro: string | null;
}) {
  const contagens = { VINCULAR: 0, LIQUIDAR: 0, CRIAR: 0, IGNORAR: 0 };
  const porChave = new Map(decisoes.map((d) => [d.fingerprint, d]));
  for (const d of decisoes) contagens[d.acao]++;
  const financeiras = linhas.filter(
    (m) => porChave.get(m.fingerprint)?.acao !== "IGNORAR",
  );
  const entradas = financeiras.reduce(
    (s, m) => s + Math.max(0, m.valorCentavos),
    0,
  );
  const saidas = financeiras.reduce(
    (s, m) => s + Math.max(0, -m.valorCentavos),
    0,
  );
  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!ocupado) onAberto(v);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        showCloseButton={!ocupado}
      >
        <DialogHeader>
          <DialogTitle>
            {decisoes.length
              ? "Confirmar conciliação"
              : "Importar para conciliar depois"}
          </DialogTitle>
          <DialogDescription>
            Confira as ações antes de alterar o financeiro.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="font-medium">{conta}</p>
          <p className="break-all text-xs text-muted-foreground">{arquivo}</p>
        </div>
        <dl className="space-y-3 text-sm">
          {Object.entries(contagens).map(([acao, quantidade]) => (
            <div key={acao} className="flex justify-between gap-3">
              <dt>{rotulos[acao as Decisao["acao"]]}</dt>
              <dd className="font-semibold tabular-nums">{quantidade}</dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">
              Entradas selecionadas
            </p>
            <p className="font-semibold tabular-nums">
              {formatarEmReal(entradas / 100)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saídas selecionadas</p>
            <p className="font-semibold tabular-nums">
              {formatarEmReal(saidas / 100)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Os totais excluem os movimentos a ignorar. Vincular uma transação
          existente não cria outro lançamento.
          {novaImportacao
            ? " Os movimentos não selecionados serão registrados para resolver depois."
            : " Os movimentos não selecionados permanecem como estão."}
        </p>
        {decisoes.some((d) => d.acao === "LIQUIDAR" && d.valor) && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            A seleção inclui baixa parcial. O restante do título continuará em
            aberto.
          </p>
        )}
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() => onAberto(false)}
          >
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={onConfirmar}>
            {ocupado && <Loader2 className="size-4 animate-spin" />}
            {ocupado
              ? "Processando movimentos…"
              : decisoes.length
                ? "Confirmar conciliação"
                : "Confirmar importação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConciliacaoResultado({
  resultado: r,
  movimentos,
  onContinuar,
  onFluxo,
}: {
  resultado: ResultadoConciliacao | null;
  movimentos: MovimentoAnalisado[];
  onContinuar: () => void;
  onFluxo: () => void;
}) {
  if (!r) return null;
  const contagens = { VINCULAR: 0, LIQUIDAR: 0, CRIAR: 0, IGNORAR: 0 };
  const porChave = new Map(movimentos.map((m) => [m.fingerprint, m]));
  const porId = new Map(movimentos.map((m) => [m.movimentoId, m]));
  for (const item of r.resultados) if (item.ok) contagens[item.acao]++;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onContinuar();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {r.falhas.length
              ? "Conciliação com pendências"
              : r.resultados.length
                ? "Conciliação concluída"
                : "Extrato importado"}
          </DialogTitle>
          <DialogDescription>
            {r.conciliados} movimentos processados com sucesso.
            {r.falhas.length > 0
              ? ` ${r.falhas.length} não puderam ser processados.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["VINCULAR", "Vinculados"],
              ["LIQUIDAR", "Títulos liquidados"],
              ["CRIAR", "Transações criadas"],
              ["IGNORAR", "Ignorados"],
            ] as const
          ).map(([acao, texto]) => (
            <div key={acao} className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{texto}</p>
              <p className="text-xl font-semibold">{contagens[acao]}</p>
            </div>
          ))}
        </div>
        {r.quantidadeImportados != null && (
          <p className="text-xs text-muted-foreground">
            {r.quantidadeImportados} movimentos novos registrados ·{" "}
            {r.quantidadeRepetidos ?? 0} já conhecidos. Movimentos repetidos
            permanecem nas importações de origem.
          </p>
        )}
        {r.falhas.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Revise estes movimentos</p>
            {r.falhas.map((f, i) => {
              const m =
                (f.fingerprint ? porChave.get(f.fingerprint) : null) ??
                porId.get(f.movimentoId);
              return (
                <div
                  key={`${f.movimentoId}-${i}`}
                  className="rounded-lg border border-destructive/30 p-3 text-sm"
                >
                  <p className="font-medium">
                    {m
                      ? `${descricaoMovimento(m).titulo} · ${formatarEmReal(Math.abs(m.valorCentavos) / 100)}`
                      : `Movimento ${f.movimentoId || i + 1}`}
                  </p>
                  <p className="mt-1 text-xs text-destructive">{f.erro}</p>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              As ações bem-sucedidas já foram aplicadas. Cada movimento com
              falha continua disponível para revisão.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFluxo}>
            Ver Fluxo de Caixa
          </Button>
          <Button onClick={onContinuar}>Continuar conciliando</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
