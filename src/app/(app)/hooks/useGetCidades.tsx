import { useCallback, useEffect, useState } from "react";

type Cidade = {
  id: number;
  nome: string;
};

/** De onde veio a lista que esta na tela. */
export type OrigemCidades = "ibge" | "local";

/**
 * Quanto esperamos o IBGE antes de desistir e usar a lista embutida. Curto de
 * proposito: o usuario esta parado olhando o combo.
 */
const TIMEOUT_IBGE_MS = 5_000;

/** A lista local vem da propria aplicacao; so protege contra travar de vez. */
const TIMEOUT_LOCAL_MS = 10_000;

/** A lista de municipios de uma UF nao muda durante a sessao. */
const cachePorUf = new Map<string, { cidades: Cidade[]; origem: OrigemCidades }>();

/**
 * Disjuntor de sessao. Se o IBGE ja falhou uma vez, nao faz sentido pagar 5s de
 * espera a cada nova UF — o usuario esperaria 5s por estado. `recarregar()`
 * rearma, para quem quiser forcar a busca no IBGE de novo.
 */
let ibgeIndisponivel = false;

/**
 * Municipios de uma UF.
 *
 * Tenta o IBGE primeiro, porque e a fonte viva: municipio novo aparece la antes
 * de entrar no dataset do repositorio. Se nao responder em 5s, usa
 * `/api/localidades/cidades`, que serve a lista embutida em
 * `src/data/municipios-por-uf.json`.
 *
 * O `id` e o codigo IBGE do municipio, gravado em `cliente.codigomunicipio` e
 * usado na emissao de nota — as duas fontes usam o mesmo codigo.
 */
export function useGetCidades(uf?: string) {
  const [cidades, setCidades] = useState<Cidade[]>([]);
  const [origem, setOrigem] = useState<OrigemCidades | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  /** Tenta tudo de novo, inclusive o IBGE. */
  const recarregar = useCallback(() => {
    if (uf) cachePorUf.delete(uf);
    ibgeIndisponivel = false;
    setTentativa((atual) => atual + 1);
  }, [uf]);

  useEffect(() => {
    let cancelled = false;

    if (!uf) {
      setCidades([]);
      setOrigem(null);
      setLoading(false);
      setError(null);
      return;
    }

    const emCache = cachePorUf.get(uf);
    if (emCache) {
      setCidades(emCache.cidades);
      setOrigem(emCache.origem);
      setLoading(false);
      setError(null);
      return;
    }

    // Controllers separados: o do IBGE pode ser abortado pelo timeout, e um
    // controller abortado nao serve para a requisicao seguinte.
    const controllerIbge = new AbortController();
    const controllerLocal = new AbortController();

    const aplicar = (lista: Cidade[], de: OrigemCidades) => {
      cachePorUf.set(uf, { cidades: lista, origem: de });
      setCidades(lista);
      setOrigem(de);
      setError(null);
      setLoading(false);
    };

    const carregar = async () => {
      setLoading(true);
      setError(null);

      if (!ibgeIndisponivel) {
        const timer = setTimeout(() => controllerIbge.abort(), TIMEOUT_IBGE_MS);
        try {
          const resp = await fetch(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
            { signal: controllerIbge.signal },
          );
          if (!resp.ok) throw new Error(`IBGE respondeu ${resp.status}`);

          const data: Cidade[] = await resp.json();
          if (cancelled) return;
          if (!Array.isArray(data) || data.length === 0) {
            throw new Error("IBGE devolveu lista vazia");
          }

          aplicar(data, "ibge");
          return;
        } catch {
          // Cancelamento do efeito nao e falha do IBGE: nao arma o disjuntor.
          if (cancelled) return;
          ibgeIndisponivel = true;
        } finally {
          clearTimeout(timer);
        }
      }

      const timerLocal = setTimeout(() => controllerLocal.abort(), TIMEOUT_LOCAL_MS);
      try {
        const resp = await fetch(
          `/api/localidades/cidades?uf=${encodeURIComponent(uf)}`,
          { signal: controllerLocal.signal },
        );
        if (!resp.ok) throw new Error(`Resposta ${resp.status}`);

        const data: Cidade[] = await resp.json();
        if (cancelled) return;

        aplicar(data, "local");
      } catch {
        if (cancelled) return;
        setCidades([]);
        setOrigem(null);
        setError("Não foi possível carregar as cidades.");
        setLoading(false);
      } finally {
        clearTimeout(timerLocal);
      }
    };

    carregar();

    return () => {
      cancelled = true;
      controllerIbge.abort();
      controllerLocal.abort();
    };
  }, [uf, tentativa]);

  return { cidades, loading, error, origem, recarregar };
}
