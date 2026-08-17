"use client";

import { useMemo, useState } from "react";
import axios, { isAxiosError } from "axios";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import {
  distribuirValoresIguais,
  formatarCentavos,
  paraCentavos,
  paraReais,
  validarRateio,
} from "@/lib/financeiro/rateio";

import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";

import type { LancamentoRelacionado } from "./types";

interface LinhaRateio {
  id: number;
  descricao: string;
  pendente: boolean;
  valor: number;
  valorLiquido: number;
  /** Congelados na abertura: viajam para o servidor detectar edição concorrente. */
  valorOriginal: number;
  valorLiquidoOriginal: number;
}

interface RateioEditorProps {
  /** Somente os lançamentos que abatem o documento (`contaParaTotal`). */
  itens: LancamentoRelacionado[];
  transacaoAtualId: number;
  rotuloDocumento: string;
  onCancelar: () => void;
  onSalvo: () => void;
  /** Alguém salvou primeiro: recarregar e sair do modo de ajuste. */
  onConflito: () => void;
}

function paraLinhas(itens: LancamentoRelacionado[]): LinhaRateio[] {
  return itens.map((item) => {
    const valor = paraReais(paraCentavos(item.valor));
    // Registro sem líquido gravado entra com o próprio bruto; entrar com zero
    // deixaria a linha inválida antes de o usuário encostar nela.
    const valorLiquido = paraReais(paraCentavos(valorLiquidoEfetivo(item)));

    return {
      id: item.id,
      descricao: item.descricao,
      pendente: Boolean(item.pendente),
      valor,
      valorLiquido,
      valorOriginal: valor,
      valorLiquidoOriginal: valorLiquido,
    };
  });
}

/**
 * Redistribui os valores entre os pagamentos de uma OS/venda.
 *
 * O total bruto é imutável — a operadora do cartão rateia as parcelas de um jeito
 * diferente do que foi digitado, mas o que o cliente pagou continua o mesmo. Por
 * isso a única saída daqui é um conjunto de valores que soma exatamente o mesmo
 * que entrou; o botão só destrava quando a conta fecha.
 */
export function RateioEditor({
  itens,
  transacaoAtualId,
  rotuloDocumento,
  onCancelar,
  onSalvo,
  onConflito,
}: RateioEditorProps) {
  const [linhas, setLinhas] = useState<LinhaRateio[]>(() => paraLinhas(itens));
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const alvoEmCentavos = useMemo(
    () => itens.reduce((total, item) => total + paraCentavos(item.valor), 0),
    [itens],
  );

  const resultado = useMemo(
    () => validarRateio(linhas, alvoEmCentavos),
    [linhas, alvoEmCentavos],
  );

  const { somaEmCentavos, diferencaEmCentavos: diferenca, fecha } = resultado;
  const podeSalvar = resultado.podeSalvar && !salvando;

  const atualizarLinha = (id: number, patch: Partial<LinhaRateio>) => {
    setLinhas((atuais) =>
      atuais.map((linha) => (linha.id === id ? { ...linha, ...patch } : linha)),
    );
  };

  const distribuirIgualmente = () => {
    const valores = distribuirValoresIguais(paraReais(alvoEmCentavos), linhas.length);
    setLinhas((atuais) =>
      atuais.map((linha, indice) => {
        const bruto = valores[indice] ?? 0;
        // Mantém a proporção da taxa já conhecida; sem taxa, líquido segue o bruto.
        const brutoAnterior = paraCentavos(linha.valor);
        const liquidoAnterior = paraCentavos(linha.valorLiquido);
        const proporcional =
          brutoAnterior > 0
            ? Math.round((liquidoAnterior / brutoAnterior) * paraCentavos(bruto))
            : paraCentavos(bruto);

        return { ...linha, valor: bruto, valorLiquido: paraReais(proporcional) };
      }),
    );
  };

  const restaurar = () => setLinhas(paraLinhas(itens));

  const salvar = async () => {
    if (!podeSalvar) return;

    setSalvando(true);
    try {
      await axios.post(`/api/transaction/${transacaoAtualId}/ajustar-valores`, {
        itens: linhas.map((linha) => ({
          id: linha.id,
          valor: linha.valor,
          valorLiquido: linha.valorLiquido,
          valorAnterior: linha.valorOriginal,
          valorLiquidoAnterior: linha.valorLiquidoOriginal,
        })),
        motivo,
      });

      toast.success("Valores ajustados.");
      onSalvo();
    } catch (error) {
      const conflito = isAxiosError(error) && error.response?.status === 409;

      toast.error(
        conflito ? "Estes valores foram alterados por outra pessoa" : "Não foi possível ajustar os valores",
        {
          description: isAxiosError(error)
            ? (error.response?.data?.error ?? error.message)
            : "Tente novamente.",
        },
      );

      // Insistir com números velhos só repetiria o conflito: volta para a lista
      // já recarregada, para o rateio ser refeito em cima do que está no banco.
      if (conflito) onConflito();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            O total já pago {rotuloDocumento} não muda — só a divisão entre os
            lançamentos. O líquido é livre, é o que sobrou depois da taxa.
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
        {linhas.map((linha, indice) => {
          const excedeBruto =
            paraCentavos(linha.valorLiquido) > paraCentavos(linha.valor);

          return (
            <li
              key={linha.id}
              className={`border p-3 ${
                linha.id === transacaoAtualId ? "border-primary/50 bg-primary/5" : "bg-card"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{linha.descricao}</span>
                {linha.id === transacaoAtualId && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    Esta transação
                  </Badge>
                )}
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  {linha.pendente ? (
                    <>
                      <Clock className="h-3 w-3" /> Pendente
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Realizada
                    </>
                  )}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`bruto-${linha.id}`} className="text-xs">
                    Valor bruto
                  </Label>
                  <ValueInput
                    id={`bruto-${linha.id}`}
                    aria-label={`Valor bruto do pagamento ${indice + 1}`}
                    value={linha.valor}
                    onValueChange={(valor) => atualizarLinha(linha.id, { valor })}
                    disabled={salvando}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`liquido-${linha.id}`} className="text-xs">
                    Líquido recebido
                  </Label>
                  <ValueInput
                    id={`liquido-${linha.id}`}
                    aria-label={`Valor líquido do pagamento ${indice + 1}`}
                    aria-invalid={excedeBruto}
                    value={linha.valorLiquido}
                    onValueChange={(valorLiquido) =>
                      atualizarLinha(linha.id, { valorLiquido })
                    }
                    disabled={salvando}
                    className={excedeBruto ? "border-destructive" : undefined}
                  />
                  {excedeBruto ? (
                    <p className="text-[11px] text-destructive">
                      O líquido não pode passar do bruto.
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm ${
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
            ? resultado.invalidas.length
              ? "A soma fecha, mas há linha com valor inválido."
              : "A soma bate com o total pago."
            : diferenca > 0
              ? `Faltam ${formatarCentavos(diferenca)} para fechar.`
              : `Sobram ${formatarCentavos(Math.abs(diferenca))}.`}
        </span>
        <span className="tabular-nums text-xs">
          {formatarCentavos(somaEmCentavos)} de {formatarCentavos(alvoEmCentavos)}
        </span>
      </div>

      <div className="space-y-1">
        <Label htmlFor="motivo-ajuste" className="text-xs">
          Motivo do ajuste
        </Label>
        <Input
          id="motivo-ajuste"
          value={motivo}
          maxLength={200}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder="Ex.: rateio conforme extrato da maquineta"
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
            "Salvar rateio"
          )}
        </Button>
      </div>
    </div>
  );
}
