"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save } from "lucide-react";
import { toast } from "@/lib/toast";

type Props = {
  params: Promise<{ id: string }>;
};

type DraftResponse =
  | {
      ok: true;
      id: number;
      status: string;
      xml: string;
    }
  | {
      ok: false;
      message: string;
      detalhe?: string;
    };

export default function EditorNfePage({ params }: Props) {
  const router = useRouter();
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const resolvedParams = use(params);
  const nfeId = Number(resolvedParams.id);

  function formatXml(raw: string): string {
    const parser = new DOMParser();
    const dom = parser.parseFromString(raw, "application/xml");
    if (dom.getElementsByTagName("parsererror").length) {
      throw new Error("XML invalido para formatar.");
    }
    const serializer = new XMLSerializer();
    const serialized = serializer.serializeToString(dom);
    const PADDING = "  ";
    const reg = /(>)(<)(\/*)/g;
    const xmlString = serialized.replace(reg, "$1\n$2$3");
    let pad = 0;
    return xmlString
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.match(/^<\/.+>/)) pad = Math.max(pad - 1, 0);
        const indent = PADDING.repeat(pad);
        if (trimmed.match(/^<[^!?][^>]*[^\/]>$/) && !trimmed.startsWith("</")) {
          pad += 1;
        }
        return indent + trimmed;
      })
      .join("\n");
  }

  function compactarXml(raw: string): string {
    const semQuebras = raw.replace(/[\r\n\t]/g, "");
    return semQuebras.replace(/>\s+</g, "><").trim();
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/nfe/${nfeId}/xml`, { cache: "no-store" });
        const json: DraftResponse = await res.json();
        if (!res.ok || !json.ok) {
          const msg = !json.ok ? json.message : "Nao foi possivel carregar o XML";
          toast.error(msg);
          setStatus(null);
          setXml("");
          return;
        }
        if (!active) return;
        let xmlValue = json.xml || "";
        try {
          xmlValue = formatXml(xmlValue);
        } catch {
          // mantém bruto se nao der para formatar
        }
        setXml(xmlValue);
        setStatus(json.status || null);
      } catch (err: any) {
        toast.error("Erro ao carregar XML de rascunho");
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    }
    if (!Number.isFinite(nfeId)) {
      toast.error("ID de NF-e invalido");
      setLoading(false);
      return;
    }
    load();
    return () => {
      active = false;
    };
  }, [nfeId]);

  async function salvar() {
    setSaving(true);
    try {
      const xmlParaSalvar = compactarXml(xml);
      if (!xmlParaSalvar) {
        throw new Error("XML nao pode ser vazio apos compactar.");
      }

      const res = await fetch(`/api/nfe/${nfeId}/xml`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: xmlParaSalvar }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.message : "Falha ao salvar XML";
        throw new Error(msg);
      }
      toast.success("XML de rascunho salvo");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar XML");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Rejeicao nao consome numeracao: a nota e corrigida e retransmitida com o
  // mesmo numero. Autorizada, cancelada e denegada ja produziram efeito fiscal.
  const statusUpper = String(status ?? "").toUpperCase();
  const podeEditar = statusUpper === "RASCUNHO" || statusUpper === "REJEITADA";
  const isRejeitada = statusUpper === "REJEITADA";

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Editor de XML da NF-e</p>
          <h1 className="text-2xl font-semibold tracking-tight">NF-e #{nfeId}</h1>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <Badge variant={podeEditar ? "outline" : "destructive"}>
              Status: {status}
            </Badge>
          )}
          <Button onClick={salvar} disabled={!podeEditar || saving || loading}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Salvar XML
              </>
            )}
          </Button>
        </div>
      </div>

      <Card className="shadow-sm border-border/80">
        <CardHeader>
          <CardTitle className="text-lg">XML de rascunho (sem assinatura)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando XML...
            </div>
          ) : podeEditar ? (
            <>
              {isRejeitada ? (
                <p className="mb-3 border border-l-4 border-l-amber-500 bg-amber-500/5 p-3 text-xs">
                  Nota rejeitada pela SEFAZ. Ao salvar, a assinatura e o protocolo antigos
                  são descartados e o XML é assinado de novo na transmissão — o número
                  e a série são preservados.
                </p>
              ) : null}
              <Textarea
                value={xml}
                onChange={(e) => setXml(e.target.value)}
                wrap="off"
                style={{ tabSize: 2 }}
                className="font-mono text-sm min-h-[500px] resize-vertical"
                spellCheck={false}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas NF-e em rascunho ou rejeitada podem ser editadas. Status atual: {status ?? "desconhecido"}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
