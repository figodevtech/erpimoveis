"use client";

import type { Usuario } from "../lib/api";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  usuario: Usuario | null;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function DetalhesUsuarioDialog({ open, onOpenChange, usuario }: Props) {
  const campos = usuario ? [
    ["Nome", usuario.nome],
    ["E-mail", usuario.email],
    ["Usuário", usuario.username],
    ["Perfil", usuario.perfil?.nome],
    ["Setor", usuario.setor?.nome],
    ["Situação", usuario.ativo ? "Ativo" : "Inativo"],
    ["Salário", usuario.salario == null ? null : brl.format(usuario.salario)],
    ["Comissão de venda", `${Number(usuario.comissao_venda_percent ?? 0)}%`],
    ["Admissão", usuario.data_admissao],
    ["Demissão", usuario.data_demissao],
  ] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Detalhes do usuário</DialogTitle></DialogHeader>
        {usuario ? (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {campos.map(([rotulo, valor]) => (
              <div key={rotulo} className="min-w-0 rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                <dd className="break-words text-sm font-medium">{valor || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-sm text-muted-foreground">Nenhum usuário selecionado.</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
