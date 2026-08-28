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

function OptionCheckboxItem({
  option,
  checked,
  onCheckedChange,
}: {
  option: PrintDisplayOption;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={(value) => onCheckedChange(value === true)}
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
  /*
   * O conteúdo do Radix é desmontado quando o dropdown fecha. Por isso o
   * estado precisa morar no menu, que continua montado durante toda a
   * visualização de impressão; se ficar em OptionCheckboxItem, cada escolha
   * volta ao padrão assim que o usuário fecha o painel.
   */
  const [checkedByAttribute, setCheckedByAttribute] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(
      options.map((option) => [option.attribute, Boolean(option.defaultChecked)]),
    ),
  );

  useEffect(() => {
    const html = document.documentElement;

    for (const option of options) {
      if (checkedByAttribute[option.attribute]) {
        html.setAttribute(option.attribute, "1");
      } else {
        html.removeAttribute(option.attribute);
      }
    }

    return () => {
      for (const option of options) html.removeAttribute(option.attribute);
    };
  }, [checkedByAttribute, options]);

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
          <OptionCheckboxItem
            key={option.attribute}
            option={option}
            checked={Boolean(checkedByAttribute[option.attribute])}
            onCheckedChange={(checked) =>
              setCheckedByAttribute((current) => ({
                ...current,
                [option.attribute]: checked,
              }))
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
