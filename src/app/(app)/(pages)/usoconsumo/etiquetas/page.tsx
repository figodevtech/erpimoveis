"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UsoConsumoItem } from "@/types/usoconsumo";

export default function EtiquetasUsoConsumoPage(){
  const [items,setItems]=useState<UsoConsumoItem[]>([]);const [search,setSearch]=useState("");
  useEffect(()=>{const timer=setTimeout(()=>{axios.get("/api/usoconsumo/itens",{params:{limit:100,search:search||undefined}}).then(({data})=>setItems(data.data??[]));},250);return()=>clearTimeout(timer);},[search]);
  return <div className="space-y-6 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" asChild><Link href="/usoconsumo"><ArrowLeft className="size-5"/></Link></Button><div><h1 className="text-2xl font-semibold">Etiquetas de uso e consumo</h1><p className="text-sm text-muted-foreground">Imprima identificação e localização dos itens.</p></div></div><Button variant="outline" asChild><Link href="/usoconsumo/registrar-etiqueta"><ScanLine className="mr-2 size-4"/>Consultar etiqueta</Link></Button></div><Input placeholder="Pesquisar item..." value={search} onChange={(e)=>setSearch(e.target.value)}/><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((item)=><Card key={item.id} className="print:break-inside-avoid"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><strong>{item.titulo}</strong><p className="text-sm text-muted-foreground">{item.referencia??"Sem referência"}</p><p className="mt-2 font-mono text-sm">{item.etiqueta??item.codigobarras??`UC-${item.id}`}</p><p className="text-sm">Local: {item.local??"Não informado"}</p></div><Button className="print:hidden" size="icon" variant="ghost" onClick={()=>window.print()}><Printer className="size-4"/></Button></div></CardContent></Card>)}</div></div>;
}

