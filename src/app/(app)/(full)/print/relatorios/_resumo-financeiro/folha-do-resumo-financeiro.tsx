import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import type { ResumoDoMetodo, SaldosDoRecorte } from "./resumo-financeiro-model";

/** Da receita bruta do cabeçalho ao valor dos documentos do resumo financeiro. */
export type ConciliacaoDoRecorte = { receitaBruta: number; descontos: number; acrescimo: number };

/** Os textos que mudam entre a relação de ordens e a de vendas. */
const TEXTOS = {
  OS: {
    singular: "ordem",
    plural: "ordens",
    valor: "Valor das ordens",
    painel: "no painel financeiro da OS",
    cadaUm: "cada OS",
    semLancamento:
      "a parte do orçamento (com acréscimo financeiro) que nenhum pagamento cobre. Ordens canceladas, recusadas ou sem cobrança não têm saldo nessa coluna.",
    receitaBruta: "produtos, serviços e frete antes dos descontos",
    ajuste:
      "receita de ordem sem cobrança ou cancelada, que não vira valor a receber, e pagamento lançado acima do valor da ordem.",
  },
  VENDA: {
    singular: "venda",
    plural: "vendas",
    valor: "Valor das vendas",
    painel: "na tela de pagamento da venda",
    cadaUm: "cada venda",
    semLancamento:
      "a parte do total da venda (com acréscimo financeiro) que nenhum pagamento cobre. Vendas canceladas ou recusadas não têm saldo nessa coluna.",
    receitaBruta: "subtotal de produtos e frete antes dos descontos",
    ajuste:
      "valor de venda cancelada ou recusada, que não vira valor a receber; venda ainda em orçamento, que já conta no valor a receber mas não gerou receita; e pagamento lançado acima do total da venda.",
  },
} as const;

export type DocumentoDoResumo = keyof typeof TEXTOS;

const TOM_SOMA = "text-emerald-700";
const TOM_SUBTRACAO = "text-red-700";
/** Pendência em âmbar: nem soma nem abatimento, que já são verde e vermelho. */
const TOM_PENDENTE = "text-amber-700";

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function signedMoney(value: number, sinal: 1 | -1) {
  return `${sinal < 0 ? "−" : "+"}${money(Math.abs(value))}`;
}

/**
 * A última folha das relações de ordens e de vendas: como o valor dos
 * documentos do recorte está sendo pago.
 *
 * Cada recebimento conta no seu método assim que é lançado — o boleto entra em
 * "Boleto" mesmo antes da baixa —, e a situação diz se o dinheiro já entrou ou
 * ainda está em aberto, vencido ou a vencer. O que nenhum pagamento cobre sai
 * numa linha à parte, para a tabela fechar com o valor dos documentos.
 *
 * Os valores são de face, como no saldo do documento: juros, multa e a taxa da
 * maquineta pertencem ao pagamento, não à ordem nem à venda.
 *
 * Só o miolo: a moldura da folha é de quem chama, porque cada relação tem a sua
 * classe de impressão.
 */
export function FolhaDoResumoFinanceiro({
  documento,
  eixo,
  periodo,
  pagina,
  quantidade,
  saldos,
  conciliacao,
  metodos,
}: {
  documento: DocumentoDoResumo;
  eixo: string;
  periodo: string;
  pagina: number;
  /** Quantos documentos há no recorte. */
  quantidade: number;
  saldos: SaldosDoRecorte;
  conciliacao: ConciliacaoDoRecorte;
  metodos: ResumoDoMetodo[];
}) {
  const textos = TEXTOS[documento];
  const pendente = saldos.pendenteVencido + saldos.pendenteAVencer;
  const lancado = saldos.recebido + pendente;
  const valorDosDocumentos = lancado + saldos.semLancamento;

  // O que a conta da receita não explica: documento sem cobrança ou cancelado
  // com receita, pagamento acima do valor. Só aparece quando existe, para a
  // fileira nunca mostrar uma soma que não fecha.
  const esperado = conciliacao.receitaBruta - conciliacao.descontos + conciliacao.acrescimo;
  const ajuste = Math.round((valorDosDocumentos - esperado) * 100) / 100;
  const cardsDaConciliacao = [
    { chave: "receitaBruta", label: "Receita bruta", value: money(conciliacao.receitaBruta) },
    { chave: "descontos", label: "− Descontos", value: signedMoney(conciliacao.descontos, -1), tone: TOM_SUBTRACAO },
    { chave: "acrescimo", label: "+ Acréscimo financeiro", value: signedMoney(conciliacao.acrescimo, 1), tone: TOM_SOMA },
    ...(ajuste !== 0
      ? [{ chave: "ajuste", label: "± Outros ajustes", value: signedMoney(ajuste, ajuste < 0 ? -1 : 1), tone: "text-neutral-600" }]
      : []),
  ];
  const percentual = (valor: number) =>
    valorDosDocumentos > 0
      ? `${((valor / valorDosDocumentos) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
      : "—";
  const lancamentos = metodos.reduce((soma, metodo) => soma + metodo.lancamentos, 0);

  const cards = [
    { chave: "recebido", label: "Recebido", valor: saldos.recebido, tone: TOM_SOMA },
    { chave: "pendente", label: "Pendente", valor: pendente, tone: TOM_PENDENTE },
    // Parte do pendente, e não uma parcela a mais: fica ao lado dele para ler
    // quanto do que está em aberto já passou do vencimento.
    { chave: "vencido", label: "Pendente vencido", valor: saldos.pendenteVencido, tone: TOM_SUBTRACAO },
    { chave: "semLancamento", label: "Sem lançamento", valor: saldos.semLancamento, tone: "text-neutral-600" },
  ];

  return (
    <>
      <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold uppercase">Resumo financeiro</h1>
          <p className="text-[10px] text-neutral-500">
            Como o valor das {quantidade} {quantidade === 1 ? textos.singular : textos.plural} do recorte está sendo pago
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase text-neutral-500">{eixo}</p>
          <p className="text-[11px] font-bold tabular-nums">{periodo}</p>
          <p className="text-[10px] text-neutral-500">Página {pagina} de {pagina}</p>
        </div>
      </header>

      <div
        className="mt-1 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cardsDaConciliacao.length + 1}, minmax(0, 1fr))` }}
      >
        {cardsDaConciliacao.map((card) => (
          <Kpi key={card.chave} label={card.label} value={card.value} tone={card.tone} />
        ))}
        <Kpi label={`= ${textos.valor}`} value={money(valorDosDocumentos)} destaque />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {cards.map((card) => (
          <Kpi
            key={card.chave}
            label={`${card.label} · ${percentual(card.valor)}`}
            value={money(card.valor)}
            tone={card.tone}
          />
        ))}
      </div>

      <h2 className="mt-4 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">Por forma de pagamento</h2>
      <div className="mt-1 flex items-center gap-2 border-b border-neutral-300 pb-1 text-[8px] uppercase text-neutral-500">
        <span className="min-w-0 flex-1">Forma de pagamento</span>
        <span className="w-[14mm] text-right">Lançam.</span>
        <span className="w-[24mm] text-right">Recebido</span>
        <span className="w-[24mm] text-right">Vencido</span>
        <span className="w-[24mm] text-right">A vencer</span>
        <span className="w-[26mm] text-right">Total</span>
        <span className="w-[12mm] text-right">%</span>
      </div>

      {metodos.length === 0 && (
        <p className="py-3 text-center text-[9px] italic text-neutral-500">
          Nenhum pagamento lançado nas {textos.plural} do recorte.
        </p>
      )}

      {metodos.map((metodo, indice) => (
        <div
          key={metodo.metodo || "sem-metodo"}
          className={`flex items-center gap-2 py-1 text-[9px] ${indice % 2 === 1 ? "bg-neutral-50" : ""}`}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">
            {metodo.metodo ? formatPaymentMethodLabel(metodo.metodo) : "Não informado"}
          </span>
          <span className="w-[14mm] text-right tabular-nums text-neutral-600">{metodo.lancamentos}</span>
          <ValorDaColuna valor={metodo.recebido} tone={TOM_SOMA} />
          <ValorDaColuna valor={metodo.pendenteVencido} tone={TOM_SUBTRACAO} />
          <ValorDaColuna valor={metodo.pendenteAVencer} tone={TOM_PENDENTE} />
          <span className="w-[26mm] text-right font-semibold tabular-nums">{money(metodo.total)}</span>
          <span className="w-[12mm] text-right tabular-nums text-neutral-500">{percentual(metodo.total)}</span>
        </div>
      ))}

      {saldos.semLancamento > 0 && (
        <div className="flex items-center gap-2 border-t border-dashed border-neutral-300 py-1 text-[9px] italic text-neutral-600">
          <span className="min-w-0 flex-1">Sem pagamento lançado</span>
          <span className="w-[14mm]" />
          <span className="w-[24mm]" />
          <span className="w-[24mm]" />
          <span className="w-[24mm]" />
          <span className="w-[26mm] text-right font-semibold tabular-nums">{money(saldos.semLancamento)}</span>
          <span className="w-[12mm] text-right tabular-nums text-neutral-500">{percentual(saldos.semLancamento)}</span>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2 border-t-2 border-black pt-1.5 text-[10px] font-bold">
        <span className="min-w-0 flex-1 uppercase">Total</span>
        <span className="w-[14mm] text-right tabular-nums">{lancamentos}</span>
        <span className={`w-[24mm] text-right tabular-nums ${TOM_SOMA}`}>{money(saldos.recebido)}</span>
        <span className={`w-[24mm] text-right tabular-nums ${TOM_SUBTRACAO}`}>{money(saldos.pendenteVencido)}</span>
        <span className={`w-[24mm] text-right tabular-nums ${TOM_PENDENTE}`}>{money(saldos.pendenteAVencer)}</span>
        <span className="w-[26mm] text-right tabular-nums">{money(valorDosDocumentos)}</span>
        <span className="w-[12mm] text-right tabular-nums text-neutral-500">{valorDosDocumentos > 0 ? "100%" : "—"}</span>
      </div>

      <div className="mt-4 space-y-1 text-[8px] text-neutral-500">
        <p>
          <strong>Recebido</strong>: pagamento baixado — o dinheiro entrou. <strong>Vencido</strong> e{" "}
          <strong>a vencer</strong>: títulos lançados e ainda em aberto, separados pelo vencimento. Título baixado em
          parte conta nas duas colunas.
        </p>
        <p>
          Valores de face, como {textos.painel}: juros, multa e taxa da maquineta ficam de fora. Entram todos os
          pagamentos das {textos.plural} listadas, de qualquer data; pagamentos em grupo entram pela parte de{" "}
          {textos.cadaUm}.
        </p>
        <p>
          <strong>Sem lançamento</strong>: {textos.semLancamento}
        </p>
        <p>
          <strong>Receita bruta</strong> é a mesma do cabeçalho: {textos.receitaBruta}.
          {ajuste !== 0 && ` Outros ajustes: ${textos.ajuste}`}
        </p>
      </div>
    </>
  );
}

/** Card do painel, com a mesma caixa dos cards do cabeçalho das duas folhas. */
function Kpi({ label, value, tone, destaque }: { label: string; value: string; tone?: string; destaque?: boolean }) {
  return (
    <div className={`rounded border px-2 py-1.5 ${destaque ? "border-black bg-white" : "border-neutral-300 bg-neutral-50"}`}>
      <span className="block text-[8px] font-semibold uppercase text-neutral-700">{label}</span>
      <span className={`block text-[12px] font-bold tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function ValorDaColuna({ valor, tone }: { valor: number; tone: string }) {
  return (
    <span className={`w-[24mm] text-right tabular-nums ${valor > 0 ? tone : "text-neutral-300"}`}>
      {valor > 0 ? money(valor) : "—"}
    </span>
  );
}
