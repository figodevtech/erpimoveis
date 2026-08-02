// src/app/(app)/(pages)/meu-perfil/meu-perfil-client.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MotionConfig, motion } from "motion/react";
import { Tabs } from "@/components/ui/tabs";
import { buscarPerfil, buscarResumo } from "./lib/api";
import { periodoPadrao } from "./lib/format";
import { MOLA_SUAVE, containerEscalonado, itemQueSobe } from "./lib/motion";
import { ABAS, ListaDeAbas, PainelDeAba } from "./components/abas-central";
import { PerfilHeader } from "./components/perfil-header";
import { PeriodoFilter } from "./components/periodo-filter";
import { ResumoCards } from "./components/resumo-cards";
import { TabelaMeusServicos } from "./components/tabela-meus-servicos";
import { TabelaMinhasOrdens } from "./components/tabela-minhas-ordens";
import { TabelaMinhasVendas } from "./components/tabela-minhas-vendas";
import type { AbaCentral, MeuPerfil, MeuResumo, Periodo } from "./types";

function abaValida(valor: string | null): AbaCentral {
  return ABAS.some((aba) => aba.chave === valor) ? (valor as AbaCentral) : "vendas";
}

export function MeuPerfilClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Periodo e aba vivem na URL: a tela fica compartilhavel e sobrevive ao reload.
  const padrao = useMemo(() => periodoPadrao(), []);
  const de = searchParams.get("de") ?? padrao.de;
  const ate = searchParams.get("ate") ?? padrao.ate;
  const aba = abaValida(searchParams.get("tab"));

  // Identidade estavel: as tabelas usam `periodo` como dependencia de busca.
  const periodo = useMemo<Periodo>(() => ({ de, ate }), [de, ate]);

  const [perfil, setPerfil] = useState<MeuPerfil | null>(null);
  const [carregandoPerfil, setCarregandoPerfil] = useState(true);

  // Mesmo padrao do useListaPaginada: o estado guarda a chave da consulta que o
  // produziu, entao "carregando" e derivado em vez de setado dentro do efeito.
  const chaveResumo = `${de}|${ate}`;
  const [estadoResumo, setEstadoResumo] = useState<{
    chave: string;
    dados: MeuResumo | null;
    erro: boolean;
  }>({ chave: "", dados: null, erro: false });
  const carregandoResumo = estadoResumo.chave !== chaveResumo;

  const atualizarUrl = useCallback(
    (mudancas: Partial<{ de: string; ate: string; tab: AbaCentral }>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("de", mudancas.de ?? de);
      params.set("ate", mudancas.ate ?? ate);
      params.set("tab", mudancas.tab ?? aba);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [aba, ate, de, pathname, router, searchParams],
  );

  useEffect(() => {
    const controller = new AbortController();

    buscarPerfil(controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setPerfil(dados);
      })
      .catch(() => {
        // O cabecalho degrada para o titulo generico; nao vale bloquear a tela.
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregandoPerfil(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    buscarResumo(periodo, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstadoResumo({ chave: chaveResumo, dados, erro: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setEstadoResumo({ chave: chaveResumo, dados: null, erro: true });
      });

    return () => controller.abort();
  }, [chaveResumo, periodo]);

  return (
    // `reducedMotion="user"` respeita a preferencia do sistema em toda a arvore:
    // quem pede menos movimento recebe so as transicoes de opacidade.
    <MotionConfig reducedMotion="user">
      <motion.div
        className="flex flex-col gap-4 p-4 md:p-6"
        variants={containerEscalonado}
        initial="oculto"
        animate="visivel"
      >
        <PerfilHeader perfil={perfil} carregando={carregandoPerfil} />

        <motion.div variants={itemQueSobe}>
          <PeriodoFilter
            periodo={periodo}
            onChange={(novo) => atualizarUrl({ de: novo.de, ate: novo.ate })}
          />
        </motion.div>

        {estadoResumo.erro && !carregandoResumo ? (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOLA_SUAVE}
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            Não foi possível carregar o resumo do período. As listas abaixo continuam funcionando.
          </motion.p>
        ) : (
          <ResumoCards resumo={estadoResumo.dados} carregando={carregandoResumo} />
        )}

        <motion.div variants={itemQueSobe}>
          <Tabs value={aba} onValueChange={(valor) => atualizarUrl({ tab: abaValida(valor) })}>
            <ListaDeAbas ativa={aba} />

            {/* Os paineis ficam montados: a busca e controlada pelo prop
                `ativo`, entao aba oculta nao dispara requisicao. */}
            <PainelDeAba chave="vendas" ativa={aba}>
              <TabelaMinhasVendas periodo={periodo} ativo={aba === "vendas"} />
            </PainelDeAba>

            <PainelDeAba chave="ordens" ativa={aba}>
              <TabelaMinhasOrdens periodo={periodo} ativo={aba === "ordens"} />
            </PainelDeAba>

            <PainelDeAba chave="servicos" ativa={aba}>
              <TabelaMeusServicos periodo={periodo} ativo={aba === "servicos"} />
            </PainelDeAba>
          </Tabs>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}
