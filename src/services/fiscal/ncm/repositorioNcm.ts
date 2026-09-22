import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  classificarBuscaNcm,
  limparDescricaoNcm,
  normalizarCodigoNcm,
  ordenarResultadoNcm,
  prefixoDeSugestaoNcm,
  type NcmItem,
} from "@/lib/fiscal/ncm";

/**
 * Consulta ao catálogo de NCM. A tabela tem RLS sem policy para authenticated:
 * o acesso é sempre por aqui, no servidor, com a permissão já conferida pela
 * rota que chamou.
 */

const COLUNAS =
  "codigo, descricao, caminho, vigencia_inicio, vigencia_fim, ato, fonte, fonte_url";

/** Teto do que uma busca devolve. 10.515 linhas nunca vão para o navegador. */
export const LIMITE_PADRAO_NCM = 20;
export const LIMITE_MAXIMO_NCM = 50;

type NcmRow = {
  codigo: string;
  descricao: string;
  caminho: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ato: string | null;
  fonte: string | null;
  fonte_url: string | null;
};

function paraItem(row: NcmRow): NcmItem {
  return {
    // char(8) do Postgres pode vir com espaço à direita.
    codigo: String(row.codigo).trim(),
    descricao: limparDescricaoNcm(row.descricao),
    caminho: row.caminho ? limparDescricaoNcm(row.caminho) : null,
    vigenciaInicio: row.vigencia_inicio ? String(row.vigencia_inicio).slice(0, 10) : null,
    vigenciaFim: row.vigencia_fim ? String(row.vigencia_fim).slice(0, 10) : null,
    ato: row.ato,
    fonte: row.fonte,
    fonteUrl: row.fonte_url,
  };
}

export type ResultadoBuscaNcm = {
  itens: NcmItem[];
  /** Preenchido quando o termo era um código de 8 dígitos que não existe. */
  codigoInexistente: string | null;
  /** Vizinhos da mesma subposição, quando o código não existe. */
  sugestoes: NcmItem[];
};

/**
 * Busca por código (exato ou prefixo) ou por trecho da descrição.
 *
 * Código vem antes de texto de propósito: quem digita números quer aquele
 * código, e a consulta por chave é a mais barata que existe nesta tabela.
 */
export async function buscarNcms(params: {
  termo: string;
  data: string;
  limite?: number;
}): Promise<ResultadoBuscaNcm> {
  const limite = Math.min(Math.max(1, params.limite ?? LIMITE_PADRAO_NCM), LIMITE_MAXIMO_NCM);
  const { tipo, codigo, texto, textoOriginal } = classificarBuscaNcm(params.termo);

  if (tipo === "CURTA") return { itens: [], codigoInexistente: null, sugestoes: [] };

  if (tipo === "CODIGO") {
    const itens = await consultar((q) => q.like("codigo", `${codigo}%`), params.data, limite);
    const exato = normalizarCodigoNcm(codigo);

    if (exato && !itens.some((item) => item.codigo === exato)) {
      // Código completo que não existe: em vez de "nenhum resultado", mostra os
      // vizinhos da mesma subposição (6 dígitos do SH). É família de verdade,
      // não semelhança inventada.
      const prefixo = prefixoDeSugestaoNcm(exato);
      const sugestoes = prefixo
        ? await consultar((q) => q.like("codigo", `${prefixo}%`), params.data, limite)
        : [];
      return { itens: [], codigoInexistente: exato, sugestoes };
    }

    return { itens: ordenarResultadoNcm(itens, exato ?? ""), codigoInexistente: null, sugestoes: [] };
  }

  const itens = await buscarPorTexto(texto, textoOriginal, params.data, limite);
  return { itens, codigoInexistente: null, sugestoes: [] };
}

/**
 * Busca por trecho da descrição.
 *
 * O caminho bom usa `descricao_busca`, que o banco mantém sem acento e sem o
 * HTML do portal. Enquanto a migration que cria essa coluna não estiver
 * aplicada, cai num ILIKE sobre a descrição crua: acha menos (quem digitar
 * "injecao" não encontra "injeção"), mas o seletor funciona no dia do deploy
 * em vez de só depois da migration.
 */
async function buscarPorTexto(
  texto: string,
  textoOriginal: string,
  data: string,
  limite: number,
): Promise<NcmItem[]> {
  try {
    return await consultar((q) => q.like("descricao_busca", `%${texto}%`), data, limite);
  } catch (erro) {
    if (!colunaDeBuscaAusente(erro)) throw erro;
    if (!avisouColunaAusente) {
      avisouColunaAusente = true;
      console.warn(
        "[ncm] coluna descricao_busca ausente; busca por texto sem normalização de acento. Aplique a migration 20260922180000.",
      );
    }
    // Aqui vai o texto COMO FOI DIGITADO: a descrição crua tem acento, e
    // procurar "injecao" nela não acharia "injeção".
    return consultar((q) => q.ilike("descricao", `%${textoOriginal}%`), data, limite);
  }
}

let avisouColunaAusente = false;

function colunaDeBuscaAusente(erro: unknown): boolean {
  const mensagem = `${(erro as { message?: string })?.message ?? ""} ${(erro as { code?: string })?.code ?? ""}`;
  return /descricao_busca/.test(mensagem) || /42703|PGRST204|PGRST100/.test(mensagem);
}

/**
 * Descrições de vários códigos de uma vez.
 *
 * Existe para a tela que mostra muitos itens não disparar uma consulta por
 * linha só para escrever o rótulo ao lado do código.
 */
export async function buscarNcmsPorCodigos(codigos: string[]): Promise<NcmItem[]> {
  const unicos = [...new Set(codigos.map((c) => normalizarCodigoNcm(c)).filter((c): c is string => !!c))];
  if (unicos.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("fiscal_ncm")
    .select(COLUNAS)
    .in("codigo", unicos.slice(0, LIMITE_MAXIMO_NCM));

  if (error) throw Object.assign(new Error(error.message ?? "Falha ao consultar fiscal_ncm"), error);
  return (data ?? []).map((row) => paraItem(row as NcmRow));
}

async function consultar(
  filtro: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
  data: string,
  limite: number,
): Promise<NcmItem[]> {
  let consulta = filtro(base());
  if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    consulta = consulta
      .or(`vigencia_inicio.is.null,vigencia_inicio.lte.${data}`)
      .or(`vigencia_fim.is.null,vigencia_fim.gte.${data}`) as typeof consulta;
  }
  const { data: linhas, error } = await consulta.order("codigo", { ascending: true }).limit(limite);
  // O erro do supabase-js é um objeto simples: virava "[object Object]" no log.
  if (error) throw Object.assign(new Error(error.message ?? "Falha ao consultar fiscal_ncm"), error);
  return (linhas ?? []).map((row) => paraItem(row as NcmRow));
}

function base() {
  return supabaseAdmin.from("fiscal_ncm").select(COLUNAS);
}
