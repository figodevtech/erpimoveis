import fs from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { loadCaptureEnv } from "./support/capture-env";

loadCaptureEnv();

const authFile = path.resolve("playwright/.auth/capture-user.json");

setup("autenticar conta de captura", async ({ page }) => {
  setup.setTimeout(90_000);

  const email = process.env.CAPTURE_EMAIL?.trim();
  const password = process.env.CAPTURE_PASSWORD;
  if (!email || !password) {
    throw new Error("Configure CAPTURE_EMAIL e CAPTURE_PASSWORD em .env.capture antes de gerar as capturas.");
  }

  console.log("Abrindo a tela de login da aplicação de captura...");
  const loginPage = await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (!loginPage?.ok()) {
    throw new Error(
      `A rota de login respondeu HTTP ${loginPage?.status() ?? "desconhecido"}. ` +
        `Confira CAPTURE_BASE_URL (${page.url()}) e se essa porta pertence ao ERP Oficina.`
    );
  }

  const identifierInput = page.getByLabel("Usuário ou e-mail");
  const passwordInput = page.getByLabel("Senha");
  await expect(identifierInput, "O campo Usuário ou e-mail não apareceu na página de login").toBeVisible();
  await expect(passwordInput, "O campo Senha não apareceu na página de login").toBeVisible();
  await identifierInput.fill(email);
  await passwordInput.fill(password);

  console.log("Enviando as credenciais da conta de captura...");
  const authResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/auth/callback/credentials"),
    { timeout: 35_000 }
  );
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  let authResponse;
  try {
    authResponse = await authResponsePromise;
  } catch {
    throw new Error(
      "A API de autenticação não respondeu em 35 segundos. " +
        "Confira no terminal do Next.js se houve falha de conexão com o Supabase."
    );
  }

  const authBody = await authResponse.text().catch(() => "");
  if (!authResponse.ok()) {
    throw new Error(
      `A API de autenticação respondeu HTTP ${authResponse.status()}: ${authBody.slice(0, 500) || "sem detalhes"}`
    );
  }

  let authError = "";
  try {
    const result = JSON.parse(authBody) as { url?: string };
    const resultUrl = result.url ? new URL(result.url, page.url()) : null;
    authError = resultUrl?.searchParams.get("error") ?? "";
  } catch {
    // Algumas versões do NextAuth podem responder sem corpo JSON.
  }
  if (authError) {
    throw new Error(`A autenticação recusou o login: ${authError}. Verifique o e-mail, a senha e se o usuário está ativo.`);
  }

  try {
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  } catch {
    const visibleMessage = await page
      .locator('[data-sonner-toast], [role="alert"]')
      .filter({ visible: true })
      .allTextContents()
      .catch(() => []);
    const detail = visibleMessage.map((message) => message.trim()).filter(Boolean).join(" | ");
    throw new Error(
      detail
        ? `O login não foi concluído: ${detail}`
        : "O login não foi concluído em 30 segundos. Verifique as credenciais e o terminal do servidor."
    );
  }

  console.log(`Login concluído; redirecionado para ${page.url()}`);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
  await page.context().browser()?.close();
});
