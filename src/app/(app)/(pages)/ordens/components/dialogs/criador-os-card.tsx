"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowRight, Check, ChevronsUpDown, Loader2, UserCog, UserRound } from "lucide-react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { UsuarioAtivo } from "../../lib/api";

type Impacto = {
  status: string;
  criadorAtual: { id: string; nome: string | null } | null;
  comissaoCriacaoAtual: number;
  semCobranca: boolean;
  bloqueio: string | null;
  mesesFechados: string[];
  candidato: {
    id: string;
    nome: string | null;
    ativo: boolean;
    percentualServicos: number;
    percentualProdutos: number;
  } | null;
};

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percentual(valor: number) {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Card "Criado por" do resumo da OS.
 *
 * Todo mundo vê quem abriu a OS. Trocar exige `ordens:alterar_criador`, porque
 * o criador recebe a comissão de criação e a troca a transfere — a regra mora
 * em `trocar_criador_os`, que reapura pela taxa de quem entra.
 */
export function CriadorOsCard({
  osId,
  criador,
  responsaveis,
  onTrocado,
}: {
  osId: number;
  criador?: { id: string; nome?: string | null } | null;
  responsaveis: UsuarioAtivo[];
  onTrocado?: () => void;
}) {
  const { data: session } = useSession();
  const podeAlterar = permissionSetHas((session?.user as any)?.permissoes, PERMS.ORDENS_ALTERAR_CRIADOR);

  const [aberto, setAberto] = useState(false);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const usuarios = useMemo(
    () =>
      [...responsaveis].sort((a, b) => (a.nome ?? a.id).localeCompare(b.nome ?? b.id, "pt-BR")),
    [responsaveis],
  );
  const selecionado = usuarios.find((usuario) => usuario.id === selecionadoId) ?? null;
  const mesmoCriador = selecionadoId != null && selecionadoId === criador?.id;

  const carregarImpacto = useCallback(
    async (usuarioId: string | null) => {
      setCarregando(true);
      try {
        const query = usuarioId ? `?usuarioId=${encodeURIComponent(usuarioId)}` : "";
        const resposta = await fetch(`/api/ordens/${osId}/criador${query}`, { cache: "no-store" });
        const corpo = await resposta.json().catch(() => ({}) as any);
        if (!resposta.ok) throw new Error(corpo?.error || "Falha ao carregar o criador da OS.");
        setImpacto(corpo as Impacto);
      } catch (erro: any) {
        toast.error(erro?.message || "Falha ao carregar o criador da OS.");
        setImpacto(null);
      } finally {
        setCarregando(false);
      }
    },
    [osId],
  );

  useEffect(() => {
    if (!aberto) return;
    void carregarImpacto(selecionadoId);
  }, [aberto, selecionadoId, carregarImpacto]);

  function abrir() {
    setSelecionadoId(null);
    setImpacto(null);
    setAberto(true);
  }

  async function confirmar() {
    if (!selecionadoId || mesmoCriador || impacto?.bloqueio) return;
    setSalvando(true);
    const idToast = toast.loading("Trocando o criador da OS...", { duration: Infinity });
    try {
      const resposta = await fetch(`/api/ordens/${osId}/criador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: selecionadoId }),
      });
      const corpo = await resposta.json().catch(() => ({}) as any);
      if (!resposta.ok) throw new Error(corpo?.error || "Falha ao trocar o criador da OS.");

      const anterior = Number(corpo?.comissaoAnterior ?? 0);
      const nova = Number(corpo?.comissaoNova ?? 0);
      toast.success(
        anterior || nova
          ? `Criador trocado. Comissão de criação: ${moeda(anterior)} → ${moeda(nova)}.`
          : "Criador da OS trocado.",
        { id: idToast, duration: 4000 },
      );
      if (corpo?.aviso) toast.warning(corpo.aviso, { duration: 10000 });

      setAberto(false);
      onTrocado?.();
      window.dispatchEvent(new CustomEvent("os:refresh"));
    } catch (erro: any) {
      toast.error(erro?.message || "Falha ao trocar o criador da OS.", { id: idToast, duration: 5000 });
      void carregarImpacto(selecionadoId);
    } finally {
      setSalvando(false);
    }
  }

  const candidato = impacto?.candidato ?? null;
  const candidatoSemTaxa =
    candidato != null && !candidato.percentualServicos && !candidato.percentualProdutos;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <UserRound className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Criado por</span>
        {podeAlterar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 shrink-0 gap-1 px-2 text-xs hover:cursor-pointer"
            title="Trocar o criador desta OS"
            onClick={abrir}
          >
            <UserCog className="h-3.5 w-3.5" />
            Trocar
          </Button>
        ) : null}
      </div>
      <div className="text-sm">{criador?.nome || "—"}</div>

      {podeAlterar ? (
        <Dialog open={aberto} onOpenChange={(estado) => !salvando && setAberto(estado)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Trocar o criador da OS #{osId}</DialogTitle>
              <DialogDescription>
                O novo criador passa a receber a comissão de criação desta OS, recalculada pela taxa
                dele. A troca fica registrada no histórico da OS.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Criador atual
                  </span>
                  <p className="truncate text-sm font-medium">{criador?.nome || "Sem criador"}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Novo criador
                  </span>
                  <Popover modal open={seletorAberto} onOpenChange={setSeletorAberto}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={seletorAberto}
                        className="mt-0.5 h-8 w-full justify-between text-sm"
                        disabled={salvando}
                      >
                        <span className={cn("truncate", !selecionado && "text-muted-foreground")}>
                          {selecionado?.nome || selecionado?.id || "Selecione..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0"
                      align="start"
                      style={{ width: "var(--radix-popover-trigger-width)", minWidth: 240 }}
                      onWheel={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      <Command>
                        <CommandInput placeholder="Buscar usuário..." className="h-9 text-base" />
                        <CommandList className="max-h-60 overflow-auto" onWheel={(e) => e.stopPropagation()}>
                          <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                          <CommandGroup heading="Usuários ativos">
                            {usuarios.map((usuario) => (
                              <CommandItem
                                key={usuario.id}
                                value={`${usuario.nome ?? ""} ${usuario.email ?? ""} ${usuario.id}`}
                                className="hover:cursor-pointer"
                                onSelect={() => {
                                  setSelecionadoId(usuario.id);
                                  setSeletorAberto(false);
                                }}
                              >
                                <span className="truncate">{usuario.nome || usuario.id}</span>
                                {usuario.id === criador?.id ? (
                                  <span className="text-xs text-muted-foreground">atual</span>
                                ) : null}
                                <Check
                                  className={cn(
                                    "ml-auto h-4 w-4",
                                    selecionadoId === usuario.id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {mesmoCriador ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Este já é o criador da OS. Selecione outro usuário.
                </p>
              ) : null}

              {carregando && !impacto ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Levantando o que muda...
                </div>
              ) : impacto ? (
                <div className="space-y-3">
                  <div className="space-y-1.5 rounded-lg border p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        Comissão de criação atual
                        {impacto.criadorAtual?.nome ? ` (${impacto.criadorAtual.nome})` : ""}
                      </span>
                      <span className="font-medium">{moeda(impacto.comissaoCriacaoAtual)}</span>
                    </div>
                    {impacto.semCobranca ? (
                      <p className="text-muted-foreground">
                        OS sem cobrança: não há comissão de criação para transferir.
                      </p>
                    ) : candidato && !mesmoCriador ? (
                      <p className="text-muted-foreground">
                        {candidatoSemTaxa
                          ? `${candidato.nome || "O novo criador"} não tem comissão de criação cadastrada: a OS fica sem essa comissão.`
                          : `Será recalculada pela taxa de ${candidato.nome || "quem entra"}: ` +
                            `${percentual(candidato.percentualServicos)} dos serviços e ` +
                            `${percentual(candidato.percentualProdutos)} dos produtos.`}
                      </p>
                    ) : null}
                  </div>

                  {impacto.bloqueio ? (
                    <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span>{impacto.bloqueio}</span>
                    </p>
                  ) : impacto.mesesFechados.length ? (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span>
                        Esta OS tem lançamentos com competência em {impacto.mesesFechados.join(", ")},
                        mês já fechado na DRE. A comissão de criação desse período será recalculada.
                      </span>
                    </p>
                  ) : null}

                  {candidato && !candidato.ativo ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {candidato.nome || "Este usuário"} está inativo e não pode ser o criador da OS.
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
                disabled={
                  !selecionadoId ||
                  mesmoCriador ||
                  carregando ||
                  salvando ||
                  Boolean(impacto?.bloqueio) ||
                  candidato?.ativo === false
                }
              >
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirmar troca
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
