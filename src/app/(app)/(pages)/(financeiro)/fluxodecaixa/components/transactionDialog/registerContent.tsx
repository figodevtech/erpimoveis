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
  TransactionFornecedor,
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
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { formatCpfCnpj } from "../../utils";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { CalendarIcon, Info, Minus, Plus, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import formatarEmReal from "@/utils/formatarEmReal";
import { useCategoriasTransacao } from "../../hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../hooks/use-centros-custo";
import { useTiposDocumento } from "../../hooks/use-tipos-documento";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
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
import {
  categoriaDoPagamentoMultiplo,
  clienteUnicoDoPagamento,
  ContextoPagamentoMultiplo,
  PreviaDoRateio,
} from "@/app/(app)/(pages)/(financeiro)/components/pagamento-multiplo";
import { distribuirValoresIguais, paraCentavos } from "@/lib/financeiro/rateio";
import {
  CABECALHO_FIXO,
  COLUNA_CHEIA,
  MIOLO_ROLAVEL,
  RODAPE_FIXO,
  classesDoConteudo,
} from "./shell";

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

function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateLabel(date?: Date) {
  return date ? date.toLocaleDateString("pt-BR") : "Selecionar data";
}

/**
 * Emissão do documento vai e volta como `AAAA-MM-DD`.
 *
 * Data de emissão não tem hora, então também não deveria ter fuso. Mandar um ISO
 * completo faria o servidor guardar o dia em UTC e a tela mostrar um dia a menos
 * — exatamente o que aconteceu na migração de dados do Demir.
 */
function diaParaData(dia?: string | null) {
  if (!dia) return undefined;
  const [ano, mes, data] = dia.split("-").map(Number);
  if (!ano || !mes || !data) return undefined;
  return new Date(ano, mes - 1, data);
}

function dataParaDia(data?: Date) {
  if (!data) return null;
  const doisDigitos = (valor: number) => String(valor).padStart(2, "0");
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
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
  pagamentoMultiplo?: ContextoPagamentoMultiplo;
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
  pagamentoMultiplo,
  setSelectedCustomer,
  handleGetTransactions,
  setOpen,
  isDesktop,
  internalCompanyExpense = false,
  lockValue = false,
}: RegisterContentProps) {
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [isFornecedorSelectOpen, setIsFornecedorSelectOpen] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<TransactionFornecedor | undefined>(undefined);
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
  const [relacionarDocumento, setRelacionarDocumento] = useState(false);
  const { categorias, loadingCategorias, errorCategorias } =
    useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();
  const { tiposDocumento, loadingTiposDocumento, errorTiposDocumento } =
    useTiposDocumento();
  const { options: paymentMethodOptions } = usePaymentMethodOptions();
  const metodosPagamento =
    paymentMethodOptions.length > 0
      ? paymentMethodOptions
      : Object.values(Metodo_pagamento).map((value) => ({
          value,
          label: value,
        }));
  // Pagamento múltiplo é sempre entrada de dinheiro de OS ou venda: tipo,
  // categoria e descrição saem dos documentos marcados e o formulário só os
  // exibe. A despesa interna continua sendo o único caso de DESPESA travada.
  const tipoTravado = pagamentoMultiplo
    ? Tipo_transacao.RECEITA
    : internalCompanyExpense
      ? Tipo_transacao.DESPESA
      : Tipo_transacao.RECEITA;
  const categoriaTravadaMultiplo = pagamentoMultiplo
    ? categoriaDoPagamentoMultiplo(pagamentoMultiplo.tipoDocumento)
    : null;
  const metodoPermiteParcelas =
    newTransaction.metodopagamento === Metodo_pagamento.BOLETO ||
    newTransaction.metodopagamento === Metodo_pagamento.CREDITO;
  const canManageParcelas = metodoPermiteParcelas && !!newTransaction.pendente;
  /**
   * O que abate os documentos é o valor cobrado, não o que sobra depois da taxa
   * da adquirente.
   *
   * No pagamento múltiplo o parcelamento saía sobre o líquido: com R$ 310,05
   * cobrados e R$ 300,00 líquidos, só R$ 300,00 eram distribuídos entre
   * documentos que somavam R$ 310,05 — os dois ficavam parcialmente pagos e
   * nenhum quitava. A taxa é custo da empresa; a dívida do cliente é o valor
   * cheio, e é ele que precisa ser parcelado, previsto e rateado.
   */
  const valorTotalParcelamento = pagamentoMultiplo
    ? (newTransaction.valor ?? 0)
    : isChecked
      ? (newTransaction.valorLiquido ?? newTransaction.valor ?? 0)
      : (newTransaction.valor ?? 0);
  const valorRateado = valorTotalParcelamento;
  const liquidoDoPagamento = isChecked
    ? (newTransaction.valorLiquido ?? valorRateado)
    : valorRateado;
  const nomeMetodoParcelado =
    newTransaction.metodopagamento === Metodo_pagamento.CREDITO
      ? "crédito"
      : "boleto";
  // No pagamento múltiplo só existe "o mesmo cliente" quando todos os documentos
  // marcados são dele; com clientes misturados não há pagador óbvio a propor.
  const clienteUnicoMultiplo = pagamentoMultiplo
    ? clienteUnicoDoPagamento(pagamentoMultiplo.documentos)
    : null;
  const canUseMesmoCliente =
    (Boolean(osId || vendaId) || clienteUnicoMultiplo != null) && !internalCompanyExpense;

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
      // Todos os documentos do grupo são do mesmo cliente: qualquer um deles
      // responde quem é o pagador, e o primeiro serve.
      if (pagamentoMultiplo && clienteUnicoMultiplo != null) {
        const primeiro = pagamentoMultiplo.documentos[0];
        const rota =
          pagamentoMultiplo.tipoDocumento === "OS"
            ? `/api/ordens/${primeiro.id}`
            : `/api/venda/${primeiro.id}`;
        const response = await axios.get(rota);
        const cliente =
          response.data?.cliente ?? response.data?.os?.cliente ?? response.data?.data?.cliente;
        if (!cliente?.id) return undefined;

        const transactionCustomer = {
          id: cliente.id,
          nome: cliente.nomerazaosocial ?? cliente.nome ?? "",
          cpfcnpj: cliente.cpfcnpj ?? "",
        };

        setClienteMesmoCache(transactionCustomer);
        return transactionCustomer;
      }

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

  // Cliente e fornecedor sao mutuamente exclusivos: ambos alimentam
  // nomepagador/cpfcnpjpagador, entao manter os dois geraria dado conflitante.
  useEffect(() => {
    if (selectedFornecedor) {
      setNewTransaction((prev) => ({
        ...prev,
        nomepagador: selectedFornecedor.nomerazaosocial ?? selectedFornecedor.nomefantasia ?? "",
        cpfcnpjpagador: selectedFornecedor.cpfcnpj ?? "",
        fornecedor_id: selectedFornecedor.id,
        cliente_id: null,
      }));
    }
  }, [setNewTransaction, selectedFornecedor]);

  /**
   * Desligar a seção apaga o que foi digitado.
   *
   * Guardar campos de um documento que o usuário decidiu não relacionar gravaria
   * dado que a tela não mostra — e o banco recusaria de qualquer forma, porque
   * número sem tipo não passa no CHECK.
   */
  const alternarDocumento = (ligado: boolean) => {
    setRelacionarDocumento(ligado);
    if (ligado) return;

    setNewTransaction((prev) => ({
      ...prev,
      documento_tipo_id: null,
      documento_numero: null,
      documento_serie: null,
      documento_chave: null,
      documento_emitido_em: null,
      documento_valor: null,
      documento_observacao: null,
    }));
  };

  const limparFornecedor = () => {
    setSelectedFornecedor(undefined);
    setNewTransaction((prev) => ({
      ...prev,
      fornecedor_id: null,
      nomepagador: "",
      cpfcnpjpagador: "",
    }));
  };

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
      // O tipo é o único campo exigido do documento: os demais dependem do papel
      // que se tem em mãos. É a mesma regra do CHECK no banco, dita antes para o
      // usuário ver uma frase em vez de um erro de constraint.
      if (relacionarDocumento && !newTransaction.documento_tipo_id) {
        toast.error("Selecione o tipo do documento relacionado.");
        return;
      }

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
          (acc, parcela) => acc + paraCentavos(parcela.valor),
          0,
        );
        const valorTotal = paraCentavos(valorTotalParcelamento);

        if (somaParcelas !== valorTotal) {
          toast.error(
            isChecked && !pagamentoMultiplo
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

      // Pagamento múltiplo: mesmo formulário, outro alvo. O rateio não vai daqui
      // — o servidor relê os saldos e decide as fatias, senão uma tela aberta há
      // dez minutos abateria valor que outro operador já recebeu.
      if (pagamentoMultiplo) {
        const resposta = await axios.post("/api/pagamento-multiplo", {
          tipoDocumento: pagamentoMultiplo.tipoDocumento,
          documentoIds: pagamentoMultiplo.documentos.map((documento) => documento.id),
          valor: valorRateado,
          valorLiquido: liquidoDoPagamento,
          modo: canManageParcelas && parcelasDetalhadas.length > 1 ? "PARCELADO" : "AVISTA",
          parcelas: parcelasDetalhadas.length || 1,
          primeiroVencimento: dataParaDia(parcelasDetalhadas[0]?.dataVencimento),
          data: dataParaDia(
            newTransaction.data ? new Date(newTransaction.data) : new Date(),
          ),
          bancoId: newTransaction.banco_id ?? null,
          metodoPagamento: newTransaction.metodopagamento ?? null,
          descricao: newTransaction.descricao ?? null,
          categoria: newTransaction.categoria ?? null,
          categoriaId: newTransaction.categoria_id ?? null,
          clienteId: newTransaction.cliente_id ?? null,
          nomePagador: newTransaction.nomepagador ?? null,
          cpfCnpjPagador: newTransaction.cpfcnpjpagador ?? null,
          planoDeContaId: newTransaction.plano_de_conta_id ?? null,
          centroCustoId: newTransaction.centro_custo_id ?? null,
        });

        if (resposta.status === 201) {
          const criado = resposta.data?.data;
          toast.success("Pagamento registrado!", {
            description: `${criado?.linhas ?? 0} lançamento(s) em ${criado?.documentos ?? 0} documento(s).`,
            duration: 3000,
          });

          handleGetTransactions?.();
          pagamentoMultiplo.onConcluido?.();
          setOpen?.(false);
          setNewTransaction({});
          setSelectedCustomer?.(undefined);
          setParcelasDetalhadas([]);
          setParcelasIguais(false);
          setRelacionarDocumento(false);
        }
        return;
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
        setSelectedFornecedor(undefined);
        setParcelasDetalhadas([]);
        setParcelasIguais(false);
        setRelacionarDocumento(false);
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
    <Content className={classesDoConteudo(Boolean(isDesktop))}>
      <div className={COLUNA_CHEIA}>
        <Header className={CABECALHO_FIXO}>
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
          {pagamentoMultiplo && (
            <Title>
              Pagamento múltiplo{" "}
              <span className="text-muted-foreground text-sm font-light">
                | {pagamentoMultiplo.documentos.length}{" "}
                {pagamentoMultiplo.tipoDocumento === "OS" ? "ORDENS" : "VENDAS"}
              </span>
            </Title>
          )}
          {!osId && !vendaId && !pagamentoMultiplo && <Title>Nova Transação</Title>}
          <Description>
            {pagamentoMultiplo
              ? "Um lançamento só, rateado entre os documentos selecionados"
              : "Preencha dados para registrar uma transação"}
          </Description>
        </Header>
        <div className={`${MIOLO_ROLAVEL} space-y-4 bg-background px-6 py-4`}>
          {pagamentoMultiplo && (
            <PreviaDoRateio
              documentos={pagamentoMultiplo.documentos}
              valor={valorTotalParcelamento}
              parcelas={parcelasDetalhadas.length || 1}
            />
          )}
          <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
              {/* dados da transação */}
              <div className="space-y-4 grid sm:grid-cols-3 gap-4">
                <div className="space-y-2 w-full">
                  <Label htmlFor="tipo">
                    Tipo <span className="text-red-500">*</span>
                  </Label>
                  {osId || vendaId || pagamentoMultiplo ? (
                    <Select
                      disabled
                      value={tipoTravado}
                      onValueChange={(v) => handleChange("tipo", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={tipoTravado}>{tipoTravado}</SelectItem>
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
                      {metodosPagamento.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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

                {/* Continua oculto no fluxo comum; no pagamento múltiplo aparece
                    travado, porque é onde ficam registrados os documentos pagos. */}
                <div
                  className={`${pagamentoMultiplo ? "" : "hidden"} space-y-2 w-full col-span-full`}
                >
                  <Label htmlFor="descricao">
                    Descrição <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={osId || vendaId || pagamentoMultiplo ? true : false}
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
                  {categoriaTravadaMultiplo && (
                    <Select
                      disabled
                      value={categoriaTravadaMultiplo}
                      onValueChange={(v) => handleChange("categoria", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={categoriaTravadaMultiplo}>
                          {categoriaTravadaMultiplo}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {!pagamentoMultiplo && osId && !internalCompanyExpense && (
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
                  {!pagamentoMultiplo && vendaId && (
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
                  {!pagamentoMultiplo &&
                    ((!osId && !vendaId) || (osId && internalCompanyExpense)) && (
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
                {/* Sempre editavel: a descricao acima fica travada quando o lancamento
                    vem de OS/venda, entao este e o unico campo livre nesses casos. */}
                <div className="space-y-2 w-full col-span-full">
                  <Label htmlFor="descricao-pagamento">
                    Descrição do pagamento
                  </Label>
                  <Input
                    id="descricao-pagamento"
                    value={newTransaction.descricao_pagamento || ""}
                    onChange={(e) =>
                      handleChange("descricao_pagamento", e.target.value)
                    }
                    placeholder="Ex.: entrada de 50%, sinal, restante na entrega"
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
                  Dados do pagador/recebedor
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

                  {/* Os seletores ficam sempre montados: sao dialogs controlados por estado. */}
                  <CustomerSelect
                    open={isCustomerSelectOpen}
                    setOpen={setIsCustomerSelectOpen}
                    OnSelect={(c) => {
                      // Escolher cliente descarta o fornecedor (mutuamente exclusivos).
                      setSelectedFornecedor(undefined);
                      setNewTransaction((prev) => ({ ...prev, fornecedor_id: null }));
                      setSelectedCustomer({
                        cpfcnpj: c.cpfcnpj,
                        nome: c.nomerazaosocial,
                        id: c.id,
                      });
                    }}
                  />
                  <FornecedorSelect
                    open={isFornecedorSelectOpen}
                    setOpen={setIsFornecedorSelectOpen}
                    OnSelect={(f) => {
                      // Escolher fornecedor descarta o cliente (mutuamente exclusivos).
                      setSelectedCustomer(undefined);
                      setSelectedFornecedor({
                        id: f.id,
                        nomerazaosocial: f.nomerazaosocial,
                        nomefantasia: f.nomefantasia,
                        cpfcnpj: f.cpfcnpj,
                      });
                    }}
                  />

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
                  ) : selectedFornecedor ? (
                    <Button
                      disabled={pagoPeloMesmo || internalCompanyExpense}
                      onClick={limparFornecedor}
                      className="hover:cursor-pointer"
                      variant={"ghost"}
                      size={"sm"}
                    >
                      Remover Fornecedor
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={pagoPeloMesmo || internalCompanyExpense}
                        onClick={() => setIsCustomerSelectOpen(true)}
                        className="hover:cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                      >
                        Selecionar Cliente
                      </Button>
                      <Button
                        disabled={pagoPeloMesmo || internalCompanyExpense}
                        onClick={() => setIsFornecedorSelectOpen(true)}
                        className="hover:cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                      >
                        Selecionar Fornecedor
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-4 grid sm:grid-cols-2 gap-4">
                <div className="space-y-2 w-full">
                  <Label htmlFor="nomepagador">
                    Nome do pagador/recebedor <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={
                      Boolean(selectedCustomer) ||
                      Boolean(selectedFornecedor) ||
                      internalCompanyExpense
                    }
                    id="descricao"
                    value={newTransaction.nomepagador || ""}
                    onChange={(e) =>
                      handleChange("nomepagador", e.target.value)
                    }
                    placeholder="Nome do pagador/recebedor"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2 w-full">
                  <Label htmlFor="cpfcnpjpagador">
                    CPF/CNPJ do pagador/recebedor <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={
                      Boolean(selectedCustomer) ||
                      Boolean(selectedFornecedor) ||
                      internalCompanyExpense
                    }
                    id="cpfcnpjpagador"
                    inputMode="numeric"
                    maxLength={18}
                    value={
                      formatCpfCnpj(newTransaction.cpfcnpjpagador || "") || ""
                    }
                    onChange={(e) => {
                      const documento = e.target.value.replace(/\D/g, "").slice(0, 14);
                      handleChange("cpfcnpjpagador", documento);
                    }}
                    placeholder="CPF/CNPJ"
                    className="w-full"
                  />
                </div>
              </div>

              {/* documento relacionado */}
              <div>
                <span className="text-xs text-muted-foreground">
                  Documento relacionado
                </span>
                <Separator />
              </div>

              <div className="flex flex-row items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="relacionar-documento"
                    className="cursor-pointer"
                  >
                    Relacionar com documento
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Nota, recibo, comprovante — o papel que justifica o
                    lançamento.
                  </p>
                </div>
                <Switch
                  id="relacionar-documento"
                  className="hover:cursor-pointer"
                  checked={relacionarDocumento}
                  onCheckedChange={alternarDocumento}
                />
              </div>

              {relacionarDocumento && (
                <div className="grid gap-4 sm:grid-cols-3 rounded-xl border bg-background/70 p-4">
                  <div className="space-y-2 w-full">
                    <Label htmlFor="documento-tipo">
                      Tipo de documento <span className="text-red-500">*</span>
                    </Label>
                    <SearchCombobox
                      disabled={loadingTiposDocumento || !!errorTiposDocumento}
                      loading={loadingTiposDocumento}
                      value={newTransaction.documento_tipo_id?.toString() || ""}
                      onValueChange={(value) =>
                        handleChange(
                          "documento_tipo_id",
                          value ? Number(value) : null,
                        )
                      }
                      placeholder={
                        errorTiposDocumento ? "Erro ao carregar" : "Selecione"
                      }
                      searchPlaceholder="Pesquisar documento..."
                      emptyMessage="Nenhum tipo de documento encontrado."
                      options={tiposDocumento.map((tipo) => ({
                        value: String(tipo.id),
                        label: tipo.nome,
                        description: tipo.descricao ?? undefined,
                      }))}
                    />
                  </div>
                  <div className="space-y-2 w-full">
                    <Label htmlFor="documento-numero">Número</Label>
                    <Input
                      id="documento-numero"
                      maxLength={60}
                      value={newTransaction.documento_numero || ""}
                      onChange={(e) =>
                        handleChange("documento_numero", e.target.value)
                      }
                      placeholder="Ex.: 1234"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2 w-full">
                    <Label htmlFor="documento-serie">Série</Label>
                    <Input
                      id="documento-serie"
                      maxLength={20}
                      value={newTransaction.documento_serie || ""}
                      onChange={(e) =>
                        handleChange("documento_serie", e.target.value)
                      }
                      placeholder="Ex.: 1"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2 w-full">
                    <Label htmlFor="documento-emissao">Data de emissão</Label>
                    <DatePickerField
                      value={diaParaData(newTransaction.documento_emitido_em)}
                      onChange={(selecionada) =>
                        handleChange(
                          "documento_emitido_em",
                          dataParaDia(selecionada),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2 w-full">
                    <Label htmlFor="documento-valor">Valor do documento</Label>
                    <ValueInput
                      price={newTransaction.documento_valor || 0}
                      setPrice={(v) => handleChange("documento_valor", v)}
                    />
                    {/* O documento pode valer mais que a transação: uma nota
                        paga em parcelas, ou em parte à vista. Por isso não há
                        conferência contra o valor lançado. */}
                    <p className="text-xs text-muted-foreground">
                      Só referência. Não altera o valor da transação.
                    </p>
                  </div>
                  <div className="space-y-2 w-full sm:col-span-3">
                    <Label htmlFor="documento-chave">
                      Chave de acesso ou código de verificação
                    </Label>
                    <Input
                      id="documento-chave"
                      maxLength={120}
                      value={newTransaction.documento_chave || ""}
                      onChange={(e) =>
                        handleChange("documento_chave", e.target.value)
                      }
                      placeholder="Chave da NF-e/NFS-e, ou o código do comprovante"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2 w-full sm:col-span-3">
                    <Label htmlFor="documento-observacao">Observação</Label>
                    <Input
                      id="documento-observacao"
                      maxLength={500}
                      value={newTransaction.documento_observacao || ""}
                      onChange={(e) =>
                        handleChange("documento_observacao", e.target.value)
                      }
                      placeholder="Ex.: nota do fornecedor referente à peça trocada"
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        <Footer className={RODAPE_FIXO}>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:gap-3">
            <Close asChild>
              <Button className="w-full hover:cursor-pointer sm:w-auto" variant={"outline"}>
                Cancelar
              </Button>
            </Close>
            <Button
              type="submit"
              form="register-form"
              disabled={isSubmitting}
              className="w-full hover:cursor-pointer sm:w-auto"
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
          </div>
        </Footer>
      </div>
    </Content>
  );
}
