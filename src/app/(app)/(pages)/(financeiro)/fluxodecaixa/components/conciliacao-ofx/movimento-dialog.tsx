"use client";

import { useMemo, useState } from "react";
import { Ban, Check, Plus, Search, ArrowLeftRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import formatarEmReal from "@/utils/formatarEmReal";
import { ComparacaoMovimento } from "./movimento-detalhes";
import { BuscaManual } from "./busca-manual";
import { dataDaTransacao, explicacaoMatch } from "./apresentacao";
import {
  reais,
  type Decisao,
  type MovimentoAnalisado,
  type SugestaoMatch,
} from "./types";

interface Props {
  movimento: MovimentoAnalisado | null;
  decisaoAtual: Decisao | null;
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  onDecidir: (decisao: Decisao | null, sugestao?: SugestaoMatch) => void;
  onCriar: () => void;
  modoInicial?: "BUSCAR";
  bancoId: number;
  conta: string;
}

/** Escolher uma correspondência prepara a decisão. A criação usa o TransactionDialog. */
export function MovimentoDialog({
  movimento,
  decisaoAtual,
  aberto,
  setAberto,
  onDecidir,
  onCriar,
  modoInicial,
  bancoId,
  conta,
}: Props) {
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b bg-muted/20 px-5 py-4 pr-12 sm:px-6 sm:pr-12">
          <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <ArrowLeftRight className="size-3.5" />
            Conciliação bancária · Revisão
          </p>
          <DialogTitle>Correspondência do movimento</DialogTitle>
          <DialogDescription>
            Confira o extrato, compare com o ERP e escolha a correspondência.
          </DialogDescription>
        </DialogHeader>
        {aberto && movimento && (
          <FormularioDeDecisao
            key={movimento.fingerprint}
            movimento={movimento}
            decisaoAtual={decisaoAtual}
            modoInicial={modoInicial}
            bancoId={bancoId}
            conta={conta}
            onCriar={onCriar}
            onDecidir={(decisao, sugestao) => {
              onDecidir(decisao, sugestao);
              setAberto(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDeDecisao({
  movimento,
  decisaoAtual,
  onDecidir,
  onCriar,
  modoInicial,
  bancoId,
  conta,
}: Omit<Props, "aberto" | "setAberto" | "movimento"> & {
  movimento: MovimentoAnalisado;
}) {
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [escolhida, setEscolhida] = useState<number | null>(
    decisaoAtual?.transacaoId ??
      (movimento.analise.situacao === "MATCH_EXATO" ||
      movimento.analise.situacao === "MATCH_PROVAVEL"
        ? movimento.analise.sugestoes[0]?.transacaoId
        : null) ??
      null,
  );
  const [buscando, setBuscando] = useState(modoInicial === "BUSCAR");
  const [manual, setManual] = useState<SugestaoMatch | null>(null);
  const [metodo, setMetodo] = useState(
    decisaoAtual?.metodopagamento ?? movimento.metodoSugerido ?? "",
  );
  const sugestao = useMemo(
    () =>
      manual?.transacaoId === escolhida
        ? manual
        : (movimento.analise.sugestoes.find(
            (item) => item.transacaoId === escolhida,
          ) ?? null),
    [movimento, escolhida, manual],
  );
  const exigeMetodo = sugestao?.origem === "TITULO";
  const podeConfirmar =
    sugestao != null &&
    (!exigeMetodo || metodo !== "") &&
    (movimento.analise.situacao !== "REVISAO_MANUAL" || manual != null);

  function confirmar() {
    if (!podeConfirmar || !sugestao) return;
    onDecidir(
      {
        fingerprint: movimento.fingerprint,
        movimentoId: movimento.movimentoId ?? undefined,
        acao: sugestao.origem === "FLUXO" ? "VINCULAR" : "LIQUIDAR",
        transacaoId: sugestao.transacaoId,
        valor: sugestao.parcial
          ? reais(Math.abs(movimento.valorCentavos))
          : null,
        metodopagamento: exigeMetodo ? metodo : null,
        planoContaId: decisaoAtual?.planoContaId ?? null,
        centroCustoId: decisaoAtual?.centroCustoId ?? null,
      },
      sugestao,
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        <ComparacaoMovimento
          movimento={movimento}
          sugestao={sugestao}
          conta={conta}
        />
        {movimento.analise.observacao && (
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {movimento.analise.observacao}
          </p>
        )}
        {movimento.analise.sugestoes.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Escolha a transação</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                {movimento.analise.sugestoes.length}{" "}
                {movimento.analise.sugestoes.length === 1 ? "opção" : "opções"}
              </span>
            </div>
            {movimento.analise.situacao === "AMBIGUO" && !escolhida && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Selecione uma opção para comparar. Nenhuma foi escolhida
                automaticamente.
              </p>
            )}
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {movimento.analise.sugestoes.map((item) => (
                <LinhaDeSugestao
                  key={item.transacaoId}
                  sugestao={item}
                  selecionada={escolhida === item.transacaoId}
                  onSelecionar={() => {
                    setEscolhida(item.transacaoId);
                    setManual(null);
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma correspondência sugerida. Procure no ERP ou prepare uma nova
            transação.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={() => setBuscando(!buscando)}
          >
            <Search className="size-4" />
            {buscando ? "Fechar busca manual" : "Procurar manualmente"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-9 justify-start whitespace-normal text-left text-xs"
            onClick={onCriar}
          >
            <Plus className="size-4 shrink-0" />
            Criar nova transação a partir deste movimento
          </Button>
        </div>
        {buscando && (
          <BuscaManual
            movimento={movimento}
            bancoId={bancoId}
            onSelecionar={(s) => {
              setManual(s);
              setEscolhida(s.transacaoId);
              setBuscando(false);
            }}
          />
        )}
        {exigeMetodo && (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <Label htmlFor="ofx-metodo">Forma de pagamento</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger id="ofx-metodo" className="w-full">
                <SelectValue placeholder="Escolha a forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                {metodosPagamento.map((opcao) => (
                  <SelectItem key={opcao.value} value={opcao.value}>
                    {opcao.label ?? opcao.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {movimento.metodoSugerido
                ? "Sugerido pelo texto do extrato: " +
                  movimento.metodoSugerido +
                  "."
                : "O extrato não diz a forma de pagamento — escolha antes de conciliar."}
            </p>
          </div>
        )}
      </div>
      <DialogFooter className="shrink-0 gap-3 border-t bg-background px-5 py-4 sm:flex-wrap sm:justify-between sm:px-6">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              onDecidir({
                fingerprint: movimento.fingerprint,
                movimentoId: movimento.movimentoId ?? undefined,
                acao: "IGNORAR",
              })
            }
          >
            <Ban className="size-4" />
            Ignorar movimento
          </Button>
          {decisaoAtual && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onDecidir(null)}
            >
              Deixar em aberto
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <Button type="button" disabled={!podeConfirmar} onClick={confirmar}>
            <Check className="size-4" />
            Confirmar correspondência
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            Aplicada somente ao confirmar o lote.
          </p>
        </div>
      </DialogFooter>
    </div>
  );
}

function LinhaDeSugestao({
  sugestao,
  selecionada,
  onSelecionar,
}: {
  sugestao: SugestaoMatch;
  selecionada: boolean;
  onSelecionar: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selecionada}
      onClick={onSelecionar}
      className={`relative w-full rounded-xl border p-3 pl-10 text-left transition-colors hover:cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selecionada
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "bg-background"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-3 top-4 flex size-4 items-center justify-center rounded-full border ${selecionada ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
      >
        {selecionada && <Check className="size-3" />}
      </span>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {sugestao.descricao || "Sem descrição"}
          </p>
          <p className="text-xs text-muted-foreground">
            #{sugestao.transacaoId} ·{" "}
            {(
              {
                RECEITA: "Receita",
                DESPESA: "Despesa",
                DEPOSITO: "Depósito",
                SAQUE: "Saque",
              } as Record<string, string>
            )[sugestao.tipo] ?? sugestao.tipo}{" "}
            ·{" "}
            {sugestao.origem === "FLUXO"
              ? "já no fluxo de caixa"
              : "título em aberto"}
            {sugestao.contraparte ? ` · ${sugestao.contraparte}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {sugestao.origem === "FLUXO" ? "Movimentado em " : "Vence em "}
            {dataDaTransacao(sugestao.data)}
            {sugestao.diferencaEmDias > 0
              ? ` · ${sugestao.diferencaEmDias} dia${sugestao.diferencaEmDias > 1 ? "s" : ""} de diferença`
              : " · mesmo dia"}
            {sugestao.ordemservicoid ? ` · OS #${sugestao.ordemservicoid}` : ""}
            {sugestao.vendaid ? ` · Venda #${sugestao.vendaid}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">
            {formatarEmReal(reais(sugestao.valorCentavos))}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {explicacaoMatch(sugestao)}
          </p>
          {sugestao.parcial ? (
            <span className="mt-1 inline-flex rounded-sm border border-amber-600/40 bg-amber-600/10 px-1.5 py-px text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
              Baixa parcial
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
