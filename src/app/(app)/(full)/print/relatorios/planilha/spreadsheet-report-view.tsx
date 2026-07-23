"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { toast } from "@/lib/toast";

const ROWS_PER_PAGE = 20;

type Cell = string | number | boolean | null;

function pagesOf<T>(rows: T[], size: number) {
  if (!rows.length) return [[]] as T[][];
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size) pages.push(rows.slice(index, index + size));
  return pages;
}

function displayCell(value: Cell) {
  if (value == null || value === "") return "—";
  return String(value);
}

export function SpreadsheetReportView({ endpoint, title }: { endpoint: string; title: string }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Cell[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Não foi possível gerar o relatório.");
        }
        const buffer = await response.arrayBuffer();
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
        if (!active) return;
        setHeaders((matrix[0] ?? []).map((cell) => displayCell(cell)));
        setRows(matrix.slice(1));
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Não foi possível gerar o relatório.";
        if (active) {
          setError(message);
          toast.error(message);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [endpoint]);

  const pages = useMemo(() => pagesOf(rows, ROWS_PER_PAGE), [rows]);
  const fontSize = headers.length > 15 ? "text-[5px]" : headers.length > 10 ? "text-[6px]" : "text-[7px]";

  if (loading) return <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Preparando visualização...</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center p-8 text-destructive">{error}</div>;

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        @media print {
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          .spreadsheet-shell{padding:0!important;background:#fff!important}
          .spreadsheet-sheet{box-sizing:border-box!important;width:296mm!important;height:208mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .spreadsheet-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
        }
      `}</style>
      <main className="spreadsheet-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[297mm] justify-end">
          <A4PdfActions filename={`${title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.pdf`} backHref="/relatorios" landscape selector=".spreadsheet-sheet" />
        </div>
        <div className="mx-auto flex w-[297mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => (
            <section key={pageIndex} className="spreadsheet-sheet h-[210mm] w-[297mm] overflow-hidden border bg-white p-[10mm] shadow-xl">
              <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-3">
                <div><h1 className="text-xl font-bold uppercase">{title}</h1><p className="mt-1 text-[9px] text-neutral-500">{rows.length} registros</p></div>
                <div className="text-right text-[9px] text-neutral-500">Página {pageIndex + 1} de {pages.length}</div>
              </header>
              <table className={`w-full table-fixed border-collapse ${fontSize}`}>
                <thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`} className="border border-neutral-300 bg-neutral-100 px-1 py-1 text-left uppercase"><span className="line-clamp-2">{header}</span></th>)}</tr></thead>
                <tbody>
                  {pageRows.length ? pageRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="h-[7mm] border-b border-neutral-200">
                      {headers.map((_, cellIndex) => <td key={cellIndex} className="max-w-0 truncate border-x border-neutral-200 px-1 py-1" title={displayCell(row[cellIndex])}>{displayCell(row[cellIndex])}</td>)}
                    </tr>
                  )) : <tr><td colSpan={Math.max(headers.length, 1)} className="py-12 text-center text-neutral-500">Nenhum registro encontrado.</td></tr>}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
