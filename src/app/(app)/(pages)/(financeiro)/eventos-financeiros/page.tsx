"use client";

import axios from "axios";
import { AlertCircle, ArrowDownLeft, ArrowUpRight, ClipboardList, Wallet } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { montarLinhas, type EventoFinanceiroBruto } from "@/components/financeiro/eventos-financeiros/modelo";
import type { ResultadoSelecaoDeEventos } from "@/lib/financeiro/eventos-financeiros-selection";
import formatarEmReal from "@/utils/formatarEmReal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
 * A fila de eventos financeiros de OS e comissões de vendas.
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
  carregando,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  icon: React.ElementType;
  tom: "amber" | "red" | "emerald" | "sky";
  carregando: boolean;
}) {
  const tons = {
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  } as const;

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {titulo}
        </span>
        <div className={`rounded-lg p-2 ${tons[tom]}`}>
          <Icon className="size-4" />
        </div>
      </div>
      {carregando ? <Skeleton className="mt-3 h-8 w-full max-w-32" /> : <p className="mt-3 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{valor}</p>}
      {detalhe ? <p className="mt-2 text-xs text-muted-foreground">{detalhe}</p> : null}
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
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<SituacaoEvento>("NAO_LANCADO");
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDeEventos>(FILTROS_VAZIOS);
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
      documentoTipo: filtros.documentoTipo || undefined,
      usuarioId: filtros.usuarioId || undefined,
      dateFrom: filtros.dateFrom || undefined,
      dateTo: filtros.dateTo || undefined,
    }),
    [busca, filtros, situacao],
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
      setErro(null);
      try {
        const response = await axios.get("/api/eventos-financeiros", {
          params: parametrosDaConsulta(pagina, limite),
        });
        if (estaBusca !== buscaAtual.current) return;
        setEventos(response.data?.data ?? []);
        setTotais(response.data?.totais ?? TOTAIS_VAZIOS);
        setPaginacao((atual) => ({ ...atual, ...(response.data?.pagination ?? {}) }));
      } catch (error) {
        if (estaBusca !== buscaAtual.current) return;
        setEventos([]);
        setTotais(TOTAIS_VAZIOS);
        setErro(axios.isAxiosError(error) ? error.response?.data?.error || "Não foi possível carregar os eventos financeiros." : "Não foi possível carregar os eventos financeiros.");
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
          osId: evento.ordemservicoid == null ? null : Number(evento.ordemservicoid),
          vendaId: evento.vendaid == null ? null : Number(evento.vendaid),
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

  // Preserva a cronologia da API entre OS e vendas.
  const linhas = useMemo(
    () => montarLinhas(eventos, { preservarOrdem: true }),
    [eventos],
  );

  const escopoSelecao = useMemo(
    () => JSON.stringify({ situacao, busca, filtros }),
    [busca, filtros, situacao],
  );

  const rotuloDoPeriodo =
    `em ${totais.ordens} OS e ${totais.vendas ?? 0} vendas`;

  return (
    <div className="space-y-6 py-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Eventos financeiros</h1>
          <p className="mt-1 text-sm text-muted-foreground">Confira as movimentações de OS e comissões de vendas e organize os lançamentos no financeiro.</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">Totais do filtro aplicado</span>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Cartao
          titulo={situacao === "NAO_LANCADO" ? "A lançar" : "Eventos"}
          valor={erro ? "—" : String(totais.quantidade)}
          detalhe={rotuloDoPeriodo}
          icon={ClipboardList}
          tom="amber"
          carregando={isLoading}
        />
        <Cartao
          titulo="Despesas"
          valor={erro ? "—" : formatarEmReal(totais.despesa)}
          detalhe={
            situacao === "NAO_LANCADO" ? "Ainda sem título no financeiro" : undefined
          }
          icon={ArrowUpRight}
          tom="red"
          carregando={isLoading}
        />
        <Cartao
          titulo="Receitas"
          valor={erro ? "—" : formatarEmReal(totais.receita)}
          icon={ArrowDownLeft}
          tom="emerald"
          detalhe="Receitas registradas no período"
          carregando={isLoading}
        />
        <Cartao
          titulo="Resultado"
          valor={erro ? "—" : formatarEmReal(totais.liquido)}
          detalhe="Receitas menos despesas do filtro"
          icon={Wallet}
          tom="sky"
          carregando={isLoading}
        />
      </div>

      {erro ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="size-5 shrink-0 text-destructive" />
          <p className="flex-1">{erro}</p>
          <Button variant="outline" size="sm" onClick={() => void recarregar()}>Tentar novamente</Button>
        </div>
      ) : null}

      <TabelaEventos
        linhas={linhas}
        isLoading={isLoading}
        erro={erro}
        situacao={situacao}
        setSituacao={setSituacao}
        busca={busca}
        setBusca={setBusca}
        filtros={filtros}
        setFiltros={setFiltros}
        usuarios={usuarios}
        carregandoUsuarios={carregandoUsuarios}
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
