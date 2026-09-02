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
const LIMITE_TENTATIVAS_ARQUIVADAS = 10;

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
