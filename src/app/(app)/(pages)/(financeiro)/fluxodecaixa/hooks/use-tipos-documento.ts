"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export type TipoDocumento = {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
};

/**
 * Catálogo de tipos de documento que uma transação pode referenciar.
 *
 * A busca acontece na montagem do dialog, como a de categorias e centros de
 * custo: a lista é curta e muda raramente, então não vale um cache mais
 * elaborado do que isso.
 */
export function useTiposDocumento() {
  const [tiposDocumento, setTiposDocumento] = useState<TipoDocumento[]>([]);
  const [loadingTiposDocumento, setLoadingTiposDocumento] = useState(false);
  const [errorTiposDocumento, setErrorTiposDocumento] = useState<string | null>(null);

  useEffect(() => {
    const buscar = async () => {
      try {
        setLoadingTiposDocumento(true);
        setErrorTiposDocumento(null);

        const resposta = await axios.get("/api/tipos/documentos-transacao");
        setTiposDocumento(resposta.data?.data ?? []);
      } catch {
        setErrorTiposDocumento("Erro ao carregar tipos de documento");
      } finally {
        setLoadingTiposDocumento(false);
      }
    };

    void buscar();
  }, []);

  return { tiposDocumento, loadingTiposDocumento, errorTiposDocumento };
}
