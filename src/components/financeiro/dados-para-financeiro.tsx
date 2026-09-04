"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import type { PaymentMethodItem, PaymentMethodOption, PlannedPayment } from "@/lib/payment-methods";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import { useState } from "react";

/**
 * O que a venda manda ao financeiro no fechamento.
 *
 * É o mesmo conjunto que a OS recolhe em "Confirmar envio ao Financeiro": as
 * formas previstas com valor e parcelas, a orientação combinada na negociação e
 * a garantia prometida. Nenhum desses três se recupera depois — quem fechou a
 * venda é a única pessoa que sabe.
 *
 * Vive fora das duas telas porque o PDV e a edição da venda precisam gravar
 * exatamente a mesma coisa. Um campo a mais em uma e a menos na outra criaria
 * venda cujo dado depende de por onde passou.
 */
export type DadosParaFinanceiro = {
  metodos: PaymentMethodOption[];
  /** Valor em reais por forma. Só as formas selecionadas contam. */
  valores: Record<string, number>;
  /** Parcelas por forma. Só vale nas formas paraceláveis; o resto é ignorado. */
  parcelas: Record<string, number>;
  descricaoFinanceiro: string;
  garantia: string;
};

export const GARANTIA_MAX_CARACTERES = 500;
export const PARCELAS_MAXIMAS = 12;

/**
 * Parcelar é coisa de crédito, boleto e promissória: nos demais o dinheiro
 * entra de uma vez, e oferecer parcelas ali só produziria um número que
 * ninguém honra. Mesma regra da OS (ver `ordemservico_parcelas_compativel_forma`).
 */
export const formaAceitaParcelas = (metodo: string) =>
  metodo === "CREDITO" || metodo === "BOLETO" || metodo === "PROMISSORIA";

const paraCentavos = (valor: number) =>
  Math.round((Number.isFinite(valor) ? valor : 0) * 100);

const emReais = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor || 0);

export function dadosParaFinanceiroVazios(): DadosParaFinanceiro {
  return {
    metodos: [],
    valores: {},
    parcelas: {},
    descricaoFinanceiro: "",
    garantia: "",
  };
}

/**
 * Reconstrói o formulário a partir da venda gravada.
 *
 * A fonte é `pagamentos_previstos`, que guarda forma, valor e parcelas separados.
 * `forma_pagamento` não serve aqui: é o resumo em texto, montado para leitura, e
 * voltar dele significaria interpretar frase para recuperar número.
 */
export function dadosParaFinanceiroDaVenda(venda: {
  pagamentos_previstos?: unknown;
  descricao_financeiro?: string | null;
  garantia?: string | null;
}): DadosParaFinanceiro {
  const previstos = Array.isArray(venda?.pagamentos_previstos)
    ? (venda.pagamentos_previstos as PlannedPayment[])
    : [];

  const dados = dadosParaFinanceiroVazios();
  dados.descricaoFinanceiro = venda?.descricao_financeiro ?? "";
  dados.garantia = venda?.garantia ?? "";

  for (const pagamento of previstos) {
    const metodo = String(pagamento?.metodo ?? "").trim().toUpperCase();
    if (!metodo) continue;

    dados.metodos.push(metodo);
    dados.valores[metodo] = Number(pagamento?.valor ?? 0);
    if (formaAceitaParcelas(metodo)) {
      dados.parcelas[metodo] = Number(pagamento?.parcelas ?? 1) || 1;
    }
  }

  return dados;
}

export function montarPagamentosPrevistos(dados: DadosParaFinanceiro): PlannedPayment[] {
  return dados.metodos.map((metodo) => ({
    metodo,
    valor: Number(dados.valores[metodo] ?? 0),
    parcelas: formaAceitaParcelas(metodo) ? Number(dados.parcelas[metodo] ?? 1) : null,
  }));
}

/**
 * O resumo em texto que `venda.forma_pagamento` sempre guardou.
 *
 * Continua sendo gravado no mesmo formato ("PIX: R$ 10,00, CREDITO: R$ 5,00")
 * porque as telas que já leem esse campo o separam por ele. As colunas novas não
 * o substituem: elas guardam o dado, ele guarda a frase.
 */
export function montarFormaPagamento(dados: DadosParaFinanceiro): string | null {
  if (dados.metodos.length === 0) return null;

  return dados.metodos
    .map((metodo) => `${metodo}: ${emReais(Number(dados.valores[metodo] ?? 0))}`)
    .join(", ");
}

/**
 * Devolve a primeira recusa, ou `null` se estiver tudo certo.
 *
 * `totalCents` é o valor que os pagamentos precisam fechar. Passando `null`, a
 * soma não é conferida — é o caso da edição, em que o total pode estar sendo
 * alterado na mesma tela.
 */
export function validarDadosParaFinanceiro(
  dados: DadosParaFinanceiro,
  totalCents: number | null,
): string | null {
  if (dados.garantia.length > GARANTIA_MAX_CARACTERES) {
    return `A garantia deve ter no máximo ${GARANTIA_MAX_CARACTERES} caracteres.`;
  }

  if (dados.metodos.length === 0) return null;

  if (new Set(dados.metodos).size !== dados.metodos.length) {
    return "Há formas de pagamento repetidas.";
  }

  for (const metodo of dados.metodos) {
    if (paraCentavos(Number(dados.valores[metodo] ?? 0)) <= 0) {
      return "Informe um valor maior que zero para cada forma de pagamento.";
    }
    if (formaAceitaParcelas(metodo)) {
      const parcelas = Number(dados.parcelas[metodo] ?? 1);
      if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_MAXIMAS) {
        return `As parcelas de Crédito, Boleto ou Promissória devem estar entre 1 e ${PARCELAS_MAXIMAS}.`;
      }
    }
  }

  if (totalCents !== null) {
    const somaCents = dados.metodos.reduce(
      (soma, metodo) => soma + paraCentavos(Number(dados.valores[metodo] ?? 0)),
      0,
    );
    if (somaCents !== totalCents) {
      return `A soma dos pagamentos precisa fechar o total. Informado: ${emReais(
        somaCents / 100,
      )}. Total: ${emReais(totalCents / 100)}.`;
    }
  }

  return null;
}

function rotuloDoMetodo(metodo: string, opcoes: PaymentMethodItem[]) {
  return opcoes.find((opcao) => opcao.value === metodo)?.label ?? formatPaymentMethodLabel(metodo);
}

/**
 * Os campos, iguais aos do diálogo de envio da OS ao financeiro.
 *
 * Controlado por fora: as duas telas que o usam já têm o estado da venda inteira,
 * e um estado próprio aqui dentro criaria uma segunda verdade sobre os mesmos
 * números na hora de salvar.
 */
export function DadosParaFinanceiroFields({
  value,
  onChange,
  totalCents,
  disabled = false,
}: {
  value: DadosParaFinanceiro;
  onChange: (proximo: DadosParaFinanceiro) => void;
  /** Total a fechar. `null` esconde a conferência de soma e o "Restante". */
  totalCents: number | null;
  disabled?: boolean;
}) {
  const {
    options: opcoesPagamento,
    isLoading: carregandoPagamentos,
    error: erroPagamentos,
    reload: recarregarPagamentos,
  } = usePaymentMethodOptions();
  const [metodosAbertos, setMetodosAbertos] = useState(false);

  const somaCents = value.metodos.reduce(
    (soma, metodo) => soma + paraCentavos(Number(value.valores[metodo] ?? 0)),
    0,
  );

  const alternarMetodo = (metodo: PaymentMethodOption) => {
    if (value.metodos.includes(metodo)) {
      const valores = { ...value.valores };
      const parcelas = { ...value.parcelas };
      delete valores[metodo];
      delete parcelas[metodo];
      onChange({
        ...value,
        metodos: value.metodos.filter((atual) => atual !== metodo),
        valores,
        parcelas,
      });
      return;
    }

    onChange({
      ...value,
      metodos: [...value.metodos, metodo],
      parcelas: formaAceitaParcelas(metodo)
        ? { ...value.parcelas, [metodo]: value.parcelas[metodo] ?? 1 }
        : value.parcelas,
    });
  };

  const rotuloMetodos =
    value.metodos.length === 0
      ? "Não informar"
      : value.metodos.map((metodo) => rotuloDoMetodo(metodo, opcoesPagamento)).join(", ");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Formas de pagamento</Label>
        <Popover open={metodosAbertos} onOpenChange={setMetodosAbertos}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              disabled={disabled}
            >
              <span className="truncate">{rotuloMetodos}</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-0"
          >
            <Command>
              <CommandList>
                <CommandGroup>
                  <CommandItem
                    value="nao-informar"
                    onSelect={() =>
                      onChange({ ...value, metodos: [], valores: {}, parcelas: {} })
                    }
                    className="flex items-center gap-3"
                  >
                    <Checkbox checked={value.metodos.length === 0} />
                    <span>Não informar</span>
                  </CommandItem>
                  {carregandoPagamentos ? (
                    <CommandItem disabled>Carregando formas de pagamento...</CommandItem>
                  ) : erroPagamentos ? (
                    <CommandItem onSelect={() => void recarregarPagamentos()}>
                      Falha ao carregar. Clique para tentar novamente.
                    </CommandItem>
                  ) : opcoesPagamento.length === 0 ? (
                    <CommandItem disabled>Nenhuma forma de pagamento cadastrada.</CommandItem>
                  ) : (
                    opcoesPagamento.map((metodo) => (
                      <CommandItem
                        key={metodo.value}
                        value={metodo.value}
                        onSelect={() => alternarMetodo(metodo.value)}
                        className="flex items-center gap-3"
                      >
                        <Checkbox checked={value.metodos.includes(metodo.value)} />
                        <span>{metodo.label}</span>
                      </CommandItem>
                    ))
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {value.metodos.length > 0 && (
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                Valores por forma
              </span>
              <span className="text-xs text-muted-foreground">
                {emReais(somaCents / 100)}
                {totalCents !== null ? ` / ${emReais(totalCents / 100)}` : ""}
              </span>
            </div>

            <div className="space-y-2">
              {value.metodos.map((metodo) => {
                const comParcelas = formaAceitaParcelas(metodo);

                return (
                  <div
                    key={metodo}
                    className={
                      comParcelas
                        ? "grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)_90px] sm:items-end"
                        : "grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] sm:items-end"
                    }
                  >
                    <div className="min-w-0 pb-2">
                      <span className="truncate text-sm">
                        {rotuloDoMetodo(metodo, opcoesPagamento)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Valor</Label>
                      <ValueInput
                        value={Number(value.valores[metodo] ?? 0)}
                        onValueChange={(valor) =>
                          onChange({
                            ...value,
                            valores: { ...value.valores, [metodo]: valor },
                          })
                        }
                        className="h-9 text-right"
                        disabled={disabled}
                      />
                    </div>
                    {comParcelas && (
                      <div className="space-y-1">
                        <Label className="text-xs">Parcelas</Label>
                        <Select
                          value={String(value.parcelas[metodo] ?? 1)}
                          onValueChange={(parcelas) =>
                            onChange({
                              ...value,
                              parcelas: { ...value.parcelas, [metodo]: Number(parcelas) },
                            })
                          }
                          disabled={disabled}
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(
                              { length: PARCELAS_MAXIMAS },
                              (_, indice) => indice + 1,
                            ).map((parcelas) => (
                              <SelectItem key={parcelas} value={String(parcelas)}>
                                {parcelas}x
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {totalCents !== null && somaCents !== totalCents && (
              <p className="text-xs text-amber-600">
                Restante: {emReais(Math.max(0, totalCents - somaCents) / 100)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Descrição para o financeiro</Label>
        <Textarea
          value={value.descricaoFinanceiro}
          onChange={(evento) =>
            onChange({ ...value, descricaoFinanceiro: evento.target.value })
          }
          placeholder="Ex.: cobrar entrada, vencimento combinado ou outras orientações"
          rows={3}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Garantia</Label>
        <Input
          value={value.garantia}
          maxLength={GARANTIA_MAX_CARACTERES}
          onChange={(evento) => onChange({ ...value, garantia: evento.target.value })}
          placeholder="Ex.: 90 dias para peças e serviços"
          disabled={disabled}
        />
        <p className="text-right text-xs text-muted-foreground">
          {value.garantia.length}/{GARANTIA_MAX_CARACTERES}
        </p>
      </div>
    </div>
  );
}
