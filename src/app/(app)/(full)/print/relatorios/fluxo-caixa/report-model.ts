// Regra das somas do relatório de fluxo de caixa, fora do JSX para ser testada.
//
// O PDF precisa dizer o mesmo que a aba Fluxo da lista e o dashboard financeiro.
// Ele somava `valor` de toda linha do período: título ainda pendente, título
// quitado por antecipação (sem banco, cujo dinheiro já entrou pelo adiantamento)
// e o bruto das vendas no cartão. No Demir, de 01 a 14/09/2026, imprimia
// R$ 329.970,64 de entradas contra R$ 235.836,35 das outras duas telas.

import { saldosAposCadaMovimento, valorAssinadoNoBanco } from "@/lib/financeiro/saldo-bancario";
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

export type TotaisDoFluxo = ReturnType<typeof totalizarFluxo>;

/* -------------------------------------------------------------------------
 * Agrupamento por banco, com o saldo da conta depois de cada lançamento.
 * ----------------------------------------------------------------------- */

/** O que o saldo de uma conta precisa saber de cada movimento. */
export type MovimentoDoBanco = Pick<LinhaDoFluxo, "tipo" | "valor" | "valorLiquido" | "valor_descontos"> & {
  id: number;
};

function assinado(movimento: Pick<LinhaDoFluxo, "tipo" | "valor" | "valorLiquido" | "valor_descontos">) {
  return valorAssinadoNoBanco(String(movimento.tipo ?? ""), valorLiquidoEfetivo(movimento));
}

/**
 * Saldo da conta depois de cada movimento liquidado, por id.
 *
 * O acúmulo é o da tela de bancos (`saldosAposCadaMovimento`): a história
 * inteira da conta, na ordem do extrato, a partir do valor inicial. O valor de
 * cada movimento, porém, é o da coluna Valor desta folha (`valorLiquidoEfetivo`)
 * — é o que faz saldo anterior ± valor dar o saldo da linha, que é a conta que
 * quem confere o papel refaz de cabeça.
 */
export function saldosDoBanco(valorInicial: number, movimentosEmOrdem: MovimentoDoBanco[]) {
  return saldosAposCadaMovimento(
    valorInicial,
    movimentosEmOrdem.map((movimento) => ({ id: Number(movimento.id), valorAssinado: assinado(movimento) })),
  );
}

export type LinhaAgrupavel = LinhaDoFluxo & { id: number };

export type ContaDoGrupo = { titulo: string; detalhe?: string };

export type GrupoDeBanco<L extends LinhaAgrupavel> = {
  /** Nulo no grupo dos títulos sem conta. */
  bancoId: number | null;
  titulo: string;
  detalhe: string;
  /** Saldo antes do primeiro movimento listado; nulo se o grupo não movimentou a conta. */
  saldoAnterior: number | null;
  /** Saldo depois do último movimento listado. */
  saldoFinal: number | null;
  /** Título em aberto não mexeu no dinheiro: `saldoApos` nulo. */
  linhas: Array<{ linha: L; saldoApos: number | null }>;
  totais: TotaisDoFluxo;
};

/**
 * As linhas da folha, por conta, cada uma com o saldo da conta logo depois dela.
 *
 * `saldosPorBanco` vem da história inteira de cada conta, e não do recorte: com
 * o período começando em setembro, o saldo anterior já inclui agosto; com um
 * tipo filtrado, o saldo entre duas linhas pula o que o filtro escondeu. É o
 * saldo real da conta, o mesmo da tela de bancos.
 *
 * As linhas mantêm a ordem recebida, que precisa ser a do extrato.
 */
export function agruparPorBanco<L extends LinhaAgrupavel>(
  linhas: L[],
  contas: Map<number, ContaDoGrupo>,
  saldosPorBanco: Map<number, Map<number, number>>,
): GrupoDeBanco<L>[] {
  const porBanco = new Map<number | null, L[]>();
  for (const linha of linhas) {
    const chave = linha.banco_id == null ? null : Number(linha.banco_id);
    const lista = porBanco.get(chave) ?? [];
    lista.push(linha);
    porBanco.set(chave, lista);
  }

  const grupos = [...porBanco].map(([bancoId, doBanco]): GrupoDeBanco<L> => {
    const saldos = bancoId == null ? undefined : saldosPorBanco.get(bancoId);
    const comSaldo = doBanco.map((linha) => ({
      linha,
      saldoApos: linha.pendente ? null : (saldos?.get(Number(linha.id)) ?? null),
    }));
    const movimentos = comSaldo.filter((item) => item.saldoApos != null);
    const primeiro = movimentos[0];
    const conta = bancoId == null ? undefined : contas.get(bancoId);

    return {
      bancoId,
      titulo: bancoId == null ? "Sem banco" : (conta?.titulo ?? `Banco #${bancoId}`),
      detalhe: conta?.detalhe ?? "",
      saldoAnterior: primeiro
        ? Math.round(((primeiro.saldoApos as number) - assinado(primeiro.linha)) * 100) / 100
        : null,
      saldoFinal: movimentos.at(-1)?.saldoApos ?? null,
      linhas: comSaldo,
      totais: totalizarFluxo(doBanco),
    };
  });

  // Contas pelo nome; o que não tem conta — título em aberto — por último.
  return grupos.sort(
    (a, b) =>
      Number(a.bancoId == null) - Number(b.bancoId == null) || a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}

export type ItemDaFolhaAgrupada<L extends LinhaAgrupavel> =
  /** Respiro entre uma conta e a seguinte, na mesma folha. */
  | { tipo: "espaco"; grupo: GrupoDeBanco<L> }
  | { tipo: "banco"; grupo: GrupoDeBanco<L> }
  | { tipo: "linha"; grupo: GrupoDeBanco<L>; linha: L; saldoApos: number | null }
  | { tipo: "subtotal"; grupo: GrupoDeBanco<L> };

/**
 * Distribui os grupos nas folhas. Por padrão, cada item conta como uma linha;
 * o relatório pode informar alturas em milímetros para descrições que quebram.
 *
 * A conta nunca abre no pé da folha sem nada sob ela. Quando atravessa a
 * virada, a tabela continua crua na folha seguinte: sem reabrir o cabeçalho da
 * conta, só as linhas que faltaram e o subtotal.
 *
 * Entre uma conta e a seguinte na mesma folha vai um respiro. Sem medidas
 * específicas, ele conta como uma linha inteira para deixar espaço no papel.
 */
export function paginarAgrupado<L extends LinhaAgrupavel>(
  grupos: GrupoDeBanco<L>[],
  primeira: number,
  demais: number,
  alturaItem: (item: ItemDaFolhaAgrupada<L>) => number = () => 1,
): ItemDaFolhaAgrupada<L>[][] {
  const folhas: ItemDaFolhaAgrupada<L>[][] = [];
  let folha: ItemDaFolhaAgrupada<L>[] = [];
  let usado = 0;
  // Pelo menos duas: o cabeçalho da conta e uma linha sob ela, senão o laço não anda.
  const capacidade = () => Math.max(2, folhas.length === 0 ? primeira : demais);
  const cabe = (altura: number) => usado + altura <= capacidade();
  const adicionar = (item: ItemDaFolhaAgrupada<L>) => {
    folha.push(item);
    usado += alturaItem(item);
  };
  const virar = () => {
    folhas.push(folha);
    folha = [];
    usado = 0;
  };

  for (const grupo of grupos) {
    const espaco: ItemDaFolhaAgrupada<L> = { tipo: "espaco", grupo };
    const banco: ItemDaFolhaAgrupada<L> = { tipo: "banco", grupo };
    const primeiraLinha: ItemDaFolhaAgrupada<L> = grupo.linhas.length
      ? { tipo: "linha", grupo, ...grupo.linhas[0] }
      : { tipo: "subtotal", grupo };
    // Respiro, cabeçalho e uma linha sob ele vão juntos; no topo da folha não
    // há o que separar, e o respiro fica de fora.
    if (folha.length && !cabe(alturaItem(espaco) + alturaItem(banco) + alturaItem(primeiraLinha))) virar();
    if (folha.length) adicionar(espaco);
    adicionar(banco);

    for (const { linha, saldoApos } of grupo.linhas) {
      const item: ItemDaFolhaAgrupada<L> = { tipo: "linha", grupo, linha, saldoApos };
      if (!cabe(alturaItem(item))) virar();
      adicionar(item);
    }

    const subtotal: ItemDaFolhaAgrupada<L> = { tipo: "subtotal", grupo };
    if (!cabe(alturaItem(subtotal))) virar();
    adicionar(subtotal);
  }

  if (folha.length || !folhas.length) folhas.push(folha);
  return folhas;
}
