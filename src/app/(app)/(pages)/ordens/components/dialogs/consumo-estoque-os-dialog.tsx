"use client";

import { Loader2, PackageMinus, PackageSearch, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import {
  ESCOPOS_DE_ESTOQUE,
  rotuloDeEstoque,
  type EscopoDeEstoque,
} from "@/lib/usoconsumo/escopo";
import formatarEmReal from "@/utils/formatarEmReal";
import {
  ItemSelectDialog,
  type ItemDeEstoqueOption,
} from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";

/**
 * Consumo de estoque na OS: uma baixa e uma despesa, num passo so.
 *
 * O caso e o material que a oficina gasta na ordem sem repassar ao cliente — o
 * desengripante. Ele nao entra como produto vendido (nao gera receita) e nao
 * pode virar so um evento financeiro solto, porque o saldo precisa sair do
 * inventario com movimento e caminho de estorno.
 *
 * A escolha do item e do `ItemSelectDialog`, o mesmo seletor da emissao fiscal,
 * agora cobrindo os tres estoques. Alem de poupar uma busca propria aqui, faz o
 * operador procurar peca do mesmo jeito em todo o sistema — com grade, tabela,
 * paginacao, filtro de saldo e busca por etiqueta.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId: number;
  onSuccess: () => void;
};

/** Custo do cadastro: e ele que vira o valor da despesa. */
function custoDoItem(item: ItemDeEstoqueOption) {
  return Number(item.ultimovalordecompra ?? 0) || Number(item.precocompra ?? 0);
}

export function ConsumoEstoqueOsDialog({ open, onOpenChange, osId, onSuccess }: Props) {
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [item, setItem] = useState<ItemDeEstoqueOption | null>(null);

  const [quantidade, setQuantidade] = useState(1);
  const [custo, setCusto] = useState(0);
  const [custoLiberado, setCustoLiberado] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [aindaSeraPaga, setAindaSeraPaga] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Abrir zera tudo: o dialog e montado uma vez por OS e reaproveitado, e um
  // item deixado da vez anterior seria baixado sem o operador perceber.
  useEffect(() => {
    if (!open) return;
    setItem(null);
    setQuantidade(1);
    setCusto(0);
    setCustoLiberado(false);
    setDescricao("");
    setObservacao("");
    setAindaSeraPaga(false);
  }, [open]);

  function selecionar(escolhido: ItemDeEstoqueOption) {
    setItem(escolhido);
    setCusto(custoDoItem(escolhido));
    setCustoLiberado(false);
    setDescricao(`Consumo - ${escolhido.titulo}`);
  }

  const total = useMemo(
    () => Math.round(custo * Math.max(quantidade, 0) * 100) / 100,
    [custo, quantidade],
  );

  const saldo = Number(item?.estoque ?? 0);
  const unidade = item?.unidade || "UN";
  // Sem chute: as duas rotas do seletor sempre devolvem `escopo`, e adivinhar
  // um aqui daria baixa no estoque errado. Faltando, o registro nao habilita.
  const escopo: EscopoDeEstoque | null = item?.escopo ?? null;
  const saldoInsuficiente = Boolean(item) && quantidade > saldo;
  const semCusto = Boolean(item) && custo <= 0;

  const podeSalvar =
    Boolean(item) &&
    Boolean(escopo) &&
    quantidade > 0 &&
    !saldoInsuficiente &&
    descricao.trim().length > 0 &&
    !salvando;

  async function registrar() {
    if (!item || !escopo) return;
    setSalvando(true);
    try {
      const resposta = await fetch(`/api/ordens/${osId}/consumo-estoque`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escopo,
          itemId: item.id,
          quantidade,
          descricao: descricao.trim(),
          observacao: observacao.trim() || null,
          // So viaja quando o operador destravou o campo: sem isso o servidor
          // usa o custo do cadastro e a linha nunca e marcada como corrigida.
          ...(custoLiberado ? { valor: total } : {}),
          podeGerarTransacao: aindaSeraPaga,
        }),
      });
      const payload = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(payload?.error || "Não foi possível registrar o consumo.");

      toast.success(`Consumo registrado e ${quantidade} ${unidade} baixado do estoque.`);
      onOpenChange(false);
      onSuccess();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível registrar o consumo.");
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
            Material gasto nesta OS sem repasse ao cliente. Dá baixa no estoque e lança a despesa
            na ordem, de uma vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 rounded-xl bg-card">
          <div className="space-y-2">
            <ItemSelectDialog
              open={seletorAberto}
              setOpen={setSeletorAberto}
              onSelect={selecionar}
              escopo="USOCONSUMO"
              escopos={ESCOPOS_DE_ESTOQUE}
              permitirTrocaDeEscopo
              permitirCriacao={false}
            >
              <Button type="button" variant="outline" className="w-full justify-start">
                <PackageSearch />
                {item ? item.titulo : "Selecionar item de qualquer estoque"}
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs font-normal"
                        onClick={() => setCustoLiberado(true)}
                      >
                        <Pencil className="size-3" /> Corrigir
                      </Button>
                    )}
                  </div>
                  <ValueInput
                    className="mt-1"
                    value={custo}
                    onValueChange={setCusto}
                    disabled={!custoLiberado}
                  />
                </div>
              </div>

              {saldoInsuficiente ? (
                <p className="text-sm text-destructive">
                  Saldo insuficiente: disponível {saldo} {unidade}.
                </p>
              ) : null}
              {semCusto && !custoLiberado ? (
                <p className="text-sm text-muted-foreground">
                  Este item não tem custo no cadastro. Corrija o valor à mão ou a despesa entrará
                  zerada.
                </p>
              ) : null}

              <label className="block text-sm font-medium">
                Título da despesa
                <Input
                  className="mt-1"
                  value={descricao}
                  onChange={(evento) => setDescricao(evento.target.value)}
                />
              </label>

              <label className="block text-sm font-medium">
                Observação
                <Input
                  className="mt-1"
                  value={observacao}
                  onChange={(evento) => setObservacao(evento.target.value)}
                  placeholder="Opcional — fica na saída e no detalhe da despesa"
                />
              </label>

              <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Esta despesa ainda será paga</p>
                  <p className="text-xs text-muted-foreground">
                    Desligada, entra só como custo da OS — o item já foi pago quando entrou no
                    estoque. Ligada, aparece em &quot;Lançar no financeiro&quot;.
                  </p>
                </div>
                <Switch
                  checked={aindaSeraPaga}
                  onCheckedChange={setAindaSeraPaga}
                  aria-label="Esta despesa ainda será paga"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">Total da despesa</span>
                <span className="text-base font-semibold">{formatarEmReal(total)}</span>
              </div>

              <Button className="w-full" disabled={!podeSalvar} onClick={() => void registrar()}>
                {salvando ? (
                  <>
                    <Loader2 className="animate-spin" /> Registrando...
                  </>
                ) : (
                  <>
                    <PackageMinus /> Registrar consumo e dar baixa
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
