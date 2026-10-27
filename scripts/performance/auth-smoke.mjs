import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto(`${baseURL}/dashboard`);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  const denied = await anonymous.request.get(`${baseURL}/api/customers`, { maxRedirects: 0 });
  assert.ok([401, 403, 302, 303, 307, 308].includes(denied.status()));
  assert.equal(await (await anonymous.request.get(`${baseURL}/api/auth/session`)).json(), null);
  console.log('PASS: navegador sem sessao vai ao login e nao acessa API de clientes');

  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  const authenticated = await context.newPage();
  await authenticated.goto(`${baseURL}/clientes`);
  await waitForScreen(authenticated, new Set(), () => 0, 60_000);
  assert.equal(new URL(authenticated.url()).pathname, '/clientes');
  const result = await context.request.get(`${baseURL}/api/customers?limit=1`);
  assert.equal(result.status(), 200);
  console.log('PASS: sessao existente e reconhecida e abre pagina/API protegidas');

  const invalid = await browser.newContext();
  const cookies = await context.cookies();
  assert.ok(cookies.some((cookie) => cookie.name.includes('authjs.session-token')));
  await invalid.addCookies(cookies.map((cookie) => cookie.name.includes('authjs.session-token')
    ? { ...cookie, value: 'sessao-adulterada-de-teste' } : cookie));
  const corrupted = await invalid.request.get(`${baseURL}/api/customers`, { maxRedirects: 0 });
  assert.ok([401, 403, 302, 303, 307, 308].includes(corrupted.status()));
  await invalid.close();
  console.log('PASS: cookie de sessao adulterado nao acessa API protegida');

  // Logout afeta somente o contexto descartavel, nunca o arquivo de sessao salvo.
  const csrfResponse = await context.request.get(`${baseURL}/api/auth/csrf`);
  const { csrfToken } = await csrfResponse.json();
  const signedOut = await context.request.post(`${baseURL}/api/auth/signout`, {
    form: { csrfToken, callbackUrl: `${baseURL}/login` }, maxRedirects: 0,
  });
  assert.ok([200, 302, 303].includes(signedOut.status()));
  assert.equal(await (await context.request.get(`${baseURL}/api/auth/session`)).json(), null);
  const afterLogout = await context.request.get(`${baseURL}/api/customers`, { maxRedirects: 0 });
  assert.ok([401, 403, 302, 303, 307, 308].includes(afterLogout.status()));
  console.log('PASS: logout do contexto de teste remove sessao e bloqueia API');
} finally { await browser.close(); }
