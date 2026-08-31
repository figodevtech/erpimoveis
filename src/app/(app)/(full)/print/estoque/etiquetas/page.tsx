"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/app/(app)/(full)/components/PrintButton";
import type { LabelSize } from "@/lib/etiquetas/label-sizes";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";

const ETIQUETAS_PRINT_STORAGE_PREFIX = "erpoficina:etiquetas-print:";

type EtiquetasPrintDraft = {
  codes: string[];
  size: LabelSize;
  createdAt: string;
};

type RenderedLabel = {
  code: string;
  qrDataUrl: string;
};

function EtiquetasPrintContent() {
  const searchParams = useSearchParams();
  const printedRef = useRef(false);
  const [draft, setDraft] = useState<EtiquetasPrintDraft | null>(null);
  const [labels, setLabels] = useState<RenderedLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId) {
      setLoading(false);
      return;
    }

    try {
      const stored = localStorage.getItem(`${ETIQUETAS_PRINT_STORAGE_PREFIX}${draftId}`);
      if (stored) setDraft(JSON.parse(stored) as EtiquetasPrintDraft);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!draft) return;

    let active = true;
    const currentDraft = draft;
    async function renderQr() {
      const rendered = await Promise.all(
        currentDraft.codes.map(async (code) => {
          const qrDataUrl = await QRCode.toDataURL(code, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 220,
          });

          return { code, qrDataUrl };
        })
      );

      if (active) setLabels(rendered);
    }

    void renderQr();

    return () => {
      active = false;
    };
  }, [draft]);

  useEffect(() => {
    if (!draft || labels.length === 0 || printedRef.current) return;

    printedRef.current = true;
    const timeout = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timeout);
  }, [draft, labels.length]);

  const cssVars = useMemo(() => {
    if (!draft) return {};
    return {
      "--label-width": `${draft.size.widthMm}mm`,
      "--label-height": `${draft.size.heightMm}mm`,
    } as CSSProperties;
  }, [draft]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Carregando etiquetas...</div>;
  }

  if (!draft) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Etiquetas não encontradas.</p>
        <Button asChild variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
          <Link href="/etiquetas">Voltar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="label-print-root" style={cssVars}>
      <style>{`
        *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        @page{ size: var(--label-width) var(--label-height); margin:0; }
        html, body{ margin:0; padding:0; background:#f1f5f9; }
        .label-print-root{
          min-height:100vh;
          padding:18px;
          color:#0f172a;
          font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .toolbar{
          max-width:920px;
          margin:0 auto 16px;
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:12px;
        }
        .sheet{
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          justify-content:center;
        }
        .label{
          width:var(--label-width);
          height:var(--label-height);
          background:#fff;
          border:1px solid #cbd5e1;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          overflow:hidden;
          page-break-inside:avoid;
          break-inside:avoid;
          text-align:center;
          gap:1.5mm;
        }
        .qr{
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .qr img{
          width:min(60%, calc(var(--label-height) - 10mm));
          max-width:26mm;
          height:auto;
          display:block;
        }
        .label-text{
          min-width:0;
          width:100%;
          padding:0 3mm;
        }
        .code{
          font-size:13pt;
          line-height:1;
          font-weight:800;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        @media print{
          html, body{ background:#fff !important; }
          .no-print{ display:none !important; }
          .label-print-root{ padding:0 !important; min-height:auto !important; }
          .sheet{ display:block; }
          .label{
            border:0;
            page-break-after:always;
            break-after:page;
          }
          .label:last-child{
            page-break-after:auto;
            break-after:auto;
          }
        }
      `}</style>

      <div className="toolbar no-print">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Etiquetas</div>
          <div className="text-sm font-semibold">
            {draft.codes.length} etiqueta{draft.codes.length === 1 ? "" : "s"} | {draft.size.label}
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
            <Link href="/etiquetas">
              <Power className="h-3 w-3" />
              Sair
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      <div className="sheet">
        {/* A key inclui o indice porque "apenas prefixo" gera codigos repetidos
            de proposito: so o code colidiria entre as etiquetas do mesmo lote. */}
        {labels.map((label, index) => (
          <div className="label" key={`${label.code}-${index}`}>
            <div className="qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={label.qrDataUrl} alt={`QR ${label.code}`} />
            </div>
            <div className="label-text">
              <div className="code">{label.code}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EtiquetasPrintPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Carregando etiquetas...</div>}>
      <EtiquetasPrintContent />
    </Suspense>
  );
}
