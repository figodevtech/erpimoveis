import type { IndIEDest } from './indIEDest';

type RascunhoComDestinatario<T> = T & {
  operacao: { destinoMercadoria: string; consumidorFinal: boolean | null };
  destinatario: { indicadorIe: string; inscricaoEstadual: string };
};

/** Chamada somente pela ação explícita do operador; a abertura da nota não usa isto. */
export function aplicarClassificacaoAtualAoRascunho<T>(
  rascunho: RascunhoComDestinatario<T>,
  cadastro: { indicador: IndIEDest; inscricaoEstadual: string },
): RascunhoComDestinatario<T> {
  return {
    ...rascunho,
    operacao: cadastro.indicador === 9
      ? { ...rascunho.operacao, destinoMercadoria: 'USO_CONSUMO', consumidorFinal: true }
      : rascunho.operacao,
    destinatario: {
      ...rascunho.destinatario,
      indicadorIe: String(cadastro.indicador),
      inscricaoEstadual: cadastro.indicador === 1 ? cadastro.inscricaoEstadual : '',
    },
  };
}
