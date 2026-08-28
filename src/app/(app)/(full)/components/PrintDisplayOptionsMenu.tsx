"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PrintDisplayOption = {
  /** Atributo booleano gravado em `<html>` — o CSS da folha decide o que ele mostra ou esconde. */
  attribute: string;
  label: string;
  defaultChecked?: boolean;
};

function useAtributoHtml(atributo: string, defaultChecked: boolean) {
  const [ativo, setAtivo] = useState(defaultChecked);

  useEffect(() => {
    const html = document.documentElement;

    if (ativo) {
      html.setAttribute(atributo, "1");
    } else {
      html.removeAttribute(atributo);
    }

    return () => html.removeAttribute(atributo);
  }, [ativo, atributo]);

  return [ativo, setAtivo] as const;
}

function OptionCheckboxItem({ option }: { option: PrintDisplayOption }) {
  const [ativo, setAtivo] = useAtributoHtml(
    option.attribute,
    Boolean(option.defaultChecked),
  );

  return (
    <DropdownMenuCheckboxItem
      checked={ativo}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={setAtivo}
    >
      {option.label}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * Um botão só, com um checkbox por opção — em vez de um chip por opção
 * disputando espaço na barra de ferramentas.
 */
export function PrintDisplayOptionsMenu({
  options,
  label = "Exibir",
}: {
  options: PrintDisplayOption[];
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="!border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-100 hover:!text-slate-900 hover:cursor-pointer"
        >
          <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="no-print">
        <DropdownMenuLabel>Exibir na impressão</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <OptionCheckboxItem key={option.attribute} option={option} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
