"use client";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { ReactNode, useState } from "react";
import EditContent from "./editContent";
import RegisterContent from "./registerContent";
import {
  Metodo_pagamento,
  NewTransaction,
  Tipo_transacao,
  TransactionCustomer,
} from "../../types";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { Drawer } from "@/components/ui/drawer";

interface TransactionDialogProps {
  children?: ReactNode;
  osId?: number;
  vendaId?: number;
  transactionId?: number;
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
}: TransactionDialogProps) {
  const [newTransaction, setNewTransaction] = useState<NewTransaction>(() => {
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
  });
  const [selectedCustomer, setSelectedCustomer] = useState<
    TransactionCustomer | undefined
  >(undefined);

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();

  if (isDesktop || !config?.habilitar_drawers) {
    return (
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (setOpen) setOpen(nextOpen);

          if (nextOpen) {
            if (osId) {
              setNewTransaction({
                ordemservicoid: osId,
                tipo: Tipo_transacao.RECEITA,
                categoria: "ORDEM DE SERVIÇO",
                descricao: `Pagamento da OS #${osId}`,
                valor: 0,
                valorLiquido: 0,
                parcelas: 1,
                ...initialTransaction,
              });
            }

            if (vendaId) {
              setNewTransaction({
                vendaid: vendaId,
                tipo: Tipo_transacao.RECEITA,
                categoria: "VENDA",
                descricao: `Pagamento da Venda #${vendaId}`,
                valor: 0,
                valorLiquido: 0,
                metodopagamento: initialMetodoPagamento,
                parcelas: 1,
                ...initialTransaction,
              });
            }

            if (!osId && !vendaId) {
              setNewTransaction({});
            }

            return;
          }

          // ao fechar, limpa estados
          if (setSelectedTransactionId) setSelectedTransactionId(undefined);
          setNewTransaction({});
          setSelectedCustomer(undefined);
        }}
      >
        {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
        {selectedTransactionId ? (
          <EditContent
            selectedTransactionId={selectedTransactionId}
            selectedCustomer={selectedCustomer}
            setSelectedCustomer={setSelectedCustomer}
            isDesktop={true}
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
            isDesktop={true}
            internalCompanyExpense={internalCompanyExpense}
            lockValue={lockValue}
          />
        )}
      </Dialog>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (setOpen) setOpen(nextOpen);

        if (nextOpen) {
          if (osId) {
            setNewTransaction({
              ordemservicoid: osId,
              tipo: Tipo_transacao.RECEITA,
              categoria: "ORDEM DE SERVIÇO",
              descricao: `Pagamento da OS #${osId}`,
              valor: 0,
              valorLiquido: 0,
              parcelas: 1,
              ...initialTransaction,
            });
          }

          if (vendaId) {
            setNewTransaction({
              vendaid: vendaId,
              tipo: Tipo_transacao.RECEITA,
              categoria: "VENDA",
              descricao: `Pagamento da Venda #${vendaId}`,
              valor: 0,
              valorLiquido: 0,
              metodopagamento: initialMetodoPagamento,
              parcelas: 1,
              ...initialTransaction,
            });
          }

          if (!osId && !vendaId) {
            setNewTransaction({});
          }

          return;
        }

        // ao fechar, limpa estados
        if (setSelectedTransactionId) setSelectedTransactionId(undefined);
        setNewTransaction({});
        setSelectedCustomer(undefined);
      }}
    >
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      {selectedTransactionId ? (
        <EditContent
          selectedTransactionId={selectedTransactionId}
          selectedCustomer={selectedCustomer}
          setSelectedCustomer={setSelectedCustomer}
          isDesktop={false}
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
          isDesktop={false}
          internalCompanyExpense={internalCompanyExpense}
          lockValue={lockValue}
        />
      )}
    </Drawer>
  );
}
