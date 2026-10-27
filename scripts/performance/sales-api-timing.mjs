import { performanceBaseURL, preparePerformanceSession } from './navigation.mjs';
import { chromium } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = performanceBaseURL();

// Apenas leituras autenticadas; nao registra cookies, parametros ou respostas.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  const results = [];
  for (let round = 1; round <= 3; round++) {
    for (const route of ['/api/venda?view=historico&limit=20', '/api/venda/status-counter']) {
      const start = performance.now();
      const response = await context.request.get(baseURL + route);
      const measurement = {
        round, path: new URL(response.url()).pathname, status: response.status(),
        totalMs: Math.round(performance.now() - start),
        serverTiming: response.headers()['server-timing'] ?? null,
      };
      results.push(measurement);
      console.log(JSON.stringify(measurement));
      if (!response.ok()) throw new Error(`API respondeu HTTP ${response.status()}.`);
    }
  }
  await mkdir('artifacts/performance', { recursive: true });
  const output = `artifacts/performance/api-sales-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(output, JSON.stringify({ note: 'Sessao preparada antes das leituras; primeira chamada pode incluir compilacao.', results }, null, 2));
  console.log(`Relatorio: ${output}`);
} finally { await browser.close(); }
