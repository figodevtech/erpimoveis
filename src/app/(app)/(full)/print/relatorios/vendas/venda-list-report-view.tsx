"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { PrintDisplayOptionsMenu } from "@/app/(app)/(full)/components/PrintDisplayOptionsMenu";
import {
  PrintFilterMenu,
  PrintGroupingMenu,
  type PrintFilterOption,
} from "@/app/(app)/(full)/components/PrintFilterMenu";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import {
  CATEGORIAS_DE_EVENTO,
  categoriasDoEvento,
  comissoesPorTipoDeItem,
  deducoesDaOs,
  somaOrigemNatureza,
  somarEventosDaOs,
  somarLucroRealPorStatus,
  type CategoriaDeEvento,
  type EventoClassificavel,
  type TotaisDosEventos,
} from "@/lib/ordens/eventos-financeiros";
import {
  alturaDoFechamento,
  alturaLucroRealPorStatus,
  COLUNAS_LUCRO_STATUS,
  MM_CABECALHO_ITENS,
  MM_ESPACO_VENDA,
  MM_ITEM,
  MM_TITULO_DO_FILTRO,
  MM_VENDA,
  MM_VENDA_CONTINUACAO,
  paginarLancamentos,
  paginarVendas,
  type FatiaVenda,
  type ItemDaVenda,
  type ModoDaFolha,
  type SaleRow,
} from "./venda-list-report-model";
import {
  FolhaDoResumoFinanceiro,
  type ConciliacaoDoRecorte,
} from "../_resumo-financeiro/folha-do-resumo-financeiro";
import {
  lerResumoFinanceiro,
  resumirRecebimentosPorMetodo,
  SALDOS_ZERADOS,
  type RecebimentoDaFolha,
  type SaldosDoRecorte,
} from "../_resumo-financeiro/resumo-financeiro-model";

/**
 * Relação de vendas em A4 retrato.
 *
 * Folha irmã da relação de ordens (`../ordens`), e de propósito: quem lê as duas
 * no balcão lê o mesmo desenho — bloco de três linhas por documento, painel de
 * fechamento no topo, itens ou eventos sob demanda. Procura-se a venda pelo
 * número ou pelo cliente, e o resto se lê depois de achar.
 *
 * Os dados vêm da mesma exportação em xlsx que alimenta o Excel, lidos por nome
 * de coluna. É a convenção das outras folhas de impressão: uma fonte só para o
 * arquivo e para o papel, sem uma segunda rota que possa divergir.
 *
 * Duas opções abrem cada venda, e uma exclui a outra, como na relação de
 * ordens: "Exibir itens das vendas" mostra os produtos que formaram o valor, e
 * "Exibir eventos financeiros" mostra o que de fato entrou e saiu, até o lucro
 * real. Com os eventos na folha, "Filtrar" escolhe os tipos de lançamento e
 * "Agrupar" decide a forma — a mesma regra da OS, lida de
 * `@/lib/ordens/eventos-financeiros`.
 *
 * Venda só tem produto. Os tipos de serviço e de consumo não existem aqui, e
 * toda comissão da venda é comissão de produto.
 */

type Cell = string | number | boolean | null;

/**
 * Acima deste número de folhas, gerar o PDF vira um problema: o `A4PdfActions`
 * rasteriza uma seção por vez, e cem delas levam minutos e centenas de MB. O
 * aviso fica na barra, nunca no papel, e não bloqueia nada.
 */
const FOLHAS_PARA_AVISAR = 60;

type Agrupamento = "VENDA" | "NENHUM";

const OPCOES_DE_AGRUPAMENTO: PrintFilterOption<Agrupamento>[] = [
  { value: "VENDA", label: "Por venda" },
  { value: "NENHUM", label: "Sem agrupamento" },
];

/**
 * Os tipos de evento que existem numa venda, na ordem dos cards. Serviço e
 * consumo ficam de fora: venda não tem nenhum dos dois, e um filtro com opção
 * que nunca traz nada só faz procurar.
 */
const CATEGORIAS_DA_VENDA = CATEGORIAS_DE_EVENTO.filter((categoria) =>
  (["RECEITA_PRODUTOS", "CUSTO_PRODUTOS", "COMISSOES_PRODUTOS", "DESCONTOS", "RECEITA_FRETE", "DESPESA_FRETE", "OUTROS"] as string[]).includes(
    categoria.chave,
  ),
);
const CHAVES_DA_VENDA = new Set<CategoriaDeEvento>(CATEGORIAS_DA_VENDA.map((categoria) => categoria.chave));

/** O filtro padrão: todo tipo marcado, inclusive "Outros". */
const TODAS_AS_CATEGORIAS = CATEGORIAS_DA_VENDA.map((categoria) => categoria.chave);

/**
 * Em que tipo do filtro da venda o evento cai. Um evento de tipo que a venda
 * não tem — serviço, consumo — vai para "Outros": sem isso ele sumiria com
 * tudo marcado, e a lista deixaria de fechar com o lucro real.
 */
function categoriasDaVenda(evento: EventoClassificavel): CategoriaDeEvento[] {
  return categoriasDoEvento(evento).map((categoria) => (CHAVES_DA_VENDA.has(categoria) ? categoria : "OUTROS"));
}

function eventoPassaNoFiltroDaVenda(evento: EventoClassificavel, selecionadas: ReadonlySet<CategoriaDeEvento>) {
  return categoriasDaVenda(evento).some((categoria) => selecionadas.has(categoria));
}

const STATUS_LABEL: Record<string, string> = {
  ORCAMENTO: "Em orçamento",
  APROVACAO_ORCAMENTO: "Aguardando aprovação",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
  ABERTA: "Aberta",
  PAGAMENTO: "Pagamento",
  PENDENTE: "Pendente",
  PAGO: "Pago",
  AUTORIZADO: "Autorizado",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
  CANCELADO: "Cancelada",
};

/**
 * Tom de cada status, na mesma paleta da relação de ordens. Impresso em preto e
 * branco vira escala de cinza, então a cor acompanha o rótulo — nunca o
 * substitui.
 *
 * `CANCELADA` e `CANCELADO` são a mesma coisa em duas grafias que convivem no
 * enum; as duas precisam de tom, senão metade das canceladas sai sem cor.
 */
const STATUS_TOM: Record<string, { faixa: string; selo: string }> = {
  ORCAMENTO: { faixa: "bg-amber-400", selo: "bg-amber-50 text-amber-800" },
  APROVACAO_ORCAMENTO: { faixa: "bg-amber-500", selo: "bg-amber-50 text-amber-800" },
  ORCAMENTO_APROVADO: { faixa: "bg-sky-500", selo: "bg-sky-50 text-sky-800" },
  ORCAMENTO_RECUSADO: { faixa: "bg-red-400", selo: "bg-red-50 text-red-800" },
  ABERTA: { faixa: "bg-blue-500", selo: "bg-blue-50 text-blue-800" },
  PAGAMENTO: { faixa: "bg-violet-500", selo: "bg-violet-50 text-violet-800" },
  PENDENTE: { faixa: "bg-neutral-400", selo: "bg-neutral-100 text-neutral-700" },
  PAGO: { faixa: "bg-emerald-500", selo: "bg-emerald-50 text-emerald-800" },
  AUTORIZADO: { faixa: "bg-teal-500", selo: "bg-teal-50 text-teal-800" },
  FINALIZADA: { faixa: "bg-emerald-600", selo: "bg-emerald-50 text-emerald-800" },
  CANCELADA: { faixa: "bg-red-500", selo: "bg-red-50 text-red-800" },
  CANCELADO: { faixa: "bg-red-500", selo: "bg-red-50 text-red-800" },
};

const SEM_TOM = { faixa: "bg-neutral-300", selo: "bg-neutral-100 text-neutral-700" };

const CANAL_LABEL: Record<string, string> = {
  PDV: "Balcão (PDV)",
  ONLINE: "Loja online",
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
};

const ROTULO_ORIGEM: Record<string, string> = {
  DESCONTO: "Descontos",
  COMISSAO: "Comissões",
  CONSUMO: "Consumo",
  FRETE: "Frete",
  AVULSO: "Avulsos",
  ENTRADA_FISCAL: "Entrada fiscal",
};

/**
 * Selo de cada origem, nas cores da relação de ordens. Verde e vermelho ficam
 * de fora: já significam soma e abatimento nos valores.
 */
const TOM_ORIGEM: Record<string, string> = {
  PRODUTO: "bg-sky-50 text-sky-800",
  SERVICO: "bg-violet-50 text-violet-800",
  COMISSAO: "bg-amber-50 text-amber-800",
  CONSUMO: "bg-orange-100 text-orange-900",
  FRETE: "bg-cyan-50 text-cyan-900",
  DESCONTO: "bg-neutral-100 text-neutral-700",
  AVULSO: "bg-neutral-100 text-neutral-700",
  ENTRADA_FISCAL: "bg-neutral-100 text-neutral-700",
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function text(value: Cell) {
  const limpo = String(value ?? "").trim();
  return limpo || "—";
}

function number(value: Cell) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Quantidade de venda é inteira, mas o formatador não custa e não estorva. */
function quantidade(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/**
 * Parcela do fechamento. O sinal vem da posição na conta, não do número: o
 * desconto é gravado positivo e entra subtraindo.
 */
const TOM_SOMA = "text-emerald-700";
const TOM_SUBTRACAO = "text-red-700";

function signedMoney(value: number, sinal: 1 | -1) {
  return `${sinal < 0 ? "−" : "+"}${money(Math.abs(value))}`;
}

type EventoDaVenda = {
  chave: string;
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  status: string;
  descricao: string;
  detalhe: string;
  valor: number;
  /** Quanto desta comissão veio de produto — na venda, a comissão inteira. */
  comissaoProdutos: number;
  itemDaComissao: "PRODUTO" | "SERVICO" | null;
};

/** Uma linha da tabela crua: o evento, com a venda de onde ele veio. */
type LancamentoDaFolha = { chave: string; venda: SaleRow; evento: EventoDaVenda };

type CardFechamento = {
  chave: string;
  label: string;
  value: string;
  valor: number;
  tone?: string;
  destaque?: boolean;
  /** O tipo do filtro que o card representa. Cards de total não têm. */
  categoria?: CategoriaDeEvento;
};

/** "12/03/2026, 14:20" -> "12/03/2026": a hora não cabe e não decide nada aqui. */
function dayOf(value: Cell) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.split(",")[0].trim() || "—";
}

function statusLabel(codigo: string) {
  return STATUS_LABEL[codigo] ?? (codigo ? codigo.replaceAll("_", " ") : "—");
}

function canalLabel(codigo: string) {
  return CANAL_LABEL[codigo] ?? (codigo ? codigo.replaceAll("_", " ") : "—");
}

/** "PRODUTO" ou "SERVICO"; vazio vira nulo. */
function lerItemDaComissao(value: Cell) {
  const limpo = String(value ?? "").trim();
  return limpo === "PRODUTO" || limpo === "SERVICO" ? limpo : null;
}

/**
 * Uma aba da exportação, lida por nome de coluna — como nas outras folhas.
 * Devolve nulo quando a aba não veio, que é o caso da aba de itens numa
 * resposta pedida sem `itens=1`.
 */
async function lerAba(buffer: ArrayBuffer, nome: string | number) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[typeof nome === "number" ? workbook.SheetNames[nome] : nome];
  if (!sheet) return null;

  const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
  const headers = (matrix[0] ?? []).map(normalize);
  const column = (label: string) => headers.indexOf(normalize(label));

  return {
    rows: matrix.slice(1),
    read: (row: Cell[], label: string) => row[column(label)] ?? null,
  };
}

async function respostaEmBuffer(response: Response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Não foi possível gerar o relatório.");
  }
  return response.arrayBuffer();
}

/** Período do relatório, lido dos próprios filtros da chamada. */
function periodLabel(endpoint: string) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const br = (value: string) => value.split("-").reverse().join("/");
  const from = params.get("dateFrom");
  const to = params.get("dateTo");

  if (from && to) return `${br(from)} a ${br(to)}`;
  if (from) return `A partir de ${br(from)}`;
  if (to) return `Até ${br(to)}`;
  return "Todo o período";
}

function periodAxisLabel(endpoint: string) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const campo = params.get("campoData");
  if (campo === "pagamento") return "Pagamento da venda";
  if (campo === "baixa") return "Baixa da venda";
  return "Data da venda";
}

/**
 * Faixa de filtros aplicados.
 *
 * Categoria, cliente, vendedor e criador chegam como id no endereço, que não diz
 * nada a quem lê a folha. Como o filtro deixa um único valor no resultado, o
 * nome sai das próprias linhas — e some quando não há linha nenhuma para
 * consultar.
 */
function filtrosAplicados(endpoint: string, rows: SaleRow[]) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const chips: string[] = [];

  // Acima de três status a lista inteira quebraria a faixa em várias linhas e
  // comeria a altura reservada para as vendas; o número basta para conferir.
  const status = (params.get("status") ?? "").split(",").filter(Boolean);
  if (status.length && status.length <= 3) chips.push(`Status: ${status.map(statusLabel).join(", ")}`);
  else if (status.length) chips.push(`Status: ${status.length} selecionados`);

  const canal = params.get("canal");
  if (canal) chips.push(`Canal: ${canalLabel(canal)}`);

  const primeira = rows[0];
  if (params.get("categoriaVendaId") && primeira) chips.push(`Categoria: ${primeira.category}`);
  if (params.get("clienteId") && primeira) chips.push(`Cliente: ${primeira.customer}`);
  if (params.get("vendedorId") && primeira) chips.push(`Vendedor: ${primeira.seller}`);
  if (params.get("criadorId") && primeira) chips.push(`Lançado por: ${primeira.creator}`);
  if (params.get("vendaId")) chips.push(`Venda #${params.get("vendaId")}`);

  return chips;
}

export function VendaListReportView({
  endpoint,
  podeVerEventos = false,
}: {
  endpoint: string;
  /** Decidido no servidor: custo e lucro têm a trava do painel da venda. */
  podeVerEventos?: boolean;
}) {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Um modo só, em vez de um booleano por opção: a exclusão mútua entre "itens"
  // e "eventos" fica garantida pelo tipo, sem dois estados podendo divergir.
  const [modo, setModo] = useState<ModoDaFolha>("simples");
  const [filtros, setFiltros] = useState<Set<CategoriaDeEvento>>(() => new Set(TODAS_AS_CATEGORIAS));
  const [agrupamento, setAgrupamento] = useState<Agrupamento>("VENDA");
  /** O painel de cards, a distribuição e o lucro por status. Título e filtros saem sempre. */
  const [exibirCabecalho, setExibirCabecalho] = useState(true);
  /** A folha final com os recebimentos por forma de pagamento. */
  const [exibirResumoFinanceiro, setExibirResumoFinanceiro] = useState(true);
  const [recebimentos, setRecebimentos] = useState<RecebimentoDaFolha[]>([]);
  const [saldos, setSaldos] = useState<SaldosDoRecorte>(SALDOS_ZERADOS);
  const [cacheDeItens, setCacheDeItens] = useState<{ endpoint: string; linhas: Map<string, ItemDaVenda[]> } | null>(null);
  const [cacheDeEventos, setCacheDeEventos] = useState<{ endpoint: string; linhas: Map<string, EventoDaVenda[]> } | null>(null);
  const [enderecoComFalha, setEnderecoComFalha] = useState<string | null>(null);
  const [carregandoItens, setCarregandoItens] = useState(false);

  // O cache pertence ao recorte que o gerou: mudou o endereço, ele não vale
  // mais. Derivar isso no render dispensa um efeito de limpeza, que existiria
  // só para zerar estado — e renderizaria em cascata para isso.
  const itensPorVenda = cacheDeItens?.endpoint === endpoint ? cacheDeItens.linhas : null;
  const eventosPorVenda = cacheDeEventos?.endpoint === endpoint ? cacheDeEventos.linhas : null;
  const erroItens = enderecoComFalha === endpoint;

  useEffect(() => {
    let active = true;
    // Os eventos vêm já na primeira chamada, e não sob demanda: o painel de
    // cards é sempre o mesmo, em qualquer modo, e ele precisa de custo e lucro
    // para existir. Quem não tem permissão para vê-los recebe a folha sem eles.
    const separador = endpoint.includes("?") ? "&" : "?";
    fetch(podeVerEventos ? `${endpoint}${separador}eventos=1` : endpoint)
      .then(respostaEmBuffer)
      .then(async (buffer) => {
        const aba = await lerAba(buffer, 0);
        if (!aba) throw new Error("A planilha do relatório veio vazia.");
        const { rows: matrix, read } = aba;

        if (podeVerEventos) {
          const abaEventos = await lerAba(buffer, "Eventos");
          const agrupados = new Map<string, EventoDaVenda[]>();
          (abaEventos?.rows ?? []).forEach((row, indice) => {
            const vendaId = text(abaEventos!.read(row, "Venda"));
            const lista = agrupados.get(vendaId) ?? [];
            lista.push({
              chave: `${vendaId}-${indice}`,
              origem: String(abaEventos!.read(row, "Origem") ?? "").trim(),
              natureza: String(abaEventos!.read(row, "Natureza") ?? "").trim() === "DESPESA" ? "DESPESA" : "RECEITA",
              status: String(abaEventos!.read(row, "Situação") ?? "").trim(),
              descricao: String(abaEventos!.read(row, "Descrição") ?? "").trim(),
              detalhe: String(abaEventos!.read(row, "Detalhe") ?? "").trim(),
              valor: number(abaEventos!.read(row, "Valor (R$)")),
              comissaoProdutos: number(abaEventos!.read(row, "Comissão de produtos (R$)")),
              itemDaComissao: lerItemDaComissao(abaEventos!.read(row, "Item da comissão")),
            });
            agrupados.set(vendaId, lista);
          });
          if (active) setCacheDeEventos({ endpoint, linhas: agrupados });
        }

        const parsed = matrix.map((row) => ({
          id: text(read(row, "Venda")),
          status: String(read(row, "Status") ?? "").trim(),
          channel: String(read(row, "Canal") ?? "").trim(),
          category: text(read(row, "Categoria")),
          customer: text(read(row, "Cliente")),
          document: text(read(row, "CPF/CNPJ")),
          seller: text(read(row, "Vendedor")),
          creator: text(read(row, "Lançado por")),
          payment: text(read(row, "Forma de pagamento")),
          installments: String(read(row, "Parcelas") ?? "").trim(),
          description: text(read(row, "Descrição")),
          soldAt: dayOf(read(row, "Data da venda")),
          paidAt: dayOf(read(row, "Pagamento")),
          subtotal: number(read(row, "Subtotal (R$)")),
          discount: number(read(row, "Desconto (R$)")),
          freight: number(read(row, "Frete (R$)")),
          total: number(read(row, "Total (R$)")),
          surcharge: number(read(row, "Acréscimo financeiro (R$)")),
        }));

        // Os saldos vêm da aba principal, por venda, pela conta da tela de
        // pagamento; a repartição por método vem da aba de recebimentos.
        const resumoFinanceiro = lerResumoFinanceiro(aba, await lerAba(buffer, "Recebimentos"), "Venda");

        if (active) {
          setRows(parsed);
          setSaldos(resumoFinanceiro.saldos);
          setRecebimentos(resumoFinanceiro.recebimentos);
        }
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Não foi possível gerar o relatório.";
        if (active) {
          setError(message);
          toast.error(message);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [endpoint, podeVerEventos]);

  /**
   * Os itens vêm numa segunda chamada, disparada no clique — evento, e não
   * efeito: não há dobra do StrictMode nem cleanup a coordenar. Uma vez em
   * mãos ficam em cache, então marcar e desmarcar depois é instantâneo.
   *
   * Só a aba "Itens" é lida. Reprocessar a aba principal faria uma segunda
   * resposta lenta atropelar as vendas já montadas na tela.
   */
  const carregarItens = useCallback(() => {
    if (itensPorVenda || carregandoItens) return;
    setCarregandoItens(true);
    setEnderecoComFalha(null);

    const separador = endpoint.includes("?") ? "&" : "?";
    fetch(`${endpoint}${separador}itens=1`)
      .then(respostaEmBuffer)
      .then(async (buffer) => {
        const aba = await lerAba(buffer, "Itens");
        // Sem a aba, o cache ficaria vazio e toda venda imprimiria "sem itens
        // lançados" — um erro que se parece com um resultado.
        if (!aba) throw new Error("A exportação não trouxe a aba de itens.");
        const agrupados = new Map<string, ItemDaVenda[]>();

        // A coluna Venda volta do xlsx como número e `SaleRow.id` é texto; sem
        // normalizar os dois lados toda venda ficaria com zero itens, e a opção
        // pareceria não fazer nada.
        aba.rows.forEach((row, indice) => {
          const vendaId = text(aba.read(row, "Venda"));
          const lista = agrupados.get(vendaId) ?? [];
          lista.push({
            chave: `${vendaId}-${indice}`,
            codigo: String(aba.read(row, "Código") ?? "").trim(),
            descricao: String(aba.read(row, "Descrição") ?? "").trim(),
            unidade: String(aba.read(row, "Unidade") ?? "").trim(),
            quantidade: number(aba.read(row, "Quantidade")),
            precoUnitario: number(aba.read(row, "Preço unitário (R$)")),
            descontoItem: number(aba.read(row, "Desconto do item (R$)")),
            freteItem: number(aba.read(row, "Frete do item (R$)")),
            subtotal: number(aba.read(row, "Subtotal (R$)")),
          });
          agrupados.set(vendaId, lista);
        });

        setCacheDeItens({ endpoint, linhas: agrupados });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Não foi possível carregar os itens.";
        // O cache fica vazio de propósito: o próximo clique tenta de novo.
        setEnderecoComFalha(endpoint);
        toast.error(message);
      })
      .finally(() => setCarregandoItens(false));
  }, [carregandoItens, endpoint, itensPorVenda]);

  const opcoesDeExibicao = useMemo(
    () => [
      {
        // Nenhum CSS lê estes atributos — quem comanda o layout é o `modo`. Eles
        // existem porque o menu grava um atributo por opção. `checked` é o que
        // permite uma opção desmarcar a outra.
        attribute: "data-venda-itens",
        label: "Exibir itens das vendas",
        checked: modo === "itens",
        onCheckedChange: (marcado: boolean) => {
          setModo(marcado ? "itens" : "simples");
          if (marcado) carregarItens();
        },
      },
      ...(podeVerEventos
        ? [
            {
              attribute: "data-venda-eventos",
              label: "Exibir eventos financeiros",
              checked: modo === "eventos",
              onCheckedChange: (marcado: boolean) => {
                setModo(marcado ? "eventos" : "simples");
                // Os eventos já vieram na busca inicial; aqui só muda o modo.
                // E voltam sempre inteiros: um filtro esquecido da vez anterior
                // faria a lista parecer incompleta sem motivo.
                if (marcado) setFiltros(new Set(TODAS_AS_CATEGORIAS));
              },
            },
          ]
        : []),
    ],
    [carregarItens, modo, podeVerEventos],
  );

  /**
   * Os eventos que o filtro deixa passar, por venda. Só as linhas leem daqui:
   * fechamento, painel e lucro por status continuam em `eventosPorVenda`.
   */
  const eventosFiltradosPorVenda = useMemo(() => {
    if (!eventosPorVenda) return null;
    return new Map(
      [...eventosPorVenda].map(([vendaId, eventos]): [string, EventoDaVenda[]] => [
        vendaId,
        eventos.filter((evento) => eventoPassaNoFiltroDaVenda(evento, filtros)),
      ]),
    );
  }, [eventosPorVenda, filtros]);

  // A folha só muda de modo com as linhas em mãos: durante a busca ela continua
  // exatamente como está, e reflui de uma vez só.
  const linhasPorVenda = modo === "itens" ? itensPorVenda : modo === "eventos" ? eventosFiltradosPorVenda : null;
  const modoEfetivo: ModoDaFolha = linhasPorVenda ? modo : "simples";
  const temEventos = eventosPorVenda !== null;
  const semAgrupamento = modoEfetivo === "eventos" && agrupamento === "NENHUM";

  const periodo = useMemo(() => periodLabel(endpoint), [endpoint]);
  const eixo = useMemo(() => periodAxisLabel(endpoint), [endpoint]);
  const chips = useMemo(() => filtrosAplicados(endpoint, rows), [endpoint, rows]);

  const total = useMemo(() => rows.reduce((soma, row) => soma + row.total, 0), [rows]);
  const ticket = rows.length ? total / rows.length : 0;

  /** Os eventos financeiros do recorte inteiro, para montar o painel. */
  const eventosDoRecorte = useMemo(() => [...(eventosPorVenda?.values() ?? [])].flat(), [eventosPorVenda]);
  /** Os totais dos eventos do recorte, pela mesma conta do painel da tela. */
  const totaisDosEventos = useMemo(() => somarEventosDaOs(eventosDoRecorte), [eventosDoRecorte]);

  /**
   * As opções do "Filtrar". "Outros" só aparece quando o recorte tem evento
   * fora dos tipos da venda; sem ele, marcar tudo esconderia esses lançamentos.
   */
  const categoriasDisponiveis = useMemo(() => {
    const temOutros = eventosDoRecorte.some((evento) => categoriasDaVenda(evento).includes("OUTROS"));
    return CATEGORIAS_DA_VENDA.filter((categoria) => categoria.chave !== "OUTROS" || temOutros).map(
      (categoria): PrintFilterOption<CategoriaDeEvento> => ({ value: categoria.chave, label: categoria.label }),
    );
  }, [eventosDoRecorte]);
  const filtrosMarcados = categoriasDisponiveis.filter((categoria) => filtros.has(categoria.value)).length;
  const filtroParcial = modoEfetivo === "eventos" && filtrosMarcados < categoriasDisponiveis.length;

  // Quem lê o papel não vê o menu: a folha precisa dizer que a lista de
  // eventos está incompleta.
  const chipsDaFolha =
    filtroParcial && exibirCabecalho
      ? [...chips, `Eventos filtrados: ${filtrosMarcados} de ${categoriasDisponiveis.length} tipos`]
      : chips;

  /**
   * Sem o cabeçalho geral não há painel dizendo o que a folha mostra, e o selo
   * vira título com os nomes. Lista o lado mais curto — os marcados, ou os que
   * ficaram de fora — para caber nas duas linhas que a folha reserva.
   */
  const tituloDoFiltro = (() => {
    if (exibirCabecalho || !filtroParcial) return null;
    const marcadas = categoriasDisponiveis.filter((categoria) => filtros.has(categoria.value));
    const desmarcadas = categoriasDisponiveis.filter((categoria) => !filtros.has(categoria.value));
    if (!marcadas.length) return "Nenhum tipo de evento";
    const nomes = (lista: typeof categoriasDisponiveis) => lista.map((categoria) => categoria.label).join(" · ");
    return marcadas.length <= desmarcadas.length ? nomes(marcadas) : `Todos, exceto ${nomes(desmarcadas)}`;
  })();

  /**
   * O lucro geral, repartido pelo status atual de cada venda — a mesma conta do
   * card geral, na ordem da distribuição.
   */
  const lucroRealPorStatus = useMemo(() => {
    if (!eventosPorVenda) return [];
    const posicao = new Map(Object.keys(STATUS_LABEL).map((status, indice) => [status, indice]));
    return somarLucroRealPorStatus(
      rows.map((row) => ({ status: row.status, eventos: eventosPorVenda.get(row.id) ?? [] })),
    ).sort(
      (a, b) =>
        b.quantidadeOrdens - a.quantidadeOrdens ||
        (posicao.get(a.status) ?? Number.MAX_SAFE_INTEGER) -
          (posicao.get(b.status) ?? Number.MAX_SAFE_INTEGER) ||
        statusLabel(a.status).localeCompare(statusLabel(b.status), "pt-BR"),
    );
  }, [eventosPorVenda, rows]);

  /**
   * Com os eventos o painel é o de resultado, o mesmo em qualquer modo. Sem a
   * permissão sobra o do faturamento, que é o que essa pessoa pode ver.
   */
  const cards = useMemo(
    () =>
      temEventos
        ? cardsDoResultado(rows.length, ticket, totaisDosEventos, eventosDoRecorte)
        : cardsDoFaturamento(rows, total, ticket),
    [eventosDoRecorte, rows, temEventos, ticket, total, totaisDosEventos],
  );
  /**
   * O painel do faturamento mantém a grade de antes — todas as fileiras com o
   * número de colunas da primeira —; o de resultado tem uma grade por fileira,
   * como na relação de ordens.
   */
  const colunasDoFaturamento = Math.max(1, ...cards.map((fileira) => fileira.length));

  /**
   * A paginação desconta da folha cada fileira além da segunda; sem isso a
   * última venda sairia cortada.
   */
  const fileirasDoPainel = exibirCabecalho ? Math.max(1, cards.length) : 0;
  // Abaixo do painel sai o lucro por status; sem o painel, o título do filtro.
  const alturaAdicionalDaPrimeira = exibirCabecalho
    ? alturaLucroRealPorStatus(lucroRealPorStatus.length)
    : tituloDoFiltro
      ? MM_TITULO_DO_FILTRO
      : 0;

  const pages = useMemo(
    () =>
      paginarVendas<ItemDaVenda | EventoDaVenda>(
        rows.map((venda) => ({
          venda,
          linhas: linhasPorVenda?.get(venda.id) ?? [],
          // O filtro esconde linhas, não a conta: a venda com evento continua
          // fechando mesmo quando nenhum deles passou no filtro.
          fechamento: modoEfetivo === "eventos" ? (eventosPorVenda?.get(venda.id)?.length ?? 0) > 0 : undefined,
        })),
        modoEfetivo,
        fileirasDoPainel,
        alturaAdicionalDaPrimeira,
      ),
    [rows, linhasPorVenda, modoEfetivo, eventosPorVenda, fileirasDoPainel, alturaAdicionalDaPrimeira],
  );

  /** A tabela crua: os lançamentos filtrados, na ordem do recorte, sem bloco de venda. */
  const lancamentos = useMemo<LancamentoDaFolha[]>(() => {
    if (!semAgrupamento || !eventosFiltradosPorVenda) return [];
    return rows.flatMap((venda) =>
      (eventosFiltradosPorVenda.get(venda.id) ?? []).map((evento) => ({ chave: evento.chave, venda, evento })),
    );
  }, [eventosFiltradosPorVenda, rows, semAgrupamento]);
  const folhasDaTabela = useMemo(
    () =>
      semAgrupamento
        ? paginarLancamentos(lancamentos, fileirasDoPainel, alturaAdicionalDaPrimeira)
        : null,
    [lancamentos, semAgrupamento, fileirasDoPainel, alturaAdicionalDaPrimeira],
  );
  /** Receitas menos despesas do que está na tabela; com tudo marcado, é o lucro real. */
  const totalDosLancamentos = useMemo(
    () =>
      lancamentos.reduce(
        (soma, { evento }) => soma + (evento.natureza === "RECEITA" ? evento.valor : -evento.valor),
        0,
      ),
    [lancamentos],
  );
  const quantasFolhas = folhasDaTabela?.length ?? pages.length;

  const resumoPorMetodo = useMemo(() => resumirRecebimentosPorMetodo(recebimentos), [recebimentos]);
  // A folha do resumo vem depois das de vendas, inteira: assim ela não entra
  // na paginação medida em milímetros, e nada nas folhas de cima muda de lugar.
  const comResumoFinanceiro = exibirResumoFinanceiro && rows.length > 0;
  const totalDeFolhas = quantasFolhas + (comResumoFinanceiro ? 1 : 0);

  /**
   * De onde sai o valor das vendas: a receita bruta do cabeçalho, menos os
   * descontos, mais o acréscimo financeiro. A receita e o desconto vêm da mesma
   * fonte do painel de cima — eventos para quem os vê, faturamento para os
   * demais —, para o número da folha final bater com o da primeira.
   */
  const conciliacao = useMemo<ConciliacaoDoRecorte>(() => {
    const somar = (pegar: (row: SaleRow) => number) => rows.reduce((soma, row) => soma + pegar(row), 0);
    const acrescimo = somar((row) => row.surcharge);
    if (temEventos) {
      // Desconto é despesa: o líquido da origem sai negativo, e aqui vai positivo.
      const descontoLiquido = deducoesDaOs(eventosDoRecorte).find((deducao) => deducao.origem === "DESCONTO")?.valor ?? 0;
      return { receitaBruta: totaisDosEventos.receita, descontos: -descontoLiquido, acrescimo };
    }
    return {
      receitaBruta: somar((row) => row.subtotal + row.freight),
      descontos: somar((row) => row.discount),
      acrescimo,
    };
  }, [eventosDoRecorte, rows, temEventos, totaisDosEventos]);

  /**
   * O card leva direto à lista do seu tipo: liga os eventos, deixa só aquele
   * filtro e desagrupa, que é a forma de ver um tipo no recorte inteiro. Clicar
   * de novo no mesmo card devolve todos os tipos.
   */
  function filtrarPeloCard(categoria: CategoriaDeEvento) {
    const jaFiltrado =
      modo === "eventos" && agrupamento === "NENHUM" && filtros.size === 1 && filtros.has(categoria);
    setModo("eventos");
    setAgrupamento("NENHUM");
    setFiltros(new Set(jaFiltrado ? TODAS_AS_CATEGORIAS : [categoria]));
  }

  /** Distribuição por status, do mais frequente ao menos — só o que couber. */
  const distribuicao = useMemo(() => {
    const contagem = new Map<string, number>();
    rows.forEach((row) => contagem.set(row.status, (contagem.get(row.status) ?? 0) + 1));
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Montando a relação de vendas...
      </div>
    );
  }
  if (error) return <div className="flex min-h-screen items-center justify-center p-8 text-destructive">{error}</div>;

  return (
    <>
      <style>{`
        @page{size:A4 portrait;margin:0}
        @media print{
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          .venda-list-shell{padding:0!important;background:#fff!important}
          .venda-list-sheet{box-sizing:border-box!important;width:208mm!important;height:295mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .venda-list-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
          /* O painel do dropdown é montado num portal no body: nenhum
             print:hidden de ancestral o alcança, e aberto no Ctrl+P ele
             imprimiria por cima da página 1. */
          .no-print{display:none!important}
          /* Sem isto o navegador descarta os fundos e as listras somem no papel. */
          .venda-list-sheet,.venda-list-sheet *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        }
      `}</style>
      <main className="venda-list-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="no-print mx-auto mb-4 flex w-[210mm] items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PrintDisplayOptionsMenu options={opcoesDeExibicao} />
            {modoEfetivo === "eventos" && (
              <>
                <PrintFilterMenu options={categoriasDisponiveis} selected={filtros} onChange={setFiltros} />
                <PrintGroupingMenu options={OPCOES_DE_AGRUPAMENTO} value={agrupamento} onChange={setAgrupamento} />
              </>
            )}
            {/* Mesma moldura dos botões da barra, para o switch não destoar deles. */}
            <label className="flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 hover:cursor-pointer">
              <Switch checked={exibirCabecalho} onCheckedChange={setExibirCabecalho} />
              Cabeçalho geral
            </label>
            <label className="flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 hover:cursor-pointer">
              <Switch checked={exibirResumoFinanceiro} onCheckedChange={setExibirResumoFinanceiro} />
              Resumo financeiro
            </label>
            {carregandoItens && (
              <span className="flex items-center gap-1 text-xs text-neutral-600">
                <Loader2 className="h-3 w-3 animate-spin" />Carregando itens...
              </span>
            )}
            {erroItens && !carregandoItens && (
              <span className="text-xs text-red-700">
                Não foi possível carregar os itens. Marque de novo para tentar.
              </span>
            )}
            {modoEfetivo !== "simples" && quantasFolhas > FOLHAS_PARA_AVISAR && (
              <span className="flex items-center gap-1 text-xs text-amber-700">
                <TriangleAlert className="h-3 w-3" />
                {quantasFolhas} folhas — baixar em PDF vai demorar.
              </span>
            )}
          </div>
          <A4PdfActions filename="relacao-de-vendas.pdf" backHref="/relatorios" selector=".venda-list-sheet" />
        </div>

        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {Array.from({ length: quantasFolhas }, (_, pageIndex) => (
            <section
              key={pageIndex}
              className="venda-list-sheet flex h-[297mm] w-[210mm] flex-col overflow-hidden border bg-white p-[10mm] leading-[1.2] shadow-xl"
            >
              {pageIndex === 0 ? (
                <>
                  <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Relação de vendas</h1>
                      <p className="text-[10px] text-neutral-500">Situação comercial das vendas no recorte selecionado</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase text-neutral-500">{eixo}</p>
                      <p className="text-[11px] font-bold tabular-nums">{periodo}</p>
                      <p className="text-[10px] text-neutral-500">Página 1 de {totalDeFolhas}</p>
                    </div>
                  </header>

                  {chipsDaFolha.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {chipsDaFolha.map((chip) => (
                        <span key={chip} className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[8px] uppercase text-neutral-600">
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Altura fixa e o excesso escondido: a paginação reservou
                      `MM_TITULO_DO_FILTRO`, e um título que quebrasse em três
                      linhas empurraria a última da folha para fora. */}
                  {tituloDoFiltro && (
                    <div className="overflow-hidden pt-[2mm]" style={{ height: `${MM_TITULO_DO_FILTRO}mm` }}>
                      <p className="text-[8px] uppercase leading-[1.2] text-neutral-500">Eventos filtrados</p>
                      <p className="line-clamp-2 text-[11px] font-bold leading-[1.2]">{tituloDoFiltro}</p>
                    </div>
                  )}

                  {exibirCabecalho && cards.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {cards.map((fileira, indice) => (
                        <div
                          key={fileira.map((card) => card.chave).join("|") || indice}
                          className="grid gap-2"
                          /* Sai por `style` e não por `grid-cols-N` do Tailwind porque N só
                             existe em tempo de execução, e a classe montada em string seria
                             descartada na purga do CSS. */
                          style={{
                            gridTemplateColumns: `repeat(${temEventos ? fileira.length : colunasDoFaturamento}, minmax(0, 1fr))`,
                          }}
                        >
                          {fileira.map((card) => {
                            const categoria = card.categoria;
                            return (
                              <Kpi
                                key={card.chave}
                                label={card.label}
                                value={card.value}
                                tone={card.tone}
                                destaque={card.destaque}
                                onClick={categoria ? () => filtrarPeloCard(categoria) : undefined}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  {exibirCabecalho && distribuicao.length > 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-neutral-200 py-1.5 text-[9px]">
                      <span className="uppercase text-neutral-500">Distribuição</span>
                      {distribuicao.map(([status, contagem]) => (
                        <span key={status} className="flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${(STATUS_TOM[status] ?? SEM_TOM).faixa}`} />
                          <span>{statusLabel(status)}</span>
                          <strong className="tabular-nums">{contagem}</strong>
                        </span>
                      ))}
                    </div>
                  )}

                  {exibirCabecalho && lucroRealPorStatus.length > 0 && (
                    <section style={{ marginTop: "2mm" }}>
                      <h2 className="flex h-[4mm] items-center text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
                        Lucro real por status
                      </h2>
                      <div
                        className="grid gap-[2mm]"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(COLUNAS_LUCRO_STATUS, lucroRealPorStatus.length)}, minmax(0, 1fr))`,
                        }}
                      >
                        {lucroRealPorStatus.map((grupo) => {
                          const tom = STATUS_TOM[grupo.status] ?? SEM_TOM;
                          return (
                            <div
                              key={grupo.status}
                              className="flex h-[10mm] flex-col justify-between rounded border border-neutral-300 bg-neutral-50 px-2 py-1"
                            >
                              <div className="flex min-w-0 items-center gap-1 text-[7px] font-semibold uppercase text-neutral-600">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tom.faixa}`} />
                                <span className="min-w-0 flex-1 truncate">{statusLabel(grupo.status)}</span>
                                <span className="shrink-0 tabular-nums text-neutral-500">
                                  {grupo.quantidadeOrdens} {grupo.quantidadeOrdens === 1 ? "venda" : "vendas"}
                                </span>
                              </div>
                              <p
                                className={`text-[12px] font-bold tabular-nums ${
                                  grupo.lucroReal < 0 ? TOM_SUBTRACAO : "text-primary"
                                }`}
                              >
                                {money(grupo.lucroReal)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <p className="text-right text-[9px] text-neutral-500">Página {pageIndex + 1} de {totalDeFolhas}</p>
              )}

              {semAgrupamento ? (
                <TabelaDeLancamentos
                  lancamentos={folhasDaTabela?.[pageIndex] ?? []}
                  ultimaFolha={pageIndex === quantasFolhas - 1}
                  quantidade={lancamentos.length}
                  total={totalDosLancamentos}
                />
              ) : (
                <>
                  <div className="mt-2 flex items-center gap-2 border-b border-neutral-300 pb-1 text-[8px] uppercase text-neutral-500">
                    <span className="w-[14mm]">Venda</span>
                    <span className="flex-1">Cliente e canal</span>
                    <span className="w-[26mm] text-right">Total</span>
                  </div>

                  {/* Os rótulos saem uma vez por folha, e não acima de cada venda:
                      repetidos, queimariam 4,5mm vezes o número delas. */}
                  {modoEfetivo !== "simples" && (
                    <div
                      className="flex items-center gap-2 border-b border-neutral-200 pb-[2px] pl-[14mm] pt-1 text-[7px] uppercase text-neutral-400"
                      style={{ height: `${MM_CABECALHO_ITENS}mm` }}
                    >
                      {modoEfetivo === "eventos" ? (
                        <>
                          <span className="flex-1">Evento</span>
                          <span className="w-[40mm]">Detalhe</span>
                          <span className="w-[24mm] text-right">Valor</span>
                        </>
                      ) : (
                        <>
                          <span className="flex-1">Item</span>
                          <span className="w-[22mm] text-right">Qtd. × unitário</span>
                          <span className="w-[16mm] text-right">Desconto</span>
                          <span className="w-[16mm] text-right">Frete</span>
                          <span className="w-[20mm] text-right">Subtotal</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="min-h-0 flex-1">
                    {pages[pageIndex].length ? (
                      pages[pageIndex].map((fatia, index) => (
                        <FatiaDaVenda
                          key={`${fatia.venda.id}-${fatia.continuacao ? fatia.primeiroIndice : "abre"}`}
                          fatia={fatia}
                          modo={modoEfetivo}
                          listrada={index % 2 === 1}
                          eventosDaVenda={eventosPorVenda?.get(fatia.venda.id)}
                        />
                      ))
                    ) : (
                      <div className="py-20 text-center text-sm text-neutral-500">Nenhuma venda encontrada no recorte.</div>
                    )}
                  </div>

                  {pageIndex === pages.length - 1 && rows.length > 0 && (
                    <div className="mt-1 flex items-center justify-between border-t-2 border-black pt-1.5 text-[10px]">
                      <span className="uppercase text-neutral-500">
                        Total · {rows.length} {rows.length === 1 ? "venda" : "vendas"}
                      </span>
                      <strong className="tabular-nums">{money(total)}</strong>
                    </div>
                  )}
                </>
              )}
            </section>
          ))}

          {comResumoFinanceiro && (
            <section className="venda-list-sheet flex h-[297mm] w-[210mm] flex-col overflow-hidden border bg-white p-[10mm] leading-[1.2] shadow-xl">
              <FolhaDoResumoFinanceiro
                documento="VENDA"
                eixo={eixo}
                periodo={periodo}
                pagina={totalDeFolhas}
                quantidade={rows.length}
                saldos={saldos}
                conciliacao={conciliacao}
                metodos={resumoPorMetodo}
              />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Card do painel. `destaque` é para os resultados da conta — fundo branco e
 * borda preta, para o olho separar o que é parcela do que é total sem depender
 * da cor, que some na impressão em preto e branco.
 */
function Kpi({
  label,
  value,
  tone,
  destaque,
  onClick,
}: {
  label: string;
  value: string;
  tone?: string;
  destaque?: boolean;
  /** Só nos cards que correspondem a um tipo do filtro. */
  onClick?: () => void;
}) {
  const caixa = `rounded border px-2 py-1.5 ${destaque ? "border-black bg-white" : "border-neutral-300 bg-neutral-50"}`;
  // `span` em bloco, e não `p`: parágrafo dentro de botão é HTML inválido.
  const conteudo = (
    <>
      <span className="block text-[8px] font-semibold uppercase text-neutral-700">{label}</span>
      <span className={`block text-[12px] font-bold tabular-nums ${tone ?? ""}`}>{value}</span>
    </>
  );

  if (!onClick) return <div className={caixa}>{conteudo}</div>;

  // A mesma caixa do card estático, para a altura medida do painel não mudar. O
  // realce vem só no hover: um estado marcado sairia no PDF.
  return (
    <button
      type="button"
      onClick={onClick}
      title="Mostrar só este tipo, sem agrupar por venda"
      className={`${caixa} block w-full cursor-pointer text-left hover:border-neutral-500 hover:bg-white`}
    >
      {conteudo}
    </button>
  );
}

/**
 * O painel de resultado da venda — três fileiras, sempre as mesmas.
 *
 *   recorte          · receita bruta   · média por venda
 *   receita produtos · custo produtos  · comissões · líquido de produtos
 *   descontos · receita de frete · despesa de frete · lucro real
 *
 * É o painel da relação de ordens sem a fileira de serviços, que a venda não
 * tem. A comissão sobe para a fileira de produtos pelo mesmo motivo de lá: é o
 * custo de vender aquele produto. As deduções vêm de `deducoesDaOs`, nunca de
 * uma lista escrita à mão, para uma origem nova não sumir da conta; consumo,
 * que venda não gera, só aparece se um dia vier com valor.
 */
function cardsDoResultado(
  quantasVendas: number,
  ticket: number,
  totais: TotaisDosEventos,
  eventos: EventoDaVenda[],
): CardFechamento[][] {
  const comissoes = comissoesPorTipoDeItem(eventos);
  // Venda só tem produto; o que viesse marcado como serviço entra aqui também,
  // para o líquido e o lucro continuarem fechando.
  const comissao = comissoes.produtos + comissoes.servicos;
  const liquidoProdutos = totais.receitaProdutos - totais.despesaProdutos + comissao;

  const freteReceita = somaOrigemNatureza(eventos, "FRETE", "RECEITA");
  const freteDespesa = somaOrigemNatureza(eventos, "FRETE", "DESPESA");
  const outrasDeducoes = deducoesDaOs(eventos).filter(
    (deducao) =>
      deducao.origem !== "COMISSAO" &&
      deducao.origem !== "FRETE" &&
      !(deducao.origem === "CONSUMO" && deducao.valor === 0),
  );

  const tom = (valor: number) => (valor < 0 ? TOM_SUBTRACAO : TOM_SOMA);
  const sinalDe = (valor: number): 1 | -1 => (valor < 0 ? -1 : 1);
  // Comissão só abate — zerada, continua dizendo isso, como na relação de ordens.
  const sinalDoAbatimento = (valor: number): 1 | -1 => (valor > 0 ? 1 : -1);
  const tomDoAbatimento = (valor: number) => (valor > 0 ? TOM_SOMA : TOM_SUBTRACAO);

  return [
    [
      { chave: "vendas", label: "Vendas no recorte", value: String(quantasVendas), valor: quantasVendas },
      { chave: "receitaBruta", label: "Receita bruta", value: money(totais.receita), destaque: true, valor: totais.receita },
      { chave: "ticket", label: "Média por venda", value: money(ticket), valor: ticket },
    ],
    [
      { chave: "receitaProdutos", label: "+ Receita de produtos", value: signedMoney(totais.receitaProdutos, 1), tone: TOM_SOMA, valor: totais.receitaProdutos, categoria: "RECEITA_PRODUTOS" },
      { chave: "custoProdutos", label: "− Custo de produtos", value: signedMoney(totais.despesaProdutos, -1), tone: TOM_SUBTRACAO, valor: totais.despesaProdutos, categoria: "CUSTO_PRODUTOS" },
      { chave: "comissoes", label: `${sinalDoAbatimento(comissao) < 0 ? "−" : "+"} Comissões`, value: signedMoney(comissao, sinalDoAbatimento(comissao)), tone: tomDoAbatimento(comissao), valor: comissao, categoria: "COMISSOES_PRODUTOS" },
      { chave: "liquidoProdutos", label: "= Líquido de produtos", value: money(liquidoProdutos), tone: tom(liquidoProdutos), valor: liquidoProdutos },
    ],
    [
      ...outrasDeducoes.map((deducao): CardFechamento => {
        const sinal = sinalDe(deducao.valor);
        return {
          chave: `origem-${deducao.origem}`,
          label: `${sinal < 0 ? "−" : "+"} ${ROTULO_ORIGEM[deducao.origem] ?? deducao.origem}`,
          value: signedMoney(deducao.valor, sinal),
          tone: tom(deducao.valor),
          valor: deducao.valor,
          // Uma origem fora das conhecidas ganha card próprio, mas o filtro a
          // junta em "Outros" com as demais — clicar mostraria mais do que o card.
          categoria: deducao.origem === "DESCONTO" ? "DESCONTOS" : undefined,
        };
      }),
      { chave: "freteReceita", label: "+ Receita de frete", value: signedMoney(freteReceita, 1), tone: TOM_SOMA, valor: freteReceita, categoria: "RECEITA_FRETE" },
      { chave: "freteDespesa", label: "− Despesa de frete", value: signedMoney(freteDespesa, -1), tone: TOM_SUBTRACAO, valor: freteDespesa, categoria: "DESPESA_FRETE" },
      { chave: "lucro", label: "= Lucro real", value: money(totais.lucroReal), tone: "text-primary", destaque: true, valor: totais.lucroReal },
    ],
  ];
}

/**
 * O painel de quem não pode ver custo e lucro: o fechamento do faturamento,
 * como a folha sempre mostrou. A leitura vai do resultado para a composição, e
 * card zerado não entra — numa loja que não cobra frete, um "+R$ 0,00" fixo só
 * faz procurar um valor que não existe. Sai em duas fileiras, a de cima com o
 * card a mais quando a conta é ímpar.
 */
function cardsDoFaturamento(rows: SaleRow[], total: number, ticket: number): CardFechamento[][] {
  const somar = (pegar: (row: SaleRow) => number) => rows.reduce((soma, row) => soma + pegar(row), 0);
  const subtotais = somar((row) => row.subtotal);
  const descontos = somar((row) => row.discount);
  const frete = somar((row) => row.freight);
  const acrescimo = somar((row) => row.surcharge);

  const lista: CardFechamento[] = [
    { chave: "vendas", label: "Vendas no recorte", value: String(rows.length), valor: rows.length },
    { chave: "faturamento", label: "Faturamento total", value: money(total), destaque: true, valor: total },
    { chave: "ticket", label: "Média por venda", value: money(ticket), valor: ticket },
    { chave: "subtotal", label: "+ Subtotal de produtos", value: signedMoney(subtotais, 1), tone: TOM_SOMA, valor: subtotais },
    { chave: "frete", label: "+ Frete", value: signedMoney(frete, 1), tone: TOM_SOMA, valor: frete },
    { chave: "acrescimo", label: "+ Acréscimo fin.", value: signedMoney(acrescimo, 1), tone: TOM_SOMA, valor: acrescimo },
    { chave: "descontos", label: "− Descontos aplicados", value: signedMoney(descontos, -1), tone: TOM_SUBTRACAO, valor: descontos },
  ].filter((card) => card.valor > 0);

  const colunas = Math.ceil(lista.length / 2);
  return [lista.slice(0, colunas), lista.slice(colunas)].filter((fileira) => fileira.length > 0);
}

function SaleLine({ row, listrada }: { row: SaleRow; listrada: boolean }) {
  const tom = STATUS_TOM[row.status] ?? SEM_TOM;

  return (
    <article
      className={`flex gap-2 overflow-hidden border-b border-neutral-200 py-1.5 ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_VENDA}mm` }}
    >
      <span className={`w-[1mm] shrink-0 rounded-sm ${tom.faixa}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="w-[12mm] shrink-0 text-[11px] font-bold tabular-nums">#{row.id}</span>
          <span className={`shrink-0 rounded px-1 py-[1px] text-[8px] font-semibold uppercase ${tom.selo}`}>
            {statusLabel(row.status)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{row.customer}</span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums">{money(row.total)}</span>
        </div>
        <p className="mt-[1px] truncate pl-[12mm] text-[9px] text-neutral-600">
          {canalLabel(row.channel)}
          {" · "}
          <span className="text-neutral-500">Categoria</span> {row.category}
          {" · "}
          {/* Só o vendedor: a linha já está cheia, e no balcão ele e o criador
              são a mesma pessoa. Quem lançou está na planilha. */}
          <span className="text-neutral-500">Vend.</span> {row.seller}
        </p>
        <p className="mt-[1px] truncate pl-[12mm] text-[9px] text-neutral-500">
          <span className="tabular-nums">{row.soldAt}</span>
          {" → "}
          <span className="tabular-nums">{row.paidAt}</span>
          {" · "}
          {row.payment}
          {Number(row.installments) > 1 ? ` (${row.installments}x)` : ""}
          {" · "}
          {row.description}
        </p>
      </div>
    </article>
  );
}

/**
 * Uma fatia de venda na folha.
 *
 * No modo simples não há embrulho nenhum em volta da linha da venda: o DOM sai
 * idêntico ao de antes das opções existirem. Com itens ou eventos, o zebrado
 * das vendas dá lugar a um filete no topo de cada bloco — o fundo alternado
 * brigaria com o das linhas logo abaixo.
 */
function FatiaDaVenda({
  fatia,
  modo,
  listrada,
  eventosDaVenda = [],
}: {
  fatia: FatiaVenda<ItemDaVenda | EventoDaVenda>;
  modo: ModoDaFolha;
  listrada: boolean;
  /**
   * Todos os eventos da venda, antes do filtro. O fechamento soma daqui, e não
   * das linhas da fatia: a venda que atravessa a virada de folha só tem na
   * última fatia as linhas que couberam nela, e o filtro esconde o resto.
   */
  eventosDaVenda?: EventoDaVenda[];
}) {
  if (modo === "simples") return <SaleLine row={fatia.venda} listrada={listrada} />;

  const eventos = modo === "eventos";
  // Fatia sem linha ou é a venda sem lançamento nenhum, ou é o fechamento que
  // não coubera na folha anterior — o contrato está em `FatiaVenda`.
  const semLinhas = fatia.linhas.length === 0 && !fatia.continuacao;

  return (
    // O respiro entre vendas vai como padding, e não margem: margens irmãs
    // colapsam e o modelo passaria a contar mais do que a folha ocupa.
    <div className="border-t border-neutral-300" style={{ paddingBottom: `${MM_ESPACO_VENDA}mm` }}>
      {fatia.continuacao ? (
        <ContinuacaoDaVenda row={fatia.venda} />
      ) : (
        <SaleLine row={fatia.venda} listrada={false} />
      )}

      {semLinhas && (
        <p
          className="flex items-center pl-[14mm] text-[9px] italic text-neutral-500"
          style={{ height: `${MM_ITEM}mm` }}
        >
          {eventos
            ? eventosDaVenda.length
              ? "Nenhum evento nos filtros selecionados"
              : "Sem eventos financeiros"
            : "Sem itens lançados"}
        </p>
      )}

      {fatia.linhas.map((linha, indice) => {
        const listra = (fatia.primeiroIndice + indice) % 2 === 1;
        return "natureza" in linha ? (
          <LinhaDeEvento key={linha.chave} evento={linha} listrada={listra} />
        ) : (
          <LinhaDeItem key={linha.chave} item={linha} listrada={listra} />
        );
      })}

      {fatia.fecha &&
        (eventos ? (
          <FechamentoDeEventos linhas={eventosDaVenda} row={fatia.venda} />
        ) : (
          <FechamentoDaVenda row={fatia.venda} />
        ))}
    </div>
  );
}

/** Cabeçalho condensado da venda que atravessou a virada de folha. */
function ContinuacaoDaVenda({ row }: { row: SaleRow }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-neutral-200 text-[9px] text-neutral-500"
      style={{ height: `${MM_VENDA_CONTINUACAO}mm` }}
    >
      <span className="w-[12mm] shrink-0 text-[10px] font-bold tabular-nums text-black">#{row.id}</span>
      <span className="min-w-0 flex-1 truncate">{row.customer}</span>
      <span className="shrink-0 uppercase">continuação</span>
    </div>
  );
}

/**
 * Linha de item.
 *
 * Sem o selo de produto/serviço que a OS carrega — venda só tem produto, e o
 * selo repetido em toda linha seria ruído. Os 13mm que ele ocupava lá abrigam
 * aqui a coluna de frete do item, que na venda existe e na OS não.
 */
function LinhaDeItem({ item, listrada }: { item: ItemDaVenda; listrada: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 pl-[14mm] text-[9px] ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_ITEM}mm` }}
    >
      <span className="min-w-0 flex-1 truncate">
        {item.descricao || "Sem descrição"}
        {item.codigo ? <span className="text-neutral-500"> · {item.codigo}</span> : null}
      </span>
      <span className="w-[22mm] shrink-0 text-right tabular-nums text-neutral-600">
        {quantidade(item.quantidade)}
        {item.unidade ? ` ${item.unidade}` : ""} × {money(item.precoUnitario)}
      </span>
      <span className="w-[16mm] shrink-0 text-right tabular-nums">
        {item.descontoItem > 0 ? (
          <span className={TOM_SUBTRACAO}>−{money(item.descontoItem)}</span>
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </span>
      <span className="w-[16mm] shrink-0 text-right tabular-nums">
        {item.freteItem > 0 ? (
          <span className={TOM_SOMA}>+{money(item.freteItem)}</span>
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </span>
      <span className="w-[20mm] shrink-0 text-right font-semibold tabular-nums">{money(item.subtotal)}</span>
    </div>
  );
}

function LinhaDeEvento({ evento, listrada }: { evento: EventoDaVenda; listrada: boolean }) {
  const receita = evento.natureza === "RECEITA";

  return (
    <div
      className={`flex items-center gap-2 pl-[14mm] text-[9px] ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_ITEM}mm` }}
    >
      <span
        className={`w-[16mm] shrink-0 rounded px-1 py-[1px] text-center text-[7px] font-semibold uppercase ${
          TOM_ORIGEM[evento.origem] ?? "bg-neutral-100 text-neutral-700"
        }`}
      >
        {evento.origem}
      </span>
      <span className="min-w-0 flex-1 truncate">{evento.descricao || "Sem descrição"}</span>
      <span className="w-[40mm] shrink-0 truncate text-neutral-500">{evento.detalhe}</span>
      <span className={`w-[24mm] shrink-0 text-right font-semibold tabular-nums ${receita ? TOM_SOMA : TOM_SUBTRACAO}`}>
        {signedMoney(evento.valor, receita ? 1 : -1)}
      </span>
    </div>
  );
}

/**
 * A composição do valor daquela venda — a mesma conta do painel do cabeçalho,
 * na escala de uma venda: o que soma em verde, o que abate em vermelho, e o
 * total em preto por ser resultado, e não movimento.
 *
 * As parcelas saem dos campos que a folha já tem, e não da soma das linhas de
 * item impressas acima. O desconto é recuperado dos próprios totais gravados
 * (`subtotal + frete − total`), então a identidade fecha exatamente contra o
 * subtotal da venda; somar os itens arriscaria um centavo de diferença por
 * arredondamento, que o leitor trataria como erro de conta.
 */
function FechamentoDaVenda({ row }: { row: SaleRow }) {
  const parcelas = [
    { chave: "subtotal", label: "Produtos", valor: row.subtotal, sinal: 1 as const },
    { chave: "descontos", label: "Descontos", valor: row.discount, sinal: -1 as const },
    { chave: "frete", label: "Frete", valor: row.freight, sinal: 1 as const },
  ].filter((parcela) => parcela.valor > 0);

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-x-3 border-t border-neutral-200 pl-[14mm] text-[8px]"
      style={{ height: `${alturaDoFechamento(row, "itens")}mm` }}
    >
      {parcelas.map((parcela) => (
        <span key={parcela.chave} className="flex items-center gap-1">
          <span className="text-neutral-500">{parcela.sinal < 0 ? "−" : "+"} {parcela.label}</span>
          <span className={`tabular-nums ${parcela.sinal < 0 ? TOM_SUBTRACAO : TOM_SOMA}`}>
            {signedMoney(parcela.valor, parcela.sinal)}
          </span>
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="text-neutral-500">= Total</span>
        <strong className="text-[9px] tabular-nums">{money(row.total)}</strong>
      </span>
      {row.surcharge > 0 && (
        <span className="flex items-center gap-1">
          <span className="text-neutral-500">+ Acréscimo fin.</span>
          <span className={`tabular-nums ${TOM_SOMA}`}>{signedMoney(row.surcharge, 1)}</span>
        </span>
      )}
    </div>
  );
}

/**
 * O fechamento de uma venda pelos eventos: receita e custo de produto, as
 * deduções e o lucro — e com elas a conta fecha, que é o que justifica o `=`.
 *
 * As deduções vêm de `deducoesDaOs`, com o sinal do líquido de cada origem, e
 * não de uma lista escrita à mão: é o que faz frete com receita e despesa somar
 * certo. Consumo, que venda não gera, só sai se vier com valor.
 */
function FechamentoDeEventos({ linhas, row }: { linhas: EventoDaVenda[]; row: SaleRow }) {
  const totais = somarEventosDaOs(linhas);
  const deducoes = deducoesDaOs(linhas)
    .filter((deducao) => !(deducao.origem === "CONSUMO" && deducao.valor === 0))
    .map(({ origem, valor }) => {
      // Comissão só abate: zerada, sai "− R$ 0,00" e não "+".
      const sinal: 1 | -1 = origem === "COMISSAO" ? (valor > 0 ? 1 : -1) : valor < 0 ? -1 : 1;
      return { chave: `origem-${origem}`, label: ROTULO_ORIGEM[origem] ?? origem, valor, sinal };
    });
  const parcelas = [
    { chave: "receitaProdutos", label: "Receita produtos", valor: totais.receitaProdutos, sinal: 1 as const },
    { chave: "custoProdutos", label: "Custo produtos", valor: totais.despesaProdutos, sinal: -1 as const },
    ...deducoes,
  ];

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-x-3 border-t border-neutral-200 pl-[14mm] text-[8px]"
      style={{ height: `${alturaDoFechamento(row, "eventos")}mm` }}
    >
      {parcelas.map((parcela) => (
        <span key={parcela.chave} className="flex items-center gap-1">
          <span className="text-neutral-500">{parcela.sinal < 0 ? "−" : "+"} {parcela.label}</span>
          <span className={`tabular-nums ${parcela.sinal < 0 ? TOM_SUBTRACAO : TOM_SOMA}`}>
            {signedMoney(parcela.valor, parcela.sinal)}
          </span>
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="uppercase text-neutral-500">= Lucro real</span>
        <strong className={`text-[9px] tabular-nums ${totais.lucroReal < 0 ? TOM_SUBTRACAO : "text-primary"}`}>
          {money(totais.lucroReal)}
        </strong>
      </span>
    </div>
  );
}

/**
 * A tabela crua dos lançamentos, sem agrupar por venda.
 *
 * A faixa de rótulos usa as mesmas classes da faixa "Venda / Cliente / Total"
 * da folha agrupada: `MM_TOPO_DEMAIS` foi medido com ela, e mudar a altura aqui
 * cortaria a última linha de cada folha.
 */
function TabelaDeLancamentos({
  lancamentos,
  ultimaFolha,
  quantidade,
  total,
}: {
  lancamentos: LancamentoDaFolha[];
  ultimaFolha: boolean;
  /** Do recorte inteiro, e não só desta folha. */
  quantidade: number;
  total: number;
}) {
  return (
    <>
      <div className="mt-2 flex items-center gap-2 border-b border-neutral-300 pb-1 text-[8px] uppercase text-neutral-500">
        <span className="w-[12mm] shrink-0">Venda</span>
        <span className="w-[34mm] shrink-0">Cliente</span>
        <span className="w-[16mm] shrink-0">Origem</span>
        <span className="min-w-0 flex-1">Descrição</span>
        <span className="w-[34mm] shrink-0">Detalhe</span>
        <span className="w-[24mm] shrink-0 text-right">Valor</span>
      </div>

      <div className="min-h-0 flex-1">
        {lancamentos.length ? (
          <>
            {lancamentos.map((lancamento, indice) => (
              <LinhaDeLancamento key={lancamento.chave} lancamento={lancamento} listrada={indice % 2 === 1} />
            ))}

            {/* O total vem colado à última linha, e não no pé da folha: numa
                última folha com poucas linhas ele ficava longe da coluna que
                soma. Cabe no `MM_RODAPE_TOTAL` que toda folha já reserva. */}
            {ultimaFolha && (
              <div className="mt-1 flex items-center gap-2 border-t-2 border-black pt-1.5 text-[10px]">
                <span className="min-w-0 flex-1 uppercase text-neutral-500">
                  Total · {quantidade} {quantidade === 1 ? "lançamento" : "lançamentos"}
                </span>
                <strong className={`min-w-[24mm] shrink-0 text-right tabular-nums ${total < 0 ? TOM_SUBTRACAO : ""}`}>
                  {money(total)}
                </strong>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center text-sm text-neutral-500">Nenhum lançamento nos filtros selecionados.</div>
        )}
      </div>
    </>
  );
}

function LinhaDeLancamento({
  lancamento: { venda, evento },
  listrada,
}: {
  lancamento: LancamentoDaFolha;
  listrada: boolean;
}) {
  const receita = evento.natureza === "RECEITA";

  return (
    <div
      className={`flex items-center gap-2 text-[9px] ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_ITEM}mm` }}
    >
      <span className="w-[12mm] shrink-0 font-bold tabular-nums">#{venda.id}</span>
      <span className="w-[34mm] shrink-0 truncate">{venda.customer}</span>
      <span
        className={`w-[16mm] shrink-0 rounded px-1 py-[1px] text-center text-[7px] font-semibold uppercase ${
          TOM_ORIGEM[evento.origem] ?? "bg-neutral-100 text-neutral-700"
        }`}
      >
        {evento.origem}
      </span>
      <span className="min-w-0 flex-1 truncate">{evento.descricao || "Sem descrição"}</span>
      <span className="w-[34mm] shrink-0 truncate text-neutral-500">{evento.detalhe}</span>
      <span className={`w-[24mm] shrink-0 text-right font-semibold tabular-nums ${receita ? TOM_SOMA : TOM_SUBTRACAO}`}>
        {signedMoney(evento.valor, receita ? 1 : -1)}
      </span>
    </div>
  );
}
