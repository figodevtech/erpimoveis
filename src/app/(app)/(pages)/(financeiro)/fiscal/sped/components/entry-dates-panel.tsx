"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";

import { confirmarDatasFiscaisDeEntrada, listEntradasSemDataFiscal } from "../api";
import { formatCivilDate, formatCurrency, formatInteger, formatTimestamp } from "../formatters";
import type { SpedEntradaDataFiscalPendente } from "../types";

type Entrada = SpedEntradaDataFiscalPendente;

function notaLabel(entrada: Entrada) {
  if (entrada.numeroNota) return entrada.serieNota ? `${entrada.numeroNota}/${entrada.serieNota}` : entrada.numeroNota;
  return entrada.chave ? `…${entrada.chave.slice(-8)}` : `Entrada ${entrada.id}`;
}

/**
 * Entrada fiscal sem data de escrituração não entra em competência nenhuma e
 * bloqueia todas. A data é a da entrada da mercadoria; os atalhos só preenchem,
 * quem confirma é o usuário.
 */
export function EntryDatesPanel({ canManage, revision, onConfirmed }: {
  canManage: boolean;
  revision: number;
  onConfirmed: () => void;
}) {
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listEntradasSemDataFiscal(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setEntradas(items);
        setDates(Object.fromEntries(items.map((item) => [item.id, item.dataSugerida ?? ""])));
        setSelected(new Set());
      })
      .catch(() => {
        // O painel é auxiliar: a validação da competência continua acusando as entradas.
        if (!controller.signal.aborted) setEntradas([]);
      });
    return () => controller.abort();
  }, [revision, reload]);

  const selectedRows = useMemo(() => entradas.filter((item) => selected.has(item.id)), [entradas, selected]);
  const prontas = selectedRows.filter((item) => dates[item.id]);
  const anteriores = prontas.filter((item) => item.dataEmissao && dates[item.id] < item.dataEmissao);
  const allSelected = entradas.length > 0 && selected.size === entradas.length;

  if (entradas.length === 0) return null;

  function applyShortcut(pick: (item: Entrada) => string | null) {
    setDates((current) => {
      const next = { ...current };
      for (const item of selectedRows) {
        const value = pick(item);
        if (value) next[item.id] = value;
      }
      return next;
    });
  }

  async function confirm() {
    if (!prontas.length || anteriores.length || busy) return;
    setBusy(true);
    try {
      const response = await confirmarDatasFiscaisDeEntrada(
        prontas.map((item) => ({ id: item.id, dataEntradaFiscal: dates[item.id] })),
      );
      toast.success(`${formatInteger(response.data.atualizadas)} data(s) fiscal(is) confirmada(s).`);
      setReload((value) => value + 1);
      onConfirmed();
      if (prontas.length === entradas.length) setOpen(false);
    } catch (error) {
      toast.error("Não foi possível confirmar as datas", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Alert>
        <CalendarClock aria-hidden="true" />
        <AlertTitle>
          {formatInteger(entradas.length)} entrada(s) fiscal(is) sem data de escrituração confirmada
        </AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Enquanto houver entrada sem data confirmada, nenhuma competência pode ser fechada.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            {canManage ? "Confirmar datas" : "Ver entradas"}
          </Button>
        </AlertDescription>
      </Alert>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-h-[90vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Datas fiscais de entrada</DialogTitle>
            <DialogDescription>
              Informe a data em que a mercadoria entrou no estabelecimento. Ela define em qual competência a nota é escriturada.
            </DialogDescription>
          </DialogHeader>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{formatInteger(selected.size)} selecionada(s):</span>
              <Button type="button" size="sm" variant="outline" disabled={!selected.size || busy}
                onClick={() => applyShortcut((item) => item.dataEmissao)}>
                Usar data de emissão
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!selected.size || busy}
                onClick={() => applyShortcut((item) => item.dataLancamentoCivil)}>
                Usar data do lançamento
              </Button>
            </div>
          ) : null}

          <div className="max-h-[55vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage ? (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Selecionar todas"
                        checked={allSelected}
                        onCheckedChange={(checked) => setSelected(checked ? new Set(entradas.map((item) => item.id)) : new Set())}
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Nota</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Lançada no ERP</TableHead>
                  <TableHead className="w-44">Data fiscal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entradas.map((item) => {
                  const value = dates[item.id] ?? "";
                  const beforeEmission = Boolean(value && item.dataEmissao && value < item.dataEmissao);
                  return (
                    <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                      {canManage ? (
                        <TableCell>
                          <Checkbox
                            aria-label={`Selecionar nota ${notaLabel(item)}`}
                            checked={selected.has(item.id)}
                            onCheckedChange={(checked) => setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className="font-medium tabular-nums">{notaLabel(item)}</TableCell>
                      <TableCell className="max-w-56 truncate" title={item.fornecedor ?? undefined}>{item.fornecedor ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(item.valorTotal)}</TableCell>
                      <TableCell className="tabular-nums">{formatCivilDate(item.dataEmissao)}</TableCell>
                      <TableCell className="tabular-nums">{formatTimestamp(item.dataLancamento)}</TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={value}
                          disabled={!canManage || busy}
                          aria-invalid={beforeEmission || undefined}
                          aria-label={`Data fiscal da nota ${notaLabel(item)}`}
                          onChange={(event) => {
                            const next = event.target.value;
                            setDates((current) => ({ ...current, [item.id]: next }));
                            if (next) setSelected((current) => new Set(current).add(item.id));
                          }}
                        />
                        {beforeEmission ? <p className="mt-1 text-xs text-destructive">Anterior à emissão</p> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {anteriores.length
                ? "Há data fiscal anterior à emissão da nota. Corrija antes de confirmar."
                : selectedRows.length > prontas.length
                  ? `${formatInteger(selectedRows.length - prontas.length)} selecionada(s) sem data ficarão pendentes.`
                  : "A confirmação fica registrada com seu usuário e horário."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Fechar</Button>
              {canManage ? (
                <Button type="button" disabled={!prontas.length || anteriores.length > 0 || busy} onClick={() => void confirm()}>
                  {busy ? "Confirmando..." : `Confirmar ${formatInteger(prontas.length)} data(s)`}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
