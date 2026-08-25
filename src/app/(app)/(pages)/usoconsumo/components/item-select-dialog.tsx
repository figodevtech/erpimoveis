"use client";

import axios, { isAxiosError } from "axios";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";

export type UsoConsumoItemOption = {
  id: number;
  titulo: string;
  descricao?: string | null;
  referencia?: string | null;
  fabricante?: string | null;
  codigobarras?: string | null;
  unidade?: string;
  estoque?: number;
  precocompra?: number;
  ultimovalordecompra?: number | null;
  /**
   * Bloco fiscal do cadastro. Opcional porque nem todo consumidor do dialog
   * precisa dele; a NF-e avulsa usa para montar o item da nota sem redigitação.
   * Note que `cfop_entrada` não vem: é CFOP de entrada e não serve para saída.
   */
  ncm?: string | null;
  cest?: string | null;
  origem_mercadoria?: string | null;
  csosn?: string | null;
  cst?: string | null;
  aliquotaicms?: number | null;
  cst_pis?: string | null;
  aliquota_pis?: number | null;
  modo_pis?: string | null;
  aliquota_por_unidade_pis?: number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: number | null;
  modo_cofins?: string | null;
  aliquota_por_unidade_cofins?: number | null;
  cst_ibscbs?: string | null;
  cclass_trib?: string | null;
  aliquota_ibs_uf?: number | null;
  aliquota_ibs_municipio?: number | null;
  aliquota_cbs?: number | null;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelect: (item: UsoConsumoItemOption) => void;
  children: ReactNode;
};

export function ItemSelectDialog({ open, setOpen, onSelect, children }: Props) {
  const [items, setItems] = useState<UsoConsumoItemOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const id = ++request.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await axios.get("/api/usoconsumo/itens/select", { params: { search: search.trim() || undefined } });
        if (id === request.current) setItems(data.data ?? []);
      } catch (error) {
        if (id === request.current) toast.error("Não foi possível buscar os itens.", { description: isAxiosError(error) ? error.response?.data?.error ?? error.message : undefined });
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, search ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[min(80dvh,620px)] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4"><DialogTitle>Selecione um item de uso/consumo</DialogTitle><DialogDescription>Pesquise por título, referência, fabricante ou código.</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="relative mb-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar item..." /></div>
          {loading ? <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando itens...</div> : (
            <Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Item</TableHead><TableHead>Fabricante</TableHead><TableHead className="text-right">Estoque</TableHead></TableRow></TableHeader><TableBody>
              {items.map((item) => <TableRow key={item.id} className="cursor-pointer hover:bg-muted/60" onClick={() => { onSelect(item); setOpen(false); }}><TableCell>#{item.id}</TableCell><TableCell><p className="font-medium">{item.titulo}</p><p className="text-xs text-muted-foreground">{item.referencia || item.codigobarras || "Sem referência"}</p></TableCell><TableCell>{item.fabricante || "—"}</TableCell><TableCell className="text-right">{item.estoque ?? 0} {item.unidade}</TableCell></TableRow>)}
              {!items.length ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">Nenhum item encontrado.</TableCell></TableRow> : null}
            </TableBody></Table>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
