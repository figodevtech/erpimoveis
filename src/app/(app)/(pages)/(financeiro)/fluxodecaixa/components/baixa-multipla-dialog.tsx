"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

import type { Banco, Transaction } from "../types";
import { Metodo_pagamento } from "../types";
import { SearchCombobox } from "./search-combobox";

/**
 * Confirmação da baixa múltipla.
 *
 * Banco, método e data são pedidos **uma vez** e valem para todas as linhas — é
 * o que torna a operação em lote útil. Plano de conta e centro de custo ficam de
 * fora de propósito: variam por transação e sobrescrevê-los em bloco apagaria
 * classificação que já estava certa.
 */
export function BaixaMultiplaDialog({
  aberto,
  setAberto,
  transacoes,
  processando,
  setProcessando,
  onConcluido,
}: {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  /** Somente as selecionadas. */
  transacoes: Transaction[];
  processando: boolean;
  setProcessando: (valor: boolean) => void;
  onConcluido: (idsBaixados: number[]) => void;
}) {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [carregandoBancos, setCarregandoBancos] = useState(false);
  const [bancoId, setBancoId] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [falhas, setFalhas] = useState<Array<{ id: number; erro: string }>>([]);

  useEffect(() => {
    if (!aberto) return;

    setFalhas([]);
    setDataPagamento(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );

    let ativo = true;
    setCarregandoBancos(true);
    axios
      .get("/api/banks")
      .then((r) => {
        if (ativo) setBancos(r.data?.data ?? []);
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível carregar os bancos.");
      })
      .finally(() => {
        if (ativo) setCarregandoBancos(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto]);

  const totalLiquido =
    transacoes.reduce((total, t) => total + Math.round(valorLiquidoEfetivo(t) * 100), 0) / 100;

  async function confirmar() {
    if (!bancoId) {
      toast.error("Selecione o banco que recebeu ou pagou.");
      return;
    }
    if (!metodo) {
      toast.error("Selecione o método de pagamento.");
      return;
    }
    if (!dataPagamento) {
      toast.error("Selecione a data do pagamento.");
      return;
    }

    setProcessando(true);
    setFalhas([]);
    try {
      const resposta = await axios.post("/api/transaction/baixar-lote", {
        ids: transacoes.map((t) => t.id),
        dataPagamento,
        bancoId: Number(bancoId),
        metodoPagamento: metodo,
      });

      const baixados: number[] = resposta.data?.data?.baixados ?? [];
      const erros: Array<{ id: number; erro: string }> = resposta.data?.data?.falhas ?? [];

      if (baixados.length) {
        toast.success(
          baixados.length === 1
            ? "1 transação baixada."
            : `${baixados.length} transações baixadas.`,
        );
      }

      // Falha parcial não fecha o dialog: o usuário precisa ver o que sobrou, e
      // o que deu certo já foi gravado — repetir tudo duplicaria baixa.
      if (erros.length) {
        setFalhas(erros);
        onConcluido(baixados);
        return;
      }

      setAberto(false);
      onConcluido(baixados);
    } catch (error) {
      const descricao = isAxiosError(error)
        ? (error.response?.data?.error ?? error.message)
        : error instanceof Error
          ? error.message
          : "Não foi possível dar baixa.";
      toast.error("Erro na baixa múltipla", { description: descricao });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(valor) => {
        if (!processando) setAberto(valor);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            Confirmar baixa múltipla
          </DialogTitle>
          <DialogDescription>
            {transacoes.length === 1
              ? "1 transação será marcada como paga."
              : `${transacoes.length} transações serão marcadas como pagas.`}{" "}
            Os dados abaixo valem para todas.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Total líquido
            </span>
            <span className="text-lg font-semibold tabular-nums text-primary">
              {formatarEmReal(totalLiquido)}
            </span>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>
              Data do pagamento <span className="text-destructive">*</span>
            </Label>
            <DatePicker
              value={dataPagamento}
              onChange={setDataPagamento}
              disabled={processando}
              placeholder="Selecione a data efetiva"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Banco / conta <span className="text-destructive">*</span>
            </Label>
            <SearchCombobox
              value={bancoId}
              onValueChange={setBancoId}
              loading={carregandoBancos}
              disabled={processando}
              placeholder="Selecione o banco"
              searchPlaceholder="Pesquisar banco ou conta..."
              emptyMessage="Nenhum banco encontrado."
              options={bancos.map((banco) => ({
                value: String(banco.id),
                label: banco.titulo,
                description: [
                  banco.tipo,
                  banco.agencia && `Ag. ${banco.agencia}`,
                  banco.contanumero && `Conta ${banco.contanumero}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="metodo-lote">
              Método de pagamento <span className="text-destructive">*</span>
            </Label>
            <Select
              value={metodo}
              onValueChange={(valor) => setMetodo(valor as Metodo_pagamento)}
              disabled={processando}
            >
              <SelectTrigger id="metodo-lote" className="w-full">
                <SelectValue placeholder="Selecione o método" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(Metodo_pagamento).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Plano de conta e centro de custo não são alterados: variam por
            transação e seriam sobrescritos em bloco.
          </p>
        </div>

        {falhas.length ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              {falhas.length === 1
                ? "1 transação não pôde ser baixada"
                : `${falhas.length} transações não puderam ser baixadas`}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {falhas.map((falha) => (
                <li key={falha.id}>
                  <span className="font-medium text-foreground">#{falha.id}</span>{" "}
                  {falha.erro}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setAberto(false)}
            disabled={processando}
          >
            {falhas.length ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
            onClick={confirmar}
            disabled={processando || !dataPagamento}
          >
            {processando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Dando baixa...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {falhas.length ? "Tentar de novo" : "Confirmar"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
