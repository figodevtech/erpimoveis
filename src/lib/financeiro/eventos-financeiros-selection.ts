/** Limite compartilhado pela seleção da tela e pela criação do pagamento. */
export const LIMITE_SELECAO_EVENTOS = 500;

export function excedeLimiteSelecaoDeEventos(quantidade: number) {
  return quantidade > LIMITE_SELECAO_EVENTOS;
}

export type EventoSelecionavelResumido = {
  id: number;
  osId: number | null;
  vendaId?: number | null;
  descricao: string;
  valor: number;
};

export type ResultadoSelecaoDeEventos = {
  eventos: EventoSelecionavelResumido[];
  total: number;
  limite: number;
};
