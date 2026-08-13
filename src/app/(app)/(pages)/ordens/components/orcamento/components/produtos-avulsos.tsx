"use client";

import { useState } from "react";
import { AlertTriangle, Link2, PackagePlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ProductSelect from "@/app/(app)/components/productSelect";
import { DialogProduto } from "../../../../estoque/components/dialog-produto/dialog-produto";
import { Estoque_status, type Produto, Unidade_medida } from "../../../../estoque/types";
import type { ItemProdutoAvulso } from "../tipos";
import { CampoPreco } from "./campo-preco";
import { CampoQuantidade } from "./campo-quantidade";
import { IdentificadoresItem } from "./identificadores-item";

type Props = {
  itens: ItemProdutoAvulso[];
  onAdicionar: (item: ItemProdutoAvulso) => void;
  onAtualizar: (index: number, patch: Partial<ItemProdutoAvulso>) => void;
  onRemover: (index: number) => void;
  /**
   * Converte o avulso em produto de verdade. Só existe dentro de uma OS —
   * no orçamento avulso não há OS para receber o item nem estoque a consumir,
   * então a coluna de ações some quando esta prop não vem.
   */
  onVincular?: (item: ItemProdutoAvulso, produtoId: number) => Promise<void>;
};

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ProdutosAvulsos({ itens, onAdicionar, onAtualizar, onRemover, onVincular }: Props) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState(0);
  const [quantidade, setQuantidade] = useState(1);
  const [selectItem, setSelectItem] = useState<ItemProdutoAvulso | null>(null);
  const [cadastroItem, setCadastroItem] = useState<ItemProdutoAvulso | null>(null);
  const [vinculando, setVinculando] = useState(false);

  function adicionar() {
    const nome = titulo.trim();
    if (!nome || valor <= 0 || quantidade < 1) return;
    onAdicionar({
      titulo: nome,
      quantidade,
      precounitario: valor,
      subtotal: Number((quantidade * valor).toFixed(2)),
      descontoTipo: null,
      desconto: 0,
    });
    setTitulo("");
    setValor(0);
    setQuantidade(1);
    setOpen(false);
  }

  async function vincular(item: ItemProdutoAvulso, produtoId: number) {
    if (!item.id || vinculando || !onVincular) return;
    setVinculando(true);
    try {
      await onVincular(item, produtoId);
      setSelectItem(null);
      setCadastroItem(null);
    } catch {
      // A mensagem específica é exibida pelo formulário do orçamento.
    } finally {
      setVinculando(false);
    }
  }

  const novoProduto: Produto | undefined = cadastroItem
    ? {
        id: 0,
        titulo: cadastroItem.titulo,
        precovenda: cadastroItem.precounitario,
        estoque: 0,
        estoqueminimo: 0,
        exibirPdv: true,
        status_estoque: Estoque_status.OK,
        unidade: Unidade_medida.UN,
        fornecedor: "DESCONHECIDO",
        grupo_produto_id: 1,
      }
    : undefined;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <PackagePlus className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm font-semibold">Produtos avulsos</Label>
              <Badge variant={itens.length ? "destructive" : "secondary"} className="font-normal tabular-nums">
                {itens.length} {itens.length === 1 ? "pendente" : "pendentes"}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Itens ainda não vinculados ao estoque
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
          onClick={() => setOpen(true)}
        >
          <PackagePlus className="h-4 w-4" />
          Lançar produto avulso
        </Button>
      </div>

      {itens.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-amber-500/40 bg-amber-500/5 shadow-xs">
          <div className="flex min-w-[900px] gap-2 border-b border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Estes itens podem ser salvos e impressos, mas precisam ser vinculados antes de avançar a OS.
          </div>
          <Table className="min-w-[900px]">
            <TableHeader className="bg-amber-500/5">
              <TableRow>
                <TableHead className="min-w-[280px]">Produto avulso</TableHead>
                <TableHead className="w-28 text-center">Quantidade</TableHead>
                <TableHead className="w-36 text-right">Valor unit.</TableHead>
                <TableHead className="w-32 text-right">Subtotal</TableHead>
                <TableHead className="w-72 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((item, index) => (
                <TableRow
                  key={item.id ?? `novo-${index}`}
                  className="transition-colors hover:bg-amber-500/5"
                >
                  <TableCell className="py-3 align-top">
                    <div className="space-y-2">
                      <Input
                        value={item.titulo}
                        onChange={(event) => onAtualizar(index, { titulo: event.target.value })}
                        className="bg-background/80 font-medium"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.id ? (
                          <IdentificadoresItem id={item.id} />
                        ) : (
                          <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-medium">
                            Ainda sem ID
                          </Badge>
                        )}
                        <Badge className="h-5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-300">
                          Avulso
                        </Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CampoQuantidade value={item.quantidade} min={1} onChange={(value) => onAtualizar(index, { quantidade: value })} />
                  </TableCell>
                  <TableCell>
                    <CampoPreco value={item.precounitario} onChange={(value) => onAtualizar(index, { precounitario: value })} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(item.subtotal)}</TableCell>
                  <TableCell className="align-middle">
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      {onVincular ? (
                        <>
                          <ProductSelect
                            open={selectItem === item}
                            setOpen={(next) => setSelectItem(next ? item : null)}
                            OnSelect={(produto: any) => vincular(item, Number(produto.id))}
                          >
                            <Button type="button" size="sm" variant="outline" className="h-8 w-24 shrink-0" disabled={!item.id || vinculando} title={!item.id ? "Salve o orçamento primeiro" : undefined}>
                              <Link2 className="h-4 w-4" /> Vincular
                            </Button>
                          </ProductSelect>
                          <Button type="button" size="sm" variant="outline" className="h-8 w-24 shrink-0" disabled={!item.id || vinculando} title={!item.id ? "Salve o orçamento primeiro" : undefined} onClick={() => setCadastroItem(item)}>
                            <PackagePlus className="h-4 w-4" /> Cadastrar
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemover(index)}
                        title="Remover produto avulso"
                        aria-label={`Remover ${item.titulo}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Lançar produto avulso</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Título</Label><Input value={titulo} onChange={(event) => setTitulo(event.target.value)} autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Quantidade</Label><CampoQuantidade value={quantidade} min={1} onChange={setQuantidade} /></div>
              <div className="space-y-2"><Label>Valor unitário</Label><CampoPreco value={valor} onChange={setValor} /></div>
            </div>
          </div>
          <DialogFooter><Button type="button" onClick={adicionar} disabled={!titulo.trim() || valor <= 0 || quantidade < 1}>Adicionar ao orçamento</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogProduto
        key={cadastroItem?.id ?? "produto-avulso-fechado"}
        isOpen={Boolean(cadastroItem)}
        setIsOpen={(next: boolean) => { if (!next) setCadastroItem(null); }}
        newProductData={novoProduto}
        setSelectedProductId={(produtoId: number | undefined) => {
          if (produtoId && cadastroItem) void vincular(cadastroItem, produtoId);
        }}
      />
    </section>
  );
}
