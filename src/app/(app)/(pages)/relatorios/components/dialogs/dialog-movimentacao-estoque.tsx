"use client";

import { useState } from "react";
import { ArrowLeftRight, Download, Loader2, Search, X } from "lucide-react";

import ProductSelect from "@/app/(app)/components/productSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import type { Produto } from "../../../estoque/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

type Inventario = "produtos" | "uso-consumo";

const ORIGENS = [
  ["TODAS", "Todas as origens"],
  ["ENTRADA", "Entrada"],
  ["SAIDA_MANUAL", "Saída manual"],
  ["VENDA", "Venda"],
  ["ORDEM_SERVICO", "Ordem de serviço"],
  ["NAO_IDENTIFICADA", "Sem origem"],
] as const;

export default function DialogMovimentacaoEstoque() {
  const [inventario, setInventario] = useState<Inventario>("produtos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sentido, setSentido] = useState("TODOS");
  const [origem, setOrigem] = useState("TODAS");
  const [acao, setAcao] = useState("TODAS");
  const [status, setStatus] = useState("TODOS");
  const [fiscal, setFiscal] = useState("todos");
  const [produto, setProduto] = useState<Produto>();
  const [produtoOpen, setProdutoOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const produtos = inventario === "produtos";
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  // Origem, ação e produto só existem no razão de produtos. Trocar de estoque
  // limpa o que não se aplica, para o filtro não continuar valendo escondido.
  function trocarInventario(value: string) {
    const proximo = value as Inventario;
    setInventario(proximo);
    if (proximo === "uso-consumo") {
      setOrigem("TODAS");
      setAcao("TODAS");
      setProduto(undefined);
    }
  }

  const params = new URLSearchParams({ inventario });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (sentido !== "TODOS") params.set("sentido", sentido);
  if (status !== "TODOS") params.set("status", status);
  if (fiscal !== "todos") params.set("fiscal", fiscal);
  if (produtos && origem !== "TODAS") params.set("origem", origem);
  if (produtos && acao !== "TODAS") params.set("acao", acao);
  if (produtos && produto?.id) params.set("produtoId", String(produto.id));

  const endpoint = `/api/reports/estoque/movimentos/export?${params.toString()}`;
  const title = produtos ? "Movimentação de estoque" : "Movimentação de uso e consumo";

  async function exportExcel() {
    if (exporting || invalid) return;
    setExporting(true);
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Não foi possível exportar o relatório.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = produtos ? "movimentacao_estoque.xlsx" : "movimentacao_uso_consumo.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar o relatório.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger
          icon={<ArrowLeftRight className="h-4 w-4" />}
          title="Movimentação de estoque"
          description="Entradas e saídas item a item, com saldo, origem e valor"
          tone="bg-sky-500/10 text-sky-600"
        />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Uma linha por movimento de item, do mais antigo ao mais recente. O valor usa o custo
            atual do cadastro, então não corresponde ao CMV da DRE, que usa o custo do documento.
          </DialogDescription>
        </DialogHeader>

        <ReportFiltersPanel>
          <Field label="Estoque">
            <Select value={inventario} onValueChange={trocarInventario}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="produtos">Produtos</SelectItem>
                <SelectItem value="uso-consumo">Uso e consumo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {produtos
                ? "Razão de produtos: entrada, saída manual, venda e ordem de serviço."
                : "Entradas e saídas de uso e consumo, abertas por item."}
            </p>
          </Field>

          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de movimento">
              <Select value={sentido} onValueChange={setSentido}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Entradas e saídas</SelectItem>
                  <SelectItem value="ENTRADA">Somente entradas</SelectItem>
                  <SelectItem value="SAIDA">Somente saídas</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os status</SelectItem>
                  <SelectItem value="CONFIRMADA">Confirmadas</SelectItem>
                  <SelectItem value="CANCELADA">Canceladas</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {produtos && (
              <>
                <Field label="Origem">
                  <Select value={origem} onValueChange={setOrigem}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ORIGENS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Registro ou estorno">
                  <Select value={acao} onValueChange={setAcao}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Registros e estornos</SelectItem>
                      <SelectItem value="REGISTRO">Somente registros</SelectItem>
                      <SelectItem value="ESTORNO">Somente estornos</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}

            <Field label="Nota fiscal">
              <Select value={fiscal} onValueChange={setFiscal}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Com e sem nota</SelectItem>
                  <SelectItem value="com_nf">Somente com NF-e</SelectItem>
                  <SelectItem value="sem_nf">Somente sem nota</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {produtos && (
              <Field label="Produto">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setProdutoOpen(true)}>
                    <Search className="mr-2 h-4 w-4" /><span className="truncate">{produto?.titulo ?? "Todos os produtos"}</span>
                  </Button>
                  {produto && <Button type="button" variant="outline" size="icon" onClick={() => setProduto(undefined)} aria-label="Limpar produto"><X className="h-4 w-4" /></Button>}
                </div>
                <ProductSelect open={produtoOpen} setOpen={setProdutoOpen} OnSelect={(selecionado) => { setProduto(selecionado); setProdutoOpen(false); }} />
              </Field>
            )}
          </div>
        </ReportFiltersPanel>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <SpreadsheetPdfButton endpoint={endpoint} title={title} orientacao="retrato" disabled={invalid || exporting} />
          <Button type="button" onClick={() => void exportExcel()} disabled={invalid || exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {exporting ? "Exportando..." : "Exportar Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>;
}
