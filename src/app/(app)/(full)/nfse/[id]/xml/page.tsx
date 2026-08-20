"use client";

import { use, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatXml } from "@/lib/xml-pretty";

type Props = {
  params: Promise<{ id: string }>;
};

type XmlResponse =
  | { ok: true; id: number; numero: string | null; status: string; url: string; xml: string }
  | { ok: false; message: string };

/**
 * Visualizador do XML da NFS-e. Somente leitura, ao contrário do editor de
 * NF-e: este documento foi emitido pela prefeitura, não por nós — não há o que
 * salvar nem retransmitir.
 */
export default function XmlNfsePage({ params }: Props) {
  const [xml, setXml] = useState("");
  const [numero, setNumero] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const nfseId = Number(use(params).id);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      setLoading(true);
      try {
        const res = await fetch(`/api/nfse/${nfseId}/xml`, { cache: "no-store" });
        const json: XmlResponse = await res.json();
        if (!ativo) return;

        if (!res.ok || !json.ok) {
          const mensagem = !json.ok ? json.message : "Não foi possível carregar o XML.";
          setErro(mensagem);
          toast.error(mensagem);
          return;
        }

        let conteudo = json.xml || "";
        try {
          conteudo = formatXml(conteudo);
        } catch {
          // XML da prefeitura vale mais bruto do que não vale nada.
        }
        setXml(conteudo);
        setNumero(json.numero);
        setStatus(json.status);
        setErro(null);
      } catch (e) {
        if (!ativo) return;
        console.error(e);
        setErro("Erro ao carregar o XML da NFS-e.");
        toast.error("Erro ao carregar o XML da NFS-e.");
      } finally {
        if (ativo) setLoading(false);
      }
    }

    if (!Number.isFinite(nfseId)) {
      setErro("ID de NFS-e inválido.");
      setLoading(false);
      return;
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [nfseId]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(xml);
      toast.success("XML copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  }

  function baixar() {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nfse-${numero || nfseId}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">XML da NFS-e</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {numero ? `Nota ${numero}` : `NFS-e #${nfseId}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {status && <Badge variant="outline">{status}</Badge>}
          <Button variant="outline" onClick={copiar} disabled={loading || !xml}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar
          </Button>
          <Button variant="outline" onClick={baixar} disabled={loading || !xml}>
            <Download className="mr-2 h-4 w-4" />
            Baixar
          </Button>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Documento emitido pela prefeitura</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando XML...
            </div>
          ) : erro ? (
            <p className="border border-l-4 border-l-amber-500 bg-amber-500/5 p-3 text-sm">{erro}</p>
          ) : (
            <Textarea
              value={xml}
              readOnly
              wrap="off"
              style={{ tabSize: 2 }}
              className="min-h-[500px] resize-vertical font-mono text-sm"
              spellCheck={false}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
