"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";

export function PrintButton() {
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className={`print:hidden ${PRINT_ACTION_BUTTON_CLASS}`}
        >
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
        </Button>
    );
}
