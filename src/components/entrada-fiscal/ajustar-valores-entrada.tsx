"use client";

import { useState } from "react";
import { History, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import { totalEntradaAjustado, totalItemEntrada, ajusteValoresEntradaSchema,
  type ValoresCompraEntrada } from "@/lib/estoque/entrada-valores";
import formatarEmReal from "@/utils/formatarEmReal";

type ItemAjustavel = {
  id?: number;
  titulo?: string | null;
  quantidade?: number;
  valor_unitario_compra?: number;
  valor_unitario_compra_original?: number | null;
  valor_desconto?: number;
  valor_frete?: number;
  outras_despesas?: number;
  valor_total?: number;
};

type Props = {
  entryId: number;
  inventory: "produto" | "usoconsumo";
  itens: ItemAjustavel[];
  total: number;
  versao: number;
  resumo?: ValoresCompraEntrada;
  podeAjustar: boolean;
  onSaved: () => void;
};

const formatoUnitario = new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4,
});

export function AjustarValoresEntrada({ entryId, inventory, itens, total, versao, resumo, podeAjustar, onSaved }: Props) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [desatualizado, setDesatualizado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [valores, setValores] = useState<Record<number, number>>({});
  const unitario = (item: ItemAjustavel) => valores[Number(item.id)] ?? Number(item.valor_unitario_compra ?? 0);
  const totalItem = (item: ItemAjustavel) => totalItemEntrada({
    ...item, quantidade: Number(item.quantidade), valor_unitario_compra: Number(item.valor_unitario_compra),
  }, unitario(item));
  const alterados = itens.filter((item) => item.id && unitario(item) !== Number(item.valor_unitario_compra));
  const novoTotal = totalEntradaAjustado(total, alterados.map((item) => totalItem(item) - Number(item.valor_total)));

  function iniciar() {
    setValores({});
    setMotivo("");
    setDesatualizado(false);
    setEditando(true);
  }

  async function salvar() {
    const payload = ajusteValoresEntradaSchema.safeParse({
      inventory, versaoEsperada: versao, motivo,
      itens: alterados.map((item) => ({ id: Number(item.id), valorUnitarioCompra: unitario(item) })),
    });
    if (!payload.success) return toast.error(payload.error.issues[0].message);
    if (novoTotal < 0 || alterados.some((item) => totalItem(item) < 0)) return toast.error("O total não pode ser negativo.");
    setSalvando(true);
    try {
      const response = await fetch(`/api/entradas/${entryId}/valores`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.data),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setDesatualizado(true);
        throw new Error(data.error ?? "Não foi possível ajustar os valores.");
      }
      toast.success("Valores de compra atualizados.");
      setEditando(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao ajustar os valores.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label="Ajustes dos valores de compra">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Valores de compra</h3>
        {podeAjustar && !editando ? <Button type="button" variant="outline" size="sm" onClick={iniciar}>
          <Pencil className="mr-2 size-4" /> Ajustar valores
        </Button> : null}
      </div>
      {resumo?.financeiroPreservado ? <p className="rounded-md bg-amber-500/10 p-3 text-sm">
        Os lançamentos financeiros existentes foram preservados. Total de compra: {formatarEmReal(resumo.totalCompra)}.
        {" "}Total financeiro lançado: {formatarEmReal(resumo.totalFinanceiro)}.
      </p> : null}
      {editando ? <div className="space-y-4">
        <p className="text-xs text-muted-foreground">Informe o valor unitário de compra. Quantidades, descontos, frete e despesas seguem os valores da entrada.</p>
        {itens.map((item) => <div key={item.id} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <div className="min-w-0"><p className="text-sm font-medium">{item.titulo || `Item #${item.id}`}</p>
            <p className="text-xs text-muted-foreground">Quantidade: {item.quantidade}. Total do item: {formatarEmReal(totalItem(item))}</p>
          </div>
          <div className="space-y-1"><Label htmlFor={`ajuste-unitario-${item.id}`}>Valor unitário de compra</Label>
            <ValueInput id={`ajuste-unitario-${item.id}`} decimals={4} mode="decimal" value={unitario(item)}
              disabled={salvando} onValueChange={(value) => setValores((current) => ({ ...current, [Number(item.id)]: value }))} />
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={salvando} onClick={() => setValores((current) => ({
            ...current, [Number(item.id)]: Number(item.valor_unitario_compra_original ?? item.valor_unitario_compra),
          }))}><RotateCcw className="mr-1 size-3" /> Restaurar valor original</Button>
        </div>)}
        <div className="space-y-1"><Label htmlFor="motivo-ajuste-entrada">Motivo do ajuste</Label>
          <Textarea id="motivo-ajuste-entrada" value={motivo} onChange={(event) => setMotivo(event.target.value)}
            maxLength={1000} disabled={salvando} placeholder="Descreva o motivo dos valores informados." />
        </div>
        <p className="text-sm font-semibold" aria-live="polite">Total desta entrada após ajuste: {formatarEmReal(novoTotal)}</p>
        <p className="text-xs text-muted-foreground">O custo atual do cadastro será atualizado somente se esta for a compra mais recente do produto. Transações existentes e custos já gravados em vendas e OS serão preservados.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={salvando} onClick={() => setEditando(false)}>Cancelar</Button>
          {desatualizado ? <Button type="button" variant="outline" onClick={onSaved}>Recarregar entrada</Button> : null}
          <Button type="button" disabled={salvando || desatualizado || !alterados.length || !motivo.trim()} onClick={salvar}>
            {salvando ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Salvar ajuste
          </Button>
        </div>
      </div> : null}
      {resumo?.historico.length ? <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Histórico de ajustes · até 100 mais recentes</p>
        {resumo.historico.map((ajuste) => <div key={ajuste.id} className="space-y-1 border-t pt-3 text-xs">
          <p className="font-medium">{new Date(ajuste.created_at).toLocaleString("pt-BR")} · {ajuste.autor_nome || "Usuário não identificado"}</p>
          <p>{ajuste.motivo}</p>
          <p>Total: {formatarEmReal(ajuste.valor_anterior)} → {formatarEmReal(ajuste.valor_novo)}</p>
          {ajuste.itens.map((item) => <p key={item.id} className="text-muted-foreground">
            {item.titulo || `Item #${item.id}`}: {formatoUnitario.format(item.unitario_anterior)} → {formatoUnitario.format(item.unitario_novo)} por unidade.
            {" "}{item.custo_cadastro_atualizado ? "Custo atual atualizado." : "Custo mais recente preservado."}
          </p>)}
        </div>)}
      </div> : !editando ? <p className="text-xs text-muted-foreground">Nenhum ajuste de valor registrado.</p> : null}
    </section>
  );
}
