"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios, { isAxiosError } from "axios";

import { toast } from "@/lib/toast";

import {
  origemDaTransacao,
  tipoTemValorLiquido,
  valorLiquidoEfetivo,
} from "@/lib/financeiro/transacao";

import type { Transaction } from "../../types";
import { paraDataDaApi } from "./datas";
import type { TransacaoContexto } from "./tabs/types";

export type FormularioTransacao = Omit<Transaction, "data"> & { data?: Date };

/**
 * O que a rota de ajustes devolve depois de recalcular. Numeric do Postgres
 * chega como string, por isso os campos são frouxos aqui e convertidos na hora
 * de entrar no formulário.
 */
export type TotaisDaTransacao = {
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  valor_base?: number | string | null;
  valor_acrescimos?: number | string | null;
  valor_descontos?: number | string | null;
};

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

  /**
   * Estado como veio do banco. Serve de base para o ajuste de valores, que exige
   * os numeros que estavam na tela quando ela abriu — e assim recusa gravar por
   * cima de quem salvou primeiro.
   */
  const original = useRef<Transaction | undefined>(undefined);

  /**
   * Quantos descontos a transação tem. Com um só (a taxa de recebimento), o
   * campo de líquido continua editável e manda nela. Com mais de um, não há como
   * saber qual o usuário quis mexer, e a edição sai da aba Detalhes.
   */
  const [descontos, setDescontos] = useState(0);

  const carregarTransacao = useCallback(async (id: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await axios.get(`/api/transaction/${id}`);
      const transacao: Transaction = resposta.data.data;
      original.current = transacao;
      setForm({ ...transacao, data: paraDataDaApi(transacao.data) });

      // Consulta separada e tolerante a falha: saber a quantidade de descontos
      // é conforto de tela, não pode impedir a edição de abrir.
      void axios
        .get(`/api/transaction/${id}/ajustes`)
        .then((r) => {
          const linhas: Array<{ natureza: string }> = r.data?.data ?? [];
          setDescontos(linhas.filter((linha) => linha.natureza === "DESCONTO").length);
        })
        .catch(() => setDescontos(0));
    } catch (error) {
      // Sem isto o dialog ficava preso num "Carregando" eterno quando a
      // requisição falhava — o catch original era vazio.
      setForm(undefined);
      setErro(mensagemDoErro(error, "Não foi possível carregar a transação."));
    } finally {
      setCarregando(false);
    }
  }, []);

  /**
   * `silencioso` busca de novo sem acender o "carregando".
   *
   * A aba Parcelas mostra as irmãs do parcelamento com bruto e líquido de cada
   * uma, e esses números vêm daqui, não do formulário. Depois de lançar um
   * desconto, sem esta releitura a aba continuaria exibindo o valor velho.
   * Levantar o spinner desmontaria as abas — que é justamente o que se quis
   * evitar —, então a lista é trocada por baixo quando a resposta chega.
   */
  const carregarContexto = useCallback(async (id: number, silencioso = false) => {
    if (!silencioso) setCarregandoContexto(true);
    try {
      const resposta = await axios.get(`/api/transaction/${id}/contexto`);
      setContexto(resposta.data);
    } catch {
      // O contexto é informativo: se falhar, a aba Detalhes continua utilizável.
      // Numa recarga silenciosa é melhor manter o que já estava na tela do que
      // esvaziar a aba por causa de uma consulta que falhou.
      if (!silencioso) setContexto(undefined);
    } finally {
      if (!silencioso) setCarregandoContexto(false);
    }
  }, []);

  const recarregarContextoSilencioso = useCallback(() => {
    if (transacaoId) void carregarContexto(transacaoId, true);
  }, [transacaoId, carregarContexto]);

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

  /**
   * Aplica os totais que a rota de ajustes devolveu, sem refazer consulta.
   *
   * Lancar um desconto mudava `valor`, `valorLiquido` e as tres colunas
   * derivadas, e a tela reagia recarregando tudo: a transacao, o contexto e a
   * lista atras do dialog. Como a propria resposta ja traz a transacao
   * atualizada, dá para so costurar os numeros no formulario — o usuario
   * continua na aba onde estava, com o que digitou nos outros campos intacto.
   *
   * Os campos que o usuario possa estar editando (descricao, data, categoria)
   * ficam de fora de proposito: sobrescreve-los aqui apagaria o que ele digitou
   * e ainda nao salvou.
   */
  const aplicarTotais = useCallback(
    (transacao: TotaisDaTransacao | undefined, quantidadeDeDescontos?: number) => {
      if (!transacao) return;

      // O Postgres devolve numeric como string; converter aqui evita o numero
      // virar texto no formulario e quebrar as contas da tela.
      const numero = (valor: unknown, alternativa: number) => {
        const convertido = Number(valor ?? NaN);
        return Number.isFinite(convertido) ? convertido : alternativa;
      };

      setForm((atual) =>
        atual
          ? {
              ...atual,
              valor: numero(transacao.valor, atual.valor),
              valorLiquido: numero(transacao.valorLiquido, atual.valorLiquido),
              valor_base: numero(transacao.valor_base, atual.valor_base ?? 0),
              valor_acrescimos: numero(transacao.valor_acrescimos, 0),
              valor_descontos: numero(transacao.valor_descontos, 0),
            }
          : atual,
      );

      // A base de comparacao do ajuste de valores tem que acompanhar, senao a
      // proxima edicao de bruto seria recusada como "os valores mudaram".
      if (original.current) {
        original.current = {
          ...original.current,
          valor: numero(transacao.valor, original.current.valor),
          valorLiquido: numero(transacao.valorLiquido, original.current.valorLiquido),
          valor_acrescimos: numero(transacao.valor_acrescimos, 0),
          valor_descontos: numero(transacao.valor_descontos, 0),
        };
      }

      if (typeof quantidadeDeDescontos === "number") {
        setDescontos(quantidadeDeDescontos);
      }
    },
    [],
  );

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
      // O bruto nao pode ir no PATCH — a rota o recusa, porque num pagamento de
      // OS ou venda mexer numa linha isolada quebraria o total do documento.
      // Em lancamento avulso nao ha total a preservar, e o caminho e o mesmo
      // /ajustar-valores que o rateio usa: ele grava dentro de uma transacao e
      // recusa se o valor tiver mudado desde que a tela abriu.
      const anterior = original.current;
      const brutoMudou =
        anterior != null &&
        Math.round(bruto * 100) !== Math.round(Number(anterior.valor ?? 0) * 100);

      // O liquido deixou de ser campo gravavel quando ha desconto lancado: o
      // gatilho o recalcula a partir das linhas, e mandar valorLiquido no PATCH
      // seria descartado em silencio. O campo passa a significar "quanto quero
      // que entre na conta", e o servidor traduz isso na linha de taxa.
      const liquidoMudou =
        anterior != null &&
        Math.round(liquido * 100) !== Math.round(valorLiquidoEfetivo(anterior) * 100);

      if (liquidoMudou && descontos <= 1 && tipoTemValorLiquido(form.tipo)) {
        await axios.put(`/api/transaction/${form.id}/ajustes`, {
          liquidoDesejado: liquido,
        });
      }

      if (brutoMudou && origemDaTransacao(anterior) == null) {
        await axios.post(`/api/transaction/${form.id}/ajustar-valores`, {
          itens: [
            {
              id: form.id,
              valor: bruto,
              valorLiquido: liquido,
              valorAnterior: Number(anterior.valor ?? 0),
              valorLiquidoAnterior: valorLiquidoEfetivo(anterior),
            },
          ],
        });
      }

      await axios.patch(
        `/api/transaction/${form.id}`,
        {
          descricao: form.descricao,
          descricao_pagamento: form.descricao_pagamento ?? null,
          // O bruto não vai no payload: a rota o rejeita, e redistribuí-lo é
          // trabalho do ajuste de valores, que valida a soma do grupo.
          valorLiquido: liquido,
          data: form.data,
          // Só vai quando é avulso: com documento, a rota recusa e o salvamento
          // inteiro falharia por um campo que a tela nem deixou editar.
          ...(origemDaTransacao(form) == null
            ? { competencia_em: form.competencia_em ?? null }
            : {}),
          tipo: form.tipo,
          metodopagamento: form.metodopagamento || null,
          categoria: form.categoria || null,
          categoria_id: form.categoria_id ?? null,
          plano_de_conta: form.plano_de_conta ?? null,
          plano_de_conta_id: form.plano_de_conta_id ?? null,
          centro_custo: form.centro_custo ?? null,
          centro_custo_id: form.centro_custo_id ?? null,
          // Título liquidado por antecipação vai sempre sem banco: o dinheiro
          // entrou pelo lançamento da antecipação, e repetir a conta aqui o
          // faria aparecer no fluxo de caixa duas vezes. Mandar `null` em vez de
          // omitir o campo também conserta a linha que já tenha sido salva com
          // banco antes de a trava existir.
          banco_id: form.adiantamento_id != null ? null : (form.banco_id ?? null),
          nomepagador: form.nomepagador || null,
          cpfcnpjpagador: form.cpfcnpjpagador || null,
          // `pendente` fica de fora: a rota recusa alterá-lo, e mandar o valor
          // atual só criaria risco de recusa falsa se o form dessincronizasse.
        },
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
    // `descontos` decide se o líquido ainda pode ser editado por aqui. Fora da
    // lista, o salvamento ficaria com a contagem do momento em que a tela
    // montou e voltaria a mexer na taxa depois de o usuário ter lançado um
    // segundo desconto.
  }, [form, descontos]);

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
    /** Quantidade de descontos lançados; acima de um, o líquido sai da Detalhes. */
    descontos,
    aplicarTotais,
    recarregarContextoSilencioso,
  };
}
