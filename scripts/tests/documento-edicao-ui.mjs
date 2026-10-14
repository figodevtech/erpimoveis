// Edição do documento dinâmico na hora da impressão (/print/documento/...).
// Monta a tela de verdade com o contrato de venda padrão e os dados de
// exemplo, e percorre: editar, digitar por cima, apagar, colar, concluir,
// imprimir (botão e Ctrl+P dentro da edição), sair e desfazer.
//
//   node scripts/tests/documento-edicao-ui.mjs
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "artifacts/documento-edicao-ui");
await mkdir(artifacts, { recursive: true });

const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentoView } from '@/app/(app)/(full)/print/documento/[modeloId]/[registroId]/documento-view';
import { CATALOGOS } from '@/lib/documentos/catalogo';
import { contextoDeExemplo } from '@/lib/documentos/exemplos';
import { renderizarModelo } from '@/lib/documentos/motor';
import { documentoPadrao } from '@/lib/documentos/padrao';
const html = renderizarModelo(documentoPadrao('venda_contrato').html, contextoDeExemplo('venda', 'Contrato'), CATALOGOS.venda);
createRoot(document.getElementById('root')).render(<DocumentoView voltar="/historicovendas" titulo="Contrato #1" html={html} />);`;

// Fora do Next não há roteador: o Link vira um <a> comum.
const linkSimples = {
  name: "link-simples",
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "link-simples" }));
    b.onLoad({ filter: /.*/, namespace: "link-simples" }, () => ({
      contents: "import React from 'react'; export default React.forwardRef(function Link({ href, ...p }, ref) { return React.createElement('a', { href, ref, ...p }); });",
      loader: "js",
      resolveDir: root,
    }));
  },
};

await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outfile: path.join(artifacts, "app.js"),
  platform: "browser",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [linkSimples],
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  logLevel: "warning",
});
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), {
  from: path.join(root, "src/app/globals.css"),
});
await writeFile(path.join(artifacts, "app.css"), css.css);

const server = createServer(async (req, res) => {
  if (req.url === "/app.js" || req.url === "/app.css") {
    res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(artifacts, req.url.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ok = (passo) => console.log(`✔ ${passo}`);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: "pt-BR" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // O frame não roda script; a impressão é a página chamando print() dele.
  // Aqui o print() de cada frame registra o que sairia no papel.
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get() {
        const janela = original.get.call(this);
        if (janela && !janela.__impressaoRegistrada) {
          janela.__impressaoRegistrada = true;
          janela.print = () => {
            const d = janela.document;
            window.__impressoes = [...(window.__impressoes ?? []), {
              folhas: d.querySelectorAll(".doc-folha").length,
              editavel: d.body.isContentEditable,
              texto: d.body.innerText,
            }];
          };
        }
        return janela;
      },
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);

  const noFrame = (fn, arg) =>
    page.evaluate(([fonte, a]) => new Function("d", "a", `return (${fonte})(d, a)`)(document.querySelector("iframe").contentDocument, a), [fn.toString(), arg]);
  const selecionar = (alvo) =>
    noFrame((d, texto) => {
      const nos = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
      for (let n = nos.nextNode(); n; n = nos.nextNode()) {
        const i = n.data.indexOf(texto);
        if (i < 0) continue;
        const faixa = d.createRange();
        faixa.setStart(n, i);
        faixa.setEnd(n, i + texto.length);
        d.body.focus();
        d.getSelection().removeAllRanges();
        d.getSelection().addRange(faixa);
        return true;
      }
      return false;
    }, alvo);
  const folhas = () => noFrame((d) => d.querySelectorAll(".doc-folha").length);

  await expect.poll(folhas).toBeGreaterThan(0);
  const folhasIniciais = await folhas();
  ok(`abre paginado (${folhasIniciais} folhas)`);

  await page.getByRole("button", { name: "Editar texto" }).click();
  await expect.poll(() => noFrame((d) => d.body.isContentEditable && !d.querySelector(".doc-folha"))).toBe(true);
  await page.screenshot({ path: path.join(artifacts, "edicao.png") });
  ok("Editar texto: documento contínuo e editável");

  expect(await selecionar("2% (dois por cento)")).toBe(true);
  await page.keyboard.type("5% (cinco por cento)");
  expect(await selecionar("novos e em perfeito estado, ")).toBe(true);
  await page.keyboard.press("Delete");
  await expect(page.getByText("Editado", { exact: true })).toBeVisible();
  ok("digitar por cima e apagar marcam o documento como Editado");

  await noFrame((d, texto) => {
    const dados = new DataTransfer();
    dados.setData("text/plain", texto);
    dados.setData("text/html", "<span style='color:red;font-size:40px'>X</span>");
    d.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dados, bubbles: true, cancelable: true }));
  }, "Cláusula extra colada. ".repeat(400));
  expect(await noFrame((d) => d.body.innerHTML.includes("color:red"))).toBe(false);
  ok("colar entra como texto puro");

  await page.getByRole("button", { name: "Concluir" }).click();
  await expect.poll(folhas).toBeGreaterThan(folhasIniciais);
  const concluido = await noFrame((d) => ({
    editavel: d.body.isContentEditable,
    marcaDaEdicao: Boolean(d.querySelector("[data-documento-edicao]")),
    texto: d.body.innerText,
    excesso: Array.from(d.querySelectorAll(".doc-folha-corpo")).map((c) => c.scrollHeight - c.clientHeight),
  }));
  expect(concluido.editavel).toBe(false);
  expect(concluido.marcaDaEdicao).toBe(false);
  expect(concluido.texto).toContain("5% (cinco por cento)");
  expect(concluido.texto).not.toContain("2% (dois por cento)");
  expect(concluido.texto).not.toContain("novos e em perfeito estado");
  expect(concluido.texto).toContain("Cláusula extra colada.");
  expect(concluido.excesso.every((px) => px <= 1)).toBe(true);
  await page.screenshot({ path: path.join(artifacts, "concluido.png") });
  ok(`Concluir: repaginado com o texto novo em ${await folhas()} folhas, sem corte`);

  await page.getByRole("button", { name: "Editar texto" }).click();
  await expect.poll(() => noFrame((d) => d.body.isContentEditable)).toBe(true);
  expect(await noFrame((d) => d.body.innerText.includes("5% (cinco por cento)"))).toBe(true);
  const titulo = page.frameLocator("iframe").locator("h1");
  await titulo.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" - VIA DO CLIENTE");
  await titulo.press("Control+p");
  await expect.poll(() => page.evaluate(() => (window.__impressoes ?? []).length)).toBe(1);
  const impressa = await page.evaluate(() => window.__impressoes[0]);
  expect(impressa.editavel).toBe(false);
  expect(impressa.folhas).toBeGreaterThan(folhasIniciais);
  expect(impressa.texto).toContain("VIA DO CLIENTE");
  ok("Ctrl+P na edição: conclui e imprime as folhas, com o texto editado");

  await page.getByRole("button", { name: "Imprimir" }).click();
  await expect.poll(() => page.evaluate(() => window.__impressoes.length)).toBe(2);
  ok("Imprimir fora da edição");

  page.once("dialog", (dialogo) => dialogo.dismiss());
  await page.getByRole("link", { name: "Sair" }).click();
  expect(new URL(page.url()).pathname).toBe("/");
  ok("Sair com alteração pede confirmação; recusando, fica");

  page.once("dialog", (dialogo) => dialogo.accept());
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect.poll(() => noFrame((d) => d.body.innerText.includes("2% (dois por cento)"))).toBe(true);
  await expect.poll(folhas).toBe(folhasIniciais);
  await expect(page.getByText("Editado", { exact: true })).toHaveCount(0);
  ok("Desfazer volta ao documento original");

  if (errors.length) throw new Error(`Erros na página: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
