"use client";

import { useEffect, useState } from "react";
import axios from "axios";

import type { Bandeira } from "../types";

/**
 * Bandeiras ativas de um par (conta bancária, forma de pagamento).
 *
 * Ao contrário das categorias e dos centros de custo, esta lista NÃO é buscada
 * uma vez na montagem: ela depende de dois campos que o usuário ainda vai
 * preencher, e o par muda a cada troca de banco ou de método. O filtro vai para
 * o servidor porque o catálogo inteiro seria quase todo descartado no cliente.
 *
 * Sem os dois campos a lista fica vazia sem nenhuma requisição — que é o estado
 * normal da maioria dos lançamentos, e não vale uma ida ao servidor para
 * descobrir que não há nada a mostrar.
 */
export function useBandeiras(
  bancoId: number | null | undefined,
  metodoPagamento: string | null | undefined,
) {
  const [bandeiras, setBandeiras] = useState<Bandeira[]>([]);
  const [loadingBandeiras, setLoadingBandeiras] = useState(false);
  const [errorBandeiras, setErrorBandeiras] = useState<string | null>(null);

  useEffect(() => {
    if (!bancoId || !metodoPagamento) {
      setBandeiras([]);
      setErrorBandeiras(null);
      setLoadingBandeiras(false);
      return;
    }

    // A resposta de um par antigo não pode sobrescrever a de um par novo: trocar
    // de banco duas vezes depressa deixaria o seletor mostrando as bandeiras da
    // conta anterior.
    let atual = true;

    async function carregar() {
      try {
        setLoadingBandeiras(true);
        setErrorBandeiras(null);

        const resposta = await axios.get("/api/tipos/bandeiras", {
          params: {
            ativo: "true",
            banco_id: bancoId,
            metodopagamento: metodoPagamento,
          },
        });

        if (!atual) return;

        // Bandeira sem faixa nenhuma não oferece parcelamento e só ocuparia
        // espaço no seletor. A rota de cadastro já recusa criar uma assim; isto
        // cobre o que porventura tenha entrado por fora.
        const itens: Bandeira[] = (resposta.data?.items ?? []).filter(
          (bandeira: Bandeira) => bandeira.parcelas.length > 0,
        );

        setBandeiras(itens);
      } catch (erro) {
        if (!atual) return;
        console.error("Erro ao carregar bandeiras:", erro);
        setErrorBandeiras("Erro ao carregar bandeiras");
        setBandeiras([]);
      } finally {
        if (atual) setLoadingBandeiras(false);
      }
    }

    void carregar();

    return () => {
      atual = false;
    };
  }, [bancoId, metodoPagamento]);

  return { bandeiras, loadingBandeiras, errorBandeiras };
}
