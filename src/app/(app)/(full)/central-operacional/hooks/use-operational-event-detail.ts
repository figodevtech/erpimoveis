"use client";

import * as React from "react";

import type { OperationalEventDetail } from "@/lib/central-operacional/contracts";
import { fetchOperationalEventDetail } from "../lib/api";

export type OperationalEventDetailState = {
  detail: OperationalEventDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Detalhe do evento aberto, buscado sob demanda.
 *
 * O snapshot roda a cada 45 segundos para todo mundo; carregar o detalhe dos 40
 * eventos ali dentro sairia caro e quase sempre para nada. Aqui a consulta só
 * acontece quando alguém abre um card.
 *
 * O cache é por id de evento e vive enquanto a tela está aberta: reabrir o mesmo
 * card não repete a viagem. Os eventos são imutáveis por natureza — o log é um
 * registro do que aconteceu —, então o detalhe só envelhece no que diz respeito
 * à entidade de origem, e para isso existe o `retry`.
 */
/** Resultado já resolvido, carimbado com o evento a que pertence. */
type Resolvido =
  | { id: string; detail: OperationalEventDetail; error: null }
  | { id: string; detail: null; error: string };

export function useOperationalEventDetail(eventId: string | null): OperationalEventDetailState {
  const [resolvido, setResolvido] = React.useState<Resolvido | null>(null);
  const [tentativa, setTentativa] = React.useState(0);
  const cacheRef = React.useRef(new Map<string, OperationalEventDetail>());

  React.useEffect(() => {
    if (!eventId) {
      setResolvido(null);
      return;
    }

    const emCache = cacheRef.current.get(eventId);
    if (emCache) {
      setResolvido({ id: eventId, detail: emCache, error: null });
      return;
    }

    const controller = new AbortController();
    let ativo = true;

    fetchOperationalEventDetail(eventId, controller.signal)
      .then((resposta) => {
        if (!ativo) return;
        cacheRef.current.set(eventId, resposta);
        setResolvido({ id: eventId, detail: resposta, error: null });
      })
      .catch((falha: unknown) => {
        if (!ativo || (falha instanceof DOMException && falha.name === "AbortError")) return;
        const codigo = (falha as { code?: string })?.code;
        setResolvido({
          id: eventId,
          detail: null,
          error:
            codigo === "EVENTO_NAO_ENCONTRADO"
              ? "Este evento não está mais disponível para o seu perfil."
              : "Não foi possível carregar o detalhe agora.",
        });
      });

    return () => {
      ativo = false;
      controller.abort();
    };
  }, [eventId, tentativa]);

  const retry = React.useCallback(() => {
    if (eventId) cacheRef.current.delete(eventId);
    setResolvido(null);
    setTentativa((atual) => atual + 1);
  }, [eventId]);

  // `loading` é derivado, não guardado: assim o esqueleto já aparece no primeiro
  // render, antes de o efeito rodar, em vez de a tela piscar vazia. O carimbo do
  // id evita mostrar o detalhe de um evento no lugar de outro.
  const atual = resolvido && resolvido.id === eventId ? resolvido : null;

  return {
    detail: atual?.detail ?? null,
    error: atual?.error ?? null,
    loading: Boolean(eventId) && atual === null,
    retry,
  };
}
