"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, MessageCircleMore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendaId: number | null;
  clienteNome?: string | null;
  clienteTelefone?: string | null;
  onGenerated?: () => void;
};

function telefoneWhatsApp(value?: string | null) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 ? digits : null;
}

export function VendaLinkAprovacaoDialog({
  open,
  onOpenChange,
  vendaId,
  clienteNome,
  clienteTelefone,
  onGenerated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [expiraEm, setExpiraEm] = useState<string | null>(null);
  const onGeneratedRef = useRef(onGenerated);

  useEffect(() => {
    onGeneratedRef.current = onGenerated;
  }, [onGenerated]);

  const gerarLink = useCallback(async () => {
    if (!vendaId) return;
    setLoading(true);
    setUrl("");
    setExpiraEm(null);
    try {
      const response = await fetch(`/api/venda/${vendaId}/aprovacao/link`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível gerar o link.");
      setUrl(String(data.url ?? ""));
      setExpiraEm(data.expiraEm ? String(data.expiraEm) : null);
      onGeneratedRef.current?.();
    } catch (error) {
      toast.error("Erro ao gerar link", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [vendaId]);

  useEffect(() => {
    if (open && vendaId) void gerarLink();
    if (!open) {
      setUrl("");
      setExpiraEm(null);
    }
  }, [gerarLink, open, vendaId]);

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  const abrirWhatsApp = () => {
    if (!url) return;
    const saudacao = clienteNome ? `Olá ${clienteNome}!` : "Olá!";
    const mensagem = `${saudacao} Segue o link para aprovação do seu orçamento de venda:\n\n${url}`;
    const params = new URLSearchParams({ text: mensagem });
    const telefone = telefoneWhatsApp(clienteTelefone);
    if (telefone) params.set("phone", telefone);
    window.open(`https://api.whatsapp.com/send?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Enviar orçamento para aprovação</DialogTitle>
          <DialogDescription>
            O cliente deverá informar o CPF/CNPJ cadastrado antes de visualizar e responder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Input value={url} readOnly placeholder={loading ? "Gerando link..." : "Link indisponível"} />
            <Button type="button" variant="outline" size="icon" onClick={copiar} disabled={!url || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              <span className="sr-only">Copiar link</span>
            </Button>
          </div>
          {expiraEm ? (
            <p className="text-xs text-muted-foreground">
              Válido até {new Date(expiraEm).toLocaleString("pt-BR")}.
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => window.open(url, "_blank")} disabled={!url || loading}>
            <ExternalLink className="h-4 w-4" />
            Abrir
          </Button>
          <Button type="button" onClick={abrirWhatsApp} disabled={!url || loading}>
            <MessageCircleMore className="h-4 w-4" />
            WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
