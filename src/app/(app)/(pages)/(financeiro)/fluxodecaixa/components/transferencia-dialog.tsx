"use client";

import { useEffect, useMemo, useState } from "react";

import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import axios, { isAxiosError } from "axios";
import { ArrowLeftRight, ArrowRight, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogClose,
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
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

import { useCentrosCusto } from "../hooks/use-centros-custo";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";
import type { Banco } from "../types";
import { Metodo_pagamento } from "../types";
import { PlanoContaCombobox } from "./plano-conta-combobox";
import { SearchCombobox } from "./search-combobox";

/**
 * Transferência entre contas próprias.
 *
 * O que se registra aqui não é uma receita nem uma despesa: é o mesmo dinheiro
 * mudando de lugar. Por isso o dialog fala de "sai de" e "entra em", e não de
 * pagar ou receber — e por isso o bloco de confirmação diz, antes de gravar,
 * exatamente o que vai acontecer nas duas contas e no resultado.
 *
 * O método de pagamento é escolhido por quem lança: a mesma transferência pode
 * ser um Pix entre contas ou dinheiro passando de um caixa para o outro.
 */
export function TransferenciaDialog({
  aberto,
  setAberto,
  onConcluido,
}: {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  onConcluido: () => void;
}) {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [carregandoBancos, setCarregandoBancos] = useState(false);
  const { options: metodosPagamento } = usePaymentMethodOptions();

  const [processando, setProcessando] = useState(false);
  const [origemId, setOrigemId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [valor, setValor] = useState(0);
  const [data, setData] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [descricao, setDescricao] = useState("");
  const [planoId, setPlanoId] = useState("");
  const [centroId, setCentroId] = useState("");

  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const origem = useMemo(
    () => bancos.find((banco) => String(banco.id) === origemId) ?? null,
    [bancos, origemId],
  );
  const destino = useMemo(
    () => bancos.find((banco) => String(banco.id) === destinoId) ?? null,
    [bancos, destinoId],
  );

  const mesmaConta = origemId !== "" && origemId === destinoId;
  const completo =
    origemId !== "" && destinoId !== "" && !mesmaConta && valor > 0 && data !== "" && metodo !== "";

  useEffect(() => {
    if (!aberto) return;

    setOrigemId("");
    setDestinoId("");
    setValor(0);
    setMetodo("");
    setDescricao("");
    setPlanoId("");
    setCentroId("");
    setData(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );

    let ativo = true;
    setCarregandoBancos(true);
    axios
      .get("/api/banks", { params: { limit: 100 } })
      .then((resposta) => {
        if (ativo) setBancos(resposta.data?.data ?? []);
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível carregar as contas.");
      })
      .finally(() => {
        if (ativo) setCarregandoBancos(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto]);

  async function confirmar() {
    if (!origemId) return toast.error("Selecione a conta de onde o dinheiro saiu.");
    if (!destinoId) return toast.error("Selecione a conta para onde o dinheiro foi.");
    if (mesmaConta) {
      return toast.error("A conta de origem e a de destino são a mesma.");
    }
    if (valor <= 0) return toast.error("Informe um valor maior que zero.");
    if (!data) return toast.error("Selecione a data.");
    if (!metodo) return toast.error("Selecione como o dinheiro foi movido.");

    setProcessando(true);
    try {
      await axios.post("/api/transaction/transferencia", {
        valor,
        data,
        bancoOrigemId: Number(origemId),
        bancoDestinoId: Number(destinoId),
        metodoPagamento: metodo,
        descricao: descricao.trim() || null,
        planoContaId: planoId ? Number(planoId) : null,
        centroCustoId: centroId ? Number(centroId) : null,
      });

      toast.success("Transferência registrada.", {
        description: `${formatarEmReal(valor)} de ${origem?.titulo ?? "origem"} para ${
          destino?.titulo ?? "destino"
        }.`,
      });
      setAberto(false);
      onConcluido();
    } catch (error) {
      const descricaoErro = isAxiosError(error)
        ? (error.response?.data?.error ?? error.message)
        : error instanceof Error
          ? error.message
          : "Não foi possível registrar a transferência.";
      toast.error("Erro na transferência", { description: descricaoErro });
    } finally {
      setProcessando(false);
    }
  }

  const opcoesDeConta = bancos.map((banco) => ({
    value: String(banco.id),
    label: banco.titulo,
    description: [banco.tipo, banco.agencia && `Ag. ${banco.agencia}`]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <Dialog
      open={aberto}
      onOpenChange={(valorAberto) => {
        if (!processando) setAberto(valorAberto);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 grid h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none motion-reduce:duration-0 sm:left-1/2 sm:top-1/2 sm:h-[min(48rem,calc(100dvh-2rem))] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:shadow-lg"
      >
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar"
            disabled={processando}
            className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 size-12 sm:right-4 sm:top-4 sm:size-9"
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>

        <DialogHeader className="shrink-0 border-b bg-background px-4 pb-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 sm:pb-4 sm:pr-14 sm:pt-6">
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
            Transferência entre contas
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Dinheiro que sai de uma conta sua e entra em outra. Não é receita nem
            despesa — só mudou de lugar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6">
          <div className="space-y-4">
            {/* As duas contas juntas e no topo: é o par que define a operação. */}
            <div className="rounded-xl border bg-card p-3 sm:p-4">
              <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="min-w-0 space-y-2 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
                  <Label>
                    Sai de <span className="text-destructive">*</span>
                  </Label>
                  <SearchCombobox
                    value={origemId}
                    onValueChange={setOrigemId}
                    loading={carregandoBancos}
                    disabled={processando}
                    placeholder="Conta de origem"
                    searchPlaceholder="Pesquisar conta..."
                    emptyMessage="Nenhuma conta encontrada."
                    options={opcoesDeConta}
                  />
                </div>

                <ArrowRight
                  className="mx-auto hidden h-5 w-5 shrink-0 text-muted-foreground sm:block sm:self-center"
                  aria-hidden="true"
                />

                <div className="min-w-0 space-y-2 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
                  <Label>
                    Entra em <span className="text-destructive">*</span>
                  </Label>
                  <SearchCombobox
                    value={destinoId}
                    onValueChange={setDestinoId}
                    loading={carregandoBancos}
                    disabled={processando}
                    placeholder="Conta de destino"
                    searchPlaceholder="Pesquisar conta..."
                    emptyMessage="Nenhuma conta encontrada."
                    options={opcoesDeConta}
                  />
                </div>
              </div>

              {mesmaConta && (
                <p className="mt-3 text-xs leading-relaxed text-destructive">
                  As duas são a mesma conta. Não há transferência a registrar.
                </p>
              )}
            </div>

            <div className="grid min-w-0 gap-4 rounded-xl bg-card p-3 sm:grid-cols-2 sm:p-4">
              <div className="space-y-2">
                <Label htmlFor="transf-valor">
                  Valor <span className="text-destructive">*</span>
                </Label>
                <ValueInput
                  id="transf-valor"
                  value={valor}
                  onValueChange={setValor}
                  disabled={processando}
                  className="min-h-12 sm:min-h-9"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Data <span className="text-destructive">*</span>
                </Label>
                <DatePicker
                  value={data}
                  onChange={setData}
                  disabled={processando}
                  placeholder="Selecione a data"
                  className="min-h-12 sm:min-h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transf-metodo">
                  Como o dinheiro foi movido <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={metodo}
                  onValueChange={(escolhido) => setMetodo(escolhido as Metodo_pagamento)}
                  disabled={processando}
                >
                  <SelectTrigger id="transf-metodo" className="min-h-12 w-full sm:min-h-9">
                    <SelectValue placeholder="Selecione o método" />
                  </SelectTrigger>
                  <SelectContent>
                    {metodosPagamento.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pix entre contas, TED, ou dinheiro passando de um caixa para o outro.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transf-descricao">Descrição</Label>
                <Input
                  id="transf-descricao"
                  value={descricao}
                  onChange={(evento) => setDescricao(evento.target.value)}
                  disabled={processando}
                  placeholder="Opcional"
                  className="min-h-12 sm:min-h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Em branco, cada perna se descreve pela conta do outro lado.
                </p>
              </div>

              <div className="min-w-0 space-y-2 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
                <Label>Plano de conta</Label>
                <PlanoContaCombobox
                  value={planoId}
                  onValueChange={setPlanoId}
                  disabled={processando || loadingPlanos}
                  loading={loadingPlanos}
                  groups={gruposPlanosDeConta}
                  placeholder="Selecione o plano de conta"
                />
              </div>

              <div className="min-w-0 space-y-2 [&_[role=combobox]]:min-h-12 sm:[&_[role=combobox]]:min-h-9">
                <Label>Centro de custo</Label>
                <SearchCombobox
                  value={centroId}
                  onValueChange={setCentroId}
                  loading={loadingCentrosCusto}
                  disabled={processando || loadingCentrosCusto}
                  placeholder="Selecione o centro de custo"
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
              O que vai acontecer, por extenso, antes de acontecer.

              Uma transferência gera duas linhas onde a pessoa lançou uma coisa
              só, e as duas ficam presas uma à outra. Nada disso é adivinhável
              olhando o formulário, e é tudo o que ela precisa saber para decidir
              se aperta o botão.
            */}
            <div className="rounded-xl border bg-card p-4">
              <p className="mb-2 text-sm font-medium">Ao confirmar</p>
              <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                <li>
                  Sai{" "}
                  <strong className="tabular-nums text-destructive">
                    {formatarEmReal(valor)}
                  </strong>{" "}
                  de <strong>{origem?.titulo ?? "conta de origem"}</strong> — uma despesa
                  já liquidada.
                </li>
                <li>
                  Entra{" "}
                  <strong className="tabular-nums text-emerald-600">
                    {formatarEmReal(valor)}
                  </strong>{" "}
                  em <strong>{destino?.titulo ?? "conta de destino"}</strong> — uma receita
                  já liquidada.
                </li>
                <li>
                  O <strong>saldo total da empresa não muda</strong>: uma conta cai e a
                  outra sobe no mesmo valor.
                </li>
                <li>
                  Nenhuma das duas entra no <strong>DRE</strong> — transferência não é
                  lucro nem prejuízo.
                </li>
                <li>
                  As duas linhas ficam ligadas:{" "}
                  <strong>excluir uma exclui a outra</strong>, e o valor não pode ser
                  editado de um lado só. Para corrigir, exclua e refaça.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:px-6 sm:py-4">
          <Button
            variant="outline"
            className="min-h-12 w-full sm:min-h-9 sm:w-auto"
            onClick={() => setAberto(false)}
            disabled={processando}
          >
            Cancelar
          </Button>
          <Button
            className="min-h-12 w-full bg-sky-600 text-white hover:bg-sky-700 sm:min-h-9 sm:w-auto"
            onClick={confirmar}
            disabled={processando || !completo}
          >
            {processando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Registrando...
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
                Confirmar transferência
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
