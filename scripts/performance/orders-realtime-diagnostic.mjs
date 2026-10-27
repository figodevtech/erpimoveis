import { chromium } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, findMenuLink, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.__ordensTokenReads = [];
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/ordens/realtime-token') return original(input, init);
      const stack = new Error().stack ?? '';
      const entry = { startMs: Math.round(performance.now()), sourceHint: /\brenew\b/.test(stack) ? 'renew' : /\bconnect\b/.test(stack) ? 'connect' : 'unknown', status: null };
      window.__ordensTokenReads.push(entry);
      return original(input, init).then((response) => { entry.status = response.status; return response; });
    };
  });
  const events = [];
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.includes('/realtime/')) return;
    events.push({ event: 'socket-open' });
    socket.on('socketerror', () => events.push({ event: 'socket-error' }));
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        const event = Array.isArray(frame) ? frame[3] : frame.event;
        const body = Array.isArray(frame) ? frame[4] : frame.payload;
        const topic = Array.isArray(frame) ? frame[2] : frame.topic;
        const scope = String(topic).startsWith('realtime:ordens:') ? 'orders' : 'other';
        if (event === 'phx_reply' || event === 'system') {
          const reason = JSON.stringify(body?.response ?? body ?? {}).toLowerCase();
          events.push({ event, scope, status: body?.status ?? null, permissionDenied: /permission|unauthori|policy|rls/.test(reason), tokenExpired: /expired/.test(reason), topicMissing: /not found|does not exist/.test(reason) });
        }
      } catch { /* Nenhum frame bruto, token ou identificador e registrado. */ }
    });
  });
  const navigation = process.argv.includes('--navigate');
  await page.goto(baseURL + (navigation ? '/clientes' : '/ordens'), { waitUntil: 'domcontentloaded' });
  if (navigation) {
    await waitForScreen(page, new Set(), () => 0, 60_000);
    await (await findMenuLink(page, '/ordens')).click();
    await page.waitForURL((url) => url.pathname === '/ordens');
  }
  await page.waitForTimeout(12_000);
  console.log(JSON.stringify({ mode: navigation ? 'client-navigation' : 'document', events, tokenReads: await page.evaluate(() => window.__ordensTokenReads) }));
} finally { await browser.close(); }
