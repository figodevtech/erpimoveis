"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogShell } from "../dialogs/dialog-shell";
import { OrdemEditForm } from "./ordem-edit-form";

export function EditarOSDialog({
  open,
  onOpenChange,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultValues: any | null;
}) {
  const submitRef = useRef<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);

  const ordemId = defaultValues?.numero ?? defaultValues?.id ?? "";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={ordemId ? `Ordem de Serviço #${ordemId}` : "Ordem de Serviço"}
      titleSuffix="Edição"
      description="Atualize os dados da ordem de serviço usando o mesmo formulário da criação."
      eyebrow="Bancada de atendimento"
      variant="workbench"
      loading={initialLoading}
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
          <Button onClick={() => submitRef.current?.()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar OS"
            )}
          </Button>
        </>
      }
    >
      <OrdemEditForm
        defaultValues={defaultValues}
        exposeSubmit={(fn) => {
          submitRef.current = fn;
        }}
        onSavingChange={setSaving}
        onInitialLoadingChange={setInitialLoading}
        onClose={() => onOpenChange(false)}
      />
    </DialogShell>
  );
}
