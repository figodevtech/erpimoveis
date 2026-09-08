import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPaymentMethodValues } from "@/lib/payment-methods-server";
import { normalizarTexto, somarDias } from "@/lib/financeiro/ofx/normalize";
import { calcularFingerprints, hashDoArquivo } from "@/lib/financeiro/ofx/fingerprint";
import {
  analisarMovimento,
  type AnaliseDeMovimento,
  type CandidatoTransacao,
} from "@/lib/financeiro/ofx/matcher";
import { decodificarOfx, parseOfx, saldoInicialCentavos } from "@/lib/financeiro/ofx/parser";
import { sugerirMetodoPagamento } from "@/lib/financeiro/ofx/payment-method";
import { ErroDeOfx, type OfxExtrato, type OfxMovimento } from "@/lib/financeiro/ofx/types";

/**
 * A parte da conciliação que fala com o banco de dados: ler o arquivo enviado,
 * carregar os candidatos e montar o que a tela mostra.
 *
 * A decisão de negócio de cada linha continua em `matcher.ts`, que é puro. Aqui
 * só se busca o que ele precisa.
 */

/** Quanto antes e depois do extrato ainda pode existir um título correspondente. */
const FOLGA_EM_DIAS = 15;

/** Teto de arquivo aceito. Extrato de um mês tem alguns KB; 5 MB é folga larga. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

const CAMPOS_CANDIDATO = [
  "id",
  "descricao",
  "descricao_pagamento",
  "nomepagador",
  "valor",
  "valorLiquido",
  "valor_descontos",
  "valor_baixado",
  "tipo",
  "pendente",
  "abonado",
  "banco_id",
  "metodopagamento",
  "data",
  "data_dia",
  "vencimento_em",
  "adiantamento_id",
  "eh_adiantamento",
  "transferencia_id",
  "baixa_de_transacao_id",
  "pagamento_multiplo_id",
  "ordemservicoid",
  "vendaid",
].join(", ");

export interface ContaBancaria {
  id: number;
  titulo: string;
  agencia: string | null;
  contanumero: string | null;
  tipo: string | null;
}

export interface ArquivoLido {
  nome: string;
  hash: string;
  extrato: OfxExtrato;
  fingerprints: string[];
  saldoInicialCentavos: number | null;
}

export interface MovimentoAnalisado extends OfxMovimento {
  fingerprint: string;
  analise: AnaliseDeMovimento;
  metodoSugerido: string | null;
  /** Já existe na conta por uma importação anterior. */
  jaImportado: boolean;
  /** O id do movimento gravado, quando ele já existe. */
  movimentoId: number | null;
  /** Situação daquele movimento já gravado: PENDENTE, CONCILIADO ou IGNORADO. */
  statusGravado: string | null;
}

/**
 * Lê o arquivo enviado no formulário.
 *
 * Recusas com `ErroDeOfx` são conversa com o usuário (arquivo errado, extrato
 * vazio, moeda estrangeira) e viram 400 na rota.
 */
export async function lerArquivoEnviado(formData: FormData): Promise<ArquivoLido> {
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    throw new ErroDeOfx("Selecione o arquivo OFX do extrato.");
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    throw new ErroDeOfx("O arquivo é grande demais para um extrato OFX.");
  }

  const buffer = new Uint8Array(await arquivo.arrayBuffer());
  const extrato = parseOfx(decodificarOfx(buffer));

  const moeda = normalizarTexto(extrato.cabecalho.moeda);
  if (moeda && moeda !== "BRL") {
    throw new ErroDeOfx(`O extrato está em ${extrato.cabecalho.moeda}; o sistema concilia apenas em reais.`);
  }

  return {
    nome: arquivo.name || "extrato.ofx",
    hash: hashDoArquivo(buffer),
    extrato,
    fingerprints: calcularFingerprints(extrato),
    saldoInicialCentavos: saldoInicialCentavos(extrato),
  };
}

/** As contas bancárias cadastradas, para escolher e para pré-selecionar. */
export async function carregarContas(): Promise<ContaBancaria[]> {
  const { data, error } = await supabaseAdmin
    .from("bancoconta")
    .select("id, titulo, agencia, contanumero, tipo")
    .order("titulo", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ContaBancaria[];
}

/** Só os dígitos: agência e conta são escritas com traço, ponto e zero à esquerda. */
function digitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D+/g, "").replace(/^0+/, "");
}

/**
 * A conta do ERP que corresponde ao cabeçalho do extrato.
 *
 * Compara `BRANCHID`/`ACCTID` com `bancoconta.agencia`/`contanumero` só pelos
 * dígitos. Devolve `null` quando não há uma resposta única — a tela sempre
 * deixa confirmar ou trocar, e chutar aqui levaria alguém a conciliar o extrato
 * de uma conta contra os movimentos de outra.
 */
export function sugerirConta(
  extrato: OfxExtrato,
  contas: ContaBancaria[],
): ContaBancaria | null {
  const conta = digitos(extrato.cabecalho.acctId);
  if (!conta) return null;
  const agencia = digitos(extrato.cabecalho.branchId);

  const porContaEAgencia = contas.filter(
    (item) => digitos(item.contanumero) === conta && (!agencia || digitos(item.agencia) === agencia),
  );
  if (porContaEAgencia.length === 1) return porContaEAgencia[0];

  const porConta = contas.filter((item) => digitos(item.contanumero) === conta);
  return porConta.length === 1 ? porConta[0] : null;
}

/**
 * As transações que podem corresponder a alguma linha do extrato.
 *
 * Uma consulta só para o período inteiro, e a comparação linha a linha acontece
 * em memória: são poucas centenas de registros, e ir ao banco por movimento
 * seria trinta e quatro viagens para responder a mesma pergunta.
 *
 * Título pendente entra mesmo sem banco — conta a pagar nasce sem conta, e a
 * conta é justamente o que a baixa vai definir.
 */
export async function carregarCandidatos(
  bancoId: number,
  periodoInicio: string,
  periodoFim: string,
): Promise<CandidatoTransacao[]> {
  const de = somarDias(periodoInicio, -FOLGA_EM_DIAS);
  const ate = somarDias(periodoFim, FOLGA_EM_DIAS);

  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select(CAMPOS_CANDIDATO)
    .eq("is_deleted", false)
    .gte("data_dia", de)
    .lte("data_dia", ate)
    .or(`banco_id.eq.${bancoId},pendente.eq.true`)
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as unknown as CandidatoTransacao[];
}

/** Os movimentos que já existem nesta conta, por fingerprint. */
export async function carregarJaImportados(
  bancoId: number,
  fingerprints: string[],
): Promise<Map<string, { id: number; status: string; importacao_id: number }>> {
  const mapa = new Map<string, { id: number; status: string; importacao_id: number }>();
  if (fingerprints.length === 0) return mapa;

  // Em lotes: uma lista de trezentos fingerprints de 64 caracteres estoura o
  // tamanho de URL que o PostgREST aceita.
  const lote = 100;
  for (let inicio = 0; inicio < fingerprints.length; inicio += lote) {
    const fatia = fingerprints.slice(inicio, inicio + lote);
    const { data, error } = await supabaseAdmin
      .from("ofx_movimento")
      .select("id, fingerprint, status, importacao_id")
      .eq("banco_id", bancoId)
      .in("fingerprint", fatia);

    if (error) throw error;
    for (const linha of data ?? []) {
      mapa.set(String(linha.fingerprint), {
        id: Number(linha.id),
        status: String(linha.status),
        importacao_id: Number(linha.importacao_id),
      });
    }
  }

  return mapa;
}

/** O arquivo já foi importado nesta conta? */
export async function buscarImportacaoPorHash(bancoId: number, hash: string) {
  const { data, error } = await supabaseAdmin
    .from("ofx_importacao")
    .select("id, arquivo_nome, created_at")
    .eq("banco_id", bancoId)
    .eq("arquivo_hash", hash)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/**
 * A análise completa do extrato contra o financeiro de uma conta.
 *
 * Não escreve nada. É esta função que a etapa de preview usa, e é ela também
 * que reconstrói as sugestões quando o usuário reabre uma importação antiga
 * para resolver o que ficou pendente.
 */
export async function analisarExtrato(
  arquivo: ArquivoLido,
  bancoId: number,
): Promise<MovimentoAnalisado[]> {
  const { extrato, fingerprints } = arquivo;
  const periodoInicio = extrato.cabecalho.periodoInicio ?? extrato.movimentos[0].dataPostagem;
  const periodoFim =
    extrato.cabecalho.periodoFim ?? extrato.movimentos[extrato.movimentos.length - 1].dataPostagem;

  const [candidatos, jaImportados, metodos] = await Promise.all([
    carregarCandidatos(bancoId, periodoInicio, periodoFim),
    carregarJaImportados(bancoId, fingerprints),
    getPaymentMethodValues(),
  ]);

  /*
   * Uma transação só responde por um movimento. Sem retirar da lista o que já
   * foi conciliado, dois débitos iguais no mesmo dia receberiam a MESMA
   * sugestão, e o segundo só descobriria o conflito ao gravar.
   */
  const jaConciliadas = await carregarTransacoesConciliadas(bancoId, periodoInicio, periodoFim);
  const disponiveis = candidatos.filter((candidato) => !jaConciliadas.has(candidato.id));

  return extrato.movimentos.map((movimento, indice) => {
    const fingerprint = fingerprints[indice];
    const gravado = jaImportados.get(fingerprint) ?? null;

    return {
      ...movimento,
      fingerprint,
      analise: analisarMovimento(movimento, disponiveis, bancoId),
      metodoSugerido: sugerirMetodoPagamento(movimento, metodos),
      jaImportado: gravado != null,
      movimentoId: gravado?.id ?? null,
      statusGravado: gravado?.status ?? null,
    };
  });
}

/** Transações desta conta que já respondem por algum movimento de extrato. */
export async function carregarTransacoesConciliadas(
  bancoId: number,
  periodoInicio: string,
  periodoFim: string,
): Promise<Set<number>> {
  const { data, error } = await supabaseAdmin
    .from("ofx_movimento")
    .select("transacao_id, titulo_origem_id")
    .eq("banco_id", bancoId)
    .eq("status", "CONCILIADO")
    .gte("data_postagem", somarDias(periodoInicio, -FOLGA_EM_DIAS))
    .lte("data_postagem", somarDias(periodoFim, FOLGA_EM_DIAS));

  if (error) throw error;

  const ids = new Set<number>();
  for (const linha of data ?? []) {
    if (linha.transacao_id != null) ids.add(Number(linha.transacao_id));
    // O título de uma baixa PARCIAL continua em aberto e pode receber outro
    // movimento — por isso só o título de baixa integral sai da lista, e essa
    // linha já saiu junto com `transacao_id`.
  }
  return ids;
}

/** Os números que a tela mostra no cabeçalho da análise. */
export function resumoDoExtrato(movimentos: MovimentoAnalisado[]) {
  const creditos = movimentos.filter((movimento) => movimento.valorCentavos > 0);
  const debitos = movimentos.filter((movimento) => movimento.valorCentavos < 0);

  const conta = (situacao: string) =>
    movimentos.filter((movimento) => movimento.analise.situacao === situacao).length;

  return {
    quantidade: movimentos.length,
    creditos: creditos.length,
    debitos: debitos.length,
    totalCreditosCentavos: creditos.reduce((total, item) => total + item.valorCentavos, 0),
    totalDebitosCentavos: debitos.reduce((total, item) => total + item.valorCentavos, 0),
    encontrados: conta("MATCH_EXATO"),
    provaveis: conta("MATCH_PROVAVEL"),
    ambiguos: conta("AMBIGUO"),
    novos: conta("SEM_CORRESPONDENCIA"),
    revisaoManual: conta("REVISAO_MANUAL"),
    jaImportados: movimentos.filter((movimento) => movimento.jaImportado).length,
  };
}

/** Uma linha de `ofx_movimento` como ela sai do banco. */
export interface MovimentoGravado {
  id: number;
  sequencia: number;
  fitid: string | null;
  checknum: string | null;
  refnum: string | null;
  tipo_ofx: string | null;
  data_postagem: string;
  data_disponivel: string | null;
  valor: number | string;
  valor_centavos: number | string;
  nome: string | null;
  memo: string | null;
  fingerprint: string;
  status: string;
  situacao_analise: string | null;
  score_match: number | null;
  acao_conciliacao: string | null;
  observacao: string | null;
  transacao_id: number | null;
  titulo_origem_id: number | null;
  conciliado_em: string | null;
  conciliado_por: string | null;
}

/** A linha gravada de volta na forma que o matcher entende. */
function comoMovimentoDoArquivo(linha: MovimentoGravado): OfxMovimento {
  return {
    sequencia: linha.sequencia,
    tipoOfx: linha.tipo_ofx,
    dataPostagem: String(linha.data_postagem).slice(0, 10),
    dataDisponivel: linha.data_disponivel ? String(linha.data_disponivel).slice(0, 10) : null,
    valorCentavos: Number(linha.valor_centavos),
    fitid: linha.fitid,
    checknum: linha.checknum,
    refnum: linha.refnum,
    nome: linha.nome,
    memo: linha.memo,
  };
}

/**
 * Refaz as sugestões de uma importação já gravada.
 *
 * A análise é recalculada em vez de lida do banco de propósito: entre a
 * importação e a volta do usuário, títulos foram baixados, criados e excluídos.
 * Mostrar a sugestão congelada de ontem levaria alguém a liquidar um título que
 * já foi pago por outro caminho. O que fica guardado (`situacao_analise`,
 * `score_match`) é histórico do que a importação viu na hora.
 */
export async function reanalisarMovimentosGravados(
  bancoId: number,
  linhas: MovimentoGravado[],
): Promise<Array<MovimentoGravado & { analise: AnaliseDeMovimento; metodoSugerido: string | null }>> {
  const pendentes = linhas.filter((linha) => linha.status === "PENDENTE");
  if (pendentes.length === 0) {
    return linhas.map((linha) => ({
      ...linha,
      analise: {
        situacao: (linha.situacao_analise as AnaliseDeMovimento["situacao"]) ?? "SEM_CORRESPONDENCIA",
        score: linha.score_match ?? 0,
        sugestoes: [],
        acaoSugerida: null,
        observacao: linha.observacao,
      },
      metodoSugerido: null,
    }));
  }

  const datas = pendentes.map((linha) => String(linha.data_postagem).slice(0, 10)).sort();
  const [candidatos, conciliadas, metodos] = await Promise.all([
    carregarCandidatos(bancoId, datas[0], datas[datas.length - 1]),
    carregarTransacoesConciliadas(bancoId, datas[0], datas[datas.length - 1]),
    getPaymentMethodValues(),
  ]);
  const disponiveis = candidatos.filter((candidato) => !conciliadas.has(candidato.id));

  return linhas.map((linha) => {
    if (linha.status !== "PENDENTE") {
      return {
        ...linha,
        analise: {
          situacao: (linha.situacao_analise as AnaliseDeMovimento["situacao"]) ?? "SEM_CORRESPONDENCIA",
          score: linha.score_match ?? 0,
          sugestoes: [],
          acaoSugerida: null,
          observacao: linha.observacao,
        },
        metodoSugerido: null,
      };
    }

    const movimento = comoMovimentoDoArquivo(linha);
    return {
      ...linha,
      analise: analisarMovimento(movimento, disponiveis, bancoId),
      metodoSugerido: sugerirMetodoPagamento(movimento, metodos),
    };
  });
}
