/** Verificação isolada da UI real, com APIs simuladas e sem acesso ao banco. */
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "artifacts/ofx-ui");
await mkdir(artifacts, { recursive: true });
const entry = `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConciliacaoOfxDialog } from '@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/conciliacao-ofx/conciliacao-ofx-dialog';
import { ConfigProvider } from '@/app/(app)/(pages)/config-context';
import { Toaster } from 'sonner';
import TransactionDialog from '@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog';
function App() { const [open, setOpen] = useState(true); return <><button onClick={() => setOpen(true)}>Abrir módulo</button>{location.search.includes('financeiro') ? <TransactionDialog open={open} setOpen={setOpen} initialTransaction={{ descricao: 'Despesa avulsa', valor: 75, tipo: 'DESPESA', banco_id: location.search.includes('sem-banco') ? null : 1, metodopagamento: location.search.includes('taxas') ? 'CREDITO' : 'PIX', nomepagador: 'Fornecedor de teste', cpfcnpjpagador: '12345678000199' }} /> : <ConciliacaoOfxDialog aberto={open} setAberto={setOpen} onConcluido={() => { window.atualizacoes = (window.atualizacoes || 0) + 1; }} />}</>; }
createRoot(document.getElementById('root')).render(<ConfigProvider config={{ habilitar_drawers: true }}><App/><Toaster/></ConfigProvider>);`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outfile: path.join(artifacts, "app.js"),
  platform: "browser",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  logLevel: "warning",
});
const css = await postcss([tailwind({ base: root })]).process(
  await readFile(path.join(root, "src/app/globals.css"), "utf8"),
  { from: path.join(root, "src/app/globals.css") },
);
await writeFile(path.join(artifacts, "app.css"), css.css);
const server = createServer(async (req, res) => {
  if (req.url === "/app.js" || req.url === "/app.css") {
    res.setHeader(
      "Content-Type",
      req.url.endsWith("js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(path.join(artifacts, req.url.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  locale: "pt-BR",
});
const errors = [];
const escritasAvulsas = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

const sugestao = (id, origem = "FLUXO", parcial = false) => ({
  transacaoId: id,
  origem,
  score: 95,
  diferencaEmDias: 1,
  parcial,
  valorCentavos: parcial ? 200000 : 100000,
  descricao: `Fornecedor ${id} · Energia elétrica`,
  tipo: "DESPESA",
  data: "2026-08-05T12:00:00Z",
  metodopagamento: "BOLETO",
  contraparte: `Fornecedor ${id}`,
  ordemservicoid: id + 100,
  vendaid: null,
});
const linha = (n, situacao, sugestoes = []) => ({
  sequencia: n,
  tipoOfx: "DEBIT",
  dataPostagem: "2026-08-04",
  dataDisponivel: null,
  valorCentavos: n === 4 ? -3157 : -100000,
  fitid: `FITID-ORIGINAL-${n}`,
  checknum: null,
  refnum: null,
  nome: null,
  memo: n === 4 ? "DEBITO DE IOF" : `PAGAMENTO DE BOLETO ${10000 + n}`,
  fingerprint: `chave-${n}`,
  analise: {
    situacao,
    score: 95,
    sugestoes,
    acaoSugerida:
      situacao === "MATCH_EXATO"
        ? "VINCULAR"
        : situacao === "MATCH_PROVAVEL"
          ? "LIQUIDAR"
          : null,
    observacao: null,
  },
  metodoSugerido: "BOLETO",
  jaImportado: false,
  movimentoId: null,
  statusGravado: null,
});
const movimentos = [
  linha(1, "MATCH_EXATO", [sugestao(1)]),
  linha(2, "MATCH_PROVAVEL", [sugestao(2, "TITULO", true)]),
  linha(3, "AMBIGUO", [sugestao(3), sugestao(4)]),
  linha(4, "SEM_CORRESPONDENCIA"),
];
const conta = {
  id: 1,
  titulo: "Caixa Conta Corrente",
  agencia: "1234",
  contanumero: "00012345-6",
  tipo: "CORRENTE",
};
let repetido = false,
  falhaHistorico = false,
  historicoVazio = false,
  grande = false,
  enviado = null;
let importados = [];
const importacao = {
  id: 99,
  banco_id: 1,
  banco: conta,
  arquivo_nome: "AGOSTO-2026.ofx",
  periodo_inicio: "2026-08-01",
  periodo_fim: "2026-08-31",
  saldo_inicial: 15000,
  saldo_final: 12968.43,
  quantidade_importados: 4,
  quantidade_movimentos: 4,
  quantidade_repetidos: 0,
  created_at: "2026-09-08T12:00:00Z",
  usuario: "Operador de teste",
};
function gravados() {
  return movimentos.map((m) => {
    const r = importados.find((r) => r.fingerprint === m.fingerprint && r.ok);
    return {
      id: m.sequencia,
      sequencia: m.sequencia,
      tipo_ofx: m.tipoOfx,
      data_postagem: m.dataPostagem,
      valor_centavos: m.valorCentavos,
      valor: m.valorCentavos / 100,
      fingerprint: m.fingerprint,
      memo: m.memo,
      nome: m.nome,
      fitid: m.fitid,
      status: r
        ? r.acao === "IGNORAR"
          ? "IGNORADO"
          : "CONCILIADO"
        : "PENDENTE",
      acao_conciliacao: r?.acao ?? null,
      transacao_id: r?.transacaoId ?? null,
      titulo_origem_id: null,
      conciliado_em: r ? "2026-09-08T12:00:00Z" : null,
      analise: { ...m.analise, sugestoes: r ? [] : m.analise.sugestoes },
      metodoSugerido: m.metodoSugerido,
    };
  });
}
let consultasBandeiras = 0;
let catalogoBandeiras = [];
let esperaBandeiras = null;
let erroBandeiras = false;
// Erro lançado aqui dentro o Playwright engole, e a requisição fica pendurada
// até o teste morrer por timeout sem dizer o motivo. Por isso a marca é lida
// depois, junto das outras verificações.
let bandeirasFiltradasNoServidor = false;
await page.route("**/api/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  let body;
  if (url.pathname === "/api/tipos/bandeiras") {
    consultasBandeiras++;
    if (
      url.searchParams.has("banco_id") ||
      url.searchParams.has("metodopagamento")
    )
      bandeirasFiltradasNoServidor = true;
    if (esperaBandeiras) await esperaBandeiras;
    if (erroBandeiras) {
      await route.fulfill({ status: 503, json: { error: "Indisponível" } });
      return;
    }
    body = { items: catalogoBandeiras };
  } else if (url.pathname === "/api/banks")
    body = {
      data: [conta, { ...conta, id: 2, titulo: "Conta com maquineta" }],
    };
  else if (url.pathname === "/api/tipos/categorias-transacao")
    body = {
      items: [
        {
          id: 10,
          nome: "Despesas bancárias",
          descricao: null,
          ativo: true,
          icone: "",
          codigo_sistema: null,
        },
      ],
    };
  else if (url.pathname === "/api/payment-methods")
    body = {
      data: [
        { value: "BOLETO" },
        { value: "PIX" },
        { value: "CREDITO" },
        { value: "DEBITO AUTOMATICO" },
      ],
    };
  else if (url.pathname.endsWith("/preview")) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    body = {
      data: {
        arquivo: {
          nome: "AGOSTO-2026.ofx",
          hash: "hash",
          jaImportado: repetido ? importacao : null,
        },
        conta,
        contaSugerida: conta,
        divergenciaDeConta: null,
        cabecalho: {
          bankId: "104",
          branchId: "1234",
          acctId: "00012345-6",
          periodoInicio: "2026-08-01",
          periodoFim: "2026-08-31",
          saldoInicial: 15000,
          saldoFinal: 12968.43,
        },
        resumo: { jaImportados: 0 },
        movimentos: grande
          ? Array.from({ length: 120 }, (_, i) => ({
              ...linha(i + 1, "SEM_CORRESPONDENCIA"),
              fingerprint: `grande-${i}`,
            }))
          : movimentos,
      },
    };
  } else if (
    url.pathname.endsWith("/importar") ||
    url.pathname.endsWith("/conciliar")
  ) {
    const data = req.postData();
    const json = req.headers()["content-type"]?.includes("application/json")
      ? JSON.parse(data).decisoes
      : JSON.parse(data.match(/name="decisoes"\r\n\r\n([^\r]+)/)[1]);
    enviado = json;
    const resultados = json.map((d) => {
      const falha = d.fingerprint === "chave-2" && d.acao === "LIQUIDAR";
      return {
        movimentoId: Number(d.fingerprint.split("-")[1]),
        fingerprint: d.fingerprint,
        acao: d.acao,
        ok: !falha,
        transacaoId: d.transacaoId ?? (d.acao === "CRIAR" ? 88 : null),
        erro: falha ? "O título foi alterado. Confira o saldo atual." : null,
      };
    });
    importados = [...importados, ...resultados];
    body = {
      data: {
        importacaoId: 99,
        quantidadeImportados: 4,
        quantidadeRepetidos: 0,
        conciliados: resultados.filter((r) => r.ok).length,
        falhas: resultados.filter((r) => !r.ok),
        resultados,
      },
    };
  } else if (url.pathname === "/api/financeiro/conciliacao/ofx/99")
    body = { data: { importacao, movimentos: gravados() } };
  else if (url.pathname === "/api/financeiro/conciliacao/ofx") {
    if (falhaHistorico) {
      await route.fulfill({
        status: 503,
        json: { error: "Histórico temporariamente indisponível." },
      });
      return;
    }
    body = {
      data: historicoVazio
        ? []
        : [
            {
              ...importacao,
              situacoes: { conciliados: 1, ignorados: 0, pendentes: 3 },
            },
          ],
      pagination: { totalPages: 2 },
    };
  } else if (url.pathname === "/api/transaction" && req.method() === "POST") {
    escritasAvulsas.push(JSON.parse(req.postData()));
    await route.fulfill({ status: 201, json: { data: { id: 456 } } });
    return;
  } else if (url.pathname === "/api/transaction")
    body = {
      data: [
        {
          id: 55,
          descricao:
            url.searchParams.get("pendente") === "true"
              ? "Energia vencida em 2020"
              : "Energia localizada manualmente",
          tipo: "DESPESA",
          pendente: url.searchParams.get("pendente") === "true",
          banco_id: 1,
          valor: 1000,
          valorLiquido: 1000,
          data:
            url.searchParams.get("pendente") === "true"
              ? "2020-01-01T12:00:00Z"
              : "2026-08-31T12:00:00Z",
          metodopagamento: "PIX",
        },
      ],
      pagination: { totalPages: 1 },
    };
  else body = { data: [], items: [], pagination: { totalPages: 1 } };
  await route.fulfill({ json: body });
});

const central = () =>
  page.getByRole("dialog", { name: "Conciliação bancária", exact: true });
const edicao = () =>
  page.getByRole("dialog", {
    name: "Correspondência do movimento",
    exact: true,
  });
const screenshot = (name) =>
  page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
async function upload() {
  await page.locator('input[type="file"]').setInputFiles({
    name: "AGOSTO-2026.ofx",
    mimeType: "application/x-ofx",
    buffer: Buffer.from("OFX sintético para UI"),
  });
  await page
    .getByRole("button", { name: "Analisar extrato", exact: true })
    .click();
  await expect(page.getByText("Saldo final do extrato")).toBeVisible();
}
async function closeChild() {
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Movimento bancário", exact: true }),
  ).toHaveCount(0);
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(central()).toBeVisible();
  await screenshot("01-upload-desktop");
  await page.locator('input[type="file"]').setInputFiles({
    name: "arquivo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("inválido"),
  });
  await expect(
    page.getByText("Selecione um arquivo com extensão .ofx."),
  ).toBeVisible();
  await upload();
  await expect(
    central().getByText("0 movimentos selecionados", { exact: true }),
  ).toBeVisible();
  await expect(central().getByText(/score |FITID|DEBIT/)).toHaveCount(0);
  await screenshot("02-conferencia-desktop");
  // Criar também parte de uma correspondência identificada, abrindo o diálogo financeiro real.
  await central()
    .getByRole("row")
    .filter({ hasText: "10001" })
    .getByRole("button", { name: "Revisar", exact: true })
    .click();
  await edicao()
    .getByRole("button", {
      name: "Criar nova transação a partir deste movimento",
    })
    .click();
  const criacaoIdentificada = page.getByRole("dialog", {
    name: "Nova transação",
    exact: true,
  });
  await expect(criacaoIdentificada.locator("#descricao-topo")).toHaveValue(
    "PAGAMENTO DE BOLETO 10001",
  );
  await criacaoIdentificada
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(criacaoIdentificada).toHaveCount(0);
  const ambiguo = central().getByRole("row").filter({ hasText: "10003" });
  await ambiguo.getByRole("button", { name: "Escolher", exact: true }).click();
  await expect(
    edicao().getByRole("button", { name: "Confirmar correspondência" }),
  ).toBeDisabled();
  await expect(
    edicao().getByText(/Nenhuma foi escolhida automaticamente/),
  ).toBeVisible();
  await screenshot("03-ambiguo");
  await edicao()
    .getByRole("button", { name: /Fornecedor 4 · Energia/ })
    .click();
  await edicao()
    .getByRole("button", { name: "Confirmar correspondência" })
    .click();
  await expect(
    ambiguo.getByText("Fornecedor 4 · Energia elétrica", { exact: true }),
  ).toBeVisible();
  await central()
    .getByRole("row")
    .filter({ hasText: "10002" })
    .getByRole("button", { name: "Comparar" })
    .click();
  await expect(edicao().getByText(/Restará/)).toBeVisible();
  await screenshot("04-parcial");
  await page.setViewportSize({ width: 390, height: 844 });
  const revisaoMobile = edicao();
  const confirmarMobile = revisaoMobile.getByRole("button", {
    name: "Confirmar correspondência",
  });
  await expect(confirmarMobile).toBeVisible();
  const limitesConfirmar = await confirmarMobile.boundingBox();
  if (!limitesConfirmar || limitesConfirmar.y + limitesConfirmar.height > 844)
    throw new Error("Confirmação da revisão fora da tela mobile");
  const revisaoSemOverflow = await revisaoMobile.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  if (!revisaoSemOverflow)
    throw new Error("Revisão com rolagem horizontal no mobile");
  await screenshot("04a-revisao-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await edicao()
    .getByRole("button", { name: "Confirmar correspondência" })
    .click();
  await central()
    .getByRole("button", { name: "Selecionar todos os encontrados (1)" })
    .click();
  await central()
    .getByRole("button", { name: "Conciliar 3 movimentos" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirmar conciliação", exact: true }),
  ).toBeVisible();
  if (enviado !== null) throw new Error("Escrita antes da confirmação final");
  await screenshot("05-confirmacao");
  await page
    .getByRole("button", { name: "Confirmar conciliação", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Conciliação com pendências" }),
  ).toBeVisible();
  await expect(
    page.getByText("O título foi alterado. Confira o saldo atual.").last(),
  ).toBeVisible();
  if (
    enviado.length !== 3 ||
    enviado.find((d) => d.fingerprint === "chave-3").transacaoId !== 4
  )
    throw new Error("Lote enviou transação diferente da escolhida");
  await screenshot("06-resultado-parcial");
  await page.getByRole("button", { name: "Continuar conciliando" }).click();
  await expect(
    central().getByText("2 de 4 movimentos resolvidos"),
  ).toBeVisible();
  await central()
    .getByRole("button", { name: "Criar transação", exact: true })
    .click();
  const nova = () =>
    page.getByRole("dialog", { name: "Nova transação", exact: true });
  await expect(nova()).toBeVisible();
  await expect(edicao()).toHaveCount(0);
  await expect(nova().locator("#descricao-topo")).toHaveValue("DEBITO DE IOF");
  await expect(nova().locator("#descricao-topo")).toBeEditable();
  await nova().locator("#descricao-topo").fill("IOF sobre operação bancária");
  await nova()
    .locator('label[for="categoria-topo"]')
    .locator("..")
    .getByRole("combobox")
    .click();
  await page
    .getByRole("option", { name: "Despesas bancárias", exact: true })
    .click();
  await expect(
    nova().getByRole("button", { name: "04/08/2026", exact: true }),
  ).toBeDisabled();
  await expect(nova().getByRole("switch").first()).toBeDisabled();
  await expect(
    nova().getByText("Movimentação e classificação", { exact: true }),
  ).toBeVisible();
  await expect(
    nova().getByText("Categoria", { exact: true }).first(),
  ).toBeVisible();
  await screenshot("07-criar-transacao");
  await nova().getByRole("button", { name: "Preparar nova transação" }).click();
  await central()
    .getByLabel("Buscar no extrato ou no ERP", { exact: true })
    .fill("inexistente");
  await expect(
    central().getByText("Nenhum movimento encontrado com estes filtros."),
  ).toBeVisible();
  await central().getByRole("button", { name: "Limpar filtros" }).click();
  await central()
    .getByRole("row")
    .filter({ hasText: "10001" })
    .getByRole("button", { name: "Ações do movimento 1" })
    .click();
  await page.getByRole("menuitem", { name: "Ver detalhes" }).click();
  await page.getByText("Dados originais do arquivo", { exact: true }).click();
  await expect(
    page.getByText("FITID-ORIGINAL-1", { exact: true }),
  ).toBeVisible();
  await screenshot("08-detalhes");
  await page.setViewportSize({ width: 390, height: 844 });
  const detalhesMobile = page.getByRole("dialog", {
    name: "Movimento bancário",
    exact: true,
  });
  await expect(
    detalhesMobile.getByRole("region", { name: "Resumo do movimento" }),
  ).toBeVisible();
  await expect(
    detalhesMobile.getByText("Conciliado com a transação #1.", { exact: true }),
  ).toBeVisible();
  if (
    !(await detalhesMobile.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ))
  )
    throw new Error("Detalhes com rolagem horizontal no mobile");
  await detalhesMobile
    .getByText("Fingerprint", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    detalhesMobile.getByRole("heading", {
      name: "Movimento bancário",
      exact: true,
    }),
  ).toBeVisible();
  await detalhesMobile
    .getByRole("region", { name: "Resumo do movimento" })
    .scrollIntoViewIfNeeded();
  await screenshot("08a-detalhes-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await closeChild();
  await central()
    .getByRole("button", { name: "Ações do movimento 2", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Ver detalhes" }).click();
  const detalhesParcial = page.getByRole("dialog", {
    name: "Movimento bancário",
    exact: true,
  });
  await expect(detalhesParcial.getByText(/Restará/)).toBeVisible();
  await expect(
    detalhesParcial.getByText("Saldo em aberto", { exact: true }),
  ).toBeVisible();
  await screenshot("08b-detalhes-parcial");
  await closeChild();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(central().getByRole("table")).toBeHidden();
  await central()
    .getByRole("button", { name: "Revisar", exact: true })
    .last()
    .click();
  await expect(nova()).toBeVisible();
  await expect(nova().locator("#descricao-topo")).toHaveValue(
    "IOF sobre operação bancária",
  );
  await expect(
    nova()
      .locator('label[for="categoria-topo"]')
      .locator("..")
      .getByRole("combobox"),
  ).toHaveText("Despesas bancárias");
  const mobileDialog = await nova().boundingBox();
  if (mobileDialog.x < 0 || mobileDialog.x + mobileDialog.width > 391)
    throw new Error("Formulário ultrapassa viewport mobile");
  await screenshot("09a-mobile-formulario");
  await nova().getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(nova()).toHaveCount(0);
  await screenshot("09-mobile");
  const bounds = await central().boundingBox();
  if (
    bounds.x < 0 ||
    bounds.x + bounds.width > 391 ||
    bounds.y + bounds.height > 845
  )
    throw new Error("Dialog ultrapassa viewport mobile");
  await page.setViewportSize({ width: 1024, height: 768 });
  await screenshot("10-tablet");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await central()
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await expect(page.getByText("Histórico de importações")).toBeVisible();
  await screenshot("11-historico");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    central().getByText("2 de 4 movimentos resolvidos"),
  ).toBeVisible();
  await central()
    .getByRole("row")
    .filter({ hasText: "10002" })
    .getByRole("button", { name: "Ações do movimento 2" })
    .click();
  const buscaFluxo = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return (
      url.pathname === "/api/transaction" &&
      url.searchParams.get("pendente") === "false"
    );
  });
  await page.getByRole("menuitem", { name: "Procurar manualmente" }).click();
  const parametrosFluxo = new URL((await buscaFluxo).url()).searchParams;
  if (parametrosFluxo.has("dateFrom") || parametrosFluxo.has("dateTo"))
    throw new Error("Busca no Fluxo ainda limita a data da transação");
  await expect(
    edicao().getByText("Energia localizada manualmente", { exact: true }),
  ).toBeVisible();
  await edicao().getByRole("combobox", { name: "Onde procurar" }).click();
  const buscaAntiga = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return (
      url.pathname === "/api/transaction" &&
      url.searchParams.get("pendente") === "true"
    );
  });
  await page
    .getByRole("option", { name: "Contas a pagar / receber em aberto" })
    .click();
  const parametrosBusca = new URL((await buscaAntiga).url()).searchParams;
  if (parametrosBusca.has("dateFrom") || parametrosBusca.has("dateTo"))
    throw new Error("Busca de títulos ainda limita o vencimento por data");
  await expect(
    edicao().getByText("Energia vencida em 2020", { exact: true }),
  ).toBeVisible();
  await edicao()
    .getByRole("button", { name: /Energia vencida em 2020/ })
    .click();
  await expect(
    edicao().getByRole("button", { name: "Confirmar correspondência" }),
  ).toBeEnabled();
  await edicao()
    .getByRole("button", { name: "Procurar manualmente", exact: true })
    .click();
  await edicao()
    .getByRole("button", { name: /Energia localizada manualmente/ })
    .click();
  await edicao()
    .getByRole("button", { name: "Confirmar correspondência" })
    .click();
  await expect(
    central()
      .getByRole("table")
      .getByText("Energia localizada manualmente", { exact: true }),
  ).toBeVisible();
  await screenshot("12-busca-manual");
  await central()
    .getByRole("row")
    .filter({ hasText: "Debito de IOF" })
    .getByRole("button", { name: "Ações do movimento 4" })
    .click();
  await page
    .getByRole("menuitem", { name: "Marcar para ignorar", exact: true })
    .click();
  await central()
    .getByRole("button", { name: "Conciliar 2 movimentos" })
    .click();
  await page
    .getByRole("button", { name: "Confirmar conciliação", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Conciliação concluída", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continuar conciliando" }).click();
  await expect(
    central().getByText("Tudo conciliado", { exact: true }),
  ).toBeVisible();
  await expect(
    central().getByText("4 de 4 movimentos resolvidos"),
  ).toBeVisible();
  await screenshot("12a-tudo-conciliado");
  // Reimportação abre a conciliação existente sem chamar a rota de importação.
  repetido = true;
  await central()
    .getByRole("button", { name: "Importar OFX", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar outro OFX", exact: true })
    .click();
  await upload();
  await expect(page.getByText("Este arquivo já foi importado.")).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir conciliação", exact: true })
    .click();
  await expect(
    central().getByText("4 de 4 movimentos resolvidos"),
  ).toBeVisible();
  // Histórico distingue falha de carregamento de ausência de importações.
  falhaHistorico = true;
  await central()
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await expect(
    page.getByText("Histórico temporariamente indisponível."),
  ).toBeVisible();
  falhaHistorico = false;
  historicoVazio = true;
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(
    page.getByText("Nenhuma conciliação bancária encontrada"),
  ).toBeVisible();
  await screenshot("13-historico-vazio");
  await central().getByRole("button", { name: "Voltar à conciliação" }).click();
  repetido = false;
  grande = true;
  await central()
    .getByRole("button", { name: "Importar OFX", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar outro OFX", exact: true })
    .click();
  await upload();
  await expect(central().getByRole("row")).toHaveCount(51);
  await central().getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(
    central().getByText("120 movimentos · Página 2 de 3"),
  ).toBeVisible();
  await central().getByLabel("Selecionar movimentos desta página").click();
  await expect(
    central().getByText("50 movimentos selecionados", { exact: true }),
  ).toBeVisible();
  await expect(
    central().getByRole("button", { name: "Conciliar 50 movimentos" }),
  ).toBeDisabled();
  await central()
    .getByRole("button", { name: "Marcar para ignorar", exact: true })
    .click();
  await expect(
    central().getByRole("button", { name: "Conciliar 50 movimentos" }),
  ).toBeEnabled();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await screenshot("14-dark-paginacao");
  if (escritasAvulsas.length)
    throw new Error("A preparação OFX gravou uma transação avulsa");
  // Fora da conciliação, o mesmo componente mantém a criação financeira normal.
  await page.goto(`http://127.0.0.1:${server.address().port}/?financeiro=1`);
  const normal = page.getByRole("dialog", {
    name: "Nova transação",
    exact: true,
  });
  await expect(normal.locator("#descricao-topo")).toHaveValue("Despesa avulsa");
  await normal.locator("#descricao-topo").fill("Despesa avulsa revisada");
  await expect(normal.getByRole("switch").first()).toBeEnabled();
  await expect(
    normal.getByText("Documento relacionado", { exact: true }),
  ).toBeVisible();
  await normal.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(normal).toHaveCount(0);
  if (
    escritasAvulsas.length !== 1 ||
    escritasAvulsas[0].newTransaction.descricao !== "Despesa avulsa revisada"
  )
    throw new Error("Regressão no cadastro financeiro padrão");
  // Banco obrigatório no cadastro liquidado; futuro continua permitindo escolher na baixa.
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?financeiro=1&sem-banco=1`,
  );
  await normal.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(
    page.getByText(
      "Selecione o banco ou a conta utilizada para registrar a transação liquidada.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(normal).toBeVisible();
  if (escritasAvulsas.length !== 1)
    throw new Error("Cadastro liquidado sem banco foi enviado");
  await normal.getByRole("switch").first().click();
  await expect(
    normal.getByText("Opcional agora. Informe a conta utilizada ao dar baixa."),
  ).toBeVisible();
  await normal.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(normal).toHaveCount(0);
  if (
    escritasAvulsas.length !== 2 ||
    escritasAvulsas[1].newTransaction.pendente !== true ||
    escritasAvulsas[1].newTransaction.banco_id != null
  )
    throw new Error("Cadastro pendente sem banco foi bloqueado");

  await page.goto(
    `http://127.0.0.1:${server.address().port}/?financeiro=1&sem-banco=1`,
  );
  await normal.getByRole("switch").first().click();
  await normal.getByRole("switch").first().click();
  await expect(
    normal.getByText("Obrigatório para identificar a conta movimentada."),
  ).toBeVisible();
  await normal.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(
    page.getByText(
      "Selecione o banco ou a conta utilizada para registrar a transação liquidada.",
      { exact: true },
    ),
  ).toBeVisible();
  if (escritasAvulsas.length !== 2)
    throw new Error("Alternar para liquidada deixou gravar sem banco");
  await normal
    .locator('label[for="banco"]')
    .locator("..")
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: /Caixa Conta Corrente/ }).click();
  await normal.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(normal).toHaveCount(0);
  if (
    escritasAvulsas.length !== 3 ||
    escritasAvulsas[2].newTransaction.banco_id !== 1
  )
    throw new Error("Cadastro não foi liberado depois de selecionar banco");
  // A carga inicial precede o formulário; trocas usam só o catálogo em memória.
  catalogoBandeiras = [
    {
      id: 10,
      nome: "Visa teste",
      bancoId: 2,
      metodoPagamento: "CREDITO",
      ativo: true,
      parcelas: [
        { parcelas: 1, taxaPercentual: 2 },
        { parcelas: 3, taxaPercentual: 5 },
      ],
    },
  ];
  let liberarBandeiras;
  esperaBandeiras = new Promise((resolve) => {
    liberarBandeiras = resolve;
  });
  const antesDaAbertura = consultasBandeiras;
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?financeiro=1&sem-banco=1&taxas=1`,
  );
  await expect(
    normal.getByRole("status", { name: "Carregando formulário de transação" }),
  ).toBeVisible();
  await expect(normal.locator("#descricao-topo")).toHaveCount(0);
  await screenshot("15-transacao-loading");
  liberarBandeiras();
  esperaBandeiras = null;
  await expect(normal.locator("#descricao-topo")).toBeVisible();
  if (consultasBandeiras !== antesDaAbertura + 1)
    throw new Error("Carga inicial de taxas duplicada");
  const escolherBanco = async (nome) => {
    await normal
      .locator('label[for="banco"]')
      .locator("..")
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: new RegExp(nome) }).click();
  };
  await escolherBanco("Caixa Conta Corrente");
  await expect(normal.locator('label[for="bandeira"]')).toHaveCount(0);
  await escolherBanco("Conta com maquineta");
  await expect(normal.locator('label[for="bandeira"]')).toBeVisible();
  await normal
    .locator('label[for="bandeira"]')
    .locator("..")
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: /Visa teste/ }).click();
  // A menor faixa entra sozinha, com a taxa e o líquido já calculados.
  await expect(normal.getByText(/1x .*2,00%.*líquido R\$ 73,50/)).toBeVisible();
  await screenshot("16-transacao-taxas");
  await escolherBanco("Caixa Conta Corrente");
  await expect(normal.locator('label[for="bandeira"]')).toHaveCount(0);
  if (consultasBandeiras !== antesDaAbertura + 1)
    throw new Error("Selecionar banco disparou nova consulta de taxas");
  await normal.getByRole("button", { name: "Cancelar", exact: true }).click();
  catalogoBandeiras = [];
  erroBandeiras = true;
  await page.getByRole("button", { name: "Abrir módulo", exact: true }).click();
  // Falha nas taxas avisa dentro do formulário, sem trancar o lançamento.
  await expect(normal.getByRole("alert")).toContainText(
    "Não foi possível carregar as taxas de cartão.",
  );
  await expect(normal.locator("#descricao-topo")).toBeVisible();
  erroBandeiras = false;
  await normal
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(normal.getByRole("alert")).toHaveCount(0);
  await expect(normal.locator("#descricao-topo")).toBeVisible();
  await escolherBanco("Conta com maquineta");
  await expect(normal.locator('label[for="bandeira"]')).toHaveCount(0);
  if (consultasBandeiras !== antesDaAbertura + 3)
    throw new Error("Reabertura e nova tentativa devem atualizar o catálogo");
  if (bandeirasFiltradasNoServidor)
    throw new Error(
      "As taxas devem ser carregadas antes da escolha de banco ou método",
    );
  // Os dois vêm do 503 simulado nas taxas: o do navegador e o que o hook
  // registra para quem for depurar a falha no console.
  const unexpected = errors.filter(
    (e) =>
      !e.includes("503 (Service Unavailable)") &&
      !e.includes("Erro ao carregar bandeiras"),
  );
  if (unexpected.length)
    throw new Error(`Erros de console: ${unexpected.join("\n")}`);
  console.log(
    "UI OFX validada: upload, revisão, ambiguidade, baixa parcial, lote, falha parcial, criação, busca, detalhes, histórico, duplicidade, paginação e responsividade. Capturas em artifacts/ofx-ui.",
  );
} catch (error) {
  await screenshot("falha");
  console.error("Console:", errors);
  console.error((await page.locator("body").innerText()).slice(0, 1200));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
