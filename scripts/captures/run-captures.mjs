import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadCaptureEnv() {
  const envPath = path.resolve(".env.capture");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function inspectServer(loginUrl) {
  try {
    const response = await fetch(loginUrl, { signal: AbortSignal.timeout(3_000) });
    const body = await response.text();
    return {
      available: true,
      isErp: response.ok && (body.includes("Conectar ao ERP") || body.includes("Bem-vindo de volta")),
      status: response.status,
    };
  } catch {
    return { available: false, isErp: false, status: 0 };
  }
}

async function waitForErp(loginUrl, server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`O servidor de captura encerrou com código ${server.exitCode}.`);
    }
    const status = await inspectServer(loginUrl);
    if (status.isErp) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`O ERP não ficou disponível em ${loginUrl} dentro de 120 segundos.`);
}

function runPlaywright(env, args) {
  const cli = path.resolve("node_modules/@playwright/test/cli.js");
  return new Promise((resolve, reject) => {
    const test = spawn(process.execPath, [cli, ...args], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    test.once("error", reject);
    test.once("exit", (code) => resolve(code ?? 1));
  });
}

function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    server.kill("SIGTERM");
  }
}

loadCaptureEnv();

const baseURL = process.env.CAPTURE_BASE_URL?.trim() || "http://127.0.0.1:3100";
const captureUrl = new URL(baseURL);
const loginUrl = new URL("/login", captureUrl).toString();
const isLocal = ["127.0.0.1", "localhost"].includes(captureUrl.hostname);
const playwrightArgs = process.argv.slice(2);
let server = null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopServer(server);
    process.exit(130);
  });
}

try {
  if (isLocal) {
    const current = await inspectServer(loginUrl);
    if (current.available && !current.isErp) {
      throw new Error(
        `A porta ${captureUrl.port || "80"} está ocupada por outra aplicação (HTTP ${current.status}). ` +
          "Altere CAPTURE_BASE_URL em .env.capture."
      );
    }

    if (!current.available) {
      const port = captureUrl.port || "80";
      console.log(`Iniciando o ERP para capturas em ${baseURL}...`);
      server = spawn(
        process.execPath,
        [
          "--use-system-ca",
          path.resolve("node_modules/next/dist/bin/next"),
          "dev",
          "--turbopack",
          "--hostname",
          captureUrl.hostname,
          "--port",
          port,
        ],
        {
          env: {
            ...process.env,
            NEXT_DIST_DIR: ".next-capture",
            NEXT_TSCONFIG_PATH: "tsconfig.capture.json",
          },
          stdio: "inherit",
          windowsHide: true,
        }
      );
      await waitForErp(loginUrl, server);
    } else {
      console.log(`Reutilizando o ERP já disponível em ${baseURL}.`);
    }
  }

  const exitCode = await runPlaywright(
    {
      ...process.env,
      CAPTURE_BASE_URL: baseURL,
      CAPTURE_MANAGED_SERVER: "true",
    },
    playwrightArgs.length > 0 ? playwrightArgs : ["test", "--project=desktop"]
  );
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopServer(server);
}

process.exit(process.exitCode ?? 1);
