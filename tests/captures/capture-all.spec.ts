import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { CAPTURE_MODULES } from "./support/modules";
import { CAPTURE_STYLE, sanitizePageForCapture } from "./support/sanitize-page";

type CaptureResult = {
  module: string;
  requestedPath: string;
  finalUrl: string;
  status: "captured" | "unauthorized" | "error";
  file?: string;
  error?: string;
};

async function waitForPageReady(page: import("@playwright/test").Page) {
  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? "";
      if (text.includes("Estamos esquentando a pizza")) return false;

      const loaders = document.querySelectorAll<HTMLElement>(
        '.animate-spin, .animate-pulse, [aria-busy="true"]'
      );
      return !Array.from(loaders).some((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0.05
        );
      });
    }, undefined, { timeout: 20_000, polling: 250 });
    await page.waitForTimeout(750);
    return true;
  } catch {
    return false;
  }
}

async function waitForModuleReady(
  page: import("@playwright/test").Page,
  modulePath: string
) {
  if (modulePath !== "/acompanhamento") return;

  // Aguarda a hidratação iniciar antes de testar o estado final do painel.
  await page.waitForTimeout(1_000);
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return !text.includes("Atualizando") && !document.querySelector(".animate-pulse");
  }, undefined, { timeout: 20_000, polling: 250 });
  await page.waitForTimeout(500);
}

test("capturar todos os módulos autorizados", async ({ page }) => {
  const outputDir = path.resolve("artifacts/captures");
  fs.mkdirSync(outputDir, { recursive: true });
  const results: CaptureResult[] = [];
  const requestedSlugs = new Set(
    (process.env.CAPTURE_ONLY ?? "")
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean)
  );
  const modules = requestedSlugs.size > 0
    ? CAPTURE_MODULES.filter((captureModule) => requestedSlugs.has(captureModule.slug))
    : CAPTURE_MODULES;

  if (modules.length === 0) {
    throw new Error(`Nenhum módulo corresponde a CAPTURE_ONLY=${process.env.CAPTURE_ONLY}.`);
  }

  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("acompanhamento:setor", "all");
  });

  for (const captureModule of modules) {
    try {
      const response = await page.goto(captureModule.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const pageReady = await waitForPageReady(page);
      await waitForModuleReady(page, captureModule.path);

      const finalUrl = page.url();
      if (/\/(?:login|nao-autorizado)(?:\?|$)/.test(new URL(finalUrl).pathname)) {
        results.push({
          module: captureModule.name,
          requestedPath: captureModule.path,
          finalUrl,
          status: "unauthorized",
        });
        continue;
      }

      await sanitizePageForCapture(page);
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      const file = path.join(outputDir, `${captureModule.slug}.png`);
      await page.screenshot({
        path: file,
        fullPage: process.env.CAPTURE_FULL_PAGE === "true",
        animations: "disabled",
        caret: "hide",
        mask: [page.locator("[data-capture-sensitive]")],
        maskColor: "#e5e7eb",
        scale: process.env.CAPTURE_SCREENSHOT_SCALE === "device" ? "device" : "css",
        style: CAPTURE_STYLE,
      });

      results.push({
        module: captureModule.name,
        requestedPath: captureModule.path,
        finalUrl,
        status: response && response.status() >= 400 || !pageReady ? "error" : "captured",
        file: path.relative(process.cwd(), file),
        error: response && response.status() >= 400
          ? `HTTP ${response.status()}`
          : !pageReady
            ? "A página ainda apresentava indicador de carregamento após 20 segundos"
            : undefined,
      });
    } catch (error) {
      results.push({
        module: captureModule.name,
        requestedPath: captureModule.path,
        finalUrl: page.url(),
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const reportName = requestedSlugs.size > 0 ? "report-partial.json" : "report.json";
  fs.writeFileSync(path.join(outputDir, reportName), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await page.context().browser()?.close();

  const errors = results.filter((result) => result.status === "error");
  if (errors.length > 0) {
    throw new Error(
      `Falha ao capturar ${errors.length} módulo(s): ` +
        errors.map((result) => `${result.module}: ${result.error ?? "erro desconhecido"}`).join(" | ")
    );
  }

  const capturedCount = results.filter((result) => result.status === "captured").length;
  if (capturedCount === 0) {
    const unauthorizedModules = results
      .filter((result) => result.status === "unauthorized")
      .map((result) => result.module)
      .join(", ");
    console.warn(
      `Nenhuma imagem foi gerada. A conta não possui acesso aos módulos solicitados: ${unauthorizedModules || "nenhum"}.`
    );
  }
});
