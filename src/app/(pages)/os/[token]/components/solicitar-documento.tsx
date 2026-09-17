"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
  normalizeCpfOrCnpj,
} from "@/lib/fiscal-identifiers";

function limparDoc(v: string) {
  return normalizeCpfOrCnpj(v);
}

export function SolicitarDocumento({
  clienteNome,
  onConfirmar,
  loading,
}: {
  clienteNome?: string;
  onConfirmar: (doc: string) => void;
  loading?: boolean;
}) {
  const [doc, setDoc] = useState("");

  const docLimpo = useMemo(() => limparDoc(doc), [doc]);
  const docValido = isValidCpf(normalizeCpf(docLimpo)) || isValidCnpj(normalizeCnpj(docLimpo));

  return (
    <Card className="w-full max-w-md border-border bg-card shadow-lg">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Confirmação de titularidade</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {clienteNome ? (
            <>Olá, <span className="font-medium text-foreground">{clienteNome}</span>. </>
          ) : null}
          Por segurança, confirme seu CPF ou CNPJ antes de visualizar o orçamento.
        </p>

        <div className="space-y-2">
          <Label htmlFor="doc" className="text-xs">CPF/CNPJ</Label>
          <Input
            id="doc"
            placeholder="Digite seu CPF ou CNPJ"
            inputMode="text"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            disabled={loading}
          />
          <p className="text-[11px] text-muted-foreground">Aceita CPF e CNPJ numérico ou alfanumérico.</p>
        </div>

        <Button
          className="w-full"
          onClick={() => onConfirmar(docLimpo)}  
          disabled={!docValido || !!loading}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando…
            </>
          ) : (
            "Acessar orçamento"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
