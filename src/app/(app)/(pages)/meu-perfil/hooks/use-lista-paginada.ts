// src/app/(app)/(pages)/meu-perfil/hooks/use-lista-paginada.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Paginado } from "../types";

type Buscador<T> = (params: { page: number; limit: number; signal: AbortSignal }) => Promise<Paginado<T>>;

type Opcoes<T> = {
  /** Precisa ser estavel (useCallback), senao a lista refaz a busca a cada render. */
  buscar: Buscador<T>;
  limit: number;
  /** Busca so acontece com a aba visivel — evita 3 requisicoes ao abrir a tela. */
  ativo: boolean;
  /** Muda quando os filtros mudam; volta a paginacao para a primeira pagina. */
  chaveDeReset: string;
};

type Resultado<T> = {
  chave: string;
  dados: Paginado<T> | null;
  erro: string | null;
};

export type ListaPaginada<T> = {
  items: T[];
  page: number;
  total: number;
  totalPages: number;
  carregando: boolean;
  erro: string | null;
  irParaPagina: (pagina: number) => void;
  recarregar: () => void;
};

export function useListaPaginada<T>({ buscar, limit, ativo, chaveDeReset }: Opcoes<T>): ListaPaginada<T> {
  const [paginacao, setPaginacao] = useState({ chave: chaveDeReset, page: 1 });
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<Resultado<T>>({ chave: "", dados: null, erro: null });

  // Derivar (em vez de resetar via efeito) evita uma busca descartada na pagina
  // antiga toda vez que o filtro muda.
  const page = paginacao.chave === chaveDeReset ? paginacao.page : 1;
  const chaveAtual = `${chaveDeReset}|${page}|${limit}|${tentativa}`;

  // "Carregando" e derivado: enquanto o resultado em maos nao corresponde a
  // consulta atual, ainda estamos buscando. Isso mantem os dados antigos na
  // tela durante a troca de pagina e dispensa um setState dentro do efeito.
  const carregando = ativo && resultado.chave !== chaveAtual;

  useEffect(() => {
    if (!ativo) return;

    const controller = new AbortController();

    buscar({ page, limit, signal: controller.signal })
      .then((resposta) => {
        if (controller.signal.aborted) return;
        setResultado({ chave: chaveAtual, dados: resposta, erro: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResultado((anterior) => ({
          chave: chaveAtual,
          dados: anterior.dados,
          erro: e instanceof Error ? e.message : "Falha ao carregar os dados.",
        }));
      });

    return () => controller.abort();
  }, [ativo, buscar, chaveAtual, limit, page]);

  const irParaPagina = useCallback(
    (pagina: number) => setPaginacao({ chave: chaveDeReset, page: Math.max(1, pagina) }),
    [chaveDeReset],
  );

  const recarregar = useCallback(() => setTentativa((valor) => valor + 1), []);

  return {
    items: resultado.dados?.items ?? [],
    page,
    total: resultado.dados?.total ?? 0,
    totalPages: resultado.dados?.totalPages ?? 1,
    carregando,
    erro: carregando ? null : resultado.erro,
    irParaPagina,
    recarregar,
  };
}
