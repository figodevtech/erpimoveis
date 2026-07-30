"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, FileText, Loader2, PackageOpen, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";

type Inventory = "produto" | "usoconsumo";

type EntryItem = Record<string, unknown> & {
  id?: number;
  produto_id?: number;
  item_id?: number;
  titulo?: string | null;
  referencia?: string | null;
  unidade?: string | null;
  quantidade?: number;
  valor_unitario_compra?: number;
  precovenda?: number;
  valor_desconto?: number;
  valor_frete?: number;
  outras_despesas?: number;
  valor_total?: number;
  saldo_anterior?: number;
  saldo_resultante?: number;
  produto?: { id?: number; titulo?: string | null; referencia?: string | null } | null;
  item?: { id?: number; titulo?: string | null; referencia?: string | null; unidade?: string | null } | null;
};

type EntryTransaction = {
  id?: number;
  descricao?: string | null;
  valor?: number;
  data?: string;
  vencimento_em?: string | null;
  pendente?: boolean;
  is_deleted?: boolean;
  origem?: string | null;
  estorno_transacao_id?: number | null;
};

type EntryDetails = Record<string, unknown> & {
  id: number;
  status?: string | null;
  tipo?: string | null;
  origem?: string | null;
  fiscal?: boolean;
  numero_nota?: string | null;
  serie_nota?: string | null;
  notachave?: string | null;
  chave_nfe?: string | null;
  data_emissao?: string | null;
  valor_total?: number;
  created_at?: string;
  cancelada_at?: string | null;
  fornecedor?: {
    id?: number;
    nomerazaosocial?: string | null;
    nomefantasia?: string | null;
    cpfcnpj?: string | null;
  } | null;
  itens?: EntryItem[];
  transacoes?: EntryTransaction[];
};

type Props = {
  entryId: number | null;
  inventory: Inventory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const fiscalFields: Array<[string, string]> = [
  ["numero_item_fiscal", "Item fiscal"],
  ["codigo_fornecedor", "Código do fornecedor"],
  ["ncm", "NCM"],
  ["cest", "CEST"],
  ["cfop", "CFOP"],
  ["csosn", "CSOSN"],
  ["cst", "CST ICMS"],
  ["aliquotaicms", "Alíquota ICMS"],
  ["cst_pis", "CST PIS"],
  ["aliquota_pis", "Alíquota PIS"],
  ["cst_cofins", "CST COFINS"],
  ["aliquota_cofins", "Alíquota COFINS"],
  ["cClassTrib", "Classificação IBS/CBS"],
  ["cclass_trib", "Classificação IBS/CBS"],
  ["cstIbs", "CST IBS"],
  ["cst_ibscbs", "CST IBS/CBS"],
  ["cstCbs", "CST CBS"],
  ["aliquota_ibs_uf", "Alíquota IBS UF"],
  ["aliquota_ibs_municipio", "Alíquota IBS municipal"],
  ["aliquota_cbs", "Alíquota CBS"],
];

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function formatEnum(value: unknown) {
  if (!hasValue(value)) return "Não informado";
  return String(value).replaceAll("_", " ").toLocaleLowerCase("pt-BR").replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function formatDateTime(value: unknown) {
  if (!hasValue(value)) return "Não informada";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function statusBadge(status?: string | null) {
  const normalized = status?.toUpperCase();
  if (normalized === "CONFIRMADA") {
    return <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Confirmada</Badge>;
  }
  if (normalized === "CANCELADA") {
    return <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">Cancelada</Badge>;
  }
  return <Badge variant="outline">{formatEnum(status)}</Badge>;
}

function Detail({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}

export function EntryDetailsDialog({ entryId, inventory, open, onOpenChange }: Props) {
  const [entry, setEntry] = useState<EntryDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !entryId) return;

    const controller = new AbortController();
    const endpoint = inventory === "produto"
      ? `/api/entradas/${entryId}`
      : `/api/usoconsumo/entradas/${entryId}`;

    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setEntry(null);
        setError(null);
        setLoading(true);
        return fetch(endpoint, { signal: controller.signal });
      })
      .then(async (response) => {
        if (!response) return;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? "Não foi possível consultar a entrada.");
        const details = inventory === "produto" ? payload?.entrada : payload?.data;
        if (!details) throw new Error("A API não retornou os detalhes da entrada.");
        setEntry(details as EntryDetails);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Não foi possível consultar a entrada.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [entryId, inventory, open]);

  const items = entry?.itens ?? [];
  const transactions = entry?.transacoes ?? [];
  const invoiceKey = entry?.notachave || entry?.chave_nfe;
  const computedTotal = items.reduce((total, item) => total + numberValue(item.valor_total), 0);
  const entryTotal = numberValue(entry?.valor_total) || computedTotal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Detalhes da entrada #{entryId}
            {entry ? statusBadge(entry.status) : null}
          </DialogTitle>
          <DialogDescription>
            Informações completas do lançamento e seus impactos no estoque e financeiro.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Carregando entrada...
          </div>
        ) : null}

        {error ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
            <AlertCircle className="size-6" />
            {error}
          </div>
        ) : null}

        {entry && !loading ? (
          <div className="space-y-6">
            <section className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-4 flex items-center gap-2">
                <ReceiptText className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Dados da entrada</h3>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="ID">#{entry.id}</Detail>
                <Detail label="Tipo">{formatEnum(entry.tipo)}</Detail>
                <Detail label="Origem">{formatEnum(entry.origem)}</Detail>
                <Detail label="Registro">{formatDateTime(entry.created_at)}</Detail>
                <Detail label="Valor total">{formatarEmReal(entryTotal)}</Detail>
                <Detail label="Entrada fiscal">{entry.fiscal ? "Sim" : "Não"}</Detail>
                {entry.cancelada_at ? <Detail label="Cancelada em">{formatDateTime(entry.cancelada_at)}</Detail> : null}
              </dl>
            </section>

            <section className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-semibold">Fornecedor</h3>
                <dl className="grid gap-3">
                  <Detail label="Nome">{entry.fornecedor?.nomerazaosocial || entry.fornecedor?.nomefantasia || "Não informado"}</Detail>
                  <Detail label="CPF/CNPJ" mono>{entry.fornecedor?.cpfcnpj || "Não informado"}</Detail>
                  {entry.fornecedor?.id ? <Detail label="Registro">#{entry.fornecedor.id}</Detail> : null}
                </dl>
              </div>
              <div className="border-t pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" /> Documento fiscal</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Nota">{entry.numero_nota || "Não informada"}</Detail>
                  <Detail label="Série">{entry.serie_nota || "Não informada"}</Detail>
                  <Detail label="Emissão">{formatDateTime(entry.data_emissao)}</Detail>
                  {invoiceKey ? <div className="sm:col-span-2"><Detail label="Chave da NF-e" mono>{invoiceKey}</Detail></div> : null}
                </dl>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><PackageOpen className="size-4" /> Itens da entrada</h3>
                <Badge variant="secondary">{items.length} item(ns)</Badge>
              </div>

              {items.map((item, index) => {
                const relatedItem = item.produto || item.item;
                const itemTitle = item.titulo || relatedItem?.titulo || `Item #${item.produto_id || item.item_id || index + 1}`;
                const reference = item.referencia || relatedItem?.referencia;
                const unit = item.unidade || item.item?.unidade || "UN";
                const fiscalDetails = fiscalFields.reduce<Array<[string, string]>>((details, field) => {
                  const [fieldName, label] = field;
                  if (!hasValue(item[fieldName]) || details.some(([, currentLabel]) => currentLabel === label)) {
                    return details;
                  }
                  return [...details, field];
                }, []);

                return (
                  <article key={item.id ?? index} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{itemTitle}</p>
                        <p className="text-xs text-muted-foreground">
                          Item #{item.produto_id || item.item_id || relatedItem?.id || item.id}
                          {reference ? ` · Ref. ${reference}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline">{numberValue(item.quantidade).toLocaleString("pt-BR")} {unit}</Badge>
                    </div>

                    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Detail label="Valor unitário">{formatarEmReal(numberValue(item.valor_unitario_compra))}</Detail>
                      {hasValue(item.precovenda) ? <Detail label="Preço de venda">{formatarEmReal(numberValue(item.precovenda))}</Detail> : null}
                      <Detail label="Desconto">{formatarEmReal(numberValue(item.valor_desconto))}</Detail>
                      <Detail label="Frete">{formatarEmReal(numberValue(item.valor_frete))}</Detail>
                      <Detail label="Outras despesas">{formatarEmReal(numberValue(item.outras_despesas))}</Detail>
                      <Detail label="Total do item">{formatarEmReal(numberValue(item.valor_total))}</Detail>
                      {hasValue(item.saldo_anterior) ? <Detail label="Saldo anterior">{numberValue(item.saldo_anterior).toLocaleString("pt-BR")}</Detail> : null}
                      {hasValue(item.saldo_resultante) ? <Detail label="Saldo resultante">{numberValue(item.saldo_resultante).toLocaleString("pt-BR")}</Detail> : null}
                    </dl>

                    {fiscalDetails.length ? (
                      <>
                        <Separator className="my-4" />
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados fiscais do item</p>
                        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {fiscalDetails.map(([field, label]) => (
                            <Detail key={field} label={label}>{String(item[field])}</Detail>
                          ))}
                        </dl>
                      </>
                    ) : null}
                  </article>
                );
              })}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Lançamentos financeiros</h3>
                <Badge variant="secondary">{transactions.length} lançamento(s)</Badge>
              </div>
              {transactions.length ? (
                <div className="overflow-hidden rounded-xl border">
                  <Table className="text-xs">
                    <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Data</TableHead><TableHead>Vencimento</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {transactions.map((transaction, index) => (
                        <TableRow key={transaction.id ?? index}>
                          <TableCell className="max-w-64 whitespace-normal">{transaction.descricao || `Lançamento #${transaction.id}`}</TableCell>
                          <TableCell>{formatDateTime(transaction.data)}</TableCell>
                          <TableCell>{transaction.vencimento_em ? formatDateTime(transaction.vencimento_em) : "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {transaction.is_deleted ? "Excluído" : transaction.estorno_transacao_id ? "Estorno" : transaction.pendente ? "Pendente" : "Realizado"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatarEmReal(numberValue(transaction.valor))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Esta entrada não possui lançamentos financeiros.</p>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
