import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { Eye, Loader2, Minus, PackagePlus, Plus, Search, TriangleAlert, UserRoundPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Estoque_status, Pagination } from "../../types";
import BotaoNf from "./botao-nota-fiscal";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import formatarEmReal from "@/utils/formatarEmReal";
import { NF } from "./types";
import { formatCpfCnpj } from "../../../clientes/components/customerDialogRegister/utils";
import { formatDate } from "@/utils/formatDate";

import ProductSelect from "@/app/(app)/components/productSelect";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import FornecedorDialog from "../../../configuracoes/tipos/components/fornecedorDialog";
import { DialogProduto } from "../dialog-produto/dialog-produto";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import ValueInput from "../dialog-produto/entrada-valor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banco, Metodo_pagamento } from "../../../(financeiro)/fluxodecaixa/types";
import { Label } from "@/components/ui/label";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../../(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../../(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "../../../(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "../../../(financeiro)/fluxodecaixa/components/search-combobox";

interface EntradaDialogProps {
  children?: React.ReactNode;
  isOpen?: boolean;
  setIsOpen?: (value: boolean) => void;
  notaFiscalRecebidaId?: number;
  search?: string;
  handleGetProducts?: (pageNumber?: number, limit?: number, search?: string, status?: Estoque_status) => void;
  paginantion?: Pagination;
  status?: Estoque_status;
}

interface Parcela {
  id?: number;
  dataVencimento?: Date;
  valor?: number;
}

export default function DialogEntradaFiscal({
  children,
  isOpen,
  setIsOpen,
  notaFiscalRecebidaId,
  search,
  handleGetProducts,
  paginantion,
  status,
}: EntradaDialogProps) {
  const [parsed, setParsed] = useState<NF | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [isSubmiting, setIsSubmiting] = useState(false);

  // estados de modais de produto / fornecedor
  const [isProductOpen, setIsProductOpen] = useState<boolean>(false);
  const [productSelectItemIndex, setProductSelectItemIndex] = useState<number | null>(null);

  const [isFornecedorOpen, setIsFornecedorOpen] = useState<boolean>(false);
  const [isLoadingFornecedor, setIsLoadingFornecedor] = useState<boolean>(false);

  const [selectedProductId, setSelectedProductId] = useState<number | undefined>(undefined);
  const [isProductEditOpen, setIsProductEditOpen] = useState<boolean>(false);
  const [productDialogItemIndex, setProductDialogItemIndex] = useState<number | null>(null);

  const [searchingFornecedor, setSearchingFornecedor] = useState(false);
  const [isPagamentoFuturo, setIsPagamentoFuturo] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);

  const [banks, setBanks] = useState<Banco[]>([]);

  // estados controlados para banco / método / categoria
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">("");
  const [selectedCategoria, setSelectedCategoria] = useState<string>("");
  const [selectedPlanoId, setSelectedPlanoId] = useState<string>("");
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<string>("");
  const { categorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();
  const isCarregandoNotaRecebida = Boolean(isOpen && notaFiscalRecebidaId && !parsed);

  const resetState = () => {
    setParsed(null);
    setFile(undefined);
    setIsSubmiting(false);
    setIsPagamentoFuturo(false);
    setParcelas([]);
    setSelectedBankId("");
    setSelectedMetodo("");
    setSelectedCategoria("");
    setSelectedPlanoId("");
    setSelectedCentroCustoId("");
    setProductSelectItemIndex(null);
    setSelectedProductId(undefined);
    setProductDialogItemIndex(null);
  };

  useEffect(() => {
    if (!isOpen || !notaFiscalRecebidaId) return;

    let cancelled = false;

    const carregarNotaRecebida = async () => {
      setParsed(null);
      setFile(undefined);

      try {
        const xmlResponse = await axios.get(`/api/fiscal/notas-recebidas/${notaFiscalRecebidaId}/xml`, {
          responseType: "blob",
        });
        const formData = new FormData();
        formData.append(
          "file",
          new File([xmlResponse.data], `nfe-${notaFiscalRecebidaId}.xml`, {
            type: "application/xml",
          }),
        );

        const parsedResponse = await axios.post("/api/entradas/nf", formData);
        if (!cancelled) {
          setParsed({
            ...parsedResponse.data.parsed,
            documentoFiscalRecebidoId: notaFiscalRecebidaId,
          });
        }
      } catch (error) {
        if (!cancelled) {
          toast.error("Erro ao carregar nota fiscal", {
            description: isAxiosError(error)
              ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
              : "Não foi possível carregar os dados da nota fiscal selecionada.",
          });
          setIsOpen?.(false);
        }
      }
    };

    void carregarNotaRecebida();
    return () => {
      cancelled = true;
    };
  }, [isOpen, notaFiscalRecebidaId, setIsOpen]);


  const handleGetBanks = async () => {
    setIsLoadingBanks(true);
    try {
      const response = await axios.get("/api/banks");
      if (response.status === 200) {
        const { data } = response;
        setBanks(data.data);
        console.log("Bancos carregados:", data.data);
      }
    } catch (error) {
      console.log("Erro ao buscar bancos:", error);
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const handleGetFornecedor = async () => {
    if (!parsed?.emitente.cnpj) return;

    setIsLoadingFornecedor(true);
    try {
      const response = await axios.get(`/api/tipos/fornecedores/${parsed.emitente.cnpj}?by=cpfcnpj`);
      if (response.status === 200) {
        const fornecedorData = response.data.item;
        console.log("Fornecedor encontrado:", fornecedorData);
        setParsed((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            fornecedorReferente: fornecedorData,
            fornecedorReferenteId: fornecedorData.id,
          };
        });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          // fornecedor não encontrado, segue a vida
          return;
        }
      }
    } finally {
      setIsLoadingFornecedor(false);
    }
  };

  async function handleCreateEntradas() {
    if (!parsed) {
      toast.error("Nenhum arquivo processado.");
      return;
    }

    if (parsed.itens.some((item) => !item.produtoReferenciaId)) {
      toast.error("Todos os itens devem estar vinculados a um produto no sistema.");
      return;
    }

    if (!parsed.fornecedorReferenteId) {
      toast.error("A nota deve estar vinculada a um fornecedor no sistema.");
      return;
    }

    // Validações específicas de pagamento futuro
    if (isPagamentoFuturo) {
      const somaParcelas = parcelas.reduce((sum, parcela) => sum + (parcela.valor ?? 0), 0);

      if (Math.abs(somaParcelas - Number(parsed.totais.valorNota)) > 0.01) {
        toast.error("A soma das parcelas deve ser igual ao valor da nota.");
        return;
      }

      if (!selectedCategoria) {
        toast.error("Selecione uma categoria para as parcelas.");
        return;
      }
    }

    const payload = {
      fornecedorId: parsed.fornecedorReferenteId ?? null,
      numeroNota: parsed.numeroNota ?? null,
      serie: parsed.serie ?? null,
      dataEmissao: parsed.dataEmissao ?? null,
      notaChave: parsed.chaveAcesso ?? null,
      documentoFiscalRecebidoId: parsed.documentoFiscalRecebidoId ?? null,
      valorTotalDocumento: parsed.totais.valorNota,
      fiscal: true,

      itens: parsed.itens
        .filter((item) => item.produtoReferenciaId)
        .map((item) => ({
          produtoId: item.produtoReferenciaId!,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorDesconto: item.valorDesconto ?? 0,
          valorFrete: item.valorFrete ?? 0,
          outrasDespesas: (item.outrasDespesas ?? 0) + (item.valorSeguro ?? 0) + (item.valorIpi ?? 0),
          unidade: item.unidade,
          ncm: String(item.ncm ?? ""),
          cfop: String(item.cfop ?? ""),
        })),

      isPagamentoFuturo,
      parcelas: isPagamentoFuturo
        ? parcelas
          .filter((p) => p.valor && p.dataVencimento)
          .map((p) => ({
            valor: p.valor!,
            dataVencimento: p.dataVencimento!.toISOString().slice(0, 10),
          }))
        : [],

      bancoId: isPagamentoFuturo ? (selectedBankId ? Number(selectedBankId) : null) : null,
      metodoPagamento: isPagamentoFuturo ? (selectedMetodo || null) : null,
      categoria: isPagamentoFuturo ? selectedCategoria : "DESPESAS OPERACIONAIS",
      categoriaId: categorias.find((categoria) => categoria.nome === selectedCategoria)?.id ?? null,
      planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
      centroCustoId: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
      nomePagador: parsed.fornecedorReferente?.nomerazaosocial ?? parsed.emitente.nome ?? "",
      cpfCnpjPagador: parsed.emitente.cnpj?.toString() ?? "",
      descricaoTransacao: parsed.numeroNota != null ? `Compra NF ${parsed.numeroNota}` : "Compra de mercadorias",
    };

    setIsSubmiting(true);
    toast(
      <div className="flex flex-row gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Registrando...</span>
      </div>
    );

    try {
      const response = await axios.post("/api/entradas/fiscal", JSON.stringify(payload));

      if (response.status === 201) {
        toast.success("Entrada registrada com sucesso!");
        resetState();
        setIsOpen?.(false);
        handleGetProducts?.(paginantion?.page ?? 1, paginantion?.limit ?? 20, search, status);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao registrar entrada", {
          description:
            error.response?.data?.details ??
            error.response?.data?.error ??
            error.message,
        });
      }
    } finally {
      setIsSubmiting(false);
    }
  }

  const handleSearchFornecedor = async () => {
    if (!parsed?.fornecedorReferenteId || !parsed.itens?.length) {
      return;
    }

    setSearchingFornecedor(true);

    try {
      const fornecedorId = parsed.fornecedorReferenteId;
      const itensSnapshot = parsed.itens;

      for (const [index, item] of itensSnapshot.entries()) {
        if (item.produtoReferenciaId) continue;

        console.log("Buscando produto para código do fornecedor:", item.codigo);

        try {
          const response = await axios.get("/api/tipos/fornecedores/produtos", {
            params: {
              fornecedorId: fornecedorId,
              codigoFornecedor: item.codigo,
              limit: 1,
            },
          });

          if (response.status === 200) {
            const produtos = response.data.data;

            if (produtos.length > 1) {
              toast.warning(`Mais de um produto encontrado para o código ${item.codigo}.`);
            }

            if (produtos.length === 1) {
              const produto = produtos[0].produto;

              setParsed((prev) => {
                if (!prev) return prev;

                return {
                  ...prev,
                  itens: prev.itens.map((it, i) =>
                    i === index
                      ? {
                        ...it,
                        produtoReferencia: produto,
                        produtoReferenciaId: produto.id,
                      }
                      : it
                  ),
                };
              });

              console.log("Produto do fornecedor encontrado:", produto);
            }
          }
        } catch (error) {
          console.log("Erro ao buscar produto do fornecedor:", error);
        }
      }
    } catch (error) {
      console.log("Erro ao buscar produtos do fornecedor:", error);
      toast.error("Erro ao buscar produtos do fornecedor.", {
        description: String(error),
      });
    } finally {
      setSearchingFornecedor(false);
    }
  };

  function handleClearFile() {
    setFile(undefined);
    setParsed(null);
  }

  useEffect(() => {
    console.log(parsed);
  }, [parsed]);

  useEffect(() => {
    handleSearchFornecedor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.fornecedorReferenteId]);

  useEffect(() => {
    if (parsed?.emitente.cnpj) {
      console.log("Buscando fornecedor para CNPJ:", parsed.emitente.cnpj);
      handleGetFornecedor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.emitente.cnpj]);

  useEffect(() => {
    if (isPagamentoFuturo) {
      handleGetBanks();
    }
  }, [isPagamentoFuturo]);

  const formatNumber = (value: number, decimals = 2) => {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        setIsOpen?.(nextOpen);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="p-0 overflow-hidden h-[600px]" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>Entrada de Produto</DialogTitle>
            <DialogDescription className="flex flex-row items-center justify-between"></DialogDescription>
          </DialogHeader>

          {!parsed && !isCarregandoNotaRecebida && (
            <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 bg-muted px-6 py-10 space-y-2 relative">
              <BotaoNf file={file} setFile={setFile} setParsed={setParsed} />
            </div>
          )}

          {isCarregandoNotaRecebida && (
            <div className="flex h-full min-h-0 items-center justify-center gap-2 bg-muted px-6 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando nota fiscal...
            </div>
          )}

          {parsed && (
            <div className="h-full min-h-0 overflow-auto bg-muted/60 px-6 py-10 space-y-2 relative">
              <div className="inline-flex items-center gap-2 px-2 py-1 bg-muted rounded-md">
                <span className="text-xs text-muted-foreground">1 arquivo selecionado</span>
                <X onClick={handleClearFile} className="w-4 h-4 hover:cursor-pointer text-red-200 hover:text-red-400" />
              </div>
              <Card className="mt-2 w-full max-w-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>Dados da NF-e</span>
                    <div className="flex items-center gap-2">
                      {parsed.documentoFiscalRecebidoId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs hover:cursor-pointer"
                          onClick={() =>
                            window.open(
                              `/nfe/${parsed.documentoFiscalRecebidoId}/danfe?origem=terceiros`,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver DANFE
                        </Button>
                      ) : null}
                      {parsed?.numeroNota && <Badge variant="outline">NF nº {parsed.numeroNota}</Badge>}
                    </div>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Informações identificadas a partir do XML enviado.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <div className="space-y-1 min-w-0 flex flex-col">
                      <p className="text-xs text-muted-foreground">Fornecedor:</p>
                      <span className="text-xs text-wrap max-w-[250px]">
                        {parsed.emitente.nome || "Fornecedor não identificado"}
                      </span>
                      <span className="text-[12px] text-muted-foreground">{parsed.emitente.nomeFantasia}</span>
                      {(parsed.emitente.cnpj || parsed.emitente.ie) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {parsed.emitente.cnpj && (
                            <span>CNPJ: {formatCpfCnpj(parsed.emitente.cnpj.toString(), "JURIDICA")}</span>
                          )}
                          {parsed.emitente.ie && <span>IE: {parsed.emitente.ie}</span>}
                        </div>
                      )}

                      {/* verificador de fornecedor */}
                      <div className="flex flex-row items-center gap-2">
                        <div className="inline-flex items-center gap-2 px-2 py-1 bg-muted rounded-md">
                          <span
                            className={`text-xs text-muted-foreground max-w-[250px] ${!parsed.fornecedorReferenteId && "text-red-400"
                              }`}
                          >
                            {isLoadingFornecedor
                              ? "Buscando fornecedor..."
                              : parsed.fornecedorReferenteId
                                ? `Fornecedor vinculado: ${parsed.fornecedorReferente?.nomefantasia ||
                                parsed.fornecedorReferente?.nomerazaosocial
                                }`
                                : "Fornecedor não cadastrado no sistema"}
                          </span>
                        </div>
                        {parsed.fornecedorReferenteId === undefined && !isLoadingFornecedor && (
                          <FornecedorDialog
                            dialogOpen={isFornecedorOpen}
                            handleGetFornecedor={handleGetFornecedor}
                            setDialogOpen={setIsFornecedorOpen}
                            dadosNovoFornecedor={{
                              cpfcnpj: parsed.emitente.cnpj.toString(),
                              nomefantasia: parsed.emitente.nomeFantasia,
                              ativo: true,
                              bairro: parsed.emitente.endereco.bairro,
                              codigomunicipio: String(parsed.emitente.endereco.codigoMunicipio),
                              endereconumero: String(parsed.emitente.endereco.numero),
                              cep: parsed.emitente.endereco.cep.toString(),
                              endereco: parsed.emitente.endereco.logradouro,
                              cidade: parsed.emitente.endereco.municipio,
                              estado: parsed.emitente.endereco.uf,
                              contato: "",
                              nomerazaosocial: parsed.emitente.nome,
                            }}
                          >
                            <div className="p-1.5 rounded-full bg-primary/20 hover:bg-muted hover:cursor-pointer transition-all">
                              <UserRoundPlus className="w-4 h-4" />
                            </div>
                          </FornecedorDialog>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground text-right space-y-1 min-w-0">
                      {parsed?.dataEmissao && (
                        <div className="flex flex-col">
                          <span>Emissão:</span>
                          <span>{formatDate(parsed?.dataEmissao)}</span>
                        </div>
                      )}
                      {parsed?.totais.valorNota != null && (
                        <p>
                          Valor total: <span className="font-semibold">{formatarEmReal(parsed?.totais.valorNota)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <Separator />

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>
                      Itens na nota: <span className="font-semibold">{parsed.itens.length}</span>
                    </span>
                    {parsed?.itens && (
                      <span>
                        Série: <span className="font-semibold">{parsed.serie}</span>
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {parsed.itens.length > 0 ? (
                  parsed.itens.map((item, index) => (
                    <div key={`${item.codigo}-${index}`} className="border rounded-lg p-4 text-xs not-dark:bg-white">
                      <div className="space-y-2 ">
                        {/* Item number and description */}
                        <div className="pb-2 border-b">
                          <div className="flex flex-row justify-between items-center mb-2">
                            <p className=" font-semibold text-muted-foreground uppercase mb-1">
                              Item {item.numeroItem}
                            </p>
                            <p className=" font-bold">Total: {formatarEmReal(item.valorTotal)}</p>
                          </div>
                          <p className=" font-semibold text-muted-foreground">{item.descricao}</p>
                        </div>

                        {/* All data concatenated in single column */}
                        <div className="space-y-1.5 text-xs grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-2">
                          <p>
                            <span className="text-muted-foreground font-medium">Código:</span>{" "}
                            <span className="font-mono font-semibold">{item.codigo}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">EAN:</span>{" "}
                            <span className="font-mono font-semibold">{item.ean}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">Unidade:</span>{" "}
                            <span className="font-semibold">{item.unidade}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">Qtd:</span>{" "}
                            <span className="font-semibold">{formatNumber(item.quantidade)}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">V. Unitário:</span>{" "}
                            <span className="font-mono font-semibold">{formatarEmReal(item.valorUnitario)}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">NCM:</span>{" "}
                            <span className="font-mono font-semibold">{item.ncm}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">CFOP:</span>{" "}
                            <span className="font-mono font-semibold">{item.cfop}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground font-medium">ICMS:</span>{" "}
                            {/* futuro: exibir aliquota / valor */}
                          </p>
                        </div>
                        <Separator />
                        <div className="flex flex-row items-center gap-2">
                          <div className="inline-flex items-center gap-2 px-2 py-1 bg-muted rounded-md relative">
                            <span
                              className={`text-xs text-muted-foreground max-w-[300px] mr-4 ${searchingFornecedor ? "text-primary" : !item.produtoReferenciaId && "text-red-400"
                                } `}
                            >
                              {searchingFornecedor
                                ? "Buscando produto vinculado..."
                                : item.produtoReferenciaId
                                  ? `Produto vinculado: ${item.produtoReferencia?.titulo}`
                                  : "Produto não vinculado ao estoque"}
                            </span>
                            {item.produtoReferenciaId && (
                              <X
                                onClick={() => {
                                  setParsed((prev) => {
                                    if (!prev) return prev;

                                    return {
                                      ...prev,
                                      itens: prev.itens.map((it, i) =>
                                        i === index
                                          ? {
                                            ...it,
                                            produtoReferenciaId: undefined,
                                            produtoReferencia: undefined,
                                          }
                                          : it
                                      ),
                                    };
                                  });
                                }}
                                className="w-4 h-4 hover:cursor-pointer text-red-200 hover:text-red-400 absolute right-1"
                              />
                            )}
                          </div>

                          {/* SELECT de produto - controlado por índice */}
                          <ProductSelect
                            open={isProductOpen && productSelectItemIndex === index}
                            setOpen={(open) => {
                              if (open) {
                                setIsProductOpen(true);
                                setProductSelectItemIndex(index);
                              } else {
                                setIsProductOpen(false);
                                setProductSelectItemIndex(null);
                              }
                            }}
                            OnSelect={(p) => {
                              setParsed((prev) => {
                                if (!prev) return prev;

                                return {
                                  ...prev,
                                  itens: prev.itens.map((it, i) =>
                                    i === index
                                      ? {
                                        ...it,
                                        produtoReferencia: p,
                                        produtoReferenciaId: p.id,
                                      }
                                      : it
                                  ),
                                };
                              });
                            }}
                          >
                            <div className="p-1.5 rounded-full bg-primary/20 hover:bg-muted hover:cursor-pointer transition-all">
                              <Search className="w-4 h-4" />
                            </div>
                          </ProductSelect>

                          {/* DIALOG de novo produto / edição após criar */}
                          {(!item.produtoReferenciaId || (isProductEditOpen && productDialogItemIndex === index)) && (
                            <DialogProduto
                              handleSearchFornecedor={handleSearchFornecedor}
                              productId={selectedProductId}
                              isOpen={isProductEditOpen && productDialogItemIndex === index}
                              setIsOpen={(open) => {
                                if (open) {
                                  if (!parsed.fornecedorReferenteId) {
                                    toast.error("Cadastre um fornecedor para habilitar o cadastro de produto");
                                    return;
                                  }
                                  setIsProductEditOpen(true);
                                  setProductDialogItemIndex(index);
                                } else {
                                  setIsProductEditOpen(false);
                                  setProductDialogItemIndex(null);
                                }
                              }}
                              setSelectedProductId={setSelectedProductId}
                              newProductData={{
                                titulo: item.descricao,
                                referencia: item.codigo,
                                ncm: item.ncm.toString(),
                                cfop: item.cfop.toString(),
                                precovenda: item.valorUnitario,
                                estoque: 0,
                                fornecedorid: parsed.fornecedorReferenteId || undefined,
                                codigofornecedor: item.codigo,
                              }}
                            >
                              {!item.produtoReferenciaId && (
                                <div className="p-1.5 rounded-full bg-primary/20 hover:bg-muted hover:cursor-pointer transition-all">
                                  <PackagePlus className="w-4 h-4" />
                                </div>
                              )}
                            </DialogProduto>
                          )}
                        </div>

                        {/* Avisos de entradas já registradas desta mesma NF para este produto */}
                        <div className="pt-2 border-t mt-3 space-y-1">
                          {item.produtoReferencia?.entradas
                            ?.filter((entrada: any) => {
                              return String(entrada?.entradainfo.notachave ?? "") === String(parsed.chaveAcesso ?? "");
                            })
                            .map((entrada: any) => (
                              <div
                                key={entrada.entradainfo.id}
                                className="inline-flex items-center gap-2 px-2 py-1 bg-amber-50 rounded-md border border-amber-200"
                              >
                                <span className="text-[10px] text-amber-700 flex flex-row flex-nowrap items-center gap-1">
                                  <TriangleAlert className="w-3 h-3" />
                                  Existe entrada de <span className="font-semibold">{entrada.quantidade}</span> un.
                                  desta mesma NF para este produto em: <span>{formatDate(entrada.entradainfo.created_at)}</span>
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">Nenhum item para exibir</div>
                )}
              </div>

              <Separator />

              {/* PAGAMENTO FUTURO / PARCELAS */}
              <div className="space-y-2 mt-4">
                <div className="flex w-full justify-start flex-col gap-4">
                  <div className="flex flex-row items-center gap-2">
                    <span
                      className={`text-xs ${isPagamentoFuturo ? "text-accent-foreground" : "text-muted-foreground"
                        } transition-all`}
                    >
                      Lançar parcelas futuras no financeiro (opcional)
                    </span>
                    <Switch
                      checked={isPagamentoFuturo}
                      onCheckedChange={(b) => {
                        setIsPagamentoFuturo(b);
                        if (b) {
                          setParcelas((prev) =>
                            prev.length ? prev : [{ id: 1, dataVencimento: undefined, valor: 0 }]
                          );
                        } else {
                          setParcelas([]);
                          setSelectedBankId("");
                          setSelectedMetodo("");
                          setSelectedCategoria("");
                          setSelectedPlanoId("");
                          setSelectedCentroCustoId("");
                        }
                      }}
                    />
                  </div>

                  {isPagamentoFuturo && (
                    <div className="flex flex-col gap-2">
                      {parcelas.map((parcela, index) => (
                        <div
                          key={parcela.id ?? index}
                          className="flex flex-row bg-muted-foreground/5 py-6 px-3 rounded-xl gap-4 items-center justify-between relative"
                        >
                          <span className="absolute left-3 top-1 text-xs text-muted-foreground">
                            {index + 1}ª parcela
                          </span>
                          <button
                            type="button"
                            className="bg-red-500 not-dark:bg-red-400 hover:cursor-pointer rounded-full w-5 h-5 flex items-center justify-center"
                            onClick={() => {
                              if (parcelas.length === 1) {
                                toast.error("É necessário ao menos uma parcela");
                                return;
                              }
                              setParcelas((prev) => prev.filter((_, i) => i !== index));
                            }}
                          >
                            <Minus className="w-3 h-3" />
                          </button>

                          {/* Data vencimento */}
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Data Vencimento:</span>
                            <DatePicker
                              className="not-dark:bg-white"
                              value={
                                parcela.dataVencimento
                                  ? new Date(parcela.dataVencimento).toISOString().slice(0, 10)
                                  : ""
                              }
                              onChange={(value) => {
                                setParcelas((prev) =>
                                  prev.map((p, i) =>
                                    i === index
                                      ? {
                                        ...p,
                                        dataVencimento: value ? new Date(`${value}T00:00:00`) : undefined,
                                      }
                                      : p
                                  )
                                );
                              }}
                            />
                          </div>

                          {/* Valor */}
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Valor:</span>
                            <ValueInput
                              price={parcela.valor ?? 0}
                              setPrice={(valor) =>
                                setParcelas((prev) =>
                                  prev.map((p, i) =>
                                    i === index
                                      ? {
                                        ...p,
                                        valor,
                                      }
                                      : p
                                  )
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}

                      {/* Totais */}
                      <div className="text-xs text-muted-foreground flex flex-row items-center justify-between">
                        <span>Valor total: {formatarEmReal(parsed.totais.valorNota)}</span>
                        <span>
                          Soma das parcelas:{" "}
                          {formatarEmReal(parcelas.reduce((sum, parcela) => sum + (parcela.valor ?? 0), 0))}
                        </span>
                      </div>

                      {/* Adicionar parcela */}
                      <div
                        className="flex flex-row gap-2 items-center mt-3 hover:cursor-pointer group w-max"
                        onClick={() =>
                          setParcelas((prev) => [
                            ...prev,
                            {
                              id: Date.now(),
                              dataVencimento: undefined,
                              valor: 0,
                            },
                          ])
                        }
                      >
                        <Plus className="w-4 h-4 text-green-300 group-hover:text-green-600" />
                        <span className="text-xs text-card-foreground">Adicionar Parcela</span>
                      </div>

                      {/* Banco / método / categoria */}
                      <div className="grid mt-2 space-y-2">
                        <div className="flex flex-row space-x-2">
                          <Label className="text-muted-foreground w-1/2">Banco:</Label>
                          <Select value={selectedBankId} onValueChange={(v) => setSelectedBankId(v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={isLoadingBanks ? "Carregando..." : "Selecione"} />
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

                        <div className="flex flex-row space-x-2">
                          <Label className="text-muted-foreground w-1/2">Método:</Label>
                          <Select
                            value={selectedMetodo}
                            onValueChange={(v) => setSelectedMetodo(v as Metodo_pagamento)}
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

                        <div className="flex flex-row space-x-2">
                          <Label className="text-muted-foreground w-1/2">Categoria:</Label>
                          <Select
                            value={selectedCategoria}
                            onValueChange={(value) => setSelectedCategoria(value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione" />
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

                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)] sm:items-center">
                          <Label className="text-muted-foreground">Plano de conta:</Label>
                          <PlanoContaCombobox
                            value={selectedPlanoId}
                            groups={gruposPlanosDeConta}
                            loading={loadingPlanos}
                            clearable
                            onClear={() => setSelectedPlanoId("")}
                            onValueChange={(value) => setSelectedPlanoId(value)}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)] sm:items-center">
                          <Label className="text-muted-foreground">Centro de custo:</Label>
                          <SearchCombobox
                            value={selectedCentroCustoId}
                            options={centrosCusto.map((centro) => ({
                              value: String(centro.id),
                              label: centro.nome,
                              description: centro.descricao ?? undefined,
                            }))}
                            loading={loadingCentrosCusto}
                            clearable
                            clearLabel="Sem centro de custo"
                            placeholder="Selecione o centro de custo"
                            searchPlaceholder="Pesquisar centro de custo..."
                            onValueChange={setSelectedCentroCustoId}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Separator />
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Ver JSON completo</summary>
                <pre className="mt-2 text-xs max-h-80 text-wrap text-muted-foreground">
                  {JSON.stringify(parsed, null, 1)}
                </pre>
              </details>
            </div>
          )}

          <DialogFooter className="px-6 py-4">
            <div className="flex sm:flex-row gap-3 sm:gap-4">
              <Button
                onClick={handleCreateEntradas}
                className="hover:cursor-pointer"
                disabled={isCarregandoNotaRecebida || isLoadingFornecedor || searchingFornecedor || isSubmiting}
              >
                Registrar
              </Button>
              <DialogClose asChild>
                <Button className="hover:cursor-pointer" variant="outline">
                  Cancelar
                </Button>
              </DialogClose>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
