"use client";

import { useId } from "react";

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
  /** Identifica o padrão aplicado somente a novas emissões de Venda/OS. */
  destacarUsoConsumoComoPadrao?: boolean;
};

/**
 * Destino da mercadoria no destinatário. É dele que sai o indFinal da NF-e.
 * Venda/OS podem abrir com um padrão operacional, mas a decisão permanece
 * destacada e editável porque o cadastro do cliente não define a finalidade.
 */
export function DestinoMercadoriaField({
  destino,
  consumidorFinal,
  onChange,
  naoContribuinte,
  alertaDifal,
  destacarUsoConsumoComoPadrao = false,
}: Props) {
  const campoId = useId();
  const ajudaId = `${campoId}-ajuda`;
  const indFinal = indFinalDoDestino(destino, consumidorFinal);
  const revendaBloqueada = Boolean(naoContribuinte);
  const opcaoSelecionada = DESTINO_MERCADORIA_OPCOES.find((opcao) => opcao.value === destino);
  const resumoDestino = indFinal === null
    ? "Obrigatório: o ERP não presume consumidor final pelo tipo de venda nem pelo cadastro do cliente."
    : destino === "OUTRO"
      ? `Definição manual: indFinal = ${indFinal} (${indFinal === 1 ? "consumidor final" : "não é consumidor final"}).`
      : opcaoSelecionada?.descricao;

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={campoId}>
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
        <SelectTrigger
          id={campoId}
          className="w-full"
          aria-describedby={ajudaId}
          aria-invalid={!destino}
        >
          <SelectValue placeholder="Selecione o que o destinatário fará com a mercadoria">
            {opcaoSelecionada?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[calc(100vw-2rem)] max-w-[38rem]">
          {DESTINO_MERCADORIA_OPCOES.map((opcao) => {
            const desabilitada = revendaBloqueada && opcao.indFinal === 0;
            return (
              <SelectItem
                key={opcao.value}
                value={opcao.value}
                textValue={opcao.label}
                disabled={desabilitada}
                className="items-start break-words whitespace-normal py-2.5 [overflow-wrap:anywhere]"
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5 pr-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                    {opcao.label}
                    {destacarUsoConsumoComoPadrao && opcao.value === "USO_CONSUMO" ? (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Padrão Venda/OS
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs font-normal leading-snug text-muted-foreground">
                    {opcao.descricao}
                  </span>
                  {desabilitada ? (
                    <span className="text-[11px] font-medium text-destructive">
                      Não se aplica a destinatário não contribuinte.
                    </span>
                  ) : null}
                </span>
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
      <p id={ajudaId} className="text-[11px] leading-snug text-muted-foreground">
        {resumoDestino}
      </p>
    </div>
  );
}
