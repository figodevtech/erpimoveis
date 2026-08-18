"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios, { isAxiosError } from "axios";

import { toast } from "@/lib/toast";

import {
  origemDaTransacao,
  taxaEhOUnicoDesconto,
  tipoTemValorLiquido,
  valorLiquidoEfetivo,
  valorLiquidoEmEdicao,
} from "@/lib/financeiro/transacao";

import type { Transaction } from "../../types";
import { paraDataDaApi } from "./datas";
import type { TransacaoContexto } from "./tabs/types";

export type FormularioTransacao = Omit<Transaction, "data"> & {
  data?: Date;
  /** Estado visual da seção; não é coluna e nunca é enviado à API. */
  relacionarDocumento: boolean;
};

function temDocumentoRelacionado(transacao: Transaction) {
  return Boolean(
    transacao.documento_tipo_id != null ||
      transacao.documento_numero ||
      transacao.documento_serie ||
      transacao.documento_chave ||
      transacao.documento_emitido_em ||
      transacao.documento_valor != null ||
      transacao.documento_observacao,
  );
}

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

/**
 * Teto para as chamadas do salvamento.
 *
 * O axios não tem timeout por padrão: uma requisição que não volta deixa o botão
 * em "Salvando..." para sempre. E ela pode não voltar — o ajuste de valores trava
 * as linhas da transação, e quem espera por uma linha travada ficava parado até
 * o `statement_timeout` do banco, que é de dois minutos.
 *
 * O banco agora desiste em 5s (`lock_timeout` na própria função). Este teto é a
 * rede embaixo disso: cobre o que o banco não alcança — rede caída, servidor
 * reiniciando — e transforma "girando para sempre" em uma mensagem.
 */
const TIMEOUT_SALVAMENTO = 20_000;

function mensagemDoErro(erro: unknown, alternativa: string) {
  if (isAxiosError(erro)) {
    // Sem resposta e com código de timeout: a requisição nem chegou a ser
    // respondida, então `response.data.error` não existe e a mensagem crua do
    // axios ("timeout of 20000ms exceeded") não diz nada a quem está usando.
    if (erro.code === "ECONNABORTED" || erro.code === "ETIMEDOUT") {
      return "O servidor demorou demais para responder. Confira se a alteração foi salva antes de tentar de novo.";
    }
    return erro.response?.data?.error ?? erro.message ?? alternativa;
  }
  if (erro instanceof Error) return erro.message;
  return alternativa;
}

/**
 * Há bruto ou líquido digitados na aba Detalhes e ainda não gravados?
 *
 * A pergunta importa porque as duas metades do dialog escrevem em momentos
 * diferentes: a aba Detalhes só no "Salvar alterações", e a de acréscimos e
 * descontos na hora, a cada linha. A resposta do servidor traz a transação
 * inteira recalculada a partir do que está no BANCO — que não conhece o que
 * ainda está só na tela.
 *
 * Sem esta pergunta, lançar um acréscimo com um líquido digitado devolvia o
 * líquido do banco por cima dele, e a taxa que a pessoa tinha acabado de pedir
 * sumia sem aviso nenhum.
 */
function temValorPendente(
  form: FormularioTransacao | undefined,
  original: Transaction | undefined,
  liquidoTravado: boolean,
): boolean {
  if (!form || !original) return false;

  const centavos = (valor: number) => Math.round(valor * 100);

  return (
    centavos(Number(form.valor ?? 0)) !== centavos(Number(original.valor ?? 0)) ||
    centavos(valorLiquidoEmEdicao(form, liquidoTravado)) !==
      centavos(valorLiquidoEfetivo(original))
  );
}

/**
 * Grava só o bruto e o líquido, no caminho que cada um exige.
 *
 * O bruto nao pode ir no PATCH — a rota o recusa, porque num pagamento de OS ou
 * venda mexer numa linha isolada quebraria o total do documento. Em lancamento
 * avulso nao ha total a preservar, e o caminho e o mesmo /ajustar-valores que o
 * rateio usa: ele grava dentro de uma transacao e recusa se o valor tiver mudado
 * desde que a tela abriu.
 *
 * O liquido, por sua vez, deixou de ser campo gravavel quando ha desconto
 * lancado: o gatilho o recalcula a partir das linhas, e mandar valorLiquido no
 * PATCH seria descartado em silencio. O campo passa a significar "quanto quero
 * que entre na conta", e o servidor traduz isso na linha de taxa.
 *
 * Fica fora do hook de proposito: e chamado tanto pelo "Salvar alteracoes"
 * quanto pela aba de acrescimos, que precisa acertar o banco antes de lancar uma
 * linha nova.
 */
async function gravarValores(
  form: FormularioTransacao,
  anterior: Transaction | undefined,
  bruto: number,
  liquido: number,
  liquidoTravado: boolean,
): Promise<void> {
  const brutoMudou =
    anterior != null &&
    Math.round(bruto * 100) !== Math.round(Number(anterior.valor ?? 0) * 100);

  const liquidoMudou =
    anterior != null &&
    Math.round(liquido * 100) !== Math.round(valorLiquidoEfetivo(anterior) * 100);

  /*
   * O ajuste de valores ja cuida do liquido — e e o unico que consegue.
   *
   * `/ajustes` traduz "quero receber X" em linha de taxa comparando com o bruto
   * QUE ESTA NO BANCO. Chamado antes do ajuste, ele ainda ve o bruto velho:
   * subir os dois campos juntos (100/100 para 200/200) pedia uma taxa de -100 e
   * o salvamento inteiro morria em "O valor liquido nao pode ser maior que o
   * bruto" — sem que nada estivesse errado na tela.
   *
   * A rota /ajustar-valores grava o bruto e so entao sincroniza a taxa, com o
   * numero novo. Havendo ajuste de bruto, a chamada separada e ao mesmo tempo
   * redundante e prematura.
   */
  const vaiAjustarBruto = brutoMudou && origemDaTransacao(anterior) == null;

  if (liquidoMudou && !vaiAjustarBruto && !liquidoTravado && tipoTemValorLiquido(form.tipo)) {
    await axios.put(
      `/api/transaction/${form.id}/ajustes`,
      { liquidoDesejado: liquido },
      { timeout: TIMEOUT_SALVAMENTO },
    );
  }

  if (vaiAjustarBruto) {
    await axios.post(
      `/api/transaction/${form.id}/ajustar-valores`,
      {
        itens: [
          {
            id: form.id,
            valor: bruto,
            valorLiquido: liquido,
            valorAnterior: Number(anterior.valor ?? 0),
            valorLiquidoAnterior: valorLiquidoEfetivo(anterior),
          },
        ],
      },
      { timeout: TIMEOUT_SALVAMENTO },
    );
  }
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
   * O líquido virou resultado em vez de campo.
   *
   * Acontece quando há desconto lançado que não é a taxa de recebimento: o
   * gatilho passa a derivá-lo das linhas, e nem a tela nem o servidor têm como
   * adivinhar qual delas o usuário quis mexer. A contagem crua de descontos não
   * servia — um desconto comercial sozinho parecia editável aqui e era recusado
   * lá, com uma mensagem que ainda por cima falava em "mais de um desconto".
   */
  const [liquidoTravado, setLiquidoTravado] = useState(false);

  const carregarTransacao = useCallback(async (id: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await axios.get(`/api/transaction/${id}`);
      const transacao: Transaction = resposta.data.data;
      original.current = transacao;
      setForm({
        ...transacao,
        data: paraDataDaApi(transacao.data),
        relacionarDocumento: temDocumentoRelacionado(transacao),
      });

      // Consulta separada e tolerante a falha: saber como estão os descontos é
      // conforto de tela, não pode impedir a edição de abrir.
      void axios
        .get(`/api/transaction/${id}/ajustes`)
        .then((r) => setLiquidoTravado(!taxaEhOUnicoDesconto(r.data?.data ?? [])))
        .catch(() => setLiquidoTravado(false));
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
    (transacao: TotaisDaTransacao | undefined, travouOLiquido?: boolean) => {
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

      if (typeof travouOLiquido === "boolean") {
        setLiquidoTravado(travouOLiquido);
      }
    },
    [],
  );

  const valoresPendentes = temValorPendente(form, original.current, liquidoTravado);

  /**
   * Põe no banco o bruto e o líquido que estão na tela, sem tocar no resto.
   *
   * Serve à aba de acréscimos e descontos, que grava na hora. Lançar uma linha
   * faz o servidor recalcular a transação inteira a partir do banco, e um
   * líquido digitado e não salvo era simplesmente perdido nessa volta.
   *
   * A ordem é o que resolve: o líquido pendente vira linha de taxa ANTES de a
   * linha nova entrar, então ele é calculado sobre o bruto de agora. Digitar 140
   * num bruto de 160 e depois lançar 40 de acréscimo dá taxa de 20 e líquido de
   * 180 — a taxa que foi pedida, sobre o valor em que foi pedida. Aplicar as
   * duas coisas ao mesmo tempo é que exigiria adivinhar qual dos dois números o
   * usuário quis manter.
   */
  const sincronizarValores = useCallback(async (): Promise<boolean> => {
    if (!form) return false;
    if (!temValorPendente(form, original.current, liquidoTravado)) return true;

    const bruto = Number(form.valor ?? 0);
    const liquido = valorLiquidoEmEdicao(form, liquidoTravado);

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

    try {
      await gravarValores(form, original.current, bruto, liquido, liquidoTravado);
      return true;
    } catch (error) {
      toast.error("Não foi possível salvar o valor digitado", {
        description: mensagemDoErro(error, "Tente novamente."),
      });
      return false;
    }
  }, [form, liquidoTravado]);

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

    if (form.relacionarDocumento && !form.documento_tipo_id) {
      toast.error("Selecione o tipo do documento relacionado.");
      return false;
    }

    const bruto = Number(form.valor ?? 0);
    // Para despesa/depósito isto devolve o próprio bruto: não existe taxa de
    // maquineta ali, e o líquido só precisa acompanhar para o fluxo de caixa
    // (que exibe o líquido na coluna de valor) não mostrar R$ 0,00 na linha.
    //
    // Com o líquido travado o número sai dos descontos, não do que está
    // guardado: quem mexeu no bruto mexeu no líquido junto, e mandar o antigo
    // faria o servidor tentar uma taxa que ninguém pediu.
    const liquido = valorLiquidoEmEdicao(form, liquidoTravado);

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
      await gravarValores(form, original.current, bruto, liquido, liquidoTravado);

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
          documento_tipo_id: form.relacionarDocumento
            ? (form.documento_tipo_id ?? null)
            : null,
          documento_numero: form.relacionarDocumento
            ? (form.documento_numero ?? null)
            : null,
          documento_serie: form.relacionarDocumento
            ? (form.documento_serie ?? null)
            : null,
          documento_chave: form.relacionarDocumento
            ? (form.documento_chave ?? null)
            : null,
          documento_emitido_em: form.relacionarDocumento
            ? (form.documento_emitido_em ?? null)
            : null,
          documento_valor: form.relacionarDocumento
            ? (form.documento_valor ?? null)
            : null,
          documento_observacao: form.relacionarDocumento
            ? (form.documento_observacao ?? null)
            : null,
          // `pendente` fica de fora: a rota recusa alterá-lo, e mandar o valor
          // atual só criaria risco de recusa falsa se o form dessincronizasse.
        },
        { timeout: TIMEOUT_SALVAMENTO },
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
    // `liquidoTravado` decide se o líquido ainda pode ser editado por aqui. Fora
    // da lista, o salvamento ficaria com o estado do momento em que a tela
    // montou e voltaria a mexer na taxa depois de o usuário ter lançado um
    // segundo desconto.
  }, [form, liquidoTravado]);

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
    /** Há desconto que não é a taxa: o líquido é resultado, não campo. */
    liquidoTravado,
    /** Bruto ou líquido digitados e ainda não salvos. */
    valoresPendentes,
    sincronizarValores,
    aplicarTotais,
    recarregarContextoSilencioso,
  };
}
