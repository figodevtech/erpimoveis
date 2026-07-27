"use client";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import RegisterContent from "./register-content";
import EditContent from "./edit-content";


interface DialogEntradaGeralProps {
  selectedEntradaId?: number;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function DialogEntradaGeral({
  children,
  open,
  onOpenChange,
  selectedEntradaId,
}: DialogEntradaGeralProps) {

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {selectedEntradaId ? (
        <EditContent selectedEntradaId={selectedEntradaId} />
      ) : (
        <RegisterContent open={open} onOpenChange={onOpenChange} />
      )}
    </Dialog>
  );
}
