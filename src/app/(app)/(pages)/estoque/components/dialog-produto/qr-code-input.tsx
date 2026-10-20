"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraScannerDialog } from "./camera-scanner-dialog";

type Props = {
  id: string;
  label: string;
  value?: string | null;
  placeholder?: string;
  loading?: boolean;
  loadingLabel?: string;
  uppercase?: boolean;
  onChange: (value: string) => void;
  onScan?: (value: string) => void;
};

function normalizeQrValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("ERP:ETQ:")) return trimmed.slice("ERP:ETQ:".length);
  return trimmed;
}

export function QrCodeInput({
  id,
  label,
  value,
  placeholder,
  loading = false,
  loadingLabel,
  uppercase = false,
  onChange,
  onScan,
}: Props) {
  const [open, setOpen] = useState(false);

  function handleDetected(rawValue: string) {
    const normalized = normalizeQrValue(rawValue);
    const scannedValue = uppercase ? normalized.toUpperCase() : normalized;
    onChange(scannedValue);
    onScan?.(scannedValue);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            value={value ?? ""}
            placeholder={placeholder}
            className={loading ? "pr-10" : undefined}
            onChange={(event) => onChange(uppercase ? event.target.value.toUpperCase() : event.target.value)}
          />
          {loading ? (
            <Loader2
              aria-label={loadingLabel ?? "Carregando"}
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
        <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => setOpen(true)}>
          <Camera className="h-4 w-4" />
          QR
        </Button>
      </div>

      <CameraScannerDialog
        open={open}
        onOpenChange={setOpen}
        kind="qr"
        title="Ler QR Code"
        description="Aponte a camera para a etiqueta."
        onDetected={handleDetected}
      />
    </div>
  );
}
