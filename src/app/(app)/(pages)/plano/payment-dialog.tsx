"use client";

import Image from "next/image";
import { Check, Copy, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function PaymentDialog({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(code, { width: 260, margin: 1 }).then(setImage).catch(() => setImage(null));
  }, [code, open]);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="h-8 text-xs" size="sm" variant="outline"><QrCode /> Pagar com Pix</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pagamento por Pix</DialogTitle><DialogDescription>Escaneie o QR Code ou copie o código abaixo.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          {image ? <div className="mx-auto rounded-xl border bg-white p-3"><Image alt="QR Code Pix" height={230} src={image} unoptimized width={230} /></div> : null}
          <Textarea className="min-h-24 resize-none font-mono text-xs" readOnly value={code} />
          <Button onClick={copy} type="button">{copied ? <Check /> : <Copy />}{copied ? "Código copiado" : "Copiar código Pix"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
