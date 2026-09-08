import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { formatCpfCnpj } from "../../utils";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import {
  CalendarIcon,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  Info,
  Minus,
  Pencil,
  Plus,
  Save,
  UserRound,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import formatarEmReal from "@/utils/formatarEmReal";
import { useCategoriasTransacao } from "../../hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../hooks/use-centros-custo";
import { useTiposDocumento } from "../../hooks/use-tipos-documento";
import { useBandeiras } from "../../hooks/use-bandeiras";
import {
  calcularPelaFaixa,
  faixasOrdenadas,
  maximoDeParcelas,
  rotuloDaFaixa,
} from "@/lib/financeiro/bandeira";
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
import type { ContextoLancamentoDeEventos } from "@/app/(app)/(pages)/(financeiro)/components/lancamento-de-eventos";
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
import {
  TransactionBadge,
  TransactionSection,
} from "./transaction-dialog-ui";

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
            "h-10 w-full justify-start rounded-none text-left font-normal shadow-none",
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
  lancamentoDeEventos?: ContextoLancamentoDeEventos;
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
  maximumAmount?: number;
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
  lancamentoDeEventos,
  setSelectedCustomer,
  handleGetTransactions,
  setOpen,
  isDesktop,
  internalCompanyExpense = false,
  lockValue = false,
  maximumAmount,
}: RegisterContentProps) {
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [isFornecedorSelectOpen, setIsFornecedorSelectOpen] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<TransactionFornecedor | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmarVencidaAberto, setConfirmarVencidaAberto] = useState(false);
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
  /**
   * O escape do líquido travado.
   *
   * Com bandeira escolhida o líquido é calculado e o campo fica somente leitura:
   * é o que faz o relatório por bandeira valer alguma coisa. Mas a adquirente às
   * vezes cobra diferente do combinado — antecipação, campanha, ajuste
   * retroativo —, e sem saída o operador ficaria obrigado a registrar um número
   * que ele sabe estar errado. Ligar isto destrava o campo e marca a linha.
   */
  const [taxaAjustada, setTaxaAjustada] = useState(false);
  const { bandeiras, loadingBandeiras, errorBandeiras } = useBandeiras(
    newTransaction.banco_id,
    newTransaction.metodopagamento,
  );
  // O hook ja garante lista nao vazia: ele mesmo cai na lista padrao enquanto a
  // do banco nao chega ou se ela falhar.
  const { options: metodosPagamento } = usePaymentMethodOptions();
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
    newTransaction.metodopagamento === Metodo_pagamento.CREDITO ||
    newTransaction.metodopagamento === Metodo_pagamento.PROMISSORIA;
  const canManageParcelas = metodoPermiteParcelas && !!newTransaction.pendente;

  const bandeiraSelecionada =
    bandeiras.find((bandeira) => bandeira.id === newTransaction.bandeira_id) ?? null;
  const faixasDaBandeira = bandeiraSelecionada
    ? faixasOrdenadas(bandeiraSelecionada.parcelas)
    : [];
  const maximoDaBandeira = maximoDeParcelas(faixasDaBandeira);
  /**
   * Em quantas vezes o cliente passou no cartão.
   *
   * São duas perguntas diferentes que dão na mesma taxa. No parcelado futuro,
   * cada parcela é um título a receber e a contagem é o número de parcelas que o
   * operador montou. No recebimento à vista o dinheiro entra de uma vez só, mas
   * o cliente ainda pode ter parcelado na maquineta — e aí não há parcela
   * nenhuma no sistema de onde tirar o número, por isso o seletor à parte.
   */
  const parcelasDaMaquineta = canManageParcelas
    ? parcelasDetalhadas.length || 1
    : (newTransaction.bandeira_parcelas ?? null);
  const calculoDaBandeira =
    bandeiraSelecionada && parcelasDaMaquineta
      ? calcularPelaFaixa(
          newTransaction.valor ?? 0,
          faixasDaBandeira,
          parcelasDaMaquineta,
        )
      : null;
  // O parcelado futuro deixa a contagem passar do que a bandeira aceita enquanto
  // o operador ainda está montando as parcelas; avisar é melhor do que impedir
  // silenciosamente e deixá-lo sem entender por que o botão parou de responder.
  const parcelasForaDaTabela =
    Boolean(bandeiraSelecionada) && parcelasDaMaquineta != null && !calculoDaBandeira;
  const liquidoTravadoPelaBandeira = Boolean(bandeiraSelecionada) && !taxaAjustada;
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
  const somaDasParcelas = parcelasDetalhadas.reduce(
    (total, parcela) => total + (parcela.valor || 0),
    0,
  );
  /**
   * Quanto falta (ou sobra) para as parcelas fecharem no total a distribuir.
   *
   * Em centavos porque é o mesmo critério da validação do salvamento: comparar
   * em reais faria a tela dar por fechado um resíduo binário que o `handleCreate`
   * recusaria — e o operador veria "está tudo certo" e um erro ao salvar.
   */
  const diferencaDasParcelas =
    paraCentavos(somaDasParcelas) - paraCentavos(valorTotalParcelamento);
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
  const excedeSaldoDisponivel =
    maximumAmount != null &&
    maximumAmount >= 0 &&
    paraCentavos(newTransaction.valor ?? 0) > paraCentavos(maximumAmount);

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

  /*
   * O pagador de uma despesa da OS é de quem opera, não da empresa.
   *
   * Aqui um efeito buscava `/api/config/empresa` e plantava razão social e CNPJ
   * da própria oficina em `nomepagador`/`cpfcnpjpagador`, e os campos abaixo
   * nasciam travados. A premissa era que despesa de OS é sempre a empresa
   * pagando — mas quem lança um evento financeiro precisa dizer para QUEM o
   * dinheiro foi: o fornecedor da peça, o terceiro que fez o serviço. O campo
   * volta a nascer vazio e livre, inclusive para escolher cliente ou fornecedor.
   */

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

  const handleCreateTransaction = async (opts?: { ignorarVencida?: boolean }) => {
    setIsSubmitting(true);
    try {
      if (
        !newTransaction.nomepagador?.trim() ||
        !newTransaction.cpfcnpjpagador?.trim()
      ) {
        toast.error("Informe o nome e o CPF/CNPJ do pagador/recebedor.");
        return;
      }

      if (excedeSaldoDisponivel) {
        toast.error("O valor informado ultrapassa o saldo disponível.", {
          description: `O maior pagamento permitido agora é ${formatarEmReal(maximumAmount ?? 0)}.`,
        });
        return;
      }

      // O tipo é o único campo exigido do documento: os demais dependem do papel
      // que se tem em mãos. É a mesma regra do CHECK no banco, dita antes para o
      // usuário ver uma frase em vez de um erro de constraint.
      if (relacionarDocumento && !newTransaction.documento_tipo_id) {
        toast.error("Selecione o tipo do documento relacionado.");
        return;
      }

      if (bandeiraSelecionada) {
        if (!parcelasDaMaquineta) {
          toast.error("Informe em quantas vezes o pagamento foi passado no cartão.");
          return;
        }

        // O servidor recusaria de qualquer jeito — ele relê a tabela da bandeira
        // e não aceita faixa que não existe. Barrar aqui é só para a mensagem
        // chegar antes de o formulário inteiro ir e voltar.
        if (!calculoDaBandeira) {
          toast.error(
            `${bandeiraSelecionada.nome} não tem taxa cadastrada para ${parcelasDaMaquineta}x.`,
          );
          return;
        }
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

      // Título vencido em aberto é estado legítimo — não se bloqueia a data,
      // só se confirma antes de enviar. `canManageParcelas` já implica
      // `pendente`, então checar as parcelas cobre esse caso; fora dele, o
      // único vencimento é o campo "Data" único.
      const dataVencida = (data?: Date) =>
        Boolean(data) &&
        toDateOnly(data!).getTime() < toDateOnly(new Date()).getTime();

      const lancamentoVencido =
        Boolean(newTransaction.pendente) &&
        (canManageParcelas
          ? parcelasDetalhadas.some((parcela) => dataVencida(parcela.dataVencimento))
          : dataVencida(newTransaction.data));

      if (lancamentoVencido && !opts?.ignorarVencida) {
        setConfirmarVencidaAberto(true);
        return;
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
          setTaxaAjustada(false);
        }
        return;
      }

      // Boleto de despesas da OS: mesmo formulário, outro alvo. Daqui vai a
      // seleção e a divisão em parcelas; o valor total quem decide é o servidor,
      // que relê as despesas na fonte — uma tela aberta há dez minutos lançaria
      // um total que já não corresponde a elas.
      if (lancamentoDeEventos) {
        const resposta = await axios.post("/api/lancamento-de-eventos", {
          ordemServicoId: lancamentoDeEventos.ordemServicoId ?? null,
          eventosIds: lancamentoDeEventos.eventosIds,
          descricao: newTransaction.descricao ?? null,
          data: newTransaction.data ?? new Date(),
          pendente: newTransaction.pendente !== false,
          metodoPagamento: newTransaction.metodopagamento ?? null,
          categoria: newTransaction.categoria ?? null,
          categoriaId: newTransaction.categoria_id ?? null,
          planoDeContaId: newTransaction.plano_de_conta_id ?? null,
          centroCustoId: newTransaction.centro_custo_id ?? null,
          fornecedorId: newTransaction.fornecedor_id ?? null,
          bancoId: newTransaction.banco_id ?? null,
          nomePagador: newTransaction.nomepagador ?? null,
          cpfCnpjPagador: newTransaction.cpfcnpjpagador ?? null,
          parcelas: parcelasPayload ?? [],
        });

        if (resposta.status === 201) {
          const criado = resposta.data?.data;
          toast.success("Lançamento registrado!", {
            description: `${criado?.parcelas ?? 1} parcela(s) para ${criado?.despesas ?? 0} despesa(s).`,
            duration: 3000,
          });

          handleGetTransactions?.();
          lancamentoDeEventos.onConcluido?.();
          setOpen?.(false);
          setNewTransaction({});
          setSelectedCustomer?.(undefined);
          setParcelasDetalhadas([]);
          setParcelasIguais(false);
          setRelacionarDocumento(false);
          setTaxaAjustada(false);
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

        // Pagamentos vinculados sempre voltam ao modo de cadastro. Manter o ID
        // recém-criado faria o próximo clique em "Novo pagamento" abrir a edição
        // do lançamento anterior.
        if (osId || vendaId) {
          setSelectedTransactionId?.(undefined);
        } else {
          setSelectedTransactionId?.(
            Array.isArray(created) ? created[0]?.id : created?.id,
          );
        }

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
        setTaxaAjustada(false);
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

  /**
   * Trocar de conta ou de forma de pagamento derruba a bandeira escolhida.
   *
   * Uma bandeira pertence a um par (conta, método): a Visa crédito da Sicredi não
   * existe no débito nem na conta da Stone. Sem isto, mudar o método deixava a
   * transação apontando para uma bandeira que o novo seletor nem lista, e com
   * uma taxa que ninguém mais conseguia ver de onde tinha vindo.
   */
  useEffect(() => {
    setTaxaAjustada(false);
    setNewTransaction((atual) =>
      atual.bandeira_id == null
        ? atual
        : {
            ...atual,
            bandeira_id: null,
            bandeira_parcelas: null,
            bandeira_taxa_ajustada: false,
          },
    );
    // Só o par importa; reagir ao objeto inteiro apagaria a bandeira a cada
    // tecla digitada em qualquer outro campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTransaction.banco_id, newTransaction.metodopagamento]);

  /**
   * A conta da taxa: mantém `bandeira_parcelas` e o líquido em dia.
   *
   * No parcelado futuro a contagem é derivada — cada parcela adicionada muda a
   * faixa e, com ela, a taxa. O líquido é recalculado pela MESMA função que o
   * servidor usa (`calcularPelaFaixa`); um centavo de diferença entre os dois
   * lados derrubaria o cadastro com "a soma das parcelas deve ser igual ao valor
   * líquido", porque é contra este número que a soma é conferida.
   */
  useEffect(() => {
    if (!bandeiraSelecionada) return;

    setNewTransaction((atual) => {
      const proximo = { ...atual };
      let mudou = false;

      if (canManageParcelas && atual.bandeira_parcelas !== parcelasDaMaquineta) {
        proximo.bandeira_parcelas = parcelasDaMaquineta;
        mudou = true;
      }

      // Taxa corrigida à mão: o número digitado manda, e recalcular por cima
      // apagaria a correção a cada tecla.
      if (!taxaAjustada && calculoDaBandeira) {
        if (atual.valorLiquido !== calculoDaBandeira.liquido) {
          proximo.valorLiquido = calculoDaBandeira.liquido;
          mudou = true;
        }
      }

      return mudou ? proximo : atual;
    });

    if (!taxaAjustada && calculoDaBandeira) setIsChecked(true);
    // `faixasDaBandeira` e `calculoDaBandeira` são recriados a cada render; o que
    // de fato muda a conta são o id da bandeira, a contagem e o bruto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bandeiraSelecionada?.id,
    parcelasDaMaquineta,
    newTransaction.valor,
    taxaAjustada,
    canManageParcelas,
  ]);

  /**
   * Escolher uma bandeira já liga "parcelas iguais" — mas só como padrão.
   *
   * Maquineta parcela em valores iguais, então é o que se quer em quase todo
   * lançamento de cartão. Travar, porém, seria errado: uma bandeira pode estar
   * cadastrada num boleto, e boleto com entrada maior é lançamento legítimo.
   *
   * Quem desliga assume a soma. O risco real é que, com bandeira, o total a
   * distribuir MUDA a cada parcela adicionada — a contagem troca a faixa de taxa
   * —, e valores digitados antes ficam para trás. Por isso o aviso da soma logo
   * abaixo da lista: sem ele o erro só apareceria ao salvar, sem dizer por que o
   * alvo tinha mudado.
   *
   * A dependência é o id, não o objeto: reagir ao objeto reacenderia a chave a
   * cada recarga da lista de bandeiras, desfazendo a escolha de quem a desligou.
   */
  useEffect(() => {
    if (bandeiraSelecionada?.id && canManageParcelas) setParcelasIguais(true);
  }, [bandeiraSelecionada?.id, canManageParcelas]);

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
    <>
    <Content className={classesDoConteudo(Boolean(isDesktop))}>
      <div className={COLUNA_CHEIA}>
        <Header className={CABECALHO_FIXO}>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Central financeira · Novo lançamento
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Title className="text-base font-bold uppercase tracking-[0.06em] text-foreground sm:text-lg">
              {osId ? (
                <>OS <span className="text-primary">#{osId}</span> · Transação</>
              ) : vendaId ? (
                <>Venda <span className="text-primary">#{vendaId}</span> · Transação</>
              ) : pagamentoMultiplo ? (
                <>Pagamento múltiplo</>
              ) : (
                "Nova transação"
              )}
            </Title>
            {pagamentoMultiplo ? (
              <TransactionBadge tone="primary">
                {pagamentoMultiplo.documentos.length}{" "}
                {pagamentoMultiplo.tipoDocumento === "OS" ? "ordens" : "vendas"}
              </TransactionBadge>
            ) : null}
          </div>
          <Description className="max-w-3xl text-xs leading-relaxed sm:text-sm">
            {pagamentoMultiplo
              ? "Um lançamento só, rateado entre os documentos selecionados"
              : "Defina a movimentação, classifique o lançamento e identifique a contraparte."}
          </Description>
        </Header>
        <div className={`${MIOLO_ROLAVEL} space-y-4 bg-muted/25 px-4 py-4 sm:px-6 sm:py-5`}>
          {pagamentoMultiplo && (
            <PreviaDoRateio
              documentos={pagamentoMultiplo.documentos}
              valor={valorTotalParcelamento}
              parcelas={parcelasDetalhadas.length || 1}
            />
          )}
          <TransactionSection
            eyebrow="Etapa principal"
            title="Movimentação e classificação"
            description="Informe natureza, valor, vencimento e organização contábil do lançamento."
            icon={CircleDollarSign}
          >
              {/* dados da transação */}
              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
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
                <div className="space-y-2 w-full">
                  <Label>Lançamento futuro</Label>
                  <div className="flex min-h-10 flex-row items-center gap-2 border border-border bg-muted/20 px-3">
                    <Switch
                      className="rounded-none hover:cursor-pointer"
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
                  <div className="mb-1 flex items-center justify-between gap-2 p-0">
                    <Label htmlFor="valor">
                      Valor <span className="text-red-500">*</span>
                    </Label>
                    {/* Com bandeira escolhida a chave some: quem decide se há taxa
                        é a tabela dela, e deixar as duas coisas mandando no mesmo
                        campo seria uma segunda verdade sobre o mesmo número. */}
                    {!bandeiraSelecionada &&
                      (newTransaction.tipo === Tipo_transacao.RECEITA ||
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
                  {maximumAmount != null ? (
                    <div
                      className={cn(
                        "flex items-start gap-1.5 text-[11px]",
                        excedeSaldoDisponivel
                          ? "font-medium text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      <span>
                        {excedeSaldoDisponivel
                          ? `Valor acima do saldo de ${formatarEmReal(maximumAmount)}. Ajuste para continuar.`
                          : `Saldo disponível para este lançamento: ${formatarEmReal(maximumAmount)}.`}
                      </span>
                    </div>
                  ) : null}
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
                          {bandeiraSelecionada && calculoDaBandeira && !taxaAjustada
                            ? ` (${calculoDaBandeira.taxaPercentual
                                .toFixed(2)
                                .replace(".", ",")}%)`
                            : null}
                        </span>
                      </div>
                      <ValueInput
                        price={newTransaction.valorLiquido || 0}
                        setPrice={(v) => {
                          handleChange("valorLiquido", v);
                        }}
                        disabled={liquidoTravadoPelaBandeira}
                      ></ValueInput>
                      {/* O escape. Fica visível só quando há bandeira: sem ela o
                          campo já é livre e o botão não teria o que destravar. */}
                      {bandeiraSelecionada && (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:cursor-pointer hover:underline"
                          onClick={() => {
                            const proximo = !taxaAjustada;
                            setTaxaAjustada(proximo);
                            setNewTransaction((atual) => ({
                              ...atual,
                              bandeira_taxa_ajustada: proximo,
                              // Voltar para a tabela devolve o valor calculado; sem
                              // isto o líquido corrigido continuaria lá, agora sem
                              // nada explicando de onde veio.
                              ...(proximo || !calculoDaBandeira
                                ? {}
                                : { valorLiquido: calculoDaBandeira.liquido }),
                            }));
                          }}
                        >
                          <Pencil className="size-3" aria-hidden="true" />
                          {taxaAjustada
                            ? "Voltar para a taxa da bandeira"
                            : "A adquirente cobrou outro valor? Corrigir taxa"}
                        </button>
                      )}
                      {taxaAjustada && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Taxa corrigida à mão. O lançamento fica marcado como
                          ajustado, e o relatório por bandeira separa esta linha
                          das que seguiram a tabela.
                        </p>
                      )}
                    </>
                  )}
                </div>
                {/*
                  Só aparece quando há bandeira cadastrada para o par (conta,
                  forma de pagamento). Quem não usa maquineta, ou não cadastrou
                  bandeira nenhuma, não vê diferença alguma no formulário.
                */}
                {!pagamentoMultiplo &&
                  (bandeiras.length > 0 || loadingBandeiras || errorBandeiras) && (
                  <div className="w-full space-y-3 border border-border bg-background p-4 sm:col-span-3">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4 text-primary" aria-hidden="true" />
                      <span className="text-sm font-medium">Cartão</span>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 w-full">
                        <Label htmlFor="bandeira">Bandeira</Label>
                        <SearchCombobox
                          disabled={loadingBandeiras || !!errorBandeiras}
                          loading={loadingBandeiras}
                          value={newTransaction.bandeira_id?.toString() || ""}
                          onValueChange={(value) => {
                            const escolhida = bandeiras.find(
                              (bandeira) => String(bandeira.id) === value,
                            );

                            setTaxaAjustada(false);
                            setNewTransaction((atual) => ({
                              ...atual,
                              bandeira_id: escolhida?.id ?? null,
                              // Ao escolher, a contagem começa na menor faixa da
                              // bandeira — quase sempre 1x. Ao limpar, o líquido
                              // volta a ser o bruto: sem bandeira não há taxa
                              // calculada, e deixar o número anterior lá seria um
                              // desconto sem origem.
                              bandeira_parcelas: escolhida
                                ? (faixasOrdenadas(escolhida.parcelas)[0]?.parcelas ?? null)
                                : null,
                              bandeira_taxa_ajustada: false,
                              ...(escolhida ? {} : { valorLiquido: atual.valor }),
                            }));

                            if (!escolhida) setIsChecked(false);
                          }}
                          placeholder={
                            errorBandeiras ? "Erro ao carregar" : "Selecione"
                          }
                          searchPlaceholder="Pesquisar bandeira..."
                          emptyMessage="Nenhuma bandeira encontrada."
                          clearable
                          clearLabel="Sem bandeira"
                          options={bandeiras.map((bandeira) => ({
                            value: String(bandeira.id),
                            label: bandeira.nome,
                            description:
                              bandeira.descricao ??
                              `${bandeira.parcelas.length} faixa(s), até ${maximoDeParcelas(bandeira.parcelas)}x`,
                          }))}
                        />
                      </div>

                      {/*
                        O segundo seletor só existe no recebimento à vista. No
                        parcelado futuro a contagem já está escrita na tela — é o
                        número de parcelas montadas — e perguntar de novo abriria
                        espaço para as duas respostas divergirem.
                      */}
                      {bandeiraSelecionada && !canManageParcelas && (
                        <div className="space-y-2 w-full">
                          <Label htmlFor="bandeira-parcelas">
                            Passou em quantas vezes{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <SearchCombobox
                            value={newTransaction.bandeira_parcelas?.toString() || ""}
                            onValueChange={(value) => {
                              setTaxaAjustada(false);
                              setNewTransaction((atual) => ({
                                ...atual,
                                bandeira_parcelas: value ? Number(value) : null,
                                bandeira_taxa_ajustada: false,
                              }));
                            }}
                            placeholder="Selecione"
                            searchPlaceholder="Pesquisar parcelamento..."
                            emptyMessage="Esta bandeira não tem faixa cadastrada."
                            options={faixasDaBandeira.map((faixa) => ({
                              value: String(faixa.parcelas),
                              label: rotuloDaFaixa(faixa, newTransaction.valor),
                              searchText: `${faixa.parcelas}x`,
                            }))}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            O dinheiro entra de uma vez; a taxa é a da faixa em que
                            o cliente parcelou.
                          </p>
                        </div>
                      )}

                      {bandeiraSelecionada && canManageParcelas && (
                        <div className="space-y-2 w-full">
                          <Label>Parcelamento</Label>
                          <div className="flex h-10 items-center border border-border bg-muted/20 px-3 text-xs text-muted-foreground">
                            {parcelasDaMaquineta}x — taxa de{" "}
                            {calculoDaBandeira
                              ? `${calculoDaBandeira.taxaPercentual.toFixed(2).replace(".", ",")}%`
                              : "faixa não cadastrada"}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Vem do número de parcelas abaixo. Até {maximoDaBandeira}x
                            nesta bandeira.
                          </p>
                        </div>
                      )}
                    </div>

                    {parcelasForaDaTabela && (
                      <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {bandeiraSelecionada?.nome} não tem taxa cadastrada para{" "}
                        {parcelasDaMaquineta}x. Escolha outro parcelamento ou
                        cadastre a faixa em Configurações &gt; Tipos &gt; Bandeiras.
                      </p>
                    )}
                  </div>
                )}
                {!canManageParcelas && (
                  <div className="space-y-2 w-full">
                    <Label htmlFor="data">
                      {newTransaction.pendente ? "Data de vencimento" : "Data do pagamento"}
                    </Label>
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

                        // Vencimento no passado é permitido: título vencido em
                        // aberto é estado legítimo. O aviso fica para o clique em
                        // "Registrar", não para a seleção da data.
                        setNewTransaction({
                          ...newTransaction,
                          data: selecionada,
                        });
                      }}
                    />
                  </div>
                )}
                {/*
                  Fica fora do `!canManageParcelas` de propósito: um gasto
                  parcelado tem várias datas de vencimento e uma competência só —
                  a conta é de um mês, mesmo paga em três. O valor informado aqui
                  vale para todas as parcelas.

                  Não aparece em pagamento de OS ou de venda: ali a competência é
                  do documento, e o servidor recusa recebê-la.
                */}
                {!osId && !vendaId && (
                  <div className="space-y-2 w-full">
                    <Label htmlFor="competencia_em">Competência</Label>
                    <DatePickerField
                      value={newTransaction.competencia_em ?? undefined}
                      onChange={(selecionada) => {
                        setNewTransaction({
                          ...newTransaction,
                          competencia_em: selecionada ?? null,
                        });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      A que mês o fato pertence na DRE. Conta de julho paga em
                      agosto pertence a julho. Em branco, usa a data do
                      lançamento.
                    </p>
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
                    natureza={
                      newTransaction.tipo === Tipo_transacao.RECEITA
                        ? "RECEITA"
                        : newTransaction.tipo === Tipo_transacao.DESPESA
                          ? "DESPESA"
                          : undefined
                    }
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
                    <div className="w-full border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:col-span-3">
                      Ative `Lançamento futuro` para habilitar o parcelamento do
                      {" "}{nomeMetodoParcelado}.
                    </div>
                  )}
                {canManageParcelas && (
                  <div className="w-full space-y-3 border border-border bg-background p-4 sm:col-span-3">
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
                        {/* Com bandeira já vem ligado, porque maquineta parcela
                            em valores iguais — mas continua desligável: boleto
                            com entrada maior é lançamento legítimo. O que segura
                            o erro é o aviso da soma, logo abaixo. */}
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
                          className="relative flex flex-col gap-4 border border-border bg-muted/20 px-3 py-6 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="absolute left-3 top-1 text-xs text-muted-foreground">
                            {index + 1}º parcela
                          </span>
                          <button
                            type="button"
                            className="flex size-11 shrink-0 items-center justify-center border border-destructive bg-destructive text-destructive-foreground hover:cursor-pointer sm:size-8"
                            aria-label={`Remover ${index + 1}ª parcela`}
                            title={`Remover ${index + 1}ª parcela`}
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

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {isChecked ? "Valor líquido a parcelar" : "Valor total"}: {" "}
                          {formatarEmReal(valorTotalParcelamento)}
                        </span>
                        <span
                          className={
                            diferencaDasParcelas === 0
                              ? undefined
                              : "font-medium text-destructive"
                          }
                        >
                          Soma das parcelas: {formatarEmReal(somaDasParcelas)}
                        </span>
                      </div>

                      {/*
                        O aviso que substitui a trava de "parcelas iguais".

                        Sem ele, quem desliga a chave e depois adiciona uma
                        parcela vê o alvo mudar em silêncio — a contagem troca a
                        faixa de taxa e o líquido junto — e só descobre no
                        "Registrar", numa mensagem que não explica de onde veio o
                        número novo.
                      */}
                      {diferencaDasParcelas !== 0 && (
                        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {diferencaDasParcelas < 0
                            ? `Faltam ${formatarEmReal(Math.abs(diferencaDasParcelas) / 100)} para as parcelas fecharem em ${formatarEmReal(valorTotalParcelamento)}.`
                            : `As parcelas somam ${formatarEmReal(diferencaDasParcelas / 100)} a mais que os ${formatarEmReal(valorTotalParcelamento)} a distribuir.`}
                          {bandeiraSelecionada
                            ? " Com bandeira, cada parcela adicionada muda a faixa de taxa — e com ela o total. Ligue “Parcelas iguais” para redistribuir."
                            : ""}
                        </p>
                      )}

                      {bandeiraSelecionada && !parcelasIguais && diferencaDasParcelas === 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Com valores digitados à mão, confira a soma depois de
                          adicionar ou remover parcelas: a taxa da bandeira muda
                          com a quantidade.
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      className="group mt-3 flex h-11 w-max flex-row items-center gap-2 border border-border bg-background px-3 text-xs font-semibold hover:cursor-pointer hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
                      disabled={
                        maximoDaBandeira > 0 &&
                        parcelasDetalhadas.length >= maximoDaBandeira
                      }
                      title={
                        maximoDaBandeira > 0 &&
                        parcelasDetalhadas.length >= maximoDaBandeira
                          ? `${bandeiraSelecionada?.nome} parcela em até ${maximoDaBandeira}x.`
                          : undefined
                      }
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
                      <Plus className="h-4 w-4 text-primary" />
                      <span className="text-card-foreground">Adicionar parcela</span>
                    </button>
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

          </TransactionSection>

          <TransactionSection
            eyebrow="Contraparte"
            title="Pagador ou recebedor"
            description="Use um cadastro existente ou informe manualmente quem participa da movimentação."
            icon={UserRound}
          >

              <div className="mb-4 border-b border-border pb-4">
                <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:justify-end">
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
                      disabled={pagoPeloMesmo}
                      onClick={() => {
                        setNewTransaction({
                          ...newTransaction,
                          nomepagador: "",
                          cpfcnpjpagador: "",
                          cliente_id: null,
                        });
                        setSelectedCustomer(undefined);
                      }}
                      className="h-11 rounded-none hover:cursor-pointer sm:h-9"
                      variant={"ghost"}
                      size={"sm"}
                    >
                      Remover Cliente
                    </Button>
                  ) : selectedFornecedor ? (
                    <Button
                      disabled={pagoPeloMesmo}
                      onClick={limparFornecedor}
                      className="h-11 rounded-none hover:cursor-pointer sm:h-9"
                      variant={"ghost"}
                      size={"sm"}
                    >
                      Remover Fornecedor
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={pagoPeloMesmo}
                        onClick={() => setIsCustomerSelectOpen(true)}
                        className="h-11 rounded-none hover:cursor-pointer sm:h-9"
                        variant={"outline"}
                        size={"sm"}
                      >
                        Selecionar Cliente
                      </Button>
                      <Button
                        disabled={pagoPeloMesmo}
                        onClick={() => setIsFornecedorSelectOpen(true)}
                        className="h-11 rounded-none hover:cursor-pointer sm:h-9"
                        variant={"outline"}
                        size={"sm"}
                      >
                        Selecionar Fornecedor
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 w-full">
                  <Label htmlFor="nomepagador">
                    Nome do pagador/recebedor <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    disabled={Boolean(selectedCustomer) || Boolean(selectedFornecedor)}
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
                    disabled={Boolean(selectedCustomer) || Boolean(selectedFornecedor)}
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

          </TransactionSection>

          <TransactionSection
            eyebrow="Comprovação"
            title="Documento relacionado"
            description="Nota, recibo ou comprovante que justifica este lançamento."
            icon={FileCheck2}
            action={
              <div className="flex items-center gap-2">
                <Label htmlFor="relacionar-documento" className="cursor-pointer text-xs">
                  Relacionar documento
                </Label>
                <Switch
                  id="relacionar-documento"
                  className="hover:cursor-pointer"
                  checked={relacionarDocumento}
                  onCheckedChange={alternarDocumento}
                />
              </div>
            }
          >

              {relacionarDocumento && (
                <div className="grid gap-4 border border-border bg-muted/10 p-4 sm:grid-cols-3">
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
              {!relacionarDocumento ? (
                <div className="border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  Ative a opção acima para informar os dados do documento.
                </div>
              ) : null}
          </TransactionSection>
        </div>
        <Footer className={RODAPE_FIXO}>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:gap-3">
            <Close asChild>
              <Button className="h-11 w-full rounded-none hover:cursor-pointer sm:h-10 sm:w-auto" variant={"outline"}>
                Cancelar
              </Button>
            </Close>
            <Button
              type="submit"
              form="register-form"
              disabled={isSubmitting || excedeSaldoDisponivel}
              className="h-11 w-full rounded-none hover:cursor-pointer sm:h-10 sm:w-auto"
              onClick={() => void handleCreateTransaction()}
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

    <AlertDialog open={confirmarVencidaAberto} onOpenChange={setConfirmarVencidaAberto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lançamento com vencimento vencido</AlertDialogTitle>
          <AlertDialogDescription>
            {canManageParcelas
              ? "Uma ou mais parcelas têm vencimento no passado. O lançamento será registrado como pendente, já vencido."
              : "A data informada já passou. O lançamento será registrado como pendente, já vencido."}{" "}
            Deseja continuar?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirmarVencidaAberto(false);
              void handleCreateTransaction({ ignorarVencida: true });
            }}
          >
            Registrar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
