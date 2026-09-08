"use client";

/**
 * Conciliação N:1 — várias linhas do extrato para um lançamento só do ERP.
 *
 * O banco quebra em duas o que a empresa lançou numa: a prestação do
 * financiamento sai numa linha e o IOF do mesmo contrato noutra, no mesmo dia, e
 * no ERP existe uma despesa só com a soma dos dois.
 *
 * A regra continua sendo a mesma da conciliação de uma linha, só que sobre a
 * SOMA: mesma conta, mesmo sentido, e o total das linhas igual ao dinheiro que a
 * transação movimenta. Por isso este dialog monta um movimento somado e o passa
 * pelo mesmo matcher — o que ele mostra como compatível é exatamente o que a RPC
 * vai aceitar.
 */

import { useMemo, useState } from "react";
import { Check, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import formatarEmReal from "@/utils/formatarEmReal";
import TransactionSelect, {
  type TransactionFiltros,
} from "@/app/(app)/components/transactionSelect";
import {
  casarComFluxo,
  casarComTitulos,
  motivoDeIncompatibilidade,
  type CandidatoTransacao,
} from "@/lib/financeiro/ofx/matcher";
import type { OfxMovimento } from "@/lib/financeiro/ofx/types";

import type { Transaction } from "../../types";
import { descricaoMovimento, formatarDia } from "./apresentacao";
import { reais, type Decisao, type MovimentoAnalisado, type SugestaoMatch } from "./types";

type Origem = "FLUXO" | "TITULO";

/** Mesma conversão de formato da busca manual: o matcher quer `fornecedor.nome`. */
function paraCandidato(transacao: Transaction): CandidatoTransacao {
  return {
    ...transacao,
    data: String(transacao.data),
    fornecedor: transacao.fornecedor
      ? { nome: transacao.fornecedor.nomerazaosocial ?? transacao.fornecedor.nomefantasia ?? null }
      : null,
  } as CandidatoTransacao;
}

/**
 * As linhas escolhidas, como se fossem um movimento só.
 *
 * Soma dos valores e data do ÚLTIMO — exatamente o que `conciliar_movimentos_ofx`
 * calcula do lado do banco. Reproduzir a mesma conta aqui é o que faz a tela
 * prometer só o que o servidor cumpre.
 */
function movimentoSomado(linhas: MovimentoAnalisado[]): OfxMovimento {
  const valorCentavos = linhas.reduce((total, m) => total + m.valorCentavos, 0);
  const dataPostagem = linhas.reduce(
    (maior, m) => (m.dataPostagem > maior ? m.dataPostagem : maior),
    linhas[0]?.dataPostagem ?? "",
  );
  return {
    sequencia: linhas[0]?.sequencia ?? 1,
    tipoOfx: null,
    dataPostagem,
    dataDisponivel: null,
    valorCentavos,
    fitid: null,
    checknum: null,
    refnum: null,
    nome: null,
    memo: linhas.map((m) => m.memo ?? m.nome ?? "").filter(Boolean).join(" | "),
  };
}

export function GrupoDialog({
  linhas,
  aberto,
  setAberto,
  bancoId,
  conta,
  onConfirmar,
}: {
  linhas: MovimentoAnalisado[];
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  bancoId: number;
  conta: string;
  onConfirmar: (base: Omit<Decisao, "fingerprint">) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent
        className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onInteractOutside={(evento) => evento.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b bg-muted/20 px-5 py-4 pr-12 sm:px-6">
          <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Layers className="size-3.5" />
            Conciliação bancária · Várias linhas
          </p>
          <DialogTitle>Conciliar linhas juntas</DialogTitle>
          <DialogDescription>
            Quando o banco separa em várias linhas o que o ERP lançou numa só, a
            soma delas é o que precisa bater com a transação.
          </DialogDescription>
        </DialogHeader>
        {aberto && linhas.length > 1 ? (
          <Formulario
            key={linhas.map((m) => m.fingerprint).join("|")}
            linhas={linhas}
            bancoId={bancoId}
            conta={conta}
            onConfirmar={(base) => {
              onConfirmar(base);
              setAberto(false);
            }}
            onCancelar={() => setAberto(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  linhas,
  bancoId,
  conta,
  onConfirmar,
  onCancelar,
}: {
  linhas: MovimentoAnalisado[];
  bancoId: number;
  conta: string;
  onConfirmar: (base: Omit<Decisao, "fingerprint">) => void;
  onCancelar: () => void;
}) {
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [origem, setOrigem] = useState<Origem>("FLUXO");
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<{
    transacao: Transaction;
    sugestao: SugestaoMatch;
  } | null>(null);
  const [metodo, setMetodo] = useState("");

  const movimento = useMemo(() => movimentoSomado(linhas), [linhas]);
  const entrada = movimento.valorCentavos > 0;
  const soma = reais(Math.abs(movimento.valorCentavos));
  const tipos = entrada ? "RECEITA,DEPOSITO" : "DESPESA,SAQUE";

  const filtrosFixos: Partial<TransactionFiltros> = useMemo(
    () =>
      origem === "FLUXO"
        ? { tipos, pendente: false, bancoId: String(bancoId), comBanco: true }
        : { tipos, pendente: true },
    [origem, tipos, bancoId],
  );

  // Piso, nunca teto: o filtro do servidor é sobre o bruto, e taxa e baixa
  // parcial só fazem o líquido descer. Mesma razão da busca manual.
  const filtrosIniciais: Partial<TransactionFiltros> = useMemo(
    () => ({ valorMin: soma, ordenarPor: "valor" as const, ordem: "asc" as const }),
    [soma],
  );

  const avaliarLinha = (transacao: Transaction) => {
    const candidato = paraCandidato(transacao);
    const motivo = motivoDeIncompatibilidade(movimento, candidato, bancoId, origem);
    if (motivo) return { compativel: false, motivo };
    const sugestao = sugestaoDe(candidato);
    return {
      compativel: true,
      nota: sugestao?.parcial
        ? `Baixa parcial: as ${linhas.length} linhas quitam ${formatarEmReal(soma)} de ${formatarEmReal(reais(sugestao.valorCentavos))}.`
        : null,
    };
  };

  function sugestaoDe(candidato: CandidatoTransacao): SugestaoMatch | undefined {
    return origem === "FLUXO"
      ? casarComFluxo(movimento, [candidato], bancoId)[0]
      : casarComTitulos(movimento, [candidato])[0];
  }

  const exigeMetodo = escolhida?.sugestao.origem === "TITULO";
  const podeConfirmar = escolhida != null && (!exigeMetodo || metodo !== "");

  function confirmar() {
    if (!escolhida || !podeConfirmar) return;
    const { sugestao } = escolhida;
    onConfirmar({
      acao: sugestao.origem === "FLUXO" ? "VINCULAR" : "LIQUIDAR",
      transacaoId: sugestao.transacaoId,
      valor: sugestao.parcial ? soma : null,
      metodopagamento: exigeMetodo ? metodo : null,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        <section className="rounded-xl border">
          <header className="flex items-baseline justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
            <h3 className="text-sm font-semibold">
              {linhas.length} linhas do extrato · {conta}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {entrada ? "Entradas" : "Saídas"}
            </span>
          </header>
          <ul className="divide-y">
            {linhas.map((m) => (
              <li key={m.fingerprint} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {descricaoMovimento(m).titulo}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatarDia(m.dataPostagem)}
                    {descricaoMovimento(m).complemento
                      ? ` · ${descricaoMovimento(m).complemento}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums">
                  {formatarEmReal(reais(Math.abs(m.valorCentavos)))}
                </span>
              </li>
            ))}
          </ul>
          <footer className="flex items-baseline justify-between gap-3 border-t bg-muted/20 px-4 py-2.5">
            <span className="text-xs font-semibold">Soma a conciliar</span>
            <span className="text-sm font-semibold tabular-nums">{formatarEmReal(soma)}</span>
          </footer>
        </section>

        <div className="space-y-2">
          <Label>Onde procurar o lançamento</Label>
          <Select
            value={origem}
            onValueChange={(valor) => {
              setOrigem(valor as Origem);
              setEscolhida(null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FLUXO">Fluxo de Caixa · mesma conta</SelectItem>
              <SelectItem value="TITULO">Contas a pagar / receber em aberto</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {origem === "FLUXO"
              ? `O lançamento precisa movimentar exatamente ${formatarEmReal(soma)} nesta conta.`
              : `O título precisa ter saldo de ao menos ${formatarEmReal(soma)}. Sobrando saldo, a baixa é parcial.`}
          </p>
        </div>

        {escolhida ? (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-medium">
              {escolhida.transacao.descricao || `Transação #${escolhida.transacao.id}`}
            </p>
            <p className="text-xs text-muted-foreground">
              #{escolhida.transacao.id} ·{" "}
              {escolhida.sugestao.origem === "FLUXO"
                ? "já no fluxo de caixa"
                : "título em aberto"}{" "}
              · {formatarEmReal(reais(escolhida.sugestao.valorCentavos))}
            </p>
            {escolhida.sugestao.parcial ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Baixa parcial: as {linhas.length} linhas quitam {formatarEmReal(soma)} do saldo.
              </p>
            ) : null}
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="w-full justify-start hover:cursor-pointer"
          onClick={() => setSeletorAberto(true)}
        >
          {escolhida ? "Trocar transação" : "Escolher a transação do ERP"}
        </Button>

        {exigeMetodo ? (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <Label htmlFor="grupo-metodo">Forma de pagamento</Label>
            <Select value={metodo} onValueChange={setMetodo}>
              <SelectTrigger id="grupo-metodo" className="w-full">
                <SelectValue placeholder="Escolha a forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                {metodosPagamento.map((opcao) => (
                  <SelectItem key={opcao.value} value={opcao.value}>
                    {opcao.label ?? opcao.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A baixa é uma só, do valor somado.
            </p>
          </div>
        ) : null}

        <TransactionSelect
          open={seletorAberto}
          setOpen={setSeletorAberto}
          onSelect={(transacao) => {
            const sugestao = sugestaoDe(paraCandidato(transacao));
            if (!sugestao) return;
            setEscolhida({ transacao, sugestao });
          }}
          selectedId={escolhida?.transacao.id ?? null}
          title="Escolher o lançamento que responde por estas linhas"
          description={`Soma das ${linhas.length} linhas: ${formatarEmReal(soma)}. O que não puder ser conciliado aparece na lista com o motivo.`}
          filtrosFixos={filtrosFixos}
          filtrosIniciais={filtrosIniciais}
          avaliarLinha={avaliarLinha}
          emptyHint="Use “Ampliar busca” para procurar sem a faixa de valor."
        />
      </div>

      <DialogFooter className="shrink-0 gap-3 border-t bg-background px-5 py-4 sm:justify-between sm:px-6">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <Button type="button" disabled={!podeConfirmar} onClick={confirmar}>
            <Check className="size-4" />
            Conciliar as {linhas.length} linhas juntas
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            Aplicada somente ao confirmar o lote.
          </p>
        </div>
      </DialogFooter>
    </div>
  );
}
