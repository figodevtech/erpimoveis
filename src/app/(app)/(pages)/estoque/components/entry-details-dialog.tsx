"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, Download, Eye, FileText, Loader2, PackageOpen, Receipt, TriangleAlert, UserRound, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import { parseEscopo, rotuloDeEscopo, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";
import { BalanceTrail, Field, Metric, MovementDialogShell, Section } from "./movement-dialog-shell";

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

type FiscalCustomization = {
  destino: "ESTOQUE" | "USOCONSUMO" | "GERAL";
  modalidade: "INTEGRAL" | "HIBRIDA";
  custoTotalEstoque: number;
  custoUnitario: number | null;
  quantidadePersonalizada: number | null;
  valorFiscalDocumento: number | null;
  itemDestino: {
    id: number | null;
    titulo: string | null;
    referencia: string | null;
    unidade: string | null;
  } | null;
  createdAt: string;
  itensOriginais: Array<{
    numeroItem: number;
    codigo: string | null;
    descricao: string | null;
    unidade: string | null;
    quantidade: number;
    valorUnitario: number;
    valorTotal: number;
    custoEstoque: number;
  }>;
};

type EntryDetails = Record<string, unknown> & {
  id: number;
  status?: string | null;
  tipo?: string | null;
  origem?: string | null;
  observacao?: string | null;
  fiscal?: boolean;
  numero_nota?: string | null;
  serie_nota?: string | null;
  notachave?: string | null;
  chave_nfe?: string | null;
  data_emissao?: string | null;
  valor_total?: number;
  created_at?: string;
  /** Só vem nas entradas dos estoques simples. */
  escopo?: UsoConsumoEscopo | null;
  cancelada_at?: string | null;
  motivo_cancelamento?: string | null;
  criador?: { id: string; nome: string | null } | null;
  fornecedor?: {
    id?: number;
    nomerazaosocial?: string | null;
    nomefantasia?: string | null;
    cpfcnpj?: string | null;
  } | null;
  itens?: EntryItem[];
  transacoes?: EntryTransaction[];
  personalizacaoFiscal?: FiscalCustomization | null;
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
  return String(value)
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
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

function customizationDestinationLabel(destination: FiscalCustomization["destino"]) {
  if (destination === "ESTOQUE") return "estoque de revenda";
  return rotuloDeEscopo(destination).nome.toLocaleLowerCase("pt-BR");
}

function statusBadge(status?: string | null) {
  const normalized = status?.toUpperCase();
  if (normalized === "CONFIRMADA") {
    return (
      <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        Confirmada
      </Badge>
    );
  }
  if (normalized === "CANCELADA") {
    return (
      <Badge variant="outline" className="border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300">
        Cancelada
      </Badge>
    );
  }
  return <Badge variant="outline">{formatEnum(status)}</Badge>;
}

export function EntryDetailsDialog({ entryId, inventory, open, onOpenChange }: Props) {
  const [entry, setEntry] = useState<EntryDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !entryId) return;

    const controller = new AbortController();
    const endpoint = inventory === "produto" ? `/api/entradas/${entryId}` : `/api/usoconsumo/entradas/${entryId}`;

    // O reset de estado fica dentro da cadeia de promise (e nao no corpo do efeito)
    // para nao disparar renders em cascata — regra react-hooks/set-state-in-effect.
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

  // O escopo vem da propria entrada carregada: as duas metades da mesma tabela
  // usam o mesmo endpoint, e so a linha diz de qual estoque simples ela e.
  const escopoDaEntrada = parseEscopo(entry?.escopo);

  const router = useRouter();
  const [downloadingXml, setDownloadingXml] = useState(false);
  const [downloadingDanfe, setDownloadingDanfe] = useState(false);

  const items = entry?.itens ?? [];
  const transactions = entry?.transacoes ?? [];
  const invoiceKey = (entry?.notachave || entry?.chave_nfe) ? String(entry?.notachave || entry?.chave_nfe) : null;
  const computedTotal = items.reduce((total, item) => total + numberValue(item.valor_total), 0);
  const entryTotal = numberValue(entry?.valor_total) || computedTotal;
  const totalUnits = items.reduce((total, item) => total + numberValue(item.quantidade), 0);
  const autor = entry?.criador?.nome;
  const customization = entry?.personalizacaoFiscal ?? null;
  const customizedItem = items[0];
  const customizedRelatedItem = customizedItem?.produto || customizedItem?.item;
  const customizedItemTitle =
    customization?.itemDestino?.titulo ||
    (customizedItem
      ? customizedItem.titulo ||
      customizedRelatedItem?.titulo ||
      `Item #${customizedItem.produto_id || customizedItem.item_id || customizedItem.id}`
      : "item não identificado");
  const customizedUnit =
    customization?.itemDestino?.unidade ||
    customizedItem?.unidade ||
    customizedItem?.item?.unidade ||
    "UN";
  const customizedQuantity =
    customization?.quantidadePersonalizada ?? numberValue(customizedItem?.quantidade);
  const customizedFiscalValue =
    customization?.valorFiscalDocumento ?? entryTotal;

  function handleVerNfe() {
    onOpenChange(false);
    const query = invoiceKey || entry?.numero_nota || "";
    router.push(`/fiscal?viewMode=EMITIDAS_TERCEIROS&search=${encodeURIComponent(query)}`);
  }

  async function handleBaixarXml() {
    if (!entryId) return;
    setDownloadingXml(true);
    const toastId = toast.loading("Baixando XML da NF-e...");

    try {
      const response = await fetch(`/api/entradas/${entryId}/xml?inventory=${inventory}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || errData?.detail || "Erro ao baixar XML da NF-e.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `nfe-entrada-${entryId}.xml`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("XML baixado com sucesso!", { id: toastId });
    } catch (err: any) {
      toast.error("Não foi possível baixar o XML", {
        id: toastId,
        description: err?.message,
      });
    } finally {
      setDownloadingXml(false);
    }
  }

  async function handleBaixarDanfe() {
    if (!entryId) return;
    setDownloadingDanfe(true);
    const toastId = toast.loading("Gerando PDF do DANFE...");

    try {
      const response = await fetch(`/api/entradas/${entryId}/danfe?inventory=${inventory}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || errData?.detail || "Erro ao gerar PDF do DANFE.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `DANFE-entrada-${entryId}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("DANFE (PDF) baixado com sucesso!", { id: toastId });
    } catch (err: any) {
      toast.error("Não foi possível baixar o DANFE", {
        id: toastId,
        description: err?.message,
      });
    } finally {
      setDownloadingDanfe(false);
    }
  }

  return (
    <MovementDialogShell
      open={open}
      onOpenChange={onOpenChange}
      tone="entrada"
      kicker={
        inventory === "produto"
          ? "Entrada de estoque"
          : `Entrada de ${rotuloDeEscopo(escopoDaEntrada).nome.toLocaleLowerCase("pt-BR")}`
      }
      movementId={entryId}
      loading={loading}
      loadingLabel="Carregando entrada..."
      error={error}
      statusSlot={entry ? statusBadge(entry.status) : null}
      metaSlot={
        entry ? (
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {formatDateTime(entry.created_at)}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="size-3.5" />
              {autor || "Autor não registrado"}
            </span>
          </>
        ) : null
      }
    >
      {entry ? (
        <>
          {entry.motivo_cancelamento ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">
                Motivo do cancelamento
              </p>
              <p className="mt-1 text-sm font-medium">{entry.motivo_cancelamento}</p>
              {entry.cancelada_at ? (
                <p className="mt-1 text-xs text-muted-foreground">Cancelada em {formatDateTime(entry.cancelada_at)}</p>
              ) : null}
            </div>
          ) : null}

          {customization && (customization.itemDestino || customizedItem) ? (
            <div className="overflow-hidden rounded-lg border border-amber-400/60 bg-amber-50/70 dark:bg-amber-950/15">
              <div className="flex items-start gap-3 border-b border-amber-400/40 p-4">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-amber-950 dark:text-amber-100">
                    {customization.modalidade === "HIBRIDA"
                      ? "Entrada fiscal híbrida"
                      : "Entrada fiscal personalizada"}
                  </p>
                  <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                    {customization.modalidade === "HIBRIDA"
                      ? `As ${customization.itensOriginais.length} linhas desmarcadas da NF-e foram consolidadas em `
                      : `Os ${customization.itensOriginais.length} itens originais da NF-e foram consolidados em `}
                    <span className="font-semibold">
                      {numberValue(customizedQuantity).toLocaleString("pt-BR")} {customizedUnit} de {customizedItemTitle}
                    </span>{" "}
                    no {customizationDestinationLabel(customization.destino)}.
                  </p>
                  <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                    Custo incorporado ao estoque: {formatarEmReal(customization.custoTotalEstoque)}
                    {customization.custoUnitario != null
                      ? ` (${formatarEmReal(customization.custoUnitario)} por ${customizedUnit}).`
                      : "."}
                    {transactions.length
                      ? ` O financeiro permaneceu pelo valor fiscal integral de ${formatarEmReal(customizedFiscalValue)}.`
                      : ` O valor fiscal da entrada permaneceu em ${formatarEmReal(customizedFiscalValue)}, sem lançamento financeiro.`}
                  </p>
                </div>
              </div>
              <div className="space-y-2 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300">
                  Itens recebidos no XML
                </p>
                <div className="grid gap-2">
                  {customization.itensOriginais.map((original) => (
                    <div
                      key={`${original.numeroItem}-${original.codigo ?? "sem-codigo"}`}
                      className="grid gap-2 rounded-md border border-amber-300/60 bg-background/80 p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          Item {original.numeroItem} · {original.descricao || "Sem descrição"}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Código {original.codigo || "—"} · Unitário {formatarEmReal(original.valorUnitario)}
                        </p>
                      </div>
                      <span className="font-medium tabular-nums">
                        {original.quantidade.toLocaleString("pt-BR")} {original.unidade || "UN"}
                      </span>
                      <span className="font-semibold tabular-nums sm:text-right">
                        {formatarEmReal(original.valorTotal)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Valor total"
              value={formatarEmReal(entryTotal)}
              emphasis
              tone="entrada"
              hint={entry.fiscal ? "Entrada fiscal" : "Entrada sem documento fiscal"}
            />
            <Metric
              label="Itens"
              value={items.length.toLocaleString("pt-BR")}
              hint={`${totalUnits.toLocaleString("pt-BR")} unidade(s) recebida(s)`}
            />
            <Metric
              label="Lançamentos"
              value={transactions.length.toLocaleString("pt-BR")}
              hint={transactions.length ? "Impacto no financeiro" : "Sem impacto financeiro"}
            />
          </div>

          <Section title="Dados da entrada" icon={Receipt}>
            <dl className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tipo">{formatEnum(entry.tipo)}</Field>
              <Field label="Origem">{formatEnum(entry.origem)}</Field>
              <Field label="Registrado em">{formatDateTime(entry.created_at)}</Field>
              <Field label="Registrado por">{autor || "Não informado"}</Field>
              {entry.cancelada_at ? <Field label="Cancelada em">{formatDateTime(entry.cancelada_at)}</Field> : null}
              {entry.observacao ? (
                <Field label="Observação" className="sm:col-span-2 lg:col-span-4">
                  {entry.observacao}
                </Field>
              ) : null}
            </dl>
          </Section>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Fornecedor" icon={Building2}>
              <dl className="grid gap-3 rounded-lg border p-4 bg-card">
                <Field label="Nome">
                  {entry.fornecedor?.nomerazaosocial || entry.fornecedor?.nomefantasia || "Não informado"}
                </Field>
                <Field label="CPF/CNPJ" mono>
                  {entry.fornecedor?.cpfcnpj || "Não informado"}
                </Field>
                {entry.fornecedor?.id ? <Field label="Registro">#{entry.fornecedor.id}</Field> : null}
              </dl>
            </Section>

            <Section
              title="Documento fiscal"
              icon={FileText}
              action={
                entry.fiscal || invoiceKey || entry.numero_nota ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleVerNfe}
                      className="h-7 px-2 text-xs gap-1 hover:cursor-pointer shrink-0"
                    >
                      <Eye className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Ver NF-e</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleBaixarXml}
                      disabled={downloadingXml}
                      className="h-7 px-2 text-xs gap-1 hover:cursor-pointer shrink-0"
                    >
                      {downloadingXml ? (
                        <Loader2 className="size-3.5 animate-spin shrink-0" />
                      ) : (
                        <Download className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                      <span>XML</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleBaixarDanfe}
                      disabled={downloadingDanfe}
                      className="h-7 px-2 text-xs gap-1 hover:cursor-pointer shrink-0"
                    >
                      {downloadingDanfe ? (
                        <Loader2 className="size-3.5 animate-spin shrink-0" />
                      ) : (
                        <FileText className="size-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      )}
                      <span>DANFE</span>
                    </Button>
                  </div>
                ) : null
              }
            >
              <dl className="grid bg-card gap-3 rounded-lg border p-4 sm:grid-cols-2">
                <Field label="Nota">{entry.numero_nota || "Não informada"}</Field>
                <Field label="Série">{entry.serie_nota || "Não informada"}</Field>
                <Field label="Emissão" className="sm:col-span-2">
                  {formatDateTime(entry.data_emissao)}
                </Field>
                {invoiceKey ? (
                  <Field label="Chave da NF-e" mono className="sm:col-span-2">
                    {invoiceKey}
                  </Field>
                ) : null}
              </dl>
            </Section>
          </div>

          <Section
            title="Itens da entrada"
            icon={PackageOpen}
            action={<Badge variant="secondary">{items.length} item(ns)</Badge>}
          >
            <div className="space-y-3">
              {items.map((item, index) => {
                const relatedItem = item.produto || item.item;
                const itemTitle =
                  item.titulo || relatedItem?.titulo || `Item #${item.produto_id || item.item_id || index + 1}`;
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
                  <article key={item.id ?? index} className="overflow-hidden rounded-lg bg-card border">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{itemTitle}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Item #{item.produto_id || item.item_id || relatedItem?.id || item.id}
                          {reference ? ` · Ref. ${reference}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge variant="outline" className="font-bold tabular-nums">
                          {numberValue(item.quantidade).toLocaleString("pt-BR")} {unit}
                        </Badge>
                        <BalanceTrail before={item.saldo_anterior} after={item.saldo_resultante} tone="entrada" />
                      </div>
                    </div>

                    <dl className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Valor unitário">{formatarEmReal(numberValue(item.valor_unitario_compra))}</Field>
                      {hasValue(item.precovenda) ? (
                        <Field label="Preço de venda">{formatarEmReal(numberValue(item.precovenda))}</Field>
                      ) : null}
                      <Field label="Desconto">{formatarEmReal(numberValue(item.valor_desconto))}</Field>
                      <Field label="Frete">{formatarEmReal(numberValue(item.valor_frete))}</Field>
                      <Field label="Outras despesas">{formatarEmReal(numberValue(item.outras_despesas))}</Field>
                      <Field label="Total do item">{formatarEmReal(numberValue(item.valor_total))}</Field>
                    </dl>

                    {fiscalDetails.length ? (
                      <div className="border-t px-4 py-3">
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          Dados fiscais do item
                        </p>
                        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {fiscalDetails.map(([field, label]) => (
                            <Field key={field} label={label}>
                              {String(item[field])}
                            </Field>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </Section>

          <Section
            title="Lançamentos financeiros"
            icon={Wallet}
            action={<Badge variant="secondary">{transactions.length} lançamento(s)</Badge>}
          >
            {transactions.length ? (
              <div className="overflow-hidden rounded-lg border">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((transaction, index) => (
                      <TableRow key={transaction.id ?? index}>
                        <TableCell className="max-w-64 whitespace-normal">
                          {transaction.descricao || `Lançamento #${transaction.id}`}
                        </TableCell>
                        <TableCell>{formatDateTime(transaction.data)}</TableCell>
                        <TableCell>{transaction.vencimento_em ? formatDateTime(transaction.vencimento_em) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {transaction.is_deleted
                              ? "Excluído"
                              : transaction.estorno_transacao_id
                                ? "Estorno"
                                : transaction.pendente
                                  ? "Pendente"
                                  : "Realizado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatarEmReal(numberValue(transaction.valor))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Esta entrada não possui lançamentos financeiros.
              </p>
            )}
          </Section>
        </>
      ) : null}
    </MovementDialogShell>
  );
}
