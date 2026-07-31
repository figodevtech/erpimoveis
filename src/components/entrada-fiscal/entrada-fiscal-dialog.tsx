"use client";

import axios, { isAxiosError } from "axios";
import { addMonths, format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Eye,
  FileWarning,
  Loader2,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  UserRoundPlus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogClose,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";

import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import ProductSelect from "@/app/(app)/components/productSelect";
import BotaoNf from "@/app/(app)/(pages)/estoque/components/dialog-entrada/botao-nota-fiscal";
import type { NF } from "@/app/(app)/(pages)/estoque/components/dialog-entrada/types";
import type { Fornecedor } from "@/app/(app)/(pages)/estoque/types";
import { DialogProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto";
import ValueInput from "@/app/(app)/(pages)/estoque/components/dialog-produto/entrada-valor";
import FornecedorDialog from "@/app/(app)/(pages)/configuracoes/tipos/components/fornecedorDialog";
import { ItemDialog } from "@/app/(app)/(pages)/usoconsumo/components/item-dialog";
import { ItemSelectDialog } from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { Metodo_pagamento } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import type { Banco } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";

import {
  DESTINO_LABEL,
  apenasDigitos,
  linhaVinculada,
  rotuloVinculo,
  totalDaLinha,
  unidadeNormalizada,
  type DestinoEntrada,
  type LinhaFiscal,
  type NotaFiscalParseada,
  type Parcela,
} from "./types";

type DuplicidadeUsoConsumo = {
  id: number;
  created_at: string;
  itens: Array<{
    item_id: number;
    numero_item_fiscal?: number | null;
    quantidade: number;
  }>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-carrega uma NF-e já recebida (usado pela tela de notas fiscais recebidas). */
  notaFiscalRecebidaId?: number;
  /** Restringe os destinos oferecidos. Padrão: os dois. */
  destinosPermitidos?: DestinoEntrada[];
  onSaved?: () => void | Promise<void>;
};

const TODOS_DESTINOS: DestinoEntrada[] = ["ESTOQUE", "USOCONSUMO"];

function textoErro(error: unknown) {
  return isAxiosError(error)
    ? (error.response?.data?.details ??
        error.response?.data?.detail ??
        error.response?.data?.error ??
        error.message)
    : "Erro inesperado.";
}

export function EntradaFiscalDialog({
  open,
  onOpenChange,
  notaFiscalRecebidaId,
  destinosPermitidos = TODOS_DESTINOS,
  onSaved,
}: Props) {
  const [parsed, setParsed] = useState<NotaFiscalParseada | null>(null);
  const [file, setFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [carregandoNota, setCarregandoNota] = useState(false);
  const [buscandoFornecedor, setBuscandoFornecedor] = useState(false);
  const [carregandoApropriacoes, setCarregandoApropriacoes] = useState(false);
  const [vinculandoIndices, setVinculandoIndices] = useState<number[]>([]);
  const [duplicidades, setDuplicidades] = useState<DuplicidadeUsoConsumo[]>([]);

  const [fornecedorDialogOpen, setFornecedorDialogOpen] = useState(false);
  const [fornecedorSelectOpen, setFornecedorSelectOpen] = useState(false);

  const [produtoSelectIndex, setProdutoSelectIndex] = useState<number | null>(
    null,
  );
  const [produtoDialogIndex, setProdutoDialogIndex] = useState<number | null>(
    null,
  );
  const [produtoSelecionadoId, setProdutoSelecionadoId] = useState<
    number | undefined
  >(undefined);

  const [itemSelectIndex, setItemSelectIndex] = useState<number | null>(null);
  const [itemDialogIndex, setItemDialogIndex] = useState<number | null>(null);
  const [itemEmEdicao, setItemEmEdicao] = useState<UsoConsumoItem | null>(null);
  const [itemValoresIniciais, setItemValoresIniciais] =
    useState<Record<string, string | number | null>>();
  const [grupos, setGrupos] = useState<UsoConsumoGrupo[]>([]);

  const [pagamentoFuturo, setPagamentoFuturo] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [bancoId, setBancoId] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [categoria, setCategoria] = useState("");
  const [planoId, setPlanoId] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");

  const { categorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const linhasRef = useRef<LinhaFiscal[]>([]);
  useEffect(() => {
    linhasRef.current = parsed?.itens ?? [];
  }, [parsed?.itens]);

  const linhasDisponiveis = useMemo(
    () => parsed?.itens.filter((linha) => !linha.destinoApropriado) ?? [],
    [parsed],
  );
  const totalDestinado = useMemo(
    () =>
      Number(
        linhasDisponiveis
          .reduce((soma, linha) => soma + totalDaLinha(linha), 0)
          .toFixed(2),
      ),
    [linhasDisponiveis],
  );
  const linhasEstoque = useMemo(
    () => linhasDisponiveis.filter((linha) => linha.destino === "ESTOQUE"),
    [linhasDisponiveis],
  );
  const linhasUsoConsumo = useMemo(
    () => linhasDisponiveis.filter((linha) => linha.destino === "USOCONSUMO"),
    [linhasDisponiveis],
  );
  const semDestino = linhasDisponiveis.some((linha) => !linha.destino);
  const semVinculo = linhasDisponiveis.some((linha) => !linhaVinculada(linha));
  const notaDividida = linhasEstoque.length > 0 && linhasUsoConsumo.length > 0;

  const ocupado =
    carregandoNota ||
    buscandoFornecedor ||
    carregandoApropriacoes ||
    vinculandoIndices.length > 0;

  function reset() {
    setParsed(null);
    setFile(undefined);
    setSubmitting(false);
    // Estas flags ficavam de fora do reset e travavam o botao Registrar entre sessoes.
    setCarregandoNota(false);
    setBuscandoFornecedor(false);
    setCarregandoApropriacoes(false);
    setVinculandoIndices([]);
    setDuplicidades([]);
    setFornecedorDialogOpen(false);
    setFornecedorSelectOpen(false);
    setProdutoSelectIndex(null);
    setProdutoDialogIndex(null);
    setProdutoSelecionadoId(undefined);
    setItemSelectIndex(null);
    setItemDialogIndex(null);
    setItemEmEdicao(null);
    setItemValoresIniciais(undefined);
    setPagamentoFuturo(false);
    setParcelas([]);
    setBancoId("");
    setMetodo("");
    setCategoria("");
    setPlanoId("");
    setCentroCustoId("");
  }

  const carregarGrupos = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/usoconsumo/grupos");
      setGrupos(data.data ?? []);
    } catch {
      // Grupos so fazem falta ao criar um item de uso/consumo; o erro aparece la.
    }
  }, []);

  useEffect(() => {
    if (open) void carregarGrupos();
    else reset();
  }, [open, carregarGrupos]);

  const receberNota = useCallback((nota: NF | null) => {
    if (!nota) {
      setParsed(null);
      setDuplicidades([]);
      setVinculandoIndices([]);
      return;
    }
    // Toda troca de nota zera o estado derivado da anterior.
    setDuplicidades([]);
    setVinculandoIndices([]);
    setParsed({
      ...nota,
      fornecedorReferente: undefined,
      fornecedorReferenteId: undefined,
      itens: nota.itens.map((item) => ({ ...item })),
    });
  }, []);

  // Pre-carga de uma NF-e ja recebida.
  useEffect(() => {
    if (!open || !notaFiscalRecebidaId) return;
    let cancelado = false;
    setCarregandoNota(true);
    void (async () => {
      try {
        const xml = await axios.get(
          `/api/fiscal/notas-recebidas/${notaFiscalRecebidaId}/xml`,
          { responseType: "blob" },
        );
        const form = new FormData();
        form.append(
          "file",
          new File([xml.data], `nfe-${notaFiscalRecebidaId}.xml`, {
            type: "application/xml",
          }),
        );
        const resposta = await axios.post("/api/entradas/nf", form);
        if (cancelado) return;
        receberNota({
          ...resposta.data.parsed,
          documentoFiscalRecebidoId: notaFiscalRecebidaId,
        });
      } catch (error) {
        if (cancelado) return;
        toast.error("Erro ao carregar nota fiscal", {
          description: textoErro(error),
        });
        onOpenChange(false);
      } finally {
        // Sempre libera: um cancelamento nao pode deixar a flag presa.
        setCarregandoNota(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [open, notaFiscalRecebidaId, receberNota, onOpenChange]);

  const buscarFornecedor = useCallback(async () => {
    const cnpj = apenasDigitos(parsed?.emitente?.cnpj);
    if (!cnpj) return;
    setBuscandoFornecedor(true);
    try {
      const { data } = await axios.get(
        `/api/tipos/fornecedores/${cnpj}?by=cpfcnpj`,
      );
      setParsed((atual) =>
        atual
          ? {
              ...atual,
              fornecedorReferente: data.item,
              fornecedorReferenteId: Number(data.item.id),
            }
          : atual,
      );
    } catch (error) {
      setParsed((atual) =>
        atual
          ? {
              ...atual,
              fornecedorReferente: undefined,
              fornecedorReferenteId: undefined,
            }
          : atual,
      );
      if (!isAxiosError(error) || error.response?.status !== 404) {
        toast.error("Não foi possível identificar o fornecedor.", {
          description: textoErro(error),
        });
      }
    } finally {
      setBuscandoFornecedor(false);
    }
  }, [parsed?.emitente?.cnpj]);

  useEffect(() => {
    if (parsed?.emitente?.cnpj && !parsed.fornecedorReferenteId)
      void buscarFornecedor();
  }, [buscarFornecedor, parsed?.emitente?.cnpj, parsed?.fornecedorReferenteId]);

  function selecionarFornecedor(fornecedor: Fornecedor) {
    if (
      apenasDigitos(fornecedor.cpfcnpj) !==
      apenasDigitos(parsed?.emitente?.cnpj)
    ) {
      toast.error("O fornecedor selecionado não corresponde ao CNPJ da NF-e.");
      return;
    }
    setParsed((atual) =>
      atual
        ? {
            ...atual,
            fornecedorReferenteId: fornecedor.id,
            fornecedorReferente: fornecedor,
          }
        : atual,
    );
    setFornecedorSelectOpen(false);
  }

  // Itens ja destinados em outra entrada desta mesma nota.
  useEffect(() => {
    const documentoId = parsed?.documentoFiscalRecebidoId;
    if (!documentoId) return;
    let cancelado = false;
    setCarregandoApropriacoes(true);
    void axios
      .get("/api/entradas/apropriacoes", { params: { documentoId } })
      .then((resposta) => {
        if (cancelado) return;
        const mapa = new Map<number, "PRODUTO" | "USOCONSUMO">(
          (resposta.data.data ?? []).map(
            (linha: {
              numero_item: number;
              destino: "PRODUTO" | "USOCONSUMO";
            }) => [Number(linha.numero_item), linha.destino],
          ),
        );
        setParsed((atual) =>
          atual && atual.documentoFiscalRecebidoId === documentoId
            ? {
                ...atual,
                itens: atual.itens.map((item) => ({
                  ...item,
                  destinoApropriado: mapa.get(Number(item.numeroItem)),
                })),
              }
            : atual,
        );
      })
      .catch((error) => {
        if (cancelado) return;
        toast.error("Não foi possível verificar os itens já destinados.", {
          description: textoErro(error),
        });
      })
      .finally(() => {
        // Sem guarda de cancelamento: a flag precisa voltar mesmo se a nota trocou.
        setCarregandoApropriacoes(false);
      });
    return () => {
      cancelado = true;
    };
  }, [parsed?.documentoFiscalRecebidoId]);

  // Duplicidade so existe no lado de uso e consumo.
  useEffect(() => {
    const chave = apenasDigitos(parsed?.chaveAcesso);
    if (chave.length !== 44) {
      setDuplicidades([]);
      return;
    }
    let cancelado = false;
    void axios
      .get("/api/usoconsumo/entradas/duplicidades", {
        params: { chaveNfe: chave },
      })
      .then((resposta) => {
        if (!cancelado) setDuplicidades(resposta.data.data ?? []);
      })
      .catch(() => {
        if (!cancelado) setDuplicidades([]);
      });
    return () => {
      cancelado = true;
    };
  }, [parsed?.chaveAcesso]);

  function atualizarLinha(indice: number, mudanca: Partial<LinhaFiscal>) {
    setParsed((atual) =>
      atual
        ? {
            ...atual,
            itens: atual.itens.map((linha, i) =>
              i === indice ? { ...linha, ...mudanca } : linha,
            ),
          }
        : atual,
    );
  }

  /**
   * A busca do vínculo só faz sentido depois do destino escolhido: cada destino tem
   * o seu próprio catálogo e o seu próprio endpoint de procura.
   */
  const vincularPorDestino = useCallback(
    async (indice: number, destino: DestinoEntrada) => {
      const linha = linhasRef.current[indice];
      const fornecedorId = parsed?.fornecedorReferenteId;
      if (!linha || !fornecedorId || linha.destinoApropriado) return;

      setVinculandoIndices((atual) =>
        atual.includes(indice) ? atual : [...atual, indice],
      );
      try {
        if (destino === "ESTOQUE") {
          const { data } = await axios.get("/api/tipos/fornecedores/produtos", {
            params: { fornecedorId, codigoFornecedor: linha.codigo, limit: 1 },
          });
          const encontrado = (data.data ?? [])[0]?.produto;
          if (encontrado) {
            atualizarLinha(indice, {
              produtoReferenciaId: encontrado.id,
              produtoReferencia: encontrado,
            });
          }
        } else {
          const ean = String(linha.ean ?? "");
          const busca =
            ean && ean !== "SEM GTIN"
              ? ean
              : String(linha.codigo || linha.descricao || "");
          const { data } = await axios.get("/api/usoconsumo/itens/select", {
            params: {
              search: busca,
              fornecedorId,
              codigoFornecedor: linha.codigo,
            },
          });
          const opcoes = data.data ?? [];
          let escolhido = opcoes.find(
            (item: { id: number }) =>
              data.suggestedId && item.id === Number(data.suggestedId),
          );
          escolhido ??= opcoes.find(
            (item: { codigobarras?: string }) =>
              ean &&
              ean !== "SEM GTIN" &&
              String(item.codigobarras ?? "") === ean,
          );
          if (!escolhido && data.suggestedId) {
            const detalhe = await axios.get(
              `/api/usoconsumo/itens/${data.suggestedId}`,
            );
            escolhido = detalhe.data.data;
          }
          if (escolhido) {
            atualizarLinha(indice, {
              itemReferenciaId: escolhido.id,
              itemReferencia: escolhido,
            });
          }
        }
      } catch {
        // Vínculo não encontrado não é erro: o usuário seleciona ou cadastra à mão.
      } finally {
        // Sempre libera o índice, mesmo se a nota tiver trocado no meio da busca.
        setVinculandoIndices((atual) => atual.filter((i) => i !== indice));
      }
    },
    [parsed?.fornecedorReferenteId],
  );

  function escolherDestino(indice: number, destino: DestinoEntrada) {
    // Trocar de destino invalida o vínculo do catálogo anterior.
    atualizarLinha(indice, {
      destino,
      produtoReferenciaId: undefined,
      produtoReferencia: undefined,
      itemReferenciaId: undefined,
      itemReferencia: undefined,
    });
    void vincularPorDestino(indice, destino);
  }

  async function carregarBancos() {
    try {
      const { data } = await axios.get("/api/banks");
      setBancos(data.data ?? []);
    } catch {
      // Banco é opcional no lançamento futuro.
    }
  }

  useEffect(() => {
    if (pagamentoFuturo) void carregarBancos();
  }, [pagamentoFuturo]);

  function abrirCadastroItemUso(indice: number) {
    if (!parsed?.fornecedorReferenteId) {
      toast.error("Cadastre ou selecione o fornecedor antes de criar o item.");
      return;
    }
    const linha = parsed.itens[indice];
    setItemEmEdicao(null);
    setItemDialogIndex(indice);
    setItemValoresIniciais({
      titulo: String(linha.descricao || `Item ${linha.codigo || "NF-e"}`),
      referencia: String(linha.codigo || ""),
      codigobarras: String(
        linha.ean && String(linha.ean) !== "SEM GTIN" ? linha.ean : "",
      ),
      unidade: unidadeNormalizada(linha.unidade),
      estoqueInicial: 0,
      estoqueminimo: 0,
      precocompra: Number(linha.valorUnitario || 0),
      ncm: String(linha.ncm ?? ""),
      cfop_entrada: String(linha.cfop ?? ""),
    });
  }

  async function selecionarItemUsoPorId(indice: number, id: number) {
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${id}`);
      atualizarLinha(indice, {
        itemReferenciaId: id,
        itemReferencia: data.data,
      });
    } catch (error) {
      toast.error("Não foi possível carregar o item selecionado.", {
        description: textoErro(error),
      });
    }
  }

  function montarFinanceiro() {
    const fornecedor = parsed?.fornecedorReferente;
    const categoriaOpcao = categorias.find((item) => item.nome === categoria);
    return {
      isPagamentoFuturo: pagamentoFuturo,
      parcelas: parcelas.map((parcela) => ({
        valor: parcela.valor,
        dataVencimento: parcela.dataVencimento,
      })),
      bancoId: bancoId ? Number(bancoId) : null,
      metodoPagamento: metodo || null,
      categoria: categoria || "DESPESAS OPERACIONAIS",
      categoriaId: categoriaOpcao?.id ?? null,
      planoContaId: planoId ? Number(planoId) : null,
      centroCustoId: centroCustoId ? Number(centroCustoId) : null,
      nomePagador: fornecedor?.nomerazaosocial ?? parsed?.emitente?.nome ?? "",
      cpfCnpjPagador: String(
        fornecedor?.cpfcnpj ?? parsed?.emitente?.cnpj ?? "",
      ),
      descricaoTransacao:
        parsed?.numeroNota != null
          ? `Compra NF ${parsed.numeroNota}`
          : "Compra de mercadorias",
    };
  }

  function itensEstoquePayload() {
    return linhasEstoque.map((linha) => ({
      produtoId: linha.produtoReferenciaId!,
      numeroItemFiscal: Number(linha.numeroItem),
      quantidade: linha.quantidade,
      valorUnitario: linha.valorUnitario,
      valorDesconto: linha.valorDesconto ?? 0,
      valorFrete: linha.valorFrete ?? 0,
      outrasDespesas:
        Number(linha.outrasDespesas ?? 0) +
        Number(linha.valorSeguro ?? 0) +
        Number(linha.valorIpi ?? 0),
      unidade: linha.unidade,
      ncm: String(linha.ncm ?? ""),
      cfop: String(linha.cfop ?? ""),
      referencia: String(linha.codigo ?? ""),
      titulo: String(linha.descricao ?? ""),
    }));
  }

  function itensUsoConsumoPayload() {
    return linhasUsoConsumo.map((linha) => ({
      item_id: linha.itemReferenciaId!,
      numero_item_fiscal: Number(linha.numeroItem),
      codigo_fornecedor: String(linha.codigo ?? ""),
      quantidade: Number(linha.quantidade),
      valor_unitario_compra: Number(linha.valorUnitario),
      valor_desconto: Number(linha.valorDesconto ?? 0),
      valor_frete: Number(linha.valorFrete ?? 0),
      outras_despesas:
        Number(linha.valorSeguro ?? 0) +
        Number(linha.outrasDespesas ?? 0) +
        Number(linha.valorIpi ?? 0),
      unidade: unidadeNormalizada(linha.unidade),
      ncm: String(linha.ncm ?? ""),
      cfop: String(linha.cfop ?? ""),
      titulo: String(linha.descricao ?? ""),
      referencia: String(linha.codigo ?? ""),
    }));
  }

  async function registrar() {
    if (!parsed) return toast.error("Nenhuma nota fiscal processada.");
    if (!parsed.fornecedorReferenteId)
      return toast.error(
        "A nota deve estar vinculada a um fornecedor do sistema.",
      );
    if (!linhasDisponiveis.length)
      return toast.error("Todos os itens desta nota já foram destinados.");
    if (semDestino)
      return toast.error(
        "Escolha o destino de todos os itens: estoque de revenda ou uso e consumo.",
      );
    if (semVinculo)
      return toast.error("Vincule todos os itens ao seu respectivo cadastro.");
    if (linhasUsoConsumo.length && duplicidades.length) {
      return toast.error(
        "Esta NF-e já possui uma entrada confirmada no estoque de uso/consumo.",
      );
    }
    if (pagamentoFuturo) {
      if (!categoria)
        return toast.error("Selecione a categoria do lançamento financeiro.");
      if (
        !parcelas.length ||
        parcelas.some((p) => !p.dataVencimento || p.valor <= 0)
      ) {
        return toast.error(
          "Informe vencimento e valor positivo em todas as parcelas.",
        );
      }
      const soma = parcelas.reduce(
        (total, parcela) => total + parcela.valor,
        0,
      );
      if (Math.abs(soma - totalDestinado) > 0.01) {
        return toast.error(
          "A soma das parcelas deve ser igual ao valor destinado.",
        );
      }
    }

    const financeiro = montarFinanceiro();
    const comum = {
      fornecedorId: parsed.fornecedorReferenteId,
      numeroNota: parsed.numeroNota ?? null,
      serie: parsed.serie ?? null,
      dataEmissao: parsed.dataEmissao ?? null,
      notaChave: parsed.chaveAcesso ?? null,
      documentoFiscalRecebidoId: parsed.documentoFiscalRecebidoId ?? null,
    };

    setSubmitting(true);
    try {
      if (notaDividida) {
        await axios.post("/api/entradas/fiscal/mista", {
          ...comum,
          ...financeiro,
          itensProduto: itensEstoquePayload(),
          itensUsoConsumo: itensUsoConsumoPayload(),
        });
      } else if (linhasEstoque.length) {
        await axios.post("/api/entradas/fiscal", {
          ...comum,
          ...financeiro,
          fiscal: true,
          valorTotalDocumento: totalDestinado,
          itens: itensEstoquePayload(),
        });
      } else {
        await axios.post("/api/usoconsumo/entradas/fiscal", {
          fornecedor_id: parsed.fornecedorReferenteId,
          chave_nfe: parsed.chaveAcesso,
          numero_nota: String(parsed.numeroNota ?? ""),
          serie_nota: String(parsed.serie ?? ""),
          data_emissao: parsed.dataEmissao,
          documento_fiscal_recebido_id: parsed.documentoFiscalRecebidoId,
          itens: itensUsoConsumoPayload(),
          transacoes: pagamentoFuturo
            ? montarTransacoesUsoConsumo(financeiro)
            : [],
        });
      }
      toast.success("Entrada fiscal registrada.");
      reset();
      onOpenChange(false);
      await onSaved?.();
    } catch (error) {
      toast.error("Entrada fiscal não registrada.", {
        description: textoErro(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function montarTransacoesUsoConsumo(
    financeiro: ReturnType<typeof montarFinanceiro>,
  ) {
    const agora = new Date().toISOString();
    return parcelas.map((parcela, indice) => ({
      descricao: `${financeiro.descricaoTransacao}${parcelas.length > 1 ? ` - Parcela ${indice + 1}/${parcelas.length}` : ""}`,
      valor: parcela.valor,
      data: agora,
      vencimento_em: parcela.dataVencimento
        ? `${parcela.dataVencimento}T12:00:00`
        : null,
      metodopagamento: financeiro.metodoPagamento,
      categoria: financeiro.categoria,
      categoria_id: financeiro.categoriaId,
      banco_id: financeiro.bancoId,
      nomepagador: financeiro.nomePagador || "Fornecedor",
      cpfcnpjpagador: financeiro.cpfCnpjPagador || "NAO INFORMADO",
      pendente: true,
      plano_de_conta_id: financeiro.planoContaId,
      plano_de_conta:
        gruposPlanosDeConta
          .flatMap((g) => g.planos ?? [])
          .find((p) => String(p.id) === planoId)?.nome ?? null,
      centro_custo_id: financeiro.centroCustoId,
      centro_custo:
        centrosCusto.find((c) => String(c.id) === centroCustoId)?.nome ?? null,
    }));
  }

  const podeRegistrar =
    Boolean(parsed) &&
    !ocupado &&
    !submitting &&
    linhasDisponiveis.length > 0 &&
    !semDestino &&
    !semVinculo;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(proximo) => {
          if (submitting) return;
          if (!proximo) reset();
          onOpenChange(proximo);
        }}
      >
        <DialogContent
          className="h-[600px] overflow-hidden p-0"
          onDoubleClick={(evento) => evento.stopPropagation()}
        >
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <DialogTitle>Entrada por Nota Fiscal</DialogTitle>
              <DialogDescription className="text-xs">
                Cada item da nota vai para o estoque de revenda ou para uso e
                consumo.
              </DialogDescription>
            </DialogHeader>

            {carregandoNota ? (
              <div className="flex h-full min-h-0 items-center justify-center gap-2 bg-muted px-6 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando nota fiscal...
              </div>
            ) : !parsed ? (
              <div className="relative h-full min-h-0 space-y-2 overflow-auto bg-muted px-6 py-10 dark:bg-muted-foreground/5">
                <BotaoNf
                  file={file}
                  setFile={setFile}
                  setParsed={receberNota}
                />
              </div>
            ) : (
              <div className="relative h-full min-h-0 space-y-2 overflow-auto bg-muted/60 px-6 py-10">
                <div className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1">
                  <span className="text-xs text-muted-foreground">
                    1 nota selecionada
                  </span>
                  <X
                    className="h-4 w-4 cursor-pointer text-red-200 hover:text-red-400"
                    onClick={() => {
                      setFile(undefined);
                      receberNota(null);
                    }}
                  />
                </div>

                <Card className="mt-2 w-full max-w-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
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
                        <Badge variant="outline">
                          NF nº {parsed.numeroNota || "—"}
                        </Badge>
                      </div>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Informações identificadas a partir do XML enviado.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Fornecedor:
                        </p>
                        <span className="max-w-[250px] text-wrap text-xs">
                          {parsed.emitente.nome ||
                            "Fornecedor não identificado"}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {parsed.emitente.nomeFantasia}
                        </span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            CNPJ:{" "}
                            {String(parsed.emitente.cnpj || "Não informado")}
                          </span>
                          {parsed.emitente.ie ? (
                            <span>IE: {parsed.emitente.ie}</span>
                          ) : null}
                        </div>
                        <div className="flex min-w-0 flex-row items-center gap-2">
                          {parsed.fornecedorReferenteId ? (
                            <FornecedorSelect
                              open={fornecedorSelectOpen}
                              setOpen={setFornecedorSelectOpen}
                              OnSelect={selecionarFornecedor}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto min-w-0 max-w-[250px] justify-start gap-2 bg-muted px-2 py-1 text-left text-xs font-normal text-muted-foreground hover:bg-muted"
                              >
                                <Building2 className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">
                                  Fornecedor vinculado:{" "}
                                  {parsed.fornecedorReferente?.nomefantasia ||
                                    parsed.fornecedorReferente?.nomerazaosocial}
                                </span>
                              </Button>
                            </FornecedorSelect>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1">
                              <span className="text-xs text-red-400">
                                {buscandoFornecedor
                                  ? "Buscando fornecedor..."
                                  : "Fornecedor não cadastrado no sistema"}
                              </span>
                            </div>
                          )}
                          {!parsed.fornecedorReferenteId &&
                          !buscandoFornecedor ? (
                            <FornecedorDialog
                              dialogOpen={fornecedorDialogOpen}
                              setDialogOpen={setFornecedorDialogOpen}
                              handleGetFornecedor={buscarFornecedor}
                              dadosNovoFornecedor={{
                                cpfcnpj: String(parsed.emitente.cnpj ?? ""),
                                nomerazaosocial: String(
                                  parsed.emitente.nome ?? "",
                                ),
                                nomefantasia: String(
                                  parsed.emitente.nomeFantasia ?? "",
                                ),
                                endereco: String(
                                  parsed.emitente.endereco?.logradouro ?? "",
                                ),
                                endereconumero: String(
                                  parsed.emitente.endereco?.numero ?? "",
                                ),
                                cidade: String(
                                  parsed.emitente.endereco?.municipio ?? "",
                                ),
                                bairro: String(
                                  parsed.emitente.endereco?.bairro ?? "",
                                ),
                                codigomunicipio: String(
                                  parsed.emitente.endereco?.codigoMunicipio ??
                                    "",
                                ),
                                estado: String(
                                  parsed.emitente.endereco?.uf ?? "",
                                ),
                                cep: String(
                                  parsed.emitente.endereco?.cep ?? "",
                                ),
                                contato: "",
                                ativo: true,
                              }}
                            >
                              <div
                                className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                title="Cadastrar fornecedor"
                              >
                                <UserRoundPlus className="h-4 w-4" />
                              </div>
                            </FornecedorDialog>
                          ) : null}
                        </div>
                      </div>
                      <div className="min-w-0 shrink-0 space-y-1 text-right text-xs text-muted-foreground">
                        <div className="flex flex-col">
                          <span>Emissão:</span>
                          <span>
                            {parsed.dataEmissao
                              ? formatDate(parsed.dataEmissao)
                              : "—"}
                          </span>
                        </div>
                        <p>
                          Valor da NF-e:{" "}
                          <span className="font-semibold">
                            {formatarEmReal(
                              Number(parsed.totais?.valorNota ?? 0),
                            )}
                          </span>
                        </p>
                        <p>
                          A destinar:{" "}
                          <span className="font-semibold">
                            {formatarEmReal(totalDestinado)}
                          </span>
                        </p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>
                        Itens na nota:{" "}
                        <span className="font-semibold">
                          {parsed.itens.length}
                        </span>
                      </span>
                      <span>
                        Série:{" "}
                        <span className="font-semibold">{parsed.serie}</span>
                      </span>
                      {linhasEstoque.length ? (
                        <span>
                          Revenda:{" "}
                          <span className="font-semibold">
                            {linhasEstoque.length}
                          </span>
                        </span>
                      ) : null}
                      {linhasUsoConsumo.length ? (
                        <span>
                          Uso/consumo:{" "}
                          <span className="font-semibold">
                            {linhasUsoConsumo.length}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {semDestino ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        Escolha o destino de cada item para liberar o registro.
                      </div>
                    ) : null}
                    {linhasUsoConsumo.length && duplicidades.length ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-semibold">
                            NF-e já registrada em uso/consumo
                          </p>
                          {duplicidades.map((entrada) => (
                            <p key={entrada.id}>
                              Entrada #{entrada.id}, registrada em{" "}
                              {formatDate(entrada.created_at)}.
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  {parsed.itens.map((linha, indice) => {
                    const vinculando = vinculandoIndices.includes(indice);
                    const bloqueado = Boolean(linha.destinoApropriado);
                    return (
                      <div
                        key={`${linha.numeroItem}-${linha.codigo}`}
                        className={`rounded-lg border p-4 text-xs not-dark:bg-white ${bloqueado ? "opacity-60" : ""}`}
                      >
                        <div className="space-y-2">
                          <div className="border-b pb-2">
                            <div className="mb-2 flex flex-row items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="font-semibold uppercase text-muted-foreground">
                                  Item {linha.numeroItem}
                                </p>
                                {bloqueado ? (
                                  <Badge variant="secondary">
                                    Já destinado a{" "}
                                    {linha.destinoApropriado === "PRODUTO"
                                      ? "revenda"
                                      : "uso/consumo"}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="shrink-0 font-bold">
                                Total: {formatarEmReal(totalDaLinha(linha))}
                              </p>
                            </div>
                            <p className="font-semibold text-muted-foreground">
                              {linha.descricao}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-2 text-xs md:grid-cols-3 lg:grid-cols-4">
                            <p>
                              <span className="font-medium text-muted-foreground">
                                Código:
                              </span>{" "}
                              <span className="font-mono font-semibold">
                                {linha.codigo || "—"}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                EAN:
                              </span>{" "}
                              <span className="font-mono font-semibold">
                                {String(linha.ean || "—")}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                Unidade:
                              </span>{" "}
                              <span className="font-semibold">
                                {linha.unidade}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                Qtd:
                              </span>{" "}
                              <span className="font-semibold">
                                {Number(linha.quantidade).toLocaleString(
                                  "pt-BR",
                                )}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                V. Unitário:
                              </span>{" "}
                              <span className="font-mono font-semibold">
                                {formatarEmReal(Number(linha.valorUnitario))}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                NCM:
                              </span>{" "}
                              <span className="font-mono font-semibold">
                                {linha.ncm}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-muted-foreground">
                                CFOP:
                              </span>{" "}
                              <span className="font-mono font-semibold">
                                {linha.cfop}
                              </span>
                            </p>
                          </div>

                          <Separator />

                          {!bloqueado ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-muted-foreground">
                                Destino:
                              </span>
                              <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
                                {destinosPermitidos.map((destino) => (
                                  <button
                                    key={destino}
                                    type="button"
                                    onClick={() =>
                                      escolherDestino(indice, destino)
                                    }
                                    className={`inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium transition-all hover:cursor-pointer ${
                                      linha.destino === destino
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                                    }`}
                                  >
                                    {DESTINO_LABEL[destino]}
                                  </button>
                                ))}
                              </div>
                              {!linha.destino ? (
                                <span className="text-[11px] text-red-400">
                                  Obrigatório
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          <div
                            className={`flex min-w-0 flex-row items-center gap-2 ${bloqueado || !linha.destino ? "pointer-events-none opacity-50" : ""}`}
                          >
                            <div
                              className={`relative inline-flex min-w-0 max-w-[300px] items-center gap-2 rounded-md bg-muted px-2 py-1 pr-6 text-xs ${
                                vinculando
                                  ? "text-primary"
                                  : linhaVinculada(linha)
                                    ? "text-muted-foreground"
                                    : "text-red-400"
                              }`}
                            >
                              <span className="min-w-0 truncate">
                                {vinculando
                                  ? "Buscando vínculo..."
                                  : rotuloVinculo(linha)}
                              </span>
                              {linhaVinculada(linha) && !bloqueado ? (
                                <X
                                  className="absolute right-1 h-4 w-4 cursor-pointer text-red-200 hover:text-red-400"
                                  onClick={() =>
                                    atualizarLinha(indice, {
                                      produtoReferenciaId: undefined,
                                      produtoReferencia: undefined,
                                      itemReferenciaId: undefined,
                                      itemReferencia: undefined,
                                    })
                                  }
                                />
                              ) : null}
                            </div>

                            {linha.destino === "ESTOQUE" && !bloqueado ? (
                              <>
                                <ProductSelect
                                  open={produtoSelectIndex === indice}
                                  setOpen={(aberto) =>
                                    setProdutoSelectIndex(
                                      aberto ? indice : null,
                                    )
                                  }
                                  OnSelect={(produto) =>
                                    atualizarLinha(indice, {
                                      produtoReferenciaId: produto.id,
                                      produtoReferencia: produto,
                                    })
                                  }
                                >
                                  <div
                                    className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                    title="Selecionar produto"
                                  >
                                    <Search className="h-4 w-4" />
                                  </div>
                                </ProductSelect>
                                {!linha.produtoReferenciaId ? (
                                  <DialogProduto
                                    productId={produtoSelecionadoId}
                                    isOpen={produtoDialogIndex === indice}
                                    setIsOpen={(aberto) => {
                                      if (
                                        aberto &&
                                        !parsed.fornecedorReferenteId
                                      ) {
                                        toast.error(
                                          "Cadastre um fornecedor para habilitar o cadastro de produto",
                                        );
                                        return;
                                      }
                                      setProdutoDialogIndex(
                                        aberto ? indice : null,
                                      );
                                    }}
                                    setSelectedProductId={
                                      setProdutoSelecionadoId
                                    }
                                    handleSearchFornecedor={() =>
                                      void vincularPorDestino(indice, "ESTOQUE")
                                    }
                                    newProductData={{
                                      titulo: linha.descricao,
                                      referencia: linha.codigo,
                                      ncm: String(linha.ncm ?? ""),
                                      cfop: String(linha.cfop ?? ""),
                                      precovenda: linha.valorUnitario,
                                      precocompra: linha.valorUnitario,
                                      ultimovalordecompra: linha.valorUnitario,
                                      estoque: 0,
                                      fornecedorid:
                                        parsed.fornecedorReferenteId ||
                                        undefined,
                                      codigofornecedor: linha.codigo,
                                    }}
                                  >
                                    <div
                                      className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                      title="Criar produto"
                                    >
                                      <PackagePlus className="h-4 w-4" />
                                    </div>
                                  </DialogProduto>
                                ) : null}
                              </>
                            ) : null}

                            {linha.destino === "USOCONSUMO" && !bloqueado ? (
                              <>
                                <ItemSelectDialog
                                  open={itemSelectIndex === indice}
                                  setOpen={(aberto) =>
                                    setItemSelectIndex(aberto ? indice : null)
                                  }
                                  onSelect={(item) =>
                                    atualizarLinha(indice, {
                                      itemReferenciaId: item.id,
                                      itemReferencia: item,
                                    })
                                  }
                                >
                                  <div
                                    className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                    title="Selecionar item"
                                  >
                                    <Search className="h-4 w-4" />
                                  </div>
                                </ItemSelectDialog>
                                {!linha.itemReferenciaId ? (
                                  <button
                                    type="button"
                                    className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                    title="Criar item de uso e consumo"
                                    onClick={() => abrirCadastroItemUso(indice)}
                                  >
                                    <PackagePlus className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted"
                                    title="Editar item vinculado"
                                    onClick={async () => {
                                      try {
                                        const { data } = await axios.get(
                                          `/api/usoconsumo/itens/${linha.itemReferenciaId}`,
                                        );
                                        setItemEmEdicao(data.data);
                                        setItemValoresIniciais(undefined);
                                        setItemDialogIndex(indice);
                                      } catch (error) {
                                        toast.error(
                                          "Não foi possível abrir o item.",
                                          { description: textoErro(error) },
                                        );
                                      }
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Separator />

                <div className="space-y-2 bg-card p-4 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs ${pagamentoFuturo ? "text-accent-foreground" : "text-muted-foreground"}`}
                    >
                      Lançar parcelas futuras no financeiro (opcional)
                    </span>
                    <Switch
                      checked={pagamentoFuturo}
                      onCheckedChange={(marcado) => {
                        setPagamentoFuturo(marcado);
                        if (marcado) {
                          setParcelas((atual) =>
                            atual.length
                              ? atual
                              : [{ id: Date.now(), valor: 0 }],
                          );
                        } else {
                          setParcelas([]);
                          setBancoId("");
                          setMetodo("");
                          setCategoria("");
                          setPlanoId("");
                          setCentroCustoId("");
                        }
                      }}
                    />
                  </div>

                  {pagamentoFuturo ? (
                    <div className="space-y-4 pt-2">
                      {notaDividida ? (
                        <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                          A nota alimenta os dois estoques. O pagamento é
                          lançado uma única vez e fica vinculado às duas
                          entradas — o cancelamento passa a exigir cancelar a
                          nota inteira.
                        </p>
                      ) : null}
                      <div className="space-y-2">
                        {parcelas.map((parcela, indice) => (
                          <div
                            key={parcela.id}
                            className="relative grid gap-2 rounded-xl bg-muted-foreground/5 px-3 py-6 sm:grid-cols-[auto_1fr_1fr] sm:items-end"
                          >
                            <span className="absolute left-3 top-1 text-xs text-muted-foreground">
                              {indice + 1}ª parcela
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() =>
                                parcelas.length === 1
                                  ? toast.error(
                                      "É necessário ao menos uma parcela.",
                                    )
                                  : setParcelas((atual) =>
                                      atual.filter((_, i) => i !== indice),
                                    )
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <div className="space-y-1">
                              <Label>Data de vencimento</Label>
                              <DatePicker
                                value={parcela.dataVencimento || ""}
                                onChange={(valor) =>
                                  setParcelas((atual) =>
                                    atual.map((p, i) =>
                                      i === indice
                                        ? {
                                            ...p,
                                            dataVencimento: valor || undefined,
                                          }
                                        : p,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Valor</Label>
                              <ValueInput
                                price={parcela.valor}
                                setPrice={(valor) =>
                                  setParcelas((atual) =>
                                    atual.map((p, i) =>
                                      i === indice ? { ...p, valor } : p,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setParcelas((atual) => [
                                ...atual,
                                {
                                  id: Date.now(),
                                  valor: 0,
                                  dataVencimento: format(
                                    addMonths(new Date(), atual.length),
                                    "yyyy-MM-dd",
                                  ),
                                },
                              ])
                            }
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar parcela
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Parcelas:{" "}
                            {formatarEmReal(
                              parcelas.reduce((soma, p) => soma + p.valor, 0),
                            )}{" "}
                            de {formatarEmReal(totalDestinado)}
                          </span>
                        </div>
                      </div>
                      <div className="p-4 bg-muted/50 rounded-2xl space-y-4">
                        <div className="space-y-1">
                          <Label>Categoria</Label>
                          <Select
                            value={categoria}
                            onValueChange={setCategoria}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              {categorias.map((entrada) => (
                                <SelectItem
                                  key={entrada.id}
                                  value={entrada.nome}
                                >
                                  {entrada.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-3 grid-cols-2 w-full">
                          <div className="space-y-1 w-full">
                            <Label>Banco</Label>
                            <Select value={bancoId} onValueChange={setBancoId}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Não informado" />
                              </SelectTrigger>
                              <SelectContent>
                                {bancos.map((banco) => (
                                  <SelectItem
                                    key={banco.id}
                                    value={String(banco.id)}
                                  >
                                    {banco.titulo}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1 w-full">
                            <Label>Método</Label>
                            <Select
                              value={metodo}
                              onValueChange={(valor) =>
                                setMetodo(valor as Metodo_pagamento)
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Não informado" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.values(Metodo_pagamento).map(
                                  (valor) => (
                                    <SelectItem key={valor} value={valor}>
                                      {valor}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid gap-3 grid-cols-2">
                          <div className="space-y-1">
                            <Label>Plano de conta</Label>
                            <PlanoContaCombobox
                              value={planoId}
                              groups={gruposPlanosDeConta}
                              loading={loadingPlanos}
                              clearable
                              onClear={() => setPlanoId("")}
                              onValueChange={setPlanoId}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Centro de custo</Label>
                            <SearchCombobox
                              value={centroCustoId}
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
                              onValueChange={setCentroCustoId}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            <DialogFooter className="shrink-0 px-6 py-4">
              <div className="flex gap-3 sm:flex-row sm:gap-4">
                <Button
                  className="hover:cursor-pointer"
                  onClick={() => void registrar()}
                  disabled={!podeRegistrar}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Registrar
                </Button>
                <DialogClose asChild>
                  <Button
                    className="hover:cursor-pointer"
                    variant="outline"
                    disabled={submitting}
                  >
                    Cancelar
                  </Button>
                </DialogClose>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ItemDialog
        open={itemDialogIndex !== null}
        item={itemEmEdicao}
        grupos={grupos}
        initialValues={itemValoresIniciais}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setItemDialogIndex(null);
            setItemEmEdicao(null);
            setItemValoresIniciais(undefined);
          }
        }}
        onGroupsChanged={carregarGrupos}
        onSaved={async () => {
          if (itemDialogIndex !== null && itemEmEdicao?.id) {
            await selecionarItemUsoPorId(itemDialogIndex, itemEmEdicao.id);
          }
        }}
        onSelectedItemId={(id) => {
          if (itemDialogIndex !== null)
            void selecionarItemUsoPorId(itemDialogIndex, id);
        }}
      />
    </>
  );
}
