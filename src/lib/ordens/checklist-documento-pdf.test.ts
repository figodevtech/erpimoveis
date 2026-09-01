import assert from "node:assert/strict";
import test from "node:test";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import type { ChecklistDocumentoCompleto } from "./checklist-documentos-server";
import { sha256 } from "./checklist-documento-hash";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
process.env.NEXT_PUBLIC_APP_URL ||= "https://erp.example.com";

async function fixture() {
  const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#dbeafe" } }).jpeg().toBuffer();
  const signature = await sharp({ create: { width: 700, height: 180, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from('<svg width="700" height="180"><path d="M40 120 C180 20 300 170 620 55" fill="none" stroke="#111827" stroke-width="8"/></svg>') }])
    .png()
    .toBuffer();
  const photos = Array.from({ length: 17 }, (_, index) => ({
    origemId: String(index + 1),
    storagePath: "foto.jpg",
    sha256: sha256(photo),
    mimeType: "image/jpeg",
    tamanhoBytes: photo.byteLength,
    descricao: `Registro detalhado ${index + 1}`,
    registradoEm: "2026-09-01T12:00:00.000Z",
  }));
  const document: ChecklistDocumentoCompleto = {
    id: 1,
    publicId: "10000000-0000-4000-8000-000000000001",
    codigo: "CHK-E-OS00000001-V0001",
    tokenVerificacao: "20000000-0000-4000-8000-000000000001",
    ordemServicoId: 1,
    tipo: "ENTRADA",
    versao: 1,
    snapshot: {
      schemaVersion: 1,
      documento: { publicId: "10000000-0000-4000-8000-000000000001", codigo: "CHK-E-OS00000001-V0001", tipo: "ENTRADA", versao: 1, criadoEm: "2026-09-01T12:00:00.000Z" },
      empresa: { nome: "Oficina de Teste", campos: [], logo: null, cores: { primaria: "#1d4ed8", secundaria: "#0891b2", texto: "#ffffff" } },
      ordemServico: { id: 1, campos: [{ rotulo: "OS", valor: "#1" }], cliente: [], objeto: { tipo: "EQUIPAMENTO", titulo: "Compressor", campos: [] } },
      checklist: {
        modelo: "Inspeção extensa",
        descricaoModelo: null,
        inspecionadoEm: "2026-09-01T12:00:00.000Z",
        responsaveis: ["Inspetora Ana"],
        retiradoPor: null,
        observacaoDocumento: null,
        itens: [{ origemId: "1", titulo: "Item com dezessete fotografias", descricao: "Descrição longa", categoria: "Geral", ordem: 0, resposta: "CONDIÇÃO PERSONALIZADA", observacao: "Observação extensa. ".repeat(180), registradoEm: "2026-09-01T12:00:00.000Z", responsavel: "Inspetora Ana", fotos: photos }],
      },
      declaracao: "Declaro estar ciente do conteúdo deste checklist.",
    },
    snapshotHash: "a".repeat(64),
    conteudoHash: "b".repeat(64),
    sourceFingerprint: "c".repeat(64),
    criadoEm: "2026-09-01T12:00:00.000Z",
    criadoPor: "Operador",
    maisRecente: true,
    conteudoAtualDivergente: false,
    assinatura: {
      id: 1,
      signatarioNome: "Cliente de Teste",
      signatarioDocumento: "52998224725",
      signatarioQualidade: "CLIENTE",
      qualidadeOutro: null,
      declaracao: "Declaro estar ciente do conteúdo deste checklist.",
      metodo: "PRESENCIAL_DESENHADA",
      assinaturaPath: "assinatura.png",
      assinaturaHash: sha256(signature),
      assinaturaVinculoHash: "d".repeat(64),
      operadorNome: "Operador",
      assinadoEm: "2026-09-01T12:30:00.000Z",
    },
    arquivo: null,
  };
  return { document, assets: new Map<string, Buffer>([["foto.jpg", photo], ["assinatura.png", signature]]) };
}

type TextoExtraido = {
  titles: Array<{ page: number; y: number; text: string }>;
  allText: string[];
  minY: number;
};

/** Le os fluxos de conteudo e devolve cada texto com a pagina e o y onde foi desenhado. */
function extrairTextos(pdf: PDFDocument): TextoExtraido {
  const titles: TextoExtraido["titles"] = [];
  const allText: string[] = [];
  let minY = Number.POSITIVE_INFINITY;

  pdf.getPages().forEach((page, pageIndex) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    let raw = "";
    streams.forEach((reference) => {
      const stream = pdf.context.lookup(reference);
      if (stream instanceof PDFRawStream) raw += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    });
    for (const match of raw.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-F]+)> Tj/g)) {
      const text = Buffer.from(match[3], "hex").toString("latin1");
      const y = Number(match[2]);
      allText.push(text);
      minY = Math.min(minY, y);
      if (/^\d+\. /.test(text)) titles.push({ page: pageIndex + 1, y, text });
    }
  });

  return { titles, allText, minY };
}

test("gera A4 paginado com item longo e 17 fotos sem variar os bytes oficiais", async () => {
  const { generateChecklistOfficialPdf } = await import("./checklist-documento-pdf");
  const { document, assets } = await fixture();
  const loadAsset = async (path: string) => {
    const bytes = assets.get(path);
    if (!bytes) throw new Error(`Ativo ausente: ${path}`);
    return bytes;
  };
  const first = await generateChecklistOfficialPdf(document, loadAsset);
  const second = await generateChecklistOfficialPdf(document, loadAsset);
  assert.equal(sha256(first), sha256(second));
  const pdf = await PDFDocument.load(first);
  assert.ok(pdf.getPageCount() >= 4);
  assert.ok(pdf.getPageCount() < 10, "duas fotos por linha devem reduzir a paginação");
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});

test("recusa fotografia ou assinatura cujo conteúdo não corresponde ao hash preservado", async () => {
  const { generateChecklistOfficialPdf } = await import("./checklist-documento-pdf");
  const { document, assets } = await fixture();
  const tamperedAssets = new Map(assets);
  tamperedAssets.set("foto.jpg", Buffer.from("imagem adulterada"));

  await assert.rejects(
    generateChecklistOfficialPdf(document, async (path) => {
      const bytes = tamperedAssets.get(path);
      if (!bytes) throw new Error(`Ativo ausente: ${path}`);
      return bytes;
    }),
    /verificação de integridade/,
  );
});

test("coloca dois itens de foto única lado a lado e mantém item de várias fotos em largura total", async () => {
  const { generateChecklistOfficialPdf } = await import("./checklist-documento-pdf");
  const { document, assets } = await fixture();
  const template = document.snapshot.checklist.itens[0];
  const photo = template.fotos[0];
  document.snapshot.checklist.itens = [
    { ...template, origemId: "frente", titulo: "Frente", observacao: null, fotos: [{ ...photo, origemId: "foto-frente" }] },
    { ...template, origemId: "traseira", titulo: "Traseira", observacao: null, fotos: [{ ...photo, origemId: "foto-traseira" }] },
    {
      ...template,
      origemId: "painel",
      titulo: "Painel",
      observacao: null,
      fotos: Array.from({ length: 3 }, (_, index) => ({ ...photo, origemId: `foto-painel-${index}` })),
    },
    { ...template, origemId: "estepe", titulo: "Estepe", observacao: null, fotos: [] },
    { ...template, origemId: "motor", titulo: "Motor", observacao: null, fotos: [{ ...photo, origemId: "foto-motor" }] },
  ];
  const bytes = await generateChecklistOfficialPdf(document, async (path) => {
    const asset = assets.get(path);
    if (!asset) throw new Error(`Ativo ausente: ${path}`);
    return asset;
  });
  const pdf = await PDFDocument.load(bytes);
  const { titles, allText } = extrairTextos(pdf);

  const front = titles.find((title) => title.text === "1. Frente");
  const rear = titles.find((title) => title.text === "2. Traseira");
  assert.ok(front && rear);
  assert.equal(front.page, rear.page);
  assert.equal(front.y, rear.y);
  assert.equal(allText.filter((text) => text === "FOTO 1 DE 1").length, 2);
  assert.ok(allText.some((text) => text.includes("Painel - Foto 1 de 3")));
  assert.ok(allText.some((text) => text.includes("Motor - Foto 1 de 1")));
});

test("mantem quatro itens de foto unica na primeira pagina, como na previa de impressao", async () => {
  const { generateChecklistOfficialPdf } = await import("./checklist-documento-pdf");
  const { document, assets } = await fixture();
  const template = document.snapshot.checklist.itens[0];
  const photo = template.fotos[0];
  // Reproduz a OS #294: quatro itens de foto unica seguidos e um item sem foto.
  // O responsavel longo forca os metadados a quebrarem em duas linhas, como no uso real.
  const comFoto = (origemId: string, titulo: string, descricao: string) => ({
    ...template,
    origemId,
    titulo,
    descricao,
    observacao: null,
    resposta: "OK",
    responsavel: "bruno_nrt@hotmail.com",
    fotos: [{ ...photo, origemId: `foto-${origemId}` }],
  });
  document.snapshot.checklist.itens = [
    comFoto("frente", "Frente", "PARABRISA, FAROIS, PISCAS, LATARIA"),
    comFoto("traseira", "Traseira", "PARABRISA, LANTERNAS, PARACHOQUE"),
    comFoto("lateral-esquerda", "Lateral esquerda (lado motorista)", "PORTA, LATARIA, VIDROS, RETROVISOR"),
    comFoto("lateral-direita", "Lateral direita (lado passageiro)", "PORTAS, LATARIA, VIDROS, RETROVISOR"),
    { ...template, origemId: "estepe", titulo: "Pneu de suporte / estepe", observacao: null, fotos: [] },
  ];

  const bytes = await generateChecklistOfficialPdf(document, async (path) => {
    const asset = assets.get(path);
    if (!asset) throw new Error(`Ativo ausente: ${path}`);
    return asset;
  });
  const pdf = await PDFDocument.load(bytes);
  const { titles, minY } = extrairTextos(pdf);

  const primeiraPagina = titles.filter((title) => title.page === 1);
  const quatroPrimeiros = ["1. Frente", "2. Traseira", "3. Lateral esquerda", "4. Lateral direita"];
  for (const prefixo of quatroPrimeiros) {
    assert.ok(
      primeiraPagina.some((title) => title.text.startsWith(prefixo)),
      `${prefixo} deveria caber na primeira pagina, como na previa`,
    );
  }

  // Duas duplas compactas: os quatro itens de foto unica ocupam exatamente duas alturas.
  const alturasCompactas = new Set(
    primeiraPagina
      .filter((title) => quatroPrimeiros.some((prefixo) => title.text.startsWith(prefixo)))
      .map((title) => title.y),
  );
  assert.equal(alturasCompactas.size, 2, "os quatro itens devem formar duas linhas de duas colunas");

  // O rodape institucional e desenhado em y=8; nada pode descer abaixo dele.
  assert.ok(minY >= 8, "nenhum texto pode ultrapassar a base do rodape");
  assert.ok(
    titles.every((title) => title.y >= 22),
    "nenhum titulo de item pode invadir a faixa do rodape",
  );
});
