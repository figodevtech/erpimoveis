"use client";

import { useMemo, useState } from "react";
import axios, { isAxiosError } from "axios";
import {
  AlertTriangle,
  CalendarArrowDown,
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
  redistribuirParaTotal,
  totalDasParcelas,
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
  /**
   * O total do que está em aberto pode mudar aqui?
   *
   * Trava com documento — o total é dado da OS, da venda ou da nota, e quem
   * mexe nele é o documento, não esta tela. Livre no lançamento avulso, onde o
   * grupo é o próprio total e travá-lo só impedia diminuir uma parcela ou
   * renegociar a dívida.
   */
  totalTravado: boolean;
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
 * Reparcela: quantidade, vencimentos e — dependendo do modo — o total.
 *
 * O que já foi baixado não entra em nenhum dos dois modos: é dinheiro que andou,
 * e o banco recusa mexer no valor dele.
 *
 * Com documento (`totalTravado`), o que sobra é o total pendente e ele não muda
 * de tamanho: reparcelar redivide o que falta, não perdoa nem cobra a mais — o
 * botão só destrava quando a soma fecha no mesmo número. Num lançamento avulso o
 * total é campo, porque ali ele não responde a documento nenhum.
 */
export function ReparcelarEditor({
  itens,
  transacaoAtualId,
  totalTravado,
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

  /** O total pendente quando a tela abriu. Nunca muda depois disso. */
  const alvoOriginalEmCentavos = useMemo(
    () => pendentes.reduce((total, item) => total + paraCentavos(item.valor), 0),
    [pendentes],
  );

  /*
   * O alvo corrente. Travado, é o original e pronto. Livre, é o que a pessoa
   * digitou no campo de total — e é contra ele que a barra de status compara,
   * para "as parcelas somam o que você pediu" continuar sendo uma pergunta útil.
   */
  const [alvoEmCentavos, setAlvoEmCentavos] = useState(alvoOriginalEmCentavos);

  const totalBaixado = useMemo(
    () => baixadas.reduce((total, item) => total + Number(item.valor ?? 0), 0),
    [baixadas],
  );

  const resultado = useMemo(
    () => validarReparcelamento(parcelas, alvoEmCentavos, { totalTravado }),
    [parcelas, alvoEmCentavos, totalTravado],
  );

  const { somaEmCentavos, diferencaEmCentavos: diferenca, fecha } = resultado;
  const temDadoInvalido =
    resultado.semValor.length > 0 || resultado.semVencimento.length > 0;
  const podeSalvar = resultado.podeSalvar && !salvando;

  const atualizarParcela = (id: number, patch: Partial<ParcelaPlanejada>) => {
    setParcelas((atuais) => {
      const novas = atuais.map((parcela) =>
        parcela.id === id ? { ...parcela, ...patch } : parcela,
      );

      /*
       * Com o total livre, quem manda é a soma das parcelas.
       *
       * Se o campo de total ficasse parado enquanto a pessoa digita numa
       * parcela, os dois números brigariam e o botão travaria de novo — que é
       * exatamente a reclamação que originou este modo. Travado, o alvo é do
       * documento e não segue ninguém.
       */
      if (!totalTravado) setAlvoEmCentavos(totalDasParcelas(novas));

      return novas;
    });
  };

  /** Mudar o total: as parcelas seguem, mantendo a proporção já montada. */
  const mudarTotal = (valor: number) => {
    const centavos = paraCentavos(valor);
    setAlvoEmCentavos(centavos);
    setParcelas((atuais) => redistribuirParaTotal(atuais, centavos));
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

  /*
   * Repete o vencimento desta parcela nas seguintes, de mês em mês.
   *
   * É o atalho de quem empurra o parcelamento inteiro: corrigida a data da
   * primeira, as outras vinte e nove são a mesma conta feita à mão. As
   * anteriores ficam onde estão — quem clica está dizendo que a divergência
   * começa aqui.
   *
   * Cada data sai de `base` (e não da anterior) para o dia sobreviver ao mês
   * curto: partindo de 31/01 vem 28/02 e depois 31/03, não 28/03.
   */
  const aplicarMensalAPartirDe = (indice: number) => {
    const base = parcelas[indice]?.vencimento;
    if (!base) return;

    setParcelas((atuais) =>
      atuais.map((parcela, posicao) =>
        posicao <= indice
          ? parcela
          : { ...parcela, vencimento: avancarMeses(base, posicao - indice) },
      ),
    );

    // As seguintes quase sempre estão fora da tela: sem o aviso, o clique não
    // parece ter feito nada.
    const alcancadas = parcelas.length - indice - 1;
    toast.success(
      `${alcancadas} parcela${alcancadas === 1 ? "" : "s"} seguinte${alcancadas === 1 ? "" : "s"} ${alcancadas === 1 ? "remarcada" : "remarcadas"} de mês em mês.`,
    );
  };

  const distribuirIgualmente = () => {
    setParcelas((atuais) => redistribuirIgualmente(atuais, alvoEmCentavos));
  };

  const restaurar = () => {
    setParcelas(paraParcelas(pendentes));
    setAlvoEmCentavos(alvoOriginalEmCentavos);
  };

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
          totalAnterior: alvoOriginalEmCentavos / 100,
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
      <div className="flex flex-col gap-2 border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {totalTravado
              ? "O que falta pagar não muda — só em quantas vezes e para quando."
              : "Você pode mudar o total, a quantidade e os vencimentos. Mexer no total redistribui entre as parcelas mantendo a proporção."}
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

      {!totalTravado ? (
        <div className="flex flex-wrap items-end gap-3 border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor="total-reparcelamento" className="text-xs">
              Total a reparcelar
            </Label>
            <ValueInput
              id="total-reparcelamento"
              className="w-40"
              value={alvoEmCentavos / 100}
              onValueChange={mudarTotal}
              disabled={salvando}
            />
          </div>
          <p className="flex-1 text-[11px] text-muted-foreground">
            {alvoEmCentavos === alvoOriginalEmCentavos
              ? "Era isto que estava em aberto. Mudar aqui redistribui entre as parcelas."
              : `Estava em ${formatarCentavos(alvoOriginalEmCentavos)}. A mudança fica registrada no histórico.`}
          </p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {parcelas.map((parcela, indice) => {
          const semValor = resultado.semValor.includes(indice + 1);
          const semVencimento = resultado.semVencimento.includes(indice + 1);
          const vencida =
            parcela.vencimento != null && parcela.vencimento < hojeSemHora();

          return (
            <li
              key={parcela.id}
              className={`group border p-3 ${
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
                {indice < parcelas.length - 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Mensal daqui — repetir a data da ${indice + 1}ª parcela nas seguintes`}
                    title="Copia este vencimento para as parcelas de baixo, uma por mês."
                    className="ml-auto h-7 text-xs font-normal text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                    onClick={() => aplicarMensalAPartirDe(indice)}
                    disabled={salvando || !parcela.vencimento}
                  >
                    <CalendarArrowDown className="h-3.5 w-3.5" />
                    Mensal daqui
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover a ${indice + 1}ª parcela`}
                  className={`h-7 w-7 text-destructive ${
                    indice < parcelas.length - 1 ? "" : "ml-auto"
                  }`}
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
                  {/* Sem `min`: renegociar um título vencido é justamente quando
                      se reparcela, e a data que já passou precisa continuar
                      escolhível.

                      `allowTyping`: aqui as datas vêm em série. Empurrar
                      trinta parcelas para o ano que vem pelo calendário
                      seria navegar doze meses trinta vezes; digitando são
                      oito teclas por linha, e o ícone ao lado continua
                      abrindo o calendário de sempre. */}
                  <DatePicker
                    id={`vencimento-${parcela.id}`}
                    aria-label={`Vencimento da ${indice + 1}ª parcela`}
                    allowTyping
                    value={paraValorDeInputDate(parcela.vencimento)}
                    disabled={salvando}
                    className={semVencimento ? "border-destructive" : undefined}
                    onChange={(valor) =>
                      atualizarParcela(parcela.id, { vencimento: dataDoInput(valor) })
                    }
                  />
                  {semVencimento ? (
                    <p className="text-[11px] text-destructive">
                      Escolha a data de vencimento.
                    </p>
                  ) : vencida ? (
                    <p className="text-[11px] text-amber-600">
                      Vencida — o título nasce em atraso.
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
        className={`flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm ${
          temDadoInvalido
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : fecha
              ? "border-emerald-600/40 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400"
              : totalTravado
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
        }`}
      >
        <span className="flex items-center gap-2 font-medium">
          {!temDadoInvalido && fecha ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {temDadoInvalido
            ? "Há parcela com valor ou vencimento faltando."
            : fecha
              ? totalTravado
                ? "A soma bate com o que está em aberto."
                : "As parcelas somam o total."
              : totalTravado
                ? diferenca > 0
                  ? `Faltam ${formatarCentavos(diferenca)} para fechar.`
                  : `Sobram ${formatarCentavos(Math.abs(diferenca))}.`
                : `As parcelas somam ${formatarCentavos(somaEmCentavos)}, e o total está em ${formatarCentavos(alvoEmCentavos)}.`}
        </span>
        <span className="tabular-nums text-xs">
          {formatarCentavos(somaEmCentavos)} de {formatarCentavos(alvoEmCentavos)}
          {!totalTravado && alvoEmCentavos !== alvoOriginalEmCentavos
            ? ` · era ${formatarCentavos(alvoOriginalEmCentavos)}`
            : ""}
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
