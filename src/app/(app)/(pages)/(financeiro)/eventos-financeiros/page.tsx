"use client";

import axios from "axios";
import { ArrowDown, ArrowUp, ClipboardList, Wallet } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { montarLinhas, type EventoFinanceiroBruto } from "@/components/financeiro/eventos-financeiros/modelo";
import type { ResultadoSelecaoDeEventos } from "@/lib/financeiro/eventos-financeiros-selection";
import formatarEmReal from "@/utils/formatarEmReal";

import { TabelaEventos } from "./components/tabela-eventos";
import {
  FILTROS_VAZIOS,
  type FiltrosDeEventos,
  type Paginacao,
  type SituacaoEvento,
  type TotaisDaFila,
  type UsuarioDeEvento,
} from "./types";

/**
 * A fila de eventos financeiros das ordens.
 *
 * A recepção lança despesa na OS o dia inteiro; quem transforma isso em título
 * no a pagar é o financeiro. Sem esta tela, o único caminho até um evento era
 * abrir a OS uma a uma — e o que ninguém abria, ninguém lançava: a despesa
 * ficava fora do caixa e só reaparecia na DRE, sem contrapartida.
 *
 * Por isso ela abre em "Não lançados". É uma fila de trabalho antes de ser um
 * relatório.
 */

const TOTAIS_VAZIOS: TotaisDaFila = {
  receita: 0,
  despesa: 0,
  liquido: 0,
  quantidade: 0,
  ordens: 0,
  selecionaveis: 0,
};

function Cartao({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  tom,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  icon: React.ElementType;
  tom: "amber" | "red" | "emerald" | "sky";
}) {
  const tons = {
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  } as const;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </span>
        <div className={`rounded-lg p-2 ${tons[tom]}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{valor}</p>
      {detalhe ? <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

export default function EventosFinanceirosPage() {
  const { data: session } = useSession();
  const permissoesUsuario = (session?.user as any)?.permissoes;

  const permissoes = useMemo(
    () => ({
      podeEditar: permissionSetHas(permissoesUsuario, PERMS.FINANCEIRO_EDITAR),
      podeExcluir: permissionSetHas(permissoesUsuario, PERMS.FINANCEIRO_EXCLUIR),
      podeLancar: permissionSetHas(permissoesUsuario, PERMS.FINANCEIRO_CRIAR),
    }),
    [permissoesUsuario],
  );

  const [eventos, setEventos] = useState<EventoFinanceiroBruto[]>([]);
  const [totais, setTotais] = useState<TotaisDaFila>(TOTAIS_VAZIOS);
  const [isLoading, setIsLoading] = useState(false);
  const [situacao, setSituacao] = useState<SituacaoEvento>("NAO_LANCADO");
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeEventos>(FILTROS_VAZIOS);
  const [agruparPorOs, setAgruparPorOs] = useState(true);
  const [usuarios, setUsuarios] = useState<UsuarioDeEvento[]>([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(true);
  const [paginacao, setPaginacao] = useState<Paginacao>({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 1,
  });

  /**
   * Cada busca leva um número; só a mais recente pode escrever na tela.
   *
   * Trocar de aba dispara uma busca nova sem cancelar a anterior. Quando a
   * antiga responde depois, ela sobrescreveria a lista e a aba ficaria marcada
   * numa visão exibindo a outra. Mesma guarda do fluxo de caixa.
   */
  const buscaAtual = useRef(0);

  const parametrosDaConsulta = useCallback(
    (pagina: number, limite: number) => ({
      page: pagina,
      limit: limite,
      situacao,
      search: busca || undefined,
      natureza: filtros.natureza || undefined,
      origem: filtros.origem || undefined,
      osId: filtros.osId || undefined,
      usuarioId: filtros.usuarioId || undefined,
      dateFrom: filtros.dateFrom || undefined,
      dateTo: filtros.dateTo || undefined,
      agruparPorOs: agruparPorOs ? "1" : "0",
    }),
    [agruparPorOs, busca, filtros, situacao],
  );

  useEffect(() => {
    let ativo = true;
    setCarregandoUsuarios(true);
    axios
      .get("/api/eventos-financeiros/usuarios")
      .then((response) => {
        if (ativo) setUsuarios(response.data?.usuarios ?? []);
      })
      .catch(() => {
        if (ativo) setUsuarios([]);
      })
      .finally(() => {
        if (ativo) setCarregandoUsuarios(false);
      });

    return () => {
      ativo = false;
    };
  }, []);

  const buscarEventos = useCallback(
    async (pagina: number, limite: number) => {
      const estaBusca = ++buscaAtual.current;
      setIsLoading(true);
      try {
        const response = await axios.get("/api/eventos-financeiros", {
          params: parametrosDaConsulta(pagina, limite),
        });
        if (estaBusca !== buscaAtual.current) return;
        setEventos(response.data?.data ?? []);
        setTotais(response.data?.totais ?? TOTAIS_VAZIOS);
        setPaginacao((atual) => ({ ...atual, ...(response.data?.pagination ?? {}) }));
      } catch {
        if (estaBusca !== buscaAtual.current) return;
        setEventos([]);
        setTotais(TOTAIS_VAZIOS);
      } finally {
        if (estaBusca === buscaAtual.current) setIsLoading(false);
      }
    },
    [parametrosDaConsulta],
  );

  // Mudou filtro, aba ou busca? A consulta recomeça da primeira página — a
  // atual pode nem existir no novo resultado.
  useEffect(() => {
    void buscarEventos(1, paginacao.limit);
  }, [buscarEventos, paginacao.limit]);

  const irParaPagina = useCallback(
    (pagina: number) => {
      setPaginacao((atual) => ({ ...atual, page: pagina }));
      void buscarEventos(pagina, paginacao.limit);
    },
    [buscarEventos, paginacao.limit],
  );

  // Trocar o tamanho da página volta para a primeira: a atual pode ficar fora
  // do novo total. Quem refaz a busca é o efeito que observa o limite.
  const trocarLimite = useCallback((limite: number) => {
    setPaginacao((atual) => ({ ...atual, limit: limite, page: 1 }));
  }, []);

  const recarregar = useCallback(async () => {
    await buscarEventos(paginacao.page, paginacao.limit);
  }, [buscarEventos, paginacao.page, paginacao.limit]);

  const carregarSelecionaveisDoFiltro = useCallback(async (): Promise<ResultadoSelecaoDeEventos> => {
    try {
      const response = await axios.get("/api/eventos-financeiros", {
        params: {
          ...parametrosDaConsulta(1, 1),
          selecionaveis: "1",
        },
      });
      const data = Array.isArray(response.data?.data) ? response.data.data : [];
      return {
        eventos: data.map((evento: any) => ({
          id: Number(evento.id),
          osId: Number(evento.ordemservicoid),
          descricao: String(evento.descricao ?? "Despesa"),
          valor: Number(evento.valor ?? 0),
        })),
        total: Number(response.data?.total ?? data.length),
        limite: Number(response.data?.limite ?? 500),
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.error || "Erro ao selecionar as despesas do filtro.");
      }
      throw error;
    }
  }, [parametrosDaConsulta]);

  // A API já entrega a página na ordem correta. No modo agrupado, cada bloco
  // ordena seus próprios itens; no modo plano esta preservação mantém a
  // cronologia entre OS diferentes.
  const linhas = useMemo(
    () => montarLinhas(eventos, { preservarOrdem: true }),
    [eventos],
  );

  const escopoSelecao = useMemo(
    () => JSON.stringify({ situacao, busca, filtros }),
    [busca, filtros, situacao],
  );

  const rotuloDoPeriodo =
    totais.ordens === 1 ? "em 1 ordem" : `em ${totais.ordens} ordens`;

  return (
    <div className="space-y-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao
          titulo={situacao === "NAO_LANCADO" ? "A lançar" : "Eventos"}
          valor={String(totais.quantidade)}
          detalhe={rotuloDoPeriodo}
          icon={ClipboardList}
          tom="amber"
        />
        <Cartao
          titulo="Despesas"
          valor={formatarEmReal(totais.despesa)}
          detalhe={
            situacao === "NAO_LANCADO" ? "Ainda sem título no financeiro" : undefined
          }
          icon={ArrowDown}
          tom="red"
        />
        <Cartao
          titulo="Receitas"
          valor={formatarEmReal(totais.receita)}
          icon={ArrowUp}
          tom="emerald"
        />
        <Cartao
          titulo="Resultado"
          valor={formatarEmReal(totais.liquido)}
          detalhe="Receitas menos despesas do filtro"
          icon={Wallet}
          tom="sky"
        />
      </div>

      <TabelaEventos
        linhas={linhas}
        isLoading={isLoading}
        situacao={situacao}
        setSituacao={setSituacao}
        busca={busca}
        setBusca={setBusca}
        filtros={filtros}
        setFiltros={setFiltros}
        usuarios={usuarios}
        carregandoUsuarios={carregandoUsuarios}
        agruparPorOs={agruparPorOs}
        setAgruparPorOs={setAgruparPorOs}
        paginacao={paginacao}
        irParaPagina={irParaPagina}
        setLimit={trocarLimite}
        recarregar={recarregar}
        permissoes={permissoes}
        totalSelecionaveis={totais.selecionaveis}
        escopoSelecao={escopoSelecao}
        carregarSelecionaveisDoFiltro={carregarSelecionaveisDoFiltro}
      />
    </div>
  );
}
