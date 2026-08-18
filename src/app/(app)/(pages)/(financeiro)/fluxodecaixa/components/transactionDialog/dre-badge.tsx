"use client";

import { PieChart } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import formatarEmReal from "@/utils/formatarEmReal";

import { TransactionBadge } from "./transaction-dialog-ui";
import type { TransacaoContexto } from "./tabs/types";

/**
 * Diz que a transação aparece na DRE — e, no hover, COMO ela aparece.
 *
 * O caso que justifica o componente: um recebimento único que baixou três OS.
 * Na DRE não existe nenhum lançamento com o valor daquela transação; existem a
 * receita e o custo de cada OS, cada um na competência do seu documento. Sem
 * essa explicação, quem procura os R$ 8.500 no relatório não acha e conclui que
 * o sistema perdeu o dinheiro.
 *
 * Por isso o texto muda com o papel:
 *
 *   DIRETO     a transação é o fato — o valor dela é o valor na linha.
 *   DOCUMENTO  a transação só liquida documento — o que entra são os
 *              lançamentos dele, agrupados por documento.
 *
 * Sem linha nenhuma o badge não aparece: transferência, saque, compra que vira
 * estoque e lançamento sem classificação não tocam a DRE, e inventar um badge
 * para eles diria o contrário.
 */
export function DreBadge({ dre }: { dre: TransacaoContexto["dre"] | undefined }) {
  if (!dre || dre.linhas.length === 0) return null;

  const porDocumento = new Map<string, typeof dre.linhas>();
  for (const linha of dre.linhas) {
    const chave = `${linha.documentoTipo ?? ""}#${linha.documentoId ?? ""}`;
    porDocumento.set(chave, [...(porDocumento.get(chave) ?? []), linha]);
  }
  const documentos = dre.papel === "DOCUMENTO" ? porDocumento.size : 0;

  // Cada documento rende de 1 a 5 linhas. Um pagamento que baixou dez OS
  // encheria a tela; o tooltip mostra os primeiros e conta o resto. A aba
  // Pagamento múltiplo já lista todos os documentos com o rateio de cada um.
  const LIMITE = 4;
  const visiveis = [...porDocumento.values()].slice(0, LIMITE);
  const ocultos = porDocumento.size - visiveis.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // O badge é só informativo, mas precisa receber foco: sem isso o
          // tooltip fica inalcançável por teclado e a explicação — que é a razão
          // de o badge existir — some para quem não usa mouse.
          className="cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          aria-label="Como este lançamento aparece na DRE"
        >
          <TransactionBadge tone="warning">
            <PieChart className="mr-1 size-3" aria-hidden />
            DRE
          </TransactionBadge>
        </button>
      </TooltipTrigger>

      <TooltipContent side="bottom" align="start" className="max-w-[330px] text-pretty">
        {dre.papel === "DOCUMENTO" ? (
          <div className="space-y-1.5">
            <p>
              Esta transação é a baixa de {documentos}{" "}
              {documentos === 1 ? "documento" : "documentos"}. O valor dela não entra na DRE — entram
              os lançamentos de cada um, na competência deles:
            </p>
            {visiveis.map((linhas) => (
              <div key={`${linhas[0].documentoTipo}${linhas[0].documentoId}`}>
                <p className="font-medium">
                  {linhas[0].documentoTipo === "OS" ? "OS" : "Venda"} #{linhas[0].documentoId}
                </p>
                {linhas.map((linha) => (
                  <p key={linha.codigo} className="pl-3 tabular-nums">
                    {linha.codigo} {linha.nome} · {formatarEmReal(linha.valor)}
                  </p>
                ))}
              </div>
            ))}
            {ocultos > 0 ? (
              <p className="text-muted-foreground">
                e mais {ocultos} {ocultos === 1 ? "documento" : "documentos"}.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <p>Este lançamento entra na DRE em:</p>
            {dre.linhas.map((linha) => (
              <p key={linha.codigo} className="pl-3 tabular-nums font-medium">
                {linha.codigo} {linha.nome} · {formatarEmReal(linha.valor)}
              </p>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
