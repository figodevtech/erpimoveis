import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession } from './navigation.mjs';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  // Todos os corpos abaixo sao invalidos; as rotas validam antes de gravar.
  const task = await context.request.post(`${baseURL}/api/tarefas`, { data: {} });
  assert.equal(task.status(), 400);
  assert.equal((await task.json()).error, 'O título é obrigatório.');
  console.log('PASS: tarefa sem titulo retorna 400 com mensagem preservada');
  const document = await context.request.post(`${baseURL}/api/config/documentos`, {
    data: { nome: 'Teste sintetico', modulo: 'INVALIDO', html: '<p>Teste</p>' },
  });
  assert.equal(document.status(), 400);
  assert.match(JSON.stringify(await document.json()), /Módulo inválido/);
  console.log('PASS: documento com modulo invalido retorna 400');
  const radio = await context.request.post(`${baseURL}/api/radios`, { data: {} });
  assert.equal(radio.status(), 400);
  const invalidQuery = await context.request.get(`${baseURL}/api/radios?limit=-1`);
  assert.equal(invalidQuery.status(), 400);
  console.log('PASS: radio sem nome e paginacao invalida retornam 400');
  const stock = await context.request.post(`${baseURL}/api/usoconsumo/itens`, { data: { titulo: '' } });
  assert.equal(stock.status(), 400);
  console.log('PASS: item de uso/consumo invalido e recusado antes da gravacao');
  const list = await context.request.get(`${baseURL}/api/radios?limit=1`);
  assert.equal(list.status(), 200);
  console.log('PASS: consulta valida de radios continua disponivel');
} finally { await browser.close(); }
