"use client";

import { useState } from "react";

/**
 * Seleção múltipla das listas de pagamento, com a ação em lote embutida.
 *
 * O modo não é mais só "pagamento múltiplo": a mesma seleção serve para emitir
 * nota. As duas ações não aceitam os mesmos documentos — pagamento quer saldo
 * em aberto, emissão quer a OS/venda concluída e ainda sem nota —, então o
 * modo carrega qual ação está ativa e quem chama filtra por ela. Uma seleção
 * "união" faria o rodapé somar o saldo de documentos já quitados.
 */
export type AcaoEmLote = "PAGAMENTO" | "NOTA";

export function useSelecaoMultipla(chaveDaLista: string) {
  const [acaoAlvo, setAcaoAlvo] = useState<AcaoEmLote | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());

  // Trocar de aba ou de página troca a lista debaixo da seleção; manter ids de
  // linhas que sumiram da tela faria o rodapé somar o que ninguém está vendo.
  // Ajuste durante o render, e não em efeito: o efeito só rodaria depois de uma
  // pintura com a seleção velha, e ainda custaria um render a mais.
  const [chaveAnterior, setChaveAnterior] = useState(chaveDaLista);
  if (chaveAnterior !== chaveDaLista) {
    setChaveAnterior(chaveDaLista);
    setSelecionadas(new Set());
  }

  const entrar = (acao: AcaoEmLote) => {
    // Trocar de ação com seleção viva descartaria o filtro de elegibilidade da
    // ação anterior, então a seleção recomeça limpa.
    setAcaoAlvo((atual) => {
      if (atual !== acao) setSelecionadas(new Set());
      return acao;
    });
  };

  const alternar = (id: number) =>
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  const marcarTodos = (ids: number[]) => setSelecionadas(new Set(ids));

  const limpar = () => setSelecionadas(new Set());

  const sair = () => {
    setAcaoAlvo(null);
    setSelecionadas(new Set());
  };

  return {
    acaoAlvo,
    /** Verdadeiro quando qualquer modo de seleção está ligado. */
    modo: acaoAlvo !== null,
    ehPagamento: acaoAlvo === "PAGAMENTO",
    ehNota: acaoAlvo === "NOTA",
    selecionadas,
    entrar,
    alternar,
    marcarTodos,
    limpar,
    sair,
  };
}
