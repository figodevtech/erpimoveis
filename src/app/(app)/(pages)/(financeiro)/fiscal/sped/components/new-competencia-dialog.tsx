"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

function previousMonth() {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
}

export function NewCompetenciaDialog({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  /** Resolve true quando a competência foi criada e o diálogo pode fechar. */
  onCreate: (competencia: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(previousMonth);
  const [busy, setBusy] = useState(false);
  const valid = COMPETENCIA.test(value);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (await onCreate(value)) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <CalendarPlus aria-hidden="true" />
        Nova competência
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova competência SPED</DialogTitle>
            <DialogDescription>
              Abre o período para diagnóstico. Nada é escriturado até a validação; se a competência já existir, ela é aberta.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Label htmlFor="sped-nova-competencia">Mês de referência</Label>
            <Input
              id="sped-nova-competencia"
              type="month"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
            {!valid ? <p className="text-xs text-destructive">Informe mês e ano.</p> : null}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!valid || busy} onClick={() => void submit()}>
              {busy ? "Criando..." : "Criar competência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
