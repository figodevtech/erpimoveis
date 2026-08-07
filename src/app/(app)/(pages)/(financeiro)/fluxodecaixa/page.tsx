"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import axios from "axios";
import {
  type CampoOrdenacao,
  DIRECAO_INICIAL,
  type FluxoViewMode,
  type Ordenacao,
  StatusInfo,
  Tipo_transacao,
  Transaction,
  type TransactionRelationFilters,
} from "./types";
import Cards from "./components/cards";
import { KpisFluxo } from "./components/kpis-fluxo";
import FinancialTable from "./components/financialTable";

export default function FinanceiroPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [statusInfo, setStatusInfo] = useState<StatusInfo | undefined>(
    undefined
  );
  const [tipo, setTipo] = useState<Tipo_transacao | "">("");
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [viewMode, setViewMode] = useState<FluxoViewMode>("FLUXO");
  const [relationFilters, setRelationFilters] = useState<TransactionRelationFilters>({
    categoriaId: "",
    bancoId: "",
    planoContaId: "",
    centroCustoId: "",
  });
  // Só guarda o clique do usuário, junto da aba onde ele clicou. A ordenação
  // em si é derivada abaixo — corrigi-la por efeito depois da troca de aba
  // dispararia uma segunda busca só para desfazer a primeira.
  const [ordenacaoManual, setOrdenacaoManual] = useState<{
    viewMode: FluxoViewMode;
    ordenacao: Ordenacao;
  } | null>(null);

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

  const effectiveTipo =
    viewMode === "A_RECEBER"
      ? Tipo_transacao.RECEITA
      : viewMode === "A_PAGAR"
      ? Tipo_transacao.DESPESA
      : tipo;

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
          tipo: effectiveTipo,
          pendente: effectivePendente,
          comBanco: effectiveComBanco,
          dateFrom,
          dateTo,
          categoriaId: relationFilters.categoriaId || undefined,
          bancoId: relationFilters.bancoId || undefined,
          planoContaId: relationFilters.planoContaId || undefined,
          centroCustoId: relationFilters.centroCustoId || undefined,
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
    dateFrom,
    dateTo,
    effectiveComBanco,
    effectivePendente,
    effectiveTipo,
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

  const handleGetStatusCounter = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await axios.get("/api/transaction/status-counter", {});
      const response2 = await axios.get("/api/transaction/status-counter", {
        params: { offset: -1 },
      });
      if (response.status === 200 && response2.status === 200) {
        setStatusInfo((current) => ({
          ...current,
          mesAtual: response.data,
          mesAnterior: response2.data,
        }));
      }
    } catch {
    } finally {
      setIsLoadingStatus(false);
    }
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

  useEffect(() => {
    void handleGetStatusCounter();
  }, [handleGetStatusCounter]);

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
          {viewMode === "A_PAGAR" || viewMode === "A_RECEBER" ? (
            <KpisFluxo
              viewMode={viewMode}
              dateFrom={dateFrom}
              dateTo={dateTo}
              search={search}
              relationFilters={relationFilters}
            />
          ) : (
            <Cards isLoadingStatus={isLoadingStatus} statusInfo={statusInfo} />
          )}
        </motion.div>
      </AnimatePresence>
      </div>
      <FinancialTable
        dateFrom={dateFrom}
        dateTo={dateTo}
        handleGetStatusCounter={handleGetStatusCounter}
        isLoading={isLoading}
        search={search}
        tipo={effectiveTipo}
        pendenteFilter={effectivePendente}
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

