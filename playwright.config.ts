import { defineConfig } from "@playwright/test";
import { loadCaptureEnv } from "./tests/captures/support/capture-env";

loadCaptureEnv();

const baseURL = process.env.CAPTURE_BASE_URL?.trim() || "http://127.0.0.1:3100";
const captureUrl = new URL(baseURL);
const isLocalCapture = ["127.0.0.1", "localhost"].includes(captureUrl.hostname);
const localPort = captureUrl.port || (captureUrl.protocol === "https:" ? "443" : "80");
const requestedDeviceScaleFactor = Number(process.env.CAPTURE_DEVICE_SCALE_FACTOR ?? "1");
const deviceScaleFactor = Number.isFinite(requestedDeviceScaleFactor) && requestedDeviceScaleFactor > 0
  ? requestedDeviceScaleFactor
  : 1;

export default defineConfig({
  testDir: "./tests/captures",
  outputDir: "./artifacts/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "msedge",
    colorScheme: "light",
    deviceScaleFactor,
    locale: "pt-BR",
    storageState: "playwright/.auth/capture-user.json",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { storageState: { cookies: [], origins: [] } },
    },
    {
      name: "desktop",
      testMatch: /capture-all\.spec\.ts/,
      dependencies: ["setup"],
      use: { trace: "off" },
    },
  ],
  webServer: isLocalCapture && process.env.CAPTURE_MANAGED_SERVER !== "true"
    ? {
        command:
          `node --use-system-ca node_modules/next/dist/bin/next dev --turbopack ` +
          `--hostname ${captureUrl.hostname} --port ${localPort}`,
        url: new URL("/login", baseURL).toString(),
        env: {
          ...process.env,
          NEXT_DIST_DIR: ".next-capture",
          NEXT_TSCONFIG_PATH: "tsconfig.capture.json",
        },
        reuseExistingServer: true,
        timeout: 120 * 1000,
      }
    : undefined,
});
