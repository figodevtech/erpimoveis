"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  casarComFluxo,
  casarComTitulos,
  type CandidatoTransacao,
} from "@/lib/financeiro/ofx/matcher";
import {
  dataDaTransacao,
  explicacaoMatch,
  mensagemDeErro,
} from "./apresentacao";
import type { MovimentoAnalisado, SugestaoMatch } from "./types";
import formatarEmReal from "@/utils/formatarEmReal";

export function BuscaManual({
  movimento,
  bancoId,
  onSelecionar,
}: {
  movimento: MovimentoAnalisado;
  bancoId: number;
  onSelecionar: (s: SugestaoMatch) => void;
}) {
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState({
    busca: "",
    origem: "FLUXO",
    pagina: 1,
    tentativa: 0,
  });
  const [estado, setEstado] = useState<{
    carregando: boolean;
    erro: string | null;
    sugestoes: SugestaoMatch[];
    paginas: number;
  }>({ carregando: true, erro: null, sugestoes: [], paginas: 1 });
  useEffect(() => {
    const controller = new AbortController();
    const fluxo = consulta.origem === "FLUXO";
    axios
      .get<{
        data: (CandidatoTransacao & {
          fornecedor?: { nomerazaosocial?: string; nome?: string } | null;
        })[];
        pagination: { totalPages: number };
      }>("/api/transaction", {
        params: {
          search: consulta.busca || undefined,
          page: consulta.pagina,
          limit: 50,
          tipos:
            movimento.valorCentavos > 0 ? "RECEITA,DEPOSITO" : "DESPESA,SAQUE",
          pendente: !fluxo,
          bancoId: fluxo ? bancoId : undefined,
          comBanco: fluxo ? true : undefined,
        },
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        const candidatos = res.data.data
          .filter(
            (c) =>
              fluxo ||
              (c.adiantamento_id == null &&
                !c.eh_adiantamento &&
                c.pagamento_multiplo_id == null),
          )
          .map((c) => ({
            ...c,
            fornecedor: c.fornecedor
              ? { nome: c.fornecedor.nomerazaosocial ?? c.fornecedor.nome }
              : null,
          }));
        const sugestoes = fluxo
          ? casarComFluxo(movimento, candidatos, bancoId)
          : casarComTitulos(movimento, candidatos);
        setEstado({
          carregando: false,
          erro: null,
          sugestoes,
          paginas: res.data.pagination.totalPages,
        });
      })
      .catch((e) => {
        if (!axios.isCancel(e))
          setEstado({
            carregando: false,
            erro: mensagemDeErro(e, "Não foi possível buscar transações."),
            sugestoes: [],
            paginas: 1,
          });
      });
    return () => controller.abort();
  }, [consulta, movimento, bancoId]);
  function buscar(patch: Partial<typeof consulta>) {
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    setConsulta((q) => ({ ...q, ...patch }));
  }
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Procurar transação no ERP</h3>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          buscar({
            busca: texto,
            pagina: 1,
            tentativa: consulta.tentativa + 1,
          });
        }}
      >
        <Input
          aria-label="Busca manual de transações"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Descrição, pagador, OS ou venda..."
        />
        <Button type="submit" variant="outline" aria-label="Buscar transações">
          <Search className="size-4" />
        </Button>
      </form>
      <Select
        value={consulta.origem}
        onValueChange={(origem) => buscar({ origem, pagina: 1 })}
      >
        <SelectTrigger className="w-full" aria-label="Onde procurar">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="FLUXO">Fluxo de Caixa · mesma conta</SelectItem>
          <SelectItem value="TITULO">
            Contas a pagar / receber em aberto
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {consulta.origem === "FLUXO"
          ? "Mesma conta, valor e direção, sem limite de diferença entre as datas."
          : "Mesma direção e saldo suficiente, sem limite de dias entre o vencimento e o pagamento ou recebimento. Antecipações e pagamentos múltiplos são resolvidos nos fluxos próprios."}{" "}
        A confirmação revalida a disponibilidade da transação.
      </p>
      {estado.carregando ? (
        <div role="status" className="space-y-2">
          <span className="text-xs text-muted-foreground">
            Buscando transações…
          </span>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : estado.erro ? (
        <p role="alert" className="text-sm text-destructive">
          {estado.erro}
        </p>
      ) : estado.sugestoes.length ? (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {estado.sugestoes.map((s) => (
            <button
              key={s.transacaoId}
              type="button"
              className="w-full space-y-1 rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onSelecionar(s)}
            >
              <p className="text-sm font-medium">
                {s.descricao || `Transação #${s.transacaoId}`}
              </p>
              <p className="text-xs">
                {s.contraparte} · {dataDaTransacao(s.data)} ·{" "}
                {formatarEmReal(s.valorCentavos / 100)}
              </p>
              <p className="text-xs text-muted-foreground">
                {explicacaoMatch(s)}
              </p>
              <p className="text-xs text-primary">Selecionar para comparar</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-3 text-sm text-muted-foreground">
          Nenhuma transação compatível nesta página. Refine a busca
          {estado.paginas > 1 ? " ou consulte a próxima página" : ""}.
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>
          Página {consulta.pagina} de {Math.max(1, estado.paginas)}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={estado.carregando || consulta.pagina === 1}
            onClick={() => buscar({ pagina: consulta.pagina - 1 })}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={estado.carregando || consulta.pagina >= estado.paginas}
            onClick={() => buscar({ pagina: consulta.pagina + 1 })}
          >
            Próxima
          </Button>
        </div>
      </div>
    </section>
  );
}
