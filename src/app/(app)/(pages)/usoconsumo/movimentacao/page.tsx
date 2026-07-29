"use client";

import axios, { isAxiosError } from "axios";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";

type MovementLine = {
  quantidade: number;
  item?: { titulo?: string | null } | null;
};

type Entry = {
  id: number;
  created_at: string;
  fiscal?: boolean;
  numero_nota?: string | null;
  origem?: string | null;
  fornecedor?: { nomerazaosocial?: string | null } | null;
  itens?: MovementLine[];
  valor_total?: number | null;
  status?: string | null;
};

type Output = {
  id: number;
  created_at: string;
  motivo: string;
  itens?: MovementLine[];
  funcionario?: string | null;
  setor?: string | null;
  status?: string | null;
};

function errorText(error: unknown) {
  return isAxiosError(error) ? error.response?.data?.error ?? error.message : "Erro inesperado.";
}

function movementItems(lines?: MovementLine[]) {
  return lines?.map((line) => `${line.item?.titulo ?? "Item"} (${line.quantidade})`).join(", ") ?? "—";
}

export default function MovimentacaoUsoConsumoPage() {
  const { data: session } = useSession();
  const canCancel = permissionSetHas(
    (session?.user as { permissoes?: unknown })?.permissoes,
    PERMS.USOCONSUMO_CANCELAR,
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entryResponse, outputResponse] = await Promise.all([
        axios.get("/api/usoconsumo/entradas", { params: { limit: 100 } }),
        axios.get("/api/usoconsumo/saidas", { params: { limit: 100 } }),
      ]);
      setEntries(entryResponse.data.data ?? []);
      setOutputs(outputResponse.data.data ?? []);
    } catch (error) {
      toast.error("Movimentações não carregadas.", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(kind: "entrada" | "saida", id: number) {
    if (!canCancel || !window.confirm(`Cancelar esta ${kind}?`)) return;
    const target = `${kind}-${id}`;
    setCanceling(target);
    try {
      await axios.post(`/api/usoconsumo/${kind === "entrada" ? "entradas" : "saidas"}/${id}/cancelar`);
      toast.success("Movimentação cancelada.");
      await load();
    } catch (error) {
      toast.error("Cancelamento não realizado.", { description: errorText(error) });
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link href="/usoconsumo"><ArrowLeft className="size-5" /></Link></Button>
        <div><h1 className="text-2xl font-semibold">Movimentações de uso e consumo</h1><p className="text-sm text-muted-foreground">Histórico auditável de entradas e saídas.</p></div>
      </div>

      {loading ? <Loader2 className="mx-auto size-6 animate-spin" /> : (
        <Tabs defaultValue="entradas">
          <TabsList><TabsTrigger value="entradas">Entradas</TabsTrigger><TabsTrigger value="saidas">Saídas</TabsTrigger></TabsList>
          <TabsContent value="entradas">
            <Card><CardContent className="p-0"><Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Origem</TableHead><TableHead>Fornecedor</TableHead><TableHead>Itens</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead>{canCancel ? <TableHead /> : null}</TableRow></TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const target = `entrada-${entry.id}`;
                  return <TableRow key={entry.id}><TableCell>{new Date(entry.created_at).toLocaleString("pt-BR")}</TableCell><TableCell>{entry.fiscal ? `NF ${entry.numero_nota ?? ""}` : entry.origem}</TableCell><TableCell>{entry.fornecedor?.nomerazaosocial ?? "—"}</TableCell><TableCell>{movementItems(entry.itens)}</TableCell><TableCell>{Number(entry.valor_total ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell><TableCell><Badge variant={entry.status === "CONFIRMADA" ? "default" : "secondary"}>{entry.status}</Badge></TableCell>{canCancel ? <TableCell>{entry.status === "CONFIRMADA" ? <Button size="sm" variant="outline" disabled={canceling === target} onClick={() => void cancel("entrada", entry.id)}>{canceling === target ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RotateCcw className="mr-1 size-4" />}Cancelar</Button> : null}</TableCell> : null}</TableRow>;
                })}
                {!entries.length ? <TableRow><TableCell colSpan={canCancel ? 7 : 6} className="h-32 text-center text-muted-foreground">Nenhuma entrada.</TableCell></TableRow> : null}
              </TableBody>
            </Table></CardContent></Card>
          </TabsContent>
          <TabsContent value="saidas">
            <Card><CardContent className="p-0"><Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Motivo</TableHead><TableHead>Itens</TableHead><TableHead>Responsável</TableHead><TableHead>Status</TableHead>{canCancel ? <TableHead /> : null}</TableRow></TableHeader>
              <TableBody>
                {outputs.map((output) => {
                  const target = `saida-${output.id}`;
                  return <TableRow key={output.id}><TableCell>{new Date(output.created_at).toLocaleString("pt-BR")}</TableCell><TableCell>{output.motivo.replaceAll("_", " ")}</TableCell><TableCell>{movementItems(output.itens)}</TableCell><TableCell>{output.funcionario ?? output.setor ?? "—"}</TableCell><TableCell><Badge variant={output.status === "CONFIRMADA" ? "default" : "secondary"}>{output.status}</Badge></TableCell>{canCancel ? <TableCell>{output.status === "CONFIRMADA" ? <Button size="sm" variant="outline" disabled={canceling === target} onClick={() => void cancel("saida", output.id)}>{canceling === target ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RotateCcw className="mr-1 size-4" />}Cancelar</Button> : null}</TableCell> : null}</TableRow>;
                })}
                {!outputs.length ? <TableRow><TableCell colSpan={canCancel ? 6 : 5} className="h-32 text-center text-muted-foreground">Nenhuma saída.</TableCell></TableRow> : null}
              </TableBody>
            </Table></CardContent></Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
