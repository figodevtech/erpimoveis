"use client";

import { Split, TriangleAlert } from "lucide-react";

import {
  RateioInvalidoError,
  paraCentavos,
  paraReais,
  ratearEntreDocumentos,
} from "@/lib/financeiro/rateio";
import formatarEmReal from "@/utils/formatarEmReal";

export type TipoDocumentoPagamento = "OS" | "VENDA";

/** Uma OS ou venda marcada na tabela, com o que ainda falta receber dela. */
export type DocumentoSelecionavel = {
  id: number;
  rotulo: string;
  cliente: string | null;
  /** Usado para decidir se o grupo inteiro tem um pagador só. */
  clienteId?: number | null;
  saldo: number;
};

/**
 * O que a tabela entrega ao diálogo de transação quando o modo múltiplo está
 * ligado. A presença deste objeto é o que faz o diálogo mudar de alvo: em vez de
 * criar uma transação, ele registra um pagamento rateado.
 */
export type ContextoPagamentoMultiplo = {
  tipoDocumento: TipoDocumentoPagamento;
  documentos: DocumentoSelecionavel[];
  onConcluido?: () => void;
};

/**
 * Desfaz o pagamento inteiro.
 *
 * Existe como função compartilhada porque as três telas que listam transações
 * precisam da mesma ação, e porque excluir perna por perna deixaria o grupo
 * cobrindo valor que ninguém mais deve.
 */
export async function excluirPagamentoMultiplo(grupoId: number) {
  const resposta = await fetch(`/api/pagamento-multiplo/${grupoId}`, { method: "DELETE" });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(corpo?.error ?? "Não foi possível excluir o pagamento múltiplo.");
  }
  return corpo?.data;
}

export function somarSaldos(documentos: DocumentoSelecionavel[]) {
  return paraReais(
    documentos.reduce((total, documento) => total + paraCentavos(documento.saldo), 0),
  );
}

/**
 * O cliente do grupo, quando há um só.
 *
 * Vários documentos do mesmo cliente têm um pagador óbvio, e é ele que a tela
 * propõe. Misturando clientes não existe pagador único, e escolher um deles
 * seria atribuir a alguém um pagamento que não é todo dele.
 */
export function clienteUnicoDoPagamento(documentos: DocumentoSelecionavel[]) {
  const ids = new Set(
    documentos
      .map((documento) => documento.clienteId)
      .filter((id): id is number => typeof id === "number" && id > 0),
  );
  return ids.size === 1 && ids.size === documentos.length ? [...ids][0] : null;
}

/** Categoria fixa do pagamento múltiplo: ele sempre quita OS ou venda. */
export function categoriaDoPagamentoMultiplo(tipoDocumento: TipoDocumentoPagamento) {
  return tipoDocumento === "OS" ? "ORDEM DE SERVIÇO" : "VENDA";
}

/**
 * Descrição do pagamento, com os documentos identificados pelo id.
 *
 * O lançamento é um só e cobre vários documentos, então o texto é o único lugar
 * do grupo onde fica registrado *o que* foi pago. Sem os ids, quem abrir o
 * extrato meses depois vê "pagamento de 3 ordens" e não sabe quais. Cada
 * transação rateada continua com a sua própria descrição individual.
 */
export function descricaoDoPagamentoMultiplo({
  tipoDocumento,
  documentos,
}: Pick<ContextoPagamentoMultiplo, "tipoDocumento" | "documentos">) {
  const quantidade = documentos.length;
  const substantivo =
    tipoDocumento === "OS"
      ? `ordem${quantidade === 1 ? "" : "ns"} de serviço`
      : `venda${quantidade === 1 ? "" : "s"}`;
  const identificados = documentos.map((documento) => documento.rotulo).join(", ");

  return `Pagamento de ${quantidade} ${substantivo}: ${identificados}`;
}

/**
 * Prévia do rateio.
 *
 * Mostra a conta antes de gravar — quem recebe quanto, e por quê. O cálculo aqui
 * é só para a tela: quem decide de verdade é o servidor, que relê os saldos na
 * hora de gravar. Se a tela estiver desatualizada, os números mudam lá, e é o
 * lado certo para essa verdade morar.
 */
export function PreviaDoRateio({
  documentos,
  valor,
  parcelas,
}: {
  documentos: DocumentoSelecionavel[];
  valor: number;
  parcelas: number;
}) {
  let fatias: Array<{ id: number; valorEmCentavos: number }> = [];
  let erro: string | null = null;

  try {
    fatias = ratearEntreDocumentos(
      documentos.map((documento) => ({
        id: documento.id,
        saldoEmCentavos: paraCentavos(documento.saldo),
      })),
      paraCentavos(valor),
    );
  } catch (problema) {
    erro =
      problema instanceof RateioInvalidoError
        ? problema.message
        : "Não foi possível calcular o rateio.";
  }

  const porDocumento = new Map(fatias.map((fatia) => [fatia.id, fatia.valorEmCentavos]));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Split className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">
          Rateio entre {documentos.length} documento{documentos.length === 1 ? "" : "s"}
        </h3>
      </div>

      {erro ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y text-xs">
            {documentos.map((documento) => {
              const fatia = paraReais(porDocumento.get(documento.id) ?? 0);
              const porParcela = parcelas > 1 ? fatia / parcelas : null;

              return (
                <li key={documento.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{documento.rotulo}</span>
                    {documento.cliente ? (
                      <span className="ml-2 text-muted-foreground">{documento.cliente}</span>
                    ) : null}
                    <span className="block text-[11px] text-muted-foreground">
                      Em aberto {formatarEmReal(documento.saldo)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-semibold tabular-nums">{formatarEmReal(fatia)}</span>
                    {porParcela != null ? (
                      <span className="block text-[11px] text-muted-foreground tabular-nums">
                        {parcelas}× de aprox. {formatarEmReal(porParcela)}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            A divisão é proporcional ao que cada documento ainda deve. Os centavos que
            sobram vão para a maior fatia, então a soma fecha exatamente com o valor
            informado.
          </p>
        </>
      )}
    </div>
  );
}
