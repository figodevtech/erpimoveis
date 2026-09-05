import { chromium } from '@playwright/test';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';

const HEAD = ["OS","Entrada","Conclusão","Saída","Status","Prioridade","Cliente","CPF/CNPJ","Alvo atendido","Setor","Responsável","Descrição","Produtos (R$)","Serviços (R$)","Desconto (R$)","Frete (R$)","Orçamento (R$)","Acréscimo financeiro (R$)"];
const HEAD_EV = ["OS","Origem","Natureza","Situação","Descrição","Detalhe","Valor (R$)","Comissão de produtos (R$)"];

// Mistura proposital: Faturamento ao lado de Pagamento e dos demais status.
const STATUS = ["PAGAMENTO","FATURAMENTO","FATURAMENTO","EM_ANDAMENTO","CONCLUIDO","PAGAMENTO","FATURAMENTO","ORCAMENTO","CONCLUIDO","SEM_COBRANCA","CANCELADO","APROVACAO_ORCAMENTO"];

const linhas = [], eventos = [];
for (let i = 0; i < 26; i++) {
  const id = 1000 + i;
  const status = STATUS[i % STATUS.length];
  const produtos = 400 + i * 13, servicos = 250 + i * 7, frete = 30, desconto = i % 4 === 0 ? 50 : 0;
  const orcamento = produtos + servicos + frete - desconto;
  linhas.push([id,"2026-08-0"+((i%9)+1),"2026-08-1"+((i%9)),"", status,["ALTA","NORMAL","BAIXA"][i%3],
    `Cliente de demonstração ${i+1}`,"000.000.000-00",`Veículo ABC-${1000+i}`,"Mecânica","Responsável de teste",
    `Ordem de teste ${i+1} — revisão, troca de óleo e alinhamento com descrição longa o bastante para ocupar a terceira linha do bloco.`,
    produtos, servicos, desconto, frete, orcamento, 0]);
  eventos.push([id,"PRODUTO","RECEITA","ATIVO","Peças aplicadas","",produtos,0]);
  eventos.push([id,"SERVICO","RECEITA","ATIVO","Mão de obra","",servicos,0]);
  eventos.push([id,"PRODUTO","DESPESA","ATIVO","Custo das peças","",Math.round(produtos*0.6),0]);
  eventos.push([id,"COMISSAO","DESPESA","ATIVO","Comissão","",Math.round(servicos*0.1),0]);
}

function planilha() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...linhas]), "Relatório");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD_EV, ...eventos]), "Eventos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, locale: 'pt-BR', colorScheme: 'light' });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
let pedidos = 0;
await page.route('**/api/reports/ordens/export*', async route => {
  pedidos++;
  await route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: planilha() });
});

try {
  await page.goto('http://127.0.0.1:3117/login/relatorio-ordens-preview?status=PAGAMENTO,FATURAMENTO', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText('Relação de ordens de serviço').first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(2500);

  const texto = await page.innerText('body');
  assert.ok(pedidos > 0, 'A folha não chamou a exportação.');
  assert.ok(texto.includes('Faturamento'), 'O rótulo Faturamento não apareceu na folha.');
  assert.ok(texto.includes('Pagamento'), 'O rótulo Pagamento sumiu da folha.');
  assert.deepEqual(errors, []);

  await page.screenshot({ path: 'artifacts/faturamento/relatorio/folha-simples.png', fullPage: true });

  // Sem overflow horizontal: a folha A4 não pode vazar de lado.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Overflow horizontal na folha.');

  console.log('OK: folha renderizada com Faturamento e Pagamento, sem erro de página e sem overflow.');
  console.log('TRECHO:', texto.slice(0, 700).replace(/\n+/g, ' | '));
} finally { await browser.close(); }
