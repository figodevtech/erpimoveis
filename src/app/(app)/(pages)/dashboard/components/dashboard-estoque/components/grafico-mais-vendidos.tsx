"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { useMediaQuery } from "@/hooks/use-media-query";

import ChartCard from "../../shared/chart-card";
import type { GrupoFiltro, MetricaRanking, OrigemFiltro, ProdutoVendido } from "../lib/types";

const TODOS_OS_GRUPOS = "TODOS";
/** Produto sem grupo precisa de uma chave própria: o Radix não aceita valor vazio. */
const SEM_GRUPO_CHAVE = "SEM_GRUPO";

/**
 * Série única: uma cor para todas as barras. A posição no ranking já é o eixo —
 * pintar cada barra de um tom diferente sugeriria categorias que não existem, e
 * a cor trocaria de dono a cada mudança de filtro.
 */
const COR_BARRA = "#8b5cf6";

const DICA_MAIS_VENDIDOS =
  "Produtos que mais saíram cobrados do cliente no período, somando a venda de balcão com a peça aplicada na ordem de serviço. " +
  "O período da venda é a data em que ela entrou em pagamento; o da OS é a data em que a execução foi encerrada — não a data em que o orçamento foi digitado. " +
  "Venda cancelada não entra; OS cancelada ou reiniciada perde o carimbo de conclusão e também sai. " +
  "O faturamento é o valor do item já líquido do desconto dele e sem o frete. O desconto geral do documento não é rateado entre os itens, então a soma por produto fica acima do valor do documento quando esse desconto existe. " +
  "Ficam de fora o produto avulso digitado na OS, que não tem cadastro, e o material consumido internamente, que não é cobrado. OS sem cobrança entra na quantidade com faturamento perto de zero. " +
  "O grupo é o do cadastro do produto, o mesmo da aba Geral do cadastro. A lista só traz os grupos que tiveram venda no período, e produto sem grupo cai em “Sem grupo”. " +
  "Quantidade é sempre número inteiro: produto vendido a metro ou litro já está arredondado na origem. " +
  "Não bate com a aba Rentabilidade, que usa outros eixos de data e rateia o faturamento — os dois números são diferentes de propósito.";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const unidades = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const moedaCurta = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

type Barra = {
  produtoId: number;
  rotulo: string;
  valor: number;
  produto: ProdutoVendido;
};

/** Diz qual filtro esvaziou o gráfico, em vez de um "sem dados" que não ajuda. */
function vazioPor(origem: OrigemFiltro, grupoFiltrado: boolean) {
  const sujeito = grupoFiltrado ? "Nenhum produto deste grupo" : "Nenhum produto";
  if (origem === "VENDA") return `${sujeito} foi vendido no balcão neste período.`;
  if (origem === "OS") return `${sujeito} foi cobrado em ordem de serviço neste período.`;
  return `${sujeito} foi vendido no período.`;
}

function chaveDoGrupo(produto: ProdutoVendido) {
  return produto.grupoId == null ? SEM_GRUPO_CHAVE : String(produto.grupoId);
}

function valorDoProduto(produto: ProdutoVendido, origem: OrigemFiltro, metrica: MetricaRanking) {
  const bucket = origem === "VENDA" ? produto.venda : origem === "OS" ? produto.os : produto;
  return metrica === "QUANTIDADE" ? bucket.quantidade : bucket.faturamento;
}

/**
 * Largura da faixa de rótulos do eixo. No celular ela cede espaço para a barra;
 * no desktop sobra largura e o nome do produto ganha o dela.
 */
const LARGURA_ROTULO_ESTREITO = 104;
const LARGURA_ROTULO_LARGO = 152;

/**
 * Quantos caracteres cabem na largura dada.
 *
 * O rótulo é ancorado à direita (`textAnchor="end"`), então tudo que passa da
 * largura do eixo sai pela esquerda e o SVG corta — era isso que comia a
 * primeira letra de "MÓDULO". Truncar por número fixo de caracteres não resolve
 * sozinho: caixa alta é bem mais larga que caixa baixa, e o catálogo é quase
 * todo em maiúsculas.
 *
 * Os 7,5px por caractere não são chute: medidos com `getComputedTextLength()`
 * na Geist 11px contra os 787 títulos de produto do cadastro. Nessa razão
 * nenhum título estoura, com folga de 6px no eixo estreito e 14px no largo.
 * A 7px por caractere o pior nome encosta exatamente no limite — sem margem
 * para o próximo produto cadastrado.
 */
const PX_POR_CARACTERE = 7.5;

/** Distância entre a ponta da barra e o rótulo do valor. */
const ROTULO_AFASTAMENTO = 8;

function caracteresQueCabem(largura: number) {
  return Math.max(6, Math.floor((largura - 12) / PX_POR_CARACTERE));
}

function ProdutoTick(props: any) {
  const { x, y, payload, maxLen = 18 } = props;
  const rotulo: string = payload?.value ?? "";
  const visivel = rotulo.length > maxLen ? `${rotulo.slice(0, maxLen).trimEnd()}…` : rotulo;

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
        {/* O nome inteiro continua disponível no hover e no leitor de tela. */}
        <title>{rotulo}</title>
        {visivel}
      </text>
    </g>
  );
}

function DicaDoPonto({ active, payload, origem }: any) {
  if (!active || !payload?.length) return null;
  const produto: ProdutoVendido | undefined = payload[0]?.payload?.produto;
  if (!produto) return null;

  const linhas: Array<[string, string]> = [
    ["Unidades", unidades.format(valorDoProduto(produto, origem, "QUANTIDADE"))],
    ["Faturamento", moeda.format(valorDoProduto(produto, origem, "FATURAMENTO"))],
  ];

  // A quebra por origem só diz algo quando as duas estão somadas na mesma barra.
  if (origem === "TODAS" && produto.venda.quantidade > 0 && produto.os.quantidade > 0) {
    linhas.push(["Pela venda", `${unidades.format(produto.venda.quantidade)} un.`]);
    linhas.push(["Pela OS", `${unidades.format(produto.os.quantidade)} un.`]);
  }

  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: COR_BARRA }} />
        <span className="min-w-0 flex-1 font-medium">{produto.titulo}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {[produto.referencia ? `Ref. ${produto.referencia}` : null, produto.grupoNome]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{rotulo}</span>
          <span className="font-medium tabular-nums">{valor}</span>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        em {unidades.format(produto.documentos)} {produto.documentos === 1 ? "documento" : "documentos"}
      </p>
    </div>
  );
}

export type GraficoMaisVendidosProps = {
  ranking: ProdutoVendido[];
  carregando: boolean;
  /** Muda a cada resposta: reinicia a animação. */
  animKey: number;
  className?: string;
};

export default function GraficoMaisVendidos({
  ranking,
  carregando,
  animKey,
  className,
}: GraficoMaisVendidosProps) {
  const [metrica, setMetrica] = React.useState<MetricaRanking>("QUANTIDADE");
  const [origem, setOrigem] = React.useState<OrigemFiltro>("TODAS");
  const [grupo, setGrupo] = React.useState<GrupoFiltro>(TODOS_OS_GRUPOS);

  const telaEstreita = useMediaQuery("(max-width: 640px)");
  const larguraRotulo = telaEstreita ? LARGURA_ROTULO_ESTREITO : LARGURA_ROTULO_LARGO;
  const maxLenRotulo = caracteresQueCabem(larguraRotulo);

  // Os grupos saem do que o período vendeu, não do cadastro inteiro: grupo sem
  // venda nenhuma no período só encheria a lista de opção que dá gráfico vazio.
  const grupos = React.useMemo(() => {
    const porChave = new Map<string, { chave: string; nome: string }>();
    for (const produto of ranking) {
      const chave = chaveDoGrupo(produto);
      if (!porChave.has(chave)) porChave.set(chave, { chave, nome: produto.grupoNome });
    }
    return Array.from(porChave.values()).sort((a, b) =>
      // "Sem grupo" é o resto, então fecha a lista em vez de disputar o alfabeto.
      a.chave === SEM_GRUPO_CHAVE
        ? 1
        : b.chave === SEM_GRUPO_CHAVE
          ? -1
          : a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }, [ranking]);

  // O grupo escolhido pode sumir ao trocar o período. Sem isto o Select fica
  // mostrando um grupo que não existe mais e o gráfico, vazio sem explicação.
  React.useEffect(() => {
    if (grupo === TODOS_OS_GRUPOS) return;
    if (!grupos.some((item) => item.chave === grupo)) setGrupo(TODOS_OS_GRUPOS);
  }, [grupos, grupo]);

  // O corte do top 10 é aqui, depois de filtrar e reordenar. Cortar no servidor
  // pela quantidade total deixaria de fora a peça cara vendida poucas vezes —
  // que é justamente o topo do ranking por faturamento.
  const barras: Barra[] = React.useMemo(
    () =>
      ranking
        .filter((produto) => grupo === TODOS_OS_GRUPOS || chaveDoGrupo(produto) === grupo)
        .map((produto) => ({
          produtoId: produto.produtoId,
          rotulo: produto.titulo,
          valor: valorDoProduto(produto, origem, metrica),
          produto,
        }))
        .filter((barra) => barra.valor > 0)
        .sort((a, b) => b.valor - a.valor || a.produtoId - b.produtoId)
        .slice(0, 10),
    [ranking, grupo, origem, metrica],
  );

  const formatarValor = React.useCallback(
    (valor: number) => (metrica === "QUANTIDADE" ? unidades.format(valor) : moedaCurta.format(valor)),
    [metrica],
  );

  const altura = Math.max(240, barras.length * 38);

  // A margem direita abriga o rótulo do valor, que fica na ponta da barra. Em
  // "Unidades" ele é "2"; em "Faturamento" vira "452.175" e uma margem fixa
  // cortaria o número. Por isso ela sai do maior rótulo que o gráfico vai
  // desenhar — dígito é mais estreito que maiúscula, então PX_POR_CARACTERE
  // sobra de propósito.
  const margemDireita = React.useMemo(() => {
    const maior = barras.reduce((teto, barra) => Math.max(teto, barra.valor), 0);
    return Math.max(32, ROTULO_AFASTAMENTO + Math.ceil(formatarValor(maior).length * PX_POR_CARACTERE) + 6);
  }, [barras, formatarValor]);

  return (
    <ChartCard
      title="Produtos mais vendidos"
      description="Top 10 do período, por unidades ou por faturamento"
      hint={DICA_MAIS_VENDIDOS}
      className={className}
    >
      {/* Três controles não cabem no cabeçalho de um celular: viram uma faixa
          de filtros acima do gráfico, que quebra em duas linhas quando precisa. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {/* As larguras cabem a opção mais longa de cada lista: o trigger do
            Select tem `line-clamp-1`, então largura curta não quebra a linha —
            corta a palavra no meio ("Todas as origer"). */}
        <Select value={metrica} onValueChange={(valor) => setMetrica(valor as MetricaRanking)}>
          <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Métrica do ranking">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="QUANTIDADE">Unidades</SelectItem>
            <SelectItem value="FATURAMENTO">Faturamento</SelectItem>
          </SelectContent>
        </Select>

        <Select value={origem} onValueChange={(valor) => setOrigem(valor as OrigemFiltro)}>
          <SelectTrigger className="h-8 w-[156px] text-xs" aria-label="Origem da venda">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODAS">Todas as origens</SelectItem>
            <SelectItem value="VENDA">Venda</SelectItem>
            <SelectItem value="OS">Ordem de serviço</SelectItem>
          </SelectContent>
        </Select>

        <Select value={grupo} onValueChange={setGrupo} disabled={grupos.length <= 1}>
          {/* Nome de grupo varia muito ("ARLA" e "INJ BICOS / UNID / BBA"), então
              aqui é faixa e não largura fixa: acompanha o nome e para de crescer. */}
          <SelectTrigger
            className="h-8 w-fit min-w-[150px] max-w-[220px] text-xs"
            aria-label="Grupo do produto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_OS_GRUPOS}>Todos os grupos</SelectItem>
            {grupos.map((item) => (
              <SelectItem key={item.chave} value={item.chave}>
                {item.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {barras.length === 0 ? (
        <p className="py-12 text-center text-[11px] text-muted-foreground">
          {vazioPor(origem, grupo !== TODOS_OS_GRUPOS)}
        </p>
      ) : (
        <ChartContainer
          config={{
            valor: { label: metrica === "QUANTIDADE" ? "Unidades" : "Faturamento", color: COR_BARRA },
          }}
          className="w-full"
          style={{ height: altura }}
        >
          <BarChart
            key={`mais-vendidos-${metrica}-${origem}-${animKey}`}
            data={barras}
            layout="vertical"
            margin={{ top: 4, right: margemDireita, left: 4, bottom: 4 }}
            barCategoryGap={6}
          >
            <CartesianGrid horizontal={false} strokeDasharray="4 8" stroke="var(--border)" opacity={0.7} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={larguraRotulo}
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={<ProdutoTick maxLen={maxLenRotulo} />}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={<DicaDoPonto origem={origem} />}
            />
            <Bar
              dataKey="valor"
              fill={COR_BARRA}
              radius={[0, 4, 4, 0]}
              isAnimationActive={!carregando}
              animationDuration={700}
              maxBarSize={22}
            >
              <LabelList
                dataKey="valor"
                position="right"
                offset={ROTULO_AFASTAMENTO}
                fontSize={11}
                className="fill-foreground"
                formatter={formatarValor}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  );
}
