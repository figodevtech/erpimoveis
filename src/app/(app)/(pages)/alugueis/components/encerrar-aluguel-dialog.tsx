"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Loader2, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ROTULO_TIPO_ITEM_ALUGUEL, hojeAluguel } from "@/lib/alugueis/status";
import { fmtData } from "./status-aluguel";
import { avisarAlteracaoAlugueis, encerrarAluguel } from "../lib/api";
import type { AluguelLista } from "../types";
import { nomeDoCliente } from "../types";

const TEM_SALDO = new Set(["PRODUTO", "USOCONSUMO", "GERAL"]);

/**
 * Encerrar pergunta quanto de cada item voltou (padrão: tudo). O que voltou
 * entra no estoque; a falta de item de estoque segue fora, ligada ao aluguel.
 * O checklist de retorno é liberado nas ações do aluguel depois do
 * encerramento, como o checklist da OS.
 */
export function EncerrarAluguelDialog({
  aluguel,
  onOpenChange,
}: {
  aluguel: AluguelLista | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(aluguel);
  const [dataRetorno, setDataRetorno] = useState(hojeAluguel());
  const [observacao, setObservacao] = useState("");
  // Texto do campo por item: deixa apagar e redigitar sem virar 0 no meio.
  const [voltou, setVoltou] = useState<Record<number, string>>({});
  const [salvando, setSalvando] = useState(false);

  const itens = useMemo(() => aluguel?.itens ?? [], [aluguel]);

  useEffect(() => {
    if (!open) return;
    setDataRetorno(hojeAluguel());
    setObservacao("");
    setVoltou(Object.fromEntries(itens.map((item) => [item.id, String(item.quantidade)])));
  }, [open, itens]);

  // O retorno vai do início até hoje; agendado (início no futuro) encerra hoje.
  const hoje = hojeAluguel();
  const minimo = aluguel ? (aluguel.data_inicio < hoje ? aluguel.data_inicio : hoje) : undefined;

  const linhas = itens.map((item) => {
    const texto = voltou[item.id] ?? String(item.quantidade);
    const quantidade = texto.trim() === "" ? NaN : Number(texto);
    const valido = Number.isInteger(quantidade) && quantidade >= 0 && quantidade <= item.quantidade;
    const falta = valido ? item.quantidade - quantidade : 0;
    return { item, texto, quantidade, valido, falta, temSaldo: TEM_SALDO.has(item.tipo) };
  });
  const faltas = linhas.filter((linha) => linha.valido && linha.falta > 0);
  const faltasDeEstoque = faltas.filter((linha) => linha.temSaldo);

  function definir(id: number, valor: string) {
    setVoltou((atual) => ({ ...atual, [id]: valor }));
  }

  async function confirmar() {
    if (!aluguel) return;
    if (!dataRetorno) {
      toast.error("Informe a data do retorno.");
      return;
    }
    if (dataRetorno > hojeAluguel()) {
      toast.error("A data de retorno não pode estar no futuro.");
      return;
    }
    if (minimo && dataRetorno < minimo) {
      toast.error(`A data de retorno não pode ser anterior ao início do aluguel (${fmtData(minimo)}).`);
      return;
    }
    const invalida = linhas.find((linha) => !linha.valido);
    if (invalida) {
      toast.error(`Retorno de "${invalida.item.descricao}": informe de 0 a ${invalida.item.quantidade}.`);
      return;
    }
    setSalvando(true);
    try {
      // Retorno hoje grava o instante exato; dia anterior fica ao meio-dia de Fortaleza.
      const encerradoEm = dataRetorno === hojeAluguel() ? undefined : `${dataRetorno}T12:00:00-03:00`;
      await encerrarAluguel(aluguel.id, {
        encerradoEm,
        observacao: observacao.trim() || undefined,
        itens: linhas.map((linha) => ({ id: linha.item.id, quantidadeDevolvida: linha.quantidade })),
      });
      toast.success(`Aluguel #${aluguel.id} encerrado. O checklist de retorno já está nas ações do aluguel.`);
      avisarAlteracaoAlugueis();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Falha ao encerrar aluguel.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(valor) => !salvando && onOpenChange(valor)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Encerrar aluguel #{aluguel?.id}
          </DialogTitle>
          <DialogDescription>{aluguel ? nomeDoCliente(aluguel) : null}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data do retorno</Label>
              <Input type="date" value={dataRetorno} min={minimo} max={hoje} onChange={(e) => setDataRetorno(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <Label>O que retornou</Label>
                <p className="text-xs text-muted-foreground">Ajuste a quantidade do que não voltou inteiro.</p>
              </div>
              {faltas.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={salvando}
                  onClick={() => setVoltou(Object.fromEntries(itens.map((item) => [item.id, String(item.quantidade)])))}
                >
                  Tudo retornou
                </Button>
              ) : null}
            </div>

            <div className="divide-y rounded-md border">
              {linhas.map(({ item, texto, valido, falta, temSaldo }) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {ROTULO_TIPO_ITEM_ALUGUEL[item.tipo]}
                      </Badge>
                      <span className="truncate text-sm font-medium" title={item.descricao}>
                        {item.descricao}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 text-xs text-muted-foreground",
                        !valido && "text-red-600",
                        valido && falta > 0 && "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {!valido
                        ? `Informe de 0 a ${item.quantidade}.`
                        : falta > 0
                          ? `${falta} não ${falta === 1 ? "retornou" : "retornaram"}${temSaldo ? " · fica fora do estoque" : ""}`
                          : temSaldo
                            ? "Volta inteiro ao estoque"
                            : item.identificacao || "Sem saldo de estoque"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={item.quantidade}
                      step={1}
                      aria-label={`Quantidade de ${item.descricao} que retornou`}
                      className={cn("h-9 w-20 text-right tabular-nums", !valido && "border-red-500")}
                      value={texto}
                      disabled={salvando}
                      onChange={(e) => definir(item.id, e.target.value)}
                    />
                    <span className="w-12 text-xs text-muted-foreground tabular-nums">de {item.quantidade}</span>
                  </div>
                </div>
              ))}
            </div>

            {faltasDeEstoque.length ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  O que não retornou continua fora do estoque, numa saída ligada a este aluguel:{" "}
                  {faltasDeEstoque.map((linha) => `${linha.falta}× ${linha.item.descricao}`).join(", ")}. Excluir o aluguel depois
                  devolve tudo.
                </span>
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Observação (opcional)</Label>
            <Textarea
              rows={3}
              maxLength={1000}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder={faltas.length ? "O que aconteceu com o que não voltou..." : "Condição do bem, pendências..."}
            />
          </div>

          <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            O checklist de retorno fica disponível nas ações do aluguel assim que ele for encerrado.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Encerrar aluguel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
