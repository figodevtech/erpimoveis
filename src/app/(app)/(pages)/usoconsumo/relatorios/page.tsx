"use client";

import axios, { isAxiosError } from "axios";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Report = {
  itens: number;
  valorEstoque: number;
  semEstoque: number;
  baixoCritico: number;
  consumoPorMotivo: Array<{ motivo: string; quantidade: number; valor: number }>;
  comprasPorFornecedor: Array<{ fornecedor: string; valor: number }>;
};

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function RelatoriosUsoConsumoPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get("/api/usoconsumo/relatorios/resumo");
      setReport(data.data);
    } catch (requestError) {
      setReport(null);
      setError(isAxiosError(requestError)
        ? requestError.response?.data?.error ?? requestError.message
        : "Não foi possível carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link href="/usoconsumo"><ArrowLeft className="size-5" /></Link></Button>
        <div><h1 className="text-2xl font-semibold">Relatórios de uso e consumo</h1><p className="text-sm text-muted-foreground">Saldo, valor, consumo e compras por fornecedor.</p></div>
      </div>

      {loading ? <Loader2 className="mx-auto size-6 animate-spin" /> : error ? (
        <Card className="border-destructive/40"><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"><div><p className="font-medium text-destructive">Relatório não carregado</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />Tentar novamente</Button></CardContent></Card>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader><CardTitle className="text-sm">Itens ativos</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{report.itens}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Valor do estoque</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(report.valorEstoque)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Sem estoque</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{report.semEstoque}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Baixo ou crítico</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{report.baixoCritico}</CardContent></Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Consumo por motivo</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Motivo</TableHead><TableHead>Quantidade</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader><TableBody>
              {report.consumoPorMotivo.map((row) => <TableRow key={row.motivo}><TableCell>{row.motivo.replaceAll("_", " ")}</TableCell><TableCell>{row.quantidade}</TableCell><TableCell>{money(row.valor)}</TableCell></TableRow>)}
              {!report.consumoPorMotivo.length ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Nenhum consumo confirmado.</TableCell></TableRow> : null}
            </TableBody></Table></CardContent></Card>
            <Card><CardHeader><CardTitle>Compras por fornecedor</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader><TableBody>
              {report.comprasPorFornecedor.map((row) => <TableRow key={row.fornecedor}><TableCell>{row.fornecedor}</TableCell><TableCell>{money(row.valor)}</TableCell></TableRow>)}
              {!report.comprasPorFornecedor.length ? <TableRow><TableCell colSpan={2} className="h-24 text-center text-muted-foreground">Nenhuma compra confirmada.</TableCell></TableRow> : null}
            </TableBody></Table></CardContent></Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
