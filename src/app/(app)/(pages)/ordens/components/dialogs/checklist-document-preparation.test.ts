import assert from "node:assert/strict";
import test from "node:test";
import { createChecklistDocumentWithProgress } from "./checklist-document-preparation";

function streamResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const serialized = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  const midpoint = Math.floor(serialized.length / 2);
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(serialized.slice(0, midpoint)));
      controller.enqueue(encoder.encode(serialized.slice(midpoint)));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

test("consome atualizações NDJSON antes de retornar o documento concluído", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => streamResponse([
    { type: "progress", progress: { percentual: 20, etapa: "CARREGANDO_DADOS", titulo: "Dados carregados", detalhe: "2 itens" } },
    { type: "progress", progress: { percentual: 75, etapa: "PRESERVANDO_IMAGENS", titulo: "Fotos preservadas", detalhe: "3 fotos", atual: 3, total: 4 } },
    { type: "complete", document: { publicId: "0ad1eb14-1369-4282-9586-d983d062a268", versao: 7 } },
  ]);

  const progress: number[] = [];
  const result = await createChecklistDocumentWithProgress({
    ordemServicoId: 294,
    tipo: "ENTRADA",
    onProgress: (event) => progress.push(event.percentual),
  });

  assert.deepEqual(progress, [20, 75]);
  assert.equal(result.document.versao, 7);
});

test("propaga a mensagem enviada pelo evento de falha", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => streamResponse([
    { type: "progress", progress: { percentual: 30, etapa: "PRESERVANDO_IMAGENS", titulo: "Preservando", detalhe: "Foto 1" } },
    { type: "error", error: "Uma fotografia não pôde ser preservada.", code: "FOTO_INDISPONIVEL" },
  ]);

  await assert.rejects(
    createChecklistDocumentWithProgress({ ordemServicoId: 294, tipo: "ENTRADA", onProgress: () => undefined }),
    /Uma fotografia não pôde ser preservada/,
  );
});
