"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/lib/toast";

export type TransacaoAnexo = {
  id: number;
  transacao_id: number;
  nome: string;
  tipo: string;
  tamanho: number;
  url: string;
  descricao?: string | null;
  created_by?: string | null;
  created_at: string;
};

const LIMITE_PADRAO = 10;

async function payloadDaResposta(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function mensagem(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
}

/**
 * Estado independente do formulário financeiro.
 *
 * Adicionar ou remover um arquivo nunca relê a transação nem o contexto: a
 * resposta da própria mutação é costurada na lista local. Assim, campos ainda
 * não salvos na aba Detalhes permanecem intactos.
 */
export function useTransacaoAnexos(transacaoId: number | undefined) {
  const [anexos, setAnexos] = useState<TransacaoAnexo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [maxAnexos, setMaxAnexos] = useState(LIMITE_PADRAO);
  const idAtual = useRef(transacaoId);
  idAtual.current = transacaoId;

  const carregar = useCallback(async () => {
    if (!transacaoId) {
      setAnexos([]);
      return;
    }

    const idDaRequisicao = transacaoId;
    setCarregando(true);
    setErro(null);
    try {
      const response = await fetch(`/api/transaction/${idDaRequisicao}/anexos`, {
        cache: "no-store",
      });
      const payload = await payloadDaResposta(response);
      if (!response.ok) throw new Error(mensagem(payload, "Erro ao carregar anexos."));
      if (idAtual.current !== idDaRequisicao) return;

      setAnexos(Array.isArray(payload.items) ? (payload.items as TransacaoAnexo[]) : []);
      const limite = Number(payload.maxAnexos);
      setMaxAnexos(Number.isFinite(limite) && limite > 0 ? limite : LIMITE_PADRAO);
    } catch (error) {
      if (idAtual.current !== idDaRequisicao) return;
      const texto = error instanceof Error ? error.message : "Não foi possível carregar os anexos.";
      setErro(texto);
      setAnexos([]);
    } finally {
      if (idAtual.current === idDaRequisicao) setCarregando(false);
    }
  }, [transacaoId]);

  useEffect(() => {
    setAnexos([]);
    setErro(null);
    setMaxAnexos(LIMITE_PADRAO);
    void carregar();
  }, [carregar]);

  const adicionar = useCallback(
    async (file: File) => {
      if (!transacaoId) return false;
      if (anexos.length >= maxAnexos) {
        toast.error(`Limite de ${maxAnexos} anexos por transação atingido.`);
        return false;
      }

      const idDaRequisicao = transacaoId;
      const form = new FormData();
      form.append("file", file);

      setEnviando(true);
      try {
        const response = await fetch(`/api/transaction/${idDaRequisicao}/anexos`, {
          method: "POST",
          body: form,
        });
        const payload = await payloadDaResposta(response);
        if (!response.ok) throw new Error(mensagem(payload, "Erro ao anexar arquivo."));
        if (idAtual.current !== idDaRequisicao) return false;

        const item = payload.item as TransacaoAnexo | undefined;
        if (!item?.id) throw new Error("O servidor não devolveu o anexo criado.");
        setAnexos((atuais) => [item, ...atuais.filter((anexo) => anexo.id !== item.id)]);
        setErro(null);
        toast.success("Anexo adicionado.");
        return true;
      } catch (error) {
        toast.error("Não foi possível anexar o arquivo", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
        return false;
      } finally {
        if (idAtual.current === idDaRequisicao) setEnviando(false);
      }
    },
    [anexos.length, maxAnexos, transacaoId],
  );

  const excluir = useCallback(
    async (anexoId: number) => {
      if (!transacaoId) return false;
      const idDaRequisicao = transacaoId;
      setExcluindoId(anexoId);
      try {
        const response = await fetch(
          `/api/transaction/${idDaRequisicao}/anexos/${anexoId}`,
          { method: "DELETE" },
        );
        const payload = await payloadDaResposta(response);
        if (!response.ok) throw new Error(mensagem(payload, "Erro ao remover anexo."));
        if (idAtual.current !== idDaRequisicao) return false;

        setAnexos((atuais) => atuais.filter((anexo) => anexo.id !== anexoId));
        toast.success("Anexo removido.");
        return true;
      } catch (error) {
        toast.error("Não foi possível remover o anexo", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
        return false;
      } finally {
        if (idAtual.current === idDaRequisicao) setExcluindoId(null);
      }
    },
    [transacaoId],
  );

  return {
    anexos,
    carregando,
    enviando,
    excluindoId,
    erro,
    maxAnexos,
    carregar,
    adicionar,
    excluir,
  };
}
