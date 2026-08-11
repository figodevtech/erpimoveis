"use client";

import { ReactNode, useCallback, useState } from "react";

import type { ContextoPagamentoMultiplo } from "@/app/(app)/(pages)/(financeiro)/components/pagamento-multiplo";
import {
  categoriaDoPagamentoMultiplo,
  descricaoDoPagamentoMultiplo,
  somarSaldos,
} from "@/app/(app)/(pages)/(financeiro)/components/pagamento-multiplo";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";

import {
  Metodo_pagamento,
  NewTransaction,
  Tipo_transacao,
  TransactionCustomer,
} from "../../types";
import EditContent from "./editContent";
import RegisterContent from "./registerContent";

interface TransactionDialogProps {
  children?: ReactNode;
  osId?: number;
  vendaId?: number;
  setSelectedTransactionId?: (value: number | undefined) => void;
  open?: boolean;
  setOpen?: (value: boolean) => void;
  selectedTransactionId?: number | undefined;
  handleGetTransactions?: (pageNumber?: number) => void;
  initialMetodoPagamento?: Metodo_pagamento;
  initialTransaction?: Partial<NewTransaction>;
  internalCompanyExpense?: boolean;
  lockValue?: boolean;
  editable?: boolean;
  /**
   * Quando presente, o diálogo deixa de criar uma transação avulsa e passa a
   * registrar um pagamento rateado entre os documentos selecionados. É o mesmo
   * formulário — só o alvo do envio muda.
   */
  pagamentoMultiplo?: ContextoPagamentoMultiplo;
}

type SementeProps = Pick<
  TransactionDialogProps,
  "osId" | "vendaId" | "initialMetodoPagamento" | "initialTransaction"
> & { pagamentoMultiplo?: ContextoPagamentoMultiplo };

/**
 * Valores iniciais do formulário de cadastro.
 *
 * Estava repetido três vezes no arquivo (estado inicial + os dois
 * `onOpenChange`), e uma delas já tinha divergido das outras.
 */
function sementeDaTransacao({
  osId,
  vendaId,
  initialMetodoPagamento,
  initialTransaction,
  pagamentoMultiplo,
}: SementeProps): NewTransaction {
  // O valor já entra somado: é o total em aberto dos documentos marcados, que é
  // o que o operador vai receber na maioria das vezes. Baixar menos é permitido
  // — basta digitar por cima, e o rateio reage.
  if (pagamentoMultiplo) {
    const total = somarSaldos(pagamentoMultiplo.documentos);

    // Tipo, categoria e descrição vêm depois do spread: são determinados pelos
    // documentos marcados e o formulário os mostra travados, então deixá-los
    // sobrescrevíveis só abriria caminho para o registro divergir da tela.
    return {
      valor: total,
      valorLiquido: total,
      metodopagamento: initialMetodoPagamento,
      parcelas: 1,
      ...initialTransaction,
      tipo: Tipo_transacao.RECEITA,
      categoria: categoriaDoPagamentoMultiplo(pagamentoMultiplo.tipoDocumento),
      descricao: descricaoDoPagamentoMultiplo(pagamentoMultiplo),
    };
  }

  if (osId) {
    return {
      ordemservicoid: osId,
      tipo: Tipo_transacao.RECEITA,
      categoria: "ORDEM DE SERVIÇO",
      descricao: `Pagamento da OS #${osId}`,
      valor: 0,
      valorLiquido: 0,
      parcelas: 1,
      ...initialTransaction,
    };
  }

  if (vendaId) {
    return {
      vendaid: vendaId,
      tipo: Tipo_transacao.RECEITA,
      categoria: "VENDA",
      descricao: `Pagamento da Venda #${vendaId}`,
      valor: 0,
      valorLiquido: 0,
      metodopagamento: initialMetodoPagamento,
      parcelas: 1,
      ...initialTransaction,
    };
  }

  return {};
}

export default function TransactionDialog({
  children,
  setSelectedTransactionId,
  selectedTransactionId,
  open,
  osId,
  vendaId,
  setOpen,
  handleGetTransactions,
  initialMetodoPagamento,
  initialTransaction,
  internalCompanyExpense = false,
  lockValue = false,
  editable = false,
  pagamentoMultiplo,
}: TransactionDialogProps) {
  const semente: SementeProps = {
    osId,
    vendaId,
    initialMetodoPagamento,
    initialTransaction,
    pagamentoMultiplo,
  };

  const [newTransaction, setNewTransaction] = useState<NewTransaction>(() =>
    sementeDaTransacao(semente),
  );
  const [selectedCustomer, setSelectedCustomer] = useState<
    TransactionCustomer | undefined
  >(undefined);

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();
  const usarDialog = isDesktop || !config?.habilitar_drawers;

  const aoAlternar = useCallback(
    (aberto: boolean) => {
      setOpen?.(aberto);

      if (aberto) {
        setNewTransaction(
          sementeDaTransacao({
            osId,
            vendaId,
            initialMetodoPagamento,
            initialTransaction,
            pagamentoMultiplo,
          }),
        );
        return;
      }

      setSelectedTransactionId?.(undefined);
      setNewTransaction({});
      setSelectedCustomer(undefined);
    },
    [
      setOpen,
      osId,
      vendaId,
      initialMetodoPagamento,
      initialTransaction,
      pagamentoMultiplo,
      setSelectedTransactionId,
    ],
  );

  const conteudo = selectedTransactionId ? (
    <EditContent
      selectedTransactionId={selectedTransactionId}
      isDesktop={usarDialog}
      editable={editable}
      handleGetTransactions={handleGetTransactions}
      setOpen={setOpen}
    />
  ) : (
    <RegisterContent
      vendaId={vendaId}
      osId={osId}
      handleGetTransactions={handleGetTransactions}
      selectedCustomer={selectedCustomer}
      setSelectedCustomer={setSelectedCustomer}
      dialogOpen={open}
      newTransaction={newTransaction}
      setNewTransaction={setNewTransaction}
      setSelectedTransactionId={setSelectedTransactionId}
      setOpen={setOpen}
      isDesktop={usarDialog}
      internalCompanyExpense={internalCompanyExpense}
      lockValue={lockValue}
      pagamentoMultiplo={pagamentoMultiplo}
    />
  );

  if (usarDialog) {
    return (
      <Dialog open={open} onOpenChange={aoAlternar}>
        {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
        {conteudo}
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={aoAlternar}>
      {/* Era `DialogTrigger` aqui: dentro do Drawer ele não abre nada. */}
      {children ? <DrawerTrigger asChild>{children}</DrawerTrigger> : null}
      {conteudo}
    </Drawer>
  );
}
