"use client";

import axios, { isAxiosError } from "axios";
import { escopoDeEntradaDe, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";
import { addMonths, format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { totalEntradaAjustado, totalItemEntrada, type AjustesValoresEntrada } from "@/lib/estoque/entrada-valores";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2,
  Eye,
  FileWarning,
  Loader2,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  ReceiptText,
  Scale,
  Search,
  TriangleAlert,
  Truck,
  UserRoundPlus,
  X,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
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
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";
import { linhaEmQuantidadeInteira } from "@/lib/nfe/quantidade-inteira-da-linha";
import { totalDasDuplicatas } from "@/lib/nfe/duplicatas";
import { componentesDoTotal } from "@/lib/nfe/totais-nfe";
import { ROTULO_DO_TRATAMENTO } from "@/lib/nfe/tratamento-custo";
import { apropriarValorFiscal } from "@/lib/nfe/valor-fiscal-entrada";
import { ratearCustoPersonalizado } from "@/lib/nfe/entrada-fiscal-personalizada";
import {
  conferirIdentidade,
  lancamentosDreDaEntrada,
  payloadDosLancamentos,
  type FonteDosLancamentos,
} from "@/lib/nfe/lancamento-dre-entrada";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";

import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import ProductSelect from "@/app/(app)/components/productSelect";
import BotaoNf from "@/app/(app)/(pages)/estoque/components/dialog-entrada/botao-nota-fiscal";
import type { NF } from "@/app/(app)/(pages)/estoque/components/dialog-entrada/types";
import type { Fornecedor, Produto } from "@/app/(app)/(pages)/estoque/types";
import { DialogProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto";
import ValueInput from "@/app/(app)/(pages)/estoque/components/dialog-produto/entrada-valor";
import FornecedorDialog from "@/app/(app)/(pages)/configuracoes/tipos/components/fornecedorDialog";
import { ItemDialog } from "@/app/(app)/(pages)/usoconsumo/components/item-dialog";
import {
  ItemSelectDialog,
  type UsoConsumoItemOption,
} from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { Metodo_pagamento } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import type { Banco } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import { normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";
import { permissionSetHas, tipoPermission } from "@/app/api/_authz/permission-constants";

import {
  apenasDigitos,
  linhaVinculada,
  rotuloVinculo,
  totalDaLinha,
  unidadeNormalizada,
  type DestinoEntrada,
  DESTINO_LABEL,
  ehEstoqueSimples,
  type LinhaFiscal,
  type NotaFiscalParseada,
  type Parcela,
} from "./types";

/*
 * A decomposição do `vNF` no cabeçalho, na ordem em que se lê uma nota. Os
 * informativos (ICMS próprio, PIS, COFINS, `vTotTrib`) ficam de fora de
 * propósito: mostrá-los ao lado dos acréscimos convida a somá-los.
 */
const ROTULO_DA_COMPOSICAO = {
  produtos: "Produtos",
  desconto: "Desconto",
  icmsDesonerado: "ICMS desonerado",
  frete: "Frete",
  seguro: "Seguro",
  outrasDespesas: "Outras despesas",
  icmsST: "ICMS-ST",
  fcpST: "FCP-ST",
  icmsMonoReten: "ICMS mono. retido",
  impostoImportacao: "Imp. importação",
  ipi: "IPI",
  ipiDevolvido: "IPI devolvido",
  servicos: "Serviços",
  pisST: "PIS-ST",
  cofinsST: "COFINS-ST",
} as const;

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
  /**
   * Estoque simples usado como padrao quando a linha ainda nao tem destino — por
   * exemplo, ao cadastrar um item novo antes de escolher. NAO restringe: os tres
   * destinos ficam sempre disponiveis, venha o dialogo de onde vier.
   */
  escopo?: UsoConsumoEscopo;
  /** Restringe os destinos oferecidos. Padrão: os dois. */
  destinosPermitidos?: DestinoEntrada[];
  onSaved?: () => void | Promise<void>;
};

const TODOS_DESTINOS: DestinoEntrada[] = ["ESTOQUE", "USOCONSUMO", "GERAL"];

/**
 * "2026-09-10" → "10/09/2026".
 *
 * Sem passar por `Date`: `new Date("2026-09-10")` é meia-noite UTC e, no fuso da
 * operação, o `formatDate` mostraria 09/09 às 21h. Vencimento não tem hora.
 */
function vencimentoFormatado(dia: string) {
  const [ano, mes, data] = dia.split("-");
  return ano && mes && data ? `${data}/${mes}/${ano}` : dia;
}

function textoErro(error: unknown) {
  return isAxiosError(error)
    ? (error.response?.data?.details ??
        error.response?.data?.detail ??
        error.response?.data?.error ??
        error.message)
    : "Erro inesperado.";
}

/**
 * Quantidade, unitário, desconto e outras despesas que a linha leva ao estoque.
 * Fração da NF-e vira o inteiro mais próximo com o mesmo custo da linha.
 */
function valoresDeEstoque(linha: LinhaFiscal) {
  const inteira = linhaEmQuantidadeInteira(
    Number(linha.quantidade),
    Number(linha.valorUnitario),
  );
  return {
    quantidade: inteira.quantidade,
    valorUnitario: inteira.valorUnitario,
    valorDesconto: paraReais(
      paraCentavos(linha.valorDesconto ?? 0) + paraCentavos(inteira.ajusteDesconto),
    ),
    outrasDespesas: paraReais(
      paraCentavos(linha.outrasDespesas ?? 0) +
        paraCentavos(linha.valorSeguro ?? 0) +
        paraCentavos(linha.valorIpi ?? 0) +
        paraCentavos(inteira.ajusteOutrasDespesas),
    ),
  };
}

/** "Item 6 (6,15 M → 6)" ou "Itens 2 (1,5 KG → 2) e 6 (6,15 M → 6)". */
function textoLinhasFracionadas(linhas: LinhaFiscal[]) {
  const partes = linhas.map((linha) => {
    const quantidade = [Number(linha.quantidade).toLocaleString("pt-BR"), linha.unidade]
      .filter(Boolean)
      .join(" ");
    return `${linha.numeroItem} (${quantidade} → ${valoresDeEstoque(linha).quantidade})`;
  });
  const lista =
    partes.length > 1
      ? `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`
      : partes[0];
  return `${partes.length > 1 ? "Itens" : "Item"} ${lista}`;
}

export function EntradaFiscalDialog({
  open,
  onOpenChange,
  notaFiscalRecebidaId,
  destinosPermitidos = TODOS_DESTINOS,
  escopo = "USOCONSUMO",
  onSaved,
}: Props) {
  const { data: session } = useSession();
  const canCreateFornecedor = permissionSetHas(
    session?.user?.permissoes,
    tipoPermission("fornecedores", "criar"),
  );
  const [parsed, setParsed] = useState<NotaFiscalParseada | null>(null);
  const { options: metodosPagamento } = usePaymentMethodOptions();
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

  /*
   * Salvar o produto vincula a linha, e o dialog dela desmonta sem passar pelo
   * fechamento. Sem esta limpeza o índice e o id do produto salvo sobrevivem: o
   * dialog reabriria sozinho se a linha perdesse o vínculo.
   */
  const produtoDialogVinculado =
    produtoDialogIndex !== null &&
    Boolean(parsed?.itens[produtoDialogIndex]?.produtoReferenciaId);
  useEffect(() => {
    if (!produtoDialogVinculado) return;
    setProdutoDialogIndex(null);
    setProdutoSelecionadoId(undefined);
  }, [produtoDialogVinculado]);

  const [itemSelectIndex, setItemSelectIndex] = useState<number | null>(null);
  const [itemDialogIndex, setItemDialogIndex] = useState<number | null>(null);
  const [itemEmEdicao, setItemEmEdicao] = useState<UsoConsumoItem | null>(null);
  const [itemValoresIniciais, setItemValoresIniciais] =
    useState<Record<string, string | number | null>>();
  const [grupos, setGrupos] = useState<UsoConsumoGrupo[]>([]);

  const [entradaPersonalizada, setEntradaPersonalizada] = useState(false);
  const [linhasNormaisPersonalizacao, setLinhasNormaisPersonalizacao] = useState<
    number[]
  >([]);
  const [destinoPersonalizado, setDestinoPersonalizado] =
    useState<DestinoEntrada>();
  const [produtoPersonalizado, setProdutoPersonalizado] =
    useState<Produto>();
  const [itemPersonalizado, setItemPersonalizado] =
    useState<UsoConsumoItemOption>();
  const [quantidadePersonalizada, setQuantidadePersonalizada] = useState("1");
  const [valoresCompra, setValoresCompra] = useState<Record<string, number>>({});
  const [motivoValoresCompra, setMotivoValoresCompra] = useState("");
  const quantidadePersonalizadaNumero = Number(quantidadePersonalizada);
  const [produtoPersonalizadoOpen, setProdutoPersonalizadoOpen] = useState(false);
  const [itemPersonalizadoOpen, setItemPersonalizadoOpen] = useState(false);

  const [pagamentoFuturo, setPagamentoFuturo] = useState(true);
  const [confirmarVencidaAberto, setConfirmarVencidaAberto] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [usarDuplicatas, setUsarDuplicatas] = useState(false);
  /** O que o usuário tinha digitado antes de aceitar as duplicatas. */
  const [parcelasManuais, setParcelasManuais] = useState<Parcela[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [bancoId, setBancoId] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [categoria, setCategoria] = useState("");
  const [planoId, setPlanoId] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");

  const { categorias, loadingCategorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  // Emitentes de NF-e podem ser pessoa jurídica (CNPJ) ou física (CPF). Os
  // fallbacks mantêm compatibilidade com respostas produzidas antes de
  // `documento` existir no contrato da rota.
  const documentoEmitente = normalizeCpfOrCnpj(
    parsed?.emitente?.documento ??
      parsed?.emitente?.cnpj ??
      parsed?.emitente?.cpf,
  );
  const tipoDocumentoEmitente =
    parsed?.emitente?.tipoDocumento ??
    (documentoEmitente.length === 11
      ? "CPF"
      : documentoEmitente.length === 14
        ? "CNPJ"
        : "CPF/CNPJ");

  /** Chave da nota cujas duplicatas já foram oferecidas, para não reoferecer. */
  const duplicatasAplicadasRef = useRef<string | null>(null);

  const linhasRef = useRef<LinhaFiscal[]>([]);
  useEffect(() => {
    linhasRef.current = parsed?.itens ?? [];
  }, [parsed?.itens]);

  const linhasDisponiveis = useMemo(
    () => parsed?.itens.filter((linha) => !linha.destinoApropriado) ?? [],
    [parsed],
  );
  const numerosNormaisPersonalizacao = useMemo(
    () => new Set(linhasNormaisPersonalizacao),
    [linhasNormaisPersonalizacao],
  );
  const linhasNormais = useMemo(
    () =>
      entradaPersonalizada
        ? linhasDisponiveis.filter((linha) =>
            numerosNormaisPersonalizacao.has(Number(linha.numeroItem)),
          )
        : linhasDisponiveis,
    [entradaPersonalizada, linhasDisponiveis, numerosNormaisPersonalizacao],
  );
  const linhasPersonalizadas = useMemo(
    () =>
      entradaPersonalizada
        ? linhasDisponiveis.filter(
            (linha) => !numerosNormaisPersonalizacao.has(Number(linha.numeroItem)),
          )
        : [],
    [entradaPersonalizada, linhasDisponiveis, numerosNormaisPersonalizacao],
  );
  /*
   * Custo de estoque das linhas: a regra do ERP, que soma o que veio NA linha.
   * É o que vai para `entradaitens` e para o preço de compra do produto — e NÃO
   * é o valor fiscal da nota.
   */
  const custoDestinado = useMemo(
    () =>
      Number(
        linhasDisponiveis
          .reduce((soma, linha) => soma + totalDaLinha(linha), 0)
          .toFixed(2),
      ),
    [linhasDisponiveis],
  );
  const custoNormal = useMemo(
    () =>
      Number(
        linhasNormais.reduce((soma, linha) => soma + totalDaLinha(linha), 0).toFixed(2),
      ),
    [linhasNormais],
  );
  const custoPersonalizado = useMemo(
    () =>
      Number(
        linhasPersonalizadas
          .reduce((soma, linha) => soma + totalDaLinha(linha), 0)
          .toFixed(2),
      ),
    [linhasPersonalizadas],
  );
  const rateioPersonalizado = useMemo(() => {
    try { return ratearCustoPersonalizado(custoPersonalizado, quantidadePersonalizadaNumero); }
    catch { return null; }
  }, [custoPersonalizado, quantidadePersonalizadaNumero]);
  const linhasValoresCompra = useMemo(() => {
    const normais = linhasNormais.map((linha) => {
      const valores = valoresDeEstoque(linha);
      return {
        chave: String(linha.numeroItem), titulo: String(linha.descricao ?? ""),
        inventory: linha.destino === "ESTOQUE" ? "produto" as const : "usoconsumo" as const,
        numeroItemFiscal: Number(linha.numeroItem), consolidado: false,
        quantidade: valores.quantidade, valor_unitario_compra: valores.valorUnitario,
        valor_desconto: valores.valorDesconto, valor_frete: Number(linha.valorFrete ?? 0),
        outras_despesas: valores.outrasDespesas,
      };
    });
    if (linhasPersonalizadas.length && rateioPersonalizado) normais.push({
      chave: "consolidado", titulo: "Item consolidado da entrada personalizada",
      inventory: destinoPersonalizado === "ESTOQUE" ? "produto" : "usoconsumo",
      numeroItemFiscal: 0, consolidado: true, quantidade: quantidadePersonalizadaNumero,
      valor_unitario_compra: rateioPersonalizado.custoUnitario,
      valor_desconto: rateioPersonalizado.valorDesconto, valor_frete: 0,
      outras_despesas: rateioPersonalizado.outrasDespesas,
    });
    return normais;
  }, [linhasNormais, linhasPersonalizadas.length, rateioPersonalizado, destinoPersonalizado, quantidadePersonalizadaNumero]);
  const linhasComValorAjustado = linhasValoresCompra.filter((linha) =>
    valoresCompra[linha.chave] !== undefined && valoresCompra[linha.chave] !== linha.valor_unitario_compra);
  const diferencasCompra = linhasComValorAjustado.map((linha) =>
    totalItemEntrada(linha, valoresCompra[linha.chave]) - totalItemEntrada(linha));
  const custoEstoqueAtualizado = totalEntradaAjustado(custoDestinado, diferencasCompra);
  const ajustesValores: AjustesValoresEntrada | undefined = linhasComValorAjustado.length ? {
    motivo: motivoValoresCompra,
    itens: linhasComValorAjustado.map((linha) => ({
      inventory: linha.inventory,
      ...(linha.consolidado ? { consolidado: true } : { numeroItemFiscal: linha.numeroItemFiscal }),
      valorUnitarioCompra: valoresCompra[linha.chave],
    })),
  } : undefined;
  const linhasEstoque = useMemo(
    () => linhasNormais.filter((linha) => linha.destino === "ESTOQUE"),
    [linhasNormais],
  );
  // As duas metades simples vao para a MESMA entrada: elas dividem a tabela, e uma
  // NF-e nao pode virar duas entradas (a chave e unica globalmente).
  const linhasUsoConsumo = useMemo(
    () => linhasNormais.filter((linha) => ehEstoqueSimples(linha.destino)),
    [linhasNormais],
  );
  /** Escopo do cabecalho da entrada: um so estoque, ou MISTO quando ha os dois. */
  const escopoDaEntrada = useMemo(
    () => escopoDeEntradaDe(linhasUsoConsumo.map((linha) => linha.destino as UsoConsumoEscopo)),
    [linhasUsoConsumo],
  );

  /**
   * O cadastro de item aberto pela linha nasce no estoque daquela linha. `escopo`
   * so entra quando a linha ainda nao tem destino escolhido.
   */
  const escopoDoItemEmEdicao = useMemo(() => {
    const destino = itemDialogIndex === null ? undefined : parsed?.itens[itemDialogIndex]?.destino;
    return ehEstoqueSimples(destino) ? destino : escopo;
  }, [escopo, itemDialogIndex, parsed?.itens]);
  /*
   * A leitura fiscal da nota: produtos, descontos, acréscimos e a conferência
   * contra o `vNF`. Ausente em resposta antiga que ficou em cache — daí o
   * fallback para o punhado de campos que a rota sempre devolveu.
   */
  const composicao = parsed?.totais?.composicao;

  /*
   * O valor fiscal desta entrada — a parcela do `vNF` que ela está apropriando.
   *
   * Cada linha traz do parser os seus próprios componentes já classificados, com
   * a origem (`<det>` ou só o total) e se compõem o `vNF`. Somar aqui é somar o
   * que a nota diz, não reaplicar uma fórmula paralela: era a fórmula paralela
   * (`qtd × unitário − desconto + frete + seguro + outras + IPI`) que deixava
   * ICMS-ST, II, PIS-ST e companhia de fora e fazia a tela concluir que a
   * diferença não pertencia aos itens.
   *
   * Os componentes que o total declara sem `<det>` são rateados nas linhas em vez
   * de sumir — rateio para RECONCILIAR O VALOR FISCAL, que não decide nada sobre
   * custo. Com a nota inteira, o resultado é exatamente o `vNF`.
   */
  const naoAlocados = useMemo(
    () => parsed?.componentesNaoAlocados ?? [],
    [parsed?.componentesNaoAlocados],
  );
  const apropriacao = useMemo(
    () =>
      apropriarValorFiscal(
        linhasDisponiveis.map((linha) => ({ componentes: linha.componentesFiscais ?? [] })),
        naoAlocados,
      ),
    [linhasDisponiveis, naoAlocados],
  );
  /*
   * Sem `componentesFiscais` (resposta antiga em cache) a apropriação daria zero.
   * Aí vale o custo das linhas, que era o comportamento anterior.
   */
  const temComponentes = linhasDisponiveis.some(
    (linha) => (linha.componentesFiscais?.length ?? 0) > 0,
  );
  const valorFiscalDestinado = temComponentes
    ? apropriacao.valorFiscalTotal
    : custoDestinado;

  /*
   * Os componentes que compõem o `vNF` mas a política de custo não incorpora ao
   * preço de compra. Cada um sabe de qual item veio e por qual regra ficou de
   * fora — inclusive quando a regra é "ainda falta configuração para decidir".
   */
  const foraDoCusto = useMemo(() => {
    const relevantes = [
      ...linhasDisponiveis.flatMap((linha) => linha.componentesFiscais ?? []),
      ...naoAlocados,
    ];
    return relevantes.filter(
      (componente) =>
        componente.compoeValorNFe &&
        componente.tratamentoCusto !== "INTEGRA_CUSTO" &&
        componente.tratamentoCusto !== "REDUZ_CUSTO",
    );
  }, [linhasDisponiveis, naoAlocados]);

  /*
   * O que desta nota entra na DRE agora — e o que continua esperando a baixa.
   *
   * A mercadoria não passa por aqui: ela vira estoque e chega ao resultado como
   * CMV quando o item sair por venda ou por OS. O que entra é o imposto que a
   * nota cobrou e que nunca vira mercadoria, então não tem saída futura para
   * esperar: ICMS-ST, FCP-ST, imposto de importação, IPI devolvido, PIS-ST e
   * COFINS-ST. Antes disto esse dinheiro saía do caixa e não chegava a
   * relatório nenhum.
   *
   * A tela só destina itens inteiros, daí `proporcao: 1` em toda linha.
   */
  const fonteDosLancamentos: FonteDosLancamentos = useMemo(
    () => ({
      linhas: linhasDisponiveis.map((linha, indice) => ({
        numeroItem: Number(linha.numeroItem) || null,
        proporcao: 1,
        componentes: linha.componentesFiscais ?? [],
        valorFiscalDoItem:
          (apropriacao.valorFiscalPorLinha[indice] ?? 0) - (apropriacao.cotas[indice] ?? 0),
        custoEstoque: totalDaLinha(linha),
      })),
      naoAlocados,
    }),
    [apropriacao, linhasDisponiveis, naoAlocados],
  );
  const lancamentosDre = useMemo(
    () => lancamentosDreDaEntrada(fonteDosLancamentos),
    [fonteDosLancamentos],
  );
  /*
   * Na NF-e mista os itens viram DUAS entradas, e cada uma lança os tributos dos
   * seus próprios itens. Os valores que a nota declara sem `<det>` vão com o lado
   * do estoque e só com ele: mandados nos dois, o mesmo imposto entraria duas
   * vezes na DRE.
   */
  const tributosDoEstoque = useMemo(
    () =>
      payloadDosLancamentos(
        lancamentosDreDaEntrada(fonteDosLancamentos, {
          numerosDeItem: linhasEstoque.map((linha) => Number(linha.numeroItem) || null),
        }),
      ),
    [fonteDosLancamentos, linhasEstoque],
  );
  const tributosDoUsoConsumo = useMemo(
    () =>
      payloadDosLancamentos(
        lancamentosDreDaEntrada(fonteDosLancamentos, {
          numerosDeItem: linhasUsoConsumo.map((linha) => Number(linha.numeroItem) || null),
          incluirNaoAlocados: false,
        }),
      ),
    [fonteDosLancamentos, linhasUsoConsumo],
  );

  /*
   * A prova de que nada sumiu: custo + despesas − recuperações + pendentes tem de
   * dar o valor fiscal. `pendentes` é o que a política ainda não classifica —
   * aparece na tela em vez de ser disfarçado de zero.
   */
  const conferencia = useMemo(
    () =>
      conferirIdentidade({
        ...fonteDosLancamentos,
        custoEstoqueDestinado: custoDestinado,
        valorFiscalDestinado,
      }),
    [custoDestinado, fonteDosLancamentos, valorFiscalDestinado],
  );

  /*
   * A decomposição do `vNF`, para o cabeçalho da nota: só o que a nota realmente
   * traz. Os informativos (ICMS próprio, PIS, COFINS, `vTotTrib`) ficam de fora
   * de propósito — mostrá-los ao lado dos acréscimos convida a somá-los.
   */
  const componentesDaNota = useMemo(() => {
    if (!composicao) return [];
    const componentes = componentesDoTotal(composicao);
    return (Object.keys(ROTULO_DA_COMPOSICAO) as Array<keyof typeof ROTULO_DA_COMPOSICAO>)
      .map((chave) => ({
        rotulo: ROTULO_DA_COMPOSICAO[chave],
        valor: componentes[chave],
        redutor: chave === "desconto" || chave === "icmsDesonerado",
      }))
      .filter((linha) => linha.valor > 0);
  }, [composicao]);

  /*
   * A referência original do financeiro é o valor fiscal apropriado.
   *
   * Com a nota inteira, isso é o `vNF` — o mesmo número das duplicatas. Com parte
   * já destinada em outra entrada, é o valor fiscal das linhas desta entrada, e a
   * outra parte fica com a entrada que a apropriou: nada é pago duas vezes.
   *
   * Ajustes comerciais explícitos somam apenas a diferença de cada item,
   * preservando os acréscimos fiscais que não pertencem às linhas físicas.
   */
  const notaInteira =
    Boolean(parsed) && linhasDisponiveis.length === (parsed?.itens.length ?? 0);
  const valorDaNota = Number(composicao?.totalNota ?? parsed?.totais?.valorNota ?? 0);
  // XML sem `vNF` legível não existe na prática, mas um zero aqui pediria
  // parcelas de R$ 0,00 — nesse caso o valor apropriado é o palpite honesto.
  const totalAPagarOriginal =
    notaInteira && valorDaNota > 0 ? valorDaNota : valorFiscalDestinado;
  const totalAPagar = totalEntradaAjustado(totalAPagarOriginal, diferencasCompra);
  /** O valor fiscal e o custo de estoque divergem: a tela precisa mostrar os dois. */
  const custoDifereDoFiscal =
    paraCentavos(valorFiscalDestinado) !== paraCentavos(custoDestinado);

  /*
   * A cobrança do XML: o parcelamento que o fornecedor já emitiu.
   *
   * As duplicatas cobrem a nota inteira. Do lado de cá, o que se deve é o valor a
   * pagar — os itens desta entrada mais o frete sem dono. Quando os dois números
   * batem, o preenchimento é exato; quando não (nota destinada em partes, por
   * exemplo), o aviso mostra a diferença e o ajuste fica com o usuário.
   */
  const duplicatas = useMemo(() => parsed?.duplicatas ?? [], [parsed?.duplicatas]);
  const totalDuplicatasEmCentavos = useMemo(
    () => totalDasDuplicatas(duplicatas),
    [duplicatas],
  );
  const duplicatasBatemComDestinado =
    duplicatas.length > 0 &&
    totalDuplicatasEmCentavos === Math.round(totalAPagar * 100);

  const parcelasDasDuplicatas = useCallback(
    () =>
      duplicatas.map((duplicata, indice) => ({
        id: Date.now() + indice,
        dataVencimento: duplicata.vencimento ?? undefined,
        valor: duplicata.valor,
      })),
    [duplicatas],
  );

  const semDestino = linhasNormais.some((linha) => !linha.destino);
  const semVinculo = linhasNormais.some((linha) => !linhaVinculada(linha));
  // Os três estoques guardam saldo inteiro: linha com fração (metro, quilo) entra
  // no inteiro mais próximo, com o mesmo custo. Ver `valoresDeEstoque`.
  const linhasFracionadas = linhasNormais.filter(
    (linha) => !Number.isInteger(Number(linha.quantidade)),
  );
  const notaDividida = linhasEstoque.length > 0 && linhasUsoConsumo.length > 0;
  const temApropriacaoAnterior =
    parsed?.itens.some((linha) => Boolean(linha.destinoApropriado)) ?? false;
  const itemPersonalizadoId =
    destinoPersonalizado === "ESTOQUE"
      ? produtoPersonalizado?.id
      : itemPersonalizado?.id;
  const itemPersonalizadoTitulo =
    destinoPersonalizado === "ESTOQUE"
      ? produtoPersonalizado?.titulo ?? produtoPersonalizado?.descricao
      : itemPersonalizado?.titulo;
  const temLinhasNormais = linhasNormais.length > 0;
  const temLinhasPersonalizadas = linhasPersonalizadas.length > 0;
  const entradaHibrida =
    entradaPersonalizada && temLinhasNormais && temLinhasPersonalizadas;
  const entradaIntegralPersonalizada =
    entradaPersonalizada && !temLinhasNormais && temLinhasPersonalizadas;
  const personalizadaEmEstoqueSimples =
    entradaPersonalizada &&
    temLinhasPersonalizadas &&
    ehEstoqueSimples(destinoPersonalizado);
  const personalizadaValida =
    !temLinhasPersonalizadas ||
    (Boolean(parsed?.documentoFiscalRecebidoId) &&
      Boolean(destinoPersonalizado) &&
      destinosPermitidos.includes(destinoPersonalizado as DestinoEntrada) &&
      Boolean(itemPersonalizadoId) &&
      Boolean(rateioPersonalizado) &&
      !temApropriacaoAnterior);

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
    setEntradaPersonalizada(false);
    setLinhasNormaisPersonalizacao([]);
    setDestinoPersonalizado(undefined);
    setProdutoPersonalizado(undefined);
    setItemPersonalizado(undefined);
    setQuantidadePersonalizada("1");
    setValoresCompra({});
    setMotivoValoresCompra("");
    setProdutoPersonalizadoOpen(false);
    setItemPersonalizadoOpen(false);
    setPagamentoFuturo(true);
    setParcelas([]);
    setUsarDuplicatas(false);
    setParcelasManuais([]);
    duplicatasAplicadasRef.current = null;
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
    // Toda troca de nota zera o estado derivado da anterior — inclusive as
    // parcelas vindas da cobrança, que são da nota que estava aqui antes.
    const limparDerivados = () => {
      setDuplicidades([]);
      setVinculandoIndices([]);
      setUsarDuplicatas(false);
      setParcelasManuais([]);
      setParcelas([]);
      duplicatasAplicadasRef.current = null;
      setEntradaPersonalizada(false);
      setLinhasNormaisPersonalizacao([]);
      setDestinoPersonalizado(undefined);
      setProdutoPersonalizado(undefined);
      setItemPersonalizado(undefined);
      setQuantidadePersonalizada("1");
      setValoresCompra({});
      setMotivoValoresCompra("");
      setProdutoPersonalizadoOpen(false);
      setItemPersonalizadoOpen(false);
    };

    if (!nota) {
      setParsed(null);
      limparDerivados();
      return;
    }
    limparDerivados();
    setParsed({
      ...nota,
      fornecedorReferente: undefined,
      fornecedorReferenteId: undefined,
      itens: nota.itens.map((item) => ({ ...item })),
    });
    setLinhasNormaisPersonalizacao(
      nota.itens
        .map((item) => Number(item.numeroItem))
        .filter((numero) => Number.isInteger(numero) && numero > 0),
    );
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
    if (!documentoEmitente) return;
    setBuscandoFornecedor(true);
    try {
      const { data } = await axios.get(
        `/api/tipos/fornecedores/${documentoEmitente}?by=cpfcnpj`,
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
  }, [documentoEmitente]);

  useEffect(() => {
    if (documentoEmitente && !parsed?.fornecedorReferenteId)
      void buscarFornecedor();
  }, [buscarFornecedor, documentoEmitente, parsed?.fornecedorReferenteId]);

  function selecionarFornecedor(fornecedor: Fornecedor) {
    if (
      normalizeCpfOrCnpj(fornecedor.cpfcnpj) !==
      documentoEmitente
    ) {
      toast.error("O fornecedor selecionado não corresponde ao CPF/CNPJ da NF-e.");
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
        const apropriacoes = resposta.data.data ?? [];
        const mapa = new Map<number, "PRODUTO" | "USOCONSUMO">(
          apropriacoes.map(
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
        if (apropriacoes.length > 0) {
          setEntradaPersonalizada(false);
          setDestinoPersonalizado(undefined);
          setProdutoPersonalizado(undefined);
          setItemPersonalizado(undefined);
        }
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
        // `usoconsumo_entrada_chave_uk` e unico por chave globalmente: duplicidade
        // e duplicidade em qualquer estoque.
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

  /*
   * Aceita as duplicatas sozinho quando elas fecham com o valor a destinar.
   *
   * Esperar as apropriações carregarem é essencial: enquanto a consulta não
   * volta, o valor a destinar ainda é o da nota inteira, e o preenchimento
   * pareceria certo para logo depois deixar a soma errada. Uma vez por nota — se
   * o usuário desmarcar, não volta a marcar sozinho.
   */
  useEffect(() => {
    const chave = String(parsed?.chaveAcesso ?? "");
    if (!chave || carregandoApropriacoes || !duplicatasBatemComDestinado) return;
    if (duplicatasAplicadasRef.current === chave) return;

    duplicatasAplicadasRef.current = chave;
    // Nada a restaurar: neste ponto as parcelas são só o esqueleto que o switch
    // criou. O que o usuário digitar depois é guardado ao marcar na mão.
    setParcelasManuais([]);
    setParcelas(parcelasDasDuplicatas());
    setUsarDuplicatas(true);
  }, [
    parsed?.chaveAcesso,
    carregandoApropriacoes,
    duplicatasBatemComDestinado,
    parcelasDasDuplicatas,
  ]);

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

  function definirLinhaComoNormal(numeroItem: number, normal: boolean) {
    setLinhasNormaisPersonalizacao((atuais) => {
      if (normal) {
        return atuais.includes(numeroItem) ? atuais : [...atuais, numeroItem];
      }
      return atuais.filter((numero) => numero !== numeroItem);
    });
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
              escopo: destino,
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
        fornecedor?.cpfcnpj ?? documentoEmitente,
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
      ...valoresDeEstoque(linha),
      valorFrete: linha.valorFrete ?? 0,
      unidade: linha.unidade,
      ncm: String(linha.ncm ?? ""),
      cfop: String(linha.cfop ?? ""),
      referencia: String(linha.codigo ?? ""),
      titulo: String(linha.descricao ?? ""),
    }));
  }

  function itensUsoConsumoPayload() {
    return linhasUsoConsumo.map((linha) => {
      const valores = valoresDeEstoque(linha);
      return {
        item_id: linha.itemReferenciaId!,
        numero_item_fiscal: Number(linha.numeroItem),
        codigo_fornecedor: String(linha.codigo ?? ""),
        quantidade: valores.quantidade,
        valor_unitario_compra: valores.valorUnitario,
        valor_desconto: valores.valorDesconto,
        valor_frete: Number(linha.valorFrete ?? 0),
        outras_despesas: valores.outrasDespesas,
        unidade: unidadeNormalizada(linha.unidade),
        ncm: String(linha.ncm ?? ""),
        cfop: String(linha.cfop ?? ""),
        titulo: String(linha.descricao ?? ""),
        referencia: String(linha.codigo ?? ""),
      };
    });
  }

  async function registrar(opts?: { ignorarVencida?: boolean }) {
    if (!parsed) return toast.error("Nenhuma nota fiscal processada.");
    if (ajustesValores && !motivoValoresCompra.trim()) return toast.error("Informe o motivo do ajuste dos valores de compra.");
    if (totalAPagar < 0 || linhasValoresCompra.some((linha) => totalItemEntrada(linha, valoresCompra[linha.chave] ?? linha.valor_unitario_compra) < 0)) {
      return toast.error("O total dos itens e da entrada não pode ser negativo.");
    }
    if (!parsed.fornecedorReferenteId)
      return toast.error(
        "A nota deve estar vinculada a um fornecedor do sistema.",
      );
    if (!linhasDisponiveis.length)
      return toast.error("Todos os itens desta nota já foram destinados.");
    if (entradaPersonalizada && temLinhasPersonalizadas) {
      if (temApropriacaoAnterior)
        return toast.error(
          "A entrada personalizada exige que nenhum item da NF-e tenha sido destinado.",
        );
      if (!parsed.documentoFiscalRecebidoId)
        return toast.error("A NF-e precisa estar vinculada ao documento fiscal recebido.");
      if (!destinoPersonalizado)
        return toast.error("Escolha o estoque de destino da entrada personalizada.");
      if (!itemPersonalizadoId)
        return toast.error("Selecione o item que receberá a entrada personalizada.");
      if (!rateioPersonalizado)
        return toast.error("Informe uma quantidade inteira maior que zero.");
    }
    if (temLinhasNormais) {
      if (semDestino)
        return toast.error(
          "Escolha o destino de todos os itens: estoque de revenda ou uso e consumo.",
        );
      if (semVinculo)
        return toast.error("Vincule todos os itens ao seu respectivo cadastro.");
    }
    if (
      (linhasUsoConsumo.length || personalizadaEmEstoqueSimples) &&
      duplicidades.length
    ) {
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
      // O alvo é o valor fiscal apropriado: com a nota inteira, o `vNF`; com
      // parte já destinada em outra entrada, o valor fiscal das linhas desta. É
      // o mesmo número que as RPCs conferem via `valorTotalDocumento`.
      if (Math.abs(soma - totalAPagar) > 0.01) {
        return toast.error(
          ajustesValores
            ? `A soma das parcelas deve ser ${formatarEmReal(totalAPagar)} — o total de compra atualizado.`
            : notaInteira
            ? `A soma das parcelas deve ser ${formatarEmReal(totalAPagar)} — o valor da NF-e.`
            : `A soma das parcelas deve ser ${formatarEmReal(totalAPagar)} — o valor fiscal desta entrada.`,
        );
      }
    }

    // Vencimento no passado é permitido — só se confirma antes de enviar, não
    // se bloqueia a digitação da parcela.
    const hoje = format(new Date(), "yyyy-MM-dd");
    const parcelaVencida =
      pagamentoFuturo &&
      parcelas.some((parcela) => parcela.dataVencimento && parcela.dataVencimento < hoje);

    if (parcelaVencida && !opts?.ignorarVencida) {
      setConfirmarVencidaAberto(true);
      return;
    }

    const financeiro = montarFinanceiro();
    const financeiroEstrito = pagamentoFuturo
      ? {
          parcelas: parcelas.map((parcela) => ({
            valor: parcela.valor,
            dataVencimento: parcela.dataVencimento,
          })),
          categoria,
          categoriaId:
            categorias.find((item) => item.nome === categoria)?.id ?? null,
          bancoId: bancoId ? Number(bancoId) : null,
          metodoPagamento: metodo || null,
          planoContaId: planoId ? Number(planoId) : null,
          centroCustoId: centroCustoId ? Number(centroCustoId) : null,
        }
      : null;
    const comum = {
      fornecedorId: parsed.fornecedorReferenteId,
      numeroNota: parsed.numeroNota ?? null,
      serie: parsed.serie ?? null,
      dataEmissao: parsed.dataEmissao ?? null,
      notaChave: parsed.chaveAcesso ?? null,
      documentoFiscalRecebidoId: parsed.documentoFiscalRecebidoId ?? null,
      // O motor original recebe a referência fiscal. A rotina atômica aplica
      // os ajustes e só então confere o financeiro pelo total atualizado.
      valorTotalDocumento: totalAPagarOriginal,
      ajustesValores,
    };

    setSubmitting(true);
    try {
      if (entradaHibrida) {
        await axios.post("/api/entradas/fiscal/hibrida", {
          ajustesValores,
          documentoFiscalRecebidoId: parsed.documentoFiscalRecebidoId,
          fornecedorId: parsed.fornecedorReferenteId,
          itensNormais: linhasNormais.map((linha) => ({
            numeroItem: Number(linha.numeroItem),
            destino: linha.destino!,
            itemReferenciaId:
              linha.destino === "ESTOQUE"
                ? linha.produtoReferenciaId!
                : linha.itemReferenciaId!,
          })),
          personalizado: {
            destino: destinoPersonalizado!,
            itemReferenciaId: itemPersonalizadoId!,
            quantidade: quantidadePersonalizadaNumero,
          },
          financeiro: financeiroEstrito,
        });
      } else if (entradaIntegralPersonalizada) {
        await axios.post("/api/entradas/fiscal/personalizada", {
          ajustesValores,
          documentoFiscalRecebidoId: parsed.documentoFiscalRecebidoId,
          fornecedorId: parsed.fornecedorReferenteId,
          destino: destinoPersonalizado,
          itemReferenciaId: itemPersonalizadoId,
          quantidade: quantidadePersonalizadaNumero,
          financeiro: financeiroEstrito,
        });
      } else if (notaDividida) {
        await axios.post("/api/entradas/fiscal/mista", {
          ...comum,
          ...financeiro,
          itensProduto: itensEstoquePayload(),
          escopo: escopoDaEntrada,
          itensUsoConsumo: itensUsoConsumoPayload(),
          tributosProduto: tributosDoEstoque,
          tributosUsoConsumo: tributosDoUsoConsumo,
        });
      } else if (linhasEstoque.length) {
        await axios.post("/api/entradas/fiscal", {
          ...comum,
          ...financeiro,
          fiscal: true,
          itens: itensEstoquePayload(),
          tributos: payloadDosLancamentos(lancamentosDre),
        });
      } else {
        await axios.post("/api/usoconsumo/entradas/fiscal", {
          ajustesValores,
          escopo: escopoDaEntrada,
          fornecedor_id: parsed.fornecedorReferenteId,
          chave_nfe: parsed.chaveAcesso,
          numero_nota: String(parsed.numeroNota ?? ""),
          serie_nota: String(parsed.serie ?? ""),
          data_emissao: parsed.dataEmissao,
          documento_fiscal_recebido_id: parsed.documentoFiscalRecebidoId,
          valor_total_documento: totalAPagarOriginal,
          itens: itensUsoConsumoPayload(),
          tributos: payloadDosLancamentos(lancamentosDre),
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
      // `data` e o eixo do fluxo de caixa: enquanto pendente carrega o vencimento.
      // `vencimento_em` fica para a baixa preencher, a partir de `data`.
      data: parcela.dataVencimento ? `${parcela.dataVencimento}T12:00:00` : agora,
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
    personalizadaValida &&
    (!temLinhasNormais ||
      (!semDestino && !semVinculo));

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
          showCloseButton={false}
          className="left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none motion-reduce:duration-0 sm:left-1/2 sm:top-1/2 sm:h-[min(850px,calc(100dvh-2rem))] sm:w-[95vw] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:shadow-lg"
          onDoubleClick={(evento) => evento.stopPropagation()}
        >
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fechar entrada por nota fiscal"
              disabled={submitting}
              className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 size-12 sm:right-4 sm:top-4 sm:size-9"
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>

          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b bg-background px-4 pb-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 sm:py-4 sm:pr-14">
              <DialogTitle>Entrada por Nota Fiscal</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                {entradaPersonalizada
                  ? "Escolha quais itens entram normalmente; os demais serão consolidados."
                  : "Cada item da nota recebe seu destino e vínculo no estoque."}
              </DialogDescription>
            </DialogHeader>

            {carregandoNota ? (
              <div className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-muted px-4 py-8 text-sm text-muted-foreground sm:px-6 sm:py-10">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Carregando nota fiscal...
              </div>
            ) : !parsed ? (
              <div className="relative min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted px-4 py-6 [-webkit-overflow-scrolling:touch] dark:bg-muted-foreground/5 sm:px-6 sm:py-10">
                <BotaoNf
                  file={file}
                  setFile={setFile}
                  setParsed={receberNota}
                />
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/60 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-6 [&_input]:min-h-12 [&_[data-slot=button]]:min-h-12 [&_[data-slot=select-trigger]]:min-h-12 sm:[&_input]:min-h-9 sm:[&_[data-slot=button]]:min-h-9 sm:[&_[data-slot=select-trigger]]:min-h-9">
                <div className="inline-flex min-h-12 items-center gap-1 rounded-md bg-muted py-1 pl-3 pr-1 sm:min-h-8">
                  <span className="text-xs text-muted-foreground">
                    1 nota selecionada
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover nota selecionada"
                    className="size-10 text-destructive sm:size-7"
                    onClick={() => {
                      setFile(undefined);
                      receberNota(null);
                    }}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>

                <Card
                  className={`w-full max-w-full gap-4 py-4 ${entradaPersonalizada ? "border-amber-400 bg-amber-50/70 dark:bg-amber-950/10" : ""}`}
                >
                  <CardHeader className="px-4 pb-0 sm:px-6">
                    <div className="flex min-h-12 items-center justify-between gap-4">
                      <div className="space-y-1">
                        <CardTitle className="text-base">Entrada personalizada</CardTitle>
                        <CardDescription className="text-xs leading-relaxed">
                          Consolida em um único item apenas as linhas desmarcadas abaixo.
                        </CardDescription>
                      </div>
                      <Switch
                        checked={entradaPersonalizada}
                        disabled={
                          carregandoApropriacoes ||
                          temApropriacaoAnterior ||
                          !parsed.documentoFiscalRecebidoId
                        }
                        onCheckedChange={(marcado) => {
                          setEntradaPersonalizada(marcado);
                          if (marcado) {
                            setDestinoPersonalizado(
                              (atual) => atual ?? destinosPermitidos[0],
                            );
                          }
                        }}
                        aria-label="Ativar entrada fiscal personalizada"
                      />
                    </div>
                  </CardHeader>

                  {temApropriacaoAnterior ? (
                    <CardContent className="px-4 text-xs text-amber-800 dark:text-amber-300 sm:px-6">
                      Esta NF-e já possui item destinado. A personalização só pode
                      consolidar uma nota ainda não apropriada.
                    </CardContent>
                  ) : entradaPersonalizada ? (
                    <CardContent className="space-y-4 px-4 sm:px-6">
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/70 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          {temLinhasPersonalizadas
                            ? `${linhasPersonalizadas.length} de ${linhasDisponiveis.length} linhas serão consolidadas. A quantidade final não precisa coincidir com as quantidades do fornecedor.`
                            : "Todas as linhas estão marcadas para entrada normal. Desmarque ao menos uma linha para formar a entrada personalizada."}
                        </p>
                      </div>

                      {temLinhasPersonalizadas ? (
                        <>
                      <div className="space-y-2">
                        <Label>Estoque de destino</Label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {destinosPermitidos.map((destino) => (
                            <Button
                              key={destino}
                              type="button"
                              variant={
                                destinoPersonalizado === destino
                                  ? "default"
                                  : "outline"
                              }
                              className="w-full justify-center text-xs"
                              onClick={() => {
                                if (destino === destinoPersonalizado) return;
                                setDestinoPersonalizado(destino);
                                if (destino === "ESTOQUE") {
                                  setItemPersonalizado(undefined);
                                } else {
                                  setProdutoPersonalizado(undefined);
                                  if (itemPersonalizado?.escopo !== destino) {
                                    setItemPersonalizado(undefined);
                                  }
                                }
                                setProdutoPersonalizadoOpen(false);
                                setItemPersonalizadoOpen(false);
                              }}
                            >
                              {DESTINO_LABEL[destino]}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {destinoPersonalizado ? (
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                          <div className="space-y-2">
                            <Label>Item que receberá a entrada</Label>
                            <div className="flex min-h-12 items-center gap-2 rounded-md border bg-background px-3 py-2">
                              <span
                                className={`min-w-0 flex-1 truncate text-sm ${itemPersonalizadoId ? "font-medium" : "text-muted-foreground"}`}
                              >
                                {itemPersonalizadoId
                                  ? itemPersonalizadoTitulo || `Item #${itemPersonalizadoId}`
                                  : "Nenhum item selecionado"}
                              </span>
                              {itemPersonalizadoId ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-9 text-destructive"
                                  aria-label="Remover item personalizado"
                                  onClick={() => {
                                    setProdutoPersonalizado(undefined);
                                    setItemPersonalizado(undefined);
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              ) : null}
                              {destinoPersonalizado === "ESTOQUE" ? (
                                <ProductSelect
                                  open={produtoPersonalizadoOpen}
                                  setOpen={setProdutoPersonalizadoOpen}
                                  OnSelect={(produto) => {
                                    setProdutoPersonalizado(produto);
                                    setProdutoPersonalizadoOpen(false);
                                  }}
                                >
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                  >
                                    <Search className="h-4 w-4" />
                                    Selecionar
                                  </Button>
                                </ProductSelect>
                              ) : ehEstoqueSimples(destinoPersonalizado) ? (
                                <ItemSelectDialog
                                  escopo={destinoPersonalizado}
                                  open={itemPersonalizadoOpen}
                                  setOpen={setItemPersonalizadoOpen}
                                  onSelect={(item) => {
                                    setItemPersonalizado(item);
                                    setItemPersonalizadoOpen(false);
                                  }}
                                >
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                  >
                                    <Search className="h-4 w-4" />
                                    Selecionar
                                  </Button>
                                </ItemSelectDialog>
                              ) : null}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="quantidade-entrada-personalizada">
                              Quantidade final
                            </Label>
                            <Input
                              id="quantidade-entrada-personalizada"
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={1}
                              value={quantidadePersonalizada}
                              onChange={(evento) =>
                                setQuantidadePersonalizada(evento.target.value)
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                        </>
                      ) : null}

                      <div className="grid gap-3 rounded-lg border bg-background p-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <p className="text-muted-foreground">Custo normal original</p>
                          <p className="mt-1 font-semibold tabular-nums">
                            {formatarEmReal(custoNormal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Custo consolidado original</p>
                          <p className="mt-1 font-semibold tabular-nums">
                            {formatarEmReal(custoPersonalizado)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Custo unitário original</p>
                          <p className="mt-1 font-semibold tabular-nums">
                            {rateioPersonalizado
                              ? formatarEmReal(rateioPersonalizado.custoUnitario)
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Custo total de estoque</p>
                          <p className="mt-1 font-semibold tabular-nums">
                            {formatarEmReal(custoEstoqueAtualizado)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Valor fiscal da nota</p>
                          <p className="mt-1 font-semibold tabular-nums">
                            {formatarEmReal(valorDaNota)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  ) : null}
                </Card>

                <Card className="w-full max-w-full gap-4 py-4 sm:py-6">
                  <CardHeader className="px-4 pb-0 sm:px-6">
                    <CardTitle className="text-base">Valores de compra</CardTitle>
                    <CardDescription>Informe os valores unitários de compra. Os valores originais da NF-e ficam preservados.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 px-4 sm:px-6">
                    {linhasValoresCompra.map((linha) => <div key={linha.chave} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
                      <div className="min-w-0 text-xs"><p className="font-medium">{linha.titulo}</p>
                        <p className="text-muted-foreground">Quantidade: {linha.quantidade}. Original da entrada: {formatarEmReal(linha.valor_unitario_compra)} por unidade.</p>
                        <p>Total do item: {formatarEmReal(totalItemEntrada(linha, valoresCompra[linha.chave] ?? linha.valor_unitario_compra))}</p>
                      </div>
                      <div className="space-y-1"><Label htmlFor={`compra-fiscal-${linha.chave}`}>Valor unitário de compra</Label>
                        <ValueInput id={`compra-fiscal-${linha.chave}`} decimals={4} mode="decimal" disabled={submitting}
                          value={valoresCompra[linha.chave] ?? linha.valor_unitario_compra}
                          onValueChange={(value) => setValoresCompra((current) => ({ ...current, [linha.chave]: value }))} />
                      </div>
                      <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={() => setValoresCompra((current) => {
                        const next = { ...current }; delete next[linha.chave]; return next;
                      })}>Restaurar valor original</Button>
                    </div>)}
                    {ajustesValores ? <div className="space-y-1">
                      <Label htmlFor="motivo-valores-compra-fiscal">Motivo do ajuste dos valores</Label>
                      <Textarea id="motivo-valores-compra-fiscal" value={motivoValoresCompra} maxLength={1000} disabled={submitting}
                        onChange={(event) => setMotivoValoresCompra(event.target.value)} placeholder="Descreva o motivo dos valores informados." />
                    </div> : null}
                    <div className="flex flex-wrap justify-between gap-2 text-sm" aria-live="polite">
                      <span>Valor da nota: {formatarEmReal(valorDaNota)}</span>
                      <strong>Total de compra: {formatarEmReal(totalAPagar)}</strong>
                    </div>
                  </CardContent>
                </Card>

                <Card className="w-full max-w-full gap-4 py-4 sm:py-6">
                  <CardHeader className="px-4 pb-2 sm:px-6">
                    <CardTitle className="flex flex-col items-start gap-3 text-base sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                      <span>Dados da NF-e</span>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {parsed.documentoFiscalRecebidoId ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-12 text-xs hover:cursor-pointer sm:min-h-8"
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
                        <Badge variant="outline" className="min-h-8">
                          NF nº {parsed.numeroNota || "—"}
                        </Badge>
                      </div>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Informações identificadas a partir do XML enviado.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 text-sm sm:px-6">
                    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="flex min-w-0 flex-1 flex-col space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Fornecedor:
                        </p>
                        <span className="max-w-full break-words text-xs sm:max-w-[250px]">
                          {parsed.emitente.nome ||
                            "Fornecedor não identificado"}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {parsed.emitente.nomeFantasia}
                        </span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {tipoDocumentoEmitente}:{" "}
                            {documentoEmitente || "Não informado"}
                          </span>
                          {parsed.emitente.ie ? (
                            <span>IE: {parsed.emitente.ie}</span>
                          ) : null}
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {parsed.fornecedorReferenteId ? (
                            <FornecedorSelect
                              open={fornecedorSelectOpen}
                              setOpen={setFornecedorSelectOpen}
                              OnSelect={selecionarFornecedor}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-12 min-w-0 max-w-full justify-start gap-2 bg-muted px-3 py-2 text-left text-xs font-normal text-muted-foreground hover:bg-muted sm:min-h-8 sm:max-w-[250px] sm:px-2 sm:py-1"
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
                          {canCreateFornecedor &&
                          !parsed.fornecedorReferenteId &&
                          !buscandoFornecedor ? (
                            <FornecedorDialog
                              dialogOpen={fornecedorDialogOpen}
                              setDialogOpen={setFornecedorDialogOpen}
                              handleGetFornecedor={buscarFornecedor}
                              dadosNovoFornecedor={{
                                cpfcnpj: documentoEmitente,
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Cadastrar fornecedor"
                                className="size-12 rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                                title="Cadastrar fornecedor"
                              >
                                <UserRoundPlus className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </FornecedorDialog>
                          ) : null}
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1 rounded-lg bg-muted/50 p-3 text-left text-xs text-muted-foreground sm:shrink-0 sm:bg-transparent sm:p-0 sm:text-right">
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
                          Valor fiscal a destinar:{" "}
                          <span className="font-semibold">
                            {formatarEmReal(valorFiscalDestinado)}
                          </span>
                        </p>
                        {custoDifereDoFiscal ? (
                          // Só aparece quando os dois divergem: repetir o mesmo
                          // número com dois rótulos seria ruído.
                          <p>
                            Custo original de estoque:{" "}
                            <span className="font-semibold">
                              {formatarEmReal(custoDestinado)}
                            </span>
                          </p>
                        ) : null}
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
                      {duplicatas.length ? (
                        <span>
                          Duplicatas:{" "}
                          <span className="font-semibold">
                            {duplicatas.length}
                          </span>
                        </span>
                      ) : null}
                      {componentesDaNota.map((componente) => (
                        <span key={componente.rotulo}>
                          {componente.rotulo}:{" "}
                          <span className="font-semibold">
                            {componente.redutor ? "−" : ""}
                            {formatarEmReal(componente.valor)}
                          </span>
                        </span>
                      ))}
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
                      {linhasPersonalizadas.length ? (
                        <span>
                          Personalizados: {" "}
                          <span className="font-semibold">
                            {linhasPersonalizadas.length}
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
                    {linhasFracionadas.length ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold">
                            Quantidade fracionada arredondada
                          </p>
                          <p>
                            {textoLinhasFracionadas(linhasFracionadas)}. O saldo
                            dos estoques é inteiro, então a linha entra no inteiro
                            mais próximo. O custo da linha não muda: o valor
                            unitário é recalculado.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {composicao && !composicao.composicaoValida ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold">
                            A composição da nota não fecha com o valor declarado
                          </p>
                          <p>
                            Produtos menos descontos mais os acréscimos dão{" "}
                            {formatarEmReal(composicao.totalCalculado)}, e a NF-e
                            declara {formatarEmReal(composicao.totalNota)} —
                            diferença de{" "}
                            {formatarEmReal(Math.abs(composicao.diferenca))}.
                          </p>
                          <p>
                            {composicao.divergenciaPrevista
                              ? "Nesta operação a própria validação da SEFAZ prevê exceção ao somatório, então a diferença pode ser legítima."
                              : "Vale o valor declarado pelo emitente: nada foi alterado aqui."}{" "}
                            O que se paga continua sendo{" "}
                            {formatarEmReal(composicao.totalNota)}.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {naoAlocados.length > 0 ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold">
                            Valores da NF-e sem alocação por item
                          </p>
                          <p>
                            {naoAlocados
                              .map(
                                (parte) =>
                                  `${parte.rotulo} ${formatarEmReal(parte.valor)}`,
                              )
                              .join(", ")}
                            .
                          </p>
                          <p>
                            Aparecem nos totais da NF-e sem `&lt;det&gt;` correspondente.
                            Continuam fazendo parte do valor fiscal e foram
                            apropriados proporcionalmente entre os itens desta
                            entrada — não somem do que se paga.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {custoDifereDoFiscal ? (
                      <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/20 dark:text-sky-300">
                        <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-2">
                          <p className="font-semibold">
                            Composição do custo de estoque
                          </p>
                          <div className="space-y-0.5">
                            <p>
                              Valor fiscal desta entrada:{" "}
                              <span className="font-semibold">
                                {formatarEmReal(valorFiscalDestinado)}
                              </span>
                            </p>
                            {foraDoCusto.map((parte, indice) => (
                              <p key={`${parte.tipo}-${parte.numeroItem}-${indice}`}>
                                {parte.sinalFiscal === -1 ? "+" : "−"}{" "}
                                {parte.rotulo} {formatarEmReal(parte.valor)}
                                {" · "}
                                {parte.origem === "ITEM"
                                  ? `item ${parte.numeroItem}`
                                  : "só no total da NF-e"}
                                {" · "}
                                {ROTULO_DO_TRATAMENTO[parte.tratamentoCusto]}:{" "}
                                {parte.motivoDoTratamento}
                              </p>
                            ))}
                            <p>
                              Custo original de estoque:{" "}
                              <span className="font-semibold">
                                {formatarEmReal(custoDestinado)}
                              </span>
                            </p>
                          </div>
                          <p>
                            O valor fiscal segue o XML. O custo efetivo de compra é
                            o que entra no preço de compra do produto e só chega à
                            DRE quando o item sair por venda ou por OS.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {lancamentosDre.length > 0 ? (
                      <div className="flex items-start gap-2 rounded-md border border-violet-300 bg-violet-50 p-3 text-xs text-violet-900 dark:bg-violet-950/20 dark:text-violet-300">
                        <Scale className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-2">
                          <p className="font-semibold">
                            O que vai para a DRE agora
                          </p>
                          <div className="space-y-0.5">
                            {lancamentosDre.map((lancamento) => (
                              <p key={lancamento.tipo}>
                                {lancamento.natureza === "RECEITA" ? "−" : "+"}{" "}
                                {lancamento.rotulo}{" "}
                                <span className="font-semibold">
                                  {formatarEmReal(lancamento.valor)}
                                </span>
                                {" · "}
                                {lancamento.natureza === "RECEITA"
                                  ? "reduz o custo do período"
                                  : "custo do período"}
                              </p>
                            ))}
                          </div>
                          <p>
                            Estes valores foram cobrados na nota e não viram
                            mercadoria, então não têm baixa futura para esperar:
                            entram no resultado na competência da NF-e
                            {parsed?.dataEmissao
                              ? ` (${new Date(parsed.dataEmissao).toLocaleDateString("pt-BR")})`
                              : ""}
                            . Os{" "}
                            <span className="font-semibold">
                              {formatarEmReal(custoEstoqueAtualizado)}
                            </span>{" "}
                            de mercadoria ficam no estoque e só chegam à DRE como
                            custo quando o item sair.
                          </p>
                          {conferencia.pendentes !== 0 ? (
                            <p className="font-semibold">
                              {formatarEmReal(Math.abs(conferencia.pendentes))} da
                              nota ainda estão sem classificação: pertencem ao
                              valor fiscal, não entraram no custo e não foram
                              lançados na DRE.
                            </p>
                          ) : null}
                          {!conferencia.fecha ? (
                            <p className="font-semibold">
                              Conferência: sobram{" "}
                              {formatarEmReal(Math.abs(conferencia.diferenca))} sem
                              destino. Nenhum valor foi alterado — revise antes de
                              gravar.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {(linhasUsoConsumo.length || personalizadaEmEstoqueSimples) &&
                    duplicidades.length ? (
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

                <div className="space-y-3">
                  {parsed.itens.map((linha, indice) => {
                    const vinculando = vinculandoIndices.includes(indice);
                    const bloqueado = Boolean(linha.destinoApropriado);
                    const numeroItem = Number(linha.numeroItem);
                    const entradaNormal =
                      !entradaPersonalizada ||
                      numerosNormaisPersonalizacao.has(numeroItem);
                    return (
                      <div
                        key={`${linha.numeroItem}-${linha.codigo}`}
                        className={`min-w-0 rounded-xl border p-3 text-xs not-dark:bg-white sm:p-4 ${bloqueado ? "opacity-60" : ""}`}
                      >
                        <div className="space-y-2">
                          <div className="border-b pb-2">
                            <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                                {entradaNormal &&
                                !bloqueado &&
                                !Number.isInteger(Number(linha.quantidade)) ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-400 text-amber-800 dark:text-amber-300"
                                  >
                                    Entra {valoresDeEstoque(linha).quantidade} no estoque
                                  </Badge>
                                ) : null}
                              </div>
                              {entradaPersonalizada && !bloqueado ? (
                                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5">
                                  <Switch
                                    checked={entradaNormal}
                                    onCheckedChange={(marcado) =>
                                      definirLinhaComoNormal(numeroItem, marcado)
                                    }
                                    aria-label={`Dar entrada normalmente no item ${linha.numeroItem}`}
                                  />
                                  <span className="whitespace-nowrap text-[11px] font-medium">
                                    Dar entrada normalmente
                                  </span>
                                </label>
                              ) : null}
                              <p className="shrink-0 rounded-md bg-muted px-2 py-1 font-bold sm:bg-transparent sm:p-0">
                                Total: {formatarEmReal(totalDaLinha(linha))}
                              </p>
                            </div>
                            <p className="break-words font-semibold leading-relaxed text-muted-foreground">
                              {linha.descricao}
                            </p>
                          </div>

                          <div className="grid min-w-0 grid-cols-2 gap-3 pt-2 text-xs md:grid-cols-3 lg:grid-cols-4 [&>p]:min-w-0 [&>p]:break-words">
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

                          {entradaPersonalizada && !entradaNormal ? (
                            <>
                              <Separator />
                              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                                <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />
                                <div>
                                  <p className="font-semibold">Item original da NF-e</p>
                                  <p className="mt-0.5 text-[11px] leading-relaxed">
                                    Esta linha será preservada na auditoria e
                                    consolidada no item personalizado escolhido acima.
                                  </p>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <Separator />

                          {!bloqueado ? (
                            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                              <span className="text-muted-foreground">
                                Destino:
                              </span>
                              <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border bg-muted/40 p-1 sm:inline-flex sm:w-auto">
                                {destinosPermitidos.map((destino) => (
                                  <button
                                    key={destino}
                                    type="button"
                                    onClick={() =>
                                      escolherDestino(indice, destino)
                                    }
                                    className={`inline-flex min-h-12 items-center justify-center rounded-md px-3 text-xs font-medium transition-all hover:cursor-pointer sm:min-h-8 sm:text-[11px] ${
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
                            className={`flex min-w-0 flex-wrap items-center gap-2 ${bloqueado || !linha.destino ? "pointer-events-none opacity-50" : ""}`}
                          >
                            <div
                              className={`relative flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md bg-muted py-2 pl-3 pr-12 text-xs sm:min-h-8 sm:w-auto sm:max-w-[300px] sm:px-2 sm:py-1 sm:pr-9 ${
                                vinculando
                                  ? "text-primary"
                                  : linhaVinculada(linha)
                                    ? "text-muted-foreground"
                                    : "text-red-400"
                              }`}
                            >
                              <span
                                className="min-w-0 truncate"
                                title={vinculando ? undefined : rotuloVinculo(linha)}
                              >
                                {vinculando
                                  ? "Buscando vínculo..."
                                  : rotuloVinculo(linha)}
                              </span>
                              {linhaVinculada(linha) && !bloqueado ? (
                                <button
                                  type="button"
                                  aria-label={`Remover vínculo do item ${linha.numeroItem}`}
                                  className="absolute right-0 inline-flex size-12 items-center justify-center rounded-md text-destructive hover:bg-muted-foreground/10 sm:size-8"
                                  onClick={() =>
                                    atualizarLinha(indice, {
                                      produtoReferenciaId: undefined,
                                      produtoReferencia: undefined,
                                      itemReferenciaId: undefined,
                                      itemReferencia: undefined,
                                    })
                                  }
                                >
                                  <X className="h-4 w-4" aria-hidden="true" />
                                </button>
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
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Selecionar produto para o item ${linha.numeroItem}`}
                                    className="size-12 rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                                    title="Selecionar produto"
                                  >
                                    <Search className="h-4 w-4" aria-hidden="true" />
                                  </Button>
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
                                      // O id é compartilhado entre as linhas: o
                                      // cadastro anterior o deixa preenchido.
                                      if (aberto) {
                                        setProdutoSelecionadoId(undefined);
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
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Criar produto para o item ${linha.numeroItem}`}
                                      className="size-12 rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                                      title="Criar produto"
                                    >
                                      <PackagePlus className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </DialogProduto>
                                ) : null}
                              </>
                            ) : null}

                            {ehEstoqueSimples(linha.destino) && !bloqueado ? (
                              <>
                                <ItemSelectDialog
                                  escopo={linha.destino}
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
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Selecionar item de uso e consumo para o item ${linha.numeroItem}`}
                                    className="size-12 rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                                    title="Selecionar item"
                                  >
                                    <Search className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </ItemSelectDialog>
                                {!linha.itemReferenciaId ? (
                                  <button
                                    type="button"
                                    aria-label={`Criar item de uso e consumo para o item ${linha.numeroItem}`}
                                    className="inline-flex size-12 items-center justify-center rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                                    title="Criar item de uso e consumo"
                                    onClick={() => abrirCadastroItemUso(indice)}
                                  >
                                    <PackagePlus className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`Editar item de uso e consumo vinculado ao item ${linha.numeroItem}`}
                                    className="inline-flex size-12 items-center justify-center rounded-full bg-primary/20 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
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
                                    <Pencil className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                )}
                              </>
                            ) : null}
                          </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Separator />

                <div className="space-y-3 rounded-2xl bg-card p-3 sm:p-4">
                  <div className="flex min-h-12 items-center justify-between gap-3">
                    <span
                      className={`min-w-0 text-xs leading-relaxed ${pagamentoFuturo ? "text-accent-foreground" : "text-muted-foreground"}`}
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
                          // Sem parcelas não há o que ter vindo da duplicata: a
                          // marca ficaria dizendo que um preenchimento que não
                          // existe mais veio do XML.
                          setUsarDuplicatas(false);
                          setParcelasManuais([]);
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

                      {duplicatas.length ? (
                        <div className="space-y-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-[11px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200">
                          <div className="flex items-start gap-2">
                            <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="min-w-0 space-y-1">
                              <p className="text-xs font-semibold">
                                {duplicatas.length === 1
                                  ? "A NF-e traz 1 duplicata"
                                  : `A NF-e traz ${duplicatas.length} duplicatas`}{" "}
                                — {formatarEmReal(totalDuplicatasEmCentavos / 100)}
                                {parsed.fatura?.numero
                                  ? ` (fatura ${parsed.fatura.numero})`
                                  : ""}
                              </p>
                              <ul className="space-y-0.5">
                                {duplicatas.map((duplicata, indice) => (
                                  <li
                                    key={`${duplicata.numero ?? indice}-${duplicata.vencimento ?? indice}`}
                                    className="flex flex-wrap gap-x-2 tabular-nums"
                                  >
                                    <span className="font-medium">
                                      {duplicata.numero
                                        ? `Dup. ${duplicata.numero}`
                                        : `${indice + 1}ª`}
                                    </span>
                                    <span>
                                      {duplicata.vencimento
                                        ? vencimentoFormatado(duplicata.vencimento)
                                        : "sem vencimento no XML"}
                                    </span>
                                    <span className="font-semibold">
                                      {formatarEmReal(duplicata.valor)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {!duplicatasBatemComDestinado ? (
                                <p className="text-amber-700 dark:text-amber-400">
                                  As duplicatas cobrem a nota inteira
                                  {" "}({formatarEmReal(totalDuplicatasEmCentavos / 100)}) e
                                  esta entrada paga{" "}
                                  {formatarEmReal(totalAPagar)}. Usando os dados
                                  da duplicata, ajuste os valores antes de
                                  registrar.
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <label className="flex min-h-12 cursor-pointer items-center gap-2 sm:min-h-0">
                            <Checkbox
                              checked={usarDuplicatas}
                              onCheckedChange={(marcado) => {
                                if (marcado === true) {
                                  // Guarda o que estava digitado: desmarcar tem
                                  // que devolver o trabalho do usuário, não um
                                  // formulário em branco.
                                  setParcelasManuais(parcelas);
                                  setParcelas(parcelasDasDuplicatas());
                                  setUsarDuplicatas(true);
                                  return;
                                }
                                setParcelas(
                                  parcelasManuais.length
                                    ? parcelasManuais
                                    : [{ id: Date.now(), valor: 0 }],
                                );
                                setUsarDuplicatas(false);
                              }}
                            />
                            <span className="text-xs">
                              Preencher as parcelas com as duplicatas do XML
                            </span>
                          </label>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        {parcelas.map((parcela, indice) => (
                          <div
                            key={parcela.id}
                            className="relative grid gap-3 rounded-xl bg-muted-foreground/5 px-3 pb-3 pt-14 sm:grid-cols-[auto_1fr_1fr] sm:items-end sm:py-6"
                          >
                            <span className="absolute left-3 top-1 text-xs text-muted-foreground">
                              {indice + 1}ª parcela
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remover ${indice + 1}ª parcela`}
                              className="absolute right-2 top-2 size-12 text-destructive sm:static sm:size-9"
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
                                className="min-h-12 sm:min-h-9"
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
                                className="min-h-12 sm:min-h-9"
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
                        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-12 w-full sm:min-h-9 sm:w-auto"
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
                          <span className="text-xs leading-relaxed text-muted-foreground sm:text-right">
                            Parcelas:{" "}
                            {formatarEmReal(
                              parcelas.reduce((soma, p) => soma + p.valor, 0),
                            )}{" "}
                            de {formatarEmReal(totalAPagar)}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-4 rounded-2xl bg-muted/50 p-3 sm:p-4">
                        <div className="min-w-0 space-y-1 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
                          <Label>Categoria</Label>
                          <SearchCombobox
                            value={categoria}
                            options={categorias.map((entrada) => ({
                              value: entrada.nome,
                              label: entrada.nome,
                              description: entrada.descricao ?? undefined,
                            }))}
                            loading={loadingCategorias}
                            placeholder="Selecione a categoria"
                            searchPlaceholder="Pesquisar categoria..."
                            emptyMessage="Nenhuma categoria encontrada."
                            onValueChange={setCategoria}
                          />
                        </div>

                        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="w-full space-y-1">
                            <Label>Banco</Label>
                            <Select value={bancoId} onValueChange={setBancoId}>
                              <SelectTrigger className="min-h-12 w-full sm:min-h-9">
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
                          <div className="w-full space-y-1">
                            <Label>Método</Label>
                            <Select
                              value={metodo}
                              onValueChange={(valor) =>
                                setMetodo(valor as Metodo_pagamento)
                              }
                            >
                              <SelectTrigger className="min-h-12 w-full sm:min-h-9">
                                <SelectValue placeholder="Não informado" />
                              </SelectTrigger>
                              <SelectContent>
                                {metodosPagamento.map((metodo) => (
                                  <SelectItem
                                    key={metodo.value}
                                    value={metodo.value}
                                  >
                                    {metodo.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 space-y-1 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
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
                          <div className="min-w-0 space-y-1 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
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

            <DialogFooter className="shrink-0 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {parsed ? (
                  <div className="flex items-center justify-between gap-3 text-sm sm:block">
                    <span className="text-muted-foreground">
                      {notaInteira ? "A pagar:" : "Valor fiscal:"}
                    </span>{" "}
                    <span className="font-semibold tabular-nums">
                      {formatarEmReal(totalAPagar)}
                    </span>
                  </div>
                ) : (
                  <span className="hidden sm:block" />
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <DialogClose asChild>
                    <Button
                      type="button"
                      className="min-h-12 w-full hover:cursor-pointer sm:min-h-9 sm:w-auto"
                      variant="outline"
                      disabled={submitting}
                    >
                      Cancelar
                    </Button>
                  </DialogClose>

                  <Button
                    type="button"
                    className="min-h-12 w-full hover:cursor-pointer sm:min-h-9 sm:min-w-28 sm:w-auto"
                    onClick={() => void registrar()}
                    disabled={!podeRegistrar}
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Registrar
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarVencidaAberto} onOpenChange={setConfirmarVencidaAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Parcela com vencimento vencido</AlertDialogTitle>
            <AlertDialogDescription>
              Uma ou mais parcelas têm vencimento no passado. A entrada será
              registrada mesmo assim, com o(s) título(s) já vencido(s). Deseja
              continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmarVencidaAberto(false);
                void registrar({ ignorarVencida: true });
              }}
            >
              Registrar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ItemDialog
        escopo={escopoDoItemEmEdicao}
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
