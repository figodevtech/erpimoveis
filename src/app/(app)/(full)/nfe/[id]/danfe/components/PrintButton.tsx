// src/components/nfe/PrintButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";

export function PrintButton() {
  function handlePrint() {
    window.print();
  }

  return (
    <Button className={PRINT_ACTION_BUTTON_CLASS} type="button" variant="outline" size="sm" onClick={handlePrint}>
      <Printer className="h-4 w-4 mr-2" />
      Imprimir
    </Button>
  );
}
