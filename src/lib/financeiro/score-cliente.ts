import { valorDeFace as calcularValorDeFace } from "@/lib/financeiro/transacao";

const FUSO_FINANCEIRO = "America/Fortaleza";
const MILISSEGUNDOS_POR_DIA = 86_400_000;
const PENALIDADE_POR_DIA = 2;

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
  classificacao: "EXCELENTE" | "BOM" | "ATENCAO" | "CRITICO" | "SEM_HISTORICO";
  totalEmAberto: number;
  totalVencido: number;
  totalAVencer: number;
  totalRecebido: number;
  quantidadeEmAberto: number;
  quantidadeVencida: number;
  quantidadeAvaliada: number;
  percentualPagoEmDia: number | null;
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
    // Nas baixas atuais, `data` passa a representar a data efetiva do pagamento
    // e `vencimento_em` preserva o vencimento original. O fallback também cobre
    // títulos antigos que ainda não possuam `pago_em` preenchido.
    const pagamento = titulo.pagoEm
      ? diaNoFuso(titulo.pagoEm)
      : !titulo.pendente && titulo.vencimentoEm
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

    const nasceuComoTituloFuturo = titulo.pendente || Boolean(titulo.vencimentoEm);
    if (!nasceuComoTituloFuturo || !vencimento) continue;

    const diasAteHoje = diferencaEmDias(vencimento, hoje);
    if (diasAteHoje < 0) {
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
  const score = comNota.length === 0
    ? null
    : Math.round(
        pesoTotal > 0
          ? comNota.reduce((total, titulo) => total + titulo.nota * titulo.valor, 0) / pesoTotal
          : comNota.reduce((total, titulo) => total + titulo.nota, 0) / comNota.length,
      );
  const pagos = comNota.filter((titulo) => titulo.pagoEm != null);
  const pagosEmDia = pagos.filter((titulo) => titulo.diasAtraso === 0).length;
  const mediaDiasAtraso = pagos.length > 0
    ? Math.round(pagos.reduce((total, titulo) => total + titulo.diasAtraso, 0) / pagos.length)
    : null;

  return {
    score,
    classificacao: classificarScore(score),
    totalEmAberto: arredondarDinheiro(totalEmAberto),
    totalVencido: arredondarDinheiro(totalVencido),
    totalAVencer: arredondarDinheiro(totalAVencer),
    totalRecebido: arredondarDinheiro(totalRecebido),
    quantidadeEmAberto,
    quantidadeVencida,
    quantidadeAvaliada: comNota.length,
    percentualPagoEmDia: pagos.length > 0 ? Math.round((pagosEmDia / pagos.length) * 100) : null,
    mediaDiasAtraso,
    titulos: avaliados.sort((a, b) => b.vencimentoEm.localeCompare(a.vencimentoEm)),
  };
}
