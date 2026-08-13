"use client";

import { useMemo, useState } from "react";
import axios, { isAxiosError } from "axios";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import { formatarCentavos, paraCentavos } from "@/lib/financeiro/rateio";
import {
  MAXIMO_DE_PARCELAS,
  avancarMeses,
  redistribuirIgualmente,
  validarReparcelamento,
  type ParcelaPlanejada,
} from "@/lib/financeiro/reparcelamento";
import formatarEmReal from "@/utils/formatarEmReal";

import { paraDataDaApi, paraValorDeInputDate } from "../datas";
import type { LancamentoRelacionado } from "./types";

interface ReparcelarEditorProps {
  /** O grupo inteiro; só as pendentes entram na edição. */
  itens: LancamentoRelacionado[];
  transacaoAtualId: number;
  onCancelar: () => void;
  onSalvo: () => void;
  /**
   * A parcela aberta no diálogo não sobreviveu ao reparcelamento — some quando a
   * quantidade diminui. Recarregar aqui traria um 404 com cara de erro, então
   * quem chama fecha o diálogo.
   */
  onTransacaoRemovida?: () => void;
  /** Alguém mexeu no grupo antes: recarregar e sair do modo de edição. */
  onConflito: () => void;
}

function paraParcelas(pendentes: LancamentoRelacionado[]): ParcelaPlanejada[] {
  return pendentes.map((item) => ({
    id: item.id,
    valor: Number(item.valor ?? 0),
    vencimento: paraDataDaApi(item.data),
  }));
}

/** Meia-noite de hoje: um vencimento para hoje continua válido. */
function hojeSemHora() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

function dataDoInput(valor: string): Date | undefined {
  if (!valor) return undefined;
  const [ano, mes, dia] = valor.split("-").map(Number);
  if (!ano || !mes || !dia) return undefined;
  return new Date(ano, mes - 1, dia);
}

/**
 * Reparcela um lançamento avulso: quantidade, valores e vencimentos.
 *
 * O que já foi baixado não entra — é dinheiro que andou, e o banco recusa mexer
 * no valor dele. O que sobra é o total pendente, e ele não muda de tamanho aqui:
 * reparcelar redivide o que falta, não perdoa nem cobra a mais. Por isso o botão
 * só destrava quando a soma fecha exatamente no mesmo número.
 */
export function ReparcelarEditor({
  itens,
  transacaoAtualId,
  onCancelar,
  onSalvo,
  onTransacaoRemovida,
  onConflito,
}: ReparcelarEditorProps) {
  const pendentes = useMemo(() => itens.filter((item) => item.pendente), [itens]);
  const baixadas = useMemo(() => itens.filter((item) => !item.pendente), [itens]);

  const [parcelas, setParcelas] = useState<ParcelaPlanejada[]>(() =>
    paraParcelas(pendentes),
  );
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const alvoEmCentavos = useMemo(
    () => pendentes.reduce((total, item) => total + paraCentavos(item.valor), 0),
    [pendentes],
  );

  const totalBaixado = useMemo(
    () => baixadas.reduce((total, item) => total + Number(item.valor ?? 0), 0),
    [baixadas],
  );

  const hoje = hojeSemHora();
  const resultado = useMemo(
    () => validarReparcelamento(parcelas, alvoEmCentavos, hoje),
    // `hoje` é recriado a cada render de propósito: a validação é barata e a data
    // não pode congelar numa tela que fica aberta virando o dia.
    [parcelas, alvoEmCentavos, hoje],
  );

  const { somaEmCentavos, diferencaEmCentavos: diferenca, fecha } = resultado;
  const podeSalvar = resultado.podeSalvar && !salvando;

  const atualizarParcela = (id: number, patch: Partial<ParcelaPlanejada>) => {
    setParcelas((atuais) =>
      atuais.map((parcela) => (parcela.id === id ? { ...parcela, ...patch } : parcela)),
    );
  };

  /*
   * Somar ou tirar parcela redistribui na hora.
   *
   * A alternativa era deixar a nova linha em zero (ou o valor da removida no
   * ar) e esperar o usuário fechar a conta na mão. Como a soma é justamente o
   * que não pode mudar, o estado intermediário seria sempre inválido; começar
   * pelo rateio igual deixa a conta fechada desde o primeiro clique, e quem quer
   * valores diferentes digita por cima.
   */
  const adicionar = () => {
    if (parcelas.length >= MAXIMO_DE_PARCELAS) {
      toast.error(`Um parcelamento pode ter no máximo ${MAXIMO_DE_PARCELAS} parcelas.`);
      return;
    }

    setParcelas((atuais) => {
      const ultima = atuais[atuais.length - 1]?.vencimento ?? hojeSemHora();
      const proxima: ParcelaPlanejada = {
        // Id só de lista: as parcelas novas ainda não existem no banco, e as
        // antigas já usam o id delas. Negativo para nunca colidir.
        id: -Date.now(),
        valor: 0,
        vencimento: avancarMeses(ultima, 1),
      };

      return redistribuirIgualmente([...atuais, proxima], alvoEmCentavos);
    });
  };

  const remover = (id: number) => {
    if (parcelas.length === 1) {
      toast.error("O parcelamento precisa de ao menos uma parcela.");
      return;
    }

    setParcelas((atuais) =>
      redistribuirIgualmente(
        atuais.filter((parcela) => parcela.id !== id),
        alvoEmCentavos,
      ),
    );
  };

  const distribuirIgualmente = () => {
    setParcelas((atuais) => redistribuirIgualmente(atuais, alvoEmCentavos));
  };

  const restaurar = () => setParcelas(paraParcelas(pendentes));

  const salvar = async () => {
    if (!podeSalvar) return;

    setSalvando(true);
    try {
      const resposta = await axios.post(
        `/api/transaction/${transacaoAtualId}/reparcelar`,
        {
          parcelas: parcelas.map((parcela) => ({
            valor: parcela.valor,
            data: parcela.vencimento?.toISOString(),
          })),
          motivo,
        },
      );

      // A resposta traz as parcelas que ficaram: as primeiras pendentes são
      // reaproveitadas e as que sobram somem. A aberta pode ser uma delas.
      const resultantes: Array<{ id?: number }> = resposta.data?.data?.parcelas ?? [];
      const sobreviveu =
        resultantes.length === 0 ||
        resultantes.some((parcela) => Number(parcela?.id) === transacaoAtualId);

      if (!sobreviveu && onTransacaoRemovida) {
        toast.success("Parcelamento atualizado.", {
          description: "Esta parcela deixou de existir na nova divisão.",
        });
        onTransacaoRemovida();
        return;
      }

      toast.success("Parcelamento atualizado.");
      onSalvo();
    } catch (error) {
      const conflito = isAxiosError(error) && error.response?.status === 409;

      toast.error(
        conflito
          ? "Este parcelamento foi alterado por outra pessoa"
          : "Não foi possível reparcelar",
        {
          description: isAxiosError(error)
            ? (error.response?.data?.error ?? error.message)
            : "Tente novamente.",
        },
      );

      if (conflito) onConflito();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            O que falta pagar não muda — só em quantas vezes e para quando.
            {baixadas.length > 0 ? (
              <>
                {" "}
                {baixadas.length} parcela{baixadas.length === 1 ? "" : "s"} já
                baixada{baixadas.length === 1 ? "" : "s"} ({formatarEmReal(totalBaixado)})
                {baixadas.length === 1 ? " fica" : " ficam"} como está
                {baixadas.length === 1 ? "" : "ão"}.
              </>
            ) : null}
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-xs"
          onClick={distribuirIgualmente}
          disabled={salvando}
        >
          Distribuir igualmente
        </Button>
      </div>

      <ul className="space-y-2">
        {parcelas.map((parcela, indice) => {
          const semValor = resultado.semValor.includes(indice + 1);
          const vencimentoRuim = resultado.vencimentoInvalido.includes(indice + 1);

          return (
            <li
              key={parcela.id}
              className={`rounded-lg border p-3 ${
                parcela.id === transacaoAtualId
                  ? "border-primary/50 bg-primary/5"
                  : "bg-card"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {indice + 1}ª parcela de {parcelas.length}
                </span>
                {parcela.id === transacaoAtualId ? (
                  <span className="rounded border px-1 text-[9px] uppercase text-muted-foreground">
                    Esta transação
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover a ${indice + 1}ª parcela`}
                  className="ml-auto h-7 w-7 text-destructive"
                  onClick={() => remover(parcela.id)}
                  disabled={salvando}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`vencimento-${parcela.id}`} className="text-xs">
                    Vencimento
                  </Label>
                  <DatePicker
                    value={paraValorDeInputDate(parcela.vencimento)}
                    min={paraValorDeInputDate(hoje)}
                    disabled={salvando}
                    className={vencimentoRuim ? "border-destructive" : undefined}
                    onChange={(valor) =>
                      atualizarParcela(parcela.id, { vencimento: dataDoInput(valor) })
                    }
                  />
                  {vencimentoRuim ? (
                    <p className="text-[11px] text-destructive">
                      Escolha uma data de hoje em diante.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`valor-${parcela.id}`} className="text-xs">
                    Valor
                  </Label>
                  <ValueInput
                    id={`valor-${parcela.id}`}
                    aria-label={`Valor da ${indice + 1}ª parcela`}
                    aria-invalid={semValor}
                    value={parcela.valor}
                    onValueChange={(valor) => atualizarParcela(parcela.id, { valor })}
                    disabled={salvando}
                    className={semValor ? "border-destructive" : undefined}
                  />
                  {semValor ? (
                    <p className="text-[11px] text-destructive">
                      O valor precisa ser maior que zero.
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={adicionar}
        disabled={salvando}
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar parcela
      </Button>

      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
          fecha
            ? "border-emerald-600/40 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400"
            : "border-destructive/40 bg-destructive/5 text-destructive"
        }`}
      >
        <span className="flex items-center gap-2 font-medium">
          {fecha ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {fecha
            ? resultado.semValor.length || resultado.vencimentoInvalido.length
              ? "A soma fecha, mas há parcela com dado inválido."
              : "A soma bate com o que está em aberto."
            : diferenca > 0
              ? `Faltam ${formatarCentavos(diferenca)} para fechar.`
              : `Sobram ${formatarCentavos(Math.abs(diferenca))}.`}
        </span>
        <span className="tabular-nums text-xs">
          {formatarCentavos(somaEmCentavos)} de {formatarCentavos(alvoEmCentavos)}
        </span>
      </div>

      <div className="space-y-1">
        <Label htmlFor="motivo-reparcelamento" className="text-xs">
          Motivo do reparcelamento
        </Label>
        <Input
          id="motivo-reparcelamento"
          value={motivo}
          maxLength={200}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder="Ex.: cliente pediu para dividir em mais vezes"
          disabled={salvando}
        />
        <p className="text-[11px] text-muted-foreground">
          Fica registrado no histórico junto com quem alterou.
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={restaurar} disabled={salvando}>
          Restaurar
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="button" onClick={() => void salvar()} disabled={!podeSalvar}>
          {salvando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar parcelamento"
          )}
        </Button>
      </div>
    </div>
  );
}
