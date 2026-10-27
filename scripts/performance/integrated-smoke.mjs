import { spawnSync } from 'node:child_process';
import { performanceBaseURL } from './navigation.mjs';
const baseURL = performanceBaseURL();
const scripts = ['functional-smoke.mjs', 'operational-smoke.mjs', 'vehicles-banks-smoke.mjs', 'fiscal-orders-smoke.mjs', 'customers-smoke.mjs', 'sales-summary-smoke.mjs'];
const failed = [];
for (const script of scripts) {
  console.log(`Executando ${script}`);
  const result = spawnSync(process.execPath, [`scripts/performance/${script}`], {
    env: { ...process.env, PERF_BASE_URL: baseURL }, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) failed.push(script);
}
console.log(JSON.stringify({ suites: scripts.length, passed: scripts.length - failed.length, failed }));
process.exitCode = failed.length ? 1 : 0;
