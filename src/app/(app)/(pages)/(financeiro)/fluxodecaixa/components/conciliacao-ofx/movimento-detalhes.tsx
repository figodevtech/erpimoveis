"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Info,
  Landmark,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import formatarEmReal from "@/utils/formatarEmReal";
import {
  APARENCIA_DA_SITUACAO,
  ROTULO_DA_ACAO,
  type AcaoConciliacao,
  type Decisao,
  type MovimentoAnalisado,
  type SugestaoMatch,
} from "./types";
import {
  dataDaTransacao,
  descricaoMovimento,
  explicacaoMatch,
  formatarDia,
  resolvido,
} from "./apresentacao";

export function SituacaoBadge({
  movimento: m,
}: {
  movimento: MovimentoAnalisado;
}) {
  const a = APARENCIA_DA_SITUACAO[m.analise.situacao];
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap text-[11px] ${resolvido(m) ? "border-sky-600/40 bg-sky-600/10 text-sky-700 dark:text-sky-300" : a.classe}`}
    >
      {resolvido(m) && <CheckCircle2 className="size-3" aria-hidden="true" />}
      {m.statusGravado === "IGNORADO"
        ? "Ignorado"
        : m.statusGravado === "CONCILIADO"
          ? m.acaoGravada === "CRIAR"
            ? "Transação criada"
            : "Conciliado"
          : a.rotulo}
    </Badge>
  );
}

export function ValorMovimento({ centavos }: { centavos: number }) {
  return (
    <div
      className={`whitespace-nowrap text-right tabular-nums ${centavos > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
    >
      <p className="font-semibold">
        {centavos > 0 ? "+ " : "− "}
        {formatarEmReal(Math.abs(centavos) / 100)}
      </p>
      <p className="text-[10px] font-normal">
        {centavos > 0 ? "Entrada" : "Saída"}
      </p>
    </div>
  );
}

export function ComparacaoMovimento({
  movimento: m,
  sugestao: s,
  conta,
}: {
  movimento: MovimentoAnalisado;
  sugestao: SugestaoMatch | null;
  conta: string;
}) {
  const descricao = descricaoMovimento(m);
  const valor = Math.abs(m.valorCentavos);
  return (
    <section aria-label="Comparação entre extrato e ERP" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="min-w-0 overflow-hidden rounded-xl border bg-background">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Extrato bancário
            </h3>
            <Badge variant="outline">
              {m.valorCentavos > 0 ? "Entrada" : "Saída"}
            </Badge>
          </div>
          <div className="space-y-4 p-4">
            <div className="min-h-12">
              <p className="break-words text-sm font-semibold">
                {descricao.titulo}
              </p>
              {descricao.complemento && (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {descricao.complemento}
                </p>
              )}
            </div>
            <div>
              <p
                className={`text-2xl font-semibold tabular-nums ${m.valorCentavos > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
              >
                {m.valorCentavos > 0 ? "+ " : "− "}
                {formatarEmReal(valor / 100)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Valor no extrato
              </p>
            </div>
            <dl className="space-y-2 border-t pt-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Movimentado em</dt>
                <dd className="font-medium">{formatarDia(m.dataPostagem)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Conta</dt>
                <dd className="min-w-0 break-words text-right font-medium">
                  {conta}
                </dd>
              </div>
            </dl>
          </div>
        </article>
        <article
          className={`min-w-0 overflow-hidden rounded-xl border ${s ? "border-primary/35 bg-primary/[0.03]" : "border-dashed bg-muted/15"}`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-inherit px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Correspondência no ERP
            </h3>
            {s && <Badge variant="outline">#{s.transacaoId}</Badge>}
          </div>
          {s ? (
            <div className="space-y-4 p-4">
              <div className="min-h-12">
                <p className="break-words text-sm font-semibold">
                  {s.descricao || "Sem descrição"}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {s.contraparte || "Contraparte não informada"}
                </p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatarEmReal(s.valorCentavos / 100)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {s.origem === "FLUXO"
                    ? "Valor já movimentado"
                    : "Saldo do título em aberto"}
                </p>
              </div>
              <dl className="space-y-2 border-t border-primary/15 pt-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {s.origem === "FLUXO" ? "Movimentado em" : "Vencimento"}
                  </dt>
                  <dd className="font-medium">{dataDaTransacao(s.data)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Origem</dt>
                  <dd className="text-right font-medium">
                    {s.origem === "FLUXO"
                      ? "Fluxo de Caixa"
                      : "Título em aberto"}
                    {s.ordemservicoid
                      ? ` · OS #${s.ordemservicoid}`
                      : s.vendaid
                        ? ` · Venda #${s.vendaid}`
                        : ""}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="size-8 opacity-40" aria-hidden="true" />
              <p>
                {m.transacaoId
                  ? `Conciliado com a transação #${m.transacaoId}.`
                  : "Escolha uma transação para comparar."}
              </p>
              {!m.transacaoId && (
                <p className="max-w-60 text-xs">
                  Selecione uma das opções abaixo ou procure uma transação no
                  ERP.
                </p>
              )}
            </div>
          )}
        </article>
      </div>
      {s && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/10 px-2.5 py-1.5 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Mesma direção
          </span>
          <span
            className={`rounded-md px-2.5 py-1.5 ${s.parcial ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300"}`}
          >
            {s.parcial
              ? "Pagamento parcial do saldo"
              : "Valores correspondentes"}
          </span>
          <span
            className={`rounded-md px-2.5 py-1.5 ${s.diferencaEmDias ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
          >
            {s.diferencaEmDias
              ? `${s.diferencaEmDias} dia${s.diferencaEmDias === 1 ? "" : "s"} de diferença`
              : "Mesma data"}
          </span>
        </div>
      )}
      {s?.parcial && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">
            Baixa parcial de {formatarEmReal(valor / 100)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Restará{" "}
            <strong className="font-semibold text-foreground">
              {formatarEmReal((s.valorCentavos - valor) / 100)}
            </strong>{" "}
            no título após confirmar a conciliação.
          </p>
        </div>
      )}
    </section>
  );
}

export function MovimentoDetalhes({
  movimento: m,
  decisao,
  conta,
  arquivo,
  importacaoId,
  onFechar,
}: {
  movimento: MovimentoAnalisado | null;
  decisao?: Decisao;
  conta: string;
  arquivo: string;
  importacaoId: number | null;
  onFechar: () => void;
}) {
  const sugestao =
    m?.analise.sugestoes.find((s) => s.transacaoId === decisao?.transacaoId) ??
    (m && m.analise.situacao !== "AMBIGUO" && !resolvido(m)
      ? m.analise.sugestoes[0]
      : null) ??
    null;
  return (
    <Sheet
      open={Boolean(m)}
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <SheetContent className="w-full gap-0 overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b bg-muted/20 px-5 py-5 pr-12 sm:px-6 sm:pr-12">
          <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Landmark className="size-3.5" aria-hidden="true" /> Conciliação
            bancária · Detalhes
          </p>
          <SheetTitle>Movimento bancário</SheetTitle>
          <SheetDescription>
            Confira o extrato, a correspondência e os dados originais.
          </SheetDescription>
        </SheetHeader>
        {m && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            <section
              aria-label="Resumo do movimento"
              className="overflow-hidden rounded-xl border"
            >
              <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                <span className="flex items-center gap-2 text-xs font-medium">
                  {m.valorCentavos > 0 ? (
                    <ArrowDownLeft className="size-4 text-emerald-700 dark:text-emerald-400" />
                  ) : (
                    <ArrowUpRight className="size-4 text-red-700 dark:text-red-400" />
                  )}
                  {m.valorCentavos > 0
                    ? "Entrada no extrato"
                    : "Saída no extrato"}
                </span>
                <SituacaoBadge movimento={m} />
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <p className="break-words text-base font-semibold">
                    {descricaoMovimento(m).titulo}
                  </p>
                  {descricaoMovimento(m).complemento && (
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {descricaoMovimento(m).complemento}
                    </p>
                  )}
                </div>
                <p
                  className={`text-3xl font-semibold tabular-nums ${m.valorCentavos > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {m.valorCentavos > 0 ? "+ " : "− "}
                  {formatarEmReal(Math.abs(m.valorCentavos) / 100)}
                </p>
                <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Movimentado em</dt>
                    <dd className="mt-1 font-medium">
                      {formatarDia(m.dataPostagem)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Conta bancária</dt>
                    <dd className="mt-1 break-words font-medium">{conta}</dd>
                  </div>
                  {m.dataDisponivel && (
                    <div>
                      <dt className="text-muted-foreground">Disponível em</dt>
                      <dd className="mt-1 font-medium">
                        {formatarDia(m.dataDisponivel)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>
            <section
              aria-label="Situação da conciliação"
              className="space-y-3 rounded-xl border bg-muted/15 p-4"
            >
              <h3 className="text-sm font-semibold">Conciliação</h3>
              {resolvido(m) ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">
                    {m.statusGravado === "IGNORADO"
                      ? "Movimento ignorado"
                      : m.transacaoId
                        ? `Conciliado com a transação #${m.transacaoId}.`
                        : "Movimento conciliado"}
                  </p>
                  {m.acaoGravada && (
                    <p className="text-xs text-muted-foreground">
                      {ROTULO_DA_ACAO[m.acaoGravada as AcaoConciliacao] ??
                        m.acaoGravada}
                    </p>
                  )}
                  {m.conciliadoEm && (
                    <p className="text-xs text-muted-foreground">
                      {m.statusGravado === "IGNORADO"
                        ? "Registrado em "
                        : "Conciliado em "}
                      {new Date(m.conciliadoEm).toLocaleString("pt-BR")}
                    </p>
                  )}
                  {m.tituloOrigemId && (
                    <p className="text-xs">
                      Título de origem #{m.tituloOrigemId}
                    </p>
                  )}
                </div>
              ) : decisao ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-sm font-medium">
                    {ROTULO_DA_ACAO[decisao.acao]}
                  </p>
                  {decisao.transacaoId && (
                    <p className="mt-1 text-xs">
                      Transação #{decisao.transacaoId}
                    </p>
                  )}
                  {decisao.nova?.descricao && (
                    <p className="mt-1 break-words text-xs">
                      {decisao.nova.descricao}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Decisão preparada. Será aplicada ao confirmar o lote.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {sugestao
                    ? "Correspondência sugerida. Revise o movimento para confirmar sua escolha."
                    : "Este movimento ainda não tem uma correspondência selecionada."}
                </p>
              )}
              {m.analise.situacao === "AMBIGUO" &&
                !decisao &&
                !resolvido(m) && (
                  <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                    {m.analise.sugestoes.length} correspondências possíveis. A
                    escolha precisa ser feita por você.
                  </p>
                )}
              {sugestao &&
                !resolvido(m) &&
                decisao?.acao !== "CRIAR" &&
                decisao?.acao !== "IGNORAR" && (
                  <div className="space-y-3 border-t pt-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">
                          {sugestao.descricao || "Sem descrição"}
                        </p>
                        <p className="mt-1 break-words text-muted-foreground">
                          Transação #{sugestao.transacaoId}
                          {sugestao.contraparte
                            ? ` · ${sugestao.contraparte}`
                            : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">
                          {formatarEmReal(sugestao.valorCentavos / 100)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {sugestao.origem === "TITULO"
                            ? "Saldo em aberto"
                            : "Valor movimentado"}
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground">
                      {sugestao.origem === "FLUXO"
                        ? "Movimentado em "
                        : "Vencimento em "}
                      {dataDaTransacao(sugestao.data)}
                    </p>
                    <p className="rounded-lg bg-muted/60 p-3">
                      {explicacaoMatch(sugestao)} · Mesma direção financeira
                      {sugestao.origem === "FLUXO"
                        ? " · Mesma conta bancária"
                        : ""}
                    </p>
                    {sugestao.ordemservicoid && (
                      <p>OS #{sugestao.ordemservicoid}</p>
                    )}
                    {sugestao.vendaid && <p>Venda #{sugestao.vendaid}</p>}
                    {sugestao.parcial && (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                        <p className="font-medium">
                          Baixa parcial de{" "}
                          {formatarEmReal(Math.abs(m.valorCentavos) / 100)}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Restará{" "}
                          {formatarEmReal(
                            (sugestao.valorCentavos -
                              Math.abs(m.valorCentavos)) /
                              100,
                          )}{" "}
                          no título após confirmar a conciliação.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              {m.analise.observacao && (
                <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                  <Info
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  {m.analise.observacao}
                </p>
              )}
            </section>
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileText
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                Arquivo de origem
              </h3>
              <p className="break-words text-sm">
                {arquivo || "Não informado"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {importacaoId
                  ? `Importação #${importacaoId}`
                  : "Arquivo em conferência"}{" "}
                · Movimento {m.sequencia}
              </p>
            </section>
            <details className="group rounded-xl border">
              <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Dados originais do arquivo
              </summary>
              <dl className="divide-y border-t px-4 text-xs">
                {[
                  ["MEMO original", m.memo],
                  ["NAME original", m.nome],
                  ["FITID", m.fitid],
                  ["CHECKNUM", m.checknum],
                  ["REFNUM", m.refnum],
                  ["TRNTYPE", m.tipoOfx],
                  [
                    "Disponível em",
                    m.dataDisponivel ? formatarDia(m.dataDisponivel) : null,
                  ],
                  ["Fingerprint", m.fingerprint],
                  ["Score da análise", m.analise.score],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid min-w-0 gap-1.5 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {value ?? "Não informado"}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
