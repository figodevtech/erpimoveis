import { getCodigoUF } from "@/lib/nfe/ufUtils";

type MunicipioIbgeResponse = {
  id?: number;
  nome?: string;
};

/** Nome como o IBGE escreve ("João Pessoa"); só resposta válida entra. */
const municipioCache = new Map<string, string>();

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
  );
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
