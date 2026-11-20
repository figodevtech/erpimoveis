"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Ban,
  Building2,
  Calendar,
  ClipboardList,
  FileText,
  Landmark,
  Loader2,
  Package,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { clientName, dateLabel, endpoint, money, propertyName, type Entity } from "./model";
import { requestJson } from "./shared";

/** Quantidade e valor de cada parte da reserva que sai junto (imob_excluir_reserva). */
type Parte = { quantidade: number; valor?: number | string };
type Impacto = {
  excluido: boolean;
  bloqueios: string[];
  /** Dinheiro recebido ou pago, ou extrato do proprietário: pede a confirmação dos valores. */
  movimentou: boolean;
  itens: {
    a_receber: Parte;
    recebido: Parte;
    a_pagar: Parte;
    pago: Parte;
    lancamentos_proprietario: Parte;
    extrato: Parte;
    eventos_dre: Parte;
    consumo: Parte;
    conciliacoes: Parte;
    transacoes: Parte;
    servicos: Parte;
    arquivos: Parte;
  };
};

type Linha = { chave: string; icon: ComponentType<{ className?: string }>; rotulo: string; detalhe: string; destaque?: boolean };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que o aviso mostra, na ordem em que pesa: dinheiro primeiro, depois o resto. */
function linhasDoImpacto(itens: Impacto["itens"]): Linha[] {
  const linhas: Linha[] = [];
  const q = (parte: Parte | undefined) => Number(parte?.quantidade ?? 0);
  const v = (parte: Parte | undefined) => Number(parte?.valor ?? 0);
  if (q(itens.recebido)) {
    linhas.push({ chave: "recebido", icon: ArrowDownCircle, rotulo: "Recebido do hóspede", destaque: true,
      detalhe: `${money(v(itens.recebido))} · sai do caixa e do saldo do banco` });
  }
  if (q(itens.pago)) {
    linhas.push({ chave: "pago", icon: ArrowUpCircle, rotulo: "Pago (repasses, despesas e custos)", destaque: true,
      detalhe: `${money(v(itens.pago))} · sai do caixa e do saldo do banco` });
  }
  if (q(itens.a_receber)) {
    linhas.push({ chave: "a_receber", icon: Wallet, rotulo: "A receber em aberto", detalhe: `${money(v(itens.a_receber))} · ${plural(q(itens.a_receber), "cobrança", "cobranças")}` });
  }
  if (q(itens.a_pagar)) {
    linhas.push({ chave: "a_pagar", icon: ReceiptText, rotulo: "A pagar em aberto", detalhe: `${money(v(itens.a_pagar))} · ${plural(q(itens.a_pagar), "conta", "contas")}` });
  }
  if (q(itens.lancamentos_proprietario)) {
    linhas.push({ chave: "lancamentos", icon: User, rotulo: "Lançamentos do proprietário",
      detalhe: `${plural(q(itens.lancamentos_proprietario), "lançamento", "lançamentos")} · ${money(v(itens.lancamentos_proprietario))}` });
  }
  if (q(itens.extrato)) {
    linhas.push({ chave: "extrato", icon: ClipboardList, rotulo: "Extrato do proprietário", destaque: true,
      detalhe: `${plural(q(itens.extrato), "linha apagada", "linhas apagadas")} (recebimentos, taxa, despesas e repasses)` });
  }
  if (q(itens.eventos_dre)) {
    linhas.push({ chave: "dre", icon: FileText, rotulo: "Resultado (DRE)", detalhe: `${plural(q(itens.eventos_dre), "registro", "registros")} de receita, custo e taxa de administração` });
  }
  if (q(itens.consumo)) {
    linhas.push({ chave: "consumo", icon: Package, rotulo: "Consumo de estoque", detalhe: `${plural(q(itens.consumo), "consumo", "consumos")} · os itens voltam ao estoque` });
  }
  if (q(itens.conciliacoes)) {
    linhas.push({ chave: "conciliacoes", icon: Landmark, rotulo: "Conciliação bancária", detalhe: `${plural(q(itens.conciliacoes), "movimento do extrato volta", "movimentos do extrato voltam")} a ficar sem conciliação` });
  }
  if (q(itens.servicos)) {
    linhas.push({ chave: "servicos", icon: Sparkles, rotulo: "Serviços", detalhe: `${plural(q(itens.servicos), "serviço", "serviços")} (limpeza do check-out) sai da Execução` });
  }
  if (q(itens.arquivos)) {
    linhas.push({ chave: "arquivos", icon: FileText, rotulo: "Arquivos", detalhe: plural(q(itens.arquivos), "arquivo apagado", "arquivos apagados") });
  }
  return linhas;
}

/**
 * Exclusão definitiva da reserva (lista de reservas). Antes de apagar, mostra tudo o que sai junto:
 * cobranças, recebimentos, repasses, extrato do proprietário, DRE, estoque, arquivos. Com dinheiro
 * movimentado, pede uma confirmação a mais. O que não pode sumir (NFS-e, crédito do cliente...)
 * aparece como bloqueio.
 */
export function ExcluirReservaDialog({ reserva, onClose, onDone }: { reserva: Entity; onClose: () => void; onDone: () => void }) {
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroImpacto, setErroImpacto] = useState("");
  const [confirmouValores, setConfirmouValores] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState("");
  const codigo = reserva.codigo ?? reserva.id;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroImpacto("");
    try {
      setImpacto((await requestJson(`${endpoint("reservas", reserva.id)}/exclusao`)) as Impacto);
    } catch (error) {
      setErroImpacto((error as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [reserva.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = impacto ? linhasDoImpacto(impacto.itens) : [];
  const bloqueada = Boolean(impacto?.bloqueios.length);
  const podeExcluir = Boolean(impacto) && !bloqueada && !carregando && (!impacto?.movimentou || confirmouValores);

  const excluir = async () => {
    if (!podeExcluir) return;
    setExcluindo(true);
    setErro("");
    try {
      await requestJson(endpoint("reservas", reserva.id), {
        method: "DELETE",
        body: JSON.stringify({ confirmar_valores: confirmouValores }),
      });
      toast.success("Reserva excluída definitivamente", {
        description: linhas.length ? `Reserva #${codigo} e os valores dela foram apagados.` : `Reserva #${codigo} foi apagada.`,
      });
      onDone();
    } catch (error) {
      // Algo mudou desde o aviso (um pagamento novo, uma nota): mostra o motivo e o impacto atualizado.
      setErro((error as Error).message);
      setConfirmouValores(false);
      void carregar();
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !excluindo && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1.5 border-b p-4 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-5 w-5 shrink-0" />
            Excluir reserva definitivamente
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">Reserva #{codigo} · {propertyName(reserva)}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {clientName(reserva)} · {dateLabel(reserva.inicio)} a {dateLabel(reserva.fim)}
                  {reserva.valor_total != null ? ` · ${money(reserva.valor_total)}` : ""}
                </span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:px-6">
          {carregando && !impacto ? (
            <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Verificando os valores da reserva…
            </div>
          ) : erroImpacto && !impacto ? (
            <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
              <p className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {erroImpacto}
              </p>
              <Button variant="outline" size="sm" onClick={() => void carregar()} className="gap-1.5 hover:cursor-pointer">
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar de novo
              </Button>
            </div>
          ) : impacto ? (
            <>
              {bloqueada ? (
                <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
                  <p className="flex items-center gap-2 font-semibold">
                    <Ban className="h-4 w-4 shrink-0" />
                    Esta reserva não pode ser excluída agora
                  </p>
                  <ul className="list-disc space-y-1 pl-6 text-xs leading-relaxed">
                    {impacto.bloqueios.map((motivo) => <li key={motivo}>{motivo}</li>)}
                  </ul>
                </div>
              ) : null}

              {linhas.length ? (
                <div className={cn("space-y-2.5 rounded-xl border p-3.5", impacto.movimentou ? "border-amber-500/40 bg-amber-500/10" : "border-border/70 bg-muted/30")}>
                  <p className={cn("flex items-center gap-2 text-sm font-semibold", impacto.movimentou ? "text-amber-800 dark:text-amber-300" : "text-foreground")}>
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Os valores desta reserva também serão apagados
                  </p>
                  <ul className="space-y-2">
                    {linhas.map(({ chave, icon: Icon, rotulo, detalhe, destaque }) => (
                      <li key={chave} className="flex items-start gap-2.5 text-xs">
                        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", destaque ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{rotulo}</p>
                          <p className="text-muted-foreground">{detalhe}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : !bloqueada ? (
                <p className="rounded-xl border border-border/70 bg-muted/30 p-3.5 text-sm text-muted-foreground">
                  A reserva não tem valores lançados: só ela sai.
                </p>
              ) : null}

              {!bloqueada ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  As datas voltam a ficar livres no calendário do imóvel. Não dá para desfazer; a auditoria guarda o registro do que foi apagado.
                </p>
              ) : null}

              {!bloqueada && impacto.movimentou ? (
                <label htmlFor="confirmar-valores-reserva" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 hover:cursor-pointer">
                  <Checkbox
                    id="confirmar-valores-reserva"
                    checked={confirmouValores}
                    onCheckedChange={(valor) => setConfirmouValores(valor === true)}
                    disabled={excluindo}
                    className="mt-0.5"
                  />
                  <span className="text-xs leading-relaxed text-foreground">
                    Entendo que o dinheiro recebido e pago desta reserva sai do caixa e do banco, e que o extrato do proprietário perde
                    esses lançamentos.
                  </span>
                </label>
              ) : null}

              {erro ? (
                <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {erro}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-4 sm:px-6">
          <Button variant="outline" onClick={onClose} disabled={excluindo} className="hover:cursor-pointer">
            {bloqueada ? "Fechar" : "Cancelar"}
          </Button>
          {!bloqueada ? (
            <Button variant="destructive" onClick={() => void excluir()} disabled={!podeExcluir || excluindo} className="gap-1.5 hover:cursor-pointer">
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {excluindo ? "Excluindo…" : "Excluir definitivamente"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
