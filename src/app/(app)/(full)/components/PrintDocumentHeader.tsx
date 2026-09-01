import Image from "next/image";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type PrintDocumentHeaderProps = {
  logoUrl: string | null;
  logoFallback: string;
  companyName: string;
  companyDetails: ReactNode;
  documentLabel: string;
  documentNumber: number | string;
  status: string;
};

/**
 * Cabeçalho institucional compartilhado pelos documentos comerciais.
 * A estrutura única evita que OS e orçamento voltem a divergir visualmente.
 */
export function PrintDocumentHeader({
  logoUrl,
  logoFallback,
  companyName,
  companyDetails,
  documentLabel,
  documentNumber,
  status,
}: PrintDocumentHeaderProps) {
  return (
    <header className="header-os">
      {logoUrl ? (
        <div className="logo-container">
          <Image
            src={logoUrl}
            alt="Logo da empresa"
            width={70}
            height={70}
            className="logo-img"
            priority
            unoptimized
          />
        </div>
      ) : (
        <div className="logo-placeholder">{logoFallback}</div>
      )}

      <div className="empresa-info">
        <div className="empresa-nome">{companyName}</div>
        <div className="empresa-details">{companyDetails}</div>
      </div>

      <div className="os-header-box">
        <div className="os-label">{documentLabel}</div>
        <h1 className="os-numero">#{documentNumber}</h1>
        <Badge className="os-status-badge font-bold" variant="outline">
          {status}
        </Badge>
      </div>
    </header>
  );
}

/** CSS do cabeçalho acompanha o componente para as duas páginas usarem os mesmos valores. */
export const PRINT_DOCUMENT_HEADER_CSS = `
  .header-os{
    background:linear-gradient(135deg, var(--brand-primary), var(--brand-secondary));
    padding:14px 16px;
    color:var(--brand-header-text, #ffffff);
    display:grid;
    grid-template-columns:auto minmax(0, 1fr) auto;
    gap:16px;
    align-items:center;
    box-shadow:0 4px 12px color-mix(in srgb, var(--brand-primary) 20%, transparent);
  }

  .logo-container,
  .logo-placeholder{
    width:70px;
    height:70px;
    border-radius:10px;
    background:#fff;
    box-shadow:0 4px 12px rgba(0,0,0,.15);
  }

  .logo-container{
    display:flex;
    align-items:center;
    justify-content:center;
    padding:8px;
  }

  .logo-img{
    width:100%;
    height:100%;
    object-fit:contain;
  }

  .logo-placeholder{
    display:flex;
    align-items:center;
    justify-content:center;
    color:var(--brand-primary);
    font-size:calc(24px * var(--print-font-scale, 1));
    font-weight:800;
  }

  .empresa-info{
    min-width:0;
  }

  .empresa-nome{
    min-width:0;
    margin-bottom:4px;
    font-size:calc(18px * var(--print-font-scale, 1));
    font-weight:700;
    line-height:1.2;
    overflow-wrap:anywhere;
  }

  .empresa-details{
    font-size:calc(9px * var(--print-font-scale, 1));
    line-height:1.4;
    opacity:.95;
    overflow-wrap:anywhere;
  }

  /* Borda e fundo saem da propria cor do texto: a caixa continua legivel tanto
     com texto claro sobre barra escura quanto com texto escuro sobre barra clara. */
  .os-header-box{
    min-width:140px;
    padding:10px 14px;
    border:1px solid color-mix(in srgb, var(--brand-header-text, #ffffff) 30%, transparent);
    border-radius:10px;
    background:color-mix(in srgb, var(--brand-header-text, #ffffff) 15%, transparent);
    backdrop-filter:blur(10px);
    text-align:right;
    overflow-wrap:anywhere;
  }

  .os-status-badge{
    border-color:color-mix(in srgb, var(--brand-header-text, #ffffff) 50%, transparent) !important;
    background:color-mix(in srgb, var(--brand-header-text, #ffffff) 10%, transparent) !important;
    color:var(--brand-header-text, #ffffff) !important;
    font-size:calc(10px * var(--print-font-scale, 1));
  }

  .os-label{
    font-size:calc(8px * var(--print-font-scale, 1));
    font-weight:800;
    letter-spacing:.2em;
    line-height:1.2;
    opacity:.9;
    text-transform:uppercase;
  }

  .os-numero{
    margin:4px 0;
    font-size:calc(28px * var(--print-font-scale, 1));
    font-weight:900;
    font-variant-numeric:tabular-nums;
    letter-spacing:-.02em;
    line-height:1;
  }
`;
