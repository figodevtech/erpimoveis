import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  connectDatabase, loadDatabaseConfigs, normalizeConstraint, normalizeFunction,
  parseSimpleEnv, projectRoot, readLocalMigrations, SCHEMA_QUERIES,
  type DatabaseConfig,
} from "./lib";

export const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const packageDirectory = path.join(projectRoot, "artifacts/db/modelo-atual");
const registryFile = path.join(projectRoot, "scripts/db/clientes.json");
const CATEGORIES = Object.keys(SCHEMA_QUERIES).filter((category) => category !== "storageBuckets");
type Connection = Awaited<ReturnType<typeof connectDatabase>>["client"];
export type Bucket = { id: string; name: string; public: boolean; file_size_limit: string | null; allowed_mime_types: string[] | null };
export type Model = {
  format: 1; generatedAt: string; sourceRef: string; sqlHash: string; packageHash: string;
  migrations: { version: string; name: string | null }[];
  buckets: Bucket[]; schema: Record<string, string>;
  baseData: Record<string, Record<string, unknown>[]>;
};

// Somente catalogos tecnicos. Nunca copiar empresa, usuarios, perfis, plano do
// cliente, configuracoes fiscais, credenciais ou registros comerciais.
const BASE_COLUMNS: Record<string, string[]> = {
  permissao: ["id", "nome", "descricao"],
  tipos_ajuste_transacao: ["id", "codigo", "nome", "descricao", "natureza", "codigo_sistema", "ativo"],
  dre_template: ["id", "codigo", "nome", "descricao", "versao", "ativo"],
  dre_linha: ["id", "template_id", "parent_id", "codigo", "nome", "nivel", "ordem", "tipo", "natureza_dre", "formula", "sinal", "permite_manual", "sem_fonte", "ativo"],
  unidademedida: ["id", "sigla", "descricao", "ativo"],
  fiscal_ncm: ["codigo", "descricao", "vigencia_inicio", "vigencia_fim", "ato", "fonte", "fonte_url", "importado_em", "caminho"],
  fiscal_nfe_cst_ibscbs: ["cst", "descricao", "indicadores", "versao_fonte", "atualizado_em"],
  fiscal_nfe_classificacao_tributaria: ["codigo", "cst", "nome", "descricao", "percentual_reducao_ibs", "percentual_reducao_cbs", "inicio_vigencia", "fim_vigencia", "permite_nfe", "indicadores", "versao_fonte", "atualizado_em", "fonte_url"],
};
const baseOrder = (table: string) => quote(BASE_COLUMNS[table][0]);
const packageHash = (model: Omit<Model, "packageHash"> | Model) => hash(JSON.stringify({
  sqlHash: model.sqlHash, sourceRef: model.sourceRef, schema: model.schema,
  migrations: model.migrations, buckets: model.buckets, baseData: model.baseData,
}));

export function readTarget(configured?: DatabaseConfig[]) {
  const env = parseSimpleEnv(path.join(projectRoot, ".env.novo-cliente"));
  const get = (name: string) => process.env[name] || env.get(name) || "";
  const key = get("NOVO_CLIENTE_KEY");
  const label = get("NOVO_CLIENTE_NOME");
  const projectRef = get("NOVO_CLIENTE_PROJECT_REF");
  const url = get("NOVO_CLIENTE_DATABASE_URL");
  const apiUrl = get("NOVO_CLIENTE_SUPABASE_URL");
  const serviceKey = get("NOVO_CLIENTE_SERVICE_ROLE_KEY");
  if (!/^[a-z][a-z0-9_]*$/.test(key) || !label || !/^[a-z]{20}$/.test(projectRef)) {
    throw new Error("Preencha key, nome e project ref valido em .env.novo-cliente.");
  }
  const parsed = new URL(url);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.password ||
      parsed.pathname !== "/postgres" ||
      !(parsed.hostname === `db.${projectRef}.supabase.co` ||
        (parsed.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(parsed.username) === `postgres.${projectRef}`))) {
    throw new Error("A URL PostgreSQL nao corresponde ao projeto novo.");
  }
  if (new URL(apiUrl).origin !== `https://${projectRef}.supabase.co` || !serviceKey) {
    throw new Error("URL da API ou service_role ausente/incorreta para o projeto novo.");
  }
  const registered = configured ?? loadDatabaseConfigs();
  const envName = `ERP_DB_${key.toUpperCase()}`;
  const existing = registered.find((item) => item.projectRef === projectRef || item.key === key || item.envName === envName);
  if (existing && (existing.projectRef !== projectRef || existing.key !== key || existing.key === "demo")) {
    throw new Error("Destino coincide com outro banco cadastrado. Operacao recusada.");
  }
  const database: DatabaseConfig = {
    key, label, projectRef, envName,
    poolerHosts: parsed.hostname.endsWith(".pooler.supabase.com") ? [parsed.hostname] : [], url,
  };
  return { database, apiUrl, serviceKey, registered: Boolean(existing) };
}

export async function schemaHashes(client: Connection) {
  const fingerprints: Record<string, string> = {};
  for (const category of CATEGORIES) {
    const result = await client.query(SCHEMA_QUERIES[category]);
    const rows = result.rows.map((row) => category === "functions"
      ? { ...row, prosrc: normalizeFunction(String(row.prosrc)) }
      : category === "constraints" ? { ...row, definition: normalizeConstraint(row.definition) } : row);
    fingerprints[category] = hash(JSON.stringify(rows));
  }
  return fingerprints;
}

export async function verifySchema(client: Connection, model: Model) {
  const actual = await schemaHashes(client);
  const differences = CATEGORIES.filter((category) => actual[category] !== model.schema[category]);
  if (differences.length) throw new Error(`Estrutura diverge do pacote: ${differences.join(", ")}.`);
}

async function dump(connectionString: string, snapshot: string) {
  const connection = new URL(connectionString);
  const password = decodeURIComponent(connection.password);
  connection.password = "";
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.PG_DUMP_PATH || "pg_dump", [
      "--dbname", connection.toString(), "--schema-only", "--schema=public",
      "--no-owner", "--no-privileges", `--snapshot=${snapshot}`,
    ], { env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require" }, windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => reject(new Error("pg_dump indisponivel. Instale PostgreSQL ou configure PG_DUMP_PATH.")));
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8"))
      : reject(new Error(`pg_dump falhou: ${stderr.replace(/postgres(?:ql)?:\/\/\S+/g, "[conexao ocultada]")}`)));
  });
}

async function permissionSQL(client: Connection) {
  // Reconstroi ACLs explicitamente; GRANT sozinho nao remove defaults do projeto novo.
  const objects = (await client.query(`
    select case when c.relkind='S' then 'SEQUENCE' else 'TABLE' end kind,
           quote_ident(c.relname) object, c.relacl acl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p','v','m','S')
    union all
    select 'FUNCTION',quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')',p.proacl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prorettype<>'event_trigger'::regtype
  `)).rows;
  const grants = (await client.query(`
    select o.kind,o.object,
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end role,
      a.privilege_type,a.is_grantable
    from jsonb_to_recordset($1::jsonb) o(kind text,object text,acl text)
    cross join lateral aclexplode(o.acl::aclitem[]) a
  `, [JSON.stringify(objects)])).rows;
  const lines = objects.map((obj) => `REVOKE ALL ON ${obj.kind} public.${obj.object} FROM PUBLIC, anon, authenticated, service_role;`);
  // NULL ACL significa os privilegios padrao, inclusive EXECUTE de PUBLIC em funcoes.
  for (const obj of objects.filter((obj) => obj.acl === null && obj.kind === "FUNCTION")) {
    lines.push(`GRANT EXECUTE ON FUNCTION public.${obj.object} TO PUBLIC;`);
  }
  lines.push(...grants.map((grant) => `GRANT ${grant.privilege_type} ON ${grant.kind} public.${grant.object} TO ${grant.role}${grant.is_grantable ? " WITH GRANT OPTION" : ""};`));
  return lines.join("\n");
}

export async function exportModel() {
  const source = loadDatabaseConfigs().find((item) => item.key === "demo")!;
  const { client, connectionString } = await connectDatabase(source);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query("select pg_export_snapshot() snapshot")).rows[0].snapshot;
    const migrations = (await client.query("select version,name from supabase_migrations.schema_migrations order by version")).rows;
    const local = new Set(readLocalMigrations().map((item) => item.version));
    if (migrations.some((item) => !local.has(item.version)) || migrations.length !== local.size) {
      throw new Error("Atualize e valide a Demonstracao antes de exportar: historico local/remoto diverge.");
    }
    const platformFunctions = (await client.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prorettype='event_trigger'::regtype`)).rows.map((row) => String(row.proname));
    const base = (await dump(connectionString, snapshot)).replace(/^\\(?:un)?restrict[^\r\n]*\r?\n/gm, "")
      .split(/(?=^--\r?\n-- Name: )/m).filter((block) => !platformFunctions.some((name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:CREATE|COMMENT ON) FUNCTION public\\.(?:${escaped}|"${escaped}")\\(`).test(block);
      })).join("");
    const extensions = (await client.query(`select
      case when n.nspname='pg_catalog' then '' else format('CREATE SCHEMA IF NOT EXISTS %I; ',n.nspname) end ||
      format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;',e.extname,n.nspname) ddl
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname<>'plpgsql' order by e.extname`)).rows.map((row) => row.ddl).join("\n");
    const triggers = (await client.query(SCHEMA_QUERIES.authTriggers)).rows.map((row) => row.definition + ";").join("\n");
    const policies = (await client.query(`select format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',policyname,schemaname,tablename,permissive,cmd,
      array_to_string(array(select quote_ident(r::text) from unnest(roles) r),','),
      case when qual is null then '' else ' USING ('||qual||')' end,
      case when with_check is null then '' else ' WITH CHECK ('||with_check||')' end) ddl
      from pg_policies where schemaname in ('storage','realtime') order by schemaname,tablename,policyname`)).rows.map((row) => row.ddl).join("\n");
    const realtime = (await client.query(SCHEMA_QUERIES.realtime)).rows.map((row) => {
      if (row.prattrs !== null || row.row_filter) throw new Error("Realtime com filtros exige exportacao especifica.");
      return `ALTER PUBLICATION ${quote(row.pubname)} ADD TABLE public.${quote(row.relname)};`;
    }).join("\n");
    const permissions = await permissionSQL(client);
    const defaults = (await client.query(`select format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON %s TO %s%s;',a.privilege_type,
      case d.defaclobjtype when 'r' then 'TABLES' when 'S' then 'SEQUENCES' when 'f' then 'FUNCTIONS' end,
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
      case when a.is_grantable then ' WITH GRANT OPTION' else '' end) ddl
      from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
      where n.nspname='public' and d.defaclrole='postgres'::regrole and d.defaclobjtype in ('r','S','f')`)).rows.map((row) => row.ddl).join("\n");
    const resetDefaults = ["TABLES", "SEQUENCES", "FUNCTIONS"].map((kind) => `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon, authenticated, service_role;`).join("\n");
    const sql = `${extensions}\n${resetDefaults}\n${base.replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;')}\nSET search_path = public;\n${triggers}\n${policies}\n${realtime}\n${permissions}\n${defaults}\n`;
    const baseData: Model["baseData"] = {};
    for (const [table, columns] of Object.entries(BASE_COLUMNS)) {
      baseData[table] = (await client.query(`select ${columns.map(quote).join(",")} from public.${quote(table)} order by ${baseOrder(table)}`)).rows;
    }
    const model: Model = {
      format: 1, generatedAt: new Date().toISOString(), sourceRef: source.projectRef, sqlHash: hash(sql),
      packageHash: "", baseData,
      migrations, schema: await schemaHashes(client),
      buckets: (await client.query("select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id")).rows,
    };
    model.packageHash = packageHash(model);
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, "estrutura.sql"), sql);
    fs.writeFileSync(path.join(packageDirectory, "manifesto.json"), JSON.stringify(model, null, 2) + "\n");
    console.log(`Pacote atual exportado: ${migrations.length} migrations, ${model.buckets.length} buckets e ${Object.keys(baseData).length} catalogos tecnicos. Sem registros comerciais.`);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

export function readModel(directory = packageDirectory) {
  const model: Model = JSON.parse(fs.readFileSync(path.join(directory, "manifesto.json"), "utf8"));
  const sql = fs.readFileSync(path.join(directory, "estrutura.sql"), "utf8");
  if (model.format !== 1 || model.sqlHash !== hash(sql) || model.packageHash !== packageHash(model)) throw new Error("Pacote alterado/invalido. Exporte novamente.");
  return { model, sql };
}

export async function ensureBuckets(model: Model, apply: boolean) {
  const { apiUrl, serviceKey } = readTarget();
  const storage = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const result = await storage.listBuckets();
  if (result.error) throw new Error(result.error.message);
  const missing: Bucket[] = [];
  for (const bucket of model.buckets) {
    const existing = result.data.find((item) => item.id === bucket.id);
    if (bucket.name !== bucket.id) throw new Error(`Bucket ${bucket.id} tem nome diferente do ID.`);
    if (!existing) { missing.push(bucket); continue; }
    if (existing.name !== bucket.name || existing.public !== bucket.public ||
        (existing.file_size_limit ?? null) !== (bucket.file_size_limit === null ? null : Number(bucket.file_size_limit)) ||
        JSON.stringify(existing.allowed_mime_types ?? null) !== JSON.stringify(bucket.allowed_mime_types)) {
      throw new Error(`Bucket ${bucket.id} existente diverge do modelo. Nao sera sobrescrito.`);
    }
  }
  for (const bucket of missing) {
    console.log(`${apply ? "Criando" : "Criaria"} bucket: ${bucket.id}`);
    if (apply) {
      const created = await storage.createBucket(bucket.id, {
        public: bucket.public, fileSizeLimit: bucket.file_size_limit === null ? undefined : Number(bucket.file_size_limit),
        allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
      });
      if (created.error) throw new Error(`Bucket ${bucket.id}: ${created.error.message}. Reexecute para retomar.`);
    }
  }
  if (!apply && missing.length) console.log(`${missing.length} buckets ausentes.`);
  return missing.length;
}

export async function installModel(apply: boolean) {
  const target = readTarget();
  const { model, sql } = readModel();
  const localVersions = new Set(readLocalMigrations().map((item) => item.version));
  if (model.migrations.length !== localVersions.size || model.migrations.some((item) => !localVersions.has(item.version))) {
    throw new Error("Pacote desatualizado em relacao as migrations locais. Exporte o modelo atual novamente.");
  }
  if (target.database.projectRef === model.sourceRef) throw new Error("Origem e destino iguais.");
  const { client } = await connectDatabase(target.database);
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(87099,1)");
    const markerExists = (await client.query("select to_regclass('supabase_migrations.erp_provisionamento') marker")).rows[0].marker;
    const marker = markerExists ? (await client.query("select pacote_hash from supabase_migrations.erp_provisionamento where id=1")).rows[0] : null;
    if (marker && marker.pacote_hash !== model.packageHash) throw new Error("Banco provisionado com outro pacote. Use migrations para atualiza-lo.");
    if (!marker) {
      if (target.registered) throw new Error("Banco cadastrado: importacao inicial recusada.");
      const occupied = (await client.query(`select
        (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f')) objects,
        (select count(*) from auth.users) users,
        (select count(*) from storage.objects) files,
        to_regclass('supabase_migrations.schema_migrations') history`)).rows[0];
      if (Number(occupied.objects) || Number(occupied.users) || Number(occupied.files) || occupied.history) {
        throw new Error("Destino nao esta vazio (tabelas, usuarios, arquivos ou historico). Importacao recusada.");
      }
      console.log(`Destino vazio conferido: ${target.database.label} (${target.database.projectRef}).`);
      if (apply) {
        await client.query(sql);
        await verifySchema(client, model);
        await client.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
        await client.query("CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text UNIQUE,rollback text[])");
        await client.query("INSERT INTO supabase_migrations.schema_migrations(version,name) SELECT version,name FROM jsonb_to_recordset($1::jsonb) h(version text,name text)", [JSON.stringify(model.migrations)]);
        await insertBase(client, model, true);
        await client.query("CREATE TABLE supabase_migrations.erp_provisionamento(id integer PRIMARY KEY CHECK(id=1),pacote_hash text NOT NULL,origem_ref text NOT NULL,criado_em timestamptz NOT NULL DEFAULT now())");
        await client.query("INSERT INTO supabase_migrations.erp_provisionamento(id,pacote_hash,origem_ref) VALUES(1,$1,$2)", [model.packageHash, model.sourceRef]);
      }
    } else {
      await verifySchema(client, model);
      console.log("Estrutura ja instalada com este pacote; retomando os buckets.");
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
  await ensureBuckets(model, apply);
  if (apply) {
    await ensureBuckets(model, false);
    console.log("Estrutura, permissoes, historico e buckets provisionados. Configure os dados iniciais e execute auditar.");
  } else console.log("Conferencia concluida. Use --aplicar para instalar no destino indicado.");
}

export async function auditTarget() {
  const { database } = readTarget();
  const { model } = readModel();
  const { client } = await connectDatabase(database);
  try {
    await verifySchema(client, model);
    const history = (await client.query("select version,name from supabase_migrations.schema_migrations order by version")).rows;
    if (JSON.stringify(history) !== JSON.stringify(model.migrations)) throw new Error("Historico difere do pacote.");
    for (const table of ["permissao", "perfil", "usuario", "empresa", "config_geral", "tipos_ajuste_transacao", "planosdecontagrupos", "planosdeconta", "dre_template", "dre_linha", "unidademedida", "fiscal_ncm", "fiscal_nfe_cst_ibscbs", "fiscal_nfe_classificacao_tributaria"]) {
      const exists = (await client.query("select to_regclass($1) relation", [`public.${table}`])).rows[0].relation;
      if (!exists) continue;
      const count = (await client.query(`select count(*)::int total from public.${quote(table)}`)).rows[0].total;
      console.log(`${table}: ${count}${count === 0 ? " — PENDENTE: cadastrar dados iniciais" : ""}`);
    }
  } finally { await client.end(); }
  if (await ensureBuckets(model, false)) throw new Error("Buckets ainda ausentes.");
  console.log("Infraestrutura conferida. Auth, SMTP, dados iniciais e testes do ERP exigem validacao do roteiro.");
}

export async function insertBase(client: Connection, model: Model, apply: boolean) {
  // Confere todas as tabelas antes de escrever; somente vazio ou copia identica.
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(BASE_COLUMNS)) {
    const rows = (await client.query(`select ${columns.map(quote).join(",")} from public.${quote(table)} order by ${baseOrder(table)}`)).rows;
    const expected = model.baseData[table];
    if (!Array.isArray(expected)) throw new Error(`Catalogo ${table} ausente no pacote.`);
    if (!expected.length && !rows.length) {
      console.log(`Catalogo ${table} vazio na origem; preparar separadamente.`);
      continue;
    }
    if (rows.length === 0) missing.push(table);
    else if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error(`Catalogo ${table} ja tem dados diferentes. Nao sera sobrescrito.`);
  }
  for (const table of missing) {
    const columns = BASE_COLUMNS[table];
    const expected = model.baseData[table];
    console.log(`${apply ? "Inicializando" : "Inicializaria"} ${table}: ${expected.length} registros tecnicos.`);
    if (!apply) continue;
    await client.query(`insert into public.${quote(table)} (${columns.map(quote).join(",")}) overriding system value
      select ${columns.map(quote).join(",")} from jsonb_populate_recordset(null::public.${quote(table)},$1::jsonb)`, [JSON.stringify(expected)]);
    if (columns.includes("id")) {
      const sequence = (await client.query("select pg_get_serial_sequence($1,'id') seq", [`public.${table}`])).rows[0].seq;
      if (sequence) await client.query("select setval($1::regclass,$2,true)", [sequence, Math.max(...expected.map((row) => Number(row.id)))]);
    }
  }
}

export async function seedTarget(apply: boolean) {
  const { database } = readTarget();
  const { model } = readModel();
  const { client } = await connectDatabase(database);
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(87099,1)");
    await verifySchema(client, model);
    await insertBase(client, model, apply);
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(apply ? "Catalogos tecnicos conferidos/inicializados." : "Conferencia dos catalogos concluida. Use --aplicar.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

export async function registerTarget(apply: boolean) {
  const target = readTarget();
  const versions = readLocalMigrations().map((item) => item.version);
  const modelVersions = readModel().model.migrations.map((item) => item.version);
  if (JSON.stringify(versions) !== JSON.stringify(modelVersions)) throw new Error("Pacote desatualizado; conclua a atualizacao antes de cadastrar o banco.");
  await auditTarget();
  const entries: Omit<DatabaseConfig, "url">[] = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  if (target.registered) { console.log("Banco ja cadastrado no fluxo de migrations."); return; }
  if (!apply) { console.log(`Cadastraria ${target.database.label} como ${target.database.envName}. Use --aplicar.`); return; }
  const envFile = path.join(projectRoot, ".env.migrations.local");
  const env = parseSimpleEnv(envFile);
  if (env.has(target.database.envName) && env.get(target.database.envName) !== target.database.url) {
    throw new Error("Variavel de banco ja existe com outra URL. Cadastro recusado.");
  }
  if (!env.has(target.database.envName)) {
    const previous = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    fs.writeFileSync(envFile, `${previous.trimEnd()}\n${target.database.envName}=${target.database.url}\n`);
  }
  const { url: _url, ...definition } = target.database;
  entries.push(definition);
  fs.writeFileSync(registryFile, JSON.stringify(entries, null, 2) + "\n");
  console.log(`${target.database.label} incluido nos comandos gerais de migrations. Credencial salva somente no arquivo local ignorado pelo Git.`);
}
