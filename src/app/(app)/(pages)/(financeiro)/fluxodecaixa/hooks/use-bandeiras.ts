"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";

import type { Bandeira } from "../types";

/**
 * Bandeiras ativas, com a taxa por faixa de parcelamento.
 *
 * O catálogo inteiro vem numa consulta só, na abertura do diálogo, e o par
 * (conta bancária, forma de pagamento) filtra o que já está em memória. Antes o
 * filtro ia para o servidor, e a lista só era buscada quando os dois campos
 * estavam preenchidos: o campo de bandeira nascia fora da tela, aparecia ao
 * escolher o banco e sumia de novo ao trocar para uma conta sem maquineta,
 * remontando o formulário embaixo do usuário a cada troca.
 *
 * `habilitado` desliga tudo onde a bandeira não tem vez — conciliação de OFX e
 * pagamento múltiplo —, e nesses casos nenhuma requisição é feita.
 */
export function useBandeiras(
  bancoId: number | null | undefined,
  metodoPagamento: string | null | undefined,
  habilitado = true,
) {
  const [catalogo, setCatalogo] = useState<Bandeira[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [bloquearAbertura, setBloquearAbertura] = useState(true);
  const [errorBandeiras, setErrorBandeiras] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregarBandeiras = useCallback(() => {
    setTentativa((atual) => atual + 1);
  }, []);

  /*
   * Cada abertura recomeça com o formulário em espera; uma nova tentativa
   * depois de uma falha, não. O erro é mostrado dentro do próprio campo, e
   * apagar a tela inteira para refazer a consulta levaria junto o que o usuário
   * já tivesse digitado.
   */
  useEffect(() => {
    setBloquearAbertura(true);
  }, [habilitado]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogo([]);
    setErrorBandeiras(null);
    setCarregando(true);
    if (!habilitado) return () => controller.abort();

    async function carregar() {
      try {
        const resposta = await axios.get<{ items: Bandeira[] }>(
          "/api/tipos/bandeiras",
          {
            params: { ativo: "true" },
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setCatalogo(
          (resposta.data?.items ?? []).filter(
            (bandeira) => bandeira.ativo && bandeira.parcelas.length > 0,
          ),
        );
      } catch (erro) {
        if (controller.signal.aborted || axios.isCancel(erro)) return;
        console.error("Erro ao carregar bandeiras:", erro);
        setErrorBandeiras("Não foi possível carregar as taxas de cartão.");
      } finally {
        if (!controller.signal.aborted) {
          setCarregando(false);
          setBloquearAbertura(false);
        }
      }
    }
    void carregar();
    return () => controller.abort();
  }, [habilitado, tentativa]);

  // O método vem do enum, em maiúsculas, mas o formulário aceita o valor de
  // fora (OS, venda, evento) sem normalizar — o mesmo cuidado que a rota tinha
  // quando o filtro era dela.
  const bandeiras = useMemo(
    () =>
      habilitado && bancoId && metodoPagamento
        ? catalogo.filter(
            (bandeira) =>
              bandeira.bancoId === Number(bancoId) &&
              bandeira.metodoPagamento === metodoPagamento.trim().toUpperCase(),
          )
        : [],
    [habilitado, bancoId, metodoPagamento, catalogo],
  );

  return {
    bandeiras,
    loadingBandeiras: habilitado && carregando,
    /** Só a primeira carga de cada abertura segura o formulário. */
    carregandoAbertura: habilitado && bloquearAbertura,
    errorBandeiras: habilitado ? errorBandeiras : null,
    recarregarBandeiras,
  };
}
