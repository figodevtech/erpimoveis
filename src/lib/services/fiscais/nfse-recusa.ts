import {
  MENSAGEM_EMISSOR_NACIONAL_EXIGIDO,
  detectarEmissorMunicipalEncerrado,
  detectarMunicipioForaDoEmissorNacional,
  mensagemForaDoEmissorNacional,
} from "./nfse-politica";

/**
 * O que a resposta de um envio à Focus diz sobre o documento — e o texto que o
 * usuário lê quando ela recusa.
 *
 * A recusa aparece como veio: HTTP, código, mensagem e correção de cada erro,
 * a referência e o ambiente. O complemento do município (E0039, L999) entra
 * depois, como observação, e nunca no lugar do retorno.
 */

/** Resultado de `NFSeTransport.emitir`, no que importa aqui. */
export type EnvioNFSe = {
  ok: boolean;
  message?: string;
  erros?: unknown;
  retornoBruto?: { http_status?: number; corpo?: unknown } | null;
};

/**
 * - ACEITO: a Focus recebeu e devolveu um status (processando, autorizado...);
 * - JA_RECEBIDO: a referência já existe lá — o envio anterior chegou;
 * - INCERTO: a resposta não diz o que aconteceu (5xx, gateway): pode ter chegado;
 * - REJEITADO: recusa explícita (4xx). O documento não existe para esta referência.
 */
export type DesfechoEnvioNFSe = "ACEITO" | "JA_RECEBIDO" | "INCERTO" | "REJEITADO";

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mensagensDe(erros: unknown): string[] {
  const lista = Array.isArray(erros) ? erros : erros ? [erros] : [];
  return lista
    .map((erro) => (erro && typeof erro === "object" ? (erro as Record<string, unknown>).mensagem : erro))
    .filter((valor): valor is string => typeof valor === "string");
}

/**
 * "Já existe um DPS com esta referência." (422 `erro_validacao` do
 * `POST /v2/nfsen`, documentado pela Focus). A referência é única por token:
 * repetir uma que chegou nunca cria um segundo documento.
 */
export function referenciaJaRecebida(envio: Pick<EnvioNFSe, "erros" | "message">): boolean {
  return [...mensagensDe(envio.erros), String(envio.message ?? "")].some((mensagem) => {
    const texto = semAcento(mensagem);
    return texto.includes("ja existe") && texto.includes("referencia");
  });
}

export function desfechoDoEnvioNFSe(envio: EnvioNFSe): DesfechoEnvioNFSe {
  if (envio.ok) return "ACEITO";
  if (referenciaJaRecebida(envio)) return "JA_RECEBIDO";
  const http = Number(envio.retornoBruto?.http_status ?? 0);
  if (!Number.isFinite(http) || http === 0 || http >= 500) return "INCERTO";
  return "REJEITADO";
}

const MUNICIPIOS: Record<string, string> = {
  "2508604": "Lucena/PB",
  "2507507": "João Pessoa/PB",
  "2503209": "Cabedelo/PB",
};

export function nomeDoMunicipioNFSe(codigoMunicipio: unknown): string {
  const codigo = String(codigoMunicipio ?? "").replace(/\D/g, "");
  return MUNICIPIOS[codigo] ?? (codigo ? `IBGE ${codigo}` : "não informado");
}

export function rotuloAmbienteNFSe(ambiente: unknown): "Produção" | "Homologação" {
  return String(ambiente ?? "").toUpperCase() === "PRODUCAO" ? "Produção" : "Homologação";
}

export type RecusaNFSe = {
  provedor: "Focus NFe";
  municipio: string;
  ambiente: "Produção" | "Homologação";
  httpStatus: number | null;
  referencia: string | null;
  erros: Array<{ codigo: string | null; mensagem: string; correcao: string | null }>;
  /** Corpo cru quando a Focus não devolveu `erros` (ex.: 401 em text/html). */
  resposta: string | null;
  /** Complemento do município e orientação de credencial. Nunca substitui o retorno. */
  observacoes: string[];
};

const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");

function errosDaRecusa(erros: unknown): RecusaNFSe["erros"] {
  const lista = Array.isArray(erros) ? erros : erros ? [erros] : [];
  return lista.flatMap((erro) => {
    if (typeof erro === "string") return erro.trim() ? [{ codigo: null, mensagem: erro.trim(), correcao: null }] : [];
    if (!erro || typeof erro !== "object") return [];
    const registro = erro as Record<string, unknown>;
    const mensagem = texto(registro.mensagem) || texto(registro.message);
    if (!mensagem && !texto(registro.codigo)) return [];
    return [{
      codigo: texto(registro.codigo) || null,
      mensagem: mensagem || JSON.stringify(registro).slice(0, 500),
      correcao: texto(registro.correcao) || null,
    }];
  });
}

export function montarRecusaNFSe(entrada: {
  envio: EnvioNFSe;
  referencia: string | null;
  ambiente: unknown;
  codigoMunicipio: unknown;
}): RecusaNFSe {
  const { envio } = entrada;
  const httpStatus = Number(envio.retornoBruto?.http_status ?? 0) || null;
  const erros = errosDaRecusa(envio.erros);
  const corpo = envio.retornoBruto?.corpo;
  const resposta = erros.length > 0
    ? null
    : (typeof corpo === "string" ? corpo.trim() : corpo ? JSON.stringify(corpo) : texto(envio.message)).slice(0, 500) || null;
  const ambiente = rotuloAmbienteNFSe(entrada.ambiente);

  const observacoes: string[] = [];
  if (httpStatus === 401 || httpStatus === 403) {
    observacoes.push(`A Focus recusou a credencial: confira o token da Focus do ambiente ${ambiente} nas configurações fiscais.`);
  }
  const lucena = String(entrada.codigoMunicipio ?? "").replace(/\D/g, "") === "2508604";
  if (detectarMunicipioForaDoEmissorNacional(envio.erros)) observacoes.push(mensagemForaDoEmissorNacional(lucena));
  else if (detectarEmissorMunicipalEncerrado(envio.erros)) observacoes.push(MENSAGEM_EMISSOR_NACIONAL_EXIGIDO);

  return {
    provedor: "Focus NFe",
    municipio: nomeDoMunicipioNFSe(entrada.codigoMunicipio),
    ambiente,
    httpStatus,
    referencia: entrada.referencia,
    erros,
    resposta,
    observacoes,
  };
}

/** O texto da recusa, uma informação por linha. */
export function descreverRecusaNFSe(recusa: RecusaNFSe): string {
  const linhas = [
    "Não foi possível autorizar a NFS-e.",
    `Provedor: ${recusa.provedor}`,
    `Município: ${recusa.municipio}`,
    `Ambiente: ${recusa.ambiente}`,
    `HTTP: ${recusa.httpStatus ?? "sem resposta"}`,
  ];
  if (recusa.referencia) linhas.push(`Referência: ${recusa.referencia}`);
  recusa.erros.forEach((erro, indice) => {
    linhas.push("");
    if (recusa.erros.length > 1) linhas.push(`Rejeição ${indice + 1} de ${recusa.erros.length}`);
    if (erro.codigo) linhas.push(`Código: ${erro.codigo}`);
    linhas.push(`Mensagem: ${erro.mensagem}`);
    if (erro.correcao) linhas.push(`Correção: ${erro.correcao}`);
  });
  if (recusa.resposta) linhas.push("", `Resposta: ${recusa.resposta}`);
  for (const observacao of recusa.observacoes) linhas.push("", `Observação: ${observacao}`);
  return linhas.join("\n");
}
