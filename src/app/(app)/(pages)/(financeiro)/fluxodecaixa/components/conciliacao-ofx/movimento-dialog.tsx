"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Ban, Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

import { useCentrosCusto } from "../../hooks/use-centros-custo";
import { usePlanosDeConta } from "../../hooks/use-planos-de-conta";
import { PlanoContaCombobox } from "../plano-conta-combobox";
import {
  reais,
  type Decisao,
  type MovimentoAnalisado,
  type SugestaoMatch,
} from "./types";

/**
 * A escolha da correspondência de uma linha do extrato.
 *
 * Três saídas, e só três: usar uma transação que o sistema encontrou, criar a
 * que faltava, ou registrar que aquele movimento não vira lançamento nenhum.
 * Nada é gravado aqui — a decisão volta para a lista e só vale depois da
 * confirmação, que é o que separa análise de conciliação.
 */
export function MovimentoDialog({
  movimento,
  decisaoAtual,
  aberto,
  setAberto,
  onDecidir,
}: {
  movimento: MovimentoAnalisado | null;
  decisaoAtual: Decisao | null;
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  onDecidir: (decisao: Decisao | null) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Correspondência do movimento</DialogTitle>
          <DialogDescription>
            Escolha o que este movimento do extrato representa no financeiro.
          </DialogDescription>
        </DialogHeader>

        {/*
          O formulário nasce com os valores da linha em vez de ser sincronizado
          por efeito: a `key` remonta o componente quando muda o movimento, e o
          estado inicial de cada campo já sai certo. Sincronizar por efeito
          renderizaria a linha anterior por um quadro antes de corrigir.
        */}
        {aberto && movimento ? (
          <FormularioDeDecisao
            key={movimento.fingerprint}
            movimento={movimento}
            decisaoAtual={decisaoAtual}
            onDecidir={(decisao) => {
              onDecidir(decisao);
              setAberto(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDeDecisao({
  movimento,
  decisaoAtual,
  onDecidir,
}: {
  movimento: MovimentoAnalisado;
  decisaoAtual: Decisao | null;
  onDecidir: (decisao: Decisao | null) => void;
}) {
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const entrada = movimento.valorCentavos > 0;
  const valor = Math.abs(movimento.valorCentavos);

  const [escolhida, setEscolhida] = useState<number | null>(
    decisaoAtual?.transacaoId ?? movimento.analise.sugestoes[0]?.transacaoId ?? null,
  );
  const [criando, setCriando] = useState(decisaoAtual?.acao === "CRIAR");
  const [metodo, setMetodo] = useState(
    decisaoAtual?.metodopagamento ?? movimento.metodoSugerido ?? "",
  );
  const [descricao, setDescricao] = useState(
    decisaoAtual?.nova?.descricao ?? movimento.memo ?? movimento.nome ?? "",
  );
  const [tipo, setTipo] = useState(
    decisaoAtual?.nova?.tipo ?? (entrada ? "RECEITA" : "DESPESA"),
  );
  const [planoId, setPlanoId] = useState(
    decisaoAtual?.planoContaId ? String(decisaoAtual.planoContaId) : "",
  );
  const [centroId, setCentroId] = useState(
    decisaoAtual?.centroCustoId ? String(decisaoAtual.centroCustoId) : "",
  );

  const sugestao = useMemo(
    () => movimento.analise.sugestoes.find((item) => item.transacaoId === escolhida) ?? null,
    [movimento, escolhida],
  );

  // Vincular movimento que já está no fluxo não precisa de forma de pagamento:
  // a transação já tem a dela. Baixar e criar, sim.
  const exigeMetodo = criando || sugestao?.origem === "TITULO";
  const podeConfirmar = criando
    ? descricao.trim().length > 0 && (!exigeMetodo || metodo !== "")
    : sugestao != null && (!exigeMetodo || metodo !== "");

  function confirmar() {
    if (criando) {
      onDecidir({
        fingerprint: movimento.fingerprint,
        movimentoId: movimento.movimentoId ?? undefined,
        acao: "CRIAR",
        metodopagamento: metodo || null,
        planoContaId: planoId ? Number(planoId) : null,
        centroCustoId: centroId ? Number(centroId) : null,
        nova: {
          descricao: descricao.trim(),
          tipo,
          plano_de_conta_id: planoId ? Number(planoId) : null,
          centro_custo_id: centroId ? Number(centroId) : null,
        },
      });
      return;
    }

    if (!sugestao) return;

    onDecidir({
      fingerprint: movimento.fingerprint,
      movimentoId: movimento.movimentoId ?? undefined,
      acao: sugestao.origem === "FLUXO" ? "VINCULAR" : "LIQUIDAR",
      transacaoId: sugestao.transacaoId,
      // Só a baixa parcial precisa dizer o valor: na integral a RPC usa o saldo,
      // que já foi conferido contra o extrato.
      valor: sugestao.parcial ? reais(valor) : null,
      metodopagamento: exigeMetodo ? metodo : null,
      planoContaId: planoId ? Number(planoId) : null,
      centroCustoId: centroId ? Number(centroId) : null,
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {formatarDia(movimento.dataPostagem)}
              {movimento.tipoOfx ? ` · ${movimento.tipoOfx}` : ""}
            </p>
            <p className="truncate text-sm font-medium">
              {movimento.memo ?? movimento.nome ?? "Sem descrição"}
            </p>
            {movimento.fitid ? (
              <p className="text-[11px] text-muted-foreground">FITID {movimento.fitid}</p>
            ) : null}
          </div>
          <span
            className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${
              entrada ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {entrada ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            {formatarEmReal(reais(valor))}
          </span>
        </div>
      </div>

      {movimento.analise.observacao ? (
        <p className="text-xs text-muted-foreground">{movimento.analise.observacao}</p>
      ) : null}

      {movimento.analise.sugestoes.length > 0 ? (
        <div className="space-y-2">
          <Label>Possíveis correspondências</Label>
          <div className="space-y-2">
            {movimento.analise.sugestoes.map((item) => (
              <LinhaDeSugestao
                key={item.transacaoId}
                sugestao={item}
                selecionada={!criando && escolhida === item.transacaoId}
                onSelecionar={() => {
                  setCriando(false);
                  setEscolhida(item.transacaoId);
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma transação do período corresponde a este movimento.
        </p>
      )}

      <Button
        type="button"
        variant={criando ? "default" : "outline"}
        className="w-full justify-start hover:cursor-pointer"
        onClick={() => setCriando(true)}
      >
        <Plus className="mr-2 h-4 w-4" />
        Criar nova transação a partir deste movimento
      </Button>

      {criando ? (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ofx-descricao">Descrição</Label>
            <Input
              id="ofx-descricao"
              value={descricao}
              onChange={(evento) => setDescricao(evento.target.value)}
              placeholder="Descrição do lançamento"
            />
          </div>

          {/* O sentido vem do extrato e não se escolhe: o que se escolhe é
              entre os dois tipos daquele sentido. */}
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="w-full hover:cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(entrada ? ["RECEITA", "DEPOSITO"] : ["DESPESA", "SAQUE"]).map((item) => (
                  <SelectItem key={item} value={item} className="hover:cursor-pointer">
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Centro de custo</Label>
            <Select value={centroId} onValueChange={setCentroId} disabled={loadingCentrosCusto}>
              <SelectTrigger className="w-full hover:cursor-pointer">
                <SelectValue placeholder="Sem centro de custo" />
              </SelectTrigger>
              <SelectContent>
                {centrosCusto.map((centro) => (
                  <SelectItem
                    key={centro.id}
                    value={String(centro.id)}
                    className="hover:cursor-pointer"
                  >
                    {centro.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Label>Plano de conta</Label>
            <PlanoContaCombobox
              value={planoId}
              groups={gruposPlanosDeConta}
              loading={loadingPlanos}
              clearable
              onClear={() => setPlanoId("")}
              onValueChange={setPlanoId}
            />
          </div>
        </div>
      ) : null}

      {exigeMetodo ? (
        <div>
          <Label>Forma de pagamento</Label>
          <Select value={metodo} onValueChange={setMetodo}>
            <SelectTrigger className="w-full hover:cursor-pointer">
              <SelectValue placeholder="Escolha a forma de pagamento" />
            </SelectTrigger>
            <SelectContent>
              {metodosPagamento.map((opcao) => (
                <SelectItem key={opcao.value} value={opcao.value} className="hover:cursor-pointer">
                  {opcao.label ?? opcao.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {movimento.metodoSugerido ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sugerido pelo texto do extrato: {movimento.metodoSugerido}.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              O extrato não diz a forma de pagamento — escolha antes de conciliar.
            </p>
          )}
        </div>
      ) : null}

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="hover:cursor-pointer"
            onClick={() =>
              onDecidir({
                fingerprint: movimento.fingerprint,
                movimentoId: movimento.movimentoId ?? undefined,
                acao: "IGNORAR",
              })
            }
          >
            <Ban className="mr-2 h-4 w-4" />
            Ignorar movimento
          </Button>
          {decisaoAtual ? (
            <Button
              type="button"
              variant="ghost"
              className="hover:cursor-pointer"
              onClick={() => onDecidir(null)}
            >
              Deixar em aberto
            </Button>
          ) : null}
        </div>

        <Button
          type="button"
          disabled={!podeConfirmar}
          className="hover:cursor-pointer"
          onClick={confirmar}
        >
          <Check className="mr-2 h-4 w-4" />
          {criando ? "Usar transação nova" : "Usar esta transação"}
        </Button>
      </DialogFooter>
    </>
  );
}

function LinhaDeSugestao({
  sugestao,
  selecionada,
  onSelecionar,
}: {
  sugestao: SugestaoMatch;
  selecionada: boolean;
  onSelecionar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelecionar}
      className={`w-full rounded-lg border p-3 text-left transition-colors hover:cursor-pointer hover:bg-muted/50 ${
        selecionada ? "border-primary ring-1 ring-primary" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{sugestao.descricao || "Sem descrição"}</p>
          <p className="text-xs text-muted-foreground">
            #{sugestao.transacaoId} · {sugestao.tipo} ·{" "}
            {sugestao.origem === "FLUXO" ? "já no fluxo de caixa" : "título em aberto"}
            {sugestao.contraparte ? ` · ${sugestao.contraparte}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {sugestao.origem === "FLUXO" ? "Movimentado em " : "Vence em "}
            {new Date(sugestao.data).toLocaleDateString("pt-BR")}
            {sugestao.diferencaEmDias > 0
              ? ` · ${sugestao.diferencaEmDias} dia${sugestao.diferencaEmDias > 1 ? "s" : ""} de diferença`
              : " · mesmo dia"}
            {sugestao.ordemservicoid ? ` · OS #${sugestao.ordemservicoid}` : ""}
            {sugestao.vendaid ? ` · Venda #${sugestao.vendaid}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">{formatarEmReal(reais(sugestao.valorCentavos))}</p>
          <p className="text-[11px] text-muted-foreground">score {sugestao.score}</p>
          {sugestao.parcial ? (
            <span className="mt-1 inline-flex rounded-sm border border-amber-600/40 bg-amber-600/10 px-1.5 py-px text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
              Baixa parcial
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/** Data em `yyyy-mm-dd` não tem fuso: montar como Date puro a moveria um dia. */
function formatarDia(valor: string): string {
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
