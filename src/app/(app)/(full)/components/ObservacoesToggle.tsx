"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";

export function ObservacoesToggle({ label = "Observações" }: { label?: string }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const html = document.documentElement;

    if (checked) {
      html.setAttribute("data-os-observacoes", "1");
    } else {
      html.removeAttribute("data-os-observacoes");
    }

    return () => html.removeAttribute("data-os-observacoes");
  }, [checked]);

  return (
    <div className={`flex flex-row items-center text-[10px] md:text-xs gap-1 hover:cursor-pointer ${!checked ? "bg-muted-foreground/50" : "bg-muted-foreground text-white"} rounded-2xl px-3 py-2`} onClick={()=>setChecked(!checked)}>
      <Checkbox className="" checked={checked} />
      <span className="">{label}</span>
    </div>
  );
}
