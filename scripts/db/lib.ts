import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;

export const projectRoot = path.resolve(import.meta.dirname, "../..");

export type DatabaseKey = "demo" | "demir" | "garage";

export type DatabaseConfig = {
  key: DatabaseKey;
  label: string;
  projectRef: string;
  envName: string;
  poolerHosts: string[];
  url: string;
};

export type LocalMigration = {
  version: string;
  name: string;
  file: string;
};

export type DatabaseInspection = {
  database: DatabaseConfig;
  applied: string[];
  pending: LocalMigration[];
  remoteOnly: string[];
  fingerprints: Record<string, { count: number; hash: string }>;
  anonRoutines: string[];
};

const DATABASES: Omit<DatabaseConfig, "url">[] = [
  {
    key: "demo",
    label: "Demonstração",
    projectRef: "ozluphhwktyvqfrypjin",
    envName: "ERP_DB_DEMO",
    poolerHosts: [
      "aws-0-sa-east-1.pooler.supabase.com",
      "aws-1-sa-east-1.pooler.supabase.com",
    ],
  },
  {
    key: "demir",
    label: "Demir",
    projectRef: "lkpwaiynvnfedvxcjmrp",
    envName: "ERP_DB_DEMIR",
    poolerHosts: [
      "aws-0-sa-east-1.pooler.supabase.com",
      "aws-1-sa-east-1.pooler.supabase.com",
    ],
  },
  {
    key: "garage",
    label: "Garage Premium",
    projectRef: "qwvyhtjqjjicjbfiwjfm",
    envName: "ERP_DB_GARAGE_PREMIUM",
    poolerHosts: [
      "aws-0-ca-central-1.pooler.supabase.com",
      "aws-1-ca-central-1.pooler.supabase.com",
    ],
  },
];

export function parseSimpleEnv(file: string) {
  if (!fs.existsSync(file)) return new Map<string, string>();

  const values = new Map<string, string>();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function legacyDatabaseUrls() {
  const envFile = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envFile)) return [];

  return [...fs.readFileSync(envFile, "utf8").matchAll(
    /^\s*(?:#\s*)?DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/gm,
  )].map((match) => match[1].trim());
}

function validateDatabaseUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`A URL configurada para ${label} é inválida.`);
  }

  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`A URL configurada para ${label} não é PostgreSQL.`);
  }
  if (!parsed.password) {
    throw new Error(`A URL configurada para ${label} não contém senha.`);
  }
}

export function loadDatabaseConfigs(): DatabaseConfig[] {
  const migrationEnv = parseSimpleEnv(
    path.join(projectRoot, ".env.migrations.local"),
  );
  const legacyUrls = legacyDatabaseUrls();

  return DATABASES.map((database) => {
    const explicit = process.env[database.envName] || migrationEnv.get(database.envName);
    const fallback = legacyUrls.find((url) => url.includes(database.projectRef));
    const url = explicit || fallback;

    if (!url) {
      throw new Error(
        `Configure ${database.envName} em .env.migrations.local ou no ambiente.`,
      );
    }

    validateDatabaseUrl(url, database.label);
    return { ...database, url };
  });
}

export function readLocalMigrations(): LocalMigration[] {
  const directory = path.join(projectRoot, "supabase", "migrations");
  const migrations = fs
    .readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      version: file.match(/^(\d+)_/)?.[1] ?? "",
      name: file.replace(/^\d+_/, "").replace(/\.sql$/, ""),
      file,
    }));

  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Versão de migration duplicada: ${migration.version}.`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

// A URL configurada é a direta (db.<ref>.supabase.co), e o pooler que atende o
// projeto depende de quando ele foi criado: aws-0 ou aws-1. Testar o host errado
// não quebra nada aqui, mas cada tentativa vira "tenant/user ... not found" nos
// logs do Supavisor do cliente, e isso já foi lido como falha de produção. Por
// isso o host que conectou fica guardado para as próximas execuções, e um host
// que não conhece o projeto não é testado de novo na outra porta.
const POOLER_CACHE_FILE = path.join(
  projectRoot,
  "node_modules",
  ".cache",
  "erpoficina-db",
  "pooler-hosts.json",
);

function readPoolerCache(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(POOLER_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function rememberPoolerHost(database: DatabaseConfig, connectionString: string) {
  const host = new URL(connectionString).hostname;
  if (!database.poolerHosts.includes(host)) return;

  const cache = readPoolerCache();
  if (cache[database.projectRef] === host) return;
  cache[database.projectRef] = host;
  try {
    fs.mkdirSync(path.dirname(POOLER_CACHE_FILE), { recursive: true });
    fs.writeFileSync(POOLER_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Sem o cache a próxima execução apenas volta a testar os hosts.
  }
}

function connectionCandidates(database: DatabaseConfig) {
  const source = new URL(database.url);
  const urls: string[] = [];

  if (source.hostname.includes("pooler.supabase.com")) {
    urls.push(source.toString());
  }

  const remembered = readPoolerCache()[database.projectRef];
  const hosts = remembered && database.poolerHosts.includes(remembered)
    ? [remembered, ...database.poolerHosts.filter((host) => host !== remembered)]
    : database.poolerHosts;

  for (const host of hosts) {
    for (const port of ["5432", "6543"]) {
      const candidate = new URL(source.toString());
      candidate.hostname = host;
      candidate.port = port;
      candidate.username = `postgres.${database.projectRef}`;
      candidate.pathname = "/postgres";
      urls.push(candidate.toString());
    }
  }

  urls.push(source.toString());
  return [...new Set(urls)];
}

export async function connectDatabase(database: DatabaseConfig) {
  const failures: string[] = [];
  const unknownHosts = new Set<string>();
  for (const connectionString of connectionCandidates(database)) {
    const host = new URL(connectionString).hostname;
    if (unknownHosts.has(host)) continue;

    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8_000,
    });

    try {
      await client.connect();
      rememberPoolerHost(database, connectionString);
      return { client, connectionString };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      if (/tenant.*not found/i.test(message)) unknownHosts.add(host);
      await client.end().catch(() => undefined);
    }
  }

  throw new Error(
    `Não foi possível conectar ao banco ${database.label}: ${failures.at(-1)}`,
  );
}

function normalizeFunction(source: string) {
  const withoutComments = source
    .replace(/\r/g, "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  let normalized = "";
  let quoted = false;

  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (character === "'") {
      normalized += character;
      if (quoted && withoutComments[index + 1] === "'") {
        normalized += "'";
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    normalized += quoted ? character : character.toLowerCase();
  }

  return normalized
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;=<>+*/])\s*/g, "$1")
    .trim();
}

export const SCHEMA_QUERIES: Record<string, string> = {
  relations: `
    select c.relname, c.relkind, c.relpersistence, c.relreplident,
           c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) owner,
           coalesce((select array_agg(x::text order by x::text)::text
                       from unnest(c.relacl) x), '') acl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
     order by 1`,
  columns: `
    select c.relname table_name, a.attname,
           format_type(a.atttypid, a.atttypmod) type, a.attnotnull,
           coalesce(pg_get_expr(d.adbin, d.adrelid), '') default_expr,
           a.attidentity, a.attgenerated, coalesce(coll.collname, '') collation
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join pg_collation coll on coll.oid = a.attcollation
     where n.nspname = 'public' and c.relkind in ('r','p','v','m')
       and a.attnum > 0 and not a.attisdropped
     order by 1, 2`,
  constraints: `
    select r.relname table_name, c.conname, c.contype, c.condeferrable,
           c.condeferred, c.convalidated, pg_get_constraintdef(c.oid, true) definition
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
     order by 1, 2`,
  indexes: `
    select tablename, indexname, indexdef
      from pg_indexes where schemaname = 'public'
     order by 1, 2`,
  triggers: `
    select c.relname table_name, t.tgname, t.tgenabled,
           pg_get_triggerdef(t.oid, true) definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
     order by 1, 2`,
  policies: `
    select schemaname, tablename, policyname, permissive, roles, cmd,
           coalesce(qual, '') qual, coalesce(with_check, '') with_check
      from pg_policies
     where schemaname in ('public', 'storage')
     order by 1, 2, 3`,
  enums: `
    select t.typname, e.enumsortorder, e.enumlabel,
           pg_get_userbyid(t.typowner) owner,
           coalesce((select array_agg(x::text order by x::text)::text
                       from unnest(t.typacl) x), '') acl
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
     where n.nspname = 'public'
     order by 1, 2`,
  sequences: `
    select sequencename, data_type, start_value, min_value, max_value,
           increment_by, cycle, cache_size
      from pg_sequences where schemaname = 'public'
     order by 1`,
  realtime: `
    select c.relname, p.pubname, pr.prattrs,
           coalesce(pg_get_expr(pr.prqual, pr.prrelid), '') row_filter
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
     order by 1, 2`,
  authTriggers: `
    select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) definition
      from pg_trigger t
     where t.tgrelid = 'auth.users'::regclass
       and not t.tgisinternal
       and t.tgname like 'on_auth_%'
     order by 1`,
  storageBuckets: `
    select id, name, public, file_size_limit,
           coalesce(array_to_string(allowed_mime_types, ','), '') allowed_mime_types
      from storage.buckets
     order by id`,
  extensions: `
    select e.extname, n.nspname
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname in (
       'pg_cron', 'pg_net', 'pg_stat_statements', 'pg_trgm',
       'pgcrypto', 'plpgsql', 'supabase_vault', 'uuid-ossp'
     )
     order by 1`,
  functions: `
    select p.proname, pg_get_function_identity_arguments(p.oid) args,
           pg_get_function_result(p.oid) result, p.prokind, p.provolatile,
           p.proparallel, p.prosecdef, p.proleakproof,
           coalesce(array_to_string(p.proconfig, ','), '') config,
           p.prosrc, pg_get_userbyid(p.proowner) owner,
           coalesce((select array_agg(x::text order by x::text)::text
                       from unnest(p.proacl) x), '') acl
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by 1, 2`,
};

function fingerprint(rows: unknown[]) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex")
    .slice(0, 16);
}

export async function inspectDatabase(
  database: DatabaseConfig,
  localMigrations = readLocalMigrations(),
): Promise<DatabaseInspection> {
  const { client } = await connectDatabase(database);
  try {
    const history = await client.query<{ version: string }>(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const applied = history.rows.map((row) => String(row.version));
    const appliedSet = new Set(applied);
    const localSet = new Set(localMigrations.map((migration) => migration.version));
    const pending = localMigrations.filter(
      (migration) => !appliedSet.has(migration.version),
    );
    const remoteOnly = applied.filter((version) => !localSet.has(version));
    const fingerprints: DatabaseInspection["fingerprints"] = {};

    for (const [category, query] of Object.entries(SCHEMA_QUERIES)) {
      const result = await client.query(query);
      const rows =
        category === "functions"
          ? result.rows.map((row) => ({
              ...row,
              prosrc: normalizeFunction(String(row.prosrc)),
            }))
          : result.rows;
      fingerprints[category] = { count: rows.length, hash: fingerprint(rows) };
    }

    // A chave anon vai no navegador. Função do public que ela executa é RPC
    // aberta, e SECURITY DEFINER roda como dono. Toda função nova nasce com
    // EXECUTE para PUBLIC, então esquecer o REVOKE numa migration basta.
    const exposed = await client.query<{ signature: string }>(
      `select format('%I.%I(%s)', n.nspname, p.proname,
                     pg_get_function_identity_arguments(p.oid)) as signature
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind in ('f', 'p')
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_proc'::regclass
               and d.objid = p.oid
               and d.deptype = 'e'
          )
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1`,
    );
    const anonRoutines = exposed.rows.map((row) => row.signature);

    return { database, applied, pending, remoteOnly, fingerprints, anonRoutines };
  } finally {
    await client.end();
  }
}

export async function inspectAllDatabases() {
  const migrations = readLocalMigrations();
  const databases = loadDatabaseConfigs();
  const inspections = await Promise.all(
    databases.map((database) => inspectDatabase(database, migrations)),
  );
  return { migrations, inspections };
}

export function schemaDifferences(inspections: DatabaseInspection[]) {
  const categories = Object.keys(inspections[0]?.fingerprints ?? {});
  return categories.filter(
    (category) =>
      new Set(
        inspections.map(
          (inspection) => inspection.fingerprints[category]?.hash,
        ),
      ).size !== 1,
  );
}

export function printInspectionSummary(inspections: DatabaseInspection[]) {
  console.log("\nHistórico de migrations:");
  for (const inspection of inspections) {
    console.log(
      `- ${inspection.database.label}: ${inspection.applied.length} aplicadas, ` +
        `${inspection.pending.length} pendentes, ${inspection.remoteOnly.length} somente no remoto`,
    );
    for (const migration of inspection.pending) {
      console.log(`    pendente: ${migration.version}_${migration.name}`);
    }
    for (const version of inspection.remoteOnly) {
      console.log(`    somente remoto: ${version}`);
    }
    for (const signature of inspection.anonRoutines) {
      console.log(`    executável por anon: ${signature}`);
    }
  }

  console.log("\nComparação do schema:");
  const categories = Object.keys(inspections[0]?.fingerprints ?? {});
  for (const category of categories) {
    const values = inspections.map(
      (inspection) => inspection.fingerprints[category],
    );
    const equal = new Set(values.map((value) => value.hash)).size === 1;
    const counts = inspections
      .map(
        (inspection, index) =>
          `${inspection.database.label}=${values[index].count}`,
      )
      .join(" | ");
    console.log(`- ${category}: ${equal ? "IGUAL" : "DIFERENTE"} (${counts})`);
  }
}

function sanitize(text: string, database: DatabaseConfig, connectionString: string) {
  const secrets = new Set<string>([database.url, connectionString]);
  for (const value of [database.url, connectionString]) {
    try {
      const parsed = new URL(value);
      secrets.add(parsed.password);
      secrets.add(decodeURIComponent(parsed.password));
    } catch {
      // A URL já foi validada; esta proteção é apenas complementar.
    }
  }

  let sanitized = text;
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join("[CREDENCIAL_REMOVIDA]");
  }
  return sanitized.replace(
    /postgres(?:\.[^:\s@]+)?:[^@\s]+@/gi,
    "postgres:***@",
  );
}

function createTemporarySupabaseProject() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "erpoficina-supabase-"),
  );
  const supabaseDirectory = path.join(directory, "supabase");
  fs.mkdirSync(path.join(supabaseDirectory, "migrations"), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "supabase", "config.toml"),
    path.join(supabaseDirectory, "config.toml"),
  );

  for (const migration of readLocalMigrations()) {
    fs.copyFileSync(
      path.join(projectRoot, "supabase", "migrations", migration.file),
      path.join(supabaseDirectory, "migrations", migration.file),
    );
  }
  return directory;
}

export async function runDatabasePush(
  database: DatabaseConfig,
  dryRun: boolean,
) {
  const probe = await connectDatabase(database);
  const connectionString = probe.connectionString;
  await probe.client.end();

  const temporaryProject = createTemporarySupabaseProject();
  const executable = path.join(
    projectRoot,
    "node_modules",
    "supabase",
    "bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
  const args = ["db", "push"];
  if (dryRun) args.push("--dry-run");
  // Sem --include-all a CLI recusa migration cuja versão seja anterior à última
  // já aplicada no remoto, e para com "Rerun the command with --include-all".
  // Isso acontece toda vez que uma branch cria migration com timestamp menor que
  // outra que já subiu — situação normal aqui, porque os três bancos avançam em
  // ritmos diferentes. Quem decide o que aplicar é o `pending` calculado por
  // inspectDatabase, e o histórico já foi validado contra `remoteOnly` antes.
  args.push("--include-all", "--db-url", connectionString, "--yes");

  try {
    const result = await new Promise<{ code: number; output: string }>(
      (resolve, reject) => {
        const child = spawn(executable, args, {
          cwd: temporaryProject,
          env: { ...process.env },
          windowsHide: true,
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          output += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, output }));
      },
    );

    const safeOutput = sanitize(result.output, database, connectionString).trim();
    if (safeOutput) console.log(safeOutput);
    if (result.code !== 0) {
      throw new Error(
        `${dryRun ? "Dry-run" : "Deploy"} falhou em ${database.label}.`,
      );
    }
  } finally {
    fs.rmSync(temporaryProject, { recursive: true, force: true });
  }
}
