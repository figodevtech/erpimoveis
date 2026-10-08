"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import axios from "axios";
import {
  type CampoOrdenacao,
  DIRECAO_INICIAL,
  type FluxoViewMode,
  type Ordenacao,
  Tipo_transacao,
  Transaction,
  type TransactionRelationFilters,
  VIEW_MODE_TABS,
} from "./types";
import { KpisFluxo } from "./components/kpis-fluxo";
import FinancialTable from "./components/financialTable";

export default function FinanceiroPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /*
   * Sobe a cada operação da lista, e é o que manda os cartões buscarem de novo.
   *
   * Antes isto recarregava o `status-counter`, que alimentava um bloco de
   * cartões que não conhecia filtro nenhum. Os cartões passaram a ser os mesmos
   * das outras abas, que respondem ao que está filtrado — e o que eles precisam
   * saber é só que algo mudou.
   */
  const [revalidacao, setRevalidacao] = useState(0);
  const [tipo, setTipo] = useState<Tipo_transacao | "">("");
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  /*
   * "Apenas as minhas" e um recorte opcional de quem pode ver tudo.
   *
   * Sem Caixa administrativo, os lançamentos comuns já chegam compartilhados pelo
   * servidor, e este estado nao muda nada para essa pessoa — e de proposito:
   * um limite que o cliente pudesse desligar nao seria limite.
   */
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [viewMode, setViewMode] = useState<FluxoViewMode>("FLUXO");
  const [relationFilters, setRelationFilters] = useState<TransactionRelationFilters>({
    categoriaId: "",
    bancoId: "",
    planoContaId: "",
    centroCustoId: "",
    metodoPagamento: "",
  });
  // Só guarda o clique do usuário, junto da aba onde ele clicou. A ordenação
  // em si é derivada abaixo — corrigi-la por efeito depois da troca de aba
  // dispararia uma segunda busca só para desfazer a primeira.
  const [ordenacaoManual, setOrdenacaoManual] = useState<{
    viewMode: FluxoViewMode;
    ordenacao: Ordenacao;
  } | null>(null);

  /*
   * `?view=A_PAGAR` abre a tela já na aba pedida.
   *
   * Os botões dos resumos diários do Telegram sempre mandaram esse parâmetro,
   * e ninguém o lia: quem tocava em "Abrir contas a pagar" caía no fluxo geral
   * e tinha de procurar a aba. Fica no efeito, e não no estado inicial, porque
   * o componente também renderiza no servidor, onde não existe `window`.
   */
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (VIEW_MODE_TABS.some((tab) => tab.value === view)) {
      setViewMode(view as FluxoViewMode);
    }
  }, []);

  // Contas a pagar/receber se leem por vencimento: o que vence antes vem antes.
  // O extrato geral continua do lançamento mais novo para o mais antigo.
  // Trocar de aba volta para a ordem natural da visão.
  const ordenacao: Ordenacao =
    ordenacaoManual?.viewMode === viewMode
      ? ordenacaoManual.ordenacao
      : {
          campo: "data",
          direcao:
            viewMode === "A_PAGAR" || viewMode === "A_RECEBER" ? "asc" : "desc",
        };

  // Uma ordenação por vez: clicar no mesmo cabeçalho inverte, clicar em outro
  // troca de coluna e descarta a anterior.
  const handleOrdenar = (campo: CampoOrdenacao) => {
    setOrdenacaoManual({
      viewMode,
      ordenacao:
        ordenacao.campo === campo
          ? { campo, direcao: ordenacao.direcao === "asc" ? "desc" : "asc" }
          : { campo, direcao: DIRECAO_INICIAL[campo] },
    });
  };

  /**
   * Cada busca leva um número; só a mais recente pode escrever na tela.
   *
   * Trocar de aba dispara uma busca nova sem cancelar a anterior. Quando a
   * antiga responde depois — o que acontece sempre que ela é mais pesada — ela
   * sobrescrevia a lista, e a aba ficava marcada numa visão exibindo a outra.
   * Comparar contra o último número emitido descarta a resposta atrasada.
   */
  const buscaAtual = useRef(0);

  /** Só o Fluxo exige conta: é o que separa extrato de título liquidado. */
  const effectiveComBanco = viewMode === "FLUXO" ? true : undefined;

  /*
   * "A receber" e "a pagar" agrupam dois tipos, não um.
   *
   * Entrada de dinheiro é RECEITA ou DEPOSITO; saída é DESPESA ou SAQUE — o
   * mesmo par que `KpisFluxo` já soma. Enquanto estas abas filtravam por um
   * tipo só, um DEPOSITO ou SAQUE ainda pendente não aparecia em aba nenhuma:
   * Fluxo e Liquidadas pedem `pendente = false`, e aqui o tipo não batia. A
   * transação ficava no banco sem nenhum caminho na tela até ela — nem para
   * abrir, nem para editar, nem para excluir.
   */
  const effectiveTipos: Tipo_transacao[] =
    viewMode === "A_RECEBER"
      ? [Tipo_transacao.RECEITA, Tipo_transacao.DEPOSITO]
      : viewMode === "A_PAGAR"
      ? [Tipo_transacao.DESPESA, Tipo_transacao.SAQUE]
      : tipo
      ? [tipo]
      : [];

  // Um valor só quando existe um só: é o que a exportação e o rótulo esperam.
  const effectiveTipo = effectiveTipos.length === 1 ? effectiveTipos[0] : "";

  // String, não array: o array é recriado a cada render e derrubaria o memo da
  // busca (mesmo motivo pelo qual `ordenacao` entra por campo, lá embaixo).
  const tiposParam = effectiveTipos.join(",");

  // Sempre definido: toda aba tem uma resposta para "já andou ou não".
  const effectivePendente =
    viewMode === "LIQUIDADAS" || viewMode === "FLUXO" ? false : true;

  /**
   * Os filtros vêm do estado da página, não de quem chama.
   *
   * Eram parâmetros, e todo botão que recarregava a lista precisava lembrar de
   * repassar os oito. Nenhum repassava `comBanco`: recarregar ou paginar dentro
   * do Fluxo derrubava a exigência de conta e trazia de volta título liquidado
   * por antecipação, que não é movimentação bancária. Quem chama diz só qual
   * página quer; o que está filtrado é assunto da página.
   */
  const handleGetTransactions = useCallback(async (
    pageNumber?: number,
    limit?: number,
  ) => {
    const estaBusca = ++buscaAtual.current;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: search || undefined,
          tipos: tiposParam || undefined,
          pendente: effectivePendente,
          comBanco: effectiveComBanco,
          dateFrom,
          dateTo,
          categoriaId: relationFilters.categoriaId || undefined,
          bancoId: relationFilters.bancoId || undefined,
          planoContaId: relationFilters.planoContaId || undefined,
          centroCustoId: relationFilters.centroCustoId || undefined,
          metodopagamento: relationFilters.metodoPagamento || undefined,
          apenasMinhas: apenasMinhas ? "1" : undefined,
          ordem: ordenacao.direcao,
          ordenarPor: ordenacao.campo,
        },
      });
      // Resposta de uma busca que já foi superada não entra na tela.
      if (estaBusca !== buscaAtual.current) return;

      if (response.status === 200) {
        const { data } = response;
        setTransactions(data.data);
        setPagination(data.pagination);
      }
    } catch {
    } finally {
      // O "carregando" também é da busca mais recente: desligá-lo na resposta
      // atrasada apagaria o indicador enquanto a atual ainda está em voo.
      if (estaBusca === buscaAtual.current) setIsLoading(false);
    }
    // Primitivos, não o objeto: `ordenacao` é recriado a cada render e
    // derrubaria o memo (e a busca) sem nada ter mudado.
  }, [
    apenasMinhas,
    dateFrom,
    dateTo,
    effectiveComBanco,
    effectivePendente,
    tiposParam,
    ordenacao.campo,
    ordenacao.direcao,
    pagination.limit,
    relationFilters,
    search,
  ]);

  // Trocar o tamanho da página volta para a primeira: a página atual pode
  // ficar fora do novo total. Quem refaz a busca é o efeito que observa o
  // limite — por isso aqui só mexe no estado.
  const handleChangeLimit = useCallback((limit: number) => {
    setPagination((current) => ({ ...current, limit, page: 1 }));
  }, []);

  /*
   * Algo mudou na lista — uma baixa, um estorno, uma exclusão.
   *
   * Os cartões buscam sozinhos quando os filtros mudam, mas uma baixa não muda
   * filtro nenhum: sem este empurrão eles ficariam com o número de antes da
   * operação, justamente quando a pessoa olha para conferir.
   */
  const revalidarIndicadores = useCallback(() => {
    setRevalidacao((atual) => atual + 1);
  }, []);

  // Mudou filtro, período ou busca? `handleGetTransactions` muda junto e o
  // efeito refaz a consulta a partir da primeira página — a atual pode nem
  // existir no novo resultado.
  useEffect(() => {
    handleGetTransactions(1, pagination.limit);
  }, [handleGetTransactions, pagination.limit]);

  useEffect(() => {
    // A_PAGAR/A_RECEBER já fixam o tipo; Liquidadas aceita filtrar por tipo.
    if ((viewMode === "A_PAGAR" || viewMode === "A_RECEBER") && tipo) {
      setTipo("");
    }
  }, [tipo, viewMode]);


  return (
    <div className="p-y-4 space-y-4">
      {/* <Header /> */}
      {/*
        Uma fileira de indicadores por vez, nunca as duas.
        Fluxo e Liquidadas olham dinheiro que já andou, e a comparação mensal
        responde bem a isso. A pagar e A receber olham o que ainda não andou —
        ali o mês passado não diz nada, e o que importa é o que vence.
      */}
      {/*
        Piso de altura no contêiner, não nos cartões: as duas fileiras têm
        conteúdo diferente e sempre teriam alturas um pouco distintas. Reservando
        o espaço aqui, a tabela abaixo fica parada durante a troca.
      */}
      <div className="min-h-[9.5rem]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={
            viewMode === "A_PAGAR" || viewMode === "A_RECEBER" ? "periodo" : "gerais"
          }
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {/*
            Os mesmos cartões nas quatro abas, e todos respondendo ao que está
            filtrado.

            Fluxo e Liquidadas mostravam o `Cards`, que compara mês atual com o
            anterior e não conhece filtro nenhum: com a lista filtrada por uma
            categoria, os cartões continuavam somando o mês inteiro em cima dela.
            Quem lê um cartão sobre uma lista lê "o total do que estou vendo".

            A comparação com o mês anterior se perde nessa troca. Ela é útil, mas
            é outra pergunta — e estava respondendo por cima da que a tela faz.
          */}
          <KpisFluxo
            viewMode={viewMode}
            dateFrom={dateFrom}
            dateTo={dateTo}
            search={search}
            tiposParam={tiposParam}
            relationFilters={relationFilters}
            apenasMinhas={apenasMinhas}
            revalidacao={revalidacao}
          />
        </motion.div>
      </AnimatePresence>
      </div>
      <FinancialTable
        dateFrom={dateFrom}
        dateTo={dateTo}
        revalidarIndicadores={revalidarIndicadores}
        isLoading={isLoading}
        search={search}
        tipo={effectiveTipo}
        tiposParam={tiposParam}
        viewMode={viewMode}
        rawTipo={tipo}
        setTipo={setTipo}
        setSearch={setSearch}
        dateSearch={search}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setViewMode={setViewMode}
        relationFilters={relationFilters}
        setRelationFilters={setRelationFilters}
        apenasMinhas={apenasMinhas}
        setApenasMinhas={setApenasMinhas}
        handleGetTransactions={handleGetTransactions}
        setLimit={handleChangeLimit}
        ordenacao={ordenacao}
        onOrdenar={handleOrdenar}
        pagination={pagination}
        transactions={transactions}
      />
    </div>
  );
}

