// Observação de texto livre que vai para o infCpl da NF-e/NFC-e.
//
// A tela de emissão tem um switch para incluir ou não a observação, e o valor
// dele precisa sobreviver até aqui. `undefined` é "a chamada não falou do campo"
// e herda o que está gravado na origem; `null` ou vazio é escolha explícita de
// não levar nada — é como o switch desligado chega ao servidor.
//
// Sem essa distinção, um `|| daOrigem` trata as duas coisas como a mesma e a
// observação da OS/venda entra na nota mesmo com o switch desmarcado.

/** Limite do infCpl que respeitamos desde a montagem do rascunho. */
const LIMITE_INFCPL = 500;

function normalizar(value: string | null | undefined) {
  return value?.trim().slice(0, LIMITE_INFCPL) || null;
}

export function resolverObservacoesFiscais(
  informado: string | null | undefined,
  daOrigem: string | null | undefined,
) {
  if (informado === undefined) return normalizar(daOrigem);
  return normalizar(informado);
}
