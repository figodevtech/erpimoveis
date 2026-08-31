/**
 * Regras de negocio compartilhadas pela Central Pessoal.
 *
 * O modulo trabalha no fuso da oficina (Fortaleza, UTC-3) e usa intervalos
 * semiabertos: o inicio entra e a meia-noite seguinte ao fim fica de fora.
 */
const FORTALEZA_OFFSET = "-03:00";
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const STATUS_OS_FINALIZADAS = ["PAGAMENTO", "CONCLUIDO"] as const;
export const STATUS_VENDAS_REALIZADAS = ["PAGAMENTO", "FINALIZADA"] as const;
export const STATUS_OS_EM_EXECUCAO = ["EM_ANDAMENTO"] as const;

export type PeriodoConsulta = {
  inicio: string | null;
  fimExclusivo: string | null;
};

export type TextosServico = {
  descricao: string;
  subdescricao: string | null;
};

function textoNaoVazio(value: unknown): string | null {
  if (value == null) return null;
  const texto = String(value).trim();
  return texto || null;
}

function mesmoTexto(a: string, b: string): boolean {
  return a.toLocaleLowerCase("pt-BR") === b.toLocaleLowerCase("pt-BR");
}

/**
 * Separa o titulo do cadastro da descricao complementar gravada na linha da OS.
 * Quando o cadastro nao existe mais, o complemento ainda e a melhor descricao
 * disponivel e passa a ocupar o titulo.
 */
export function resolverTextosServico(
  tituloCadastrado: unknown,
  descricaoDaOs: unknown,
  fallback: string,
): TextosServico {
  const titulo = textoNaoVazio(tituloCadastrado);
  const complemento = textoNaoVazio(descricaoDaOs);

  if (!titulo) {
    return {
      descricao: complemento ?? fallback,
      subdescricao: null,
    };
  }

  return {
    descricao: titulo,
    subdescricao: complemento && !mesmoTexto(titulo, complemento) ? complemento : null,
  };
}

function dataValida(value: string): boolean {
  const match = DATA_ISO.exec(value);
  if (!match) return false;

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function diaSeguinte(value: string): string {
  const [ano, mes, dia] = value.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + 1));
  return data.toISOString().slice(0, 10);
}

/** Converte `de`/`ate` (YYYY-MM-DD) para limites no fuso da oficina. */
export function parsePeriodo(searchParams: URLSearchParams): PeriodoConsulta {
  const de = (searchParams.get("de") ?? "").trim();
  const ate = (searchParams.get("ate") ?? "").trim();

  return {
    inicio: dataValida(de) ? `${de}T00:00:00.000${FORTALEZA_OFFSET}` : null,
    fimExclusivo: dataValida(ate)
      ? `${diaSeguinte(ate)}T00:00:00.000${FORTALEZA_OFFSET}`
      : null,
  };
}

