// ./src/app/(app)/(pages)/ordens/components/dialogs/realizadores/picker-shell.tsx
"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";

import type { UsuarioAtivo } from "../../../lib/api";
import { useConfig } from "../../../../config-context";
import { UsuariosPicker } from "./usuarios-picker";

type Acao = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  descricao: string;
  usuarios: UsuarioAtivo[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
  onClear: () => void;
  acaoPrincipal: Acao;
  acaoSecundaria?: Acao;
  disabled?: boolean;
};

/**
 * Casca do seletor de executores: drawer no mobile, dialog no desktop.
 * Serve tanto para um serviço específico quanto para a atribuição geral.
 */
export function RealizadoresPickerShell({
  open,
  onOpenChange,
  titulo,
  descricao,
  usuarios,
  selectedIds,
  onToggle,
  onClear,
  acaoPrincipal,
  acaoSecundaria,
  disabled,
}: Props) {
  const config = useConfig();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const usarDrawer = !isDesktop && config?.habilitar_drawers !== false;

  const corpo = (
    <UsuariosPicker
      usuarios={usuarios}
      selectedIds={selectedIds}
      onToggle={onToggle}
      onClear={onClear}
      disabled={disabled}
      className="px-4"
    />
  );

  const acoes = (
    <>
      {acaoSecundaria && (
        <Button
          variant="outline"
          className="h-11 w-full sm:h-10"
          onClick={acaoSecundaria.onClick}
          disabled={disabled || acaoSecundaria.disabled}
        >
          {acaoSecundaria.icon}
          {acaoSecundaria.label}
        </Button>
      )}
      <Button
        className="h-11 w-full sm:h-10"
        onClick={acaoPrincipal.onClick}
        disabled={disabled || acaoPrincipal.disabled}
      >
        {acaoPrincipal.icon}
        {acaoPrincipal.label}
      </Button>
    </>
  );

  if (!usarDrawer) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90svh] max-w-lg flex-col gap-3 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b p-4 pr-11 text-left">
            <DialogTitle className="text-base leading-tight">{titulo}</DialogTitle>
            <DialogDescription className="text-xs">{descricao}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1">{corpo}</div>

          <div className="flex shrink-0 flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end">{acoes}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="h-[92svh] max-h-[92svh]">
        <DrawerHeader className="shrink-0 pb-2">
          <div className="text-left">
            <DrawerTitle className="text-base leading-tight">{titulo}</DrawerTitle>
            <DrawerDescription className="text-xs">{descricao}</DrawerDescription>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1">{corpo}</div>

        <DrawerFooter className="shrink-0 gap-2 border-t pt-3">{acoes}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
