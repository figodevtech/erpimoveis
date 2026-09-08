"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  comoMovimentoAnalisado,
  conflitosDeSelecao,
  decisaoCompleta,
  decisoesIniciais,
  mensagemDeErro,
  resolvido,
} from "./apresentacao";
import type {
  Decisao,
  ImportacaoDetalhada,
  MovimentoAnalisado,
  MovimentoGravado,
  PreviewDoExtrato,
  ResultadoConciliacao,
} from "./types";

interface Sessao {
  preview: PreviewDoExtrato | null;
  importacao: ImportacaoDetalhada | null;
  movimentos: MovimentoAnalisado[];
}

export function useConciliacao(onConcluido: () => void) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [bancoId, setBancoId] = useState("");
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<
    "ANALISE" | "CARREGAR" | "CONFIRMAR" | null
  >(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoConciliacao | null>(null);
  const [ultimaOperacao, setUltimaOperacao] =
    useState<ResultadoConciliacao | null>(null);
  const trava = useRef(false);
  const leitura = useRef<AbortController | null>(null);
  useEffect(() => () => leitura.current?.abort(), []);

  const receber = useCallback((nova: Sessao) => {
    setSessao(nova);
    setDecisoes(decisoesIniciais(nova.movimentos));
    setMarcadas(new Set());
  }, []);

  const carregar = useCallback(
    async (id: number) => {
      leitura.current?.abort();
      const controller = new AbortController();
      leitura.current = controller;
      const res = await axios.get<{
        data: {
          importacao: ImportacaoDetalhada;
          movimentos: MovimentoGravado[];
        };
      }>(`/api/financeiro/conciliacao/ofx/${id}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      receber({
        importacao: res.data.data.importacao,
        preview: null,
        movimentos: res.data.data.movimentos.map(comoMovimentoAnalisado),
      });
      setBancoId(String(res.data.data.importacao.banco_id));
    },
    [receber],
  );

  async function abrir(id: number) {
    if (trava.current) return false;
    trava.current = true;
    setOcupado("CARREGAR");
    setErro(null);
    try {
      await carregar(id);
      setUltimaOperacao(null);
      return true;
    } catch (e) {
      if (!axios.isCancel(e))
        setErro(
          mensagemDeErro(
            e,
            "Não foi possível carregar esta conciliação. Tente abrir novamente.",
          ),
        );
      return false;
    } finally {
      setOcupado(null);
      trava.current = false;
    }
  }

  async function analisar(conta = bancoId) {
    if (!arquivo || trava.current) return;
    trava.current = true;
    setOcupado("ANALISE");
    setErro(null);
    leitura.current?.abort();
    const controller = new AbortController();
    leitura.current = controller;
    try {
      const dados = new FormData();
      dados.append("arquivo", arquivo);
      if (conta) dados.append("bancoId", conta);
      const res = await axios.post<{ data: PreviewDoExtrato }>(
        "/api/financeiro/conciliacao/ofx/preview",
        dados,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      receber({
        preview: res.data.data,
        importacao: null,
        movimentos: res.data.data.movimentos,
      });
      setBancoId(String(res.data.data.conta.id));
      setUltimaOperacao(null);
    } catch (e) {
      if (!axios.isCancel(e))
        setErro(
          mensagemDeErro(
            e,
            "Não foi possível analisar o extrato. Tente novamente.",
          ),
        );
    } finally {
      setOcupado(null);
      trava.current = false;
    }
  }

  const selecao = useMemo(() => {
    const linhas =
      sessao?.movimentos.filter(
        (m) => marcadas.has(m.fingerprint) && !resolvido(m),
      ) ?? [];
    const completas = linhas.filter((m) =>
      decisaoCompleta(decisoes[m.fingerprint]),
    );
    const enviar = completas.map((m) => decisoes[m.fingerprint]);
    return {
      linhas,
      enviar,
      incompletas: linhas.length - completas.length,
      conflitos: conflitosDeSelecao(enviar),
    };
  }, [sessao, marcadas, decisoes]);

  async function confirmar(): Promise<boolean> {
    if (
      trava.current ||
      !sessao ||
      selecao.incompletas ||
      selecao.conflitos.size ||
      sessao.preview?.arquivo.jaImportado
    )
      return false;
    if (sessao.importacao && !selecao.enviar.length) return false;
    trava.current = true;
    setOcupado("CONFIRMAR");
    setErro(null);
    let aplicado = false;
    try {
      let retorno: ResultadoConciliacao;
      if (sessao.importacao) {
        const res = await axios.post<{ data: ResultadoConciliacao }>(
          `/api/financeiro/conciliacao/ofx/${sessao.importacao.id}/conciliar`,
          { decisoes: selecao.enviar },
        );
        retorno = { ...res.data.data, importacaoId: sessao.importacao.id };
      } else {
        if (!arquivo || !sessao.preview) return false;
        const dados = new FormData();
        dados.append("arquivo", arquivo);
        dados.append("bancoId", String(sessao.preview.conta.id));
        dados.append("decisoes", JSON.stringify(selecao.enviar));
        const res = await axios.post<{ data: ResultadoConciliacao }>(
          "/api/financeiro/conciliacao/ofx/importar",
          dados,
        );
        retorno = res.data.data;
      }
      aplicado = true;
      setResultado(retorno);
      setUltimaOperacao(retorno);
      setMarcadas(new Set());
      onConcluido();
      // A resposta confirma o que foi aplicado; a leitura seguinte atualiza sugestões e progresso.
      try {
        if (retorno.importacaoId) await carregar(retorno.importacaoId);
      } catch {
        // Bloqueia reenvio de uma análise antiga quando a gravação funcionou e a releitura falhou.
        setSessao(null);
        setErro(
          "A operação foi registrada, mas não foi possível atualizar a tabela. Abra a conciliação pelo histórico para continuar.",
        );
      }
      return true;
    } catch (e) {
      setErro(
        mensagemDeErro(
          e,
          "Não foi possível confirmar o resultado da operação. Consulte o histórico antes de tentar novamente.",
        ),
      );
      return aplicado;
    } finally {
      setOcupado(null);
      trava.current = false;
    }
  }

  function decidir(
    m: MovimentoAnalisado,
    d: Decisao | null,
    sugestao?: MovimentoAnalisado["analise"]["sugestoes"][number],
  ) {
    if (ocupado || resolvido(m)) return;
    if (sugestao)
      setSessao((s) =>
        s
          ? {
              ...s,
              movimentos: s.movimentos.map((linha) =>
                linha.fingerprint === m.fingerprint
                  ? {
                      ...linha,
                      analise: {
                        ...linha.analise,
                        sugestoes: [
                          ...linha.analise.sugestoes.filter(
                            (item) => item.transacaoId !== sugestao.transacaoId,
                          ),
                          sugestao,
                        ],
                      },
                    }
                  : linha,
              ),
            }
          : s,
      );
    setDecisoes((atual) => {
      const proximo = { ...atual };
      if (d) proximo[m.fingerprint] = d;
      else delete proximo[m.fingerprint];
      return proximo;
    });
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      if (d) proximo.add(m.fingerprint);
      else proximo.delete(m.fingerprint);
      return proximo;
    });
  }
  function marcarVarios(chaves: string[], marcar: boolean) {
    if (ocupado) return;
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      for (const chave of chaves) {
        if (marcar) proximo.add(chave);
        else proximo.delete(chave);
      }
      return proximo;
    });
  }
  function ignorarSelecionados() {
    if (ocupado) return;
    setDecisoes((atual) => {
      const proximo = { ...atual };
      for (const m of selecao.linhas)
        proximo[m.fingerprint] = {
          fingerprint: m.fingerprint,
          movimentoId: m.movimentoId ?? undefined,
          acao: "IGNORAR",
        };
      return proximo;
    });
  }
  function limpar() {
    if (ocupado) return;
    setSessao(null);
    setArquivo(null);
    setDecisoes({});
    setMarcadas(new Set());
    setErro(null);
    setResultado(null);
    setUltimaOperacao(null);
  }
  const falhas = useMemo(
    () =>
      new Map(
        (ultimaOperacao?.falhas ?? []).map((f) => [
          f.fingerprint ??
            sessao?.movimentos.find((m) => m.movimentoId === f.movimentoId)
              ?.fingerprint ??
            "",
          f.erro ?? "Não foi possível processar este movimento.",
        ]),
      ),
    [ultimaOperacao, sessao],
  );
  return {
    arquivo,
    setArquivo,
    bancoId,
    setBancoId,
    sessao,
    decisoes,
    marcadas,
    ocupado,
    erro,
    resultado,
    setResultado,
    ultimaOperacao,
    falhas,
    selecao,
    abrir,
    analisar,
    confirmar,
    decidir,
    marcarVarios,
    ignorarSelecionados,
    limpar,
  };
}
