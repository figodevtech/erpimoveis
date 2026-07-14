import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ValueInput from "./valueInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEffect, useState } from "react";
import axios from "axios";
import {
  Banco,
  Metodo_pagamento,
  Tipo_transacao,
  Transaction,
  TransactionCustomer,
} from "../../types";
import { formatCpfCnpj } from "../../utils";
import { Switch } from "@/components/ui/switch";
import { Info } from "lucide-react";
import { useCategoriasTransacao } from "../../hooks/use-categoria-transacao";
import { toast } from "sonner";
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface EditContentProps {
  selectedTransactionId: number | undefined;
  selectedCustomer: TransactionCustomer | undefined;
  setSelectedCustomer: (value: TransactionCustomer | undefined) => void;
  isDesktop: boolean;
}

type TransactionForm = Omit<Transaction, "data"> & { data?: Date };

function parseLocalDateTime(value: string): Date | undefined {
  if (!value) return undefined;
  const [dataParte, horaParte] = value.split("T");
  if (!dataParte || !horaParte) return undefined;

  const [y, m, d] = dataParte.split("-").map(Number);
  const [hh, mm] = horaParte.split(":").map(Number);

  if (!y || !m || !d) return undefined;
  if (hh == null || mm == null) return undefined;

  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function toDateInputString(date: Date | undefined) {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

function toDateFromApi(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    const temTimezone = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value);

    if (temTimezone) return new Date(value);

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      return parseLocalDateTime(value.slice(0, 16));
    }

    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }

  return undefined;
}

export default function EditContent({
  selectedTransactionId,
  isDesktop,
}: EditContentProps) {
  const [isLoadingTransaction, setIsLoadingTransaction] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<
    TransactionForm | undefined
  >(undefined);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [banks, setBanks] = useState<Banco[]>([]);
  const { categorias, loadingCategorias, errorCategorias } =
    useCategoriasTransacao();

  const handleChange = (
    field: keyof TransactionForm,
    value: string | number | boolean | null | undefined,
  ) => {
    setSelectedTransaction((prev) =>
      prev ? { ...prev, [field]: value } : prev,
    );
  };

  const handleGetBanks = async () => {
    setIsLoadingBanks(true);
    try {
      const response = await axios.get("/api/banks");
      if (response.status === 200) {
        setBanks(response.data.data);
      }
    } catch {
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const handleGetTransaction = async (id: number) => {
    setIsLoadingTransaction(true);
    try {
      const response = await axios.get(`/api/transaction/${id}`);
      if (response.status === 200) {
        const t: Transaction = response.data.data;

        setSelectedTransaction({
          ...(t as any),
          data: toDateFromApi((t as any).data),
        });
      }
    } catch {
    } finally {
      setIsLoadingTransaction(false);
    }
  };

  useEffect(() => {
    if (!selectedTransactionId) return;
    handleGetTransaction(selectedTransactionId);
    handleGetBanks();
  }, [selectedTransactionId]);

  const isLoading =
    isLoadingTransaction || isLoadingBanks || loadingCategorias;

  const Content = isDesktop ? DialogContent : DrawerContent;
  const Header = isDesktop ? DialogHeader : DrawerHeader;
  const Footer = isDesktop ? DialogFooter : DrawerFooter;
  const Title = isDesktop ? DialogTitle : DrawerTitle;
  const Description = isDesktop ? DialogDescription : DrawerDescription;
  const Close = isDesktop ? DialogClose : DrawerClose;

  if (isLoading) {
    return (
      <Content
        className={
          isDesktop
            ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
            : `h-[100dvh] min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
        }
      >
        <Header className="hidden">
          <Title />
        </Header>
        <div className="flex h-full min-h-0 flex-col items-center justify-center">
          <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
          <span className="text-primary">Carregando</span>
        </div>
      </Content>
    );
  }

  if (!selectedTransaction) {
    return (
      <Content
        className={
          isDesktop
            ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
            : `h-[100dvh] min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
        }
      >
        <Header className="shrink-0 border-b-1 px-6 py-4">
          <Title>Editar transacao</Title>
          <Description>Nenhuma transacao selecionada.</Description>
        </Header>
        <Footer className="px-6 py-4">
          <Close asChild>
            <Button className="hover:cursor-pointer" variant="outline">
              Fechar
            </Button>
          </Close>
        </Footer>
      </Content>
    );
  }

  return (
    <Content
      className={
        isDesktop
          ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
          : `h-[100dvh] min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <Header className="shrink-0 border-b-1 px-6 py-4">
          <Title>Transacao #{selectedTransaction.id}</Title>
          <Description>Visualize os dados da transacao</Description>
        </Header>

        <div className="h-full min-h-0 overflow-hidden p-0">
          <div className="h-full min-h-0 overflow-auto space-y-2 bg-muted-foreground/5 px-4 py-10">
                                                     <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">

            <div className="grid space-y-4 gap-4 sm:grid-cols-3">
              <div className="space-y-2 w-full">
                <Label htmlFor="tipo">Tipo</Label>
                <Select
                  disabled
                  value={selectedTransaction.tipo}
                  onValueChange={(v) => handleChange("tipo", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(Tipo_transacao).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="metodopagamento">Metodo de pagamento</Label>
                <Select
                  disabled
                  value={selectedTransaction.metodopagamento || ""}
                  onValueChange={(v) => handleChange("metodopagamento", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(Metodo_pagamento).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4 w-full">
                <Label>Lancamento futuro</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    className="hover:cursor-default"
                    disabled
                    checked={selectedTransaction.pendente || false}
                    onCheckedChange={(checked) =>
                      setSelectedTransaction({
                        ...selectedTransaction,
                        pendente: checked,
                      })
                    }
                  />

                  {selectedTransaction.tipo === Tipo_transacao.RECEITA && (
                    <div
                      className={`flex items-center gap-1 text-xs text-muted-foreground ${
                        selectedTransaction.pendente
                          ? "opacity-100"
                          : "opacity-50"
                      }`}
                    >
                      <Info className="h-3 w-3" />
                      <span>LANCAMENTO A RECEBER</span>
                    </div>
                  )}

                  {selectedTransaction.tipo === Tipo_transacao.DESPESA && (
                    <div
                      className={`flex items-center gap-1 text-xs text-muted-foreground ${
                        selectedTransaction.pendente
                          ? "opacity-100"
                          : "opacity-50"
                      }`}
                    >
                      <Info className="h-3 w-3" />
                      <span>LANCAMENTO A PAGAR</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="valor">Valor*</Label>
                <ValueInput
                  disabled
                  price={selectedTransaction.valor || 0}
                  setPrice={(v) => handleChange("valor", v)}
                />
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="banco">Banco</Label>
                <Select
                  disabled
                  value={selectedTransaction.banco_id?.toString() || ""}
                  onValueChange={(v) => {
                    const bancoId = Number(v);
                    const banco = banks.find((x) => x.id === bancoId);

                    setSelectedTransaction((prev) =>
                      prev
                        ? {
                            ...prev,
                            banco_id: bancoId,
                            banco: banco
                              ? { ...(prev as any).banco, ...banco }
                              : (prev as any).banco,
                          }
                        : prev,
                    );
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((b) => (
                      <SelectItem key={b.id} value={b.id.toString()}>
                        {b.titulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="categoria">Categoria</Label>
                <Select
                  disabled
                  value={selectedTransaction.categoria}
                  onValueChange={(v) => handleChange("categoria", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        loadingCategorias
                          ? "Carregando..."
                          : errorCategorias
                            ? "Erro ao carregar"
                            : "Selecione"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.nome}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 w-full col-span-full">
                <Label htmlFor="descricao">Descricao*</Label>
                <Input
                  disabled
                  id="descricao"
                  value={selectedTransaction.descricao || ""}
                  onChange={(e) => handleChange("descricao", e.target.value)}
                  placeholder="Descricao"
                  className="w-full"
                />
              </div>

              <div className="space-y-2 w-full sm:col-span-3">
                <Label htmlFor="data">Data do vencimento</Label>
                <DatePicker
                  disabled
                  value={toDateInputString(selectedTransaction.data)}
                  className="w-full sm:max-w-xs"
                  min={selectedTransaction.pendente ? toDateInputString(new Date()) : undefined}
                  max={!selectedTransaction.pendente ? toDateInputString(new Date()) : undefined}
                  onChange={(value) => {
                    const selecionada = value
                      ? parseLocalDateTime(`${value}T00:00`)
                      : undefined;

                    if (!selecionada) {
                      setSelectedTransaction({
                        ...selectedTransaction,
                        data: undefined,
                      });
                      return;
                    }

                    const agora = new Date();

                    if (
                      !selectedTransaction.pendente &&
                      selecionada.getTime() > agora.getTime()
                    ) {
                      toast.warning(
                        "Ative o pagamento futuro para selecionar uma data futura.",
                      );
                      return;
                    }

                    if (
                      selectedTransaction.pendente &&
                      selecionada.getTime() < agora.getTime()
                    ) {
                      toast.warning(
                        "Desative o pagamento futuro para selecionar uma data passada.",
                      );
                      return;
                    }

                    setSelectedTransaction({
                      ...selectedTransaction,
                      data: selecionada,
                    });
                  }}
                />
              </div>
            </div>

            <div className="mb-4">
              <span className="text-xs text-muted-foreground">
                Dados do pagador
              </span>
              <Separator />
            </div>

            <div className="grid space-y-4 gap-4 sm:grid-cols-2">
              <div className="space-y-2 w-full">
                <Label htmlFor="nomepagador">Nome do pagador*</Label>
                <Input
                  disabled
                  id="nomepagador"
                  value={selectedTransaction.nomepagador || ""}
                  onChange={(e) => handleChange("nomepagador", e.target.value)}
                  placeholder="Nome do pagador"
                  className="w-full"
                />
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="cpfcnpjpagador">CPF/CNPJ do pagador*</Label>
                <Input
                  disabled
                  id="cpfcnpjpagador"
                  maxLength={14}
                  value={
                    formatCpfCnpj(selectedTransaction.cpfcnpjpagador || "") ||
                    ""
                  }
                  onChange={(e) =>
                    handleChange("cpfcnpjpagador", e.target.value)
                  }
                  placeholder="CPF/CNPJ"
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>
        </div>

        <Footer className="px-6 py-4">
          <div className="flex gap-3 sm:flex-row sm:gap-4">
            <Close asChild>
              <Button className="hover:cursor-pointer" variant="outline">
                Cancelar
              </Button>
            </Close>
          </div>
        </Footer>
      </div>
    </Content>
  );
}

