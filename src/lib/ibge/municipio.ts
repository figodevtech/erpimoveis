import municipiosPorUf from "@/data/municipios-por-uf.json";
import { getCodigoUF } from "@/lib/nfe/ufUtils";

type MunicipioIbgeResponse = {
  id?: number;
  nome?: string;
};

/**
 * Nome como o IBGE escreve ("João Pessoa"); só resposta válida entra. Nasce
 * com o dataset embutido (o mesmo do combo de cidade): o serviço do IBGE cai
 * com frequência, e quando caía a emissão de NF-e parava com "fetch failed"
 * (Jean Car, out/2026). A consulta online fica só para código fora da lista.
 */
const municipioCache = new Map<string, string>(
  Object.values(municipiosPorUf as Record<string, Array<{ id: number; nome: string }>>)
    .flat()
    .map((municipio) => [String(municipio.id), municipio.nome] as const),
);

function codigoDoMunicipio(codigo: string) {
  const codigoNormalizado = String(codigo ?? "").replace(/\D/g, "");
  if (codigoNormalizado.length !== 7) {
    throw new Error("Código IBGE do município deve possuir 7 dígitos.");
  }
  return codigoNormalizado;
}

async function buscarNomeOficial(codigoNormalizado: string): Promise<string> {
  const cached = municipioCache.get(codigoNormalizado);
  if (cached) return cached;

  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigoNormalizado}`,
    { cache: "force-cache", signal: AbortSignal.timeout(10_000) }
  ).catch(() => {
    throw new Error(
      `Código IBGE ${codigoNormalizado} não está na lista de municípios do sistema, e o IBGE não respondeu para confirmá-lo. Revise o código do município ou tente novamente em instantes.`,
    );
  });
  if (!response.ok) {
    throw new Error(`Código IBGE ${codigoNormalizado} não foi encontrado.`);
  }

  const municipio = (await response.json()) as MunicipioIbgeResponse;
  const nome = String(municipio.nome ?? "").trim();
  if (String(municipio.id ?? "") !== codigoNormalizado || !nome) {
    throw new Error(`Resposta inválida do IBGE para o município ${codigoNormalizado}.`);
  }

  municipioCache.set(codigoNormalizado, nome);
  return nome;
}

/** Nome no formato dos documentos fiscais: maiúsculo e sem acento ("JOAO PESSOA"). */
export async function resolverNomeMunicipioIbge(codigo: string, uf?: string | null): Promise<string> {
  const codigoNormalizado = codigoDoMunicipio(codigo);

  if (uf && codigoNormalizado.slice(0, 2) !== getCodigoUF(uf)) {
    throw new Error(`Código IBGE ${codigoNormalizado} não pertence à UF ${uf.toUpperCase()}.`);
  }

  const nome = await buscarNomeOficial(codigoNormalizado);
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/** Nome para texto corrido, como o IBGE escreve ("João Pessoa"). */
export async function nomeOficialMunicipioIbge(codigo: string): Promise<string> {
  return buscarNomeOficial(codigoDoMunicipio(codigo));
}

function chaveDeNome(nome: unknown) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

const codigoPorUfENome = new Map<string, string>(
  Object.entries(municipiosPorUf as Record<string, Array<{ id: number; nome: string }>>).flatMap(([uf, municipios]) =>
    municipios.map((municipio) => [`${uf}|${chaveDeNome(municipio.nome)}`, String(municipio.id)] as const),
  ),
);

/**
 * Código IBGE a partir de cidade e UF, como o combo de cidade do cadastro faz.
 * O nome é único dentro da UF; a comparação ignora acento, caixa e pontuação
 * ("JOAO PESSOA" = "João Pessoa"). Nome que não bate exatamente fica sem
 * código — nunca se adivinha município parecido.
 */
export function codigoMunicipioIbgePorNome(nome: unknown, uf: unknown): string | null {
  const sigla = String(uf ?? "").trim().toUpperCase().replace(/^BR-/, "");
  const chave = chaveDeNome(nome);
  if (sigla.length !== 2 || !chave) return null;
  return codigoPorUfENome.get(`${sigla}|${chave}`) ?? null;
}
