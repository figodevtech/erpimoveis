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

type Props = {
  itens: ItemProdutoAvulso[];
  onAdicionar: (item: ItemProdutoAvulso) => void;
  onAtualizar: (index: number, patch: Partial<ItemProdutoAvulso>) => void;
  onRemover: (index: number) => void;
  onVincular: (item: ItemProdutoAvulso, produtoId: number) => Promise<void>;
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
    if (!item.id || vinculando) return;
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label>Produtos avulsos</Label>
          <Badge variant={itens.length ? "destructive" : "outline"}>{itens.length} pendente(s)</Badge>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <PackagePlus className="h-4 w-4" />
          Lançar produto avulso
        </Button>
      </div>

      {itens.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5">
          <div className="flex gap-2 border-b border-amber-500/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Estes itens podem ser salvos e impressos, mas precisam ser vinculados antes de avançar a OS.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-28 text-center">Quantidade</TableHead>
                <TableHead className="w-36 text-right">Valor unit.</TableHead>
                <TableHead className="w-32 text-right">Subtotal</TableHead>
                <TableHead className="w-72 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((item, index) => (
                <TableRow key={item.id ?? `novo-${index}`}>
                  <TableCell className="align-middle">
                    <div className="flex items-center gap-2">
                      <Input value={item.titulo} onChange={(event) => onAtualizar(index, { titulo: event.target.value })} />
                      {!item.id ? <Badge variant="outline" className="shrink-0">Não salvo</Badge> : null}
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
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onRemover(index)} title="Remover produto avulso">
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
    </div>
  );
}
