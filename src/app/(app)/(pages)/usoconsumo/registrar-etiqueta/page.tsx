"use client";

import axios from "axios";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UsoConsumoItem } from "@/types/usoconsumo";

export default function ConsultarEtiquetaUsoConsumoPage(){
  const [code,setCode]=useState("");const [item,setItem]=useState<UsoConsumoItem|null>(null);const [searched,setSearched]=useState(false);
  async function search(event:FormEvent){event.preventDefault();const {data}=await axios.get("/api/usoconsumo/itens",{params:{limit:20,search:code}});const exact=(data.data??[]).find((value:UsoConsumoItem)=>value.etiqueta===code||value.codigobarras===code)??data.data?.[0]??null;setItem(exact);setSearched(true);}
  return <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" asChild><Link href="/usoconsumo"><ArrowLeft className="size-5"/></Link></Button><div><h1 className="text-2xl font-semibold">Consultar etiqueta</h1><p className="text-sm text-muted-foreground">Leia ou informe código de barras ou etiqueta.</p></div></div><form className="flex gap-2" onSubmit={search}><Input autoFocus value={code} onChange={(e)=>setCode(e.target.value)} placeholder="Código da etiqueta"/><Button type="submit"><Search className="mr-2 size-4"/>Consultar</Button></form>{item?<Card><CardHeader><CardTitle>{item.titulo}</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2"><p><strong>Referência:</strong> {item.referencia??"—"}</p><p><strong>Local:</strong> {item.local??"—"}</p><p><strong>Saldo:</strong> {item.estoque} {item.unidade}</p><p><strong>Status:</strong> {item.status_estoque}</p><p><strong>Etiqueta:</strong> {item.etiqueta??"—"}</p><p><strong>Código:</strong> {item.codigobarras??"—"}</p></CardContent></Card>:searched&&<p className="text-center text-muted-foreground">Nenhum item encontrado.</p>}</div>;
}

