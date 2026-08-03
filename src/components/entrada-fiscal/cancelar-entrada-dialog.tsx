"use client";

import axios, { isAxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, Loader2, PackageMinus, Receipt, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_CANCELAMENTO_MAX } from "@/lib/cancelamento";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";

type OrigemEntrada = "ESTOQUE" | "USOCONSUMO";

type ItemRevertido = {
  id: number;
  titulo: string;
  referencia: string | null;
  quantidade: number;
  unidade: string | null;
  valorTotal: number;
  estoqueAtual: number | null;
  estoqueDepois: number | null;
  saldoInsuficiente: boolean;
};

type TransacaoRevertida = {
  id: number;
  descricao: string | null;
  valor: number;
  vencimentoEm: string | null;
  pendente: boolean;
  compartilhada: boolean;
};

type LadoEntrada = { entradaId: number; valorTotal: number; itens: ItemRevertido[] };

type PreviewCancelamento = {
  mista: boolean;
  nota: {
    documentoId: number | null;
    numero: string | null;
    serie: string | null;
    chave: string | null;
    dataEmissao: string | null;
    fornecedor: string | null;
  };
  estoque: LadoEntrada | null;
  usoconsumo: LadoEntrada | null;
  transacoes: TransacaoRevertida[];
  bloqueios: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entradaId: number | null;
  origem: OrigemEntrada;
  onCancelada?: () => void | Promise<void>;
};

function textoErro(error: unknown) {
  return isAxiosError(error)
    ? error.response?.data?.error ?? error.response?.data?.details ?? error.message
    : "Erro inesperado.";
}

export function CancelarEntradaDialog({ open, onOpenChange, entradaId, origem, onCancelada }: Props) {
  const [preview, setPreview] = useState<PreviewCancelamento | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroPreview, setErroPreview] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregarPreview = useCallback(async (id: number) => {
    setCarregando(true);
    setErroPreview(null);
    try {
      const { data } = await axios.get("/api/entradas/cancelamento/preview", {
        params: { entradaId: id, origem },
      });
      setPreview(data.data);
    } catch (error) {
      setPreview(null);
      setErroPreview(textoErro(error));
    } finally {
      setCarregando(false);
    }
  }, [origem]);

  useEffect(() => {
    if (!open || !entradaId) return;
    void carregarPreview(entradaId);
  }, [open, entradaId, carregarPreview]);

  useEffect(() => {
    if (open) return;
    setPreview(null);
    setErroPreview(null);
    setMotivo("");
    setEnviando(false);
    setCarregando(false);
  }, [open]);

  const bloqueado = Boolean(preview?.bloqueios.length);
  const motivoValido = motivo.trim().length > 0;
  const podeConfirmar = Boolean(preview) && !bloqueado && motivoValido && !enviando && !carregando;

  const totalItens = (preview?.estoque?.itens.length ?? 0) + (preview?.usoconsumo?.itens.length ?? 0);
  const totalFinanceiro = preview?.transacoes.reduce((soma, t) => soma + t.valor, 0) ?? 0;

  async function confirmar() {
    if (!preview || !entradaId) return;
    setEnviando(true);
    try {
      if (preview.mista && preview.estoque && preview.usoconsumo) {
        await axios.post("/api/entradas/cancelamento/mista", {
          entradaId: preview.estoque.entradaId,
          usoconsumoEntradaId: preview.usoconsumo.entradaId,
          motivo: motivo.trim(),
        });
      } else if (preview.estoque) {
        await axios.post(`/api/entradas/${preview.estoque.entradaId}/cancelar`, { motivo: motivo.trim() });
      } else if (preview.usoconsumo) {
        await axios.post(`/api/usoconsumo/entradas/${preview.usoconsumo.entradaId}/cancelar`, { motivo: motivo.trim() });
      }
      toast.success(preview.mista ? "Entradas da nota canceladas." : "Entrada cancelada.");
      onOpenChange(false);
      await onCancelada?.();
    } catch (error) {
      toast.error("Não foi possível cancelar.", { description: textoErro(error) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(proximo) => {
        if (enviando) return;
        onOpenChange(proximo);
      }}
    >
      <DialogContent className="flex h-[640px] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Cancelar entrada
          </DialogTitle>
          <DialogDescription className="text-xs">
            Revise tudo o que será desfeito. Esta ação não pode ser revertida.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {carregando ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Levantando o que será desfeito...
            </div>
          ) : erroPreview ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{erroPreview}</p>
              {entradaId ? (
                <Button variant="outline" size="sm" onClick={() => void carregarPreview(entradaId)}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <section className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      NF-e nº {preview.nota.numero || "—"}
                      {preview.nota.serie ? <span className="text-muted-foreground"> · série {preview.nota.serie}</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {preview.nota.fornecedor || "Fornecedor não identificado"}
                      {preview.nota.dataEmissao ? ` · emitida em ${formatDate(preview.nota.dataEmissao)}` : ""}
                    </p>
                  </div>
                  {preview.mista ? (
                    <Badge variant="secondary" className="shrink-0">Entrada mista</Badge>
                  ) : null}
                </div>
                {preview.mista ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Esta nota alimentou os dois estoques e o pagamento é compartilhado. As duas entradas
                    são canceladas juntas — não é possível desfazer só uma delas.
                  </p>
                ) : null}
              </section>

              {preview.bloqueios.length ? (
                <section
                  role="alert"
                  className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Cancelamento bloqueado
                  </p>
                  <ul className="ml-6 list-disc space-y-1 text-xs text-destructive">
                    {preview.bloqueios.map((bloqueio) => <li key={bloqueio}>{bloqueio}</li>)}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-lg border p-3 bg-card">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Resumo do que será desfeito
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-bold tabular-nums">{totalItens}</p>
                    <p className="text-[11px] text-muted-foreground">itens estornados</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-bold tabular-nums">{preview.transacoes.length}</p>
                    <p className="text-[11px] text-muted-foreground">lançamentos</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-lg font-bold tabular-nums">{formatarEmReal(totalFinanceiro)}</p>
                    <p className="text-[11px] text-muted-foreground">em pagamentos</p>
                  </div>
                </div>
              </section>

              {preview.estoque ? (
                <BlocoItens
                  titulo="Estoque de revenda"
                  entradaId={preview.estoque.entradaId}
                  valorTotal={preview.estoque.valorTotal}
                  itens={preview.estoque.itens}
                />
              ) : null}

              {preview.usoconsumo ? (
                <BlocoItens
                  titulo="Uso e consumo"
                  entradaId={preview.usoconsumo.entradaId}
                  valorTotal={preview.usoconsumo.valorTotal}
                  itens={preview.usoconsumo.itens}
                />
              ) : null}

              {preview.transacoes.length ? (
                <section className="rounded-lg border bg-card">
                  <header className="flex items-center gap-2 border-b px-3 py-2">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-semibold">Financeiro</p>
                  </header>
                  <ul className="divide-y">
                    {preview.transacoes.map((transacao) => (
                      <li key={transacao.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{transacao.descricao || `Lançamento #${transacao.id}`}</p>
                          <p className="text-muted-foreground">
                            {transacao.vencimentoEm ? `Vence em ${formatDate(transacao.vencimentoEm)}` : "Sem vencimento"}
                            {transacao.compartilhada ? " · compartilhado pelas duas entradas" : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={transacao.pendente ? "secondary" : "outline"} className="text-[10px]">
                            {transacao.pendente ? "será excluído" : "gera estorno"}
                          </Badge>
                          <span className="font-mono font-semibold tabular-nums">{formatarEmReal(transacao.valor)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {preview.nota.documentoId ? (
                <p className="text-xs text-muted-foreground">
                  Os itens desta NF-e voltam a ficar disponíveis para uma nova entrada depois do cancelamento.
                </p>
              ) : null}

              <Separator />

              <div className="space-y-1.5 p-4 bg-card rounded-xl">
                <Label htmlFor="motivo-cancelamento">
                  Motivo do cancelamento <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="motivo-cancelamento"
                  value={motivo}
                  maxLength={MOTIVO_CANCELAMENTO_MAX}
                  onChange={(evento) => setMotivo(evento.target.value)}
                  placeholder="Descreva por que esta entrada está sendo cancelada."
                  className="min-h-[72px] resize-none"
                  aria-describedby="motivo-contador"
                />
                <p id="motivo-contador" className="text-right text-[11px] text-muted-foreground">
                  {motivo.length}/{MOTIVO_CANCELAMENTO_MAX}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={() => void confirmar()} disabled={!podeConfirmar}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {preview?.mista ? "Cancelar as duas entradas" : "Cancelar entrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlocoItens({
  titulo,
  entradaId,
  valorTotal,
  itens,
}: {
  titulo: string;
  entradaId: number;
  valorTotal: number;
  itens: ItemRevertido[];
}) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <PackageMinus className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">{titulo}</p>
          <span className="text-xs text-muted-foreground">entrada #{entradaId}</span>
        </div>
        <span className="text-xs font-semibold tabular-nums">{formatarEmReal(valorTotal)}</span>
      </header>
      {itens.length ? (
        <ul className="divide-y">
          {itens.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.titulo}</p>
                {item.referencia ? (
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{item.referencia}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-muted-foreground">
                  −{item.quantidade.toLocaleString("pt-BR")} {item.unidade ?? ""}
                </span>
                {item.estoqueAtual !== null ? (
                  <span
                    className={`inline-flex items-center gap-1 font-mono tabular-nums ${
                      item.saldoInsuficiente ? "font-semibold text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {item.estoqueAtual}
                    <ArrowDown className="h-3 w-3" />
                    {item.estoqueDepois}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum item nesta entrada.</p>
      )}
    </section>
  );
}
