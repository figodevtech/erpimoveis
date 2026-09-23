import {
  aliquotaInterestadual,
  deveGerarICMSUFDest,
  normalizarUf,
  type DifalPendencia,
} from "@/lib/nfe/difal";
import {
  casarRegrasDifal,
  normalizarCest,
  normalizarNcm,
  type CampoResolvido,
  type ConflitoRegraDifal,
  type OrigemValorDifal,
  type RegraDifal,
} from "@/lib/nfe/difalRegras";

/**
 * O repositório é importado sob demanda: ele puxa `supabaseAdmin`, que exige
 * as chaves do banco já na carga do módulo. Assim a decisão fiscal
 * (`resolverRegraDifalComRegras`) roda em teste sem nenhum ambiente montado —
 * que é como ela deve ser exercitada, com regras na mão e sem rede.
 */
async function carregarRegras(uf: string) {
  const { carregarRegrasDifalPorUf } = await import("./repositorioDifal");
  return carregarRegrasDifalPorUf(uf);
}

async function conferirNcms(codigos: string[]) {
  const { conferirNcmsConhecidos } = await import("./repositorioDifal");
  return conferirNcmsConhecidos(codigos);
}

/**
 * Ponto único de resolução do DIFAL. Venda, OS, saída e NF-e avulsa chegam aqui;
 * nenhuma tela reimplementa a decisão.
 *
 * O que ele devolve é sempre uma resposta sobre o que a fonte fiscal determina —
 * nunca um palpite. Campo que nenhuma regra determinou volta NULL, com a
 * pendência que explica por quê, e quem chamou bloqueia a emissão.
 */

export type EntradaResolucaoDifal = {
  ufEmitente: string;
  ufDestino: string;
  /** Data fiscal do documento (YYYY-MM-DD). */
  dataEmissao: string;
  ncm?: string | null;
  cest?: string | null;
  origemMercadoria?: string | number | null;
  crt?: number | string | null;
  cst?: string | null;
  csosn?: string | null;
  cfop?: string | number | null;
  indFinal?: number | string;
  indIEDest?: number | string;
  tpNF?: number | string;
  finNFe?: number;
  modelo?: number | string | null;
  ufEntrega?: string | null;
  possuiISSQN?: boolean;
};

export type SaidaResolucaoDifal = {
  exigeDifal: boolean;
  /** NULL quando nenhuma regra determinou o valor. */
  aliquotaInterna: number | null;
  aliquotaInterestadual: number | null;
  aliquotaFcp: number | null;
  percentualPartilha: number | null;
  reducaoBase: number | null;

  origemAliquotaInterna: OrigemValorDifal;
  origemFcp: OrigemValorDifal;

  regraAliquotaInterna: CampoResolvido | null;
  regraFcp: CampoResolvido | null;

  conflitos: ConflitoRegraDifal[];
  pendencias: DifalPendencia[];
  /** true quando todos os campos fecharam sem depender de digitação. */
  resolvidoAutomaticamente: boolean;
};

/**
 * Partilha de 100% ao destino desde 2019 (Convênio ICMS 93/2015, cláusula
 * décima, escalonamento encerrado). Não depende de cadastro: é data.
 */
const PARTILHA_DESTINO = 100;

function semDifal(): SaidaResolucaoDifal {
  return {
    exigeDifal: false,
    aliquotaInterna: null,
    aliquotaInterestadual: null,
    aliquotaFcp: null,
    percentualPartilha: null,
    reducaoBase: null,
    origemAliquotaInterna: "NAO_CONFIGURADO",
    origemFcp: "NAO_CONFIGURADO",
    regraAliquotaInterna: null,
    regraFcp: null,
    conflitos: [],
    pendencias: [],
    resolvidoAutomaticamente: true,
  };
}

/**
 * Resolve a partir de regras já carregadas. Separado da função assíncrona para
 * os testes cobrirem a decisão sem tocar no banco, e para uma emissão com
 * vários itens da mesma UF reaproveitar a mesma carga.
 */
export function resolverRegraDifalComRegras(
  entrada: EntradaResolucaoDifal,
  regras: RegraDifal[],
  opcoes?: {
    /**
     * O NCM existe na NCM oficial? `undefined` = catálogo não consultado
     * (tabela fiscal_ncm vazia), e aí vale só a conferência de formato.
     */
    ncmConhecido?: boolean;
  },
): SaidaResolucaoDifal {
  const ufDestino = normalizarUf(entrada.ufDestino);
  const ufEmitente = normalizarUf(entrada.ufEmitente);

  const exige = deveGerarICMSUFDest({
    ufEmitente,
    ufDestinatario: ufDestino,
    indFinal: entrada.indFinal ?? 1,
    indIEDest: entrada.indIEDest ?? 9,
    tpNF: entrada.tpNF ?? 1,
    possuiISSQN: entrada.possuiISSQN,
    cfop: entrada.cfop,
    cst: entrada.cst,
    csosn: entrada.csosn,
    finNFe: entrada.finNFe,
    ufEntrega: entrada.ufEntrega,
    crt: entrada.crt,
    modelo: entrada.modelo,
  });

  if (!exige) return semDifal();

  const dataEmissao = String(entrada.dataEmissao ?? "").slice(0, 10);
  const casamento = casarRegrasDifal(regras, {
    ufDestino,
    dataEmissao,
    ncm: entrada.ncm,
    cest: entrada.cest,
  });

  const ncm = normalizarNcm(entrada.ncm);
  const pendencias: DifalPendencia[] = [];

  if (!ufDestino || !dataEmissao) pendencias.push("CONTEXTO_INCOMPLETO");
  if (!ncm) pendencias.push("NCM_INVALIDO");
  else if (opcoes?.ncmConhecido === false) pendencias.push("NCM_INEXISTENTE");
  if (casamento.conflitos.length > 0) pendencias.push("REGRA_CONFLITANTE");
  if (!casamento.aliquotaInterna) pendencias.push("ALIQUOTA_INTERNA_NAO_DETERMINADA");
  if (!casamento.aliquotaFcp) pendencias.push("FCP_NAO_DETERMINADO");

  // A interestadual não vem de cadastro: sai da origem da mercadoria e da
  // geografia, pelas regras NA09-10/20/30 e pela Resolução do Senado 13/2012.
  const interestadual = aliquotaInterestadual(ufEmitente, ufDestino, entrada.origemMercadoria);

  return {
    exigeDifal: true,
    aliquotaInterna: casamento.aliquotaInterna?.valor ?? null,
    aliquotaInterestadual: interestadual,
    aliquotaFcp: casamento.aliquotaFcp?.valor ?? null,
    percentualPartilha: PARTILHA_DESTINO,
    reducaoBase: casamento.reducaoBase?.valor ?? null,
    origemAliquotaInterna: casamento.aliquotaInterna?.origem ?? "NAO_CONFIGURADO",
    origemFcp: casamento.aliquotaFcp?.origem ?? "NAO_CONFIGURADO",
    regraAliquotaInterna: casamento.aliquotaInterna,
    regraFcp: casamento.aliquotaFcp,
    conflitos: casamento.conflitos,
    pendencias,
    resolvidoAutomaticamente: pendencias.length === 0,
  };
}

/** Carrega as regras da UF de destino e resolve. Usado pelas rotas e serviços. */
export async function resolverRegraDifal(
  entrada: EntradaResolucaoDifal,
): Promise<SaidaResolucaoDifal> {
  const ufDestino = normalizarUf(entrada.ufDestino);
  if (!ufDestino) return semDifal();
  const regras = await carregarRegras(ufDestino);
  const ncm = normalizarNcm(entrada.ncm);
  const conhecidos = ncm ? await conferirNcms([ncm]) : null;
  return resolverRegraDifalComRegras(entrada, regras, {
    ncmConhecido: conhecidos && ncm ? conhecidos.has(ncm) : undefined,
  });
}

/**
 * Resolve vários itens de uma vez. Uma emissão tem uma UF de destino só, então
 * a carga de regras é única para a nota inteira.
 */
export async function resolverRegraDifalEmLote<T extends { id: string }>(
  comum: Omit<EntradaResolucaoDifal, "ncm" | "cest" | "origemMercadoria" | "cfop" | "cst" | "csosn">,
  itens: Array<
    T & Pick<EntradaResolucaoDifal, "ncm" | "cest" | "origemMercadoria" | "cfop" | "cst" | "csosn">
  >,
): Promise<Map<string, SaidaResolucaoDifal>> {
  const ufDestino = normalizarUf(comum.ufDestino);
  const regras = ufDestino ? await carregarRegras(ufDestino) : [];

  // Uma consulta ao catálogo para a nota inteira. `null` = catálogo vazio, e a
  // checagem de existência fica desligada.
  const ncmsDosItens = itens
    .map((item) => normalizarNcm(item.ncm))
    .filter((ncm): ncm is string => ncm !== null);
  const conhecidos = ncmsDosItens.length ? await conferirNcms(ncmsDosItens) : null;

  const resultado = new Map<string, SaidaResolucaoDifal>();
  for (const item of itens) {
    const ncm = normalizarNcm(item.ncm);
    resultado.set(
      item.id,
      resolverRegraDifalComRegras(
        {
          ...comum,
          ncm: item.ncm,
          cest: normalizarCest(item.cest) ?? item.cest,
          origemMercadoria: item.origemMercadoria,
          cfop: item.cfop,
          cst: item.cst,
          csosn: item.csosn,
        },
        regras,
        { ncmConhecido: conhecidos && ncm ? conhecidos.has(ncm) : undefined },
      ),
    );
  }
  return resultado;
}
