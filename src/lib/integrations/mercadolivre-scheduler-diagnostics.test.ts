import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("diagnóstico usa últimas execuções por etapa, histórico continua limitado", () => {
  const source = readFileSync(new URL("../../app/api/integracoes/mercadolivre/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(source, /rpc\("mercadolivre_latest_sync_runs"\)/);
  assert.match(source, /syncRuns: latestJobRuns\?\.length \? latestJobRuns : syncRuns/);
  assert.match(source, /if \(latestJobRunsError\) throw latestJobRunsError/);
  assert.match(source, /\.limit\(50\)/);
});

test("consulta de saúde inclui METRICS sem limite global e acesso restrito", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260921120000_mercadolivre_scheduler_diagnostics.sql", import.meta.url), "utf8");
  assert.match(sql, /'METRICS'/);
  assert.match(sql, /cross join lateral/);
  assert.match(sql, /where r.job_name = jobs.name/);
  assert.match(sql, /order by r.started_at desc, r.id desc\s+limit 1/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
});
