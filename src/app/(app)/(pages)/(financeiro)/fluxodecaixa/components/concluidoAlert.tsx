"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/app/(app)/(pages)/config-context";

import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import axios, { isAxiosError } from "axios";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import ValueInput from "@/components/ui/value-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ehTituloAntecipado,
  saldoEmAberto,
  totalDaBaixaComAjustes,
  valorLiquidoEfetivo,
} from "@/lib/financeiro/transacao";
import { toast } from "@/lib/toast";
import { formatDate } from "@/utils/formatDate";
import formatarEmReal from "@/utils/formatarEmReal";

import { useCentrosCusto } from "../hooks/use-centros-custo";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";
import type { Banco, Transaction } from "../types";
import { Metodo_pagamento } from "../types";
import { PlanoContaCombobox } from "./plano-conta-combobox";
import { SearchCombobox } from "./search-combobox";
import { AjustesNaBaixa, type AjusteNaBaixa } from "./ajustes-na-baixa";

interface ConcluidoAlertProps {
  isAlertOpen: boolean;
  setIsAlertOpen: (value: boolean) => void;
  transaction: Transaction | null;
  onSuccess?: () => void;
}

/**
 * A forma de pagamento que não é dinheiro: consome a carteira do cliente.
 *
 * Comparar com o valor do enum é o mesmo que a tela já faz para decidir
 * parcelamento (BOLETO/CREDITO/PROMISSORIA). O que muda aqui é mais fundo:
 * some o banco, o valor deixa de ser editável e entra a conferência do saldo.
 */
const CREDITO_CLIENTE = "CREDITO CLIENTE";

type CreditoDoCliente = {
  clienteId: number | null;
  nome: string | null;
  saldo: number;
  valorTitulo: number;
  suficiente: boolean;
  sentido: "CREDITO" | "DEBITO";
};

export default function ConcluidoAlert({
  isAlertOpen,
  setIsAlertOpen,
  transaction,
  onSuccess,
}: ConcluidoAlertProps) {
  const [banks, setBanks] = useState<Banco[]>([]);
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">("");
  const [selectedPlanoId, setSelectedPlanoId] = useState("");
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [lancarNoCaixa, setLancarNoCaixa] = useState(false);
  const [valorLancado, setValorLancado] = useState(0);
  const [valorBaixaManual, setValorBaixa] = useState<number | null>(null);
  const [ajustes, setAjustes] = useState<AjusteNaBaixa[]>([]);
  const [rascunhoAjuste, setRascunhoAjuste] = useState(false);
  const config = useConfig();
  /**
   * De quem é o título e quanto de crédito essa pessoa tem. Só é buscado quando
   * a forma escolhida é Crédito do cliente — nas demais não muda nada na tela.
   */
  const [credito, setCredito] = useState<CreditoDoCliente | null>(null);
  const [carregandoCredito, setCarregandoCredito] = useState(false);

  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();

  useEffect(() => {
    if (!isAlertOpen || !transaction) return;

    setSelectedBankId(transaction.banco_id ? String(transaction.banco_id) : "");
    setSelectedMetodo(transaction.metodopagamento || "");
    setSelectedPlanoId(transaction.plano_de_conta_id ? String(transaction.plano_de_conta_id) : "");
    setSelectedCentroCustoId(transaction.centro_custo_id ? String(transaction.centro_custo_id) : "");
    // Sempre desligado ao abrir. É a resposta certa na maioria esmagadora das
    // vezes, e deixá-la marcada de uma baixa anterior lançaria dinheiro que não
    // entrou na próxima.
    setLancarNoCaixa(false);
    // Nasce no saldo: baixar tudo é o que se faz quase sempre, e quem vai receber
    // menos edita o número.
    setValorBaixa(null);
    setAjustes([]);
    setRascunhoAjuste(false);
    /*
     * O repasse nasce no juros, quando existe juros.
     *
     * Num título antecipado com acréscimo, o que o banco costuma repassar é
     * exatamente ele: o principal já foi adiantado e fica retido, e o que sobra é
     * o que o atraso rendeu. Preencher com o valor cheio obrigava a apagar e
     * redigitar bem no caso mais comum — e, pior, um clique distraído lançaria o
     * título inteiro na conta.
     *
     * Sem acréscimo, o caso é "o banco devolveu tudo", e aí o cheio é o certo.
     */
    const acrescimos = Number(transaction.valor_acrescimos ?? 0);
    setValorLancado(
      Number.isFinite(acrescimos) && acrescimos > 0
        ? acrescimos
        : saldoEmAberto(transaction),
    );
    setDataPagamento(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  }, [isAlertOpen, transaction]);

  useEffect(() => {
    if (!isAlertOpen) return;

    let active = true;

    async function fetchBanks() {
      setIsLoadingBanks(true);
      setBankLoadError(null);

      try {
        const response = await axios.get("/api/banks");
        if (active) setBanks(response.data.data ?? []);
      } catch (error) {
        console.error("Erro ao carregar bancos:", error);
        if (active) {
          setBanks([]);
          setBankLoadError("Não foi possível carregar os bancos.");
        }
      } finally {
        if (active) setIsLoadingBanks(false);
      }
    }

    void fetchBanks();

    return () => {
      active = false;
    };
  }, [isAlertOpen]);

  /*
   * O crédito do cliente troca as regras da tela: não há banco a escolher, o
   * valor não é editável (quita o título inteiro ou nada) e o que precisa ser
   * conferido antes é o saldo da carteira.
   */
  const ehCreditoCliente = String(selectedMetodo).toUpperCase() === CREDITO_CLIENTE;

  useEffect(() => {
    if (!isAlertOpen || !transaction || !ehCreditoCliente) {
      setCredito(null);
      return;
    }

    let ativo = true;
    setCarregandoCredito(true);

    fetch(`/api/transaction/${transaction.id}/credito-cliente`, { cache: "no-store" })
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo?.error ?? "Falha ao consultar o crédito.");
        if (ativo) setCredito(corpo.data as CreditoDoCliente);
      })
      .catch(() => {
        if (ativo) setCredito(null);
      })
      .finally(() => {
        if (ativo) setCarregandoCredito(false);
      });

    return () => {
      ativo = false;
    };
  }, [isAlertOpen, transaction, ehCreditoCliente]);

  /*
   * Trocar para crédito do cliente devolve o valor ao saldo inteiro: ele quita
   * o título todo, e um número menor digitado antes ficaria na tela dizendo
   * algo que não vai acontecer.
   */
  useEffect(() => {
    if (ehCreditoCliente && transaction) {
      setValorBaixa(null);
    }
  }, [ehCreditoCliente, transaction]);

  /*
   * Título antecipado é o único que precisa escolher se a baixa move a conta.
   * Nos demais o banco é sempre gravado e não há nada a decidir — o servidor
   * inclusive recusa a bandeira fora deste caso.
   */
  const antecipado = ehTituloAntecipado(transaction);

  /*
   * O saldo é o teto da baixa e o valor que o campo nasce mostrando. Num título
   * que ainda não recebeu pagamento nenhum ele é o líquido inteiro, que era o
   * único número que existia aqui antes.
   */
  const saldoOriginal = saldoEmAberto(transaction);
  const valorBase = Number(transaction?.valor_base ?? transaction?.valor ?? 0);
  const projecao = totalDaBaixaComAjustes({
    saldo: saldoOriginal, valorBase, ajustes,
  });
  const saldo = ehCreditoCliente ? saldoOriginal : projecao.total;
  // Nulo acompanha o total projetado; digitação explícita preserva a parcial.
  const valorBaixa = valorBaixaManual ?? saldo;
  const bloqueioAjustes = antecipado
    ? "Para títulos antecipados, lance os ajustes na edição da transação antes da baixa."
    : ehCreditoCliente
      ? "Para usar crédito do cliente, lance os ajustes na edição da transação antes da baixa. Remova os ajustes desta tela para continuar com a carteira."
      : config?.habilitar_edicao_transacoes !== true
        ? "A edição de valores está desabilitada nas configurações."
        : null;
  const erroAjustes = ajustes.length > 0 && bloqueioAjustes
    ? bloqueioAjustes
    : ajustes.length > 0 && projecao.total <= 0
      ? "Os descontos devem deixar um saldo maior que zero para realizar a baixa."
      : rascunhoAjuste
        ? "Adicione o ajuste preenchido ou limpe o campo de valor antes de concluir."
        : null;
  // O juros lançado no título: é o palpite certo de quanto o banco repassa quando
  // ele reteve o principal.
  const acrescimosDoTitulo = Math.max(Number(transaction?.valor_acrescimos ?? 0) || 0, 0);
  const parcial = Math.round(valorBaixa * 100) < Math.round(saldo * 100);
  const jaTemBaixas = Number(transaction?.valor_baixado ?? 0) > 0;
  const restante = Math.round((saldo - valorBaixa) * 100) / 100;

  /*
   * Quanto de fato entra na conta, e quanto do título é quitado sem mover caixa.
   * São dois números diferentes só em título antecipado e no crédito do
   * cliente, onde a conta nunca se move; nos demais o segundo é sempre zero.
   */
  const entraNaConta = ehCreditoCliente
    ? 0
    : antecipado
      ? (lancarNoCaixa ? valorLancado : 0)
      : valorBaixa;
  const semCaixa = Math.round((valorBaixa - entraNaConta) * 100) / 100;
  const bancoEscolhido = banks.find((b) => String(b.id) === selectedBankId)?.titulo ?? "a conta escolhida";

  async function handleConfirmarPagamento() {
    if (!transaction || isSubmitting) return;
    if (erroAjustes) {
      toast.error(erroAjustes);
      return;
    }

    if (!selectedMetodo) {
      toast.error("Selecione o método de pagamento para concluir a transação.");
      return;
    }

    // Crédito do cliente não passa por conta nenhuma: pedir banco aqui seria
    // pedir um dado que o servidor descarta.
    if (!ehCreditoCliente && !selectedBankId) {
      toast.error("Selecione um banco para concluir a transação.");
      return;
    }

    if (ehCreditoCliente) {
      if (!credito?.clienteId) {
        toast.error("Este lançamento não tem cliente vinculado.", {
          description: "Informe o cliente nele antes de usar o crédito.",
        });
        return;
      }
      if (!credito.suficiente) {
        toast.error("O cliente não tem crédito suficiente.", {
          description: `Saldo de ${formatarEmReal(credito.saldo)} para um título de ${formatarEmReal(credito.valorTitulo)}.`,
        });
        return;
      }
    }

    if (!dataPagamento) {
      toast.error("Selecione a data efetiva do pagamento.");
      return;
    }

    if (valorBaixa <= 0) {
      toast.error("Informe quanto está sendo pago.");
      return;
    }

    if (Math.round(valorBaixa * 100) > Math.round(saldo * 100)) {
      toast.error("O valor da baixa passa do saldo em aberto do título.");
      return;
    }

    if (antecipado && lancarNoCaixa) {
      if (valorLancado <= 0) {
        toast.error("Informe quanto o banco repassou para a conta.");
        return;
      }
      if (Math.round(valorLancado * 100) > Math.round(saldo * 100)) {
        toast.error("O valor lançado na conta passa do valor do título.");
        return;
      }
    }

    try {
      setIsSubmitting(true);

      await axios.post(`/api/transaction/${transaction.id}/baixar`, {
        dataPagamento,
        // Sem banco no crédito do cliente: o servidor grava nulo de qualquer
        // forma, e mandar um número aqui daria a impressão de que a conta se
        // move.
        bancoId: ehCreditoCliente ? null : Number(selectedBankId),
        metodoPagamento: selectedMetodo,
        planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
        centroCustoId: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
        // Só título antecipado responde; nos demais o servidor recusa o campo.
        valorLancado: antecipado && lancarNoCaixa ? valorLancado : null,
        /*
         * Vai quando é menos que o saldo — e também quando o título JÁ TEM baixas
         * parciais, mesmo pagando o restante exato.
         *
         * Nesse segundo caso o título não pode voltar a carregar banco: o
         * dinheiro dele mora nas filhas. Omitir o valor mandava a baixa pelo
         * caminho "de uma vez", que grava o banco no título, e o servidor recusava
         * — deixando o usuário sem como terminar de receber.
         *
         * Sem filhas e pagando tudo, segue nulo: o título dá conta sozinho e não
         * há por que criar uma transação a mais.
         *
         * No crédito do cliente segue sempre nulo: ele quita o título inteiro,
         * e a RPC dele nem aceita valor parcial.
         */
        valor: !ehCreditoCliente && (parcial || jaTemBaixas) ? valorBaixa : null,
        ajustes: ajustes.map(({ tipoId, modo, valorInformado }) => ({ tipoId, modo, valorInformado })),
      });

      toast.success("Transação concluída com sucesso!");
      setIsAlertOpen(false);
      onSuccess?.();
    } catch (error) {
      const description = isAxiosError(error)
        ? (error.response?.data?.error ?? error.message)
        : error instanceof Error
          ? error.message
          : "Não foi possível concluir a transação.";

      toast.error("Erro ao concluir a transação", { description });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!transaction) return null;

  const bruto = Number(transaction.valor ?? 0) + projecao.acrescimos;
  const liquido = valorLiquidoEfetivo(transaction) + projecao.acrescimos - projecao.descontos;
  const acrescimos = Number(transaction.valor_acrescimos ?? 0) + projecao.acrescimos;
  const descontos = Number(transaction.valor_descontos ?? 0) + projecao.descontos;
  // Sem acréscimo nem desconto, bruto e líquido são o mesmo número: repetir os
  // dois seria ruído.
  const temComposicao =
    Math.round(bruto * 100) !== Math.round(liquido * 100) ||
    acrescimos > 0 ||
    descontos > 0;

  return (
    <Dialog
      open={isAlertOpen}
      onOpenChange={(open) => {
        if (!isSubmitting) setIsAlertOpen(open);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            Concluir transação
          </DialogTitle>
          <DialogDescription>
            Confirme os dados financeiros para dar baixa nesta transação.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border bg-card p-4" aria-label="Resumo da transação">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Transação #{transaction.id}
              </p>
              <p className="mt-1 break-words text-sm font-medium text-foreground">
                {transaction.descricao}
              </p>
            </div>
            {/*
              O que importa na baixa é quanto entra na conta, não quanto foi
              cobrado: é o líquido que bate com o extrato do banco. O bruto e a
              composição ficam abaixo, menores, para conferência.
            */}
            {/*
              "Entra na conta" é o rótulo certo quase sempre, e falso justamente
              na baixa de título antecipado sem lançamento: ali a conta não se
              move: o dinheiro entrou pela antecipação. O número continua sendo o
              líquido — é o que o título vale, e é o que a pessoa confere contra o
              boleto —, mas chamá-lo de entrada faria esperar um extrato que não
              vem. Isso fica mais visível com juros: o título sobe para R$ 1.050 e
              seria natural procurar esse valor no banco.
            */}
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold text-primary">
                {formatarEmReal(saldo)}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {ajustes.length > 0
                  ? "Saldo com ajustes"
                  : antecipado && !lancarNoCaixa
                  ? "Valor do título"
                  : saldo < liquido
                    ? "Saldo em aberto"
                    : transaction.tipo === "DESPESA" || transaction.tipo === "SAQUE" ? "Sai da conta" : "Entra na conta"}
              </p>
            </div>
          </div>

          {temComposicao ? (
            <div className="mt-3 space-y-1 border-t pt-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Valor cobrado</span>
                <span className="tabular-nums">{formatarEmReal(bruto)}</span>
              </div>
              {acrescimos > 0 ? (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Acréscimos{ajustes.length > 0 ? " (incluindo esta baixa)" : " inclusos"}</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                    + {formatarEmReal(acrescimos)}
                  </span>
                </div>
              ) : null}
              {descontos > 0 ? (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Descontos</span>
                  <span className="tabular-nums text-destructive">
                    − {formatarEmReal(descontos)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-medium text-foreground">Tipo:</span> {transaction.tipo}
            </p>
            <p className="sm:text-right">
              <span className="font-medium text-foreground">Data:</span> {formatDate(transaction.data)}
            </p>
            {(transaction.nomepagador || transaction.cpfcnpjpagador) ? (
              <p className="break-words sm:col-span-2">
                <span className="font-medium text-foreground">Pagador:</span>{" "}
                {transaction.nomepagador || "Não informado"}
                {transaction.cpfcnpjpagador ? ` · ${transaction.cpfcnpjpagador}` : ""}
              </p>
            ) : null}
          </div>
        </section>

        {isAlertOpen ? (
          <AjustesNaBaixa key={transaction.id} base={valorBase} linhas={ajustes} onChange={setAjustes}
            disabled={isSubmitting} bloqueio={bloqueioAjustes} onRascunhoChange={setRascunhoAjuste} />
        ) : null}
        {erroAjustes ? <p role="alert" className="text-sm text-destructive">{erroAjustes}</p> : null}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2 p-4 rounded-xl bg-card border">
          {/*
            Quanto está sendo pago agora.

            Vem preenchido com o saldo porque baixar tudo é o caso de quase
            sempre; trocar por menos registra um pagamento parcial, e o título
            continua em aberto pelo que falta.
          */}
          <div className="min-w-0 space-y-2 sm:col-span-2">
            <Label htmlFor="baixa-valor">
              Valor pago <span className="text-destructive">*</span>
            </Label>
            <ValueInput
              id="baixa-valor"
              value={valorBaixa}
              onValueChange={setValorBaixa}
              disabled={isSubmitting || ehCreditoCliente}
            />
            {ehCreditoCliente ? (
              <p className="text-xs text-muted-foreground">
                O crédito do cliente quita o título inteiro — não dá para usar
                só uma parte dele aqui.
              </p>
            ) : parcial ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Baixa parcial: restam {formatarEmReal(restante)} em aberto neste
                título depois desta.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Baixa o saldo inteiro e encerra o título. Informe menos para
                registrar um pagamento parcial.
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-2 sm:col-span-2">
            <Label>
              Data do pagamento <span className="text-destructive">*</span>
            </Label>
            <DatePicker
              value={dataPagamento}
              onChange={setDataPagamento}
              disabled={isSubmitting}
              placeholder="Selecione a data efetiva"
            />
            <p className="text-xs text-muted-foreground">
              Esta data será usada no fluxo de caixa. O vencimento original será preservado no histórico.
            </p>
          </div>

          {/*
            A pergunta que só o título antecipado responde.

            Antecipar o boleto trouxe o dinheiro adiantado, mas a cobrança seguiu
            até o vencimento. Se o boleto foi honrado, esta baixa é só a
            confirmação disso e a conta não se move de novo. Se o pagador não
            pagou, o banco debitou o valor de volta — e o pagamento que chega
            agora é dinheiro entrando pela primeira vez.

            O sistema não tem como saber em qual dos dois está: os dois terminam
            com o mesmo boleto pago. Quem acompanhou o extrato sabe.
          */}
          {antecipado ? (
            <div className="rounded-lg border bg-muted/30 p-3 sm:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="baixa-lancar" className="text-sm font-medium">
                    Lançar a entrada na conta
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {lancarNoCaixa ? (
                      <>
                        O banco mandou dinheiro para a conta por causa deste título —
                        seja porque <strong>devolveu o valor</strong> e o pagador quitou
                        depois, seja porque <strong>reteve o que havia adiantado e
                        repassou só o juros</strong> do atraso. Informe quanto entrou.
                      </>
                    ) : (
                      <>
                        O dinheiro já entrou pela antecipação
                        {transaction.adiantamento_id ? ` #${transaction.adiantamento_id}` : ""}.
                        Esta baixa apenas confirma que o boleto foi honrado, e{" "}
                        <strong>a conta não se move de novo</strong>.
                        {acrescimosDoTitulo > 0 ? (
                          <>
                            {" "}Este título tem{" "}
                            <strong>{formatarEmReal(acrescimosDoTitulo)} de acréscimo</strong>:
                            se o banco reteve o que adiantou e repassou só isso, ligue
                            aqui.
                          </>
                        ) : (
                          <> Ligue esta opção se o banco repassou algum valor.</>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <Switch
                  id="baixa-lancar"
                  checked={lancarNoCaixa}
                  onCheckedChange={setLancarNoCaixa}
                  disabled={isSubmitting}
                  className="mt-1 shrink-0"
                />
              </div>

              {/*
                Quanto o banco repassou. Vem no valor cheio — "devolveu tudo" é o
                caso mais simples de explicar —, e no caso do juros a pessoa troca
                R$ 1.050 por R$ 50.
              */}
              {lancarNoCaixa ? (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <Label htmlFor="baixa-repasse">
                    Valor que entrou na conta <span className="text-destructive">*</span>
                  </Label>
                  <ValueInput
                    id="baixa-repasse"
                    value={valorLancado}
                    onValueChange={setValorLancado}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    O resto do título é quitado sem mover a conta: aquele dinheiro
                    veio da antecipação.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/*
            No crédito do cliente o banco sai da tela, e não fica só avisando
            que "não será gravado" como no antecipado: ali a conta ainda pode se
            mover se a pessoa ligar o repasse; aqui nunca. Um campo obrigatório
            que não vale para nada só atrapalha.
          */}
          {ehCreditoCliente ? (
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label>Crédito do cliente</Label>
              <div className="rounded-lg border bg-muted/30 p-3">
                {carregandoCredito ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Consultando o saldo do cliente...
                  </p>
                ) : !credito?.clienteId ? (
                  <p className="text-sm text-destructive">
                    Este lançamento não tem cliente vinculado. Informe o cliente
                    nele antes de usar o crédito.
                  </p>
                ) : credito.sentido === "CREDITO" ? (
                  <>
                    <p className="text-sm text-foreground">
                      <strong>{credito.nome}</strong> tem hoje{" "}
                      <strong className="tabular-nums">{formatarEmReal(credito.saldo)}</strong> de
                      crédito.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Esta baixa <strong>acrescenta</strong> {formatarEmReal(credito.valorTitulo)}{" "}
                      à carteira dele, em vez de sair dinheiro da conta.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-foreground">
                      <strong>{credito.nome}</strong> tem{" "}
                      <strong className="tabular-nums">{formatarEmReal(credito.saldo)}</strong> de
                      crédito.
                    </p>
                    {credito.suficiente ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sobram {formatarEmReal(credito.saldo - credito.valorTitulo)} depois de
                        quitar este título.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-destructive">
                        Não cobre os {formatarEmReal(credito.valorTitulo)} deste título. Faltam{" "}
                        {formatarEmReal(credito.valorTitulo - credito.saldo)}.
                      </p>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Não passa por conta bancária: nada entra no fluxo de caixa nem no
                extrato.
              </p>
            </div>
          ) : (
          <div className="min-w-0 space-y-2">
            <Label>
              Banco / conta <span className="text-destructive">*</span>
            </Label>
            <SearchCombobox
              value={selectedBankId}
              onValueChange={setSelectedBankId}
              loading={isLoadingBanks}
              disabled={isSubmitting || !!bankLoadError}
              placeholder={bankLoadError ?? "Selecione o banco"}
              searchPlaceholder="Pesquisar banco ou conta..."
              emptyMessage="Nenhum banco encontrado."
              options={banks.map((bank) => ({
                value: String(bank.id),
                label: bank.titulo,
                description: [
                  bank.tipo,
                  bank.agencia && `Ag. ${bank.agencia}`,
                  bank.contanumero && `Conta ${bank.contanumero}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
                searchText: `${bank.proprietario ?? ""} ${bank.tipo ?? ""}`,
              }))}
            />
            {bankLoadError ? <p className="text-xs text-destructive">{bankLoadError}</p> : null}
            {/*
              Sem este aviso, a pessoa escolhe um banco e ele simplesmente some —
              o servidor grava nulo. Dizer que o campo não vale aqui é mais
              honesto do que escondê-lo: ele volta a valer se ela ligar a opção
              acima, e sumir e reaparecer seria pior.
            */}
            {antecipado && !lancarNoCaixa ? (
              <p className="text-xs text-muted-foreground">
                Não será gravado: o dinheiro deste título entrou pela antecipação.
              </p>
            ) : null}
          </div>
          )}

          <div className={ehCreditoCliente ? "min-w-0 space-y-2 sm:col-span-2" : "min-w-0 space-y-2"}>
            <Label htmlFor="metodo-concluido">
              Método de pagamento <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedMetodo}
              onValueChange={(value) => setSelectedMetodo(value as Metodo_pagamento)}
              disabled={isSubmitting}
            >
              <SelectTrigger id="metodo-concluido" className="w-full">
                <SelectValue placeholder="Selecione o método" />
              </SelectTrigger>
              <SelectContent>
                {metodosPagamento.map((metodo) => (
                  <SelectItem key={metodo.value} value={metodo.value}>
                    {metodo.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Plano de conta</Label>
            <PlanoContaCombobox
              value={selectedPlanoId}
              onValueChange={setSelectedPlanoId}
              disabled={isSubmitting || loadingPlanos}
              loading={loadingPlanos}
              groups={gruposPlanosDeConta}
              placeholder="Selecione o plano de conta"
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Centro de custo</Label>
            <SearchCombobox
              value={selectedCentroCustoId}
              onValueChange={setSelectedCentroCustoId}
              loading={loadingCentrosCusto}
              disabled={isSubmitting || loadingCentrosCusto || !!errorCentrosCusto}
              placeholder={errorCentrosCusto ? "Erro ao carregar" : "Selecione o centro de custo"}
              searchPlaceholder="Pesquisar centro de custo..."
              emptyMessage="Nenhum centro de custo encontrado."
              clearable
              clearLabel="Sem centro de custo"
              options={centrosCusto.map((centro) => ({
                value: String(centro.id),
                label: centro.nome,
                description: centro.descricao ?? undefined,
              }))}
            />
          </div>
        </div>

        {/*
          O que vai acontecer, em texto, antes de a pessoa clicar.

          Esta tela decide três coisas ao mesmo tempo — se o título fecha, quanto
          entra na conta e se sobra saldo — e as três dependem de campos que estão
          longe uns dos outros. Quem confere um extrato precisa saber o número que
          vai aparecer nele ANTES de gravar, não depois.
        */}
        <section
          className="rounded-xl border border-primary/30 bg-primary/5 p-4"
          aria-label="Resumo da operação"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ao confirmar
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex gap-2">
              <span aria-hidden className="text-primary">•</span>
              <span>
                {parcial ? (
                  <>
                    O título <strong>#{transaction.id}</strong> recebe um pagamento de{" "}
                    <strong>{formatarEmReal(valorBaixa)}</strong> e{" "}
                    <strong>continua em aberto</strong> com {formatarEmReal(restante)}.
                  </>
                ) : (
                  <>
                    O título <strong>#{transaction.id}</strong> será{" "}
                    <strong>quitado</strong> por {formatarEmReal(valorBaixa)}.
                  </>
                )}
              </span>
            </li>

            {semCaixa > 0 ? (
              <li className="flex gap-2">
                <span aria-hidden className="text-primary">•</span>
                <span>
                  <strong>{formatarEmReal(semCaixa)}</strong> não movimentam a conta:
                  esse dinheiro entrou pela antecipação
                  {transaction.adiantamento_id ? ` #${transaction.adiantamento_id}` : ""}.
                </span>
              </li>
            ) : null}

            <li className="flex gap-2">
              <span aria-hidden className="text-primary">•</span>
              <span>
                {entraNaConta > 0 ? (
                  <>
                    <strong>{formatarEmReal(entraNaConta)}</strong>{" "}
                    {transaction.tipo === "DESPESA" || transaction.tipo === "SAQUE"
                      ? "saem de"
                      : "entram em"}{" "}
                    <strong>{bancoEscolhido}</strong>
                    {antecipado || parcial
                      ? ", como uma transação própria ligada a este título."
                      : "."}
                  </>
                ) : ehCreditoCliente && credito?.clienteId ? (
                  <>
                    <strong>A conta não se move.</strong>{" "}
                    {credito.sentido === "CREDITO" ? (
                      <>
                        O crédito de <strong>{credito.nome}</strong> sobe para{" "}
                        <strong>{formatarEmReal(credito.saldo + credito.valorTitulo)}</strong>.
                      </>
                    ) : (
                      <>
                        O crédito de <strong>{credito.nome}</strong> cai para{" "}
                        <strong>{formatarEmReal(credito.saldo - credito.valorTitulo)}</strong>.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <strong>A conta não se move.</strong> Nada será lançado no extrato
                    por esta baixa.
                  </>
                )}
              </span>
            </li>

            {entraNaConta > 0 && (antecipado || parcial) ? (
              <li className="flex gap-2">
                <span aria-hidden className="text-primary">•</span>
                <span className="text-muted-foreground">
                  Essa transação aparece no Fluxo e pode ser desfeita sozinha, sem
                  mexer no título.
                </span>
              </li>
            ) : null}
          </ul>
        </section>

        <DialogFooter className="mt-1 flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setIsAlertOpen(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={handleConfirmarPagamento}
            disabled={
              isSubmitting ||
              !!erroAjustes ||
              !dataPagamento ||
              // O carregamento e o erro de bancos só travam quem precisa de banco.
              (!ehCreditoCliente && (isLoadingBanks || !!bankLoadError)) ||
              // Sem cliente resolvido ou sem saldo, confirmar só produziria a
              // recusa do servidor.
              (ehCreditoCliente &&
                (carregandoCredito || !credito?.clienteId || !credito.suficiente))
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Concluindo...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Concluir transação
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
