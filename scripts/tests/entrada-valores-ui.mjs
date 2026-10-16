// Exercita o editor real em navegador, com HTTP controlado; não altera bancos.
import assert from "node:assert/strict";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "artifacts/entrada-valores-ui");
await mkdir(artifacts, { recursive: true });
await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Toaster } from 'sonner';
    import { AjustarValoresEntrada } from '@/components/entrada-fiscal/ajustar-valores-entrada';
    function App() {
      const [revision, setRevision] = useState(0);
      return <main style={{ maxWidth: 1000, margin: '24px auto', padding: 16 }}>
        <AjustarValoresEntrada key={revision} entryId={1255} inventory="produto" versao={revision}
          total={500} itens={[{id:1322,titulo:'Módulo eletrônico',quantidade:1,valor_unitario_compra:500,
            valor_unitario_compra_original:500,valor_total:500}]}
          resumo={{valorNota:500,totalCompra:500,totalFinanceiro:450,financeiroPreservado:true,
            versaoFinanceiro:'teste',historico:[]}} podeAjustar={true}
          onSaved={() => setRevision((value) => value + 1)} />
        <output aria-label="Revisões salvas">{revision}</output><Toaster />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  ` },
  bundle: true, outfile: path.join(artifacts, "app.js"), platform: "browser", jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" }, logLevel: "warning",
});
const css = await postcss([tailwind({ base: root })]).process(
  await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
await writeFile(path.join(artifacts, "app.css"), css.css);
const requisicoes = [];
let conflito = false;
const server = createServer(async (req, res) => {
  if (req.url === "/api/entradas/1255/valores" && req.method === "PATCH") {
    let body = "";
    for await (const chunk of req) body += chunk;
    requisicoes.push(JSON.parse(body));
    res.writeHead(conflito ? 409 : 200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(conflito ? { error: "Os valores foram alterados. Recarregue a entrada." } : { success: true }));
  }
  if (req.url === "/app.js" || req.url === "/app.css") {
    res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css");
    return res.end(await readFile(path.join(artifacts, req.url.slice(1))));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const erros = [];
  page.on("pageerror", (error) => erros.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByText(/Os lançamentos financeiros existentes foram preservados/)).toBeVisible();
  await page.getByRole("button", { name: "Ajustar valores", exact: true }).click();
  const unitario = page.getByLabel("Valor unitário de compra", { exact: true });
  const salvar = page.getByRole("button", { name: "Salvar ajuste", exact: true });
  await unitario.click();
  await unitario.fill("1500");
  await unitario.blur();
  await expect(salvar).toBeDisabled();
  await page.getByLabel("Motivo do ajuste", { exact: true }).fill("Valor efetivo da compra");
  await expect(page.getByText(/Total desta entrada após ajuste: R\$\s*1.500,00/)).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, "ajuste-desktop.png"), fullPage: true });
  await salvar.click();
  await expect(page.getByLabel("Revisões salvas")).toHaveText("1");
  assert.deepEqual(requisicoes[0], { inventory: "produto", versaoEsperada: 0, motivo: "Valor efetivo da compra",
    itens: [{ id: 1322, valorUnitarioCompra: 1500 }] });
  await page.getByRole("button", { name: "Ajustar valores", exact: true }).click();
  await unitario.click();
  await unitario.fill("1800");
  await page.getByRole("button", { name: "Restaurar valor original" }).click();
  await expect(salvar).toBeDisabled();
  await unitario.click();
  await unitario.fill("1600");
  await page.getByLabel("Motivo do ajuste", { exact: true }).fill("Revisão de custo");
  conflito = true;
  await salvar.click();
  await expect(page.getByRole("button", { name: "Recarregar entrada" })).toBeVisible();
  await expect(salvar).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "ajuste-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false,
    "Editor não pode causar rolagem horizontal no celular.");
  await page.getByRole("button", { name: "Recarregar entrada" }).click();
  await expect(page.getByLabel("Revisões salvas")).toHaveText("2");
  assert.deepEqual(erros, []);
  console.log("OK — editor desktop/celular, motivo obrigatório, prévia, restauração, contrato HTTP e conflito de versão.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
