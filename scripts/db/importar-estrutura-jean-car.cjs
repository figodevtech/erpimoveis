const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
const apply = process.argv.includes('--aplicar');

async function main() {
  const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
  const lines = env.split(/\r?\n/);
  const start = lines.findIndex(line => /Jean\s*Car/i.test(line));
  if (start < 0) throw new Error('Bloco Jean Car ausente no .env.local.');
  let connection;
  let projectUrl;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#\s*vari[aá]veis de ambiente/i.test(line)) break;
    const match = line.match(/^\s*(?:#\s*)?(DATABASE_URL|NEXT_PUBLIC_SUPABASE_URL)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (match[1] === 'DATABASE_URL') connection = value;
    else projectUrl = value;
  }
  if (!connection || !projectUrl) throw new Error('Configure DATABASE_URL e NEXT_PUBLIC_SUPABASE_URL no bloco Jean Car.');
  const ref = new URL(projectUrl).hostname.split('.')[0];
  if (['ozluphhwktyvqfrypjin', 'lkpwaiynvnfedvxcjmrp', 'qwvyhtjqjjicjbfiwjfm'].includes(ref)) {
    throw new Error('O destino aponta para um banco existente. Importacao recusada.');
  }
  const url = new URL(connection);
  if (!(url.hostname === `db.${ref}.supabase.co` || url.hostname === `db.${ref}.supabase.com` || decodeURIComponent(url.username) === `postgres.${ref}`)) {
    throw new Error('DATABASE_URL nao corresponde ao projeto Supabase Jean Car.');
  }
  const client = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const result = await client.query("select count(*)::int as total from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f')");
    if (result.rows[0].total !== 0) throw new Error('O schema public ja possui tabelas ou views. Importacao recusada para preservar o banco.');
    console.log('Destino Jean Car conferido: schema public sem tabelas ou views.');
    if (!apply) {
      console.log('Para importar: node scripts/db/importar-estrutura-jean-car.cjs --aplicar');
      return;
    }
    const sql = fs.readFileSync(path.join(root, 'artifacts/db/jean-car-estrutura.sql'), 'utf8');
    if (/Type: TABLE DATA|^COPY .* FROM stdin;/m.test(sql)) throw new Error('Arquivo contem dados; importacao recusada.');
    console.log('Importando somente a estrutura...');
    await client.query(sql);
    const tables = await client.query("select count(*)::int as total from pg_tables where schemaname='public'");
    console.log(`Importacao concluida: ${tables.rows[0].total} tabelas no schema public.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[conexao ocultada]'));
  process.exitCode = 1;
});
