"use client";

import { Trash2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemServico } from "../tipos";
import { CampoPreco } from "./campo-preco";
import { CampoQuantidade } from "./campo-quantidade";
import { CampoDesconto } from "./campo-desconto";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IdentificadoresItem } from "./identificadores-item";
import { tituloServicoDaOs } from "@/lib/ordens/titulo-servico";

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// O nome do cadastro com o texto livre da linha — o mesmo título que o evento
// financeiro publica, para a OS e o financeiro nomearem o serviço igual.
const tituloDoItem = (it: ItemServico) =>
  tituloServicoDaOs(it.descricao, it.descricaoServico, it.servicoid);

export function TabelaItensServico({
  itens,
  onAtualizar,
  onRemover,
}: {
  itens: ItemServico[];
  onAtualizar: (index: number, patch: Partial<ItemServico>) => void;
  onRemover: (index: number) => void;
}) {
  const atualizarQuantidade = (index: number, item: ItemServico, quantidade: number) =>
    onAtualizar(index, {
      quantidade,
      subtotal: Number((quantidade * item.precounitario).toFixed(2)),
    });

  const atualizarPreco = (index: number, item: ItemServico, precounitario: number) =>
    onAtualizar(index, {
      precounitario,
      subtotal: Number((precounitario * item.quantidade).toFixed(2)),
    });

  const atualizarTipoDesconto = (
    index: number,
    item: ItemServico,
    descontoTipo: ItemServico["descontoTipo"],
  ) =>
    onAtualizar(index, {
      descontoTipo,
      desconto: descontoTipo ? item.desconto ?? 0 : 0,
    });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <Wrench className="size-4" />
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-semibold">Serviços</Label>
            <p className="truncate text-xs text-muted-foreground">
              Mão de obra e atividades do orçamento
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
        </Badge>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {itens.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Wrench className="size-6 opacity-40" />
            <span className="text-sm">Nenhum serviço adicionado.</span>
          </div>
        ) : (
          <>
            <div className="divide-y lg:hidden">
              {itens.map((it, i) => (
                <article key={`${it.servicoid}-${i}`} className="space-y-3 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <p className="break-words text-sm font-semibold">{tituloDoItem(it)}</p>
                      <IdentificadoresItem id={it.servicoid} referencia={it.referencia} />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemover(i)}
                      title="Remover serviço"
                      aria-label={`Remover ${tituloDoItem(it)}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <Input
                    value={it.descricaoServico ?? ""}
                    onChange={(event) =>
                      onAtualizar(i, {
                        descricaoServico: event.target.value.trim() ? event.target.value : null,
                      })
                    }
                    placeholder="Descrição do serviço (opcional)"
                    className="h-8 w-full bg-background/70 text-xs"
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Quantidade
                      </span>
                      <CampoQuantidade
                        value={it.quantidade}
                        onChange={(quantidade) => atualizarQuantidade(i, it, quantidade)}
                        min={0}
                        compact
                        className="justify-start"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Preço unit.
                      </span>
                      <CampoPreco
                        value={it.precounitario}
                        onChange={(preco) => atualizarPreco(i, it, preco)}
                        className="h-8 w-full min-w-0 text-right tabular-nums"
                      />
                    </div>
                    <div className="col-span-2 min-w-0 space-y-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Desconto
                      </span>
                      <CampoDesconto
                        tipo={it.descontoTipo}
                        valor={it.desconto}
                        onTipoChange={(tipo) => atualizarTipoDesconto(i, it, tipo)}
                        onValorChange={(desconto) => onAtualizar(i, { desconto })}
                        className="grid min-w-0 grid-cols-2 gap-2"
                        selectClassName="h-8 w-full"
                        inputClassName="h-8 w-full min-w-0"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <strong className="tabular-nums">{money(it.subtotal)}</strong>
                  </div>
                </article>
              ))}
            </div>

            <Table className="hidden w-full table-fixed lg:table">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-[31%] px-2">Serviço</TableHead>
                  <TableHead className="w-[14%] px-2 text-center">Qtd.</TableHead>
                  <TableHead className="w-[13%] px-2 text-right">Preço</TableHead>
                  <TableHead className="w-[24%] px-2">Desconto</TableHead>
                  <TableHead className="w-[12%] px-2 text-right">Subtotal</TableHead>
                  <TableHead className="w-[6%] px-2 text-center">Ação</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {itens.map((it, i) => (
                  <TableRow
                    key={`${it.servicoid}-${i}`}
                    className="transition-colors hover:bg-muted/20"
                  >
                    <TableCell className="min-w-0 overflow-hidden px-2 py-3 align-top">
                      <div className="min-w-0 space-y-2">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="w-full truncate text-sm font-semibold">{tituloDoItem(it)}</p>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs text-xs">
                              {tituloDoItem(it)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <IdentificadoresItem id={it.servicoid} referencia={it.referencia} />

                        <Input
                          value={it.descricaoServico ?? ""}
                          onChange={(event) =>
                            onAtualizar(i, {
                              descricaoServico: event.target.value.trim()
                                ? event.target.value
                                : null,
                            })
                          }
                          placeholder="Descrição opcional"
                          className="h-8 w-full min-w-0 bg-background/70 px-2 text-xs"
                        />
                      </div>
                    </TableCell>

                    <TableCell className="px-2 text-center">
                      <CampoQuantidade
                        value={it.quantidade}
                        onChange={(quantidade) => atualizarQuantidade(i, it, quantidade)}
                        min={0}
                        compact
                      />
                    </TableCell>

                    <TableCell className="px-2 text-right">
                      <CampoPreco
                        value={it.precounitario}
                        onChange={(preco) => atualizarPreco(i, it, preco)}
                        className="h-8 w-full min-w-0 px-2 text-right tabular-nums"
                      />
                    </TableCell>

                    <TableCell className="min-w-0 px-2">
                      <CampoDesconto
                        tipo={it.descontoTipo}
                        valor={it.desconto}
                        onTipoChange={(tipo) => atualizarTipoDesconto(i, it, tipo)}
                        onValorChange={(desconto) => onAtualizar(i, { desconto })}
                        className="grid min-w-0 grid-cols-2 gap-1.5"
                        selectClassName="h-8 w-full px-2 text-xs"
                        inputClassName="h-8 w-full min-w-0 px-2 text-xs"
                      />
                    </TableCell>

                    <TableCell className="whitespace-nowrap px-2 text-right text-xs tabular-nums">
                      {money(it.subtotal)}
                    </TableCell>

                    <TableCell className="px-2 text-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemover(i)}
                        title="Remover serviço"
                        aria-label={`Remover ${tituloDoItem(it)}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </section>
  );
}
