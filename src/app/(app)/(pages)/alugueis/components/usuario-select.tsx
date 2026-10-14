"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Search, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listarUsuariosDestinatarios } from "../lib/api";
import type { UsuarioDestinatario } from "../types";

const TODOS = "todos";
const SEM_SETOR = "sem-setor";

/**
 * Escolhe um usuário do sistema como destinatário do aluguel. Mesmo desenho do
 * seletor de executores da OS (busca + setor), com escolha única.
 */
export function UsuarioSelect({
  open,
  setOpen,
  onSelect,
  selecionadoId,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelect: (usuario: UsuarioDestinatario) => void;
  selecionadoId?: string | null;
  children: ReactNode;
}) {
  const [usuarios, setUsuarios] = useState<UsuarioDestinatario[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [setor, setSetor] = useState(TODOS);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    void Promise.resolve().then(async () => {
      if (!vivo) return;
      setBusca("");
      setCarregando(true);
      setErro(null);
      try {
        const lista = await listarUsuariosDestinatarios();
        if (vivo) setUsuarios(lista);
      } catch (error: any) {
        if (vivo) setErro(error?.message || "Falha ao carregar usuários.");
      } finally {
        if (vivo) setCarregando(false);
      }
    });
    return () => {
      vivo = false;
    };
  }, [open]);

  const setores = useMemo(() => {
    const porId = new Map<string, string>();
    for (const u of usuarios) if (u.setor) porId.set(String(u.setor.id), u.setor.nome);
    return [...porId.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [usuarios]);
  const temSemSetor = usuarios.some((u) => !u.setor);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (setor !== TODOS && (u.setor ? String(u.setor.id) : SEM_SETOR) !== setor) return false;
      if (!q) return true;
      return (u.nome ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
    });
  }, [usuarios, busca, setor]);

  const chip = (valor: string, rotulo: string) => (
    <Button
      key={valor}
      type="button"
      size="sm"
      variant={setor === valor ? "secondary" : "ghost"}
      className="h-7 shrink-0 px-2 text-xs"
      onClick={() => setSetor(valor)}
    >
      {rotulo}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" /> Selecionar usuário
          </DialogTitle>
          <DialogDescription>Usuário do sistema que recebe o aluguel.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Buscar por nome ou e-mail"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {setores.length ? (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {chip(TODOS, "Todos")}
            {setores.map((s) => chip(s.id, s.nome))}
            {temSemSetor ? chip(SEM_SETOR, "Sem setor") : null}
          </div>
        ) : null}

        <div className="min-h-[200px] flex-1 overflow-y-auto rounded-md border">
          {carregando ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando usuários...
            </div>
          ) : erro ? (
            <p className="p-4 text-sm text-red-600">{erro}</p>
          ) : filtrados.length ? (
            <ul className="divide-y">
              {filtrados.map((u) => {
                const ativo = u.id === selecionadoId;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                        ativo && "bg-primary/5",
                      )}
                      onClick={() => {
                        onSelect(u);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.nome || u.email || "Sem nome"}</p>
                        {u.email && u.nome ? <p className="truncate text-xs text-muted-foreground">{u.email}</p> : null}
                      </div>
                      {u.setor ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {u.setor.nome}
                        </Badge>
                      ) : null}
                      {ativo ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
