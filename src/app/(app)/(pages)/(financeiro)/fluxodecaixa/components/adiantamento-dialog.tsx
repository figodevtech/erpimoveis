"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { Banknote, Loader2 } from "lucide-react";

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
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

import { useCentrosCusto } from "../hooks/use-centros-custo";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";
import type { Banco, Transaction } from "../types";
import { Metodo_pagamento } from "../types";
import { PlanoContaCombobox } from "./plano-conta-combobox";
import { SearchCombobox } from "./search-combobox";

/**
 * Revisão do adiantamento antes de gravar.
 *
 * A antecipação cria um lançamento novo, e um lançamento novo precisa de banco,
 * plano de conta e afins — daí a revisão. O bruto não é editável: ele é a soma
 * dos líquidos dos títulos selecionados, que é o que a antecipadora reconheceu.
 * O que se informa é a taxa dela, e o líquido aparece na hora.
 */
export function AdiantamentoDialog({
  aberto,
  setAberto,
  transacoes,
  processando,
  setProcessando,
  onConcluido,
}: {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  transacoes: Transaction[];
  processando: boolean;
  setProcessando: (valor: boolean) => void;
  onConcluido: () => void;
}) {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [carregandoBancos, setCarregandoBancos] = useState(false);
  const [bancoId, setBancoId] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [taxa, setTaxa] = useState(0);
  const [descricao, setDescricao] = useState("");
  const [planoId, setPlanoId] = useState("");
  const [centroId, setCentroId] = useState("");

  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const ehReceita = transacoes.some((t) => String(t.tipo).toUpperCase() === "RECEITA");
  const bruto =
    transacoes.reduce((total, t) => total + Math.round(valorLiquidoEfetivo(t) * 100), 0) / 100;
  const liquido = Math.round((bruto - taxa) * 100) / 100;

  useEffect(() => {
    if (!aberto) return;

    setDataPagamento(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    setDescricao(
      ehReceita
        ? `Antecipação de ${transacoes.length} título(s)`
        : `Pagamento antecipado de ${transacoes.length} título(s)`,
    );

    let ativo = true;
    setCarregandoBancos(true);
    axios
      .get("/api/banks")
      .then((r) => {
        if (ativo) setBancos(r.data?.data ?? []);
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível carregar os bancos.");
      })
      .finally(() => {
        if (ativo) setCarregandoBancos(false);
      });

    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function confirmar() {
    if (!bancoId) return toast.error("Selecione o banco que recebeu ou pagou.");
    if (!metodo) return toast.error("Selecione o método de pagamento.");
    if (!dataPagamento) return toast.error("Selecione a data.");
    if (taxa < 0) return toast.error("A taxa não pode ser negativa.");
    if (taxa >= bruto) return toast.error("A taxa não pode alcançar o valor antecipado.");

    setProcessando(true);
    try {
      await axios.post("/api/transaction/adiantamento", {
        ids: transacoes.map((t) => t.id),
        dataPagamento,
        bancoId: Number(bancoId),
        metodoPagamento: metodo,
        taxa,
        descricao: descricao.trim() || null,
        planoContaId: planoId ? Number(planoId) : null,
        centroCustoId: centroId ? Number(centroId) : null,
      });

      toast.success("Adiantamento registrado.", {
        description: `${transacoes.length} título(s) liquidados · ${formatarEmReal(liquido)} na conta.`,
      });
      setAberto(false);
      onConcluido();
    } catch (error) {
      const descricaoErro = isAxiosError(error)
        ? (error.response?.data?.error ?? error.message)
        : error instanceof Error
          ? error.message
          : "Não foi possível registrar o adiantamento.";
      toast.error("Erro no adiantamento", { description: descricaoErro });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(valor) => {
        if (!processando) setAberto(valor);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 shrink-0 text-emerald-600" />
            {ehReceita ? "Antecipar recebimento" : "Pagamento antecipado"}
          </DialogTitle>
          <DialogDescription>
            {transacoes.length} título(s) serão liquidados por um lançamento único.
            Confira os dados dele antes de gravar.
          </DialogDescription>
        </DialogHeader>

        {/* A conta que o usuário precisa conferir, no topo e por extenso. */}
        <div className="rounded-xl border bg-card p-4">
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Soma dos títulos</span>
              <span className="tabular-nums">{formatarEmReal(bruto)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Taxa de antecipação</span>
              <span className="tabular-nums text-destructive">
                {taxa > 0 ? `− ${formatarEmReal(taxa)}` : formatarEmReal(0)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t pt-1 text-base font-semibold">
              <span>{ehReceita ? "Entra na conta" : "Sai da conta"}</span>
              <span className="tabular-nums text-primary">{formatarEmReal(liquido)}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="adi-descricao">Descrição</Label>
            <Input
              id="adi-descricao"
              value={descricao}
              onChange={(evento) => setDescricao(evento.target.value)}
              disabled={processando}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Data <span className="text-destructive">*</span>
            </Label>
            <DatePicker
              value={dataPagamento}
              onChange={setDataPagamento}
              disabled={processando}
              placeholder="Selecione a data"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adi-taxa">Taxa de antecipação</Label>
            <ValueInput
              id="adi-taxa"
              value={taxa}
              onValueChange={setTaxa}
              disabled={processando}
            />
            <p className="text-xs text-muted-foreground">
              Em reais. Vira um desconto no lançamento, com tipo próprio.
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              Banco / conta <span className="text-destructive">*</span>
            </Label>
            <SearchCombobox
              value={bancoId}
              onValueChange={setBancoId}
              loading={carregandoBancos}
              disabled={processando}
              placeholder="Selecione o banco"
              searchPlaceholder="Pesquisar banco..."
              emptyMessage="Nenhum banco encontrado."
              options={bancos.map((banco) => ({
                value: String(banco.id),
                label: banco.titulo,
                description: [banco.tipo, banco.agencia && `Ag. ${banco.agencia}`]
                  .filter(Boolean)
                  .join(" · "),
              }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adi-metodo">
              Método <span className="text-destructive">*</span>
            </Label>
            <Select
              value={metodo}
              onValueChange={(valor) => setMetodo(valor as Metodo_pagamento)}
              disabled={processando}
            >
              <SelectTrigger id="adi-metodo" className="w-full">
                <SelectValue placeholder="Selecione o método" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(Metodo_pagamento).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
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

        <p className="text-xs text-muted-foreground">
          Os títulos serão quitados sem banco: o dinheiro entra por este
          lançamento, e contá-lo neles também dobraria o saldo.
        </p>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setAberto(false)}
            disabled={processando}
          >
            Cancelar
          </Button>
          <Button
            className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
            onClick={confirmar}
            disabled={processando || !dataPagamento || taxa >= bruto}
          >
            {processando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Registrando...
              </>
            ) : (
              <>
                <Banknote className="h-4 w-4" aria-hidden />
                Confirmar adiantamento
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
