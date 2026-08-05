// ./src/app/(app)/(pages)/ordens/components/dialogs/realizadores/usuarios-picker.tsx
"use client";

import { useMemo, useState } from "react";
import { Check, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { UsuarioAtivo } from "../../../lib/api";
import { comissaoDe, nomeDe, percent } from "./types";

const TODOS = "todos";
const SEM_SETOR = "sem-setor";
const SETOR_STORAGE_KEY = "erpoficina:realizadores:setor";

type Props = {
  usuarios: UsuarioAtivo[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Seleção de executores: busca + filtro por setor + lista com checkbox.
 * Compartilhado pelo painel do desktop e pelo drawer do mobile.
 */
export function UsuariosPicker({ usuarios, selectedIds, onToggle, onClear, disabled, className }: Props) {
  const [busca, setBusca] = useState("");

  // Reabre no último setor usado — na prática, o setor operacional de quem opera.
  const [setorSel, setSetorSel] = useState<string>(() => {
    if (typeof window === "undefined") return TODOS;
    return window.localStorage.getItem(SETOR_STORAGE_KEY) ?? TODOS;
  });

  const setores = useMemo(() => {
    const porId = new Map<string, string>();
    for (const u of usuarios) if (u.setor) porId.set(String(u.setor.id), u.setor.nome);

    return [...porId.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [usuarios]);

  const temSemSetor = useMemo(() => usuarios.some((u) => !u.setor), [usuarios]);

  // O setor salvo pode não existir mais (setor desativado, outra empresa): cai para "Todos".
  const setorAtivo = useMemo(() => {
    if (setorSel === SEM_SETOR) return temSemSetor ? SEM_SETOR : TODOS;
    if (setorSel !== TODOS && !setores.some((s) => s.id === setorSel)) return TODOS;
    return setorSel;
  }, [setorSel, setores, temSemSetor]);

  function escolherSetor(valor: string) {
    setSetorSel(valor);
    window.localStorage.setItem(SETOR_STORAGE_KEY, valor);
  }

  const selecionados = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();

    const visiveis = usuarios.filter((u) => {
      if (setorAtivo !== TODOS) {
        const chave = u.setor ? String(u.setor.id) : SEM_SETOR;
        if (chave !== setorAtivo) return false;
      }

      if (!q) return true;

      const nome = (u.nome ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return nome.includes(q) || email.includes(q) || u.id.toLowerCase().includes(q);
    });

    // Quem já está atribuído sobe para o topo: evita procurar o próprio selecionado.
    return visiveis.sort((a, b) => {
      const sa = selecionados.has(a.id) ? 0 : 1;
      const sb = selecionados.has(b.id) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return nomeDe(a, a.id).localeCompare(nomeDe(b, b.id), "pt-BR");
    });
  }, [usuarios, busca, setorAtivo, selecionados]);

  const ocultosSelecionados = useMemo(() => {
    const visiveis = new Set(filtrados.map((u) => u.id));
    return selectedIds.filter((id) => !visiveis.has(id)).length;
  }, [filtrados, selectedIds]);

  const mostrarChips = setores.length > 1 || (setores.length === 1 && temSemSetor);

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="h-11 pl-9 text-base sm:h-9 sm:text-sm"
          disabled={disabled}
        />
      </div>

      {mostrarChips && (
        <div className="-mx-1 shrink-0 overflow-x-auto px-1 pb-1">
          <div className="flex w-max items-center gap-1.5">
            <ChipSetor
              ativo={setorAtivo === TODOS}
              onClick={() => escolherSetor(TODOS)}
              disabled={disabled}
              label="Todos"
            />
            {setores.map((s) => (
              <ChipSetor
                key={s.id}
                ativo={setorAtivo === s.id}
                onClick={() => escolherSetor(s.id)}
                disabled={disabled}
                label={s.nome}
              />
            ))}
            {temSemSetor && (
              <ChipSetor
                ativo={setorAtivo === SEM_SETOR}
                onClick={() => escolherSetor(SEM_SETOR)}
                disabled={disabled}
                label="Sem setor"
              />
            )}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {selectedIds.length === 0 ? "Nenhum executor selecionado" : `${selectedIds.length} selecionado(s)`}
          {ocultosSelecionados > 0 ? ` • ${ocultosSelecionados} fora do filtro` : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onClear}
          disabled={disabled || selectedIds.length === 0}
        >
          Limpar
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted/20">
        <ScrollArea className="h-full">
          <div className="space-y-1.5 p-2">
            {filtrados.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <Users className="h-5 w-5" />
                Nenhum usuário encontrado.
              </div>
            ) : (
              filtrados.map((u) => {
                const checked = selecionados.has(u.id);
                const p = comissaoDe(u);

                return (
                  <label
                    key={u.id}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-md px-3 py-2.5 shadow-sm transition sm:min-h-11",
                      disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer select-none",
                      checked ? "bg-primary/10 ring-1 ring-primary/30" : "bg-background/75 hover:bg-background",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => onToggle(u.id)}
                      className="size-5 sm:size-4"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{nomeDe(u, u.id)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u.setor?.nome ?? "Sem setor"}
                        {p > 0 ? ` • comissão ${percent(p)}` : ""}
                      </div>
                    </div>

                    {checked && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </label>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ChipSetor({
  label,
  ativo,
  onClick,
  disabled,
}: {
  label: string;
  ativo: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Badge
      asChild
      variant={ativo ? "default" : "outline"}
      className={cn("cursor-pointer whitespace-nowrap px-3 py-1.5 text-xs", disabled && "pointer-events-none opacity-60")}
    >
      <button type="button" onClick={onClick} disabled={disabled} aria-pressed={ativo}>
        {label}
      </button>
    </Badge>
  );
}
