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
        <Badge
          className="border-white/50 bg-white/10 text-[10px] font-bold text-white"
          variant="outline"
        >
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
    color:#fff;
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
    font-size:24px;
    font-weight:800;
  }

  .empresa-info{
    min-width:0;
  }

  .empresa-nome{
    margin-bottom:4px;
    font-size:18px;
    font-weight:700;
    line-height:1.2;
  }

  .empresa-details{
    font-size:9px;
    line-height:1.4;
    opacity:.95;
    overflow-wrap:anywhere;
  }

  .os-header-box{
    min-width:140px;
    padding:10px 14px;
    border:1px solid rgba(255,255,255,.3);
    border-radius:10px;
    background:rgba(255,255,255,.15);
    backdrop-filter:blur(10px);
    text-align:right;
  }

  .os-label{
    font-size:8px;
    font-weight:800;
    letter-spacing:.2em;
    line-height:1.2;
    opacity:.9;
    text-transform:uppercase;
  }

  .os-numero{
    margin:4px 0;
    font-size:28px;
    font-weight:900;
    font-variant-numeric:tabular-nums;
    letter-spacing:-.02em;
    line-height:1;
  }
`;
