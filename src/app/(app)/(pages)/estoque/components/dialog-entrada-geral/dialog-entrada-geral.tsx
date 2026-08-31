"use client";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import RegisterContent from "./register-content";
import EditContent from "./edit-content";
import type { UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";

type BaseDialogEntradaGeralProps = {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onSaved?: () => void | Promise<void>;
};

export type DialogEntradaGeralProps = BaseDialogEntradaGeralProps &
  (
    | {
        inventory?: "produto";
        escopo?: never;
        selectedEntradaId?: number;
      }
    | {
        inventory: "usoconsumo";
        escopo: UsoConsumoEscopo;
        selectedEntradaId?: never;
      }
  );

export function DialogEntradaGeral({
  children,
  open,
  onOpenChange,
  onSaved,
  selectedEntradaId,
  inventory = "produto",
  escopo,
}: DialogEntradaGeralProps) {

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {selectedEntradaId ? (
        <EditContent selectedEntradaId={selectedEntradaId} />
      ) : (
        <RegisterContent
          open={open}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
          inventory={inventory}
          escopo={escopo}
        />
      )}
    </Dialog>
  );
}
