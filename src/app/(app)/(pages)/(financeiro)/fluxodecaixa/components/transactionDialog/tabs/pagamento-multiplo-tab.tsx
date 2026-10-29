"use client";

import Link from "next/link";
import { ExternalLink, FileText, ShoppingCart, Split, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";

import { Campo, Cartao, EstadoVazio, fmtDate } from "./shared";
import type { PagamentoMultiploContexto } from "./types";

/**
 * O que este lançamento quitou.
 *
 * Uma transação de pagamento múltiplo é uma movimentação de dinheiro só, que
 * cobre vários documentos — ela não aponta para nenhum deles, e por isso a
 * pergunta "que OS esse recebimento baixou?" não tem resposta na própria linha.
 * A resposta está no rateio, e é ela que esta aba mostra.
 */
export function PagamentoMultiploTab({
  pagamento,
}: {
  pagamento: PagamentoMultiploContexto | null;
}) {
  if (!pagamento) {
    return <EstadoVazio>Esta transação não faz parte de um pagamento múltiplo.</EstadoVazio>;
  }

  const ehOS = pagamento.tipoDocumento === "OS";
  const parcelado = pagamento.modo.toUpperCase() === "PARCELADO";
  const quantidade = pagamento.documentos.length;
  const substantivo = ehOS
    ? `ordem${quantidade === 1 ? "" : "ns"} de serviço`
    : `venda${quantidade === 1 ? "" : "s"}`;

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Esta transação faz parte do <strong>pagamento múltiplo #{pagamento.id}</strong>, de{" "}
          {formatarEmReal(pagamento.valorTotal)}
          {parcelado ? ` em ${pagamento.parcelas} parcelas` : ""}. Ela quitou{" "}
          {quantidade} {substantivo} de uma vez — por isso não aparece ligada a um documento
          só. Excluí-la desfaz o pagamento inteiro.
        </span>
      </p>

      <Cartao titulo={`Pagamento múltiplo #${pagamento.id}`} icone={<Split className="h-3.5 w-3.5" />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="Valor do pagamento">{formatarEmReal(pagamento.valorTotal)}</Campo>
          <Campo label="Forma">{parcelado ? `Parcelado em ${pagamento.parcelas}x` : "À vista"}</Campo>
          <Campo label="Data">{fmtDate(pagamento.data)}</Campo>
        </div>
      </Cartao>

      <Cartao
        titulo={
          parcelado
            ? `O que esta parcela abate (${formatarEmReal(pagamento.valorDesteLancamento)})`
            : `Documentos quitados (${formatarEmReal(pagamento.valorDesteLancamento)})`
        }
        icone={ehOS ? <FileText className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
      >
        {quantidade === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum documento vinculado a este lançamento.
          </p>
        ) : (
          <ul className="divide-y">
            {pagamento.documentos.map((documento) => (
              <li
                key={`${documento.tipo}-${documento.id}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm font-medium">
                  {documento.tipo === "OS" ? "OS" : "Venda"} #{documento.id}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatarEmReal(documento.valor)}
                  </span>
                  {documento.href ? (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={documento.href} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Abrir
                      </Link>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          A divisão foi proporcional ao que cada documento devia no momento do
          recebimento. A soma das fatias fecha exatamente com o valor
          {parcelado ? " desta parcela." : " do pagamento."}
        </p>
      </Cartao>
    </div>
  );
}
