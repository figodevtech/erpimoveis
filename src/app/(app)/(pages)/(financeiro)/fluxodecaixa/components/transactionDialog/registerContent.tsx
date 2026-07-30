import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Banco,
  Metodo_pagamento,
  NewTransaction,
  Tipo_transacao,
  TransactionCustomer,
} from "../../types";
import ValueInput from "./valueInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { formatCpfCnpj } from "../../utils";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { CalendarIcon, Info, Minus, Plus, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import formatarEmReal from "@/utils/formatarEmReal";
import { useCategoriasTransacao } from "../../hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../hooks/use-centros-custo";
import { PlanoContaCombobox } from "../plano-conta-combobox";
import { SearchCombobox } from "../search-combobox";
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

interface ParcelaFormulario {
  id: number;
  dataVencimento?: Date;
  valor: number;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function distribuirValoresIguais(total: number, quantidade: number) {
  if (quantidade <= 0) return [];

  const totalCentavos = Math.round((total || 0) * 100);
  const valorBase = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos - valorBase * quantidade;

  return Array.from({ length: quantidade }, (_, index) => {
    const centavos = valorBase + (index < resto ? 1 : 0);
    return centavos / 100;
  });
}

function toCentavos(value: number | undefined) {
  return Math.round((value || 0) * 100);
}

function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateLabel(date?: Date) {
  return date ? date.toLocaleDateString("pt-BR") : "Selecionar data";
}

function DatePickerField({
  value,
  onChange,
  disabled = false,
}: {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDateLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? toDateOnly(value) : undefined}
          onSelect={(date) => onChange(date ? toDateOnly(date) : undefined)}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

interface RegisterContentProps {
  osId?: number | undefined;
  vendaId?: number | undefined;
  setSelectedTransactionId?: (value: number | undefined) => void;
  newTransaction: NewTransaction;
  setNewTransaction: Dispatch<SetStateAction<NewTransaction>>;
  dialogOpen: boolean | undefined;
  selectedCustomer: TransactionCustomer | undefined;
  setSelectedCustomer: (value: TransactionCustomer | undefined) => void;
  handleGetTransactions?: (pageNumber?: number) => void;
  setOpen?: (value: boolean) => void;
  isDesktop?: boolean;
  internalCompanyExpense?: boolean;
  lockValue?: boolean;
}

export default function RegisterContent({
  setSelectedTransactionId,
  newTransaction,
  setNewTransaction,
  dialogOpen,
  selectedCustomer,
  osId,
  vendaId,
  setSelectedCustomer,
  handleGetTransactions,
  setOpen,
  isDesktop,
  internalCompanyExpense = false,
  lockValue = false,
}: RegisterContentProps) {
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [banks, setBanks] = useState<Banco[]>([]);
  const [isChecked, setIsChecked] = useState(false);
  const [pagoPeloMesmo, setPagoPeloMesmo] = useState(false);
  const [clienteMesmoCache, setClienteMesmoCache] = useState<
    TransactionCustomer | undefined
  >(undefined);
  const [parcelasIguais, setParcelasIguais] = useState(false);
  const [parcelasDetalhadas, setParcelasDetalhadas] = useState<
    ParcelaFormulario[]
  >([]);
  const { categorias, loadingCategorias, errorCategorias } =
    useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();
  const metodoPermiteParcelas =
    newTransaction.metodopagamento === Metodo_pagamento.BOLETO ||
    newTransaction.metodopagamento === Metodo_pagamento.CREDITO;
  const canManageParcelas = metodoPermiteParcelas && !!newTransaction.pendente;
  const valorTotalParcelamento = isChecked
    ? (newTransaction.valorLiquido ?? newTransaction.valor ?? 0)
    : (newTransaction.valor ?? 0);
  const nomeMetodoParcelado =
    newTransaction.metodopagamento === Metodo_pagamento.CREDITO
      ? "crédito"
      : "boleto";
  const canUseMesmoCliente = Boolean(osId || vendaId) && !internalCompanyExpense;

  const handleChange = (
    field: keyof NewTransaction,
    value: string | number | null,
  ) => {
    setNewTransaction({ ...newTransaction, [field]: value });
  };

  const setParcelas = (
    updater:
      | ParcelaFormulario[]
      | ((prev: ParcelaFormulario[]) => ParcelaFormulario[]),
  ) => {
    setParcelasDetalhadas((prev) =>
      typeof updater === "function" ? updater(prev) : updater,
    );
  };

  const handleGetBanks = async () => {
    setIsLoadingBanks(true);
    try {
      const response = await axios.get("/api/banks", {});
      if (response.status === 200) {
        const { data } = response;
        setBanks(data.data);
      }
    } catch {
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const buscarClienteMesmo = async (): Promise<
    TransactionCustomer | undefined
  > => {
    if (clienteMesmoCache?.id) {
      return clienteMesmoCache;
    }

    try {
      if (osId) {
        const response = await axios.get(`/api/ordens/${osId}`);
        const cliente = response.data?.cliente ?? response.data?.os?.cliente;
        if (!cliente?.id) return undefined;

        const transactionCustomer = {
          id: cliente.id,
          nome: cliente.nomerazaosocial ?? cliente.nome ?? "",
          cpfcnpj: cliente.cpfcnpj ?? "",
        };

        setClienteMesmoCache(transactionCustomer);
        return transactionCustomer;
      }

      if (vendaId) {
        const response = await axios.get(`/api/venda/${vendaId}`);
        const cliente = response.data?.data?.cliente;
        if (!cliente?.id) return undefined;

        const transactionCustomer = {
          id: cliente.id,
          nome: cliente.nomerazaosocial ?? cliente.nome ?? "",
          cpfcnpj: cliente.cpfcnpj ?? "",
        };

        setClienteMesmoCache(transactionCustomer);
        return transactionCustomer;
      }
    } catch {
      toast.error("NÃ£o foi possÃ­vel carregar o cliente vinculado.");
    }

    return undefined;
  };

  const aplicarClienteMesmo = async () => {
    const transactionCustomer = await buscarClienteMesmo();
    if (transactionCustomer?.id) {
      setSelectedCustomer(transactionCustomer);
      setNewTransaction((prev) => ({
        ...prev,
        cliente_id: transactionCustomer.id,
        nomepagador: transactionCustomer.nome,
        cpfcnpjpagador: transactionCustomer.cpfcnpj,
      }));
      return;
    }

    try {
      if (osId) {
        const response = await axios.get(`/api/ordens/${osId}`);
        const cliente = response.data?.cliente ?? response.data?.os?.cliente;
        if (!cliente?.id) return;

        const transactionCustomer = {
          id: cliente.id,
          nome: cliente.nomerazaosocial ?? cliente.nome ?? "",
          cpfcnpj: cliente.cpfcnpj ?? "",
        };

        setSelectedCustomer(transactionCustomer);
        setNewTransaction((prev) => ({
          ...prev,
          cliente_id: transactionCustomer.id,
          nomepagador: transactionCustomer.nome,
          cpfcnpjpagador: transactionCustomer.cpfcnpj,
        }));
        return;
      }

      if (vendaId) {
        const response = await axios.get(`/api/venda/${vendaId}`);
        const cliente = response.data?.data?.cliente;
        if (!cliente?.id) return;

        const transactionCustomer = {
          id: cliente.id,
          nome: cliente.nomerazaosocial ?? cliente.nome ?? "",
          cpfcnpj: cliente.cpfcnpj ?? "",
        };

        setSelectedCustomer(transactionCustomer);
        setNewTransaction((prev) => ({
          ...prev,
          cliente_id: transactionCustomer.id,
          nomepagador: transactionCustomer.nome,
          cpfcnpjpagador: transactionCustomer.cpfcnpj,
        }));
      }
    } catch {
      toast.error("Não foi possível carregar o cliente vinculado.");
    }
  };

  useEffect(() => {
    if (selectedCustomer) {
      setNewTransaction((prev) => ({
        ...prev,
        nomepagador: selectedCustomer.nome,
        cpfcnpjpagador: selectedCustomer.cpfcnpj,
        cliente_id: selectedCustomer.id,
      }));
    }
  }, [setNewTransaction, selectedCustomer]);

  useEffect(() => {
    if (!dialogOpen || !internalCompanyExpense) return;

    setPagoPeloMesmo(false);
    setClienteMesmoCache(undefined);
    setSelectedCustomer(undefined);
    setNewTransaction((prev) => ({
      ...prev,
      tipo: Tipo_transacao.DESPESA,
      cliente_id: null,
      nomepagador: "PRÓPRIA EMPRESA",
      cpfcnpjpagador: "",
    }));

    void (async () => {
      try {
        const response = await axios.get("/api/config/empresa");
        const empresa = response.data?.empresa;
        if (!empresa) return;

        setNewTransaction((prev) => ({
          ...prev,
          tipo: Tipo_transacao.DESPESA,
          cliente_id: null,
          nomepagador:
            empresa.razaosocial || empresa.nomefantasia || "PRÓPRIA EMPRESA",
          cpfcnpjpagador: empresa.cnpj || "",
        }));
      } catch {
        toast.error("Não foi possível carregar os dados da empresa.");
      }
    })();
  }, [
    dialogOpen,
    internalCompanyExpense,
    setNewTransaction,
    setSelectedCustomer,
  ]);

  useEffect(() => {
    if (!canUseMesmoCliente) {
      setPagoPeloMesmo(false);
      setClienteMesmoCache(undefined);
      return;
    }
    setPagoPeloMesmo(true);
    void (async () => {
      const transactionCustomer = await buscarClienteMesmo();
      if (!transactionCustomer?.id) return;

      setSelectedCustomer(transactionCustomer);
      setNewTransaction((prev) => ({
        ...prev,
        cliente_id: transactionCustomer.id,
        nomepagador: transactionCustomer.nome,
        cpfcnpjpagador: transactionCustomer.cpfcnpj,
      }));
    })();
  }, [
    canUseMesmoCliente,
    osId,
    vendaId,
    setNewTransaction,
    setSelectedCustomer,
  ]);

  useEffect(() => {
    if (!pagoPeloMesmo) return;
    void aplicarClienteMesmo();
  }, [pagoPeloMesmo]);

  useEffect(() => {
    if (!dialogOpen || !canUseMesmoCliente) return;

    setPagoPeloMesmo(true);

    void (async () => {
      const transactionCustomer = await buscarClienteMesmo();
      if (!transactionCustomer?.id) return;

      setSelectedCustomer(transactionCustomer);
      setNewTransaction((prev) => ({
        ...prev,
        cliente_id: transactionCustomer.id,
        nomepagador: transactionCustomer.nome,
        cpfcnpjpagador: transactionCustomer.cpfcnpj,
      }));
    })();
  }, [
    dialogOpen,
    canUseMesmoCliente,
    osId,
    vendaId,
    setNewTransaction,
    setSelectedCustomer,
  ]);

  const handleCreateTransaction = async () => {
    setIsSubmitting(true);
    try {
      let parcelasPayload: Array<{ data: Date; valor: number }> | undefined;

      if (canManageParcelas) {
        if (parcelasDetalhadas.length === 0) {
          toast.error("Adicione ao menos uma parcela.");
          return;
        }

        if (
          parcelasDetalhadas.some(
            (parcela) =>
              !parcela.valor || parcela.valor <= 0 || !parcela.dataVencimento,
          )
        ) {
          toast.error("As parcelas ainda não foram geradas corretamente.");
          return;
        }

        if (
          parcelasDetalhadas.some(
            (parcela) => !parcela.valor || parcela.valor <= 0,
          )
        ) {
          toast.error("Todas as parcelas precisam ter valor maior que zero.");
          return;
        }

        const somaParcelas = parcelasDetalhadas.reduce(
          (acc, parcela) => acc + toCentavos(parcela.valor),
          0,
        );
        const valorTotal = toCentavos(valorTotalParcelamento);

        if (somaParcelas !== valorTotal) {
          toast.error(
            isChecked
              ? "A soma das parcelas deve ser igual ao valor líquido."
              : "A soma das parcelas deve ser igual ao valor total.",
          );
          return;
        }

        parcelasPayload = parcelasDetalhadas.map((parcela) => ({
          data: parcela.dataVencimento!,
          valor: parcela.valor,
        }));
      }

      const endpoint = osId ? "/api/transaction/os" : "/api/transaction";

      const response = await axios.post(endpoint, {
        newTransaction: {
          ...newTransaction,
          data: parcelasDetalhadas[0]?.dataVencimento ?? newTransaction.data,
        },
        parcelasDetalhadas: parcelasPayload,
      });

      if (response.status === 201) {
        const created = response.data?.data ?? response.data;

        toast.success("Sucesso!", {
          description: "Transação registrada.",
          duration: 2000,
        });

        // se existir, seta o id (fluxo fora de OS)
        setSelectedTransactionId?.(
          Array.isArray(created) ? created[0]?.id : created?.id,
        );

        // recarrega a lista da OS (quando veio por OS)
        handleGetTransactions?.();

        // fecha SEMPRE que criar
        setOpen?.(false);

        // opcional: limpar o formulário
        setNewTransaction({});
        setSelectedCustomer?.(undefined);
        setParcelasDetalhadas([]);
        setParcelasIguais(false);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast("Erro", {
          description: error.response?.data?.error,
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    handleGetBanks();
  }, []);

  useEffect(() => {
    setNewTransaction({
      ...newTransaction,
      valorLiquido: newTransaction.valor,
    });
    setIsChecked(false);
  }, [, newTransaction.metodopagamento]);

  useEffect(() => {
    if (!canManageParcelas) {
      setParcelasDetalhadas([]);
      setParcelasIguais(false);
    }
  }, [canManageParcelas]);

  useEffect(() => {
    if (!canManageParcelas) return;

    setParcelasDetalhadas((prev) => {
      const quantidade = Math.max(1, prev.length || 1);
      const valoresPadrao = distribuirValoresIguais(
        valorTotalParcelamento,
        quantidade,
      );
      const dataBase = newTransaction.data ?? new Date();

      return Array.from({ length: quantidade }, (_, index) => ({
        id: prev[index]?.id ?? Date.now() + index,
        dataVencimento:
          prev[index]?.dataVencimento ?? addMonths(dataBase, index),
        valor: parcelasIguais
          ? (valoresPadrao[index] ?? 0)
          : (prev[index]?.valor ?? valoresPadrao[index] ?? 0),
      }));
    });
  }, [
    canManageParcelas,
    parcelasIguais,
    newTransaction.data,
    valorTotalParcelamento,
  ]);

  useEffect(() => {
    if (!isChecked) {
      setNewTransaction({
        ...newTransaction,
        valorLiquido: newTransaction.valor,
      });
    }
  }, [newTransaction.valor]);

  useEffect(() => {
    if (
      newTransaction.tipo === Tipo_transacao.SAQUE ||
      newTransaction.tipo === Tipo_transacao.DEPOSITO
    ) {
      setNewTransaction({
        ...newTransaction,
        pendente: false,
      });
    }
  }, [newTransaction.tipo]);

  useEffect(() => {
    setNewTransaction({
      ...newTransaction,
      data: undefined,
    });
  }, [newTransaction.pendente]);

  const Content = isDesktop ? DialogContent : DrawerContent;
  const Header = isDesktop ? DialogHeader : DrawerHeader;
  const Footer = isDesktop ? DialogFooter : DrawerFooter;
  const Title = isDesktop ? DialogTitle : DrawerTitle;
  const Description = isDesktop ? DialogDescription : DrawerDescription;
  const Close = isDesktop ? DialogClose : DrawerClose;

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
        <Header className="shrink-0 px-6 py-4 border-b-1">
          {osId && (
            <Title>
              OS #{osId}{" "}
              <span className="text-muted-foreground text-sm font-light">
                | TRANSAÇÃO
              </span>
            </Title>
          )}
          {vendaId && (
            <Title>
              Venda #{vendaId}{" "}
              <span className="text-muted-foreground text-sm font-light">
                | TRANSAÇÃO
              </span>
            </Title>
          )}
          {!osId && !vendaId && <Title>Nova Transação</Title>}
          <Description>Preencha dados para registrar uma transação</Description>
        </Header>
        <div className="h-full min-h-0 overflow-hidden">
          <div className="h-full min-h-0 overflow-auto px-6 py-4 space-y-4 bg-background">
            <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
              {/* dados da transação */}
              <div className="space-y-4 grid sm:grid-cols-3 gap-4">
                <div className="space-y-2 w-full">
                  <Label htmlFor="tipo">
                    Tipo <span className="text-red-500">*</span>
                  </Label>
                  {osId || vendaId ? (
                    <Select
                      disabled
                      value={
                        internalCompanyExpense
                          ? Tipo_transacao.DESPESA
                          : Tipo_transacao.RECEITA
                      }
                      onValueChange={(v) => handleChange("tipo", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value={
                            internalCompanyExpense
                              ? Tipo_transacao.DESPESA
                              : Tipo_transacao.RECEITA
                          }
                        >
                          {internalCompanyExpense ? "DESPESA" : "RECEITA"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={newTransaction.tipo || ""}
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
                  )}
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="metodopagamento">Método de pagamento</Label>
                  <Select
                    value={newTransaction.metodopagamento || ""}
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
                  <Label>Lançamento futuro</Label>
                  <div className="flex felx-row items-center gap-2">
                    <Switch
                      className="hover:cursor-pointer"
                      disabled={
                        newTransaction.tipo === Tipo_transacao.SAQUE ||
                        newTransaction.tipo === Tipo_transacao.DEPOSITO
                          ? true
                          : false
                      }
                      checked={newTransaction.pendente || false}
                      onCheckedChange={(checked) =>
                        setNewTransaction({
                          ...newTransaction,
                          pendente: checked,
                        })
                      }
                    />

                    {newTransaction.tipo === Tipo_transacao.RECEITA && (
                      <div
                        className={`flex flex-row gap-1 items-center text-xs text-muted-foreground ${
                          newTransaction.pendente ? "opacity-100" : "opacity-50"
                        }`}
                      >
                        <Info className="w-3 h-3" />
                        <span>LANÇAMENTO A RECEBER</span>
                      </div>
                    )}
                    {newTransaction.tipo === Tipo_transacao.DESPESA && (
                      <div
                        className={`flex flex-row gap-1 items-center text-xs text-muted-foreground ${
                          newTransaction.pendente ? "opacity-100" : "opacity-50"
                        }`}
                      >
                        <Info className="w-3 h-3" />
                        <span>LANÇAMENTO A PAGAR</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="hidden space-y-2 w-full col-span-full">
                  <Label htmlFor="descricao">
                    Descrição <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={osId || vendaId ? true : false}
                    id="descricao"
                    value={newTransaction.descricao || ""}
                    onChange={(e) => handleChange("descricao", e.target.value)}
                    placeholder="Descrição"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2 w-full">
                  <div className="p-0 m-0 mb-1 flex flex-row justify-between items-center">
                    <Label htmlFor="valor">
                      Valor <span className="text-red-500">*</span>
                    </Label>
                    {(newTransaction.tipo === Tipo_transacao.RECEITA ||
                      newTransaction.tipo === Tipo_transacao.SAQUE) && (
                      <div className="flex flex-row gap-2">
                        <span className="text-xs text-muted-foreground">
                          Taxa de recebimento
                        </span>
                        <Switch
                          checked={isChecked}
                          onCheckedChange={() => {
                            setIsChecked(!isChecked);
                            if (!isChecked) {
                              setNewTransaction({
                                ...newTransaction,
                                valorLiquido: newTransaction.valor,
                              });
                            } else {
                              setNewTransaction({
                                ...newTransaction,
                                valorLiquido: newTransaction.valor,
                              });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <ValueInput
                    price={newTransaction.valor || 0}
                    setPrice={(v) => handleChange("valor", v)}
                    disabled={lockValue}
                  ></ValueInput>
                  {isChecked && (
                    <>
                      <div className="flex flex-row items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Valor líquido recebido:
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Taxa:{" "}
                          {newTransaction.valor && newTransaction.valorLiquido
                            ? formatarEmReal(
                                newTransaction.valor -
                                  newTransaction.valorLiquido,
                              )
                            : 0}
                        </span>
                      </div>
                      <ValueInput
                        price={newTransaction.valorLiquido || 0}
                        setPrice={(v) => handleChange("valorLiquido", v)}
                      ></ValueInput>
                    </>
                  )}
                </div>
                {!canManageParcelas && (
                  <div className="space-y-2 w-full">
                    <Label htmlFor="data">Data</Label>
                    <DatePickerField
                      value={newTransaction.data}
                      onChange={(selecionada) => {
                        if (!selecionada) {
                          setNewTransaction({
                            ...newTransaction,
                            data: undefined,
                          });
                          return;
                        }

                        const agora = new Date();

                        if (
                          !newTransaction.pendente &&
                          selecionada.getTime() > agora.getTime()
                        ) {
                          toast.warning(
                            "Ative o pagamento futuro para selecionar uma data futura.",
                          );
                          return;
                        }

                        if (
                          newTransaction.pendente &&
                          selecionada.getTime() < agora.getTime()
                        ) {
                          toast.warning(
                            "Desative o pagamento futuro para selecionar uma data passada.",
                          );
                          return;
                        }

                        setNewTransaction({
                          ...newTransaction,
                          data: selecionada,
                        });
                      }}
                    />
                  </div>
                )}
                <div className="space-y-2 w-full">
                  <Label htmlFor="banco">Banco</Label>
                  <SearchCombobox
                    value={newTransaction.banco_id?.toString() || ""}
                    onValueChange={(value) => handleChange("banco_id", Number(value))}
                    loading={isLoadingBanks}
                    placeholder="Selecione"
                    searchPlaceholder="Pesquisar banco ou conta..."
                    emptyMessage="Nenhum banco encontrado."
                    options={banks.map((bank) => ({
                      value: String(bank.id),
                      label: bank.titulo,
                      description: [bank.tipo, bank.agencia && `Ag. ${bank.agencia}`, bank.contanumero && `Conta ${bank.contanumero}`]
                        .filter(Boolean)
                        .join(" · "),
                      searchText: `${bank.proprietario ?? ""} ${bank.tipo ?? ""}`,
                    }))}
                  />
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="categoria-topo">Categoria</Label>
                  {osId && !internalCompanyExpense && (
                    <Select
                      disabled
                      value={newTransaction.categoria}
                      onValueChange={(v) => handleChange("categoria", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ORDEM DE SERVIÃ‡O">
                          ORDEM DE SERVIÃ‡O
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {vendaId && (
                    <Select
                      disabled
                      value={newTransaction.categoria}
                      onValueChange={(v) => handleChange("categoria", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VENDA">VENDA</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {((!osId && !vendaId) || (osId && internalCompanyExpense)) && (
                    <SearchCombobox
                      disabled={loadingCategorias || !!errorCategorias}
                      loading={loadingCategorias}
                      value={newTransaction.categoria}
                      onValueChange={(value) => handleChange("categoria", value)}
                      placeholder={errorCategorias ? "Erro ao carregar" : "Selecione"}
                      searchPlaceholder="Pesquisar categoria..."
                      emptyMessage="Nenhuma categoria encontrada."
                      options={categorias.map((categoria) => ({
                        value: categoria.nome,
                        label: categoria.nome,
                        description: categoria.descricao ?? undefined,
                      }))}
                    />
                  )}
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="plano-de-conta">Plano de Conta</Label>
                  <PlanoContaCombobox
                    disabled={loadingPlanos}
                    loading={loadingPlanos}
                    groups={gruposPlanosDeConta}
                    value={newTransaction.plano_de_conta_id?.toString() || ""}
                    placeholder="Selecione"
                    onValueChange={(_, selected) => {
                      setNewTransaction({
                        ...newTransaction,
                        plano_de_conta_id: selected.id,
                        plano_de_conta: selected.nome,
                      });
                    }}
                  />
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="centro-custo">Centro de custo</Label>
                  <SearchCombobox
                    disabled={loadingCentrosCusto || !!errorCentrosCusto}
                    loading={loadingCentrosCusto}
                    value={newTransaction.centro_custo_id?.toString() || ""}
                    onValueChange={(value) => {
                      const selected = centrosCusto.find((centro) => String(centro.id) === value);
                      setNewTransaction({
                        ...newTransaction,
                        centro_custo_id: selected?.id ?? null,
                        centro_custo: selected?.nome ?? null,
                      });
                    }}
                    placeholder={errorCentrosCusto ? "Erro ao carregar" : "Selecione"}
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
                <div className="space-y-2 w-full col-span-full">
                  <Label htmlFor="descricao-topo">
                    {internalCompanyExpense ? "Motivo da despesa" : "Descrição"}{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={Boolean(osId || vendaId) && !internalCompanyExpense}
                    id="descricao-topo"
                    value={newTransaction.descricao || ""}
                    onChange={(e) => handleChange("descricao", e.target.value)}
                    placeholder={
                      internalCompanyExpense
                        ? "Ex.: reboque, lava-jato, serviço terceirizado"
                        : "Descrição"
                    }
                    className="w-full"
                  />
                </div>
                {metodoPermiteParcelas && !newTransaction.pendente && (
                    <div className="w-full sm:col-span-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      Ative `Lançamento futuro` para habilitar o parcelamento do
                      {" "}{nomeMetodoParcelado}.
                    </div>
                  )}
                {canManageParcelas && (
                  <div className="space-y-3 w-full sm:col-span-3 rounded-xl border bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          Parcelas do {nomeMetodoParcelado}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Adicione parcelas como na entrada fiscal.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="parcelas-iguais" className="text-xs">
                          Parcelas iguais
                        </Label>
                        <Switch
                          id="parcelas-iguais"
                          checked={parcelasIguais}
                          onCheckedChange={setParcelasIguais}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {parcelasDetalhadas.map((parcela, index) => (
                        <div
                          key={parcela.id ?? index}
                          className="relative flex flex-row items-center justify-between gap-4 rounded-xl bg-muted-foreground/5 px-3 py-6"
                        >
                          <span className="absolute left-3 top-1 text-xs text-muted-foreground">
                            {index + 1}º parcela
                          </span>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 hover:cursor-pointer"
                            onClick={() => {
                              if (parcelasDetalhadas.length === 1) {
                                toast.error(
                                  "E necessario ao menos uma parcela",
                                );
                                return;
                              }

                              setParcelas((prev) => {
                                const next = prev.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                );

                                if (!parcelasIguais) {
                                  return next;
                                }

                                const valoresRedistribuidos =
                                  distribuirValoresIguais(
                                    valorTotalParcelamento,
                                    next.length,
                                  );

                                return next.map((parcela, parcelaIndex) => ({
                                  ...parcela,
                                  valor:
                                    valoresRedistribuidos[parcelaIndex] ?? 0,
                                }));
                              });
                            }}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                              Data vencimento:
                            </span>
                            <DatePickerField
                              value={parcela.dataVencimento}
                              onChange={(date) =>
                                setParcelas((prev) =>
                                  prev.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          dataVencimento: date,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                              Valor:
                            </span>
                            <ValueInput
                              price={parcela.valor}
                              disabled={parcelasIguais}
                              setPrice={(valor) =>
                                setParcelas((prev) =>
                                  prev.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, valor }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {isChecked ? "Valor líquido a parcelar" : "Valor total"}: {" "}
                        {formatarEmReal(valorTotalParcelamento)}
                      </span>
                      <span>
                        Soma das parcelas:{" "}
                        {formatarEmReal(
                          parcelasDetalhadas.reduce(
                            (acc, parcela) => acc + (parcela.valor || 0),
                            0,
                          ),
                        )}
                      </span>
                    </div>

                    <div
                      className="group mt-3 flex w-max flex-row items-center gap-2 hover:cursor-pointer"
                      onClick={() =>
                        setParcelas((prev) => {
                          const next = [
                            ...prev,
                            {
                              id: Date.now(),
                              dataVencimento: addMonths(
                                prev[prev.length - 1]?.dataVencimento ??
                                  newTransaction.data ??
                                  new Date(),
                                1,
                              ),
                              valor: 0,
                            },
                          ];

                          if (!parcelasIguais) {
                            return next;
                          }

                          const valoresRedistribuidos = distribuirValoresIguais(
                            valorTotalParcelamento,
                            next.length,
                          );

                          return next.map((parcela, index) => ({
                            ...parcela,
                            valor: valoresRedistribuidos[index] ?? 0,
                          }));
                        })
                      }
                    >
                      <Plus className="h-4 w-4 text-green-300 group-hover:text-green-600" />
                      <span className="text-xs text-card-foreground">
                        Adicionar Parcela
                      </span>
                    </div>
                  </div>
                )}
                <div className="hidden space-y-2 w-full">
                  <Label htmlFor="categoria">Categoria</Label>
                  {osId && !internalCompanyExpense && (
                    <Select
                      disabled
                      value={newTransaction.categoria}
                      onValueChange={(v) => handleChange("categoria", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ORDEM DE SERVIÇO">
                          ORDEM DE SERVIÇO
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {vendaId && (
                    <Select
                      disabled
                      value={newTransaction.categoria}
                      onValueChange={(v) => handleChange("categoria", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VENDA">VENDA</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {((!osId && !vendaId) || (osId && internalCompanyExpense)) && (
                    <SearchCombobox
                      disabled={loadingCategorias || !!errorCategorias}
                      loading={loadingCategorias}
                      value={newTransaction.categoria}
                      onValueChange={(value) => handleChange("categoria", value)}
                      placeholder={errorCategorias ? "Erro ao carregar" : "Selecione"}
                      searchPlaceholder="Pesquisar categoria..."
                      emptyMessage="Nenhuma categoria encontrada."
                      options={categorias.map((categoria) => ({
                        value: categoria.nome,
                        label: categoria.nome,
                        description: categoria.descricao ?? undefined,
                      }))}
                    />
                  )}
                </div>
              </div>

              {/* dados do cliente */}
              <div>
                <span className=" text-xs text-muted-foreground">
                  Dados do pagador
                </span>
                <Separator />
              </div>

              <div className="flex justify-end">
                <div className="flex w-full items-center justify-end gap-4">
                  {canUseMesmoCliente && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="pago-pelo-mesmo"
                        checked={pagoPeloMesmo}
                        onCheckedChange={(checked) => {
                          const next = checked === true;
                          setPagoPeloMesmo(next);

                          if (!next) {
                            setSelectedCustomer(undefined);
                            setNewTransaction((prev) => ({
                              ...prev,
                              cliente_id: null,
                              nomepagador: "",
                              cpfcnpjpagador: "",
                            }));
                          }
                        }}
                      />
                      <Label
                        htmlFor="pago-pelo-mesmo"
                        className="cursor-pointer"
                      >
                        Pago pelo mesmo
                      </Label>
                    </div>
                  )}

                  {selectedCustomer ? (
                    <Button
                      disabled={pagoPeloMesmo || internalCompanyExpense}
                      onClick={() => {
                        setNewTransaction({
                          ...newTransaction,
                          nomepagador: "",
                          cpfcnpjpagador: "",
                          cliente_id: null,
                        });
                        setSelectedCustomer(undefined);
                      }}
                      className="hover:cursor-pointer"
                      variant={"ghost"}
                      size={"sm"}
                    >
                      Remover Cliente
                    </Button>
                  ) : (
                    <>
                      <CustomerSelect
                        open={isCustomerSelectOpen}
                        setOpen={setIsCustomerSelectOpen}
                        OnSelect={(c) => {
                          setSelectedCustomer({
                            cpfcnpj: c.cpfcnpj,
                            nome: c.nomerazaosocial,
                            id: c.id,
                          });
                        }}
                      />

                      <Button
                        disabled={pagoPeloMesmo || internalCompanyExpense}
                        onClick={() => setIsCustomerSelectOpen(true)}
                        className="hover:cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                      >
                        Selecionar Cliente
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-4 grid sm:grid-cols-2 gap-4">
                <div className="space-y-2 w-full">
                  <Label htmlFor="nomepagador">
                    Nome do pagador <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={Boolean(selectedCustomer) || internalCompanyExpense}
                    id="descricao"
                    value={newTransaction.nomepagador || ""}
                    onChange={(e) =>
                      handleChange("nomepagador", e.target.value)
                    }
                    placeholder="Nome do pagador"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="cpfcnpjpagador">
                    CPF/CNPJ do pagador <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={Boolean(selectedCustomer) || internalCompanyExpense}
                    id="cpfcnpjpagador"
                    maxLength={14}
                    value={
                      formatCpfCnpj(newTransaction.cpfcnpjpagador || "") || ""
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
        <Footer className="px-6 py-4 border-t">
          <div className="flex sm:flex-row gap-3 sm:gap-4">
            <Button
              type="submit"
              form="register-form"
              // disabled={isSubmitting}
              className="flex-1  hover:cursor-pointer"
              onClick={handleCreateTransaction}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Registrar
                </>
              )}
            </Button>
            <Close asChild>
              <Button className="hover:cursor-pointer" variant={"outline"}>
                Cancelar
              </Button>
            </Close>
          </div>
        </Footer>
      </div>
    </Content>
  );
}
