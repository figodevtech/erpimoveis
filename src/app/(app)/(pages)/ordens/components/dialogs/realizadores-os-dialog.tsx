// ./src/app/(app)/(pages)/ordens/components/dialogs/realizadores-os-dialog.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CopyCheck,
  Loader2,
  Play,
  Save,
  Search,
  UserPlus,
  Users,
  UsersRound,
  XCircle,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

import {
  atualizarResponsaveisServico,
  carregarDetalhesOS,
  listarRealizadoresDisponiveis,
  type UsuarioAtivo,
} from "../../lib/api";
import { RealizadoresPickerShell } from "./realizadores/picker-shell";
import { UsuariosPicker } from "./realizadores/usuarios-picker";
import {
  baseServico,
  idsDoItem,
  money,
  resumoNomes,
  sameIds,
  servicoKey,
  tituloServico,
  uniq,
  type ItemServico,
  type ServicoLinha,
} from "./realizadores/types";

export function RealizadoresOSDialog({
  open,
  onOpenChange,
  osId,
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number | null;
  onStart: () => Promise<boolean>;
}) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [loading, setLoading] = useState(false);
  const [savingAction, setSavingAction] = useState<"save" | "start" | null>(null);

  const [itensServico, setItensServico] = useState<ItemServico[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioAtivo[]>([]);

  const [buscaServico, setBuscaServico] = useState("");

  const [selecionados, setSelecionados] = useState<Record<string, string[]>>({});
  const [origSelecionados, setOrigSelecionados] = useState<Record<string, string[]>>({});
  const [errosSalvar, setErrosSalvar] = useState<Record<string, string>>({});

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const [geralOpen, setGeralOpen] = useState(false);
  const [geralIds, setGeralIds] = useState<string[]>([]);

  const canFetch = open && !!osId;
  const busy = loading || savingAction != null;

  useEffect(() => {
    if (!canFetch || !osId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [detalhes, users] = await Promise.all([
          carregarDetalhesOS<{ itensServico: ItemServico[] }>(osId),
          listarRealizadoresDisponiveis(),
        ]);

        if (!alive) return;

        const itens = detalhes?.itensServico ?? [];
        const inicial: Record<string, string[]> = {};
        for (const it of itens) inicial[servicoKey(it)] = idsDoItem(it);

        setItensServico(itens);
        setUsuarios(users);
        setSelecionados(inicial);
        setOrigSelecionados(inicial);
        setErrosSalvar({});
        setActiveKey(itens.length ? servicoKey(itens[0]) : null);
      } catch (e: any) {
        if (!alive) return;
        toast.error(e?.message || "Não foi possível carregar os executores");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [canFetch, osId]);

  // Fecha limpo: evita mostrar os serviços da OS anterior no próximo open.
  useEffect(() => {
    if (open) return;

    setItensServico([]);
    setSelecionados({});
    setOrigSelecionados({});
    setErrosSalvar({});
    setActiveKey(null);
    setPickerKey(null);
    setGeralOpen(false);
    setGeralIds([]);
    setBuscaServico("");
  }, [open]);

  const servicos = useMemo<ServicoLinha[]>(() => {
    return itensServico.map((it) => {
      const key = servicoKey(it);
      const ids = selecionados[key] ?? [];

      return {
        key,
        servicoid: it.servicoid,
        titulo: tituloServico(it),
        baseTotal: baseServico(it),
        ids,
        pendenteSalvar: !sameIds(ids, origSelecionados[key] ?? []),
        semRealizador: ids.length === 0,
        erroSalvar: errosSalvar[key] ?? null,
      };
    });
  }, [itensServico, selecionados, origSelecionados, errosSalvar]);

  const servicosView = useMemo(() => {
    const q = buscaServico.trim().toLowerCase();
    if (!q) return servicos;
    return servicos.filter((s) => s.titulo.toLowerCase().includes(q));
  }, [servicos, buscaServico]);

  const pendentesCount = useMemo(() => servicos.filter((s) => s.pendenteSalvar).length, [servicos]);
  const semRealizadorCount = useMemo(() => servicos.filter((s) => s.semRealizador).length, [servicos]);

  const active = useMemo(() => servicos.find((s) => s.key === activeKey) ?? null, [servicos, activeKey]);
  const emEdicao = useMemo(() => servicos.find((s) => s.key === pickerKey) ?? null, [servicos, pickerKey]);

  /** Traz um serviço para a frente do usuário, mesmo se a busca estiver escondendo ele. */
  const focarServico = useCallback((key: string) => {
    setBuscaServico("");
    setActiveKey(key);
  }, []);

  const toggleUser = useCallback((serviceKey: string, userId: string) => {
    setSelecionados((prev) => {
      const atual = new Set(prev[serviceKey] ?? []);
      if (atual.has(userId)) atual.delete(userId);
      else atual.add(userId);
      return { ...prev, [serviceKey]: Array.from(atual) };
    });
  }, []);

  const limparServico = useCallback((serviceKey: string) => {
    setSelecionados((prev) => ({ ...prev, [serviceKey]: [] }));
  }, []);

  const aplicarEmTodos = useCallback(
    (ids: string[]) => {
      setSelecionados((prev) => {
        const next = { ...prev };
        for (const s of servicos) next[s.key] = [...ids];
        return next;
      });

      toast.success(`Executores aplicados a ${servicos.length} serviço(s).`);
    },
    [servicos],
  );

  /** Copia a seleção de um serviço para os demais. */
  const copiarParaTodos = useCallback(
    (serviceKey: string) => {
      const ids = selecionados[serviceKey] ?? [];
      if (ids.length === 0) return;
      aplicarEmTodos(ids);
    },
    [selecionados, aplicarEmTodos],
  );

  /** Atribuição geral: define de uma vez quem executa a OS inteira. */
  const abrirAtribuicaoGeral = useCallback(() => {
    // Pré-marca quem já está em TODOS os serviços.
    const comuns = servicos.reduce<string[]>(
      (acc, s, i) => (i === 0 ? [...s.ids] : acc.filter((id) => s.ids.includes(id))),
      [],
    );

    setGeralIds(comuns);
    setGeralOpen(true);
  }, [servicos]);

  const toggleGeral = useCallback((userId: string) => {
    setGeralIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }, []);

  async function salvarTodos(iniciar: boolean) {
    if (!osId || busy) return;

    const primeiroSemRealizador = servicos.find((s) => s.semRealizador);
    if (iniciar && primeiroSemRealizador) {
      focarServico(primeiroSemRealizador.key);
      toast.error("Selecione ao menos um executor para todos os serviços antes de iniciar a OS.");
      return;
    }

    const alterados = servicos.filter((s) => s.pendenteSalvar);
    if (!iniciar && alterados.length === 0) {
      toast.info("Nenhuma alteração pendente para salvar.");
      return;
    }

    setSavingAction(iniciar ? "start" : "save");

    try {
      const resultados = await Promise.all(
        alterados.map(async (servico) => {
          const ids = uniq((selecionados[servico.key] ?? []).filter(Boolean));

          try {
            const response = await atualizarResponsaveisServico(osId, servico.servicoid, ids);
            return { key: servico.key, titulo: servico.titulo, ids, response, erro: null as string | null };
          } catch (e) {
            const erro = e instanceof Error ? e.message : "Erro desconhecido";
            return { key: servico.key, titulo: servico.titulo, ids, response: null, erro };
          }
        }),
      );

      const salvos = resultados.filter((r) => r.response !== null);
      const falhas = resultados.filter((r) => r.erro !== null);

      if (salvos.length > 0) {
        const porServico = new Map(salvos.map((s) => [s.key, s]));

        setItensServico((prev) =>
          prev.map((item) => {
            const salvo = porServico.get(servicoKey(item));
            if (!salvo?.response) return item;
            return { ...item, realizadores: salvo.response.realizadores ?? [] };
          }),
        );

        setOrigSelecionados((prev) => {
          const next = { ...prev };
          for (const salvo of salvos) next[salvo.key] = salvo.ids;
          return next;
        });

        window.dispatchEvent(new Event("os:refresh"));
      }

      setErrosSalvar((prev) => {
        const next = { ...prev };
        for (const r of resultados) {
          if (r.erro) next[r.key] = r.erro;
          else delete next[r.key];
        }
        return next;
      });

      if (falhas.length > 0) {
        focarServico(falhas[0].key);
        toast.error(`${falhas.length} serviço(s) não foram salvos.`, {
          description: `${falhas[0].titulo}: ${falhas[0].erro}`,
        });
        return;
      }

      if (!iniciar) {
        toast.success("Executores atualizados.");
        return;
      }

      if (alterados.length > 0) toast.success("Executores salvos. Iniciando a OS...");
      const iniciou = await onStart();
      if (iniciou) onOpenChange(false);
    } finally {
      setSavingAction(null);
    }
  }

  const resumoRodape =
    semRealizadorCount > 0
      ? `${semRealizadorCount} serviço(s) sem executor`
      : pendentesCount > 0
        ? `${pendentesCount} serviço(s) com alterações pendentes`
        : "Tudo salvo";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (busy && !v) return;
          onOpenChange(v);
        }}
      >
        <DialogContent className="flex h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-0 sm:h-[90svh] sm:w-[95vw] sm:max-w-5xl sm:rounded-lg">
          <div className="shrink-0 border-b bg-background/95 p-4 pr-11 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-5 sm:pr-11">
            <DialogHeader>
              <DialogTitle className="flex items-start gap-2 text-base leading-tight sm:items-center sm:text-lg">
                <Users className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0" />
                <span>
                  Executores dos serviços <span className="whitespace-nowrap">(OS #{osId ?? "—"})</span>
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                {isDesktop
                  ? "Escolha um serviço e marque quem vai executá-lo. Tudo é salvo de uma vez."
                  : "Toque em um serviço para escolher quem vai executá-lo."}
              </DialogDescription>
            </DialogHeader>

            {!loading && servicos.length > 1 && (
              <Button
                variant="outline"
                className="mt-3 h-11 w-full sm:h-9 sm:w-auto"
                onClick={abrirAtribuicaoGeral}
                disabled={busy}
              >
                <UsersRound className="mr-2 h-4 w-4" />
                Atribuição geral
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="grid h-full place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : servicos.length === 0 ? (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
                Esta OS não tem serviços lançados.
              </div>
            ) : isDesktop ? (
              <div className="grid h-full min-h-0 grid-cols-[360px_1fr]">
                <div className="min-h-0 overflow-hidden border-r border-border/50 bg-muted/10">
                  <div className="flex h-full min-h-0 flex-col gap-3 p-4">
                    <BuscaServicos value={buscaServico} onChange={setBuscaServico} />
                    <ListaServicos
                      servicos={servicosView}
                      usuarios={usuarios}
                      activeKey={activeKey}
                      onSelect={setActiveKey}
                      variant="desktop"
                    />
                  </div>
                </div>

                <div className="min-h-0 overflow-hidden">
                  {!active ? (
                    <div className="grid h-full place-items-center p-4 text-sm text-muted-foreground">
                      Selecione um serviço à esquerda.
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
                      <div className="flex shrink-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{active.titulo}</div>
                          <div className="text-xs text-muted-foreground">
                            base <b>{money(active.baseTotal)}</b>
                          </div>
                        </div>

                        {servicos.length > 1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => copiarParaTodos(active.key)}
                            disabled={busy || active.ids.length === 0}
                          >
                            <CopyCheck className="mr-2 h-4 w-4" />
                            Copiar para todos
                          </Button>
                        )}
                      </div>

                      {active.erroSalvar && <AvisoErro mensagem={active.erroSalvar} />}

                      <UsuariosPicker
                        usuarios={usuarios}
                        selectedIds={active.ids}
                        onToggle={(userId) => toggleUser(active.key, userId)}
                        onClear={() => limparServico(active.key)}
                        disabled={busy}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3 p-3">
                {servicos.length > 4 && <BuscaServicos value={buscaServico} onChange={setBuscaServico} />}
                <ListaServicos
                  servicos={servicosView}
                  usuarios={usuarios}
                  activeKey={null}
                  onSelect={setPickerKey}
                  variant="mobile"
                />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div
                className={cn(
                  "truncate text-center text-xs sm:text-left",
                  semRealizadorCount > 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {resumoRodape}
              </div>

              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                <Button
                  className="order-2 h-11 sm:order-none sm:h-9"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Fechar
                </Button>
                <Button
                  className="order-3 h-11 sm:order-none sm:h-9"
                  variant="outline"
                  onClick={() => salvarTodos(false)}
                  disabled={busy || pendentesCount === 0}
                >
                  {savingAction === "save" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar
                </Button>
                <Button
                  className="order-1 col-span-2 h-11 sm:order-none sm:h-9"
                  onClick={() => salvarTodos(true)}
                  disabled={busy || semRealizadorCount > 0}
                >
                  {savingAction === "start" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {pendentesCount > 0 ? "Salvar e iniciar" : "Iniciar OS"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RealizadoresPickerShell
        open={!isDesktop && pickerKey !== null}
        onOpenChange={(v) => {
          if (!v) setPickerKey(null);
        }}
        titulo={emEdicao?.titulo ?? "Serviço"}
        descricao={
          emEdicao ? `Base ${money(emEdicao.baseTotal)} • ${emEdicao.ids.length} selecionado(s)` : ""
        }
        usuarios={usuarios}
        selectedIds={emEdicao?.ids ?? []}
        onToggle={(userId) => pickerKey && toggleUser(pickerKey, userId)}
        onClear={() => pickerKey && limparServico(pickerKey)}
        acaoPrincipal={{ label: "Concluir", onClick: () => setPickerKey(null) }}
        acaoSecundaria={
          servicos.length > 1
            ? {
                label: `Copiar para os ${servicos.length} serviços`,
                icon: <CopyCheck className="mr-2 h-4 w-4" />,
                disabled: !emEdicao || emEdicao.ids.length === 0,
                onClick: () => {
                  if (!pickerKey) return;
                  copiarParaTodos(pickerKey);
                  setPickerKey(null);
                },
              }
            : undefined
        }
        disabled={busy}
      />

      <RealizadoresPickerShell
        open={geralOpen}
        onOpenChange={setGeralOpen}
        titulo="Atribuição geral"
        descricao={`Define os mesmos executores para os ${servicos.length} serviços da OS, substituindo o que já estiver marcado.`}
        usuarios={usuarios}
        selectedIds={geralIds}
        onToggle={toggleGeral}
        onClear={() => setGeralIds([])}
        acaoPrincipal={{
          label: `Aplicar aos ${servicos.length} serviços`,
          icon: <UsersRound className="mr-2 h-4 w-4" />,
          disabled: geralIds.length === 0,
          onClick: () => {
            aplicarEmTodos(geralIds);
            setGeralOpen(false);
          },
        }}
        disabled={busy}
      />
    </>
  );
}

function BuscaServicos({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative shrink-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar serviço..."
        className="h-11 pl-9 text-base sm:h-9 sm:text-sm"
      />
    </div>
  );
}

function AvisoErro({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{mensagem}</span>
    </div>
  );
}

function ListaServicos({
  servicos,
  usuarios,
  activeKey,
  onSelect,
  variant,
}: {
  servicos: ServicoLinha[];
  usuarios: UsuarioAtivo[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  variant: "mobile" | "desktop";
}) {
  const isMobile = variant === "mobile";

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted/25">
      <ScrollArea className="h-full">
        <div className="space-y-2 p-2">
          {servicos.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Nenhum serviço encontrado.</div>
          ) : (
            servicos.map((s) => {
              const isActive = s.key === activeKey;
              const nomes = resumoNomes(s.ids, usuarios);

              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onSelect(s.key)}
                  className={cn(
                    "w-full rounded-md px-3 text-left shadow-sm transition",
                    isMobile ? "py-3.5" : "py-2.5",
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : s.semRealizador
                        ? "bg-background/75 ring-1 ring-destructive/25 hover:bg-background"
                        : "bg-background/75 hover:bg-background",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.titulo}</div>

                      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                        {s.semRealizador ? (
                          <span className="inline-flex items-center gap-1 font-medium text-destructive">
                            <UserPlus className="h-3.5 w-3.5" />
                            Definir executor
                          </span>
                        ) : (
                          <span className="truncate text-muted-foreground">{nomes}</span>
                        )}
                      </div>

                      <div className="mt-0.5 text-xs text-muted-foreground">base {money(s.baseTotal)}</div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {s.erroSalvar ? (
                        <Badge variant="destructive" className="text-[11px]">
                          falhou
                        </Badge>
                      ) : s.semRealizador ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : s.pendenteSalvar ? (
                        <Badge variant="secondary" className="text-[11px]">
                          pendente
                        </Badge>
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}

                      {isMobile && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
