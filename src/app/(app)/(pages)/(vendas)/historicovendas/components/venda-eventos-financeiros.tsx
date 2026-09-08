"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertCircle, ReceiptText, RefreshCw } from "lucide-react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { PainelEventosFinanceiros } from "@/components/financeiro/eventos-financeiros/painel-eventos-financeiros";
import { montarLinhas, type EventoFinanceiroBruto } from "@/components/financeiro/eventos-financeiros/modelo";
import { endpointsDoFinanceiro } from "@/components/financeiro/eventos-financeiros/endpoints";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import formatarEmReal from "@/utils/formatarEmReal";

const ENDPOINTS = endpointsDoFinanceiro();

export function VendaEventosFinanceiros({ vendaId }: { vendaId: number }) {
  const { data: session } = useSession();
  const [eventos, setEventos] = useState<EventoFinanceiroBruto[]>([]);
  const [historica, setHistorica] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((valor) => valor + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    setErro(null);
    fetch(`/api/venda/${vendaId}/eventos-financeiros`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os eventos.");
        if (controller.signal.aborted) return;
        setEventos(data.eventos ?? []);
        setHistorica(data.comissaoHistorica === true);
      })
      .catch((error) => { if (!controller.signal.aborted) setErro(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [vendaId, versao]);

  const linhas = useMemo(() => montarLinhas(eventos, { preservarOrdem: true }), [eventos]);
  const receita = linhas.filter((linha) => linha.tipo === "ENTRADA").reduce((total, linha) => total + linha.valor, 0);
  const despesa = linhas.filter((linha) => linha.tipo === "SAIDA").reduce((total, linha) => total + linha.valor, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Eventos desta venda</h3>
          <p className="mt-1 text-sm text-muted-foreground">Receitas, custos e comissões apurados. As comissões podem ser lançadas no financeiro.</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Atualizar eventos da venda" disabled={carregando} onClick={recarregar}><RefreshCw className={`size-4 ${carregando ? "animate-spin" : ""}`} /></Button>
      </div>
      {carregando ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div> : erro ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 p-4 text-sm"><AlertCircle className="size-5 shrink-0 text-destructive" /><p className="flex-1">{erro}</p><Button variant="outline" size="sm" onClick={recarregar}>Tentar novamente</Button></div>
      ) : <>
        <div className="grid gap-3 sm:grid-cols-3">
          {[{ titulo: "Receitas", valor: receita, cor: "text-emerald-700 dark:text-emerald-400" }, { titulo: "Despesas e deduções", valor: despesa, cor: "text-rose-700 dark:text-rose-400" }, { titulo: "Resultado da venda", valor: receita - despesa, cor: "text-foreground" }].map((card) => <div key={card.titulo} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{card.titulo}</p><p className={`mt-2 text-xl font-semibold tabular-nums ${card.cor}`}>{formatarEmReal(card.valor)}</p></div>)}
        </div>
        {historica ? <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">A comissão desta venda é anterior a setembro de 2026 e foi preservada apenas no histórico, sem criar uma nova despesa.</p> : null}
        <PainelEventosFinanceiros linhas={linhas} endpoints={ENDPOINTS} vendaIdUnica={vendaId} onChanged={recarregar} permissoes={{ podeEditar: false, podeExcluir: false, podeLancar: permissionSetHas((session?.user as any)?.permissoes, PERMS.FINANCEIRO_CRIAR) }} vazio={<div className="flex flex-col items-center gap-2 p-10 text-center"><ReceiptText className="mb-2 size-7 text-muted-foreground" /><p className="text-sm font-medium">Nenhum evento ativo nesta venda</p><p className="max-w-sm text-xs text-muted-foreground">Os eventos são publicados quando a venda passa a reconhecer receita. Vendas canceladas deixam de compor o resultado.</p></div>} />
      </>}
    </div>
  );
}
