"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DESTINO_MERCADORIA_OPCOES,
  indFinalDoDestino,
  type DestinoMercadoria,
} from "@/lib/nfe/destinoMercadoria";

type Props = {
  destino: DestinoMercadoria | "";
  consumidorFinal: boolean | null;
  onChange: (next: { destino: DestinoMercadoria | ""; consumidorFinal: boolean | null }) => void;
  /** indIEDest 9: revenda não se aplica, ele é sempre consumidor final. */
  naoContribuinte?: boolean;
  /** Aviso extra quando a escolha recalcula o DIFAL dos itens. */
  alertaDifal?: boolean;
};

/**
 * Destino da mercadoria no destinatário. É dele que sai o indFinal da NF-e —
 * a origem (venda, OS, saída) e o cadastro do cliente não dizem se ele vai
 * revender ou consumir, então a escolha é obrigatória e não vem preenchida.
 */
export function DestinoMercadoriaField({ destino, consumidorFinal, onChange, naoContribuinte, alertaDifal }: Props) {
  const indFinal = indFinalDoDestino(destino, consumidorFinal);
  const revendaBloqueada = Boolean(naoContribuinte);

  return (
    <div className="min-w-0 space-y-1.5">
      <Label>
        Destino da mercadoria <span className="text-destructive">*</span>
      </Label>
      {alertaDifal ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Esta operação exige DIFAL. Alterar o destino recalcula a seção de partilha nos itens.
        </p>
      ) : null}
      <Select
        value={destino || undefined}
        onValueChange={(value) =>
          onChange({ destino: value as DestinoMercadoria, consumidorFinal: value === "OUTRO" ? consumidorFinal : null })
        }
      >
        <SelectTrigger className="w-full" aria-invalid={!destino}>
          <SelectValue placeholder="Selecione o que o destinatário fará com a mercadoria" />
        </SelectTrigger>
        <SelectContent className="w-[calc(100vw-2rem)] max-w-[34rem]">
          {DESTINO_MERCADORIA_OPCOES.map((opcao) => {
            const desabilitada = revendaBloqueada && opcao.indFinal === 0;
            return (
              <SelectItem
                key={opcao.value}
                value={opcao.value}
                disabled={desabilitada}
                className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]"
              >
                {opcao.label}
                {desabilitada ? " — não se aplica a não contribuinte" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {destino === "OUTRO" ? (
        <Select
          value={consumidorFinal === null ? undefined : consumidorFinal ? "SIM" : "NAO"}
          onValueChange={(value) => onChange({ destino, consumidorFinal: value === "SIM" })}
        >
          <SelectTrigger className="w-full" aria-invalid={consumidorFinal === null}>
            <SelectValue placeholder="É operação com consumidor final?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SIM">Sim, consumidor final (indFinal 1)</SelectItem>
            <SelectItem value="NAO" disabled={revendaBloqueada}>
              Não (indFinal 0){revendaBloqueada ? " — não se aplica a não contribuinte" : ""}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {indFinal === null
          ? "Obrigatório: o ERP não presume consumidor final pelo tipo de venda nem pelo cadastro do cliente."
          : `A NF-e sairá com indFinal ${indFinal} (${indFinal === 1 ? "consumidor final" : "não é consumidor final"}).`}
      </p>
    </div>
  );
}
