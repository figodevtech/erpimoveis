import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareShopeeImage } from "./shopee-image";

test("converte WebP do ERP em JPEG aceito pela Shopee", async () => {
  const source = await sharp({
    create: { width: 640, height: 480, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 0.6 } },
  }).webp({ quality: 90 }).toBuffer();

  const prepared = await prepareShopeeImage(new Uint8Array(source), "foto-produto.webp");
  const metadata = await sharp(prepared.bytes).metadata();

  assert.equal(prepared.mimeType, "image/jpeg");
  assert.equal(prepared.fileName, "foto-produto.jpg");
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 480);
  assert.ok(prepared.bytes.length < 1_800_000);
  assert.deepEqual(Array.from(prepared.bytes.slice(0, 3)), [0xff, 0xd8, 0xff]);
});

test("recusa conteúdo que não é uma imagem", async () => {
  await assert.rejects(() => prepareShopeeImage(new TextEncoder().encode("não é imagem"), "arquivo.webp"), /imagem válida/i);
});

test("recusa imagem menor que o limite mínimo", async () => {
  const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => prepareShopeeImage(new Uint8Array(source), "mini.png"), /muito pequena/i);
});
