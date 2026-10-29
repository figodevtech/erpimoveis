"use client";

import Link from "next/link";
import { Car, ExternalLink, FileText, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";

import { Campo, Cartao, EstadoVazio, fmtDate, fmtText } from "./shared";
import type { VinculoContexto } from "./types";

export function VinculoTab({ vinculo }: { vinculo: VinculoContexto | null }) {
  if (!vinculo) {
    return (
      <EstadoVazio>
        Transação avulsa: não nasceu de uma ordem de serviço nem de uma venda.
      </EstadoVazio>
    );
  }

  const ehOS = vinculo.tipo === "OS";

  return (
    <Cartao
      titulo={ehOS ? `Ordem de serviço #${vinculo.id}` : `Venda #${vinculo.id}`}
      icone={
        ehOS ? <FileText className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />
      }
      acao={
        vinculo.href ? (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={vinculo.href} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-3 w-3" />
              Abrir documento
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Status">
          <Badge variant="outline" className="text-[10px]">
            {fmtText(vinculo.status)}
          </Badge>
        </Campo>
        <Campo label="Valor total">{formatarEmReal(vinculo.total)}</Campo>

        {ehOS ? (
          <>
            <Campo label="Entrada">{fmtDate(vinculo.dataentrada)}</Campo>
            <Campo label="Saída">{fmtDate(vinculo.datasaida)}</Campo>
            {vinculo.veiculo && (vinculo.veiculo.nome || vinculo.veiculo.placa) && (
              <div className="sm:col-span-2">
                <Campo label="Veículo">
                  <span className="flex items-center gap-2">
                    <Car className="h-3.5 w-3.5 text-muted-foreground" />
                    {fmtText(vinculo.veiculo.nome)}
                    {vinculo.veiculo.placa && (
                      <Badge variant="outline" className="text-[10px]">
                        {vinculo.veiculo.placa}
                      </Badge>
                    )}
                  </span>
                </Campo>
              </div>
            )}
            {vinculo.descricao && (
              <div className="sm:col-span-2">
                <Campo label="Descrição da OS">
                  <span className="whitespace-pre-wrap font-normal text-muted-foreground">
                    {vinculo.descricao}
                  </span>
                </Campo>
              </div>
            )}
          </>
        ) : (
          <Campo label="Data da venda">{fmtDate(vinculo.datavenda)}</Campo>
        )}
      </div>
    </Cartao>
  );
}
