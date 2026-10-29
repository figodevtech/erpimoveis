// src/app/(app)/(pages)/meu-perfil/meu-perfil-client.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { MotionConfig, motion } from "motion/react";
import { Tabs } from "@/components/ui/tabs";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { toast } from "@/lib/toast";
import { buscarPerfil, buscarResumo, buscarUsuariosDoSeletor, enviarFotoPerfil } from "./lib/api";
import { periodoPadrao } from "./lib/format";
import { MOLA_SUAVE, containerEscalonado, itemQueSobe } from "./lib/motion";
import { ABAS, ListaDeAbas, PainelDeAba } from "./components/abas-central";
import { PerfilHeader } from "./components/perfil-header";
import { PeriodoFilter } from "./components/periodo-filter";
import { ResumoCards } from "./components/resumo-cards";
import { TabelaMinhasVendas } from "./components/tabela-minhas-vendas";
import { UsuarioCombobox } from "./components/usuario-combobox";
import type { AbaCentral, MeuPerfil, MeuResumo, Periodo } from "./types";

function abaValida(valor: string | null): AbaCentral {
  return ABAS.some((aba) => aba.chave === valor) ? (valor as AbaCentral) : "vendas";
}

export function MeuPerfilClient() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Periodo e aba vivem na URL: a tela fica compartilhavel e sobrevive ao reload.
  const padrao = useMemo(() => periodoPadrao(), []);
  const de = searchParams.get("de") ?? padrao.de;
  const ate = searchParams.get("ate") ?? padrao.ate;
  const abaDaUrl = abaValida(searchParams.get("tab"));
  const [aba, setAba] = useState<AbaCentral>(abaDaUrl);
  const usuarioId = searchParams.get("usuarioId") ?? undefined;
  const usuarioLogadoId = String((session?.user as { id?: string } | undefined)?.id ?? "");
  const podeVerUsuarios = permissionSetHas(
    (session?.user as { permissoes?: unknown } | undefined)?.permissoes,
    PERMS.USUARIOS_VER_PERFIS,
  );
  const [usuarios, setUsuarios] = useState<Array<{ id: string; nome: string; email: string }>>([]);
  const [perfilEnviandoFoto, setPerfilEnviandoFoto] = useState<string | null>(null);

  // Identidade estavel: as tabelas usam `periodo` como dependencia de busca.
  const periodo = useMemo<Periodo>(() => ({ de, ate }), [de, ate]);

  const chavePerfil = usuarioId ?? "me";
  const [estadoPerfil, setEstadoPerfil] = useState<{ chave: string; dados: MeuPerfil | null }>({
    chave: "",
    dados: null,
  });
  const perfil = estadoPerfil.chave === chavePerfil ? estadoPerfil.dados : null;
  const carregandoPerfil = estadoPerfil.chave !== chavePerfil;

  // Mesmo padrao do useListaPaginada: o estado guarda a chave da consulta que o
  // produziu, entao "carregando" e derivado em vez de setado dentro do efeito.
  const chaveResumo = `${de}|${ate}|${usuarioId ?? "me"}`;
  const [estadoResumo, setEstadoResumo] = useState<{
    chave: string;
    dados: MeuResumo | null;
    erro: boolean;
  }>({ chave: "", dados: null, erro: false });
  const carregandoResumo = estadoResumo.chave !== chaveResumo;

  const atualizarUrl = useCallback(
    (mudancas: Partial<{ de: string; ate: string; tab: AbaCentral; usuarioId: string | null }>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("de", mudancas.de ?? de);
      params.set("ate", mudancas.ate ?? ate);
      params.set("tab", mudancas.tab ?? aba);
      if (mudancas.usuarioId === null) params.delete("usuarioId");
      else if (mudancas.usuarioId) params.set("usuarioId", mudancas.usuarioId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [aba, ate, de, pathname, router, searchParams],
  );

  // A aba e uma visao inteiramente client-side. Usar `router.replace` aqui
  // faria o controle esperar uma navegacao do App Router (esta pagina e
  // force-dynamic) antes de refletir o clique. O estado local troca a tela no
  // mesmo frame; a History API mantem a URL compartilhavel e continua
  // sincronizada com `useSearchParams` pelo proprio Next.js.
  const trocarAba = useCallback(
    (valor: string) => {
      const proximaAba = abaValida(valor);
      setAba(proximaAba);

      const params = new URLSearchParams(window.location.search);
      params.set("de", de);
      params.set("ate", ate);
      params.set("tab", proximaAba);
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [ate, de, pathname],
  );

  // Links internos, historico do navegador e qualquer outra atualizacao
  // externa da URL ainda comandam a aba exibida.
  useEffect(() => {
    setAba(abaDaUrl);
  }, [abaDaUrl]);

  useEffect(() => {
    if (!podeVerUsuarios) return;
    const controller = new AbortController();
    buscarUsuariosDoSeletor(controller.signal)
      .then((lista) => {
        if (!controller.signal.aborted) setUsuarios(lista);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [podeVerUsuarios]);

  useEffect(() => {
    const controller = new AbortController();

    buscarPerfil(usuarioId, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstadoPerfil({ chave: chavePerfil, dados });
      })
      .catch(() => {
        // O cabecalho degrada para o titulo generico; nao vale bloquear a tela.
        if (!controller.signal.aborted) setEstadoPerfil({ chave: chavePerfil, dados: null });
      })

    return () => controller.abort();
  }, [chavePerfil, usuarioId]);

  useEffect(() => {
    const controller = new AbortController();

    buscarResumo(periodo, usuarioId, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstadoResumo({ chave: chaveResumo, dados, erro: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setEstadoResumo({ chave: chaveResumo, dados: null, erro: true });
      });

    return () => controller.abort();
  }, [chaveResumo, periodo, usuarioId]);

  const alterarFoto = useCallback(
    async (file: File) => {
      const chaveAlvo = chavePerfil;
      const toastId = toast.loading("Salvando foto do perfil...");
      setPerfilEnviandoFoto(chaveAlvo);

      try {
        const { fotoUrl } = await enviarFotoPerfil(file, usuarioId);
        setEstadoPerfil((atual) =>
          atual.chave === chaveAlvo && atual.dados
            ? { ...atual, dados: { ...atual.dados, fotoUrl } }
            : atual,
        );
        toast.success("Foto do perfil atualizada.", { id: toastId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível salvar a foto do perfil.", {
          id: toastId,
        });
      } finally {
        setPerfilEnviandoFoto((atual) => (atual === chaveAlvo ? null : atual));
      }
    },
    [chavePerfil, usuarioId],
  );

  return (
    // `reducedMotion="user"` respeita a preferencia do sistema em toda a arvore:
    // quem pede menos movimento recebe so as transicoes de opacidade.
    <MotionConfig reducedMotion="user">
      <motion.div
        className="flex flex-col gap-4"
        variants={containerEscalonado}
        initial="oculto"
        animate="visivel"
      >
        <PerfilHeader
          perfil={perfil}
          carregando={carregandoPerfil}
          enviandoFoto={perfilEnviandoFoto === chavePerfil}
          onFotoSelecionada={perfil ? alterarFoto : undefined}
          seletorUsuario={podeVerUsuarios ? (
            <UsuarioCombobox
              usuarios={usuarios}
              value={usuarioId ?? usuarioLogadoId}
              usuarioLogadoId={usuarioLogadoId}
              onValueChange={(id) => atualizarUrl({ usuarioId: id === usuarioLogadoId ? null : id })}
            />
          ) : undefined}
        />

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
          <Tabs value={aba} onValueChange={trocarAba}>
            <ListaDeAbas />

            {/* Os paineis ficam montados: a busca e controlada pelo prop
                `ativo`, entao aba oculta nao dispara requisicao. */}
            <PainelDeAba chave="vendas" ativa={aba}>
              <TabelaMinhasVendas periodo={periodo} ativo={aba === "vendas"} usuarioId={usuarioId} />
            </PainelDeAba>
          </Tabs>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}
