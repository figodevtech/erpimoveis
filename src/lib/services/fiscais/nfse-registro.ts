import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Campos de diagnóstico da NFS-e: o JSON que a Focus recebeu, o que ela
 * devolveu e as tentativas recusadas antes desta. Nenhum dos três participa da
 * regra de negócio — existem para que uma rejeição opaca possa ser lida depois
 * sem reemitir em produção.
 */
export type NFSeDiagnostico = {
  payload_enviado?: unknown;
  retorno_bruto?: unknown;
  tentativas?: unknown;
};

/**
 * Grava campos da NFS-e levando o diagnóstico de carona.
 *
 * O diagnóstico é carona mesmo: se a coluna ainda não existir — código em
 * produção antes de a migration rodar nos quatro bancos —, regrava só os campos
 * principais em vez de deixar a emissão morrer por causa do log. Devolve o erro
 * da gravação principal, ou null.
 */
export async function atualizarRegistroNFSe(
  registroId: number,
  campos: Record<string, unknown>,
  diagnostico: NFSeDiagnostico = {},
) {
  const extras = Object.fromEntries(
    Object.entries(diagnostico).filter(([, valor]) => valor !== undefined && valor !== null),
  );

  if (Object.keys(extras).length > 0) {
    const { error } = await supabaseAdmin
      .from("nfse")
      .update({ ...campos, ...extras })
      .eq("id", registroId);
    if (!error) return null;
    console.warn("[nfse] Diagnóstico não gravado, seguindo sem ele", error);
  }

  const { error } = await supabaseAdmin.from("nfse").update(campos).eq("id", registroId);
  return error;
}

/**
 * O envio saiu e a resposta não disse o que aconteceu (rede caiu, timeout,
 * HTTP 5xx). A Focus pode ter recebido: marcar REJEITADA liberaria um reenvio
 * com referência nova, e a nota poderia sair duas vezes.
 *
 * A nota fica PROCESSANDO com esta marca e a MESMA referência. A consulta traz
 * o desfecho quando a Focus conhece a referência. Um 404 na consulta não prova
 * nada — pode ser só atraso —, então não libera referência nova. O que resolve
 * é reenviar com a mesma referência: a Focus recusa referência repetida ("Já
 * existe um DPS com esta referência", 422 do `/v2/nfsen`), então o reenvio ou
 * processa o que não chegou, ou confirma que já tinha chegado.
 */
export const CODIGO_RESULTADO_INCERTO = "RESULTADO_INCERTO";

export const MENSAGEM_ENVIO_SEM_RESPOSTA =
  "A Focus não confirmou o recebimento do envio. A nota ficou em processamento com a mesma referência. "
  + "Consulte a nota; se a Focus não a encontrar, use “Reenviar com a mesma referência” — "
  + "a Focus recusa referência repetida, então não há risco de duas notas.";

export function errosDeResultadoIncerto(detalhe: string) {
  return [{
    codigo: CODIGO_RESULTADO_INCERTO,
    mensagem: MENSAGEM_ENVIO_SEM_RESPOSTA,
    correcao: detalhe || null,
  }];
}

export function temResultadoIncerto(erros: unknown): boolean {
  return Array.isArray(erros) && erros.some((erro) =>
    erro && typeof erro === "object" && (erro as Record<string, unknown>).codigo === CODIGO_RESULTADO_INCERTO,
  );
}

/**
 * Falha do `fetch` em si: a requisição pode ou não ter chegado. O undici lança
 * TypeError "fetch failed"; outro TypeError é erro de código, antes do envio.
 */
export function falhaDeRedeNoEnvio(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  if (erro.name === "AbortError" || erro.name === "TimeoutError") return true;
  return erro.name === "TypeError" && /fetch failed|network/i.test(erro.message);
}

/** Uma tentativa de envio que a prefeitura recusou, guardada para diagnóstico. */
export type NFSeTentativaArquivada = {
  referencia: unknown;
  status: unknown;
  erros: unknown;
  payload_enviado: unknown;
  retorno_bruto: unknown;
  registrada_em: string;
};

/**
 * O reenvio acontece na própria nota rejeitada, então a tentativa recusada seria
 * sobrescrita pela nova. Cada `retorno_bruto` vai até 20 mil caracteres, e uma
 * nota pode ser reenviada muitas vezes numa instabilidade da prefeitura — daí o
 * teto: fica o histórico recente, não a linha crescendo sem fim.
 */
// Com cada interação externa registrada (envio, cada consulta, cancelamento),
// o histórico cresce mais rápido que quando só os reenvios eram arquivados.
// As respostas da Focus costumam ter menos de 1 KB; o corte por item (20 mil
// caracteres) segue valendo.
const LIMITE_TENTATIVAS_ARQUIVADAS = 40;

/**
 * Arquiva a tentativa recusada e devolve o novo histórico da nota.
 *
 * O array vem da mais antiga para a mais recente. Uma linha gravada antes da
 * migration traz `tentativas` nulo — e valor de outro tipo, se alguém mexer no
 * banco à mão —, então o histórico anterior só é aproveitado quando é mesmo uma
 * lista; nunca vale derrubar um reenvio por causa do diagnóstico.
 */
export function arquivarTentativaNFSe(
  origem: {
    referencia?: unknown;
    status?: unknown;
    erros?: unknown;
    payload_enviado?: unknown;
    retorno_bruto?: unknown;
    updatedat?: unknown;
    tentativas?: unknown;
  },
  limite: number = LIMITE_TENTATIVAS_ARQUIVADAS,
): NFSeTentativaArquivada[] {
  const anteriores = Array.isArray(origem.tentativas)
    ? (origem.tentativas as NFSeTentativaArquivada[])
    : [];

  const recusada: NFSeTentativaArquivada = {
    referencia: origem.referencia ?? null,
    status: origem.status ?? null,
    erros: origem.erros ?? null,
    payload_enviado: origem.payload_enviado ?? null,
    retorno_bruto: origem.retorno_bruto ?? null,
    registrada_em: typeof origem.updatedat === "string" ? origem.updatedat : new Date().toISOString(),
  };

  return [...anteriores, recusada].slice(-limite);
}

/**
 * Uma chamada externa da NFS-e, como foi: o que saiu, o que voltou e quando.
 *
 * `retorno_bruto` guarda só a resposta mais recente — na nota 139 da Demir ele
 * acabou com a consulta GET, e o retorno do POST da emissão se perdeu. Este
 * registro vai para `tentativas` e nunca é sobrescrito. Não há segredo aqui: o
 * token vai no cabeçalho, nunca na URL nem no corpo.
 */
export type NFSeInteracao = {
  tipo: "EMISSAO" | "REENVIO" | "CONSULTA" | "CANCELAMENTO";
  metodo: string;
  url: string;
  referencia: string | null;
  payload?: unknown;
  http_status: number;
  resposta: unknown;
  timestamp: string;
};

/** Monta a interação a partir do `retornoBruto` que o NFSeService devolve. */
export function interacaoNFSe(
  tipo: NFSeInteracao["tipo"],
  referencia: string | null,
  retornoBruto: { requisicao?: { metodo?: string; url?: string }; http_status?: number; recebido_em?: string; corpo?: unknown } | null | undefined,
  payload?: unknown,
): NFSeInteracao | null {
  if (!retornoBruto) return null;
  return {
    tipo,
    metodo: String(retornoBruto.requisicao?.metodo ?? ""),
    url: String(retornoBruto.requisicao?.url ?? ""),
    referencia,
    ...(payload !== undefined ? { payload } : {}),
    http_status: Number(retornoBruto.http_status ?? 0),
    resposta: retornoBruto.corpo ?? null,
    timestamp: String(retornoBruto.recebido_em ?? new Date().toISOString()),
  };
}

/**
 * Acrescenta a interação ao fim do histórico, em ordem cronológica. Tolera a
 * coluna nula ou com lixo, como `arquivarTentativaNFSe`.
 */
export function acrescentarInteracaoNFSe(
  tentativas: unknown,
  interacao: NFSeInteracao | null,
  limite: number = LIMITE_TENTATIVAS_ARQUIVADAS,
): unknown[] {
  const anteriores = Array.isArray(tentativas) ? tentativas : [];
  return interacao ? [...anteriores, interacao].slice(-limite) : anteriores;
}

/**
 * Grava a interação em `tentativas` lendo o histórico atual. É diagnóstico:
 * falha aqui vira aviso no log e nunca derruba consulta nem cancelamento.
 */
export async function registrarInteracaoNFSe(registroId: number, interacao: NFSeInteracao | null) {
  if (!interacao) return;
  try {
    const { data, error } = await supabaseAdmin
      .from("nfse")
      .select("tentativas")
      .eq("id", registroId)
      .maybeSingle();
    if (error) throw error;
    const { error: updateError } = await supabaseAdmin
      .from("nfse")
      .update({ tentativas: acrescentarInteracaoNFSe(data?.tentativas, interacao) })
      .eq("id", registroId);
    if (updateError) throw updateError;
  } catch (erro) {
    console.warn("[nfse] Interação não registrada em tentativas", erro);
  }
}
