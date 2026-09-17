"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function SpedError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Não foi possível abrir o SPED Fiscal</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>A página encontrou uma falha inesperada. Nenhuma ação fiscal foi concluída por esta tela.</p>
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  );
}
