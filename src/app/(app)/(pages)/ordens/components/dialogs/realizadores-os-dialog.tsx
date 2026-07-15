// ./src/app/(app)/(pages)/ordens/components/dialogs/realizadores-os-dialog.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { CheckCircle2, Loader2, Users, XCircle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

import { carregarDetalhesOS, listarUsuariosAtivos, type UsuarioAtivo } from "../../lib/api";

type RealizadorLite = { id: string; nome: string | null };

type ItemServico = {
  ordemservicoid: number;
  servicoid: number;

  quantidade?: number;
  precounitario?: number;
  subtotal?: number;

  servico?: { descricao?: string | null; codigo?: string | null } | null;

  // novo
  realizadores?: RealizadorLite[] | null;

  // legado
  idusuariorealizador?: string | null;
  realizador?: { id: string; nome: string | null } | null;
};

function uniq(arr: string[]) {
  return [...new Set(arr)];
}

function sameIds(a: string[] = [], b: string[] = []) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function getIdsFromItem(it: ItemServico): string[] {
  const ids = (it.realizadores ?? []).map((r) => r?.id).filter(Boolean) as string[];
  if (ids.length) return uniq(ids);

  const legacy = (it.idusuariorealizador ?? "").trim();
  return legacy ? [legacy] : [];
}

function buildRealizadoresFromIds(ids: string[], users: UsuarioAtivo[]): RealizadorLite[] {
  return ids.map((id) => ({
    id,
    nome: users.find((u) => u.id === id)?.nome ?? null,
  }));
}

const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

const percent = (v: number) => `${(Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function getComissaoPercentual(u: UsuarioAtivo | undefined | null): number {
  return Number(u?.comissao_percent ?? 0) || 0;
}

async function putRealizadores(osId: number, servicoId: number, usuarioIds: string[]) {
  const r = await fetch(`/api/ordens/${osId}/servicos/${servicoId}/responsavel`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuarioIds }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Erro ao atualizar realizadores");

  return j as {
    ordemservicoid: number;
    servicoid: number;
    usuarioIds: string[];
    idusuariorealizador: string | null;
    realizadores: RealizadorLite[];
  };
}

export function RealizadoresOSDialog({
  open,
  onOpenChange,
  osId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [itensServico, setItensServico] = useState<ItemServico[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioAtivo[]>([]);

  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [buscaServico, setBuscaServico] = useState("");

  const [selecionados, setSelecionados] = useState<Record<string, string[]>>({});
  const [origSelecionados, setOrigSelecionados] = useState<Record<string, string[]>>({});

  const [activeKey, setActiveKey] = useState<string | null>(null);

  const canFetch = open && !!osId;
  const busy = loading || savingKey != null;

  useEffect(() => {
    if (!canFetch || !osId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [detalhes, users] = await Promise.all([
          carregarDetalhesOS<{ itensServico: ItemServico[] }>(osId),
          listarUsuariosAtivos(),
        ]);

        if (!alive) return;

        const itens = detalhes?.itensServico ?? [];
        setItensServico(itens);
        setUsuarios(users);

        const initial: Record<string, string[]> = {};
        for (const it of itens) {
          const key = `${it.ordemservicoid}-${it.servicoid}`;
          initial[key] = getIdsFromItem(it);
        }

        setSelecionados(initial);
        setOrigSelecionados(initial);

        const firstKey = itens.length ? `${itens[0].ordemservicoid}-${itens[0].servicoid}` : null;
        setActiveKey(firstKey);
      } catch (e: any) {
        if (!alive) return;
        toast.error(e?.message || "Não foi possível carregar realizadores");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [canFetch, osId]);

  const existeComissaoConfigurada = useMemo(() => {
    return usuarios.some((u) => getComissaoPercentual(u) > 0);
  }, [usuarios]);

  const servicosView = useMemo(() => {
    const q = buscaServico.trim().toLowerCase();
    const arr = itensServico.map((it) => {
      const key = `${it.ordemservicoid}-${it.servicoid}`;
      const titulo = it.servico?.descricao || it.servico?.codigo || `Serviço #${it.servicoid}`;
      const baseTotal = Number(it.subtotal ?? 0) || Number(it.quantidade ?? 0) * Number(it.precounitario ?? 0);
      const ids = selecionados[key] ?? [];
      const pendenteSalvar = !sameIds(ids, origSelecionados[key] ?? []);
      const semRealizador = ids.length === 0;
      return { it, key, titulo, baseTotal, selectedCount: ids.length, pendenteSalvar, semRealizador };
    });

    if (!q) return arr;
    return arr.filter((s) => s.titulo.toLowerCase().includes(q) || s.key.includes(q));
  }, [itensServico, buscaServico, selecionados, origSelecionados]);

  const pendentesCount = useMemo(() => servicosView.filter((s) => s.pendenteSalvar).length, [servicosView]);
  const semRealizadorCount = useMemo(() => servicosView.filter((s) => s.semRealizador).length, [servicosView]);

  const active = useMemo(() => {
    if (!activeKey) return null;
    const [os, serv] = activeKey.split("-");
    const ordemservicoid = Number(os);
    const servicoid = Number(serv);

    const it = itensServico.find((x) => x.ordemservicoid === ordemservicoid && x.servicoid === servicoid) ?? null;
    if (!it) return null;

    const titulo = it.servico?.descricao || it.servico?.codigo || `Serviço #${it.servicoid}`;
    const baseTotal = Number(it.subtotal ?? 0) || Number(it.quantidade ?? 0) * Number(it.precounitario ?? 0);
    const ids = selecionados[activeKey] ?? [];
    const pendenteSalvar = !sameIds(ids, origSelecionados[activeKey] ?? []);
    return { it, key: activeKey, titulo, baseTotal, ids, pendenteSalvar };
  }, [activeKey, itensServico, selecionados, origSelecionados]);

  const usuariosFiltrados = useMemo(() => {
    const q = buscaUsuario.trim().toLowerCase();
    if (!q) return usuarios;

    return usuarios.filter((u) => {
      const nome = (u.nome ?? "").toLowerCase();
      const id = (u.id ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return nome.includes(q) || id.includes(q) || email.includes(q);
    });
  }, [usuarios, buscaUsuario]);

  function toggleUser(serviceKey: string, userId: string) {
    setSelecionados((prev) => {
      const current = new Set(prev[serviceKey] ?? []);
      if (current.has(userId)) current.delete(userId);
      else current.add(userId);
      return { ...prev, [serviceKey]: Array.from(current) };
    });
  }

  function limparSelecionados(serviceKey: string) {
    setSelecionados((prev) => ({ ...prev, [serviceKey]: [] }));
  }

  async function salvarServico(it: ItemServico, key: string) {
    if (!osId) return;

    const ids = uniq((selecionados[key] ?? []).filter(Boolean));
    setSavingKey(key);

    // otimista local
    setItensServico((prev) =>
      prev.map((s) => {
        if (s.ordemservicoid !== it.ordemservicoid || s.servicoid !== it.servicoid) return s;

        const otimista = buildRealizadoresFromIds(ids, usuarios);
        const principal = ids[0] ?? null;

        return {
          ...s,
          realizadores: otimista,
          idusuariorealizador: principal,
          realizador: principal ? { id: principal, nome: otimista[0]?.nome ?? null } : null,
        };
      })
    );

    try {
      const resp = await putRealizadores(osId, it.servicoid, ids);

      setItensServico((prev) =>
        prev.map((s) => {
          if (s.ordemservicoid !== resp.ordemservicoid || s.servicoid !== resp.servicoid) return s;

          return {
            ...s,
            realizadores: resp.realizadores ?? [],
            idusuariorealizador: resp.idusuariorealizador,
            realizador: resp.idusuariorealizador
              ? {
                  id: resp.idusuariorealizador,
                  nome: resp.realizadores?.find((r) => r.id === resp.idusuariorealizador)?.nome ?? null,
                }
              : null,
          };
        })
      );

      setOrigSelecionados((prev) => ({ ...prev, [key]: ids }));

      toast.success("Realizadores atualizados");
      window.dispatchEvent(new Event("os:refresh"));
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar realizadores");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy && !v) return;
        onOpenChange(v);
      }}
    >
      {/* Importante: ScrollArea costuma precisar de height real (não só max-height). */}
      <DialogContent className="w-[95vw] sm:max-w-5xl h-[85vh] supports-[height:100svh]:h-[85svh] p-0 overflow-hidden flex flex-col">
        {/* Header fixo */}
        <div className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Realizadores dos serviços (OS #{osId ?? "—"})
            </DialogTitle>
            <DialogDescription>
              Selecione 1 ou mais usuários por serviço. O cálculo usa a base do serviço dividida pelos selecionados.
            </DialogDescription>
          </DialogHeader>

          {!existeComissaoConfigurada && !loading && (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              Nenhum usuário veio com percentual de comissão (&gt; 0). Verifique se <b>comissao_percent</b> está sendo
              retornado em <b>/api/users?ativos=1</b>.
            </div>
          )}
        </div>

        {/* Corpo com 2 scrolls */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="h-full grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[360px_1fr]">
              {/* Coluna esquerda (serviços): header + ScrollArea */}
              <div className="min-h-0 overflow-hidden border-b lg:border-b-0 lg:border-r">
                <div className="h-full min-h-0 flex flex-col p-4 gap-3">
                  <div className="shrink-0 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Serviços</div>
                    <Badge variant={semRealizadorCount > 0 ? "destructive" : "outline"} className="text-xs">
                      {semRealizadorCount > 0 ? `${semRealizadorCount} pendente(s)` : "OK"}
                    </Badge>
                  </div>

                  <div className="shrink-0 flex items-center justify-between gap-2">
                    <Input
                      value={buscaServico}
                      onChange={(e) => setBuscaServico(e.target.value)}
                      placeholder="Buscar serviço..."
                    />
                    <Badge variant="outline" className="text-xs shrink-0">
                      {pendentesCount > 0 ? `${pendentesCount} alter.` : "salvo"}
                    </Badge>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden rounded-md border">
                    <ScrollArea className="h-full">
                      <div className="p-2 space-y-2">
                        {servicosView.length === 0 ? (
                          <div className="text-sm text-muted-foreground p-2">Nenhum serviço encontrado.</div>
                        ) : (
                          servicosView.map((s) => {
                            const isActive = s.key === activeKey;

                            return (
                              <button
                                key={s.key}
                                type="button"
                                onClick={() => setActiveKey(s.key)}
                                className={[
                                  "w-full text-left rounded-md border px-3 py-2 transition",
                                  isActive ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40",
                                ].join(" ")}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-medium truncate">{s.titulo}</div>
                                    <div className="text-xs text-muted-foreground">
                                      base {money(s.baseTotal)} • {s.selectedCount} selecionado(s)
                                    </div>
                                  </div>

                                  <div className="shrink-0 flex items-center gap-2">
                                    {s.semRealizador ? (
                                      <XCircle className="h-4 w-4 text-destructive" />
                                    ) : s.pendenteSalvar ? (
                                      <Badge variant="secondary" className="text-[11px]">
                                        pendente
                                      </Badge>
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </div>

              {/* Coluna direita (usuários + resumo): header + ScrollArea */}
              <div className="min-h-0 overflow-hidden">
                {!active ? (
                  <div className="h-full grid place-items-center text-sm text-muted-foreground p-4">
                    Selecione um serviço à esquerda.
                  </div>
                ) : (
                  <div className="h-full min-h-0 flex flex-col p-4 gap-3">
                    <div className="shrink-0 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{active.titulo}</div>
                        <div className="text-xs text-muted-foreground">
                          base: <b>{money(active.baseTotal)}</b> • selecionados: <b>{active.ids.length}</b>
                          {active.ids.length === 0 ? " • pendente definir realizador" : ""}
                        </div>
                      </div>

                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => limparSelecionados(active.key)}
                          disabled={savingKey === active.key}
                        >
                          Limpar
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => salvarServico(active.it, active.key)}
                          disabled={!active.pendenteSalvar || savingKey === active.key}
                        >
                          {savingKey === active.key ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Salvando…
                            </>
                          ) : (
                            "Salvar Serviço"
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <Input
                        value={buscaUsuario}
                        onChange={(e) => setBuscaUsuario(e.target.value)}
                        placeholder="Buscar usuário por nome, e-mail ou id..."
                      />
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden rounded-md border">
                      <ScrollArea className="h-full">
                        <div className="p-3 space-y-3">
                          {/* Lista de usuários */}
                          <div className="space-y-2">
                            {usuariosFiltrados.map((u) => {
                              const checked = active.ids.includes(u.id);
                              const p = getComissaoPercentual(u);

                              return (
                                <label
                                  key={u.id}
                                  className={[
                                    "flex items-center gap-2 rounded-md border px-2 py-2 cursor-pointer select-none",
                                    checked ? "bg-primary/5 border-primary/30" : "hover:bg-muted/40",
                                  ].join(" ")}
                                >
                                  <Checkbox checked={checked} onCheckedChange={() => toggleUser(active.key, u.id)} />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm truncate">{u.nome ?? u.email ?? u.id}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {u.email ?? u.id} • comissão {percent(p)}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>

                          {/* Resumo / cálculos (fica no mesmo scroll da coluna direita) */}
                          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Base do serviço</span>
                              <span className="font-medium">{money(active.baseTotal)}</span>
                            </div>

                            {/* <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Base por realizador (dividida)</span>
                              <span className="font-medium">{money(breakdown.basePorRealizador)}</span>
                            </div>

                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Total de comissão (selecionados)</span>
                              <span className="font-medium">{money(breakdown.totalComissao)}</span>
                            </div> */}

                            {/* {breakdown.rows.length > 0 && (
                              <div className="pt-2 space-y-1">
                                {breakdown.rows.map((b) => (
                                  <div key={b.userId} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="truncate">
                                      {b.nome} • {percent(b.p)} • base {money(b.base)}
                                    </span>
                                    <span className="font-medium">{money(b.comissao)}</span>
                                  </div>
                                ))}
                              </div>
                            )} */}
                          </div>

                          <div className="h-2" />
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer fixo */}
        <div className="shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {pendentesCount > 0 ? `${pendentesCount} serviço(s) com alterações pendentes` : "Nenhuma alteração pendente"}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
