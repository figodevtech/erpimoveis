"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Package, Trash2 } from "lucide-react";
import type { ItemProduto } from "../tipos";
import { CampoQuantidade } from "./campo-quantidade";
import { CampoPreco } from "./campo-preco";
import { CampoDesconto } from "./campo-desconto";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IdentificadoresItem } from "./identificadores-item";

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  itens: ItemProduto[];
  onAtualizar: (index: number, patch: Partial<ItemProduto>) => void;
  onRemover: (index: number) => void;
  errosEstoque?: Record<number, { disponivel: number; solicitado: number }>;
};

export function TabelaItensProduto({ itens, onAtualizar, onRemover, errosEstoque }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <Package className="size-4" />
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-semibold">Produtos</Label>
            <p className="truncate text-xs text-muted-foreground">
              Peças e materiais cadastrados no estoque
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
          {itens.length} {itens.length === 1 ? "item" : "itens"}
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <Table className="min-w-[980px]">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="min-w-[280px]">Produto</TableHead>
              <TableHead className="w-28 text-center">Quantidade</TableHead>
              <TableHead className="w-36 text-right">Preço unit.</TableHead>
              <TableHead className="min-w-[240px]">Desconto</TableHead>
              <TableHead className="w-32 text-right">Subtotal</TableHead>
              <TableHead className="w-14 text-center">Ação</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {itens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Package className="size-6 opacity-40" />
                    <span className="text-sm">Nenhum produto adicionado.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              itens.map((it, i) => {
                const falta = errosEstoque?.[it.produtoid];

                return (
                  <TableRow
                    key={`${it.produtoid}-${i}`}
                    className={falta ? "bg-destructive/5" : "transition-colors hover:bg-muted/20"}
                    title={falta ? `Disponível: ${falta.disponivel} • Solicitado: ${falta.solicitado}` : undefined}
                  >
                    <TableCell className="max-w-[360px] py-3 pr-4 align-top">
                      <div className="space-y-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          {falta && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block max-w-[300px] truncate text-sm font-semibold">
                                  {it.descricao}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs text-xs">
                                {it.descricao}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>

                        <IdentificadoresItem
                          id={it.produtoid}
                          referencia={it.referencia}
                          etiqueta={it.etiqueta}
                        />
                      </div>

                      {falta && (
                        <div className="mt-1 text-xs text-destructive">
                          Estoque insuficiente — disponível: <b>{falta.disponivel}</b>, solicitado:{" "}
                          <b>{falta.solicitado}</b>.
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <CampoQuantidade
                        value={it.quantidade}
                        onChange={(n) =>
                          onAtualizar(i, {
                            quantidade: n,
                            subtotal: Number((n * it.precounitario).toFixed(2)),
                          })
                        }
                        min={0}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <CampoPreco
                        value={it.precounitario}
                        onChange={(n) =>
                          onAtualizar(i, {
                            precounitario: n,
                            subtotal: Number((n * it.quantidade).toFixed(2)),
                          })
                        }
                      />
                    </TableCell>

                    <TableCell className="min-w-[240px]">
                      <CampoDesconto
                        tipo={it.descontoTipo}
                        valor={it.desconto}
                        onTipoChange={(descontoTipo) =>
                          onAtualizar(i, {
                            descontoTipo,
                            desconto: descontoTipo ? it.desconto ?? 0 : 0,
                          })
                        }
                        onValorChange={(desconto) => onAtualizar(i, { desconto })}
                      />
                    </TableCell>

                    <TableCell className="text-right tabular-nums">{money(it.subtotal)}</TableCell>

                    <TableCell className="text-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemover(i)}
                        title="Remover produto"
                        aria-label={`Remover ${it.descricao}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
