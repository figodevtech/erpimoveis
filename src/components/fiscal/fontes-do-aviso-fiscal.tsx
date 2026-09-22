"use client";

import type { FonteIssueFiscal } from "@/lib/nfe/icms";

function dataBr(valor?: string) {
  const partes = valor?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : null;
}

/** Documentos que sustentam um aviso fiscal: "por que o ERP está avisando isso?". */
export function FontesDoAvisoFiscal({ fontes }: { fontes?: readonly FonteIssueFiscal[] }) {
  if (!fontes?.length) return null;

  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium">Fundamento do aviso</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
        {fontes.map((fonte) => {
          const detalhes = [
            fonte.versao ? `versão ${fonte.versao}` : null,
            dataBr(fonte.vigenciaDesde) ? `desde ${dataBr(fonte.vigenciaDesde)}` : null,
            fonte.jurisdicao === "NACIONAL" ? "nacional" : `UF ${fonte.jurisdicao}`,
          ].filter(Boolean);
          return (
            <li key={`${fonte.titulo}-${fonte.versao ?? ""}`}>
              {fonte.url ? (
                <a href={fonte.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {fonte.titulo}
                </a>
              ) : (
                fonte.titulo
              )}{" "}
              <span className="opacity-75">({detalhes.join(", ")})</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
