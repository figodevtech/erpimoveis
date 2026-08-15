"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Ordem, StatusOS } from "../../../ordens/types";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OsFinancialDialog from "./osFinancialDialog/osFinancialDialog";
import formatarEmReal from "@/utils/formatarEmReal";
import { useEffect, useState } from "react";
import { EmissaoNotaDialog } from "../../../ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { OSDetalhesDialog } from "../../../ordens/components/dialogs/detalhes-os-dialog";
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
import { Split } from "lucide-react";
import TransactionDialog from "../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { PagamentoMultiploFooter } from "../../components/pagamento-multiplo-footer";
import type { DocumentoSelecionavel } from "../../components/pagamento-multiplo";
import { calcularResumoFinanceiroOs, podeRegistrarPagamentoOs } from "@/lib/ordens/financeiro";

interface OsTableProps {
  ordens: Ordem[];
  pagination: Pagination;
  handleGetOrdens: (
    status: StatusOS,
    pageNumber?: number,
    limit?: number,
    search?: string,
    filters?: PaymentListFilters,
  ) => void;
  isLoading: boolean;
  search: string;
}

function alvoDoReparo(ordem: Ordem) {
  if (ordem.alvo_tipo === "PECA") {
    return {
      tipo: "Peça",
      titulo: ordem.peca?.titulo || "Peça não informada",
      detalhe: ordem.peca?.descricao || ordem.peca?.lacre || null,
    };
  }

  if (ordem.alvo_tipo === "EQUIPAMENTO") {
    const detalhes = [
      ordem.equipamento?.patrimonio
        ? `Patrimônio ${ordem.equipamento.patrimonio}`
        : null,
      ordem.equipamento?.ano ? `Ano ${ordem.equipamento.ano}` : null,
      ordem.equipamento?.horimetro != null
        ? `${ordem.equipamento.horimetro}h`
        : null,
    ].filter(Boolean);

    return {
      tipo: "Equipamento",
      titulo: ordem.equipamento?.nome || "Equipamento não informado",
      detalhe: detalhes.join(" · ") || null,
    };
  }

  const veiculo = ordem.veiculo;
  const tituloVeiculo = [veiculo?.marca, veiculo?.modelo]
    .filter(Boolean)
    .join(" ");

  return {
    tipo: "Veículo",
    titulo: tituloVeiculo || "Veículo não informado",
    detalhe: veiculo?.placa || null,
  };
}

export default function OsTable({ ordens, pagination, handleGetOrdens, isLoading, search }: OsTableProps) {
  // ID estável para o Select de "itens por página"
  const [selectedStatus, setSelectedStatus] = useState<StatusOS>("PAGAMENTO");
  const limitUid = React.useId();
  const [openEmissao, setOpenEmissao] = useState(false);
  const [emissaoId, setEmissaoId] = useState<number | undefined>(undefined);
  const [detalhesOpen, setDetalhesOpen] = useState(false);
  const [detalhesId, setDetalhesId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<PaymentListFilters>({
    cliente: "",
    notaNumero: "",
  });
  const limitListboxId = `${limitUid}-os-limit-listbox`;
  const [modoPagamentoMultiplo, setModoPagamentoMultiplo] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogPagamentoAberto, setDialogPagamentoAberto] = useState(false);
  const hasActiveFilters = Boolean(
    filters.cliente.trim() ||
      filters.notaNumero.trim() ||
      filters.dataInicio ||
      filters.dataFim,
  );

  /**
   * Saldo em aberto de cada OS pela MESMA função que o servidor usa — total menos
   * o que já foi recebido e o que está comprometido em título pendente. Calcular
   * "total menos pago" aqui ofereceria cobrar de novo o que já tem boleto emitido.
   */
  const saldoDaOrdem = (ordem: Ordem) =>
    calcularResumoFinanceiroOs({
      totalComercial: ordem.orcamentototal,
      acrescimoFinanceiroTipo: ordem.acrescimo_financeiro_tipo,
      acrescimoFinanceiroValor: ordem.acrescimo_financeiro_valor,
      transacoes: (ordem.transacoes ?? []) as never[],
    }).saldoDisponivelParaLancamento;

  const podeSelecionar = (ordem: Ordem) =>
    podeRegistrarPagamentoOs(ordem.status) && saldoDaOrdem(ordem) > 0;

  const documentosSelecionados: DocumentoSelecionavel[] = ordens
    .filter((ordem) => selecionadas.has(ordem.id))
    .map((ordem) => ({
      id: ordem.id,
      rotulo: `OS #${ordem.id}`,
      cliente: ordem.cliente?.nome ?? null,
      clienteId: ordem.cliente?.id ?? null,
      saldo: saldoDaOrdem(ordem),
    }));

  const selecionaveis = ordens.filter(podeSelecionar);

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
    handleGetOrdens(selectedStatus, 1, pagination.limit, search, filters);
  }, [selectedStatus]);

  const config = useConfig();

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle>
              Ordens de Serviço{" "}
              <span className="text-muted-foreground text-xs font-mono font-extralight">|EM PAGAMENTO</span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleGetOrdens(selectedStatus, pagination.page, pagination.limit, search, filters)
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
                onClick={() => setSelectedStatus("PAGAMENTO")}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === "PAGAMENTO"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
                  }`}
              >
                Abertas
              </button>
              <button
                type="button"
                onClick={() => setSelectedStatus("CONCLUIDO")}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${selectedStatus === "CONCLUIDO"
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
                  handleGetOrdens(selectedStatus, 1, pagination.limit, search, cleared);
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
              onAplicar={() =>
                handleGetOrdens(selectedStatus, 1, pagination.limit, search, filters)
              }
              onLimpar={() => {
                const cleared = { cliente: "", notaNumero: "" };
                setFilters(cleared);
                handleGetOrdens(selectedStatus, 1, pagination.limit, search, cleared);
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative flex flex-col justify-between">
        <EmissaoNotaDialog
          onOpenChange={setOpenEmissao}
          open={openEmissao}
          osId={emissaoId}
        />
        <OSDetalhesDialog
          open={detalhesOpen}
          onOpenChange={(v) => {
            setDetalhesOpen(v);
            if (!v) {
              setDetalhesId(null);
              // O dialog permite lancar eventos financeiros, que alteram o total da linha.
              handleGetOrdens(selectedStatus, pagination.page, pagination.limit, search, filters);
            }
          }}
          osId={detalhesId ?? 0}
        />
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

        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow>
              {modoPagamentoMultiplo && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Selecionar todas as ordens elegíveis desta página"
                    checked={
                      selecionaveis.length > 0 &&
                      selecionaveis.every((ordem) => selecionadas.has(ordem.id))
                    }
                    onCheckedChange={(marcado) =>
                      setSelecionadas(
                        marcado ? new Set(selecionaveis.map((ordem) => ordem.id)) : new Set(),
                      )
                    }
                  />
                </TableHead>
              )}
              <TableHead className="whitespace-nowrap">ID</TableHead>
              <TableHead className="whitespace-nowrap">Nota</TableHead>
              <TableHead>Alvo do reparo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead className="whitespace-nowrap">Pago</TableHead>
              <TableHead className="whitespace-nowrap">Baixa por</TableHead>
              <TableHead className="whitespace-nowrap">Total</TableHead>
              <TableHead className="text-center">Situação</TableHead>
              <TableHead className="text-right whitespace-nowrap w-[90px]">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {ordens.length > 0 ? (
              ordens.map((o) => {
                // IDs estáveis por linha para o menu
                const triggerId = `os-row-${o.id}-menu-btn`;
                const menuId = `os-row-${o.id}-menu`;
                const totalFinanceiro = calculateFinancialTotal(
                  o.orcamentototal,
                  o.acrescimo_financeiro_tipo,
                  o.acrescimo_financeiro_valor,
                );
                const pagamentos = resumirPagamentos(o.transacoes);
                // A situacao continua no bruto: e ele que quita a OS, a taxa de
                // recebimento e custo nosso, nao saldo devedor do cliente.
                const totalPago = pagamentos.bruto;
                const baixa = resumirBaixas(o.transacoes);
                const alvo = alvoDoReparo(o);

                return (
                  <TableRow key={o.id} className="hover:cursor-pointer">
                    {modoPagamentoMultiplo && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar OS ${o.id}`}
                          checked={selecionadas.has(o.id)}
                          disabled={!podeSelecionar(o)}
                          title={
                            podeSelecionar(o)
                              ? undefined
                              : "Sem saldo em aberto ou status que não aceita pagamento."
                          }
                          onCheckedChange={() => alternarSelecao(o.id)}
                        />
                      </TableCell>
                    )}
                    {/* ... suas outras células (descrição, data etc.) aqui, se/quando tiver ... */}
                    <TableCell>{o.id}</TableCell>
                    <TableCell>{o.notaNumero ?? "-"}</TableCell>
                    <TableCell className="max-w-[320px]">
                      <div className="min-w-0" title={[alvo.titulo, alvo.detalhe].filter(Boolean).join(" · ")}>
                        <p className="truncate font-medium text-foreground">
                          {alvo.titulo}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                          {alvo.tipo}
                          {alvo.detalhe ? ` · ${alvo.detalhe}` : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{o.cliente?.nome}</TableCell>
                    <TableCell>{o.setor?.nome}</TableCell>
                    <TableCell className=" text-blue-300 not-dark:text-blue-700 font-bold">
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
                    <TableCell>{formatarEmReal(totalFinanceiro)}</TableCell>
                    <TableCell className="text-center">
                      {totalFinanceiro ? (
                        totalPago < totalFinanceiro ? (
                          <Badge variant="secondary" className="font-bold text-amber-400">Pagamento</Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold text-green-400">Faturado</Badge>
                        )
                      ) : (
                        "Orçamento falta valor"
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap w-[90px]">
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

                        <DropdownMenuContent id={menuId} aria-labelledby={triggerId} className="space-y-1" align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setDetalhesId(o.id);
                              setDetalhesOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                            <span>Detalhes</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                `/print/ordemservico/${o.id}`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <Printer className="h-4 w-4" />
                            <span>Imprimir</span>
                          </DropdownMenuItem>
                          <OsFinancialDialog handleGetOrdens={handleGetOrdens} osId={o.id}>
                            <DropdownMenuItem disabled={o.orcamentototal <= 0} onSelect={(e) => e.preventDefault()}>
                              <DollarSign className="h-4 w-4" />
                              <span>Pagamento</span>
                            </DropdownMenuItem>
                          </OsFinancialDialog>
                          {
                            config?.habilitar_emissao_nfe &&
                            (config?.emissao_nf_ordens_nao_pagas ? o.status === "PAGAMENTO" ||
                              o.status === "CONCLUIDO" : o.status === "CONCLUIDO") && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEmissaoId(o.id);
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
                  Não existem ordens com este status
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>{pagination.limit * (pagination.page - 1) + ordens.length}</span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetOrdens(selectedStatus, 1, pagination.limit, search, filters)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetOrdens(selectedStatus, pagination.page - 1, pagination.limit, search, filters)}
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
              onClick={() => handleGetOrdens(selectedStatus, pagination.page + 1, pagination.limit, search, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => handleGetOrdens(selectedStatus, pagination.totalPages, pagination.limit, search, filters)}
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
                  handleGetOrdens(selectedStatus, pagination.page, pagination.limit, search, filters)
                }
                pagamentoMultiplo={{
                  tipoDocumento: "OS",
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
