"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";

const ATTR_OCULTAR_VALORES = "data-print-ocultar-valores";
const ATTR_OCULTAR_CLIENTE = "data-print-ocultar-cliente";

function useAtributoHtml(atributo: string) {
  const [ativo, setAtivo] = useState(false);

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

function Chip({
  ativo,
  label,
  onToggle,
}: {
  ativo: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex flex-row items-center text-[10px] md:text-xs gap-1 hover:cursor-pointer ${ativo ? "bg-muted-foreground text-white" : "bg-muted-foreground/50"} rounded-2xl px-3 py-2`}
      onClick={onToggle}
    >
      <Checkbox checked={ativo} />
      <span>{label}</span>
    </div>
  );
}

export function PrintFilterToggles({
  mostrarCliente = true,
}: {
  mostrarCliente?: boolean;
}) {
  const [ocultarValores, setOcultarValores] =
    useAtributoHtml(ATTR_OCULTAR_VALORES);
  const [ocultarCliente, setOcultarCliente] =
    useAtributoHtml(ATTR_OCULTAR_CLIENTE);

  return (
    <>
      <Chip
        ativo={ocultarValores}
        label="Ocultar valores"
        onToggle={() => setOcultarValores(!ocultarValores)}
      />
      {mostrarCliente && (
        <Chip
          ativo={ocultarCliente}
          label="Ocultar dados do cliente"
          onToggle={() => setOcultarCliente(!ocultarCliente)}
        />
      )}
    </>
  );
}
