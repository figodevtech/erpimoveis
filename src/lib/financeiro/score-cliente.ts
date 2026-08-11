import { valorDeFace as calcularValorDeFace } from "@/lib/financeiro/transacao";

const FUSO_FINANCEIRO = "America/Fortaleza";
const MILISSEGUNDOS_POR_DIA = 86_400_000;
const PENALIDADE_POR_DIA = 2;

// Média ponderada resume comportamento passado; inadimplência é presente. Um
// histórico grande de recebimentos afogaria um título vencido pequeno e o
// cliente apareceria como EXCELENTE devendo — por isso o teto entra depois da
// média, limitando o resultado em vez de virar mais uma amostra dentro dela.
const TETO_COM_TITULO_VENCIDO = 59;
const TETO_COM_ATRASO_GRAVE = 39;
const DIAS_PARA_ATRASO_GRAVE = 30;

export type TituloClienteInput = {
  id: number;
  valor: number;
  valorAcrescimos?: number | null;
  pendente: boolean;
  data: string;
  vencimentoEm?: string | null;
  pagoEm?: string | null;
  ordemServicoId?: number | null;
  vendaId?: number | null;
  metodoPagamento?: string | null;
};

export type SituacaoTituloCliente =
  | "A_VENCER"
  | "VENCE_HOJE"
  | "VENCIDO"
  | "PAGO_A_VISTA"
  | "PAGO_EM_DIA"
  | "PAGO_EM_ATRASO";

export type TituloClienteAvaliado = {
  id: number;
  valor: number;
  vencimentoEm: string;
  pagoEm: string | null;
  diasAtraso: number;
  nota: number | null;
  situacao: SituacaoTituloCliente;
  ordemServicoId: number | null;
  vendaId: number | null;
  metodoPagamento: string | null;
};

export type ResumoFinanceiroCliente = {
  score: number | null;
  /** Média ponderada do histórico, antes do teto por inadimplência. */
  scoreBase: number | null;
  /** Teto que limitou o Score, ou `null` quando o histórico prevaleceu. */
  tetoAplicado: number | null;
  /** Maior atraso, em dias, entre os títulos vencidos ainda em aberto. */
  maiorAtrasoEmAberto: number | null;
  classificacao: "EXCELENTE" | "BOM" | "ATENCAO" | "CRITICO" | "SEM_HISTORICO";
  totalEmAberto: number;
  totalVencido: number;
  totalAVencer: number;
  totalRecebido: number;
  quantidadeEmAberto: number;
  quantidadeVencida: number;
  quantidadeAvaliada: number;
  /** Só sobre títulos que tiveram prazo — à vista não mede pontualidade. */
  percentualPagoEmDia: number | null;
  /** Só sobre títulos que tiveram prazo — à vista não mede pontualidade. */
  mediaDiasAtraso: number | null;
  titulos: TituloClienteAvaliado[];
};

function diaNoFuso(valor: string | Date) {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor;
  }

  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_FINANCEIRO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

function diferencaEmDias(inicio: string, fim: string) {
  const [anoInicio, mesInicio, diaInicio] = inicio.split("-").map(Number);
  const [anoFim, mesFim, diaFim] = fim.split("-").map(Number);
  const utcInicio = Date.UTC(anoInicio, mesInicio - 1, diaInicio);
  const utcFim = Date.UTC(anoFim, mesFim - 1, diaFim);
  return Math.round((utcFim - utcInicio) / MILISSEGUNDOS_POR_DIA);
}

function valorDeFace(titulo: TituloClienteInput) {
  return Math.max(0, calcularValorDeFace({
    valor: titulo.valor,
    valor_acrescimos: titulo.valorAcrescimos,
  }));
}

function arredondarDinheiro(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function classificarScore(score: number | null): ResumoFinanceiroCliente["classificacao"] {
  if (score == null) return "SEM_HISTORICO";
  if (score >= 80) return "EXCELENTE";
  if (score >= 60) return "BOM";
  if (score >= 40) return "ATENCAO";
  return "CRITICO";
}

export function calcularScoreCliente(
  titulos: TituloClienteInput[],
  agora: Date = new Date(),
): ResumoFinanceiroCliente {
  const hoje = diaNoFuso(agora);
  if (!hoje) throw new Error("Data de referencia invalida para o Score do cliente.");

  let totalEmAberto = 0;
  let totalVencido = 0;
  let totalAVencer = 0;
  let totalRecebido = 0;
  let quantidadeEmAberto = 0;
  let quantidadeVencida = 0;

  const avaliados: TituloClienteAvaliado[] = [];

  for (const titulo of titulos) {
    const valor = valorDeFace(titulo);
    const vencimento = diaNoFuso(titulo.vencimentoEm ?? titulo.data);
    // Recebimento à vista nasce quitado e sem `vencimento_em`: não houve prazo a
    // cumprir, o dia do lançamento é vencimento e pagamento ao mesmo tempo.
    // Como a baixa sempre grava `vencimento_em = coalesce(vencimento_em, data)`,
    // a ausência do campo num título já quitado só acontece nesse caso.
    const pagoAVista = !titulo.pendente && !titulo.vencimentoEm;
    // Nas baixas atuais, `data` passa a representar a data efetiva do pagamento
    // e `vencimento_em` preserva o vencimento original. O fallback também cobre
    // títulos antigos que ainda não possuam `pago_em` preenchido.
    const pagamento = titulo.pagoEm
      ? diaNoFuso(titulo.pagoEm)
      : !titulo.pendente
        ? diaNoFuso(titulo.data)
        : null;

    if (titulo.pendente) {
      totalEmAberto += valor;
      quantidadeEmAberto += 1;

      if (vencimento && vencimento < hoje) {
        totalVencido += valor;
        quantidadeVencida += 1;
      } else {
        totalAVencer += valor;
      }
    } else {
      totalRecebido += valor;
    }

    if (!vencimento) continue;

    const diasAteHoje = diferencaEmDias(vencimento, hoje);
    // Fica de fora do Score apenas quem ainda não pagou e cujo vencimento não
    // chegou: não há comportamento a avaliar. Quem já pagou — à vista, adiantado
    // ou no prazo — entra, mesmo que o vencimento ainda seja futuro.
    if (diasAteHoje < 0 && !pagamento) {
      avaliados.push({
        id: titulo.id,
        valor,
        vencimentoEm: vencimento,
        pagoEm: pagamento,
        diasAtraso: 0,
        nota: null,
        situacao: "A_VENCER",
        ordemServicoId: titulo.ordemServicoId ?? null,
        vendaId: titulo.vendaId ?? null,
        metodoPagamento: titulo.metodoPagamento ?? null,
      });
      continue;
    }

    const dataFinal = pagamento ?? hoje;
    const diasAtraso = Math.max(0, diferencaEmDias(vencimento, dataFinal));
    const nota = Math.max(0, 100 - diasAtraso * PENALIDADE_POR_DIA);
    const situacao: SituacaoTituloCliente = titulo.pendente
      ? vencimento === hoje
        ? "VENCE_HOJE"
        : "VENCIDO"
      : pagoAVista
        ? "PAGO_A_VISTA"
        : diasAtraso > 0
          ? "PAGO_EM_ATRASO"
          : "PAGO_EM_DIA";

    avaliados.push({
      id: titulo.id,
      valor,
      vencimentoEm: vencimento,
      pagoEm: pagamento,
      diasAtraso,
      nota,
      situacao,
      ordemServicoId: titulo.ordemServicoId ?? null,
      vendaId: titulo.vendaId ?? null,
      metodoPagamento: titulo.metodoPagamento ?? null,
    });
  }

  const comNota = avaliados.filter(
    (titulo): titulo is TituloClienteAvaliado & { nota: number } => titulo.nota != null,
  );
  const pesoTotal = comNota.reduce((total, titulo) => total + titulo.valor, 0);
  const scoreBase = comNota.length === 0
    ? null
    : Math.round(
        pesoTotal > 0
          ? comNota.reduce((total, titulo) => total + titulo.nota * titulo.valor, 0) / pesoTotal
          : comNota.reduce((total, titulo) => total + titulo.nota, 0) / comNota.length,
      );

  // "Vence hoje" ainda está no prazo: não é inadimplência e não puxa o teto.
  const vencidosEmAberto = avaliados.filter((titulo) => titulo.situacao === "VENCIDO");
  const maiorAtrasoEmAberto = vencidosEmAberto.length > 0
    ? Math.max(...vencidosEmAberto.map((titulo) => titulo.diasAtraso))
    : null;
  const tetoAplicado = maiorAtrasoEmAberto == null
    ? null
    : maiorAtrasoEmAberto > DIAS_PARA_ATRASO_GRAVE
      ? TETO_COM_ATRASO_GRAVE
      : TETO_COM_TITULO_VENCIDO;
  // Teto limita, nunca promove: quem já estava abaixo dele continua onde estava.
  const score = scoreBase == null || tetoAplicado == null
    ? scoreBase
    : Math.min(scoreBase, tetoAplicado);

  // Pontualidade só faz sentido sobre quem teve prazo para cumprir. Incluir os
  // à vista (sempre 0 dias) empurraria os dois indicadores para 100% / 0 dia em
  // qualquer cliente, e eles deixariam de sinalizar qualquer coisa.
  const pagosComPrazo = comNota.filter(
    (titulo) => titulo.pagoEm != null && titulo.situacao !== "PAGO_A_VISTA",
  );
  const pagosEmDia = pagosComPrazo.filter((titulo) => titulo.diasAtraso === 0).length;
  const mediaDiasAtraso = pagosComPrazo.length > 0
    ? Math.round(
        pagosComPrazo.reduce((total, titulo) => total + titulo.diasAtraso, 0)
          / pagosComPrazo.length,
      )
    : null;

  return {
    score,
    scoreBase,
    tetoAplicado: score != null && scoreBase != null && score < scoreBase ? tetoAplicado : null,
    maiorAtrasoEmAberto,
    classificacao: classificarScore(score),
    totalEmAberto: arredondarDinheiro(totalEmAberto),
    totalVencido: arredondarDinheiro(totalVencido),
    totalAVencer: arredondarDinheiro(totalAVencer),
    totalRecebido: arredondarDinheiro(totalRecebido),
    quantidadeEmAberto,
    quantidadeVencida,
    quantidadeAvaliada: comNota.length,
    percentualPagoEmDia: pagosComPrazo.length > 0
      ? Math.round((pagosEmDia / pagosComPrazo.length) * 100)
      : null,
    mediaDiasAtraso,
    titulos: avaliados.sort((a, b) => b.vencimentoEm.localeCompare(a.vencimentoEm)),
  };
}
