"use client";

import axios, { isAxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Option={id:number;titulo?:string;referencia?:string;nomerazaosocial?:string;cpfcnpj?:string;nome?:string;precocompra?:number;ultimovalordecompra?:number};
type Line={item_id:number;quantidade:number;valor_unitario_compra:number};
type Props={open:boolean;onOpenChange:(open:boolean)=>void;fornecedores:Option[];onSaved:()=>Promise<void>};
function errorText(error:unknown){return isAxiosError(error)?error.response?.data?.error??error.message:"Erro inesperado.";}

export function ManualEntryDialog({open,onOpenChange,fornecedores,onSaved}:Props){
  const [items,setItems]=useState<Option[]>([]);const [supplier,setSupplier]=useState("none");
  const [lines,setLines]=useState<Line[]>([{item_id:0,quantidade:1,valor_unitario_compra:0}]);
  const [loading,setLoading]=useState(false);const [finance,setFinance]=useState(false);const [due,setDue]=useState(new Date().toISOString().slice(0,10));
  useEffect(()=>{if(open){axios.get("/api/usoconsumo/itens/select").then(({data})=>setItems(data.data??[]));setLines([{item_id:0,quantidade:1,valor_unitario_compra:0}]);setSupplier("none");setFinance(false);}},[open]);
  const total=useMemo(()=>lines.reduce((sum,line)=>sum+line.quantidade*line.valor_unitario_compra,0),[lines]);
  function update(index:number,change:Partial<Line>){setLines((old)=>old.map((line,current)=>current===index?{...line,...change}:line));}
  async function save(){
    if(lines.some((line)=>!line.item_id||line.quantidade<=0)){toast.error("Preencha todos os itens da entrada.");return;}
    setLoading(true);
    try{
      const selectedSupplier=fornecedores.find((item)=>String(item.id)===supplier);
      await axios.post("/api/usoconsumo/entradas/geral",{
        fornecedor_id:supplier==="none"?undefined:Number(supplier),tipo:"COMPRA_FORNECEDOR",itens:lines,
        transacoes:finance?[{descricao:"Compra de material de uso e consumo",valor:Number(total.toFixed(2)),data:`${due}T12:00:00`,metodopagamento:null,categoria:"Compra de material de uso e consumo",categoria_id:null,banco_id:null,nomepagador:selectedSupplier?.nomerazaosocial??"Fornecedor",cpfcnpjpagador:selectedSupplier?.cpfcnpj??"NAO INFORMADO",pendente:true,plano_de_conta_id:null,plano_de_conta:null,centro_custo_id:null,centro_custo:null}]:[],
      });
      toast.success("Entrada manual registrada.");onOpenChange(false);await onSaved();
    }catch(error){toast.error("Entrada não registrada.",{description:errorText(error)});}finally{setLoading(false);}
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Entrada manual</DialogTitle><DialogDescription>Registre vários materiais na mesma operação.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Fornecedor geral</Label><Select value={supplier} onValueChange={setSupplier}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Sem fornecedor</SelectItem>{fornecedores.map((item)=><SelectItem key={item.id} value={String(item.id)}>{item.nomerazaosocial}</SelectItem>)}</SelectContent></Select></div><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo unitário</TableHead><TableHead/></TableRow></TableHeader><TableBody>{lines.map((line,index)=><TableRow key={index}><TableCell><Select value={line.item_id?String(line.item_id):""} onValueChange={(value)=>{const selected=items.find((item)=>item.id===Number(value));update(index,{item_id:Number(value),valor_unitario_compra:Number(selected?.ultimovalordecompra??selected?.precocompra??0)});}}><SelectTrigger><SelectValue placeholder="Selecione"/></SelectTrigger><SelectContent>{items.map((item)=><SelectItem key={item.id} value={String(item.id)}>{item.titulo}{item.referencia?` · ${item.referencia}`:""}</SelectItem>)}</SelectContent></Select></TableCell><TableCell><Input type="number" min={1} value={line.quantidade} onChange={(e)=>update(index,{quantidade:Number(e.target.value)})}/></TableCell><TableCell><Input type="number" min={0} step="0.0001" value={line.valor_unitario_compra} onChange={(e)=>update(index,{valor_unitario_compra:Number(e.target.value)})}/></TableCell><TableCell><Button size="icon" variant="ghost" disabled={lines.length===1} onClick={()=>setLines((old)=>old.filter((_,current)=>current!==index))}><Trash2 className="size-4"/></Button></TableCell></TableRow>)}</TableBody></Table><Button variant="outline" onClick={()=>setLines((old)=>[...old,{item_id:0,quantidade:1,valor_unitario_compra:0}])}><Plus className="mr-2 size-4"/>Adicionar item</Button><div className="flex items-center justify-between rounded-md border p-4"><div><Label>Gerar conta a pagar</Label><p className="text-sm text-muted-foreground">Total: {total.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p></div><Switch checked={finance} onCheckedChange={setFinance}/></div>{finance&&<div><Label>Vencimento</Label><Input type="date" value={due} onChange={(e)=>setDue(e.target.value)}/></div>}</div><DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Cancelar</Button><Button onClick={save} disabled={loading}>{loading&&<Loader2 className="mr-2 size-4 animate-spin"/>}Confirmar entrada</Button></DialogFooter></DialogContent></Dialog>;
}

