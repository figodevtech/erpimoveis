import QRCode from "qrcode";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFImage,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CHECKLIST_PDF_GENERATOR_VERSION,
  CHECKLIST_TIPO_LABEL,
  formatCpfCnpj,
  groupChecklistItemsForPrint,
  CHECKLIST_QUALIDADE_LABEL,
  type ChecklistSignatarioQualidade,
} from "./checklist-documento";
import { sha256 } from "./checklist-documento-hash";
import {
  CHECKLIST_DOCUMENTOS_BUCKET,
  downloadChecklistAsset,
  loadChecklistDocumento,
  registerChecklistDocumentoEvent,
  type ChecklistDocumentoCompleto,
} from "./checklist-documentos-server";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 34;
const HEADER_HEIGHT = 76;
const HEADER_BOTTOM = PAGE_HEIGHT - HEADER_HEIGHT - 10;
const FOOTER_TOP = 22;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0.08, 0.09, 0.11);
const MUTED = rgb(0.38, 0.42, 0.48);
const BORDER = rgb(0.82, 0.84, 0.87);
const PALE = rgb(0.96, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);

type PdfContext = {
  pdf: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  document: ChecklistDocumentoCompleto;
  assetLoader: (storagePath: string) => Promise<Buffer>;
  brandPrimary: ReturnType<typeof rgb>;
  brandSecondary: ReturnType<typeof rgb>;
  brandText: ReturnType<typeof rgb>;
  repeatedSectionTitle: string | null;
};

function colorFromHex(value: unknown, fallback: ReturnType<typeof rgb>) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return fallback;
  return rgb(
    Number.parseInt(match[1].slice(0, 2), 16) / 255,
    Number.parseInt(match[1].slice(2, 4), 16) / 255,
    Number.parseInt(match[1].slice(4, 6), 16) / 255,
  );
}

function mixColor(
  left: ReturnType<typeof rgb>,
  right: ReturnType<typeof rgb>,
  rightWeight: number,
) {
  const weight = Math.max(0, Math.min(1, rightWeight));
  return rgb(
    left.red * (1 - weight) + right.red * weight,
    left.green * (1 - weight) + right.green * weight,
    left.blue * (1 - weight) + right.blue * weight,
  );
}

function formatPdfDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, "");
}

function wrap(value: unknown, font: PDFFont, size: number, width: number) {
  const paragraphs = safe(value).split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      let remainder = word;
      while (font.widthOfTextAtSize(remainder, size) > width && remainder.length > 1) {
        let cut = remainder.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(remainder.slice(0, cut), size) > width) cut -= 1;
        lines.push(remainder.slice(0, cut));
        remainder = remainder.slice(cut);
      }
      current = remainder;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function addPage(ctx: PdfContext) {
  ctx.page = ctx.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = HEADER_BOTTOM;
  if (ctx.repeatedSectionTitle) drawSectionBar(ctx, ctx.repeatedSectionTitle);
}

function ensureSpace(ctx: PdfContext, height: number) {
  if (ctx.y - height < FOOTER_TOP + 8) addPage(ctx);
}

function responsePalette(value: string) {
  const normalized = safe(value).trim().toUpperCase();
  if (/^(OK|SIM|APROVADO|CONFORME|BOM|FUNCIONANDO)$/.test(normalized)) {
    return {
      background: rgb(0.88, 0.97, 0.91),
      border: rgb(0.63, 0.88, 0.7),
      text: rgb(0.06, 0.48, 0.22),
    };
  }
  if (/^(NÃO|NAO|REPROVADO|NÃO CONFORME|NAO CONFORME|RUIM|DEFEITO)$/.test(normalized)) {
    return {
      background: rgb(1, 0.91, 0.91),
      border: rgb(0.94, 0.69, 0.69),
      text: rgb(0.72, 0.12, 0.12),
    };
  }
  if (/^(ATENÇÃO|ATENCAO|REGULAR|PARCIAL|PENDENTE)$/.test(normalized)) {
    return {
      background: rgb(1, 0.96, 0.83),
      border: rgb(0.94, 0.8, 0.43),
      text: rgb(0.58, 0.36, 0.02),
    };
  }
  return {
    background: rgb(0.91, 0.94, 0.98),
    border: rgb(0.7, 0.78, 0.88),
    text: rgb(0.2, 0.31, 0.48),
  };
}

function drawSectionBar(ctx: PdfContext, title: string) {
  ctx.y -= 4;
  const background = mixColor(ctx.brandPrimary, WHITE, 0.91);
  const border = mixColor(ctx.brandPrimary, WHITE, 0.68);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 15,
    width: CONTENT_WIDTH,
    height: 17,
    color: background,
    borderColor: border,
    borderWidth: 0.7,
  });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 15, width: 3, height: 17, color: ctx.brandPrimary });
  ctx.page.drawText(safe(title.toUpperCase()), { x: MARGIN + 8, y: ctx.y - 10.5, size: 7.4, font: ctx.bold, color: ctx.brandPrimary });
  ctx.y -= 20;
}

function section(ctx: PdfContext, title: string) {
  ensureSpace(ctx, 24);
  drawSectionBar(ctx, title);
}

function fieldGrid(
  ctx: PdfContext,
  fields: Array<{ rotulo: string; valor: string }>,
  options: { columns?: number; dense?: boolean } = {},
) {
  if (!fields.length) return;
  const columns = Math.max(1, options.columns ?? 2);
  const dense = options.dense === true;
  const valueSize = dense ? 7.15 : 8.2;
  const valueLineHeight = dense ? 8.8 : 10.5;
  const labelSize = dense ? 5.2 : 6;
  const labelY = dense ? 8 : 10;
  const valueY = dense ? 16.5 : 21;
  const baseHeight = dense ? 12.5 : 18;
  for (let index = 0; index < fields.length; index += columns) {
    const row = fields.slice(index, index + columns);
    const widths = row.map(() => CONTENT_WIDTH / row.length);
    const layouts = row.map((entry, itemIndex) => ({
      entry,
      lines: wrap(entry.valor, ctx.regular, valueSize, widths[itemIndex] - 12),
    }));
    const height = baseHeight + Math.max(...layouts.map((layout) => layout.lines.length)) * valueLineHeight;
    ensureSpace(ctx, height);
    let x = MARGIN;
    layouts.forEach((layout, itemIndex) => {
      const width = widths[itemIndex];
      ctx.page.drawRectangle({
        x,
        y: ctx.y - height,
        width,
        height,
        color: WHITE,
        borderColor: mixColor(ctx.brandPrimary, WHITE, 0.78),
        borderWidth: 0.65,
      });
      ctx.page.drawText(safe(layout.entry.rotulo.toUpperCase()), { x: x + 6, y: ctx.y - labelY, size: labelSize, font: ctx.bold, color: ctx.brandPrimary });
      layout.lines.forEach((line, lineIndex) => {
        ctx.page.drawText(safe(line), { x: x + 6, y: ctx.y - valueY - lineIndex * valueLineHeight, size: valueSize, font: ctx.regular, color: BLACK });
      });
      x += width;
    });
    ctx.y -= height;
  }
}

function drawItemText(
  ctx: PdfContext,
  item: ChecklistDocumentoCompleto["snapshot"]["checklist"]["itens"][number],
  index: number,
  minimumFollowingHeight = 0,
) {
  const answer = safe(item.resposta || "Não informado");
  const badgeWidth = Math.min(96, Math.max(34, ctx.bold.widthOfTextAtSize(answer, 7.1) + 16));
  const hasBadge = ctx.bold.widthOfTextAtSize(answer, 7.1) <= 80;
  const titleWidth = CONTENT_WIDTH - 18 - (hasBadge ? badgeWidth + 10 : 0);
  const titleLines = wrap(`${index + 1}. ${item.titulo}`, ctx.bold, 9.2, titleWidth);
  const descriptionLines = item.descricao ? wrap(item.descricao, ctx.regular, 7.6, CONTENT_WIDTH - 16) : [];
  const answerLines = hasBadge ? [] : wrap(`Resposta registrada: ${answer}`, ctx.bold, 8.4, CONTENT_WIDTH - 16);
  const observationLines = item.observacao ? wrap(`Observação: ${item.observacao}`, ctx.regular, 8.2, CONTENT_WIDTH - 16) : [];
  const metadata = [
    item.categoria ? `Categoria: ${item.categoria}` : null,
    item.responsavel ? `Responsável: ${item.responsavel}` : null,
    item.registradoEm ? `Registro: ${formatPdfDate(item.registradoEm)}` : null,
  ].filter((value): value is string => Boolean(value)).join("   |   ");
  const metadataLines = metadata ? wrap(metadata, ctx.regular, 7, CONTENT_WIDTH - 16) : [];
  const all = [
    ...titleLines.map((line) => ({ line, font: ctx.bold, size: 9.2, color: BLACK })),
    ...descriptionLines.map((line) => ({ line, font: ctx.regular, size: 7.6, color: MUTED })),
    ...answerLines.map((line) => ({ line, font: ctx.bold, size: 8.4, color: BLACK })),
    ...observationLines.map((line) => ({ line, font: ctx.regular, size: 8.2, color: BLACK })),
    ...metadataLines.map((line) => ({ line, font: ctx.regular, size: 7, color: MUTED })),
  ];
  const height = 16 + all.reduce((sum, line) => sum + line.size + 3, 0);
  const maxPageBlock = HEADER_BOTTOM - FOOTER_TOP - 32;
  if (height <= maxPageBlock) ensureSpace(ctx, height + minimumFollowingHeight);
  else ensureSpace(ctx, 70);

  let offset = 0;
  let continuation = false;
  while (offset < all.length) {
    const topPadding = continuation ? 24 : 9;
    // O piso precisa ser o mesmo de ensureSpace: se o bloco preenchesse menos que
    // o espaco aprovado, um item que "cabe" quebraria em continuacao sem necessidade.
    const availableContent = ctx.y - (FOOTER_TOP + 8) - topPadding - 7;
    let usedContent = 0;
    let end = offset;
    while (end < all.length) {
      const lineHeight = all[end].size + 3;
      if (end > offset && usedContent + lineHeight > availableContent) break;
      usedContent += lineHeight;
      end += 1;
    }
    const blockHeight = topPadding + usedContent + 7;
    const top = ctx.y;
    const bottom = top - blockHeight;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height: blockHeight,
      color: WHITE,
      borderColor: mixColor(ctx.brandPrimary, WHITE, 0.76),
      borderWidth: 0.7,
    });
    ctx.page.drawRectangle({ x: MARGIN, y: bottom, width: 3, height: blockHeight, color: ctx.brandPrimary });

    let textY = top - 9;
    if (continuation) {
      ctx.page.drawText(safe(`${index + 1}. ${item.titulo} (continuação)`), {
        x: MARGIN + 9,
        y: top - 14,
        size: 7.5,
        font: ctx.bold,
        color: ctx.brandPrimary,
      });
      textY = top - 24;
    } else if (hasBadge) {
      const palette = responsePalette(answer);
      const badgeX = PAGE_WIDTH - MARGIN - badgeWidth - 8;
      ctx.page.drawRectangle({
        x: badgeX,
        y: top - 21,
        width: badgeWidth,
        height: 15,
        color: palette.background,
        borderColor: palette.border,
        borderWidth: 0.55,
      });
      ctx.page.drawText(answer, {
        x: badgeX + (badgeWidth - ctx.bold.widthOfTextAtSize(answer, 7.1)) / 2,
        y: top - 16.6,
        size: 7.1,
        font: ctx.bold,
        color: palette.text,
      });
    }

    for (let lineIndex = offset; lineIndex < end; lineIndex += 1) {
      const entry = all[lineIndex];
      ctx.page.drawText(safe(entry.line), {
        x: MARGIN + 9,
        y: textY - entry.size,
        size: entry.size,
        font: entry.font,
        color: entry.color,
      });
      textY -= entry.size + 3;
    }
    ctx.y = bottom - 5;
    offset = end;
    if (offset < all.length) {
      addPage(ctx);
      continuation = true;
    }
  }
}

async function embedJpeg(ctx: PdfContext, bytes: Buffer) {
  const jpeg = await sharp(bytes).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toBuffer();
  return ctx.pdf.embedJpg(jpeg);
}

function drawPhotoRow(ctx: PdfContext, photos: Array<{ image: PDFImage; caption: string }>) {
  const gap = 10;
  const columnWidth = (CONTENT_WIDTH - gap) / 2;
  const cardPadding = 7;
  const innerWidth = columnWidth - cardPadding * 2;
  const maxImageHeight = 158;
  const layouts = photos.map(({ image, caption }) => {
    const captionLines = wrap(caption, ctx.bold, 7.2, innerWidth);
    const ratio = Math.min(innerWidth / image.width, maxImageHeight / image.height);
    return {
      image,
      captionLines,
      width: image.width * ratio,
      height: image.height * ratio,
    };
  });
  const rowImageHeight = Math.max(...layouts.map((layout) => layout.height));
  const rowCaptionHeight = Math.max(...layouts.map((layout) => layout.captionLines.length * 9));
  const blockHeight = rowImageHeight + rowCaptionHeight + cardPadding * 2 + 5;
  ensureSpace(ctx, blockHeight);
  const top = ctx.y;
  const bottom = top - blockHeight;
  const cardBackground = mixColor(ctx.brandPrimary, WHITE, 0.965);
  const cardBorder = mixColor(ctx.brandPrimary, WHITE, 0.8);

  layouts.forEach((layout, index) => {
    const columnX = layouts.length === 1
      ? MARGIN + (CONTENT_WIDTH - columnWidth) / 2
      : MARGIN + index * (columnWidth + gap);
    ctx.page.drawRectangle({
      x: columnX,
      y: bottom,
      width: columnWidth,
      height: blockHeight,
      color: cardBackground,
      borderColor: cardBorder,
      borderWidth: 0.65,
    });
    const imageX = columnX + (columnWidth - layout.width) / 2;
    const imageAreaBottom = bottom + cardPadding;
    const imageY = imageAreaBottom + (rowImageHeight - layout.height) / 2;
    ctx.page.drawImage(layout.image, {
      x: imageX,
      y: imageY,
      width: layout.width,
      height: layout.height,
    });
    layout.captionLines.forEach((line, lineIndex) => {
      ctx.page.drawText(safe(line), {
        x: columnX + cardPadding,
        y: top - 12 - lineIndex * 9,
        size: 7.2,
        font: ctx.bold,
        color: ctx.brandPrimary,
      });
    });
  });

  ctx.y -= blockHeight + 5;
}

function drawCompactItemRow(
  ctx: PdfContext,
  entries: Array<{
    item: ChecklistDocumentoCompleto["snapshot"]["checklist"]["itens"][number];
    index: number;
    image: PDFImage;
  }>,
) {
  const gap = 10;
  const columnWidth = (CONTENT_WIDTH - gap) / 2;
  const padding = 8;
  const innerWidth = columnWidth - padding * 2;
  const imageAreaHeight = 116;
  const layouts = entries.map(({ item, index, image }) => {
    const answer = safe(item.resposta || "Não informado");
    const badgeWidth = Math.min(78, Math.max(32, ctx.bold.widthOfTextAtSize(answer, 6.6) + 14));
    const hasBadge = ctx.bold.widthOfTextAtSize(answer, 6.6) <= 64;
    const titleWidth = innerWidth - (hasBadge ? badgeWidth + 8 : 0);
    const titleLines = wrap(`${index + 1}. ${item.titulo}`, ctx.bold, 8.3, titleWidth);
    const descriptionLines = item.descricao ? wrap(item.descricao, ctx.regular, 6.9, innerWidth) : [];
    const answerLines = hasBadge ? [] : wrap(`Resposta: ${answer}`, ctx.bold, 7.2, innerWidth);
    const observationLines = item.observacao ? wrap(`Observação: ${item.observacao}`, ctx.regular, 7.2, innerWidth) : [];
    const metadata = [
      item.categoria ? `Categoria: ${item.categoria}` : null,
      item.responsavel ? `Responsável: ${item.responsavel}` : null,
      item.registradoEm ? `Registro: ${formatPdfDate(item.registradoEm)}` : null,
    ].filter((value): value is string => Boolean(value)).join(" | ");
    const metadataLines = metadata ? wrap(metadata, ctx.regular, 6.2, innerWidth) : [];
    const textLines = [
      ...titleLines.map((line) => ({ line, font: ctx.bold, size: 8.3, color: BLACK })),
      ...descriptionLines.map((line) => ({ line, font: ctx.regular, size: 6.9, color: MUTED })),
      ...answerLines.map((line) => ({ line, font: ctx.bold, size: 7.2, color: BLACK })),
      ...observationLines.map((line) => ({ line, font: ctx.regular, size: 7.2, color: BLACK })),
      ...metadataLines.map((line) => ({ line, font: ctx.regular, size: 6.2, color: MUTED })),
    ];
    const textHeight = textLines.reduce((sum, line) => sum + line.size + 2.4, 0);
    const photo = item.fotos[0];
    const description = photo.descricao || "Sem descrição";
    const photoDescriptionLines = wrap(description, ctx.regular, 6.7, innerWidth);
    const ratio = Math.min(innerWidth / image.width, imageAreaHeight / image.height);
    return {
      item,
      index,
      image,
      answer,
      badgeWidth,
      hasBadge,
      textLines,
      textHeight,
      photoDescriptionLines,
      imageWidth: image.width * ratio,
      imageHeight: image.height * ratio,
    };
  });

  const maxTextHeight = Math.max(...layouts.map((layout) => layout.textHeight));
  const maxDescriptionLines = Math.max(...layouts.map((layout) => layout.photoDescriptionLines.length));
  const imageAreaTopOffset = 10 + maxTextHeight + 4 + 11 + 6;
  const descriptionHeight = maxDescriptionLines * 8.3;
  const blockHeight = imageAreaTopOffset + imageAreaHeight + descriptionHeight + 12;
  ensureSpace(ctx, blockHeight);
  const top = ctx.y;
  const bottom = top - blockHeight;
  const cardBackground = mixColor(ctx.brandPrimary, WHITE, 0.97);
  const cardBorder = mixColor(ctx.brandPrimary, WHITE, 0.78);

  layouts.forEach((layout, layoutIndex) => {
    const columnX = layouts.length === 1
      ? MARGIN + (CONTENT_WIDTH - columnWidth) / 2
      : MARGIN + layoutIndex * (columnWidth + gap);
    ctx.page.drawRectangle({
      x: columnX,
      y: bottom,
      width: columnWidth,
      height: blockHeight,
      color: cardBackground,
      borderColor: cardBorder,
      borderWidth: 0.7,
    });
    ctx.page.drawRectangle({ x: columnX, y: bottom, width: 3, height: blockHeight, color: ctx.brandPrimary });

    if (layout.hasBadge) {
      const palette = responsePalette(layout.answer);
      const badgeX = columnX + columnWidth - padding - layout.badgeWidth;
      ctx.page.drawRectangle({
        x: badgeX,
        y: top - 20,
        width: layout.badgeWidth,
        height: 14,
        color: palette.background,
        borderColor: palette.border,
        borderWidth: 0.5,
      });
      ctx.page.drawText(layout.answer, {
        x: badgeX + (layout.badgeWidth - ctx.bold.widthOfTextAtSize(layout.answer, 6.6)) / 2,
        y: top - 15.8,
        size: 6.6,
        font: ctx.bold,
        color: palette.text,
      });
    }

    let textY = top - 10;
    layout.textLines.forEach((line) => {
      ctx.page.drawText(safe(line.line), {
        x: columnX + padding,
        y: textY - line.size,
        size: line.size,
        font: line.font,
        color: line.color,
      });
      textY -= line.size + 2.4;
    });

    const dividerY = top - 10 - maxTextHeight - 4;
    ctx.page.drawLine({
      start: { x: columnX + padding, y: dividerY },
      end: { x: columnX + columnWidth - padding, y: dividerY },
      thickness: 0.55,
      color: cardBorder,
    });
    ctx.page.drawText("FOTO 1 DE 1", {
      x: columnX + padding,
      y: dividerY - 10,
      size: 6.3,
      font: ctx.bold,
      color: ctx.brandPrimary,
    });
    const imageAreaTop = top - imageAreaTopOffset;
    const imageX = columnX + (columnWidth - layout.imageWidth) / 2;
    const imageY = imageAreaTop - imageAreaHeight + (imageAreaHeight - layout.imageHeight) / 2;
    ctx.page.drawImage(layout.image, {
      x: imageX,
      y: imageY,
      width: layout.imageWidth,
      height: layout.imageHeight,
    });
    layout.photoDescriptionLines.forEach((line, lineIndex) => {
      ctx.page.drawText(safe(line), {
        x: columnX + padding,
        y: imageAreaTop - imageAreaHeight - 9 - lineIndex * 8.3,
        size: 6.7,
        font: ctx.regular,
        color: MUTED,
      });
    });
  });

  ctx.y = bottom - 5;
}

function verificationUrl(document: ChecklistDocumentoCompleto) {
  const origin = String(process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
  return `${origin}/verificar/checklist/${document.tokenVerificacao}`;
}

async function drawSignatureSection(ctx: PdfContext) {
  const signature = ctx.document.assinatura;
  if (!signature) return;
  const remote = signature.metodo === "REMOTA_DESENHADA";
  addPage(ctx);
  section(ctx, remote ? "Ciência e assinatura remota" : "Ciência e assinatura presencial");
  const declarationLines = wrap(signature.declaracao, ctx.regular, 8.8, CONTENT_WIDTH - 24);
  const declarationHeight = 20 + declarationLines.length * 11.5;
  ensureSpace(ctx, declarationHeight);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - declarationHeight,
    width: CONTENT_WIDTH,
    height: declarationHeight,
    color: mixColor(ctx.brandPrimary, WHITE, 0.95),
    borderColor: mixColor(ctx.brandPrimary, WHITE, 0.72),
    borderWidth: 0.7,
  });
  ctx.page.drawText("DECLARAÇÃO DE CIÊNCIA", {
    x: MARGIN + 10,
    y: ctx.y - 12,
    size: 6.5,
    font: ctx.bold,
    color: ctx.brandPrimary,
  });
  declarationLines.forEach((line, index) => {
    ctx.page.drawText(safe(line), {
      x: MARGIN + 10,
      y: ctx.y - 26 - index * 11.5,
      size: 8.8,
      font: ctx.regular,
      color: BLACK,
    });
  });
  ctx.y -= declarationHeight + 10;

  const signatureBytes = await ctx.assetLoader(signature.assinaturaPath);
  const png = await sharp(signatureBytes).png().toBuffer();
  const embedded = await ctx.pdf.embedPng(png);
  const ratio = Math.min(285 / embedded.width, 86 / embedded.height);
  const width = embedded.width * ratio;
  const height = embedded.height * ratio;
  const url = verificationUrl(ctx.document);
  const qrData = await QRCode.toDataURL(url, { width: 300, margin: 0, errorCorrectionLevel: "M" });
  const qr = await ctx.pdf.embedPng(Buffer.from(qrData.split(",")[1] ?? "", "base64"));
  const gap = 10;
  const qrCardWidth = 137;
  const signatureCardWidth = CONTENT_WIDTH - qrCardWidth - gap;
  const cardHeight = 132;
  ensureSpace(ctx, cardHeight);
  const cardBottom = ctx.y - cardHeight;
  const cardBorder = mixColor(ctx.brandPrimary, WHITE, 0.76);
  const cardBackground = mixColor(ctx.brandPrimary, WHITE, 0.97);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: cardBottom,
    width: signatureCardWidth,
    height: cardHeight,
    color: cardBackground,
    borderColor: cardBorder,
    borderWidth: 0.7,
  });
  ctx.page.drawText("ASSINATURA DO RESPONSÁVEL", {
    x: MARGIN + 10,
    y: ctx.y - 13,
    size: 6.5,
    font: ctx.bold,
    color: ctx.brandPrimary,
  });
  const signatureX = MARGIN + (signatureCardWidth - width) / 2;
  const signatureY = cardBottom + 31 + Math.max(0, (80 - height) / 2);
  ctx.page.drawImage(embedded, { x: signatureX, y: signatureY, width, height });
  ctx.page.drawLine({
    start: { x: MARGIN + 18, y: cardBottom + 28 },
    end: { x: MARGIN + signatureCardWidth - 18, y: cardBottom + 28 },
    thickness: 0.65,
    color: mixColor(BLACK, WHITE, 0.35),
  });
  ctx.page.drawText(remote
    ? "Traço fornecido pelo responsável no acesso remoto autenticado"
    : "Traço coletado presencialmente no dispositivo da oficina", {
    x: MARGIN + 18,
    y: cardBottom + 15,
    size: 6.5,
    font: ctx.regular,
    color: MUTED,
  });

  const qrCardX = MARGIN + signatureCardWidth + gap;
  ctx.page.drawRectangle({
    x: qrCardX,
    y: cardBottom,
    width: qrCardWidth,
    height: cardHeight,
    color: cardBackground,
    borderColor: cardBorder,
    borderWidth: 0.7,
  });
  ctx.page.drawText("VERIFICAR AUTENTICIDADE", {
    x: qrCardX + 12,
    y: ctx.y - 13,
    size: 6.2,
    font: ctx.bold,
    color: ctx.brandPrimary,
  });
  ctx.page.drawImage(qr, { x: qrCardX + 22.5, y: cardBottom + 19, width: 92, height: 92 });
  ctx.y -= cardHeight + 10;

  const quality = CHECKLIST_QUALIDADE_LABEL[signature.signatarioQualidade as ChecklistSignatarioQualidade] ?? signature.signatarioQualidade;
  fieldGrid(ctx, [
    { rotulo: "Nome", valor: signature.signatarioNome },
    { rotulo: remote ? "CPF" : "CPF/CNPJ", valor: formatCpfCnpj(signature.signatarioDocumento) },
    { rotulo: "Função", valor: signature.qualidadeOutro || quality },
    { rotulo: "Assinado em", valor: formatPdfDate(signature.assinadoEm) },
    {
      rotulo: "Método",
      valor: remote
        ? "Assinatura eletrônica simples remota — link secreto, CPF e senha"
        : "Assinatura eletrônica simples presencial - traço desenhado",
    },
    remote
      ? { rotulo: "Autenticação", valor: "Link secreto, CPF e senha" }
      : { rotulo: "Operador autenticado", valor: signature.operadorNome || "Identificado no registro interno" },
  ]);
  ctx.y -= 9;
  section(ctx, "Integridade e verificação");
  const inspectors = ctx.document.snapshot.checklist.responsaveis.join(", ") || "Não identificado";
  const integrityLines = [
    ...wrap(`Inspetor(es): ${inspectors}`, ctx.regular, 7, CONTENT_WIDTH - 20),
    ...wrap(`Hash do snapshot: ${ctx.document.snapshotHash}`, ctx.regular, 6.4, CONTENT_WIDTH - 20),
    ...wrap(`Hash do conteúdo: ${ctx.document.conteudoHash}`, ctx.regular, 6.4, CONTENT_WIDTH - 20),
    ...wrap(`Hash da assinatura: ${signature.assinaturaHash}`, ctx.regular, 6.4, CONTENT_WIDTH - 20),
    ...wrap(`Vínculo assinatura/snapshot: ${signature.assinaturaVinculoHash}`, ctx.regular, 6.4, CONTENT_WIDTH - 20),
    ...wrap(`Verificação: ${url}`, ctx.regular, 6.4, CONTENT_WIDTH - 20),
  ];
  const integrityHeight = 14 + integrityLines.length * 8.4;
  ensureSpace(ctx, integrityHeight);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - integrityHeight,
    width: CONTENT_WIDTH,
    height: integrityHeight,
    color: PALE,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  integrityLines.forEach((line, index) => {
    ctx.page.drawText(safe(line), {
      x: MARGIN + 10,
      y: ctx.y - 11 - index * 8.4,
      size: index === 0 ? 7 : 6.4,
      font: index === 0 ? ctx.bold : ctx.regular,
      color: index === 0 ? BLACK : MUTED,
    });
  });
  ctx.y -= integrityHeight;
}

async function drawHeadersAndFooters(ctx: PdfContext, logo: PDFImage | null) {
  const pages = ctx.pdf.getPages();
  pages.forEach((page, index) => {
    const headerY = PAGE_HEIGHT - HEADER_HEIGHT;
    page.drawRectangle({ x: 0, y: headerY, width: PAGE_WIDTH, height: HEADER_HEIGHT, color: ctx.brandPrimary });
    const gradientStart = PAGE_WIDTH * 0.48;
    const gradientWidth = PAGE_WIDTH - gradientStart;
    for (let band = 0; band < 6; band += 1) {
      page.drawRectangle({
        x: gradientStart + (gradientWidth / 6) * band,
        y: headerY,
        width: gradientWidth / 6 + 0.5,
        height: HEADER_HEIGHT,
        color: mixColor(ctx.brandPrimary, ctx.brandSecondary, (band + 1) / 6),
      });
    }

    const logoBox = 48;
    const logoBoxY = headerY + (HEADER_HEIGHT - logoBox) / 2;
    page.drawRectangle({
      x: MARGIN,
      y: logoBoxY,
      width: logoBox,
      height: logoBox,
      color: WHITE,
      borderColor: mixColor(ctx.brandPrimary, WHITE, 0.55),
      borderWidth: 0.7,
      opacity: 0.98,
    });
    if (logo) {
      const ratio = Math.min(40 / logo.width, 40 / logo.height);
      const logoWidth = logo.width * ratio;
      const logoHeight = logo.height * ratio;
      page.drawImage(logo, {
        x: MARGIN + (logoBox - logoWidth) / 2,
        y: logoBoxY + (logoBox - logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      page.drawText("LOGO", {
        x: MARGIN + 13,
        y: logoBoxY + 20,
        size: 7,
        font: ctx.bold,
        color: ctx.brandPrimary,
      });
    }

    const documentBoxWidth = 129;
    const documentBoxX = PAGE_WIDTH - MARGIN - documentBoxWidth;
    const companyX = MARGIN + logoBox + 13;
    const companyWidth = documentBoxX - companyX - 13;
    const companyNameLines = wrap(ctx.document.snapshot.empresa.nome, ctx.bold, 11.5, companyWidth).slice(0, 2);
    companyNameLines.forEach((line, lineIndex) => {
      page.drawText(safe(line), {
        x: companyX,
        y: headerY + 55 - lineIndex * 12.5,
        size: 11.5,
        font: ctx.bold,
        color: ctx.brandText,
      });
    });
    const companyDetailLines = ctx.document.snapshot.empresa.campos.flatMap((field) =>
      wrap(`${field.rotulo}: ${field.valor}`, ctx.regular, 6, companyWidth),
    ).slice(0, Math.max(2, 5 - companyNameLines.length));
    const detailsStart = headerY + 55 - companyNameLines.length * 12.5 - 2;
    companyDetailLines.forEach((line, lineIndex) => {
      page.drawText(safe(line), {
        x: companyX,
        y: detailsStart - lineIndex * 7.4,
        size: 6,
        font: ctx.regular,
        color: ctx.brandText,
      });
    });

    page.drawRectangle({
      x: documentBoxX,
      y: headerY + 10,
      width: documentBoxWidth,
      height: 56,
      color: WHITE,
      opacity: 0.1,
      borderColor: ctx.brandText,
      borderOpacity: 0.55,
      borderWidth: 0.8,
    });
    const typeLabel = "CHECKLIST";
    const typeWidth = ctx.bold.widthOfTextAtSize(typeLabel, 7);
    page.drawText(typeLabel, {
      x: documentBoxX + (documentBoxWidth - typeWidth) / 2,
      y: headerY + 53,
      size: 7,
      font: ctx.bold,
      color: ctx.brandText,
    });
    const osLabel = `#${ctx.document.ordemServicoId}`;
    const osWidth = ctx.bold.widthOfTextAtSize(osLabel, 17);
    page.drawText(osLabel, {
      x: documentBoxX + (documentBoxWidth - osWidth) / 2,
      y: headerY + 28,
      size: 17,
      font: ctx.bold,
      color: ctx.brandText,
    });
    const checklistType = CHECKLIST_TIPO_LABEL[ctx.document.tipo];
    const checklistTypeWidth = ctx.bold.widthOfTextAtSize(checklistType, 7.5);
    page.drawText(checklistType, {
      x: documentBoxX + (documentBoxWidth - checklistTypeWidth) / 2,
      y: headerY + 14,
      size: 7.5,
      font: ctx.bold,
      color: ctx.brandText,
    });

    page.drawLine({
      start: { x: MARGIN, y: 20 },
      end: { x: PAGE_WIDTH - MARGIN, y: 20 },
      thickness: 0.75,
      color: mixColor(ctx.brandPrimary, WHITE, 0.55),
    });
    const footerLeft = `DOCUMENTO OFICIAL · ${ctx.document.codigo}`;
    const footerRight = `Página ${index + 1} de ${pages.length}`;
    page.drawText(safe(footerLeft), { x: MARGIN, y: 8, size: 6.3, font: ctx.bold, color: ctx.brandPrimary });
    page.drawText(safe(footerRight), {
      x: PAGE_WIDTH - MARGIN - ctx.regular.widthOfTextAtSize(safe(footerRight), 6.5),
      y: 8,
      size: 6.5,
      font: ctx.regular,
      color: MUTED,
    });
  });
}

export async function generateChecklistOfficialPdf(
  document: ChecklistDocumentoCompleto,
  assetLoader: (storagePath: string) => Promise<Buffer> = downloadChecklistAsset,
) {
  if (!document.assinatura) throw new Error("O PDF oficial exige uma assinatura preservada.");
  const expectedAssetHashes = new Map<string, string>([
    ...(document.snapshot.empresa.logo
      ? [[document.snapshot.empresa.logo.storagePath, document.snapshot.empresa.logo.sha256] as const]
      : []),
    ...document.snapshot.checklist.itens.flatMap((item) =>
      item.fotos.map((photo) => [photo.storagePath, photo.sha256] as const),
    ),
    [document.assinatura.assinaturaPath, document.assinatura.assinaturaHash] as const,
  ]);
  const verifiedAssets = new Map<string, Buffer>();
  const loadVerifiedAsset = async (storagePath: string) => {
    const cached = verifiedAssets.get(storagePath);
    if (cached) return cached;
    const expectedHash = expectedAssetHashes.get(storagePath);
    if (!expectedHash) throw new Error(`Ativo não vinculado ao snapshot: ${storagePath}`);
    const bytes = await assetLoader(storagePath);
    if (sha256(bytes) !== expectedHash) {
      throw new Error(`O ativo ${storagePath} falhou na verificação de integridade.`);
    }
    verifiedAssets.set(storagePath, bytes);
    return bytes;
  };
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${document.codigo} - Checklist de ${document.tipo.toLowerCase()}`);
  pdf.setAuthor(document.snapshot.empresa.nome);
  pdf.setSubject(`Checklist versionado da OS #${document.ordemServicoId}`);
  pdf.setCreator("ERP Oficina");
  pdf.setProducer(CHECKLIST_PDF_GENERATOR_VERSION);
  pdf.setCreationDate(new Date(document.assinatura.assinadoEm));
  pdf.setModificationDate(new Date(document.assinatura.assinadoEm));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brandPrimary = colorFromHex(document.snapshot.empresa.cores.primaria, rgb(0.09, 0.35, 0.86));
  const brandSecondary = colorFromHex(document.snapshot.empresa.cores.secundaria, rgb(0.02, 0.63, 0.72));
  const brandText = colorFromHex(document.snapshot.empresa.cores.texto, WHITE);
  const ctx: PdfContext = {
    pdf,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: HEADER_BOTTOM,
    document,
    assetLoader,
    brandPrimary,
    brandSecondary,
    brandText,
    repeatedSectionTitle: null,
  };

  const logo = document.snapshot.empresa.logo
    ? await embedJpeg(ctx, await loadVerifiedAsset(document.snapshot.empresa.logo.storagePath))
    : null;

  section(ctx, "Resumo do documento");
  fieldGrid(ctx, [
    { rotulo: "Código", valor: document.codigo },
    { rotulo: "Versão", valor: String(document.versao) },
    {
      rotulo: "Criado em",
      valor: formatPdfDate(document.snapshot.checklist.inspecionadoEm),
    },
    { rotulo: "Modelo", valor: document.snapshot.checklist.modelo || "Sem modelo identificado" },
  ], { columns: 4, dense: true });
  section(ctx, "Ordem de serviço e cliente");
  fieldGrid(ctx, [...document.snapshot.ordemServico.campos, ...document.snapshot.ordemServico.cliente], { columns: 3, dense: true });
  section(ctx, `Objeto inspecionado - ${document.snapshot.ordemServico.objeto.tipo}`);
  fieldGrid(ctx, [{ rotulo: "Identificação", valor: document.snapshot.ordemServico.objeto.titulo }, ...document.snapshot.ordemServico.objeto.campos], { columns: 3, dense: true });
  const itemSectionTitle = "Itens persistidos e fotografias";
  const itemGroups = groupChecklistItemsForPrint(document.snapshot.checklist.itens);
  if (itemGroups.length) {
    ensureSpace(ctx, itemGroups[0].kind === "compact" ? 240 : itemGroups[0].entry.item.fotos.length > 0 ? 275 : 110);
  }
  section(ctx, itemSectionTitle);
  ctx.repeatedSectionTitle = itemSectionTitle;

  for (let groupIndex = 0; groupIndex < itemGroups.length; groupIndex += 1) {
    const group = itemGroups[groupIndex];
    if (group.kind === "compact") {
      const layouts: Array<{
        item: ChecklistDocumentoCompleto["snapshot"]["checklist"]["itens"][number];
        index: number;
        image: PDFImage;
      }> = [];
      for (const entry of group.entries) {
        const photo = entry.item.fotos[0];
        layouts.push({
          item: entry.item,
          index: entry.index,
          image: await embedJpeg(ctx, await loadVerifiedAsset(photo.storagePath)),
        });
      }
      drawCompactItemRow(ctx, layouts);
      continue;
    }

    const { item, index } = group.entry;
    const minimumFollowingHeight = item.fotos.length > 0
      ? 215
      : groupIndex < itemGroups.length - 1
        ? 80
        : 0;
    drawItemText(ctx, item, index, minimumFollowingHeight);
    for (let photoIndex = 0; photoIndex < item.fotos.length; photoIndex += 2) {
      const rowPhotos = item.fotos.slice(photoIndex, photoIndex + 2);
      const layouts: Array<{ image: PDFImage; caption: string }> = [];
      for (let columnIndex = 0; columnIndex < rowPhotos.length; columnIndex += 1) {
        const photo = rowPhotos[columnIndex];
        layouts.push({
          image: await embedJpeg(ctx, await loadVerifiedAsset(photo.storagePath)),
          caption: `${item.titulo} - Foto ${photoIndex + columnIndex + 1} de ${item.fotos.length}${photo.descricao ? ` - ${photo.descricao}` : ""}`,
        });
      }
      drawPhotoRow(ctx, layouts);
    }
  }
  ctx.repeatedSectionTitle = null;

  if (document.snapshot.checklist.observacaoDocumento || document.snapshot.checklist.retiradoPor) {
    section(ctx, "Registro de saída");
    fieldGrid(ctx, [
      ...(document.snapshot.checklist.retiradoPor ? [{ rotulo: "Retirado por", valor: document.snapshot.checklist.retiradoPor }] : []),
      ...(document.snapshot.checklist.observacaoDocumento ? [{ rotulo: "Observação", valor: document.snapshot.checklist.observacaoDocumento }] : []),
    ]);
  }

  ctx.assetLoader = loadVerifiedAsset;
  await drawSignatureSection(ctx);
  await drawHeadersAndFooters(ctx, logo);
  return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
}

export async function ensureChecklistOfficialPdf(args: {
  publicId: string;
  userId: string | null;
  audit: { ip: string | null; userAgent: string | null };
}) {
  let document = await loadChecklistDocumento(args.publicId, { checkCurrentContent: false });
  if (!document.assinatura) throw new Error("O documento ainda não foi assinado.");
  if (document.arquivo) return document;

  try {
    const bytes = await generateChecklistOfficialPdf(document);
    const hash = sha256(bytes);
    const storagePath = `documentos/${document.id}/oficial-${hash}.pdf`;
    const upload = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).upload(storagePath, bytes, {
      contentType: "application/pdf",
      cacheControl: "31536000",
      upsert: false,
    });
    if (upload.error && !/already exists|duplicate|resource exists/i.test(String(upload.error.message ?? ""))) throw upload.error;
    const inserted = await supabaseAdmin.from("checklist_documento_arquivo").insert({
      documento_id: document.id,
      storage_path: storagePath,
      pdf_hash: hash,
      tamanho_bytes: bytes.byteLength,
      gerador_versao: CHECKLIST_PDF_GENERATOR_VERSION,
    });
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    await registerChecklistDocumentoEvent({
      documentoId: document.id,
      tipo: "PDF_OFICIAL_GERADO",
      userId: args.userId,
      audit: args.audit,
      metadata: { pdfHash: hash, tamanhoBytes: bytes.byteLength },
    });
    document = await loadChecklistDocumento(args.publicId, { checkCurrentContent: false });
    return document;
  } catch (error) {
    await registerChecklistDocumentoEvent({
      documentoId: document.id,
      tipo: "PDF_OFICIAL_FALHOU",
      userId: args.userId,
      audit: args.audit,
      metadata: { erro: error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido" },
    }).catch(() => undefined);
    throw error;
  }
}
