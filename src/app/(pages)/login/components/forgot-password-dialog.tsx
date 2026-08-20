"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { Loader2 } from "lucide-react";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export default function ForgotPasswordDialog({ open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async () => {
    const value = email.trim().toLowerCase();
    if (!value) return toast.error("Informe o e-mail.");
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!valid) return toast.error("E-mail inválido.");

    setWorking(true);
    try {
      const r = await fetch("/api/auth/send-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });

      let j: any = {};
      try {
        j = await r.json();
      } catch {}

      if (!r.ok) {
        toast.error(j?.error || "Não foi possível processar a solicitação.");
        return;
      }

      toast.success("Se o e-mail estiver cadastrado, enviaremos um link de recuperação.");
      onOpenChange(false);
      setEmail("");
    } catch (e: any) {
      toast.error(e?.message || "Erro inesperado.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!working) onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recuperar senha</DialogTitle>
          <DialogDescription>Informe seu e-mail para receber o link de redefinição.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium">E-mail</label>
          <Input
            type="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={working}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={working}>
            {working ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando…
              </>
            ) : (
              "Enviar link"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
