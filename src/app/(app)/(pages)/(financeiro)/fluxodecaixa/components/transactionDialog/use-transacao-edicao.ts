"use client";

import { useCallback, useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";

import { toast } from "@/lib/toast";

import { tipoTemValorLiquido, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";

import type { Transaction } from "../../types";
import { paraDataDaApi } from "./datas";
import type { TransacaoContexto } from "./tabs/types";

export type FormularioTransacao = Omit<Transaction, "data"> & { data?: Date };

function mensagemDoErro(erro: unknown, alternativa: string) {
  if (isAxiosError(erro)) return erro.response?.data?.error ?? erro.message ?? alternativa;
  if (erro instanceof Error) return erro.message;
  return alternativa;
}

/**
 * Carrega a transação e o seu contexto, guarda o formulário e salva.
 *
 * A transação e o contexto carregam de forma independente de propósito: o
 * contexto é uma consulta bem mais cara (documento de origem, cliente,
 * auditoria) e não pode segurar a aba Detalhes, que é a que o usuário abre em
 * 90% das vezes.
 */
export function useTransacaoEdicao(transacaoId: number | undefined) {
  const [form, setForm] = useState<FormularioTransacao | undefined>(undefined);
  const [contexto, setContexto] = useState<TransacaoContexto | undefined>(undefined);
  const [carregando, setCarregando] = useState(false);
  const [carregandoContexto, setCarregandoContexto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarTransacao = useCallback(async (id: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await axios.get(`/api/transaction/${id}`);
      const transacao: Transaction = resposta.data.data;
      setForm({ ...transacao, data: paraDataDaApi(transacao.data) });
    } catch (error) {
      // Sem isto o dialog ficava preso num "Carregando" eterno quando a
      // requisição falhava — o catch original era vazio.
      setForm(undefined);
      setErro(mensagemDoErro(error, "Não foi possível carregar a transação."));
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarContexto = useCallback(async (id: number) => {
    setCarregandoContexto(true);
    try {
      const resposta = await axios.get(`/api/transaction/${id}/contexto`);
      setContexto(resposta.data);
    } catch {
      // O contexto é informativo: se falhar, a aba Detalhes continua utilizável.
      setContexto(undefined);
    } finally {
      setCarregandoContexto(false);
    }
  }, []);

  const recarregar = useCallback(() => {
    if (!transacaoId) return;
    void carregarTransacao(transacaoId);
    void carregarContexto(transacaoId);
  }, [transacaoId, carregarTransacao, carregarContexto]);

  useEffect(() => {
    if (!transacaoId) {
      setForm(undefined);
      setContexto(undefined);
      setErro(null);
      return;
    }
    void carregarTransacao(transacaoId);
    void carregarContexto(transacaoId);
  }, [transacaoId, carregarTransacao, carregarContexto]);

  const setCampo = useCallback(
    <Campo extends keyof FormularioTransacao>(
      campo: Campo,
      valor: FormularioTransacao[Campo],
    ) => {
      setForm((atual) => (atual ? { ...atual, [campo]: valor } : atual));
    },
    [],
  );

  const salvar = useCallback(async (): Promise<boolean> => {
    if (!form) return false;

    if (!form.descricao?.trim() || !form.data) {
      toast.error("Preencha descrição e data.");
      return false;
    }

    const bruto = Number(form.valor ?? 0);
    // Para despesa/depósito isto devolve o próprio bruto: não existe taxa de
    // maquineta ali, e o líquido só precisa acompanhar para o fluxo de caixa
    // (que exibe o líquido na coluna de valor) não mostrar R$ 0,00 na linha.
    const liquido = valorLiquidoEfetivo(form);

    if (tipoTemValorLiquido(form.tipo)) {
      if (!(liquido > 0)) {
        toast.error("O valor líquido deve ser maior que zero.");
        return false;
      }
      if (Math.round(liquido * 100) > Math.round(bruto * 100)) {
        toast.error("O valor líquido não pode ser maior que o bruto.");
        return false;
      }
    }

    setSalvando(true);
    try {
      await axios.patch(
        `/api/transaction/${form.id}`,
        {
          descricao: form.descricao,
          descricao_pagamento: form.descricao_pagamento ?? null,
          // O bruto não vai no payload: a rota o rejeita, e redistribuí-lo é
          // trabalho do ajuste de valores, que valida a soma do grupo.
          valorLiquido: liquido,
          data: form.data,
          tipo: form.tipo,
          metodopagamento: form.metodopagamento || null,
          categoria: form.categoria || null,
          categoria_id: form.categoria_id ?? null,
          plano_de_conta: form.plano_de_conta ?? null,
          plano_de_conta_id: form.plano_de_conta_id ?? null,
          centro_custo: form.centro_custo ?? null,
          centro_custo_id: form.centro_custo_id ?? null,
          banco_id: form.banco_id ?? null,
          nomepagador: form.nomepagador || null,
          cpfcnpjpagador: form.cpfcnpjpagador || null,
          // `pendente` fica de fora: a rota recusa alterá-lo, e mandar o valor
          // atual só criaria risco de recusa falsa se o form dessincronizasse.
        },
        { headers: { "X-Transaction-Edit": "true" } },
      );

      toast.success("Transação atualizada.");
      return true;
    } catch (error) {
      toast.error("Erro ao atualizar transação", {
        description: mensagemDoErro(error, "Tente novamente."),
      });
      return false;
    } finally {
      setSalvando(false);
    }
  }, [form]);

  return {
    form,
    setForm,
    setCampo,
    contexto,
    carregando,
    carregandoContexto,
    salvando,
    erro,
    salvar,
    recarregar,
  };
}
