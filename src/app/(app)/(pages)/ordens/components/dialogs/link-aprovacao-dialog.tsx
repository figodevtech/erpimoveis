// src/app/(app)/(pages)/ordens/components/dialogs/link-aprovacao-dialog.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { Link2, Copy, ExternalLink, MessageCircleMore } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId?: number | null;
  clienteNome?: string | null;
  clienteTelefone?: string | null;
};

function normalizarTelefoneWhatsApp(raw?: string | null): string | null {
  if (!raw) return null;

  // remove tudo que não é dígito
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;

  // remove zeros à esquerda (ex.: 016 -> 16)
  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // se já começa com 55, assume DDI BR
  if (digits.startsWith("55")) {
    return digits;
  }

  // formatos BR comuns: 10 ou 11 dígitos (DD+numero)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // se ficar estranho demais, deixa cair no fallback sem número
  return null;
}

export function LinkAprovacaoDialog({ open, onOpenChange, osId, clienteNome, clienteTelefone }: Props) {
  const [url, setUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const canRequest = open && !!osId;

  const titulo = useMemo(() => `Link de aprovação ${clienteNome ? `• ${clienteNome}` : ""}`, [clienteNome]);

  async function fetchLink() {
    if (!osId) return;
    setLoading(true);

    try {
      const endpoint = `/api/ordens/${osId}/aprovacao/link`;

      // 1) tenta obter link existente
      const r = await fetch(endpoint, { cache: "no-store" });
      let j: any = {};
      if (r.ok) {
        j = await r.json().catch(() => ({}));
      }

      // 2) se ainda não existir, cria um novo
      if (!j?.url) {
        const r2 = await fetch(endpoint, { method: "POST" });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok || !j2?.url) {
          throw new Error(j2?.error || "Falha ao gerar link");
        }
        setUrl(j2.url as string);
        toast.success("Link de aprovação gerado");
        return;
      }

      // já existe → usa o mesmo
      setUrl(j.url as string);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao obter link");
      setUrl("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canRequest) {
      fetchLink();
    } else if (!open) {
      // limpamos ao fechar, pra não reaproveitar de outra OS
      setUrl("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRequest, osId, open]);

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const abrirLink = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const abrirWhatsapp = async () => {
    if (!url) return;

    const saudacao = clienteNome ? `Olá ${clienteNome}!` : "Olá!";
    const msg = `${saudacao} Segue o link para aprovação do seu orçamento:\n\n${url}`;

    // tenta normalizar o telefone
    const numero = normalizarTelefoneWhatsApp(clienteTelefone);

    // tenta copiar a mensagem pro clipboard
    let copiou = false;
    try {
      await navigator.clipboard.writeText(msg);
      copiou = true;
    } catch {
      copiou = false;
    }

    const params = new URLSearchParams();
    if (numero) {
      params.set("phone", numero);
    }
    params.set("text", msg);

    const waUrl = `https://api.whatsapp.com/send?${params.toString()}`;

    if (!numero) {
      toast.info("Telefone do cliente não disponível ou inválido. Abrindo WhatsApp sem número.");
    } else if (copiou) {
      toast.success("Abrimos a conversa e já copiamos a mensagem. Se não aparecer preenchida, é só colar (Ctrl+V).");
    } else {
      toast.info("Abrimos a conversa. Se a mensagem não aparecer preenchida, copie e cole o texto manualmente.");
    }

    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            {titulo}
          </DialogTitle>
          <DialogDescription>Copie e compartilhe o link com o cliente para aprovar o orçamento.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="link">URL do orçamento público</Label>
          <div className="flex gap-2">
            <Input
              id="link"
              value={url}
              readOnly
              className="font-mono"
              placeholder={loading ? "Gerando link..." : "—"}
            />
            <Button variant="outline" onClick={copiar} disabled={!url || loading}>
              <Copy className="mr-2 h-4 w-4" />
              Copiar
            </Button>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <div className="flex gap-2">
            <Button variant="outline" onClick={abrirLink} disabled={!url || loading}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir
            </Button>
            <Button onClick={abrirWhatsapp} disabled={!url || loading}>
              <MessageCircleMore className="mr-2 h-4 w-4" />
              WhatsApp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
