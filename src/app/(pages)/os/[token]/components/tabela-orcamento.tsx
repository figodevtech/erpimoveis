"use client";

import type { LucideIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, percent, type LinhaOrcamento } from "./tipos";

/**
 * Tabela de itens do orçamento. A coluna de desconto só aparece quando algum item
 * tem desconto — sem ela, o cliente veria "2 x R$ 100" fechando em R$ 180 e o
 * detalhamento pareceria errado.
 */
export function TabelaOrcamento({
  titulo,
  icone: Icone,
  vazio,
  itens,
}: {
  titulo: string;
  icone: LucideIcon;
  vazio: string;
  itens: LinhaOrcamento[];
}) {
  const temDesconto = itens.some((item) => (item.descontoAplicado ?? 0) > 0);
  const colunas = temDesconto ? 5 : 4;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icone className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">{titulo}</h3>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Descrição</TableHead>
              <TableHead className="text-center">Qtd</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              {temDesconto ? <TableHead className="text-right">Desconto</TableHead> : null}
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colunas} className="text-center text-sm text-muted-foreground py-6">
                  {vazio}
                </TableCell>
              </TableRow>
            ) : (
              itens.map((item, i) => (
                <TableRow key={i}>
                  <TableCell className="pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{item.descricao}</span>
                      {item.avulso ? (
                        <span className="rounded-sm border border-amber-600/40 bg-amber-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          Avulso
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{item.quantidade}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(item.precounitario)}</TableCell>
                  {temDesconto ? (
                    <TableCell className="text-right tabular-nums">
                      {(item.descontoAplicado ?? 0) > 0 ? (
                        <>
                          <div className="text-emerald-600 dark:text-emerald-400">
                            - {money(item.descontoAplicado)}
                          </div>
                          {item.descontoTipo === "PORCENTAGEM" ? (
                            <div className="text-[11px] text-muted-foreground">{percent(item.desconto)}%</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">{money(item.subtotal)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
