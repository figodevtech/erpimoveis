"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Download, FileCheck2, Loader2, PenLine, RotateCcw } from "lucide-react";
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
import {
  CHECKLIST_DECLARACAO,
  CHECKLIST_PDF_GENERATOR_VERSION,
  CHECKLIST_QUALIDADE_LABEL,
  CHECKLIST_TIPO_LABEL,
  formatCpfCnpj,
  groupChecklistItemsForPrint,
  type ChecklistSignatarioQualidade,
  type ChecklistSnapshotItem,
} from "@/lib/ordens/checklist-documento";
import type { ChecklistDocumentoCompleto } from "@/lib/ordens/checklist-documentos-server";
import { A4PdfActions } from "../../../components/A4PdfActions";
import { PrintA4Paginator } from "../../../components/PrintA4Paginator";
import { PrintDocumentHeader, PRINT_DOCUMENT_HEADER_CSS } from "../../../components/PrintDocumentHeader";
import { ChecklistOnlineSigningInvitation } from "./online-signing-invitation";

function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function responseClass(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "OK") return "status-ok";
  if (normalized === "ALERTA") return "status-alerta";
  if (normalized === "FALHA") return "status-falha";
  return "status-outro";
}

function ChecklistItemCopy({ item, index }: { item: ChecklistSnapshotItem; index: number }) {
  return (
    <div className="item-copy">
      <div className="item-title">
        <span>{index + 1}. {item.titulo}</span>
        <strong className={responseClass(item.resposta)}>{item.resposta}</strong>
      </div>
      {item.descricao && <p className="item-description">{item.descricao}</p>}
      {item.observacao && <p><b>Observação:</b> {item.observacao}</p>}
      <div className="item-meta">
        {item.categoria && <span>Categoria: {item.categoria}</span>}
        {item.responsavel && <span>Responsável: {item.responsavel}</span>}
        {item.registradoEm && <span>Registro: {formatDate(item.registradoEm)}</span>}
      </div>
    </div>
  );
}

function ChecklistPhoto({
  item,
  itemIndex,
  photoIndex,
  source,
  compact = false,
}: {
  item: ChecklistSnapshotItem;
  itemIndex: number;
  photoIndex: number;
  source: string;
  compact?: boolean;
}) {
  const photo = item.fotos[photoIndex];
  return (
    <div className={`photo-card ${compact ? "compact-photo-card" : ""}`}>
      <div className="photo-context">
        {compact ? `Foto ${photoIndex + 1} de ${item.fotos.length}` : `${itemIndex + 1}. ${item.titulo} · Foto ${photoIndex + 1} de ${item.fotos.length}`}
      </div>
      {/* URLs privadas e temporárias precisam ser impressas sem o proxy persistente do next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt={photo.descricao || `Foto ${photoIndex + 1} do item ${item.titulo}`} />
      <p>{photo.descricao || "Sem descrição"}</p>
    </div>
  );
}

function SignatureDialog({ publicId, open, onOpenChange }: { publicId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [name, setName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [quality, setQuality] = useState<ChecklistSignatarioQualidade>("CLIENTE");
  const [qualityOther, setQualityOther] = useState("");
  const [aware, setAware] = useState(false);
  const [saving, setSaving] = useState(false);

  function prepareCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(prepareCanvas);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/checklist-documentos/${publicId}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: name,
          documento: documentNumber,
          qualidade: quality,
          qualidadeOutro: quality === "OUTRO" ? qualityOther : null,
          assinaturaDataUrl: canvas.toDataURL("image/png"),
          declaracaoCiente: aware,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) throw new Error(payload?.error || "Não foi possível assinar o checklist.");
      toast[response.status === 202 ? "warning" : "success"](
        response.status === 202 ? payload.warning : "Checklist assinado e PDF oficial preservado.",
      );
      onOpenChange(false);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível assinar o checklist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assinar presencialmente</DialogTitle>
          <DialogDescription>
            O cliente ou responsável assina neste dispositivo. O operador autenticado ficará registrado como coletor.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Nome completo</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">CPF/CNPJ</span>
            <Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} inputMode="numeric" />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Função</span>
            <select className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={quality} onChange={(event) => setQuality(event.target.value as ChecklistSignatarioQualidade)}>
              {Object.entries(CHECKLIST_QUALIDADE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {quality === "OUTRO" && (
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Descreva a função</span>
              <Input value={qualityOther} onChange={(event) => setQualityOther(event.target.value)} />
            </label>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Assinatura desenhada</span>
            <Button type="button" variant="ghost" size="sm" onClick={prepareCanvas}><RotateCcw className="mr-1.5 h-4 w-4" />Limpar</Button>
          </div>
          <canvas
            ref={canvasRef}
            className="h-48 w-full touch-none rounded-md border bg-white"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={() => { drawingRef.current = false; }}
            onPointerCancel={() => { drawingRef.current = false; }}
          />
        </div>
        <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          <input className="mt-1 h-4 w-4" type="checkbox" checked={aware} onChange={(event) => setAware(event.target.checked)} />
          <span>{CHECKLIST_DECLARACAO}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          Método: assinatura eletrônica simples presencial.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
            {saving ? "Preservando assinatura..." : "Confirmar e gerar PDF oficial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChecklistReport({ document, assetUrls, canSign }: {
  document: ChecklistDocumentoCompleto;
  assetUrls: Record<string, string>;
  canSign: boolean;
}) {
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [creatingCurrentLayout, setCreatingCurrentLayout] = useState(false);
  const [contentDiverged, setContentDiverged] = useState(document.conteudoAtualDivergente);
  const signed = Boolean(document.assinatura);
  const official = Boolean(document.arquivo);
  const outdatedOfficial = Boolean(
    document.arquivo && document.arquivo.geradorVersao !== CHECKLIST_PDF_GENERATOR_VERSION,
  );
  const logoUrl = document.snapshot.empresa.logo ? assetUrls[document.snapshot.empresa.logo.storagePath] ?? null : null;
  const itemGroups = groupChecklistItemsForPrint(document.snapshot.checklist.itens);
  const customerPhone = document.snapshot.ordemServico.cliente.find((field) =>
    /telefone|celular|whatsapp/i.test(field.rotulo),
  )?.valor ?? null;

  useEffect(() => {
    let active = true;
    fetch(`/api/checklist-documentos/${document.publicId}?divergencia=1`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setContentDiverged(payload?.conteudoAtualDivergente === true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [document.publicId]);

  async function retryPdf() {
    setRetrying(true);
    try {
      const response = await fetch(`/api/checklist-documentos/${document.publicId}/pdf/retry`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível gerar o PDF oficial.");
      toast.success("PDF oficial gerado e preservado.");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o PDF oficial.");
    } finally {
      setRetrying(false);
    }
  }

  async function createCurrentLayoutVersion() {
    if (creatingCurrentLayout) return;
    setCreatingCurrentLayout(true);
    try {
      const response = await fetch("/api/checklist-documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordemServicoId: document.ordemServicoId, tipo: document.tipo }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível criar a nova versão.");
      const publicId = String(payload?.document?.publicId ?? "");
      if (!publicId) throw new Error("A nova versão não retornou um identificador.");
      toast.success("Nova versão criada com o novo layout.");
      window.location.href = `/print/checklist/${publicId}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a nova versão.");
      setCreatingCurrentLayout(false);
    }
  }

  const actions = official ? (
    <div className="print:hidden flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm"><Link href="/ordens">Voltar</Link></Button>
      <Button asChild size="sm"><a href={`/api/checklist-documentos/${document.publicId}/pdf`} target="_blank" rel="noreferrer"><FileCheck2 className="mr-2 h-4 w-4" />Abrir / imprimir PDF oficial</a></Button>
      <Button asChild variant="outline" size="sm"><a href={`/api/checklist-documentos/${document.publicId}/pdf`} download><Download className="mr-2 h-4 w-4" />Baixar oficial</a></Button>
      {outdatedOfficial && (
        <Button type="button" variant="outline" size="sm" onClick={() => void createCurrentLayoutVersion()} disabled={creatingCurrentLayout}>
          {creatingCurrentLayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
          Criar versão com novo layout
        </Button>
      )}
    </div>
  ) : signed ? (
    <div className="print:hidden flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm"><Link href="/ordens">Voltar</Link></Button>
      <Button size="sm" onClick={() => void retryPdf()} disabled={!canSign || retrying}>
        {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
        Tentar gerar PDF oficial
      </Button>
    </div>
  ) : (
    <div className="print:hidden flex flex-wrap items-center gap-2">
      <A4PdfActions filename={`${document.codigo}-PROVISORIO.pdf`} backHref="/ordens" selector=".print-generated-page.checklist-report-sheet" />
      <Button size="sm" onClick={() => setSignatureOpen(true)} disabled={!canSign || !document.maisRecente} title={!document.maisRecente ? "Somente a versão mais recente pode ser assinada." : undefined}>
        <PenLine className="mr-2 h-4 w-4" />Assinar presencialmente
      </Button>
      <ChecklistOnlineSigningInvitation
        publicId={document.publicId}
        canManage={canSign}
        latest={document.maisRecente}
        customerPhone={customerPhone}
        documentCode={document.codigo}
      />
    </div>
  );

  return (
    <main className="checklist-print-page min-h-screen bg-slate-100 px-3 py-4 text-slate-950 sm:px-6">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-col gap-3">
        {actions}
        {outdatedOfficial && (
          <div className="print:hidden flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Este PDF oficial foi preservado com o layout anterior. Por integridade, ele não pode ser sobrescrito. Crie uma nova versão para usar o novo cabeçalho visual, itens de foto única agrupados em duplas, duas fotos por linha e paginação agrupada.
          </div>
        )}
        {contentDiverged && (
          <div className="print:hidden flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            O checklist atual da OS diverge desta versão imutável. Gere uma nova versão para registrar o conteúdo atualizado.
          </div>
        )}
        {signed && !official && (
          <div className="print:hidden flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            A assinatura está preservada, mas a geração do PDF oficial está pendente. Não é necessário recolher outra assinatura.
          </div>
        )}
      </div>

      <div data-print-pagination-root data-print-pagination-repeat-header data-print-pagination-number-pages>
        <PrintA4Paginator />
        <div data-print-pagination-source-holder>
          <article
            data-print-pagination-source
            data-print-export-target
            className={`checklist-report-sheet report-sheet ${!signed ? "checklist-provisional" : ""}`}
            style={{
              ["--brand-primary" as string]: document.snapshot.empresa.cores.primaria,
              ["--brand-secondary" as string]: document.snapshot.empresa.cores.secundaria,
              ["--brand-header-text" as string]: document.snapshot.empresa.cores.texto,
            }}
          >
            <PrintDocumentHeader
              logoUrl={logoUrl}
              logoFallback={document.snapshot.empresa.nome.slice(0, 2).toUpperCase()}
              companyName={document.snapshot.empresa.nome}
              companyDetails={<>{document.snapshot.empresa.campos.map((item) => <div key={item.rotulo}>{item.rotulo}: {item.valor}</div>)}</>}
              documentLabel="Checklist"
              documentNumber={document.ordemServicoId}
              status={CHECKLIST_TIPO_LABEL[document.tipo]}
            />
            <div className="conteudo">
              <section className="checklist-summary">
                <div><b>Código</b><span>{document.codigo}</span></div>
                <div><b>Versão</b><span>{document.versao}</span></div>
                <div><b>Criado em</b><span>{formatDate(document.snapshot.checklist.inspecionadoEm)}</span></div>
                <div><b>Modelo</b><span>{document.snapshot.checklist.modelo || "Não identificado"}</span></div>
              </section>
              <section className="checklist-context">
                <h2>Ordem de serviço e cliente</h2>
                <dl>{[...document.snapshot.ordemServico.campos, ...document.snapshot.ordemServico.cliente].map((item, index) => <div key={`${item.rotulo}-${index}`}><dt>{item.rotulo}</dt><dd>{item.valor}</dd></div>)}</dl>
                <h2>Objeto inspecionado · {document.snapshot.ordemServico.objeto.tipo}</h2>
                <dl><div><dt>Identificação</dt><dd>{document.snapshot.ordemServico.objeto.titulo}</dd></div>{document.snapshot.ordemServico.objeto.campos.map((item, index) => <div key={`${item.rotulo}-${index}`}><dt>{item.rotulo}</dt><dd>{item.valor}</dd></div>)}</dl>
              </section>
              <table data-print-items-table className="checklist-items-table">
                <thead><tr><th>Itens persistidos e fotografias</th></tr></thead>
                <tbody>
                  {itemGroups.flatMap((group) => {
                    if (group.kind === "compact") {
                      const groupKey = group.entries.map(({ item }) => item.origemId).join("-");
                      return [
                        <tr key={`compact-${groupKey}`}>
                          <td className="compact-items-cell">
                            <div className={`compact-items-grid ${group.entries.length === 1 ? "compact-items-grid-single" : ""}`}>
                              {group.entries.map(({ item, index }) => {
                                const photo = item.fotos[0];
                                return (
                                  <article className="compact-item-card" key={`compact-item-${item.origemId}`}>
                                    <ChecklistItemCopy item={item} index={index} />
                                    <ChecklistPhoto
                                      item={item}
                                      itemIndex={index}
                                      photoIndex={0}
                                      source={assetUrls[photo.storagePath]}
                                      compact
                                    />
                                  </article>
                                );
                              })}
                            </div>
                          </td>
                        </tr>,
                      ];
                    }

                    const { item, index: itemIndex } = group.entry;
                    return [
                      <tr data-print-row-keep-with-next={item.fotos.length > 0 ? "" : undefined} key={`item-${item.origemId}`}>
                        <td><ChecklistItemCopy item={item} index={itemIndex} /></td>
                      </tr>,
                      ...Array.from({ length: Math.ceil(item.fotos.length / 2) }, (_, photoRowIndex) => {
                        const rowPhotos = item.fotos.slice(photoRowIndex * 2, photoRowIndex * 2 + 2);
                        return (
                          <tr key={`photo-row-${item.origemId}-${photoRowIndex}`}>
                            <td className="photo-cell">
                              <div className={`photo-grid ${rowPhotos.length === 1 ? "photo-grid-single" : ""}`}>
                                {rowPhotos.map((photo, columnIndex) => {
                                  const photoIndex = photoRowIndex * 2 + columnIndex;
                                  return (
                                    <ChecklistPhoto
                                      key={`photo-${item.origemId}-${photo.origemId}`}
                                      item={item}
                                      itemIndex={itemIndex}
                                      photoIndex={photoIndex}
                                      source={assetUrls[photo.storagePath]}
                                    />
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
              <section data-print-final-block className="checklist-final-block">
                {document.snapshot.checklist.observacaoDocumento && <p><b>Observação de saída:</b> {document.snapshot.checklist.observacaoDocumento}</p>}
                {document.snapshot.checklist.retiradoPor && <p><b>Retirado por:</b> {document.snapshot.checklist.retiradoPor}</p>}
                {document.assinatura ? <>
                  <h2>Ciência e assinatura {document.assinatura.metodo === "REMOTA_DESENHADA" ? "remota" : "presencial"}</h2>
                  <p>{document.assinatura.declaracao}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="signature-image" src={assetUrls[document.assinatura.assinaturaPath]} alt="Assinatura preservada" />
                  <div className="signature-grid">
                    <span><b>Nome:</b> {document.assinatura.signatarioNome}</span>
                    <span><b>CPF/CNPJ:</b> {formatCpfCnpj(document.assinatura.signatarioDocumento)}</span>
                    <span><b>Função:</b> {document.assinatura.qualidadeOutro || CHECKLIST_QUALIDADE_LABEL[document.assinatura.signatarioQualidade as ChecklistSignatarioQualidade]}</span>
                    <span><b>Data/hora:</b> {formatDate(document.assinatura.assinadoEm)}</span>
                    <span><b>Método:</b> {document.assinatura.metodo === "REMOTA_DESENHADA" ? "Assinatura eletrônica simples remota — link secreto, CPF e senha" : "Assinatura eletrônica simples presencial"}</span>
                    <span><b>{document.assinatura.metodo === "REMOTA_DESENHADA" ? "Autenticação" : "Inspetor(es)"}:</b> {document.assinatura.metodo === "REMOTA_DESENHADA" ? "Link secreto, CPF e senha" : document.snapshot.checklist.responsaveis.join(", ") || "Não identificado"}</span>
                  </div>
                  <div className="hashes">Snapshot SHA-256: {document.snapshotHash}<br />Assinatura SHA-256: {document.assinatura.assinaturaHash}<br />Vínculo: {document.assinatura.assinaturaVinculoHash}</div>
                </> : <div className="provisional-notice"><b>DOCUMENTO PROVISÓRIO · NÃO ASSINADO</b><p>{CHECKLIST_DECLARACAO}</p></div>}
              </section>
            </div>
          </article>
        </div>
      </div>
      <SignatureDialog publicId={document.publicId} open={signatureOpen} onOpenChange={setSignatureOpen} />
      <style jsx global>{`
        ${PRINT_DOCUMENT_HEADER_CSS}
        .checklist-print-page{--a4w:210mm;--a4h:297mm}
        .checklist-report-sheet{position:relative;width:var(--a4w);height:var(--a4h);min-height:var(--a4h);overflow:hidden;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.14)}
        .checklist-report-sheet .conteudo{height:calc(var(--a4h) - 99px);padding:8px 15px 20px;overflow:hidden}
        .checklist-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #dbe1e8;border-radius:6px;overflow:hidden;margin-bottom:5px}
        .checklist-summary>div{padding:3px 7px;border-right:1px solid #dbe1e8;font-size:8px;line-height:1.2}.checklist-summary>div:last-child{border:0}.checklist-summary b{display:block;color:#64748b;font-size:6px;text-transform:uppercase}.checklist-summary span{display:block;margin-top:1px;overflow-wrap:anywhere}
        .checklist-context h2,.checklist-final-block h2{margin:4px 0 2px;padding:3px 6px;border-radius:3px;background:#f1f5f9;font-size:7.5px;line-height:1.15;text-transform:uppercase}
        .checklist-context dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border-left:1px solid #e2e8f0;border-top:1px solid #e2e8f0}
        .checklist-context dl>div{min-width:0;padding:3px 6px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;font-size:7.2px;line-height:1.2}.checklist-context dt{color:#64748b;font-size:5.8px;font-weight:700;text-transform:uppercase}.checklist-context dd{margin:1px 0 0;overflow-wrap:anywhere}
        .checklist-items-table{width:100%;margin-top:5px;border-collapse:collapse;table-layout:fixed}.checklist-items-table th{padding:5px 8px;background:#e2e8f0;text-align:left;font-size:7.5px;text-transform:uppercase}.checklist-items-table td{padding:8px;border:1px solid #dbe1e8;font-size:8.3px;line-height:1.35;overflow-wrap:anywhere;break-inside:avoid}.item-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;font-size:9.3px;font-weight:700}.item-title span{min-width:0}.item-title strong{flex:none;border-radius:999px;padding:2px 7px;font-size:7px}.item-copy p{margin:4px 0 0}.status-ok{background:#dcfce7;color:#166534}.status-alerta{background:#fef3c7;color:#92400e}.status-falha{background:#fee2e2;color:#991b1b}.status-outro{background:#e2e8f0;color:#334155}.item-description{color:#64748b}.item-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;color:#64748b;font-size:7px}.compact-items-cell{padding:8px!important}.compact-items-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:stretch}.compact-items-grid-single .compact-item-card{grid-column:1/-1;width:calc(50% - 4px);justify-self:center}.compact-item-card{display:flex;min-width:0;flex-direction:column;padding:8px;border:1px solid #dbe1e8;border-radius:5px;background:#fff;break-inside:avoid}.compact-item-card .item-title strong{max-width:46%;white-space:normal;text-align:center}.compact-photo-card{margin-top:auto;padding-top:7px;border-top:1px solid #e2e8f0}.photo-cell{text-align:center}.photo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.photo-grid-single .photo-card{grid-column:1/-1;width:calc(50% - 4px);justify-self:center}.photo-card{min-width:0;break-inside:avoid}.photo-context{margin-bottom:6px;text-align:left;font-size:8px;font-weight:700}.photo-card img{display:block;width:100%;height:210px;object-fit:contain;background:#f8fafc}.compact-photo-card img{height:155px}.photo-card p{margin:4px 0 0;color:#64748b;font-size:7.5px}.checklist-final-block{padding-top:8px;font-size:8px;line-height:1.4}.signature-image{display:block;width:260px;height:90px;object-fit:contain;border-bottom:1px solid #0f172a}.signature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 15px;margin-top:7px}.hashes{margin-top:7px;color:#64748b;font-family:monospace;font-size:6.3px;overflow-wrap:anywhere}.provisional-notice{border:2px dashed #ef4444;padding:12px;text-align:center;color:#991b1b}.checklist-provisional::after{content:"PROVISÓRIO";position:absolute;left:50%;top:55%;z-index:0;transform:translate(-50%,-50%) rotate(-32deg);color:rgba(220,38,38,.075);font-size:76px;font-weight:900;letter-spacing:.12em;pointer-events:none}.checklist-provisional>*{position:relative;z-index:1}
        @media print{body{background:#fff!important}.checklist-print-page{padding:0!important;background:#fff!important}.checklist-report-sheet{box-shadow:none!important}.print-generated-page-number{bottom:4mm}.checklist-report-sheet .conteudo{padding-bottom:24px}@page{size:A4;margin:0}}
        @media(max-width:850px){.checklist-report-sheet{transform-origin:top left}.checklist-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>
    </main>
  );
}
