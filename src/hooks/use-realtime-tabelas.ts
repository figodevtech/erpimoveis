"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Assina mudanças de tabelas do Postgres com um canal só por tabela.
 *
 * Cada subscription de Realtime custa CPU no banco em cada volta do
 * `realtime.apply_rls`, e o custo cresce mais que proporcionalmente ao número
 * delas — medido em produção, um banco com 15 inscrições gastava 164 ms por
 * volta contra 22 ms de outro com 8. Por isso aqui os canais são
 * compartilhados: dois componentes que olham a mesma tabela usam a mesma
 * inscrição, e ela só é derrubada quando o último deles sai.
 *
 * O callback fica guardado numa ref de propósito. Antes disto cada tela
 * passava a própria função de recarregar direto na lista de dependências do
 * efeito, e como essas funções mudam de identidade a cada render, a inscrição
 * era destruída e recriada a cada tecla digitada num campo de busca.
 */

type Ouvinte = () => void;

const canais = new Map<string, { canal: RealtimeChannel; ouvintes: Set<Ouvinte> }>();

function assinarTabela(tabela: string, ouvinte: Ouvinte) {
  let entrada = canais.get(tabela);

  if (!entrada) {
    const ouvintes = new Set<Ouvinte>();
    const canal = supabase
      .channel(`erp:${tabela}`)
      .on("postgres_changes", { event: "*", schema: "public", table: tabela }, () => {
        // Cópia da lista: um ouvinte pode se desinscrever durante o aviso.
        for (const notificar of [...ouvintes]) notificar();
      })
      .subscribe();

    entrada = { canal, ouvintes };
    canais.set(tabela, entrada);
  }

  entrada.ouvintes.add(ouvinte);

  return () => {
    const atual = canais.get(tabela);
    if (!atual) return;

    atual.ouvintes.delete(ouvinte);
    if (atual.ouvintes.size === 0) {
      canais.delete(tabela);
      void supabase.removeChannel(atual.canal);
    }
  };
}

/**
 * @param tabelas Tabelas de `public` a observar.
 * @param aoMudar Chamado a cada INSERT, UPDATE ou DELETE. Pode trocar de
 *   identidade entre renders sem recriar a inscrição.
 */
export function useRealtimeTabelas(tabelas: string[], aoMudar: () => void) {
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  // String em vez do array: um literal novo a cada render reiniciaria o efeito.
  const chave = [...new Set(tabelas)].sort().join(",");

  useEffect(() => {
    if (!chave) return;

    const ouvinte: Ouvinte = () => aoMudarRef.current();
    const cancelar = chave.split(",").map((tabela) => assinarTabela(tabela, ouvinte));

    return () => {
      for (const encerrar of cancelar) encerrar();
    };
  }, [chave]);
}
