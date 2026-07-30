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
import { usePlanosDeConta } from "../../hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../hooks/use-centros-custo";
import { PlanoContaCombobox } from "../plano-conta-combobox";
import { SearchCombobox } from "../search-combobox";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
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
  editable: boolean;
  handleGetTransactions?: (pageNumber?: number) => void;
  setOpen?: (value: boolean) => void;
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
  editable,
  handleGetTransactions,
  setOpen,
}: EditContentProps) {
  const [isLoadingTransaction, setIsLoadingTransaction] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<
    TransactionForm | undefined
  >(undefined);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [banks, setBanks] = useState<Banco[]>([]);
  const { categorias, loadingCategorias, errorCategorias } =
    useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();

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
    isLoadingTransaction || isLoadingBanks || loadingCategorias || loadingCentrosCusto;

  const handleSave = async () => {
    if (!editable || !selectedTransaction) return;
    if (!selectedTransaction.descricao?.trim() || !selectedTransaction.valor || !selectedTransaction.data) {
      toast.error("Preencha descrição, valor e data.");
      return;
    }

    setIsSaving(true);
    try {
      await axios.patch(`/api/transaction/${selectedTransaction.id}`, {
        descricao: selectedTransaction.descricao,
        data: selectedTransaction.data,
        tipo: selectedTransaction.tipo,
        metodopagamento: selectedTransaction.metodopagamento || null,
        categoria: selectedTransaction.categoria || null,
        categoria_id: selectedTransaction.categoria_id ?? null,
        plano_de_conta: selectedTransaction.plano_de_conta ?? null,
        plano_de_conta_id: selectedTransaction.plano_de_conta_id ?? null,
        centro_custo: selectedTransaction.centro_custo ?? null,
        centro_custo_id: selectedTransaction.centro_custo_id ?? null,
        banco_id: selectedTransaction.banco_id ?? null,
        nomepagador: selectedTransaction.nomepagador || null,
        cpfcnpjpagador: selectedTransaction.cpfcnpjpagador || null,
        pendente: selectedTransaction.pendente ?? false,
      }, {
        headers: { "X-Transaction-Edit": "true" },
      });
      toast.success("Transação atualizada.");
      handleGetTransactions?.();
      setOpen?.(false);
    } catch (error: any) {
      toast.error("Erro ao atualizar transação", {
        description: error?.response?.data?.error ?? error?.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

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

  const valorBruto = Number(selectedTransaction.valor ?? 0);
  const valorLiquido = Number(selectedTransaction.valorLiquido ?? selectedTransaction.valor ?? 0);
  const taxaRecebimento = Math.max(0, valorBruto - valorLiquido);
  const possuiTaxa = Math.round(valorBruto * 100) !== Math.round(valorLiquido * 100);

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
          <Description>{editable ? "Altere os dados da transação" : "Visualize os dados da transação"}</Description>
        </Header>

        <div className="h-full min-h-0 overflow-hidden p-0">
          <div className="h-full min-h-0 overflow-auto space-y-2 bg-muted-foreground/5 px-4 py-10">
                                                     <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">

            <div className="grid space-y-4 gap-4 sm:grid-cols-3">
              <div className="space-y-2 w-full">
                <Label htmlFor="tipo">
                  Tipo <span className="text-red-500">*</span>
                </Label>
                <Select
                  disabled={!editable}
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
                  disabled={!editable}
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
                    disabled={!editable}
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
                <Label htmlFor="valor">
                  {possuiTaxa ? "Valor bruto" : "Valor"} <span className="text-red-500">*</span>
                </Label>
                <ValueInput
                  disabled
                  price={selectedTransaction.valor || 0}
                  setPrice={() => undefined}
                />
                {possuiTaxa ? (
                  <div className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">Taxa de recebimento</span>
                      <span className="font-medium text-destructive">- {formatarEmReal(taxaRecebimento)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">Valor bruto</span>
                      <span className="font-medium">{formatarEmReal(valorBruto)}</span>
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <Label>Valor líquido recebido</Label>
                      <ValueInput disabled price={valorLiquido} setPrice={() => undefined} />
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  O valor da transação não pode ser alterado.
                </p>
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="banco">Banco</Label>
                <SearchCombobox
                  disabled={!editable}
                  loading={isLoadingBanks}
                  value={selectedTransaction.banco_id?.toString() || ""}
                  onValueChange={(value) => {
                    const bancoId = Number(value);
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
                <Label htmlFor="categoria">Categoria</Label>
                <SearchCombobox
                  disabled={!editable}
                  loading={loadingCategorias}
                  value={selectedTransaction.categoria}
                  onValueChange={(value) => {
                    const categoria = categorias.find((item) => item.nome === value);
                    setSelectedTransaction((current) => current ? {
                      ...current,
                      categoria: value,
                      categoria_id: categoria?.id ?? null,
                    } : current);
                  }}
                  placeholder={errorCategorias ? "Erro ao carregar" : "Selecione"}
                  searchPlaceholder="Pesquisar categoria..."
                  emptyMessage="Nenhuma categoria encontrada."
                  options={categorias.map((categoria) => ({
                    value: categoria.nome,
                    label: categoria.nome,
                    description: categoria.descricao ?? undefined,
                  }))}
                />
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="plano-de-conta">Plano de Conta</Label>
                <PlanoContaCombobox
                  disabled={!editable}
                  loading={loadingPlanos}
                  groups={gruposPlanosDeConta}
                  value={selectedTransaction.plano_de_conta_id?.toString() || ""}
                  onValueChange={(_, selected) => {
                    setSelectedTransaction((prev) =>
                      prev
                        ? {
                            ...prev,
                            plano_de_conta_id: selected.id,
                            plano_de_conta: selected.nome,
                          }
                        : prev,
                    );
                  }}
                  placeholder={selectedTransaction.plano_de_conta || "Selecione"}
                />
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="centro-custo">Centro de custo</Label>
                <SearchCombobox
                  disabled={!editable}
                  loading={loadingCentrosCusto}
                  value={selectedTransaction.centro_custo_id?.toString() || ""}
                  onValueChange={(value) => {
                    const selected = centrosCusto.find((centro) => String(centro.id) === value);
                    setSelectedTransaction((current) => current ? {
                      ...current,
                      centro_custo_id: selected?.id ?? null,
                      centro_custo: selected?.nome ?? null,
                    } : current);
                  }}
                  placeholder={errorCentrosCusto ? "Erro ao carregar" : selectedTransaction.centro_custo || "Selecione"}
                  searchPlaceholder="Pesquisar centro de custo..."
                  emptyMessage="Nenhum centro de custo encontrado."
                  options={centrosCusto.map((centro) => ({
                    value: String(centro.id),
                    label: centro.nome,
                    description: centro.descricao ?? undefined,
                  }))}
                />
              </div>

              <div className="space-y-2 w-full col-span-full">
                <Label htmlFor="descricao">
                  Descrição <span className="text-red-500">*</span>
                </Label>
                <Input
                  disabled={!editable}
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
                  disabled={!editable}
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
                Dados do pagador/recebedor
              </span>
              <Separator />
            </div>

            {selectedTransaction.fornecedor ? (
              <div className="mb-4 rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Fornecedor vinculado
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {selectedTransaction.fornecedor.nomerazaosocial ||
                    selectedTransaction.fornecedor.nomefantasia ||
                    `Fornecedor #${selectedTransaction.fornecedor.id}`}
                </p>
              </div>
            ) : null}

            <div className="grid space-y-4 gap-4 sm:grid-cols-2">
              <div className="space-y-2 w-full">
                <Label htmlFor="nomepagador">
                  Nome do pagador/recebedor <span className="text-red-500">*</span>
                </Label>
                <Input
                  disabled={!editable}
                  id="nomepagador"
                  value={selectedTransaction.nomepagador || ""}
                  onChange={(e) => handleChange("nomepagador", e.target.value)}
                  placeholder="Nome do pagador/recebedor"
                  className="w-full"
                />
              </div>

              <div className="space-y-2 w-full">
                <Label htmlFor="cpfcnpjpagador">
                  CPF/CNPJ do pagador/recebedor <span className="text-red-500">*</span>
                </Label>
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
            {editable ? (
              <Button onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? "Salvando..." : "Salvar alterações"}
              </Button>
            ) : null}
          </div>
        </Footer>
      </div>
    </Content>
  );
}

