// Regra das somas do relatório de fluxo de caixa, fora do JSX para ser testada.
//
// O PDF precisa dizer o mesmo que a aba Fluxo da lista e o dashboard financeiro.
// Ele somava `valor` de toda linha do período: título ainda pendente, título
// quitado por antecipação (sem banco, cujo dinheiro já entrou pelo adiantamento)
// e o bruto das vendas no cartão. No Demir, de 01 a 14/09/2026, imprimia
// R$ 329.970,64 de entradas contra R$ 235.836,35 das outras duas telas.

import { saldoEmAberto, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";

export type LinhaDoFluxo = {
  tipo: string | null;
  pendente: boolean | null;
  banco_id: number | null;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  valor_baixado: number | string | null;
  baixa_de_transacao_id: number | null;
  adiantamento_id: number | null;
};

/** Realizado é o que passou por uma conta: o mesmo recorte da aba Fluxo (`comBanco=true`). */
const REALIZADAS = "and(pendente.eq.false,banco_id.not.is.null)";
/** Em aberto é o título. As baixas parciais dele já estão entre as realizadas. */
const EM_ABERTO = "and(pendente.eq.true,baixa_de_transacao_id.is.null)";

/** Filtro PostgREST (`.or`) para a situação escolhida no diálogo. */
export function filtroDeSituacao(pendente: string | undefined) {
  if (pendente === "false") return REALIZADAS;
  if (pendente === "true") return EM_ABERTO;
  return `${REALIZADAS},${EM_ABERTO}`;
}

export function ehEntrada(tipo: string | null | undefined) {
  const normalizado = String(tipo ?? "").toUpperCase();
  return normalizado === "RECEITA" || normalizado === "DEPOSITO";
}

/** Realizada vale o líquido efetivo; título em aberto vale o que ainda falta. */
export function valorDaLinha(linha: LinhaDoFluxo) {
  return linha.pendente ? saldoEmAberto(linha) : valorLiquidoEfetivo(linha);
}

/**
 * Entradas e saídas somam só o realizado; o em aberto sai à parte.
 *
 * Os filtros da consulta já fazem o recorte, e a regra se repete aqui para o
 * total nunca depender de a consulta ter vindo certa.
 */
export function totalizarFluxo(linhas: LinhaDoFluxo[]) {
  // Em centavos, como os cartões da lista: somar reais acumula erro de ponto flutuante.
  let entradas = 0;
  let saidas = 0;
  let aReceber = 0;
  let aPagar = 0;

  for (const linha of linhas) {
    const centavos = Math.round(valorDaLinha(linha) * 100);
    if (!(centavos > 0)) continue;
    const entrada = ehEntrada(linha.tipo);

    if (linha.pendente) {
      if (linha.baixa_de_transacao_id != null) continue;
      // Título antecipado: o dinheiro já entrou pelo adiantamento. É a mesma
      // exclusão dos cartões de A Receber e A Pagar.
      if (linha.adiantamento_id != null) continue;
      if (entrada) aReceber += centavos;
      else aPagar += centavos;
    } else {
      if (linha.banco_id == null) continue;
      if (entrada) entradas += centavos;
      else saidas += centavos;
    }
  }

  return {
    entradas: entradas / 100,
    saidas: saidas / 100,
    saldo: (entradas - saidas) / 100,
    aReceber: aReceber / 100,
    aPagar: aPagar / 100,
  };
}
