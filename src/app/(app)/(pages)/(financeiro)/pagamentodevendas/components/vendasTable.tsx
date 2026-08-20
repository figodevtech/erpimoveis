"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "../../fluxodecaixa/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Printer,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import formatarEmReal from "@/utils/formatarEmReal";
import { useEffect, useState } from "react";
import { VendaComItens, vendaStatus } from "../../../(vendas)/historicovendas/types";
import { formatDate } from "@/utils/formatDate";
import VendasFinancialDialog from "./vendasFinancialDialog/vendasFinancialDialog";
import { EmissaoNotaDialog } from "../../../ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { VendaDetailsDialog } from "../../../(vendas)/historicovendas/components/venda-detail-dialog";
import { useConfig } from "../../../config-context";
import { Badge } from "@/components/ui/badge";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import {
  PaymentListFilters,
  PaymentsFilterSheet,
} from "../../components/payments-filter-sheet";
import { resumirBaixas } from "../../components/payment-settler";
import { resumirPagamentos } from "../../components/payment-totals";
import { TotalPago } from "../../components/total-pago";
import { Checkbox } from "@/components/ui/checkbox";
import { Split, UserRound } from "lucide-react";
import TransactionDialog from "../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { PagamentoMultiploFooter } from "../../components/pagamento-multiplo-footer";
import type { DocumentoSelecionavel } from "../../components/pagamento-multiplo";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { Label } from "@/components/ui/label";

interface OsTableProps {
  vendas: VendaComItens[];
  pagination: Pagination;
  handleGetVendas: (
    status: vendaStatus,
    pageNumber?: number,
    limit?: number,
    search?: string,
    filters?: PaymentListFilters,
  ) => void;
  isLoading: boolean;
  search: string;
}

export default function VendasTable({ vendas, pagination, handleGetVendas, isLoading, search }: OsTableProps) {
  // ID estável para o Select de "itens por página"
  const [selectedStatus, setSelectedStatus] = useState<vendaStatus>(vendaStatus.PAGAMENTO);
  const [open, setOpen] = useState(false);
  const [openEmissao, setOpenEmissao] = useState(false);
  const [emissaoId, setEmissaoId] = useState<number | undefined>(undefined);
  const [detalhesOpen, setDetalhesOpen] = useState(false);
  const [detalhesId, setDetalhesId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<PaymentListFilters>({
    cliente: "",
    notaNumero: "",
  });
  const [categorias, setCategorias] = useState<Array<{ value: string; label: string }>>([]);
  const [vendedores, setVendedores] = useState<Array<{ value: string; label: string }>>([]);
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-os-limit-listbox`;
  const [modoPagamentoMultiplo, setModoPagamentoMultiplo] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogPagamentoAberto, setDialogPagamentoAberto] = useState(false);
  const hasActiveFilters = Boolean(
    filters.cliente.trim() ||
      filters.notaNumero.trim() ||
      filters.dataInicio ||
      filters.dataFim ||
      filters.canal ||
      filters.categoriaVendaId ||
      filters.vendedorId ||
      filters.valorMin != null ||
      filters.valorMax != null,
  );

  // Categorias e vendedores para o painel de filtros, carregados uma vez.
  useEffect(() => {
    let ativo = true;
    fetch("/api/tipos/categorias-venda?ativo=true", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return;
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (ativo) {
          setCategorias(items.map((c: any) => ({ value: String(c.id), label: String(c.nome ?? "") })));
        }
      })
      .catch(() => {});
    // Mesma rota que a ficha da venda usa para atribuir vendedor — exige a
    // permissão de Usuários, igual à edição já exige.
    fetch("/api/users?ativos=1", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return;
        const items = Array.isArray(payload.users) ? payload.users : [];
        if (ativo) {
          setVendedores(
            items
              .map((u: any) => ({ value: String(u.id ?? ""), label: String(u.nome ?? u.email ?? "").trim() || "Sem nome" }))
              .filter((u: { value: string }) => u.value),
          );
        }
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  /**
   * Saldo em aberto da venda pela mesma função da OS — ela só tem nome de OS: o
   * cálculo é sobre total comercial + acréscimo financeiro + transações, que a
   * venda também tem. Uma conta só para os dois, como no servidor.
   */
  const saldoDaVenda = (venda: VendaComItens) =>
    calcularResumoFinanceiroOs({
      totalComercial: venda.valortotal,
      acrescimoFinanceiroTipo: venda.acrescimo_financeiro_tipo,
      acrescimoFinanceiroValor: venda.acrescimo_financeiro_valor,
      transacoes: (venda.transacoes ?? []) as never[],
    }).saldoDisponivelParaLancamento;

  const podeSelecionar = (venda: VendaComItens) =>
    ["PAGAMENTO", "ABERTA"].includes(String(venda.status).toUpperCase()) &&
    saldoDaVenda(venda) > 0;

  const documentosSelecionados: DocumentoSelecionavel[] = vendas
    .filter((venda) => selecionadas.has(venda.id))
    .map((venda) => ({
      id: venda.id,
      rotulo: `Venda #${venda.id}`,
      cliente: venda.cliente?.nomerazaosocial ?? null,
      clienteId: venda.cliente?.id ?? null,
      saldo: saldoDaVenda(venda),
    }));

  const selecionaveis = vendas.filter(podeSelecionar);

  const alternarSelecao = (id: number) =>
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  const sairDoModo = () => {
    setModoPagamentoMultiplo(false);
    setSelecionadas(new Set());
  };

  // Trocar de aba ou de página troca a lista debaixo da seleção; manter ids de
  // linhas que sumiram da tela faria o rodapé somar o que ninguém está vendo.
  // Ajuste durante o render, e não em efeito: o efeito só rodaria depois de uma
  // pintura com a seleção velha, e ainda custaria um render a mais.
  const chaveDaLista = `${selectedStatus}|${pagination.page}`;
  const [chaveAnterior, setChaveAnterior] = useState(chaveDaLista);
  if (chaveAnterior !== chaveDaLista) {
    setChaveAnterior(chaveDaLista);
    setSelecionadas(new Set());
  }

  useEffect(() => {
    handleGetVendas(selectedStatus, 1, pagination.limit, search, filters);
  }, [selectedStatus]);
  const config = useConfig();

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle>
              Vendas <span className="text-muted-foreground text-xs font-mono font-extralight">|EM PAGAMENTO</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleGetVendas(selectedStatus, pagination.page, pagination.limit, search, filters)
                }
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
              >
                <Loader2 className="h-3 w-3" />
                Recarregar
              </button>
              {hasActiveFilters && <span>Filtros ativos</span>}
            </CardDescription>
          </div>

          <div className="flex flex-1 items-center justify-center xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
            <div className="inline-flex h-auto items-center justify-center gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setSelectedStatus(vendaStatus.PAGAMENTO)}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === vendaStatus.PAGAMENTO
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
                  }`}
              >
                Abertas
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatus(vendaStatus.FINALIZADA)}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === vendaStatus.FINALIZADA
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
                  }`}
              >
                Concluídas
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={filters.apenasMinhas ? "default" : "ghost"}
              size="sm"
              className="hover:cursor-pointer"
              aria-pressed={Boolean(filters.apenasMinhas)}
              onClick={() => {
                const next = { ...filters, apenasMinhas: !filters.apenasMinhas };
                setFilters(next);
                handleGetVendas(selectedStatus, 1, pagination.limit, search, next);
              }}
            >
              <UserRound className="h-4 w-4" aria-hidden />
              Minhas vendas
            </Button>
            <Button
              variant={modoPagamentoMultiplo ? "secondary" : "ghost"}
              size="sm"
              className="hover:cursor-pointer"
              aria-pressed={modoPagamentoMultiplo}
              onClick={() =>
                modoPagamentoMultiplo ? sairDoModo() : setModoPagamentoMultiplo(true)
              }
            >
              <Split className="h-4 w-4" aria-hidden />
              Pagamento múltiplo
            </Button>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="hover:cursor-pointer"
                onClick={() => {
                  const cleared = { cliente: "", notaNumero: "" };
                  setFilters(cleared);
                  handleGetVendas(selectedStatus, 1, pagination.limit, search, cleared);
                }}
              >
                Limpar filtros
              </Button>
            )}
            <PaymentsFilterSheet
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              filters={filters}
              onFiltersChange={setFilters}
              valorLabel="Valor total (R$)"
              onAplicar={() =>
                handleGetVendas(selectedStatus, 1, pagination.limit, search, filters)
              }
              onLimpar={() => {
                const cleared = { cliente: "", notaNumero: "" };
                setFilters(cleared);
                handleGetVendas(selectedStatus, 1, pagination.limit, search, cleared);
              }}
            >
              <div className="space-y-2">
                <Label>Canal</Label>
                <Select
                  value={filters.canal || "TODOS"}
                  onValueChange={(value) =>
                    setFilters({ ...filters, canal: value === "TODOS" ? undefined : value })
                  }
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos os canais</SelectItem>
                    <SelectItem value="PDV">PDV (balcão)</SelectItem>
                    <SelectItem value="ONLINE">Site próprio</SelectItem>
                    <SelectItem value="MERCADO_LIVRE">Mercado Livre</SelectItem>
                    <SelectItem value="SHOPEE">Shopee</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Categoria da venda</Label>
                <Select
                  value={filters.categoriaVendaId || "TODAS"}
                  onValueChange={(value) =>
                    setFilters({ ...filters, categoriaVendaId: value === "TODAS" ? undefined : value })
                  }
                  disabled={categorias.length === 0}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODAS">Todas as categorias</SelectItem>
                    {categorias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Vendedor</Label>
                <Select
                  value={filters.vendedorId || "TODOS"}
                  onValueChange={(value) =>
                    setFilters({ ...filters, vendedorId: value === "TODOS" ? undefined : value })
                  }
                  disabled={vendedores.length === 0}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Todos os vendedores" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos os vendedores</SelectItem>
                    {vendedores.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </PaymentsFilterSheet>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative flex flex-col justify-between">
        {/* barra superior de loading */}
        <div
          className={`${isLoading && "opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn "
              }`}
          />
        </div>
        <EmissaoNotaDialog
          onOpenChange={setOpenEmissao}
          open={openEmissao}
          vendaId={emissaoId}
        />
        <VendaDetailsDialog
          open={detalhesOpen}
          onOpenChange={(v) => {
            setDetalhesOpen(v);
            if (!v) setDetalhesId(null);
          }}
          vendaId={detalhesId}
          onSaved={() =>
            handleGetVendas(selectedStatus, pagination.page, pagination.limit, search, filters)
          }
        />
        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow className="font-bold">
              {modoPagamentoMultiplo && (
                <TableCell className="w-10">
                  <Checkbox
                    aria-label="Selecionar todas as vendas elegíveis desta página"
                    checked={
                      selecionaveis.length > 0 &&
                      selecionaveis.every((venda) => selecionadas.has(venda.id))
                    }
                    onCheckedChange={(marcado) =>
                      setSelecionadas(
                        marcado ? new Set(selecionaveis.map((venda) => venda.id)) : new Set(),
                      )
                    }
                  />
                </TableCell>
              )}
              <TableCell>ID</TableCell>
              <TableCell>Nota</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell>Data</TableCell>
              <TableCell>Valor Total</TableCell>
              <TableCell>Pago</TableCell>
              <TableCell>Baixa por</TableCell>
              <TableCell>Status</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHeader>

          <TableBody>
            {vendas.length > 0 ? (
              vendas.map((v) => {
                // IDs estáveis por linha para o menu
                const triggerId = `os-row-${v.id}-menu-btn`;
                const menuId = `os-row-${v.id}-menu`;
                const totalFinanceiro = calculateFinancialTotal(
                  v.valortotal,
                  v.acrescimo_financeiro_tipo,
                  v.acrescimo_financeiro_valor,
                );
                const pagamentos = resumirPagamentos(v.transacoes);
                const baixa = resumirBaixas(v.transacoes);

                return (
                  <TableRow key={v.id} className="hover:cursor-pointer">
                    {modoPagamentoMultiplo && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar venda ${v.id}`}
                          checked={selecionadas.has(v.id)}
                          disabled={!podeSelecionar(v)}
                          title={
                            podeSelecionar(v)
                              ? undefined
                              : "Sem saldo em aberto ou status que não aceita pagamento."
                          }
                          onCheckedChange={() => alternarSelecao(v.id)}
                        />
                      </TableCell>
                    )}
                    {/* ... suas outras células (descrição, data etc.) aqui, se/quando tiver ... */}
                    <TableCell>{v.id}</TableCell>
                    <TableCell>{v.notaNumero ?? "-"}</TableCell>
                    <TableCell>{v.cliente.nomerazaosocial}</TableCell>
                    <TableCell>{formatDate(v.datavenda)}</TableCell>
                    <TableCell>{formatarEmReal(totalFinanceiro)}</TableCell>
                    <TableCell className="text-blue-300 not-dark:text-blue-700 font-bold">
                      <TotalPago resumo={pagamentos} />
                    </TableCell>
                    <TableCell
                      className="max-w-[160px] truncate"
                      title={baixa ? baixa.todos.join(", ") : undefined}
                    >
                      {baixa ? (
                        <span>
                          {baixa.nome}
                          {baixa.outros > 0 && (
                            <span className="text-muted-foreground"> +{baixa.outros}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {totalFinanceiro > 0 ? (
                        // Mesma base da coluna "Pago": o bruto dos recebimentos
                        // reais. Antes somava toda transacao ligada a venda,
                        // inclusive despesa, estorno apagado e evento financeiro.
                        pagamentos.bruto < totalFinanceiro ? (
                          <Badge variant="secondary" className="font-bold text-amber-400">
                            Pagamento
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold text-green-400">
                            Faturado
                          </Badge>
                        )
                      ) : (
                        "Venda sem valor"
                      )}
                    </TableCell>

                    <TableCell className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            id={triggerId}
                            aria-controls={menuId}
                            variant="ghost"
                            className="h-8 w-8 p-0 cursor-pointer"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent id={menuId} aria-labelledby={triggerId} className="space-y-1">
                          <DropdownMenuItem
                            onClick={() => {
                              setDetalhesId(v.id);
                              setDetalhesOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                            <span>Detalhes</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                `/print/venda/${v.id}/orcamento`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <Printer className="h-4 w-4" />
                            <span>Imprimir</span>
                          </DropdownMenuItem>
                          <VendasFinancialDialog
                            handleGetVendas={handleGetVendas}
                            open={open}
                            onOpenChange={setOpen}
                            vendaId={v.id}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <DollarSign className="h-4 w-4" />
                              <span>Pagamento</span>
                            </DropdownMenuItem>
                          </VendasFinancialDialog>
                          {
                            config?.habilitar_emissao_nfe &&
                            (config?.emissao_nf_vendas_nao_pagas ? v.status === "PAGAMENTO" ||
                              v.status === "FINALIZADA" : v.status === "FINALIZADA") && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEmissaoId(v.id);
                                  setOpenEmissao(true);
                                }}
                              >
                                <FileText className="h-4 w-4" />
                                <span>Emitir NF</span>
                              </DropdownMenuItem>
                            )
                          }
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell className="text-center h-20" colSpan={99}>
                  Não existem vendas com este status
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>{pagination.limit * (pagination.page - 1) + vendas.length}</span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(selectedStatus, 1, pagination.limit, search, filters)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(selectedStatus, pagination.page - 1, pagination.limit, search, filters)}
              disabled={pagination.page === 1}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <span className="text-xs font-medium text-nowrap">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => handleGetVendas(selectedStatus, pagination.page + 1, pagination.limit, search, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => handleGetVendas(selectedStatus, pagination.totalPages, pagination.limit, search, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Select de itens por página com IDs estáveis */}
          <div>
            <Select>
              <SelectTrigger className="hover:cursor-pointer ml-2" aria-controls={limitListboxId}>
                <SelectValue placeholder={`${pagination.limit}`} />
              </SelectTrigger>
              <SelectContent id={limitListboxId}>
                <SelectItem className="hover:cursor-pointer" value="20">
                  {pagination.limit}
                </SelectItem>
                {/* adicione mais opções se desejar (10/20/50/100...) */}
              </SelectContent>
            </Select>
          </div>
        </div>

        {modoPagamentoMultiplo && (
          <>
            {/* Espaçador: sem ele o rodapé fixo cobre a última linha da tabela. */}
            <div aria-hidden className="h-24" />
            <PagamentoMultiploFooter
              documentos={documentosSelecionados}
              totalNaPagina={selecionaveis.length}
              processando={false}
              onCancelar={sairDoModo}
            >
              <TransactionDialog
                open={dialogPagamentoAberto}
                setOpen={setDialogPagamentoAberto}
                handleGetTransactions={() =>
                  handleGetVendas(selectedStatus, pagination.page, pagination.limit, search, filters)
                }
                pagamentoMultiplo={{
                  tipoDocumento: "VENDA",
                  documentos: documentosSelecionados,
                  onConcluido: sairDoModo,
                }}
              >
                <Button size="sm" className="h-9 hover:cursor-pointer">
                  <Split className="h-4 w-4" aria-hidden />
                  Registrar pagamento ({documentosSelecionados.length})
                </Button>
              </TransactionDialog>
            </PagamentoMultiploFooter>
          </>
        )}
      </CardContent>
    </Card>
  );
}
