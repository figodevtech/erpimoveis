"use client";

import { useEffect, useState } from "react";

import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import axios, { isAxiosError } from "axios";
import { CheckCircle2, Loader2 } from "lucide-react";

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
import { formatDate } from "@/utils/formatDate";
import formatarEmReal from "@/utils/formatarEmReal";

import { useCentrosCusto } from "../hooks/use-centros-custo";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";
import type { Banco, Transaction } from "../types";
import { Metodo_pagamento } from "../types";
import { PlanoContaCombobox } from "./plano-conta-combobox";
import { SearchCombobox } from "./search-combobox";

interface ConcluidoAlertProps {
  isAlertOpen: boolean;
  setIsAlertOpen: (value: boolean) => void;
  transaction: Transaction | null;
  onSuccess?: () => void;
}

export default function ConcluidoAlert({
  isAlertOpen,
  setIsAlertOpen,
  transaction,
  onSuccess,
}: ConcluidoAlertProps) {
  const [banks, setBanks] = useState<Banco[]>([]);
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">("");
  const [selectedPlanoId, setSelectedPlanoId] = useState("");
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");

  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();

  useEffect(() => {
    if (!isAlertOpen || !transaction) return;

    setSelectedBankId(transaction.banco_id ? String(transaction.banco_id) : "");
    setSelectedMetodo(transaction.metodopagamento || "");
    setSelectedPlanoId(transaction.plano_de_conta_id ? String(transaction.plano_de_conta_id) : "");
    setSelectedCentroCustoId(transaction.centro_custo_id ? String(transaction.centro_custo_id) : "");
    setDataPagamento(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  }, [isAlertOpen, transaction]);

  useEffect(() => {
    if (!isAlertOpen) return;

    let active = true;

    async function fetchBanks() {
      setIsLoadingBanks(true);
      setBankLoadError(null);

      try {
        const response = await axios.get("/api/banks");
        if (active) setBanks(response.data.data ?? []);
      } catch (error) {
        console.error("Erro ao carregar bancos:", error);
        if (active) {
          setBanks([]);
          setBankLoadError("Não foi possível carregar os bancos.");
        }
      } finally {
        if (active) setIsLoadingBanks(false);
      }
    }

    void fetchBanks();

    return () => {
      active = false;
    };
  }, [isAlertOpen]);

  async function handleConfirmarPagamento() {
    if (!transaction || isSubmitting) return;

    if (!selectedBankId) {
      toast.error("Selecione um banco para concluir a transação.");
      return;
    }

    if (!selectedMetodo) {
      toast.error("Selecione o método de pagamento para concluir a transação.");
      return;
    }

    if (!dataPagamento) {
      toast.error("Selecione a data efetiva do pagamento.");
      return;
    }

    try {
      setIsSubmitting(true);

      await axios.post(`/api/transaction/${transaction.id}/baixar`, {
        dataPagamento,
        bancoId: Number(selectedBankId),
        metodoPagamento: selectedMetodo,
        planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
        centroCustoId: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
      });

      toast.success("Transação concluída com sucesso!");
      setIsAlertOpen(false);
      onSuccess?.();
    } catch (error) {
      const description = isAxiosError(error)
        ? (error.response?.data?.error ?? error.message)
        : error instanceof Error
          ? error.message
          : "Não foi possível concluir a transação.";

      toast.error("Erro ao concluir a transação", { description });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!transaction) return null;

  const bruto = Number(transaction.valor ?? 0);
  const liquido = valorLiquidoEfetivo(transaction);
  const acrescimos = Number(transaction.valor_acrescimos ?? 0);
  const descontos = Number(transaction.valor_descontos ?? 0);
  // Sem acréscimo nem desconto, bruto e líquido são o mesmo número: repetir os
  // dois seria ruído.
  const temComposicao =
    Math.round(bruto * 100) !== Math.round(liquido * 100) ||
    acrescimos > 0 ||
    descontos > 0;

  return (
    <Dialog
      open={isAlertOpen}
      onOpenChange={(open) => {
        if (!isSubmitting) setIsAlertOpen(open);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            Concluir transação
          </DialogTitle>
          <DialogDescription>
            Confirme os dados financeiros para dar baixa nesta transação.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border bg-card p-4" aria-label="Resumo da transação">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Transação #{transaction.id}
              </p>
              <p className="mt-1 break-words text-sm font-medium text-foreground">
                {transaction.descricao}
              </p>
            </div>
            {/*
              O que importa na baixa é quanto entra na conta, não quanto foi
              cobrado: é o líquido que bate com o extrato do banco. O bruto e a
              composição ficam abaixo, menores, para conferência.
            */}
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold text-primary">
                {formatarEmReal(liquido)}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Entra na conta
              </p>
            </div>
          </div>

          {temComposicao ? (
            <div className="mt-3 space-y-1 border-t pt-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Valor cobrado</span>
                <span className="tabular-nums">{formatarEmReal(bruto)}</span>
              </div>
              {acrescimos > 0 ? (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Acréscimos inclusos</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                    + {formatarEmReal(acrescimos)}
                  </span>
                </div>
              ) : null}
              {descontos > 0 ? (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Descontos</span>
                  <span className="tabular-nums text-destructive">
                    − {formatarEmReal(descontos)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-medium text-foreground">Tipo:</span> {transaction.tipo}
            </p>
            <p className="sm:text-right">
              <span className="font-medium text-foreground">Data:</span> {formatDate(transaction.data)}
            </p>
            {(transaction.nomepagador || transaction.cpfcnpjpagador) ? (
              <p className="break-words sm:col-span-2">
                <span className="font-medium text-foreground">Pagador:</span>{" "}
                {transaction.nomepagador || "Não informado"}
                {transaction.cpfcnpjpagador ? ` · ${transaction.cpfcnpjpagador}` : ""}
              </p>
            ) : null}
          </div>
        </section>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2 p-4 rounded-xl bg-card border">
          <div className="min-w-0 space-y-2 sm:col-span-2">
            <Label>
              Data do pagamento <span className="text-destructive">*</span>
            </Label>
            <DatePicker
              value={dataPagamento}
              onChange={setDataPagamento}
              disabled={isSubmitting}
              placeholder="Selecione a data efetiva"
            />
            <p className="text-xs text-muted-foreground">
              Esta data será usada no fluxo de caixa. O vencimento original será preservado no histórico.
            </p>
          </div>

          <div className="min-w-0 space-y-2">
            <Label>
              Banco / conta <span className="text-destructive">*</span>
            </Label>
            <SearchCombobox
              value={selectedBankId}
              onValueChange={setSelectedBankId}
              loading={isLoadingBanks}
              disabled={isSubmitting || !!bankLoadError}
              placeholder={bankLoadError ?? "Selecione o banco"}
              searchPlaceholder="Pesquisar banco ou conta..."
              emptyMessage="Nenhum banco encontrado."
              options={banks.map((bank) => ({
                value: String(bank.id),
                label: bank.titulo,
                description: [
                  bank.tipo,
                  bank.agencia && `Ag. ${bank.agencia}`,
                  bank.contanumero && `Conta ${bank.contanumero}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
                searchText: `${bank.proprietario ?? ""} ${bank.tipo ?? ""}`,
              }))}
            />
            {bankLoadError ? <p className="text-xs text-destructive">{bankLoadError}</p> : null}
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="metodo-concluido">
              Método de pagamento <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedMetodo}
              onValueChange={(value) => setSelectedMetodo(value as Metodo_pagamento)}
              disabled={isSubmitting}
            >
              <SelectTrigger id="metodo-concluido" className="w-full">
                <SelectValue placeholder="Selecione o método" />
              </SelectTrigger>
              <SelectContent>
                {metodosPagamento.map((metodo) => (
                  <SelectItem key={metodo.value} value={metodo.value}>
                    {metodo.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Plano de conta</Label>
            <PlanoContaCombobox
              value={selectedPlanoId}
              onValueChange={setSelectedPlanoId}
              disabled={isSubmitting || loadingPlanos}
              loading={loadingPlanos}
              groups={gruposPlanosDeConta}
              placeholder="Selecione o plano de conta"
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Centro de custo</Label>
            <SearchCombobox
              value={selectedCentroCustoId}
              onValueChange={setSelectedCentroCustoId}
              loading={loadingCentrosCusto}
              disabled={isSubmitting || loadingCentrosCusto || !!errorCentrosCusto}
              placeholder={errorCentrosCusto ? "Erro ao carregar" : "Selecione o centro de custo"}
              searchPlaceholder="Pesquisar centro de custo..."
              emptyMessage="Nenhum centro de custo encontrado."
              clearable
              clearLabel="Sem centro de custo"
              options={centrosCusto.map((centro) => ({
                value: String(centro.id),
                label: centro.nome,
                description: centro.descricao ?? undefined,
              }))}
            />
          </div>
        </div>

        <DialogFooter className="mt-1 flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setIsAlertOpen(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={handleConfirmarPagamento}
            disabled={isSubmitting || isLoadingBanks || !!bankLoadError || !dataPagamento}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Concluindo...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Concluir transação
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
