"use client";

import * as React from "react";
import type { Perfil, Permissao } from "../types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

type Props = {
  aberto: boolean;
  setAberto: (v: boolean) => void;
  modo: "criar" | "editar";
  perfilInicial?: Perfil | null;
  permissoesDisponiveis: Permissao[];
  carregandoConteudo?: boolean;
  salvando: boolean;
  onSalvar: (dados: {
    nome: string;
    descricao: string;
    permissoesIds: number[];
  }) => Promise<void>;
};

const ACTION_LABELS: Record<string, string> = {
  visualizar: "Visualizar",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
  rentabilidade: "Ver rentabilidade",
  eventos_financeiros: "Ver eventos financeiros",
  entrada: "Entrada",
  saida: "Saída",
  cancelar_movimento: "Cancelar movimento",
  notas_fiscais: "Notas fiscais",
  finalizar_sem_cobranca: "Finalizar sem cobrança",
};

const MODULE_LABELS: Record<string, string> = {
  usoconsumo: "Uso/Consumo",
  radios: "Rádio",
};

function formatModulo(nome: string) {
  const [modulo] = nome.split(":");
  if (MODULE_LABELS[modulo]) return MODULE_LABELS[modulo];
  return modulo
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAcao(nome: string) {
  const acao = nome.split(":")[1] ?? nome;
  const label = ACTION_LABELS[acao] ?? acao.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function DialogPerfil({
  aberto,
  setAberto,
  modo,
  perfilInicial,
  permissoesDisponiveis,
  carregandoConteudo = false,
  salvando,
  onSalvar,
}: Props) {
  const [nome, setNome] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [selecionadas, setSelecionadas] = React.useState<Set<number>>(
    new Set(),
  );
  const permissoesPorModulo = React.useMemo(() => {
    const grupos = new Map<string, Permissao[]>();

    for (const perm of permissoesDisponiveis) {
      const modulo = perm.nome.includes(":")
        ? formatModulo(perm.nome)
        : "Permissões antigas";
      grupos.set(modulo, [...(grupos.get(modulo) ?? []), perm]);
    }

    return Array.from(grupos.entries()).map(([modulo, permissoes]) => ({
      modulo,
      permissoes: permissoes.sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  }, [permissoesDisponiveis]);

  React.useEffect(() => {
    if (!aberto) return;

    if (modo === "editar" && perfilInicial) {
      setNome(perfilInicial.nome ?? "");
      setDescricao(perfilInicial.descricao ?? "");
      setSelecionadas(
        new Set((perfilInicial.permissoes ?? []).map((p) => p.id)),
      );
    } else {
      setNome("");
      setDescricao("");
      setSelecionadas(new Set());
    }
  }, [aberto, modo, perfilInicial]);

  const alternarPermissao = (id: number) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const salvar = async () => {
    const nomeOk = nome.trim();
    if (!nomeOk) return;

    await onSalvar({
      nome: nomeOk,
      descricao: descricao.trim(),
      permissoesIds: Array.from(selecionadas.values()),
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent
        className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[760px] sm:w-[85vw] sm:min-w-0 sm:max-w-[900px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {carregandoConteudo ? (
          <>
            <DialogHeader className="hidden">
              <DialogTitle>
                {modo === "criar" ? "Criar Perfil" : "Editar Perfil"}
              </DialogTitle>
            </DialogHeader>

            <div className="flex h-full min-h-0 flex-col items-center justify-center">
              <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
              <span className="text-primary">Carregando</span>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <DialogTitle>
                {modo === "criar" ? "Criar Perfil" : "Editar Perfil"}
              </DialogTitle>
            </DialogHeader>

            <div className="h-full min-h-0 space-y-4 overflow-auto px-6 py-6">
              <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Ex. Administrador"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Input
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                </div>
                <div className="space-y-2">

                  <ScrollArea className="">
                    <div className="space-y-2 p-3">
                  <Label>Permissões</Label>
                <Separator />
                      {permissoesDisponiveis.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma permissão cadastrada.
                        </p>
                      ) : (
                        permissoesPorModulo.map((grupo) => (
                          <div
                            key={grupo.modulo}
                            className="rounded-md border bg-background"
                          >
                            <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                              {grupo.modulo}
                            </div>
                            <div className="grid gap-1 p-2 sm:grid-cols-2">
                              {grupo.permissoes.map((perm) => {
                                const marcado = selecionadas.has(perm.id);
                                return (
                                  <label
                                    key={perm.id}
                                    className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                                  >
                                    <Checkbox
                                      checked={marcado}
                                      onCheckedChange={() =>
                                        alternarPermissao(perm.id)
                                      }
                                      className="mt-0.5"
                                    />
                                    <div className="leading-tight">
                                      <div className="text-sm font-medium">
                                        {perm.nome.includes(":")
                                          ? formatAcao(perm.nome)
                                          : perm.nome}
                                      </div>
                                      {perm.descricao ? (
                                        <div className="text-xs text-muted-foreground">
                                          {perm.descricao}
                                        </div>
                                      ) : null}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setAberto(false)}
                disabled={salvando}
              >
                Cancelar
              </Button>

              <Button onClick={salvar} disabled={salvando || !nome.trim()}>
                {salvando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
