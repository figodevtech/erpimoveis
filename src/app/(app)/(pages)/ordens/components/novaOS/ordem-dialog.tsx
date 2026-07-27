"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogShell } from "../dialogs/dialog-shell";
import { FormularioNovaOS } from "./ordem-form";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function NovaOSDialog({ open, onOpenChange }: Props) {
  const submitRef = useRef<null | ((mode?: "CHECKLIST" | "ORCAMENTO") => Promise<void>)>(null);
  const [saving, setSaving] = useState(false);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Ordem de Serviço"
      titleSuffix="Nova"
      description="Preencha o formulário para criação da ordem de serviço."
      maxW="md:max-w-[1100px]"
      mobileFull
      fixedHeight
      footer={
        <>
          <Button
            variant="outline"
            className="bg-transparent"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>

          <Button
            variant="secondary"
            onClick={() => submitRef.current?.("ORCAMENTO")}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar como orçamento"
            )}
          </Button>

          <Button onClick={() => submitRef.current?.("CHECKLIST")} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Criar OS"
            )}
          </Button>
        </>
      }
    >
      <FormularioNovaOS
        exposeSubmit={(fn) => {
          submitRef.current = fn;
        }}
        onDone={() => onOpenChange(false)}
        onSavingChange={setSaving}
      />
    </DialogShell>
  );
}
