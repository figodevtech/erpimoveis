"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageMinus, PackageSearch, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { ESCOPOS_DE_ESTOQUE, rotuloDeEstoque, type EscopoDeEstoque } from "@/lib/usoconsumo/escopo";
import {
  ItemSelectDialog,
  type ItemDeEstoqueOption,
} from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { requestJson } from "./shared";
import { money } from "./model";

/**
 * Consumo de estoque na reserva, como o da OS na oficina: material que a administradora tem em
 * estoque e gasta na reserva (sabonete, toalha). Dá baixa no estoque e lança o custo pelo preço
 * de custo, de uma vez. É custo da imobiliária na DRE e reduz o resultado da reserva; não vai ao
 * caixa, porque o item já foi pago quando entrou no estoque.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservaId: number;
  /** Competência sugerida: a entrada do hóspede, como nos outros custos da reserva. */
  competenciaPadrao: string;
  /** Estoques em que o perfil pode dar baixa. */
  escopos: readonly EscopoDeEstoque[];
  onSuccess: () => void;
};

/** Custo do cadastro: é ele que vira o valor do custo. */
function custoDoItem(item: ItemDeEstoqueOption) {
  return Number(item.ultimovalordecompra ?? 0) || Number(item.precocompra ?? 0);
}

export function ConsumoEstoqueReservaDialog({ open, onOpenChange, reservaId, competenciaPadrao, escopos, onSuccess }: Props) {
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [item, setItem] = useState<ItemDeEstoqueOption | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [custo, setCusto] = useState(0);
  const [custoLiberado, setCustoLiberado] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [data, setData] = useState(competenciaPadrao);
  const [salvando, setSalvando] = useState(false);

  // Abrir zera tudo: um item deixado da vez anterior seria baixado sem o operador perceber.
  useEffect(() => {
    if (!open) return;
    setItem(null);
    setQuantidade(1);
    setCusto(0);
    setCustoLiberado(false);
    setDescricao("");
    setObservacao("");
    setData(competenciaPadrao);
  }, [open, competenciaPadrao]);

  function selecionar(escolhido: ItemDeEstoqueOption) {
    setItem(escolhido);
    setCusto(custoDoItem(escolhido));
    setCustoLiberado(false);
    setDescricao(`Consumo - ${escolhido.titulo}`);
  }

  const total = useMemo(() => Math.round(custo * Math.max(quantidade, 0) * 100) / 100, [custo, quantidade]);
  const saldo = Number(item?.estoque ?? 0);
  const unidade = item?.unidade || "UN";
  // Sem chute: o seletor sempre devolve o escopo, e adivinhar daria baixa no estoque errado.
  const escopo: EscopoDeEstoque | null = item?.escopo ?? null;
  const saldoInsuficiente = Boolean(item) && quantidade > saldo;
  const semCusto = Boolean(item) && custo <= 0;
  const podeSalvar = Boolean(item) && Boolean(escopo) && quantidade > 0 && !saldoInsuficiente && descricao.trim().length > 0 && !salvando;

  async function registrar() {
    if (!item || !escopo) return;
    setSalvando(true);
    try {
      const resposta = await requestJson(`/api/reservas/${reservaId}/consumo-estoque`, {
        method: "POST",
        body: JSON.stringify({
          escopo,
          itemId: item.id,
          quantidade,
          descricao: descricao.trim(),
          observacao: observacao.trim() || null,
          data: data || null,
          // Só viaja quando o operador destravou o campo: sem isso vale o custo do cadastro.
          ...(custoLiberado ? { valor: total } : {}),
        }),
      });
      toast.success(`Consumo registrado e ${quantidade} ${unidade} baixado do estoque.`, {
        description: resposta?.aviso ?? undefined,
      });
      onOpenChange(false);
      onSuccess();
    } catch (erro) {
      toast.error("Não foi possível registrar o consumo", { description: (erro as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(proximo) => !salvando && onOpenChange(proximo)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Consumo de estoque</DialogTitle>
          <DialogDescription>
            Material da administradora gasto nesta reserva (sabonetes, toalhas). Dá baixa no estoque e lança o custo pelo
            preço de custo, que reduz o resultado da reserva.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <ItemSelectDialog
              open={seletorAberto}
              setOpen={setSeletorAberto}
              onSelect={selecionar}
              escopo={escopos.includes("USOCONSUMO") ? "USOCONSUMO" : escopos[0]}
              escopos={escopos.length ? escopos : ESCOPOS_DE_ESTOQUE}
              permitirTrocaDeEscopo
              permitirCriacao={false}
            >
              <Button type="button" variant="outline" className="w-full justify-start gap-2">
                <PackageSearch className="size-4" />
                {item ? item.titulo : "Selecionar item do estoque"}
              </Button>
            </ItemSelectDialog>

            {item ? (
              <div className="flex flex-wrap items-center gap-2 px-0.5 text-xs text-muted-foreground">
                {escopo ? (
                  <Badge variant="outline" className="font-normal">
                    {rotuloDeEstoque(escopo).curto}
                  </Badge>
                ) : null}
                <span>
                  Saldo: {saldo} {unidade}
                </span>
                {item.referencia ? <span>Ref: {item.referencia}</span> : null}
              </div>
            ) : null}
          </div>

          {item ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Quantidade
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    className="mt-1"
                    value={quantidade}
                    onChange={(evento) => setQuantidade(Math.max(1, Number(evento.target.value) || 1))}
                  />
                </label>
                <div className="text-sm font-medium">
                  <div className="flex items-center justify-between">
                    <span>Custo unitário</span>
                    {custoLiberado ? (
                      <Badge variant="outline" className="font-normal">
                        Corrigido à mão
                      </Badge>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs font-normal" onClick={() => setCustoLiberado(true)}>
                        <Pencil className="size-3" /> Corrigir
                      </Button>
                    )}
                  </div>
                  <ValueInput className="mt-1" value={custo} onValueChange={setCusto} disabled={!custoLiberado} />
                </div>
              </div>

              {saldoInsuficiente ? (
                <p className="text-sm text-destructive">
                  Saldo insuficiente: disponível {saldo} {unidade}.
                </p>
              ) : null}
              {semCusto && !custoLiberado ? (
                <p className="text-sm text-muted-foreground">
                  Este item não tem custo no cadastro. Corrija o valor à mão ou o custo entrará zerado.
                </p>
              ) : null}

              <label className="block text-sm font-medium">
                Título do custo
                <Input className="mt-1" maxLength={200} value={descricao} onChange={(evento) => setDescricao(evento.target.value)} />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Observação
                  <Input
                    className="mt-1"
                    maxLength={500}
                    value={observacao}
                    onChange={(evento) => setObservacao(evento.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <label className="block text-sm font-medium">
                  Competência
                  <Input type="date" className="mt-1" value={data} onChange={(evento) => setData(evento.target.value)} />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">Total do custo</span>
                <span className="text-base font-semibold tabular-nums">{money(total)}</span>
              </div>

              <Button className="w-full gap-2" disabled={!podeSalvar} onClick={() => void registrar()}>
                {salvando ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Registrando...
                  </>
                ) : (
                  <>
                    <PackageMinus className="size-4" /> Registrar consumo e dar baixa
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
