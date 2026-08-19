"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowRight, Car, Layers, Loader2, ReceiptText, UserCog } from "lucide-react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import type { Customer } from "../../../clientes/types";

type Titulo = {
  id: string;
  descricao: string | null;
  data: string | null;
  pendente: boolean;
  valorFace: number;
  vinculo: "DIRETO" | "RATEIO_EXCLUSIVO" | "RATEIO_COMPARTILHADO";
  outrosDocumentos: string[];
};

type Impacto = {
  clienteAtualId: number | null;
  titulos: Titulo[];
  resumo: { quantidade: number; valorEmAberto: number; valorBaixado: number };
  veiculo: {
    id: number;
    placa: string | null;
    descricao: string | null;
    proprietarioId: number | null;
    proprietarioNome: string | null;
  } | null;
  notasEmitidas: number;
};

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataCurta(valor: string | null) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Troca de titularidade a partir do card de cliente dos detalhes da OS.
 *
 * Existe porque "Editar OS" só aparece em ORCAMENTO: depois disso, corrigir o
 * cliente exigia reiniciar a OS inteira e perder os títulos no caminho.
 */
export function TrocarClienteOsButton({
  osId,
  clienteAtualNome,
  onTrocado,
}: {
  osId: number;
  clienteAtualNome?: string | null;
  onTrocado?: () => void;
}) {
  const { data: session } = useSession();
  const podeEditar = permissionSetHas((session?.user as any)?.permissoes, PERMS.ORDENS_EDITAR);

  const [aberto, setAberto] = useState(false);
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [selecionado, setSelecionado] = useState<Customer | null>(null);
  const [seletorAberto, setSeletorAberto] = useState(false);

  const carregarImpacto = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/ordens/${osId}/cliente`, { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({}) as any);
      if (!resposta.ok) throw new Error(corpo?.error || "Falha ao carregar os dados da OS.");
      setImpacto(corpo as Impacto);
    } catch (erro: any) {
      toast.error(erro?.message || "Falha ao carregar os dados da OS.");
      setImpacto(null);
    } finally {
      setCarregando(false);
    }
  }, [osId]);

  useEffect(() => {
    if (!aberto) return;
    setSelecionado(null);
    void carregarImpacto();
  }, [aberto, carregarImpacto]);

  if (!podeEditar) return null;

  const acompanham = (impacto?.titulos ?? []).filter(
    (titulo) => titulo.vinculo !== "RATEIO_COMPARTILHADO",
  );
  const compartilhados = (impacto?.titulos ?? []).filter(
    (titulo) => titulo.vinculo === "RATEIO_COMPARTILHADO",
  );
  const mesmoCliente =
    selecionado != null && impacto?.clienteAtualId === Number(selecionado.id);
  const veiculoDeOutro =
    impacto?.veiculo != null &&
    selecionado != null &&
    impacto.veiculo.proprietarioId !== Number(selecionado.id);

  async function confirmar() {
    if (!selecionado || mesmoCliente) return;
    setSalvando(true);
    const idToast = toast.loading("Trocando o cliente da OS...", { duration: Infinity });
    try {
      const resposta = await fetch(`/api/ordens/${osId}/cliente`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId: Number(selecionado.id) }),
      });
      const corpo = await resposta.json().catch(() => ({}) as any);
      if (!resposta.ok) throw new Error(corpo?.error || "Falha ao trocar o cliente da OS.");

      const quantidade = Number(corpo?.titulosAtualizados ?? 0);
      toast.success(
        quantidade > 0
          ? `Cliente trocado e ${quantidade} título(s) transferido(s).`
          : "Cliente da OS trocado.",
        { id: idToast, duration: 3000 },
      );
      setAberto(false);
      onTrocado?.();
      window.dispatchEvent(new CustomEvent("os:refresh"));
    } catch (erro: any) {
      toast.error(erro?.message || "Falha ao trocar o cliente da OS.", {
        id: idToast,
        duration: 4000,
      });
      void carregarImpacto();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs hover:cursor-pointer"
        title="Trocar o cliente desta OS"
        onClick={() => setAberto(true)}
      >
        <UserCog className="h-3.5 w-3.5" />
        Trocar
      </Button>

      <Dialog open={aberto} onOpenChange={(estado) => !salvando && setAberto(estado)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Trocar o cliente da OS #{osId}</DialogTitle>
            <DialogDescription>
              O novo cliente passa a ser o titular da OS e o pagador dos títulos. A troca fica
              registrada no histórico da OS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="min-w-0 flex-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Titular atual
                </span>
                <p className="truncate text-sm font-medium">{clienteAtualNome || "Sem cliente"}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Novo titular
                </span>
                <p
                  className={`truncate text-sm font-medium ${selecionado ? "" : "text-muted-foreground"}`}
                >
                  {selecionado?.nomerazaosocial || "Nenhum selecionado"}
                </p>
              </div>
              <CustomerSelect
                open={seletorAberto}
                setOpen={setSeletorAberto}
                OnSelect={(cliente) => setSelecionado(cliente)}
              >
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={salvando}>
                  Selecionar
                </Button>
              </CustomerSelect>
            </div>

            {mesmoCliente ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Este já é o titular atual da OS. Selecione outro cliente.
              </p>
            ) : null}

            {carregando ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Levantando o que muda...
              </div>
            ) : impacto ? (
              <div className="space-y-3">
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <ReceiptText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Títulos que passam para o novo cliente
                    </span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {impacto.resumo.quantidade}
                    </Badge>
                  </div>

                  {acompanham.length ? (
                    <>
                      <ul className="divide-y">
                        {acompanham.map((titulo) => (
                          <li
                            key={titulo.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate">{titulo.descricao || `Título #${titulo.id}`}</p>
                              {dataCurta(titulo.data) ? (
                                <span className="text-muted-foreground">{dataCurta(titulo.data)}</span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  titulo.pendente
                                    ? "text-[10px] text-amber-600 dark:text-amber-400"
                                    : "text-[10px] text-emerald-600 dark:text-emerald-400"
                                }
                              >
                                {titulo.pendente ? "Em aberto" : "Baixado"}
                              </Badge>
                              <span className="font-medium">{moeda(titulo.valorFace)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
                        <span>Em aberto: {moeda(impacto.resumo.valorEmAberto)}</span>
                        <span>Já baixado: {moeda(impacto.resumo.valorBaixado)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      {compartilhados.length
                        ? "Nenhum título muda de pagador: esta OS é cobrada por pagamento múltiplo, detalhado abaixo."
                        : "Esta OS não tem títulos lançados."}
                    </p>
                  )}
                </div>

                {compartilhados.length ? (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/5">
                    <div className="flex items-center gap-2 border-b border-amber-500/25 px-3 py-2">
                      <Layers className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium">
                        Pagamento múltiplo — o pagador não muda
                      </span>
                    </div>
                    <ul className="divide-y divide-amber-500/15">
                      {compartilhados.map((titulo) => (
                        <li key={titulo.id} className="px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate">
                              {titulo.descricao || `Título #${titulo.id}`}
                            </span>
                            <span className="shrink-0 font-medium">{moeda(titulo.valorFace)}</span>
                          </div>
                          <span className="text-muted-foreground">
                            Esse dinheiro também paga {titulo.outrosDocumentos.join(", ")} — como é
                            um recebimento só, ele continua no pagador atual.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {impacto.resumo.valorBaixado > 0 ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      {moeda(impacto.resumo.valorBaixado)} já foram recebidos e também passam para o
                      novo cliente. O extrato do cliente antigo deixa de mostrar esse recebimento.
                    </span>
                  </p>
                ) : null}

                {veiculoDeOutro && impacto.veiculo ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                    <Car className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      O veículo {impacto.veiculo.placa || impacto.veiculo.descricao || "da OS"}{" "}
                      continua no nome de {impacto.veiculo.proprietarioNome || "outro cliente"}. A
                      troca não muda o dono do veículo — use a transferência de veículo se for o
                      caso.
                    </span>
                  </p>
                ) : null}

                {impacto.notasEmitidas > 0 ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      Esta OS tem {impacto.notasEmitidas} nota(s) fiscal(is) em pé, emitida(s) para o
                      titular antigo. A nota não é alterada — se o tomador estiver errado, cancele e
                      emita de novo.
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void confirmar()}
              disabled={!selecionado || mesmoCliente || carregando || salvando}
            >
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
