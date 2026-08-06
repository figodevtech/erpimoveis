"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";

import formatarEmReal from "@/utils/formatarEmReal";

import { Cartao, EstadoVazio, fmtDate } from "./shared";

/**
 * Antecipação: o vínculo entre o dinheiro que entrou e os títulos que ele quitou.
 *
 * Serve aos dois lados. Aberta no lançamento da antecipação, lista os títulos
 * liquidados; aberta em um dos títulos, mostra por onde o dinheiro entrou.
 *
 * As parcelas aparecem sem banco de propósito — elas foram quitadas, mas o caixa
 * não se moveu por elas. Quem carrega o banco é a antecipação, e é isso que
 * impede o saldo de contar o mesmo dinheiro duas vezes.
 */

type Linha = {
  id: number;
  descricao: string;
  descricao_pagamento?: string | null;
  valor: number | string;
  valorLiquido: number | string | null;
  valor_descontos?: number | string | null;
  data: string;
  vencimento_em?: string | null;
  tipo: string;
};

type Adiantamento = Linha & {
  pago_em?: string | null;
  banco?: { id: number; titulo: string } | null;
};

const num = (valor: unknown) => {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
};

export function AdiantamentoTab({ transacaoId }: { transacaoId: number }) {
  const [carregando, setCarregando] = useState(true);
  const [adiantamento, setAdiantamento] = useState<Adiantamento | null>(null);
  const [parcelas, setParcelas] = useState<Linha[]>([]);
  const [ehOAdiantamento, setEhOAdiantamento] = useState(false);

  useEffect(() => {
    // Sem setState síncrono aqui: o estado já nasce em "carregando" e só é
    // desligado quando a resposta chega. Ligá-lo no corpo do efeito provocaria
    // uma renderização em cascata a cada troca de transação.
    let ativo = true;

    axios
      .get(`/api/transaction/adiantamento?transacaoId=${transacaoId}`)
      .then((r) => {
        if (!ativo) return;
        setAdiantamento(r.data?.data?.adiantamento ?? null);
        setParcelas(r.data?.data?.parcelas ?? []);
        setEhOAdiantamento(Boolean(r.data?.data?.ehOAdiantamento));
      })
      .catch(() => {
        if (ativo) setAdiantamento(null);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [transacaoId]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando
      </div>
    );
  }

  if (!adiantamento) {
    return (
      <EstadoVazio>
        Esta transação não faz parte de um adiantamento. Antecipações são criadas
        pela baixa múltipla, escolhendo &ldquo;Baixa adiantamento&rdquo;.
      </EstadoVazio>
    );
  }

  const bruto = num(adiantamento.valor);
  const taxa = num(adiantamento.valor_descontos);
  const liquido = num(adiantamento.valorLiquido) || bruto;
  const somaParcelas =
    parcelas.reduce((total, p) => total + Math.round(num(p.valorLiquido || p.valor) * 100), 0) / 100;

  return (
    <div className="space-y-3">
      <Cartao titulo={ehOAdiantamento ? "Este é o adiantamento" : "Antecipado por"}>
        {!ehOAdiantamento ? (
          <p className="mb-3 text-sm font-medium">
            #{adiantamento.id} — {adiantamento.descricao}
          </p>
        ) : null}

        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Soma dos títulos</span>
            <span className="tabular-nums">{formatarEmReal(bruto)}</span>
          </div>
          {taxa > 0 ? (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Taxa de antecipação</span>
              <span className="tabular-nums text-destructive">− {formatarEmReal(taxa)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t pt-1 font-semibold">
            <span>Entrou na conta</span>
            <span className="tabular-nums">{formatarEmReal(liquido)}</span>
          </div>
          {adiantamento.banco?.titulo ? (
            <p className="pt-1 text-xs text-muted-foreground">
              {adiantamento.banco.titulo}
              {adiantamento.pago_em ? ` · ${fmtDate(adiantamento.pago_em)}` : ""}
            </p>
          ) : null}
        </div>
      </Cartao>

      <Cartao titulo={`Títulos liquidados (${parcelas.length})`}>
        {parcelas.length === 0 ? (
          <EstadoVazio>Nenhum título vinculado.</EstadoVazio>
        ) : (
          <>
            <ul className="divide-y">
              {parcelas.map((parcela) => (
                <li
                  key={parcela.id}
                  className={`flex items-center gap-3 py-2 ${
                    parcela.id === transacaoId ? "font-medium" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{parcela.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      #{parcela.id}
                      {parcela.vencimento_em
                        ? ` · venceu em ${fmtDate(parcela.vencimento_em)}`
                        : ""}
                      {parcela.id === transacaoId ? " · esta transação" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {formatarEmReal(num(parcela.valorLiquido || parcela.valor))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Soma</span>
              <span className="tabular-nums">{formatarEmReal(somaParcelas)}</span>
            </div>
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Estes títulos foram quitados sem banco: o dinheiro entrou pelo
          adiantamento, e contá-lo neles também dobraria o saldo.
        </p>
      </Cartao>
    </div>
  );
}
