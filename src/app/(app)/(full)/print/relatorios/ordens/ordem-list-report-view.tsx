"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { PrintDisplayOptionsMenu } from "@/app/(app)/(full)/components/PrintDisplayOptionsMenu";
import { toast } from "@/lib/toast";
import {
  alturaDoFechamento,
  MM_CABECALHO_ITENS,
  MM_ESPACO_ORDEM,
  MM_ITEM,
  MM_ORDEM,
  MM_ORDEM_CONTINUACAO,
  paginarOrdens,
  type FatiaOrdem,
  type ItemDaOrdem,
  type OrderRow,
} from "./ordem-list-report-model";

/**
 * Relação de ordens de serviço em A4 retrato.
 *
 * Antes esta relação saía pela grade genérica de planilha: treze colunas
 * espremidas numa folha deitada, em corpo 6, com a descrição cortada no meio.
 * Aqui cada OS ocupa um bloco de três linhas — identificação, contexto e
 * descrição —, que é como a folha é lida na prática: procura-se a ordem pelo
 * número ou pelo cliente, e o resto se lê depois de achar.
 *
 * Os dados vêm da mesma exportação em xlsx que alimenta o Excel, lidos por nome
 * de coluna. É a convenção das outras folhas de impressão: uma fonte só para o
 * arquivo e para o papel, sem uma segunda rota que possa divergir.
 *
 * A opção "Exibir itens das OS" abre cada ordem na lista de itens que formou o
 * valor dela. Os itens saem da mesma exportação, numa segunda aba pedida só
 * quando a opção é marcada — o relatório padrão não paga por eles. Como o bloco
 * de cada ordem passa a ter altura variável, a paginação vive em
 * `ordem-list-report-model.ts`, medida em milímetros e testada à parte.
 */

type Cell = string | number | boolean | null;

/**
 * Acima deste número de folhas, gerar o PDF vira um problema: o `A4PdfActions`
 * rasteriza uma seção por vez, e cem delas levam minutos e centenas de MB. O
 * aviso fica na barra, nunca no papel, e não bloqueia nada.
 */
const FOLHAS_PARA_AVISAR = 60;

const STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_CHECKLIST: "Aguardando checklist",
  ORCAMENTO: "Em orçamento",
  APROVACAO_ORCAMENTO: "Aguardando aprovação",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
  EM_ANDAMENTO: "Em andamento",
  PAGAMENTO: "Pagamento",
  SEM_COBRANCA: "Sem cobrança",
  CONCLUIDO: "Concluída",
  CANCELADO: "Cancelada",
};

/**
 * Tom de cada status. Impresso em preto e branco vira escala de cinza, então a
 * cor acompanha o rótulo — nunca o substitui.
 */
const STATUS_TOM: Record<string, { faixa: string; selo: string }> = {
  AGUARDANDO_CHECKLIST: { faixa: "bg-neutral-400", selo: "bg-neutral-100 text-neutral-700" },
  ORCAMENTO: { faixa: "bg-amber-400", selo: "bg-amber-50 text-amber-800" },
  APROVACAO_ORCAMENTO: { faixa: "bg-amber-500", selo: "bg-amber-50 text-amber-800" },
  ORCAMENTO_APROVADO: { faixa: "bg-sky-500", selo: "bg-sky-50 text-sky-800" },
  ORCAMENTO_RECUSADO: { faixa: "bg-red-400", selo: "bg-red-50 text-red-800" },
  EM_ANDAMENTO: { faixa: "bg-blue-500", selo: "bg-blue-50 text-blue-800" },
  PAGAMENTO: { faixa: "bg-violet-500", selo: "bg-violet-50 text-violet-800" },
  SEM_COBRANCA: { faixa: "bg-neutral-500", selo: "bg-neutral-100 text-neutral-700" },
  CONCLUIDO: { faixa: "bg-emerald-500", selo: "bg-emerald-50 text-emerald-800" },
  CANCELADO: { faixa: "bg-red-500", selo: "bg-red-50 text-red-800" },
};

const SEM_TOM = { faixa: "bg-neutral-300", selo: "bg-neutral-100 text-neutral-700" };

/**
 * Selo de produto e de serviço. Nem verde nem vermelho: essas duas cores já
 * significam soma e abatimento na linha de fechamento, e reusá-las aqui
 * tornaria a convenção ambígua.
 */
const TOM_ITEM = {
  PRODUTO: "bg-sky-50 text-sky-800",
  SERVICO: "bg-violet-50 text-violet-800",
} as const;

const PRIORIDADE_LABEL: Record<string, string> = {
  ALTA: "Alta",
  NORMAL: "Normal",
  BAIXA: "Baixa",
};

const ALVO_LABEL: Record<string, string> = {
  VEICULO: "Veículo",
  PECA: "Peça",
  EQUIPAMENTO: "Máquina/Equipamento",
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

/** Quantidade pode ser fracionada (0,75 litro); inteira não ganha casas à toa. */
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

type CardFechamento = {
  chave: string;
  label: string;
  value: string;
  valor: number;
  tone?: string;
  destaque?: boolean;
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
  return params.get("campoData") === "conclusao" ? "Conclusão da OS" : "Entrada da OS";
}

/**
 * Faixa de filtros aplicados.
 *
 * Setor, cliente e responsável chegam como id no endereço, que não diz nada a
 * quem lê a folha. Como o filtro deixa um único valor no resultado, o nome sai
 * das próprias linhas — e some quando não há linha nenhuma para consultar.
 */
function filtrosAplicados(endpoint: string, rows: OrderRow[]) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const chips: string[] = [];

  // Acima de três status a lista inteira quebraria a faixa em várias linhas e
  // comeria a altura reservada para as ordens; o número basta para conferir.
  const status = (params.get("status") ?? "").split(",").filter(Boolean);
  if (status.length && status.length <= 3) chips.push(`Status: ${status.map(statusLabel).join(", ")}`);
  else if (status.length) chips.push(`Status: ${status.length} selecionados`);

  const prioridade = params.get("prioridade");
  if (prioridade) chips.push(`Prioridade: ${PRIORIDADE_LABEL[prioridade] ?? prioridade}`);

  const alvo = params.get("alvoTipo");
  if (alvo) chips.push(`Alvo: ${ALVO_LABEL[alvo] ?? alvo}`);

  const primeira = rows[0];
  if (params.get("setorId") && primeira) chips.push(`Setor: ${primeira.sector}`);
  if (params.get("clienteId") && primeira) chips.push(`Cliente: ${primeira.customer}`);
  if (params.get("responsavelId") && primeira) chips.push(`Responsável: ${primeira.owner}`);
  if (params.get("ordemId")) chips.push(`OS #${params.get("ordemId")}`);

  return chips;
}

export function OrdemListReportView({ endpoint }: { endpoint: string }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [detalhado, setDetalhado] = useState(false);
  const [cacheDeItens, setCacheDeItens] = useState<{ endpoint: string; itens: Map<string, ItemDaOrdem[]> } | null>(null);
  const [enderecoComFalha, setEnderecoComFalha] = useState<string | null>(null);
  const [carregandoItens, setCarregandoItens] = useState(false);

  // O cache pertence ao recorte que o gerou: mudou o endereço, ele não vale
  // mais. Derivar isso no render dispensa um efeito de limpeza, que existiria
  // só para zerar estado — e renderizaria em cascata para isso.
  const itensPorOs = cacheDeItens?.endpoint === endpoint ? cacheDeItens.itens : null;
  const erroItens = enderecoComFalha === endpoint;

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(respostaEmBuffer)
      .then(async (buffer) => {
        const aba = await lerAba(buffer, 0);
        if (!aba) throw new Error("A planilha do relatório veio vazia.");
        const { rows: matrix, read } = aba;

        const parsed = matrix.map((row) => ({
          id: text(read(row, "OS")),
          status: String(read(row, "Status") ?? "").trim(),
          priority: String(read(row, "Prioridade") ?? "").trim(),
          customer: text(read(row, "Cliente")),
          document: text(read(row, "CPF/CNPJ")),
          target: text(read(row, "Alvo atendido")),
          sector: text(read(row, "Setor")),
          owner: text(read(row, "Responsável")),
          description: text(read(row, "Descrição")),
          openedAt: dayOf(read(row, "Entrada")),
          closedAt: dayOf(read(row, "Conclusão")),
          products: number(read(row, "Produtos (R$)")),
          services: number(read(row, "Serviços (R$)")),
          discount: number(read(row, "Desconto (R$)")),
          freight: number(read(row, "Frete (R$)")),
          budget: number(read(row, "Orçamento (R$)")),
          surcharge: number(read(row, "Acréscimo financeiro (R$)")),
        }));

        if (active) setRows(parsed);
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
  }, [endpoint]);

  /**
   * Os itens vêm numa segunda chamada, disparada no clique — evento, e não
   * efeito: não há dobra do StrictMode nem cleanup a coordenar. Uma vez em
   * mãos ficam em cache, então marcar e desmarcar depois é instantâneo.
   *
   * Só a aba "Itens" é lida. Reprocessar a aba principal faria uma segunda
   * resposta lenta atropelar as ordens já montadas na tela.
   */
  const carregarItens = useCallback(() => {
    if (itensPorOs || carregandoItens) return;
    setCarregandoItens(true);
    setEnderecoComFalha(null);

    const separador = endpoint.includes("?") ? "&" : "?";
    fetch(`${endpoint}${separador}itens=1`)
      .then(respostaEmBuffer)
      .then(async (buffer) => {
        const aba = await lerAba(buffer, "Itens");
        // Sem a aba, o cache ficaria vazio e toda ordem imprimiria "sem itens
        // lançados" — um erro que se parece com um resultado.
        if (!aba) throw new Error("A exportação não trouxe a aba de itens.");
        const agrupados = new Map<string, ItemDaOrdem[]>();

        // A coluna OS volta do xlsx como número e `OrderRow.id` é texto; sem
        // normalizar os dois lados toda ordem ficaria com zero itens, e a
        // opção pareceria não fazer nada.
        aba.rows.forEach((row, indice) => {
          const osId = text(aba.read(row, "OS"));
          const lista = agrupados.get(osId) ?? [];
          lista.push({
            chave: `${osId}-${indice}`,
            tipo: String(aba.read(row, "Tipo") ?? "").trim() === "Serviço" ? "SERVICO" : "PRODUTO",
            codigo: String(aba.read(row, "Código") ?? "").trim(),
            descricao: String(aba.read(row, "Descrição") ?? "").trim(),
            unidade: String(aba.read(row, "Unidade") ?? "").trim(),
            quantidade: number(aba.read(row, "Quantidade")),
            precoUnitario: number(aba.read(row, "Preço unitário (R$)")),
            descontoItem: number(aba.read(row, "Desconto do item (R$)")),
            subtotal: number(aba.read(row, "Subtotal (R$)")),
          });
          agrupados.set(osId, lista);
        });

        setCacheDeItens({ endpoint, itens: agrupados });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Não foi possível carregar os itens.";
        // O cache fica vazio de propósito: o próximo clique tenta de novo.
        setEnderecoComFalha(endpoint);
        toast.error(message);
      })
      .finally(() => setCarregandoItens(false));
  }, [carregandoItens, endpoint, itensPorOs]);

  const opcoesDeExibicao = useMemo(
    () => [
      {
        // Nenhum CSS lê este atributo — quem comanda o layout é o `detalhado`
        // abaixo. Ele existe porque o menu grava um atributo por opção.
        attribute: "data-os-itens",
        label: "Exibir itens das OS",
        onCheckedChange: (marcado: boolean) => {
          setDetalhado(marcado);
          if (marcado) carregarItens();
        },
      },
    ],
    [carregarItens],
  );

  // A folha só entra no modo detalhado com os itens em mãos: durante a busca
  // ela continua exatamente como está, e reflui de uma vez só.
  const detalhadoEfetivo = detalhado && itensPorOs !== null;

  const pages = useMemo(
    () =>
      paginarOrdens(
        rows.map((ordem) => ({ ordem, itens: itensPorOs?.get(ordem.id) ?? [] })),
        detalhadoEfetivo,
      ),
    [rows, itensPorOs, detalhadoEfetivo],
  );

  const periodo = useMemo(() => periodLabel(endpoint), [endpoint]);
  const eixo = useMemo(() => periodAxisLabel(endpoint), [endpoint]);
  const chips = useMemo(() => filtrosAplicados(endpoint, rows), [endpoint, rows]);

  const total = useMemo(() => rows.reduce((soma, row) => soma + row.budget, 0), [rows]);
  const ticket = rows.length ? total / rows.length : 0;

  /**
   * O fechamento das ordens do recorte, parcela por parcela.
   *
   * A leitura vai do resultado para a composição: primeiro o tamanho do recorte
   * e o orçamento que ele fecha, depois o que soma e por último o que abate. As
   * receitas sozinhas nunca batem com o orçamento, e a diferença seria lida
   * como erro de conta; com todas as parcelas na folha, o total se reconstrói
   * pelo mesmo caminho que o sistema faz.
   *
   * Card zerado não entra: numa oficina que não cobra frete, um "+R$ 0,00" fixo
   * na folha só ocupa a fileira e faz procurar um valor que não existe.
   */
  const cards = useMemo(() => {
    const somar = (pegar: (row: OrderRow) => number) => rows.reduce((soma, row) => soma + pegar(row), 0);
    const receitaProdutos = somar((row) => row.products);
    const receitaServicos = somar((row) => row.services);
    const descontos = somar((row) => row.discount);
    const frete = somar((row) => row.freight);
    const acrescimo = somar((row) => row.surcharge);

    const lista: CardFechamento[] = [
      { chave: "ordens", label: "Ordens no recorte", value: String(rows.length), valor: rows.length },
      { chave: "orcamento", label: "Orçamento total", value: money(total), destaque: true, valor: total },
      { chave: "ticket", label: "Média por ordem", value: money(ticket), valor: ticket },
      { chave: "produtos", label: "+ Receita de produtos", value: signedMoney(receitaProdutos, 1), tone: TOM_SOMA, valor: receitaProdutos },
      { chave: "servicos", label: "+ Receita de serviços", value: signedMoney(receitaServicos, 1), tone: TOM_SOMA, valor: receitaServicos },
      { chave: "frete", label: "+ Frete", value: signedMoney(frete, 1), tone: TOM_SOMA, valor: frete },
      { chave: "acrescimo", label: "+ Acréscimo fin.", value: signedMoney(acrescimo, 1), tone: TOM_SOMA, valor: acrescimo },
      { chave: "descontos", label: "− Descontos aplicados", value: signedMoney(descontos, -1), tone: TOM_SUBTRACAO, valor: descontos },
    ];

    return lista.filter((card) => card.valor > 0);
  }, [rows, total, ticket]);

  /**
   * Largura da grade do painel.
   *
   * Com um número par de cards as duas fileiras saem do mesmo tamanho; com
   * ímpar, a de cima leva o card a mais. Sai por `style` e não por
   * `grid-cols-N` do Tailwind porque N só existe em tempo de execução — a
   * classe montada em string seria descartada na purga do CSS e a grade
   * perderia as colunas.
   */
  const colunasDoPainel = Math.max(1, Math.ceil(cards.length / 2));

  /** Distribuição por status, do mais frequente ao menos — só o que couber. */
  const distribuicao = useMemo(() => {
    const contagem = new Map<string, number>();
    rows.forEach((row) => contagem.set(row.status, (contagem.get(row.status) ?? 0) + 1));
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Montando a relação de ordens...
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
          .os-list-shell{padding:0!important;background:#fff!important}
          .os-list-sheet{box-sizing:border-box!important;width:208mm!important;height:295mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .os-list-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
          /* O painel do dropdown é montado num portal no body: nenhum
             print:hidden de ancestral o alcança, e aberto no Ctrl+P ele
             imprimiria por cima da página 1. */
          .no-print{display:none!important}
          /* Sem isto o navegador descarta os fundos e as listras somem no papel. */
          .os-list-sheet,.os-list-sheet *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        }
      `}</style>
      <main className="os-list-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="no-print mx-auto mb-4 flex w-[210mm] items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PrintDisplayOptionsMenu options={opcoesDeExibicao} />
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
            {detalhadoEfetivo && pages.length > FOLHAS_PARA_AVISAR && (
              <span className="flex items-center gap-1 text-xs text-amber-700">
                <TriangleAlert className="h-3 w-3" />
                {pages.length} folhas — baixar em PDF vai demorar.
              </span>
            )}
          </div>
          <A4PdfActions filename="relacao-de-ordens-de-servico.pdf" backHref="/relatorios" selector=".os-list-sheet" />
        </div>

        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => (
            <section
              key={pageIndex}
              className="os-list-sheet flex h-[297mm] w-[210mm] flex-col overflow-hidden border bg-white p-[10mm] leading-[1.2] shadow-xl"
            >
              {pageIndex === 0 ? (
                <>
                  <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Relação de ordens de serviço</h1>
                      <p className="text-[10px] text-neutral-500">Situação operacional das ordens no recorte selecionado</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase text-neutral-500">{eixo}</p>
                      <p className="text-[11px] font-bold tabular-nums">{periodo}</p>
                      <p className="text-[10px] text-neutral-500">Página 1 de {pages.length}</p>
                    </div>
                  </header>

                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {chips.map((chip) => (
                        <span key={chip} className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[8px] uppercase text-neutral-600">
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* A ordem sai pronta do memo — recorte, orçamento, média, o que soma e
                      o que abate. Como as zeradas caem fora, o painel é sempre duas fileiras
                      do tamanho do que sobrou. */}
                  {cards.length > 0 && (
                    <div
                      className="mt-2 grid gap-2"
                      style={{ gridTemplateColumns: `repeat(${colunasDoPainel}, minmax(0, 1fr))` }}
                    >
                      {cards.map((card) => (
                        <Kpi key={card.chave} label={card.label} value={card.value} tone={card.tone} destaque={card.destaque} />
                      ))}
                    </div>
                  )}

                  {distribuicao.length > 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-neutral-200 py-1.5 text-[9px]">
                      <span className="uppercase text-neutral-500">Distribuição</span>
                      {distribuicao.map(([status, quantidade]) => (
                        <span key={status} className="flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${(STATUS_TOM[status] ?? SEM_TOM).faixa}`} />
                          <span>{statusLabel(status)}</span>
                          <strong className="tabular-nums">{quantidade}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-right text-[9px] text-neutral-500">Página {pageIndex + 1} de {pages.length}</p>
              )}

              <div className="mt-2 flex items-center gap-2 border-b border-neutral-300 pb-1 text-[8px] uppercase text-neutral-500">
                <span className="w-[14mm]">Ordem</span>
                <span className="flex-1">Cliente e alvo atendido</span>
                <span className="w-[26mm] text-right">Orçamento</span>
              </div>

              {/* Os rótulos dos itens saem uma vez por folha, e não acima de
                  cada ordem: repetidos, queimariam 4,5mm vezes o número de OS. */}
              {detalhadoEfetivo && (
                <div
                  className="flex items-center gap-2 border-b border-neutral-200 pb-[2px] pl-[14mm] pt-1 text-[7px] uppercase text-neutral-400"
                  style={{ height: `${MM_CABECALHO_ITENS}mm` }}
                >
                  <span className="flex-1">Item</span>
                  <span className="w-[22mm] text-right">Qtd. × unitário</span>
                  <span className="w-[16mm] text-right">Desconto</span>
                  <span className="w-[20mm] text-right">Subtotal</span>
                </div>
              )}

              <div className="min-h-0 flex-1">
                {pageRows.length ? (
                  pageRows.map((fatia, index) => (
                    <FatiaDaOrdem
                      key={`${fatia.ordem.id}-${fatia.continuacao ? fatia.primeiroIndice : "abre"}`}
                      fatia={fatia}
                      detalhado={detalhadoEfetivo}
                      listrada={index % 2 === 1}
                    />
                  ))
                ) : (
                  <div className="py-20 text-center text-sm text-neutral-500">Nenhuma ordem encontrada no recorte.</div>
                )}
              </div>

              {pageIndex === pages.length - 1 && rows.length > 0 && (
                <div className="mt-1 flex items-center justify-between border-t-2 border-black pt-1.5 text-[10px]">
                  <span className="uppercase text-neutral-500">
                    Total · {rows.length} {rows.length === 1 ? "ordem" : "ordens"}
                  </span>
                  <strong className="tabular-nums">{money(total)}</strong>
                </div>
              )}
            </section>
          ))}
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
}: {
  label: string;
  value: string;
  tone?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded border px-2 py-1.5 ${destaque ? "border-black bg-white" : "border-neutral-300 bg-neutral-50"}`}
    >
      <p className="text-[8px] font-semibold uppercase text-neutral-700">{label}</p>
      <p className={`text-[12px] font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function OrderLine({ row, listrada }: { row: OrderRow; listrada: boolean }) {
  const tom = STATUS_TOM[row.status] ?? SEM_TOM;

  return (
    <article
      className={`flex gap-2 overflow-hidden border-b border-neutral-200 py-1.5 ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_ORDEM}mm` }}
    >
      <span className={`w-[1mm] shrink-0 rounded-sm ${tom.faixa}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="w-[12mm] shrink-0 text-[11px] font-bold tabular-nums">#{row.id}</span>
          <span className={`shrink-0 rounded px-1 py-[1px] text-[8px] font-semibold uppercase ${tom.selo}`}>
            {statusLabel(row.status)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{row.customer}</span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums">{money(row.budget)}</span>
        </div>
        <p className="mt-[1px] truncate pl-[12mm] text-[9px] text-neutral-600">
          {row.target}
          {" · "}
          <span className="text-neutral-500">Setor</span> {row.sector}
          {" · "}
          <span className="text-neutral-500">Resp.</span> {row.owner}
          {row.priority ? ` · ${PRIORIDADE_LABEL[row.priority] ?? row.priority}` : ""}
        </p>
        <p className="mt-[1px] truncate pl-[12mm] text-[9px] text-neutral-500">
          <span className="tabular-nums">{row.openedAt}</span>
          {" → "}
          <span className="tabular-nums">{row.closedAt}</span>
          {" · "}
          {row.description}
        </p>
      </div>
    </article>
  );
}

/**
 * Uma fatia de ordem na folha.
 *
 * Com a opção desligada não há embrulho nenhum em volta da linha da ordem: o
 * DOM sai idêntico ao de antes desta opção existir.
 *
 * Ligada, o zebrado das ordens dá lugar a um filete no topo de cada bloco — o
 * fundo alternado brigaria com o das linhas de item logo abaixo.
 */
function FatiaDaOrdem({
  fatia,
  detalhado,
  listrada,
}: {
  fatia: FatiaOrdem;
  detalhado: boolean;
  listrada: boolean;
}) {
  if (!detalhado) return <OrderLine row={fatia.ordem} listrada={listrada} />;

  // Fatia sem item ou é a ordem sem lançamento nenhum, ou é o fechamento que
  // não coubera na folha anterior — o contrato está em `FatiaOrdem`.
  const semItens = fatia.itens.length === 0 && !fatia.continuacao;

  return (
    // O respiro entre ordens vai como padding, e não margem: margens irmãs
    // colapsam e o modelo passaria a contar mais do que a folha ocupa.
    <div className="border-t border-neutral-300" style={{ paddingBottom: `${MM_ESPACO_ORDEM}mm` }}>
      {fatia.continuacao ? (
        <ContinuacaoDaOrdem row={fatia.ordem} />
      ) : (
        <OrderLine row={fatia.ordem} listrada={false} />
      )}

      {semItens && (
        <p
          className="flex items-center pl-[14mm] text-[9px] italic text-neutral-500"
          style={{ height: `${MM_ITEM}mm` }}
        >
          Sem itens lançados
        </p>
      )}

      {fatia.itens.map((item, indice) => (
        <LinhaDeItem
          key={item.chave}
          item={item}
          listrada={(fatia.primeiroIndice + indice) % 2 === 1}
        />
      ))}

      {fatia.fecha && <FechamentoDaOrdem row={fatia.ordem} />}
    </div>
  );
}

/** Cabeçalho condensado da ordem que atravessou a virada de folha. */
function ContinuacaoDaOrdem({ row }: { row: OrderRow }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-neutral-200 text-[9px] text-neutral-500"
      style={{ height: `${MM_ORDEM_CONTINUACAO}mm` }}
    >
      <span className="w-[12mm] shrink-0 text-[10px] font-bold tabular-nums text-black">#{row.id}</span>
      <span className="min-w-0 flex-1 truncate">{row.customer}</span>
      <span className="shrink-0 uppercase">continuação</span>
    </div>
  );
}

function LinhaDeItem({ item, listrada }: { item: ItemDaOrdem; listrada: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 pl-[14mm] text-[9px] ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${MM_ITEM}mm` }}
    >
      {/* Largura fixa para as descrições alinharem entre um item e o seguinte:
          num selo que encolhe com o texto, cada linha começaria num lugar. */}
      <span
        className={`w-[13mm] shrink-0 rounded px-1 py-[1px] text-center text-[7px] font-semibold uppercase ${TOM_ITEM[item.tipo]}`}
      >
        {item.tipo === "SERVICO" ? "Serviço" : "Produto"}
      </span>
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
      <span className="w-[20mm] shrink-0 text-right font-semibold tabular-nums">{money(item.subtotal)}</span>
    </div>
  );
}

/**
 * A composição do valor daquela ordem — a mesma conta do painel do cabeçalho,
 * na escala de uma OS: o que soma em verde, o que abate em vermelho, e o
 * orçamento em preto por ser resultado, e não movimento.
 *
 * Os rótulos são curtos de propósito. Os do painel ("Receita de produtos") não
 * caberiam: seis parcelas com aquele comprimento passam da largura da folha, a
 * linha quebraria em duas e a segunda sairia cortada. Mesmo curtos, o caso de
 * seis parcelas mede 174mm dos 176mm disponíveis, e por isso a altura vem de
 * `alturaDoFechamento`, que reserva a segunda linha da quinta parcela em diante.
 *
 * As parcelas saem dos campos que a folha já tem, e não da soma das linhas de
 * item impressas acima. O desconto é recuperado dos próprios totais gravados
 * (`subtotal + frete − orçamento`), então a identidade fecha exatamente contra
 * o subtotal da OS; somar os itens arriscaria um centavo de diferença por
 * arredondamento, que o leitor trataria como erro de conta.
 */
function FechamentoDaOrdem({ row }: { row: OrderRow }) {
  const parcelas = [
    { chave: "produtos", label: "Produtos", valor: row.products, sinal: 1 as const },
    { chave: "servicos", label: "Serviços", valor: row.services, sinal: 1 as const },
    { chave: "descontos", label: "Descontos", valor: row.discount, sinal: -1 as const },
    { chave: "frete", label: "Frete", valor: row.freight, sinal: 1 as const },
  ].filter((parcela) => parcela.valor > 0);

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-x-3 border-t border-neutral-200 pl-[14mm] text-[8px]"
      style={{ height: `${alturaDoFechamento(row)}mm` }}
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
        <span className="text-neutral-500">= Orçamento</span>
        <strong className="text-[9px] tabular-nums">{money(row.budget)}</strong>
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
