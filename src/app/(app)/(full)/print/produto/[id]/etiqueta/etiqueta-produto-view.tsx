"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Power, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PrintButton } from "@/app/(app)/(full)/components/PrintButton";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";
import {
  DEFAULT_LABEL_SIZE,
  LABEL_PRESETS,
  LABEL_SIZE_KEYS,
  isLabelSizeKey,
  type LabelSizeKey,
} from "@/lib/etiquetas/label-sizes";

const TAMANHO_STORAGE_KEY = "erpimoveis:etiqueta-produto:tamanho";
/** Mesmo teto por geracao usado na emissao de etiquetas em massa. */
const MAX_COPIAS = 500;

type Props = {
  produtoId: number;
  titulo: string;
  etiqueta: string;
  referencias: string[];
};

export function EtiquetaProdutoView({ produtoId, titulo, etiqueta, referencias }: Props) {
  const [tamanho, setTamanho] = useState<LabelSizeKey>(DEFAULT_LABEL_SIZE);
  const [copias, setCopias] = useState("1");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // O operador costuma ter um rolo so: relembrar a ultima escolha evita
  // reselecionar o tamanho a cada etiqueta impressa.
  useEffect(() => {
    const salvo = localStorage.getItem(TAMANHO_STORAGE_KEY);
    if (isLabelSizeKey(salvo)) setTamanho(salvo);
  }, []);

  useEffect(() => {
    let ativo = true;
    void QRCode.toDataURL(etiqueta, { errorCorrectionLevel: "M", margin: 1, width: 320 }).then((url) => {
      if (ativo) setQrDataUrl(url);
    });
    return () => {
      ativo = false;
    };
  }, [etiqueta]);

  const preset = LABEL_PRESETS[tamanho];
  const textoReferencias = referencias.join(" · ");

  // Encolher o titulo ate caber e contar quantas linhas de referencia sobram
  // depende de medida real de texto, que so o navegador tem. O molde abaixo e
  // renderizado fora da tela no tamanho verdadeiro e serve de regua.
  const moldeTextoRef = useRef<HTMLDivElement>(null);
  const moldeCodigoRef = useRef<HTMLDivElement>(null);
  const moldeTituloRef = useRef<HTMLDivElement>(null);
  const moldeRefsRef = useRef<HTMLDivElement>(null);
  const [ajuste, setAjuste] = useState({
    tituloPt: preset.fonts.titulo,
    tituloLinhas: 2,
    refsLinhas: 1,
  });

  useLayoutEffect(() => {
    const caixa = moldeTextoRef.current;
    const codigoEl = moldeCodigoRef.current;
    const tituloEl = moldeTituloRef.current;
    const refsEl = moldeRefsRef.current;
    if (!caixa || !tituloEl) return;

    const alturaCaixa = caixa.clientHeight;
    if (alturaCaixa <= 0) return;

    const alturaLinhaRef = refsEl ? parseFloat(getComputedStyle(refsEl).lineHeight) || 0 : 0;
    const gap = parseFloat(getComputedStyle(caixa).rowGap) || 0;
    // O codigo da etiqueta nunca encolhe nem e cortado: e a identidade da peca
    // e o que o conferente le. Sai do espaco antes de o titulo disputar o resto.
    const alturaCodigo = codigoEl ? codigoEl.getBoundingClientRect().height + gap : 0;
    // Uma linha de referencia fica reservada de saida: etiqueta com titulo
    // gigante e nenhuma referencia visivel nao ajuda quem procura a peca.
    const reserva = referencias.length ? alturaLinhaRef + gap : 0;
    const espacoTitulo = Math.max(0, alturaCaixa - alturaCodigo - reserva);

    tituloEl.style.webkitLineClamp = "unset";
    let pt = preset.fonts.titulo;
    while (pt > preset.fonts.tituloMin) {
      tituloEl.style.fontSize = `${pt}pt`;
      if (tituloEl.scrollHeight <= espacoTitulo) break;
      pt = Math.max(preset.fonts.tituloMin, Math.round((pt - 0.25) * 100) / 100);
      if (pt === preset.fonts.tituloMin) break;
    }
    tituloEl.style.fontSize = `${pt}pt`;

    const alturaLinhaTitulo = parseFloat(getComputedStyle(tituloEl).lineHeight) || 1;
    // No piso da fonte o titulo pode nao caber inteiro; ai o clamp entra e
    // fecha com reticencias em vez de cortar a frase no meio de uma linha.
    const tituloLinhas = Math.max(1, Math.floor(Math.max(espacoTitulo, alturaLinhaTitulo) / alturaLinhaTitulo));
    const alturaTitulo = Math.min(tituloEl.scrollHeight, tituloLinhas * alturaLinhaTitulo);
    const sobra = alturaCaixa - alturaCodigo - alturaTitulo - (referencias.length ? gap : 0);
    const refsLinhas = alturaLinhaRef > 0 ? Math.max(0, Math.floor(sobra / alturaLinhaRef)) : 0;

    setAjuste({ tituloPt: pt, tituloLinhas, refsLinhas });
  }, [preset, etiqueta, titulo, textoReferencias, referencias.length]);

  const total = useMemo(() => {
    const bruto = Number(copias);
    if (copias === "" || !Number.isFinite(bruto)) return 0;
    return Math.min(Math.max(0, Math.trunc(bruto)), MAX_COPIAS);
  }, [copias]);

  function alterarTamanho(valor: string) {
    if (!isLabelSizeKey(valor)) return;
    setTamanho(valor);
    localStorage.setItem(TAMANHO_STORAGE_KEY, valor);
  }

  return (
    <div className="label-print-root">
      {/* As medidas entram literais no @page: variavel CSS em @page nao e
          confiavel entre navegadores, e aqui o tamanho da folha e o proprio
          tamanho da etiqueta. */}
      <style>{`
        *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        @page{ size:${preset.widthMm}mm ${preset.heightMm}mm; margin:0; }
        html, body{ margin:0; padding:0; background:#f1f5f9; }
        .label-print-root{
          min-height:100vh;
          padding:18px;
          color:#0f172a;
          font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .toolbar{
          max-width:920px;
          margin:0 auto 20px;
          display:flex;
          flex-wrap:wrap;
          align-items:flex-end;
          justify-content:space-between;
          gap:16px;
        }
        .sheet{
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          justify-content:center;
        }
        .label{
          width:${preset.widthMm}mm;
          height:${preset.heightMm}mm;
          background:#fff;
          border:1px solid #cbd5e1;
          display:flex;
          flex-direction:${preset.layout === "stack" ? "column" : "row"};
          align-items:center;
          justify-content:${preset.layout === "stack" ? "center" : "flex-start"};
          gap:${preset.layout === "stack" ? "1.5mm" : "2mm"};
          padding:2mm;
          overflow:hidden;
          page-break-inside:avoid;
          break-inside:avoid;
          text-align:${preset.layout === "stack" ? "center" : "left"};
        }
        .label .qr{
          width:${preset.qrMm}mm;
          height:${preset.qrMm}mm;
          flex:0 0 ${preset.qrMm}mm;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .label .qr img{
          width:100%;
          height:100%;
          display:block;
        }
        .label .texto{
          min-width:0;
          min-height:0;
          flex:1 1 auto;
          align-self:stretch;
          display:flex;
          flex-direction:column;
          justify-content:center;
          gap:0.6mm;
          overflow:hidden;
        }
        .label .codigo{
          font-size:${preset.fonts.codigo}pt;
          line-height:1.15;
          font-weight:800;
          letter-spacing:0.02em;
          display:flex;
          align-items:center;
          justify-content:${preset.layout === "stack" ? "center" : "flex-start"};
          gap:0.35em;
          overflow-wrap:anywhere;
        }
        .label .codigo svg{
          width:1em;
          height:1em;
          flex:0 0 auto;
        }
        .label .titulo{
          line-height:1.15;
          font-weight:700;
          overflow:hidden;
          display:-webkit-box;
          -webkit-box-orient:vertical;
          overflow-wrap:anywhere;
        }
        .label .ref{
          font-size:${preset.fonts.referencia}pt;
          line-height:1.2;
          font-weight:500;
          overflow:hidden;
          display:-webkit-box;
          -webkit-box-orient:vertical;
          overflow-wrap:anywhere;
        }
        .molde{
          position:absolute;
          top:0;
          left:-10000px;
          visibility:hidden;
          pointer-events:none;
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
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Etiqueta do produto
          </div>
          <div className="truncate text-sm font-semibold">
            #{produtoId} {titulo ? `· ${titulo}` : null}
          </div>
          <div className="text-xs text-muted-foreground">
            Etiqueta {etiqueta} · {total} impress{total === 1 ? "ão" : "ões"}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-1">
            <Label htmlFor="tamanho-etiqueta" className="text-xs">
              Tamanho
            </Label>
            <Select value={tamanho} onValueChange={alterarTamanho}>
              <SelectTrigger id="tamanho-etiqueta" className="h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_SIZE_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {LABEL_PRESETS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-24 space-y-1">
            <Label htmlFor="copias-etiqueta" className="text-xs">
              Cópias
            </Label>
            <Input
              id="copias-etiqueta"
              type="number"
              min={1}
              max={MAX_COPIAS}
              value={copias}
              onChange={(event) => setCopias(event.target.value)}
              className="h-9 bg-white"
            />
          </div>

          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
              <Link href="/estoque">
                <Power className="h-3 w-3" />
                Sair
              </Link>
            </Button>
            <PrintButton />
          </div>
        </div>
      </div>

      {/* Régua: mesma etiqueta, fora da tela, sem clamp — é dela que saem as
          medidas aplicadas nas cópias visíveis. */}
      <div className="label molde no-print" aria-hidden>
        <div className="qr" />
        <div className="texto" ref={moldeTextoRef}>
          <div className="codigo" ref={moldeCodigoRef}>
            <Tag />
            {etiqueta}
          </div>
          <div className="titulo" ref={moldeTituloRef} style={{ fontSize: `${preset.fonts.titulo}pt` }}>
            {titulo || `Produto #${produtoId}`}
          </div>
          {referencias.length ? (
            <div className="ref" ref={moldeRefsRef}>
              {textoReferencias}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sheet">
        {Array.from({ length: total }, (_, index) => (
          <div className="label" key={index}>
            <div className="qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qrDataUrl ? <img src={qrDataUrl} alt={`QR ${etiqueta}`} /> : null}
            </div>
            <div className="texto">
              <div className="codigo">
                <Tag />
                {etiqueta}
              </div>
              <div
                className="titulo"
                style={{ fontSize: `${ajuste.tituloPt}pt`, WebkitLineClamp: ajuste.tituloLinhas }}
              >
                {titulo || `Produto #${produtoId}`}
              </div>
              {referencias.length && ajuste.refsLinhas > 0 ? (
                <div className="ref" style={{ WebkitLineClamp: ajuste.refsLinhas }}>
                  {textoReferencias}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
