"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, FileText, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StatusToken = "CARREGANDO" | "VALIDO" | "INVALIDO" | "USADO" | "EXPIRADO" | "INVALIDADO" | "INDISPONIVEL";
type Orcamento = {
  id: number;
  cliente: { nomerazaosocial: string };
  descricao?: string | null;
  itens: Array<{
    id: number;
    descricao: string;
    quantidade: number;
    precoUnitario: number;
    subtotal: number;
    desconto: { tipo: "FIXO" | "PORCENTAGEM" | null; valor: number; aplicado: number };
    frete: number;
    valorTotal: number;
  }>;
  totais: {
    subtotal: number;
    subtotalProdutos: number;
    desconto: number;
    descontoItens: number;
    descontoGeral: { tipo: "FIXO" | "PORCENTAGEM" | null; valor: number; aplicado: number };
    frete: number;
    freteItens: number;
    freteGeral: number;
    total: number;
  };
};

const dinheiro = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

const rotuloDesconto = (desconto: { tipo: "FIXO" | "PORCENTAGEM" | null; valor: number }) =>
  desconto.tipo === "PORCENTAGEM"
    ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(desconto.valor)}%`
    : desconto.tipo === "FIXO"
      ? dinheiro(desconto.valor)
      : "";

export default function VendaAprovacaoPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const [statusToken, setStatusToken] = useState<StatusToken>("CARREGANDO");
  const [resultado, setResultado] = useState<"APROVADA" | "REPROVADA" | null>(null);
  const [documento, setDocumento] = useState("");
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const consultarEstado = async () => {
      try {
        const response = await fetch(`/api/venda/aprovacao/${token}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        setStatusToken((data.statusToken ?? "INVALIDO") as StatusToken);
        setResultado(data.resultado === "APROVADA" || data.resultado === "REPROVADA" ? data.resultado : null);
      } catch {
        if (active) setStatusToken("INVALIDO");
      }
    };
    if (token) void consultarEstado();
    return () => {
      active = false;
    };
  }, [token]);

  const enviar = async (acao: "consultar" | "aprovar" | "reprovar") => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/venda/aprovacao/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, documento }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a solicitação.");

      if (acao === "consultar") {
        setOrcamento(data.venda as Orcamento);
      } else {
        const status = acao === "aprovar" ? "APROVADA" : "REPROVADA";
        setResultado(status);
        setStatusToken("USADO");
        setOrcamento(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const validarDocumento = (event: FormEvent) => {
    event.preventDefault();
    void enviar("consultar");
  };

  if (statusToken === "CARREGANDO") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  if (statusToken !== "VALIDO" || resultado) {
    const aprovado = resultado === "APROVADA";
    const titulo = resultado
      ? aprovado
        ? "Orçamento aprovado"
        : "Orçamento recusado"
      : statusToken === "EXPIRADO"
        ? "Link expirado"
        : "Link indisponível";
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="items-center">
            {aprovado ? (
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            ) : (
              <XCircle className="h-12 w-12 text-muted-foreground" />
            )}
            <CardTitle>{titulo}</CardTitle>
            <CardDescription>
              {resultado
                ? "Sua resposta foi registrada com sucesso."
                : "Solicite à empresa um novo link para consultar este orçamento."}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Aprovação de orçamento
                </CardTitle>
                <CardDescription>Confira os produtos e valores antes de responder.</CardDescription>
              </div>
              <Badge variant="outline" className="gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Acesso protegido
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {!orcamento ? (
          <Card className="mx-auto max-w-xl">
            <CardHeader>
              <CardTitle className="text-lg">Confirme sua identidade</CardTitle>
              <CardDescription>
                Informe o CPF ou CNPJ cadastrado na empresa. O documento não será exibido nesta página.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={validarDocumento}>
                <div className="space-y-2">
                  <Label htmlFor="documento">CPF/CNPJ</Label>
                  <Input
                    id="documento"
                    value={documento}
                    onChange={(event) => setDocumento(event.target.value)}
                    inputMode="text"
                    autoComplete="off"
                    placeholder="Digite seu CPF ou CNPJ"
                    required
                  />
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={loading || !documento.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Consultar orçamento
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Orçamento #{orcamento.id}</CardTitle>
                <CardDescription>Cliente: {orcamento.cliente.nomerazaosocial}</CardDescription>
              </CardHeader>
              {orcamento.descricao ? (
                <CardContent>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrição</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{orcamento.descricao}</p>
                </CardContent>
              ) : null}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Produtos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-center">Qtd.</TableHead>
                        <TableHead className="text-right">Unitário</TableHead>
                        <TableHead className="text-right">Desconto</TableHead>
                        <TableHead className="text-right">Frete</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orcamento.itens.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.descricao}</TableCell>
                          <TableCell className="text-center">{item.quantidade}</TableCell>
                          <TableCell className="text-right">{dinheiro(item.precoUnitario)}</TableCell>
                          <TableCell className="text-right">
                            {item.desconto.aplicado > 0 ? (
                              <div>
                                <p className="text-emerald-700">- {dinheiro(item.desconto.aplicado)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.desconto.tipo === "PORCENTAGEM" ? "Percentual" : "Fixo"} · {rotuloDesconto(item.desconto)}
                                </p>
                              </div>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.frete > 0 ? dinheiro(item.frete) : "—"}
                          </TableCell>
                          <TableCell className="text-right">{dinheiro(item.valorTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <Separator className="my-5" />
                <div className="ml-auto max-w-sm space-y-2 text-sm">
                  <div className="flex justify-between"><span>Subtotal dos produtos</span><span>{dinheiro(orcamento.totais.subtotalProdutos)}</span></div>
                  {orcamento.totais.descontoItens > 0 ? (
                    <div className="flex justify-between text-emerald-700"><span>Descontos nos produtos</span><span>- {dinheiro(orcamento.totais.descontoItens)}</span></div>
                  ) : null}
                  {orcamento.totais.freteItens > 0 ? (
                    <div className="flex justify-between"><span>Fretes dos produtos</span><span>+ {dinheiro(orcamento.totais.freteItens)}</span></div>
                  ) : null}
                  {orcamento.totais.descontoGeral.aplicado > 0 ? (
                    <div className="flex justify-between gap-4 text-emerald-700">
                      <span>
                        Desconto geral ({orcamento.totais.descontoGeral.tipo === "PORCENTAGEM" ? "percentual" : "fixo"} · {rotuloDesconto(orcamento.totais.descontoGeral)})
                      </span>
                      <span className="shrink-0">- {dinheiro(orcamento.totais.descontoGeral.aplicado)}</span>
                    </div>
                  ) : null}
                  {orcamento.totais.freteGeral > 0 ? (
                    <div className="flex justify-between"><span>Frete geral</span><span>+ {dinheiro(orcamento.totais.freteGeral)}</span></div>
                  ) : null}
                  <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>{dinheiro(orcamento.totais.total)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
                <Button type="button" variant="destructive" onClick={() => void enviar("reprovar")} disabled={loading}>
                  Recusar orçamento
                </Button>
                <Button type="button" onClick={() => void enviar("aprovar")} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Aprovar orçamento
                </Button>
              </CardContent>
            </Card>
            {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
