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
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { Banco, Metodo_pagamento, Transaction } from "../types";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";

interface ConcluidoAlertProps {
  children?: ReactNode;
  isAlertOpen: boolean;
  setIsAlertOpen: (value: boolean) => void;
  transaction?: Transaction | null;
  idConcluido?: number;
  handleSetConcluido?: (id: number) => void;
  onSuccess?: () => void;
}

export default function ConculidoAlert({
  children,
  isAlertOpen,
  setIsAlertOpen,
  transaction,
  onSuccess,
}: ConcluidoAlertProps) {
  const [banks, setBanks] = useState<Banco[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">("");
  const [selectedPlanoId, setSelectedPlanoId] = useState<string>("");
  const { planosDeConta, loadingPlanos } = usePlanosDeConta();

  useEffect(() => {
    if (!isAlertOpen || !transaction) return;

    setSelectedBankId(transaction.banco_id ? String(transaction.banco_id) : "");
    setSelectedMetodo(transaction.metodopagamento || "");
    setSelectedPlanoId(transaction.plano_de_conta_id ? String(transaction.plano_de_conta_id) : "");

    const fetchBanks = async () => {
      setIsLoadingBanks(true);
      try {
        const response = await axios.get("/api/banks");
        if (response.status === 200) {
          setBanks(response.data.data ?? []);
        }
      } catch (error) {
        console.error("Erro ao carregar bancos:", error);
      } finally {
        setIsLoadingBanks(false);
      }
    };

    void fetchBanks();
  }, [isAlertOpen, transaction]);

  const handleConfirmarPagamento = async () => {
    if (!transaction) return;

    if (!selectedBankId) {
      toast.error("Selecione um banco para concluir o pagamento.");
      return;
    }

    if (!selectedMetodo) {
      toast.error("Selecione o método de pagamento para concluir.");
      return;
    }

    setIsSubmitting(true);
    toast(
      <div className="flex flex-row items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Confirmando pagamento...</span>
      </div>,
    );

    try {
      const response = await axios.patch(`/api/transaction/${transaction.id}`, {
        pendente: false,
        banco_id: Number(selectedBankId),
        metodopagamento: selectedMetodo,
        plano_de_conta_id: selectedPlanoId ? Number(selectedPlanoId) : null,
      });

      if (response.status === 200) {
        toast.success("Pagamento confirmado com sucesso!");
        setIsAlertOpen(false);
        onSuccess?.();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao confirmar pagamento", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!transaction) return <>{children}</>;

  return (
    <Dialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
      {children}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            Revisão e Confirmação de Pagamento
          </DialogTitle>
          <DialogDescription>
            Revise os dados da transação. É obrigatório selecionar o Banco e o Método de pagamento para concluir a baixa do pagamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Card de Resumo da Transação */}
          <div className="rounded-lg border bg-card p-3 text-sm space-y-1.5">
            <div className="flex justify-between items-start gap-2">
              <span className="font-semibold text-foreground truncate" title={transaction.descricao}>
                #{transaction.id} - {transaction.descricao}
              </span>
              <span className="shrink-0 font-bold text-primary">
                {formatarEmReal(transaction.valor)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tipo: <strong>{transaction.tipo}</strong></span>
              <span>Data: {formatDate(transaction.data)}</span>
            </div>
            {(transaction.nomepagador || transaction.cpfcnpjpagador) && (
              <div className="text-xs text-muted-foreground pt-1 border-t">
                Pagador/Cliente: {transaction.nomepagador || "-"} {transaction.cpfcnpjpagador ? `(${transaction.cpfcnpjpagador})` : ""}
              </div>
            )}
          </div>

          {/* Form de Seleção Obrigatória */}
          <div className="space-y-3">
            <div className="space-y-1.5 rounded-2xl p-4 bg-card">
              <Label htmlFor="banco-concluido">
                Banco / Conta <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedBankId}
                onValueChange={(v) => setSelectedBankId(v)}
              >
                <SelectTrigger id="banco-concluido" className="w-full">
                  <SelectValue placeholder={isLoadingBanks ? "Carregando..." : "Selecione o banco"} />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.titulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-1.5">
                <Label htmlFor="metodo-concluido">
                  Método de pagamento <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedMetodo}
                  onValueChange={(v) => setSelectedMetodo(v as Metodo_pagamento)}
                >
                  <SelectTrigger id="metodo-concluido" className="w-full">
                    <SelectValue placeholder="Selecione o método de pagamento" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(Metodo_pagamento).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="plano-concluido">Plano de Conta</Label>
                <Select
                  value={selectedPlanoId}
                  onValueChange={(v) => setSelectedPlanoId(v)}
                  disabled={loadingPlanos}
                >
                  <SelectTrigger id="plano-concluido" className="w-full">
                    <SelectValue placeholder={loadingPlanos ? "Carregando..." : "Selecione o plano de conta"} />
                  </SelectTrigger>
                  <SelectContent>
                    {planosDeConta.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.codigo ? `${p.codigo} - ${p.nome}` : p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsAlertOpen(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmarPagamento}
            disabled={isSubmitting}
            className="hover:cursor-pointer ml-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirmando...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Confirmar Pagamento
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
