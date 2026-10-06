/** UI real da venda, com APIs isoladas: nunca envia escritas ao banco. */
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "artifacts/eventos-venda-ui");
await mkdir(artifacts, { recursive: true });
const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from 'next-auth/react';
import { ConfigProvider } from '@/app/(app)/(pages)/config-context';
import { VendaEventosFinanceiros } from '@/app/(app)/(pages)/(vendas)/historicovendas/components/venda-eventos-financeiros';
import { Toaster } from 'sonner';
const perms = ['financeiro:visualizar','financeiro:criar','vendas:visualizar',
  ...(!location.search.includes('sem-editar') ? ['financeiro:editar'] : []),
  ...(!location.search.includes('sem-excluir') ? ['financeiro:excluir'] : [])];
const session = { user: {id:'operador',permissoes:perms},expires:'2099-01-01'};
createRoot(document.getElementById('root')).render(<SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
  <ConfigProvider config={{habilitar_drawers:true}}><main className="mx-auto max-w-5xl p-4"><VendaEventosFinanceiros vendaId={150}/></main><Toaster/></ConfigProvider>
</SessionProvider>);`;
await build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true,
  outfile: path.join(artifacts, "app.js"), platform: "browser", jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}",
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://supabase-fixture.invalid"',
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"fixture-anon-key"' }, logLevel: "warning" });
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
await writeFile(path.join(artifacts, "app.css"), css.css);
const server = createServer(async (req, res) => {
  if (req.url === "/app.js" || req.url === "/app.css") {
    res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(artifacts, req.url.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" });
  const errors = [], writes = [];
  page.on("pageerror", e => errors.push(e.message));
  const base = { ordemservicoid: null, source_type: "VENDA", source_id: 150, status: "ATIVO", valor: 20,
    is_manual: true, chave_origem: "MANUAL:teste", natureza: "DESPESA", origem: "SERVICO", pode_gerar_transacao: true };
  const fixture = () => [
    { ...base, id: 1, descricao: "Avulso despesa" },
    { ...base, id: 2, natureza: "RECEITA", descricao: "Avulso receita" },
    { ...base, id: 3, origem: "PRODUTO", natureza: "RECEITA", descricao: "Receita produto", is_manual: false, chave_origem: "123", pode_gerar_transacao: false },
    { ...base, id: 4, origem: "FRETE", natureza: "RECEITA", descricao: "Receita frete", is_manual: false, chave_origem: "FRETE", pode_gerar_transacao: false },
    { ...base, id: 5, origem: "COMISSAO", descricao: "Comissão automática", is_manual: false, chave_origem: "COMISSAO_VENDA" },
    { ...base, id: 6, origem: "PRODUTO", descricao: "Custo automático", is_manual: false, chave_origem: "123", pode_gerar_transacao: false },
    { ...base, id: 7, origem: "DESCONTO", descricao: "Desconto automático", is_manual: false, chave_origem: "DESCONTO", pode_gerar_transacao: false },
    { ...base, id: 8, natureza: "RECEITA", descricao: "Receita vinculada", status: "CONVERTIDO", transacaoid: 18 },
    { ...base, id: 9, descricao: "Despesa agrupada", status: "CONVERTIDO", lancamento_id: 19 },
    { ...base, id: 10, descricao: "Outra despesa agrupada", status: "CONVERTIDO", lancamento_id: 19 },
  ];
  let eventos = fixture(), recusarExclusao = false;
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (method !== "GET") writes.push({ url: url.pathname, method, body: req.postDataJSON() });
    if (url.pathname === "/api/venda/150/eventos-financeiros") {
      if (method === "GET") { await route.fulfill({ json: { eventos } }); return; }
      const body = req.postDataJSON();
      const evento = { ...base, id: 100, descricao: body.descricao, detalhe: body.detalhe, valor: body.valor, origem: body.tipo, natureza: body.natureza };
      eventos.push(evento);
      await route.fulfill({ status: 201, json: { evento } }); return;
    }
    if (url.pathname.startsWith("/api/eventos-financeiros/") && method === "PATCH") {
      const id = Number(url.pathname.split("/").at(-1)), body = req.postDataJSON();
      const evento = eventos.find(e => e.id === id);
      Object.assign(evento, body);
      await route.fulfill({ json: { evento, aviso: "A DRE de setembro foi recalculada." } }); return;
    }
    if (method === "DELETE" && ["/api/transaction/18", "/api/lancamento-de-eventos/19"].includes(url.pathname)) {
      if (recusarExclusao) { await route.fulfill({ status: 409, json: { error: "Tire a baixa antes de excluir." } }); return; }
      const group = url.pathname.includes("lancamento");
      eventos = eventos.map(e => (group ? e.lancamento_id === 19 : e.transacaoid === 18) ? { ...e, status: "ATIVO", transacaoid: null, lancamento_id: null } : e);
      await route.fulfill(group ? { json: { data: { despesasRevertidas: 2 } } } : { status: 204 }); return;
    }
    await route.fulfill({ json: { data: [], items: [] } });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const menu = async descricao => { await page.getByRole("button", { name: `Ações de ${descricao}`, exact: true }).click(); };
  const cancelarEdicao = async () => { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); };
  await page.goto(url);
  await page.waitForTimeout(1000);
  if (errors.length) throw new Error(`Falha de renderização: ${errors.join("; ")}`);
  for (const descricao of ["Avulso despesa", "Avulso receita"]) {
    await menu(descricao); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("Título", { exact: true })).toBeVisible();
    await cancelarEdicao();
  }
  for (const descricao of ["Receita produto", "Receita frete"]) {
    await menu(descricao); await page.getByRole("menuitem", { name: "Editar valor do lançamento" }).click();
    await expect(page.getByRole("dialog").getByLabel("Título", { exact: true })).toHaveCount(0);
    await cancelarEdicao();
  }
  await menu("Comissão automática"); await page.getByRole("menuitem", { name: "Corrigir valor da comissão" }).click();
  await expect(page.getByRole("dialog").getByText(/deixa de acompanhar o recálculo/)).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Título", { exact: true })).toHaveCount(0);
  await cancelarEdicao();
  await expect(page.getByRole("button", { name: "Ações de Custo automático" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ações de Desconto automático" })).toBeDisabled();
  await menu("Avulso despesa"); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Título", { exact: true }).fill("Despesa corrigida");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ações de Despesa corrigida" })).toBeVisible();
  await expect(page.getByText("A DRE de setembro foi recalculada.")).toBeVisible();

  await menu("Receita vinculada"); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes.filter(w => w.method === "DELETE")).toHaveLength(0);
  recusarExclusao = true;
  await menu("Receita vinculada"); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
  await page.getByRole("button", { name: "Excluir e continuar" }).click();
  await expect(page.getByText("Tire a baixa antes de excluir.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  recusarExclusao = false;
  await menu("Receita vinculada"); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
  await page.getByRole("button", { name: "Excluir e continuar" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Editar evento financeiro" })).toBeVisible();
  // A lista atualiza sem desmontar o painel: o formulário deve continuar aberto.
  await expect(page.getByRole("button", { name: "Atualizar eventos da venda", includeHidden: true })).toBeEnabled();
  await page.getByRole("dialog").getByLabel("Título", { exact: true }).fill("Receita após desfazer");
  await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ações de Receita após desfazer" })).toBeVisible();
  await menu("Despesa agrupada"); await page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByText(/lançamento inteiro precisa ser desfeito/)).toBeVisible();
  await page.getByRole("button", { name: "Excluir e continuar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await cancelarEdicao();
  expect(eventos.filter(e => e.lancamento_id === 19)).toHaveLength(0);

  await page.getByRole("button", { name: "Novo lançamento", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Tipo", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Consumo (material de uso)", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("select:visible")).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Tipo", exact: true })).toContainText("Consumo");
  await expect(dialog.getByRole("combobox", { name: "Natureza", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "Natureza", exact: true })).toContainText("Despesa");
  await dialog.getByLabel("Descrição", { exact: true }).fill("Material complementar");
  await dialog.getByRole("textbox").last().fill("2500");
  await expect(dialog.getByRole("button", { name: "Registrar evento" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Registrar evento" }).click();
  await expect(page.getByRole("button", { name: "Ações de Material complementar" })).toBeVisible();
  const creation = writes.find(w => w.url === "/api/venda/150/eventos-financeiros" && w.method === "POST");
  expect(creation.body).toMatchObject({ modalidade: "AVULSO", tipo: "CONSUMO", natureza: "DESPESA" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Novo lançamento", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("combobox", { name: "Tipo", exact: true }).click();
  await expect(page.getByRole("option", { name: "Produto", exact: true })).toBeVisible();
  await page.waitForTimeout(400); // Aguarda a animacao de entrada antes da inspeção visual.
  await page.screenshot({ path: path.join(artifacts, "novo-evento-mobile.png") });
  await page.keyboard.press("Escape"); await cancelarEdicao();

  eventos = fixture();
  await page.goto(`${url}/?sem-editar`);
  await menu("Avulso despesa");
  await expect(page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true })).toBeDisabled();
  await expect(page.getByText("Requer permissão para editar eventos financeiros.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${url}/?sem-excluir`);
  await menu("Receita vinculada");
  await expect(page.getByRole("menuitem", { name: "Editar evento financeiro", exact: true })).toBeDisabled();
  await expect(page.getByText("Requer exclusão financeira para desfazer o lançamento antes de editar.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log("UI: matriz de edição, permissões, atualização, DRE, confirmação/cancelamento, recusa, DELETE 204, grupo e selects teclado/mobile: OK.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
