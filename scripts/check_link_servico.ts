import pg from "pg";

const host = "aws-0-ca-central-1.pooler.supabase.com";
const port = "5432";
const pass = "cIb2XX8QEjne4nMI";
const ref = "qwvyhtjqjjicjbfiwjfm";

async function run() {
  const conn = `postgresql://postgres.${ref}:${pass}@${host}:${port}/postgres`;
  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();

    console.log("=== OSSERVICO FOR OS 14 ===");
    const osServ = await client.query(`
      SELECT *
      FROM osservico
      WHERE ordemservicoid = 14
    `);
    console.log(JSON.stringify(osServ.rows, null, 2));

    console.log("=== EVENTO FINANCEIRO 110 ===");
    const ev110 = await client.query(`
      SELECT *
      FROM eventos_financeiros
      WHERE id = 110
    `);
    console.log(JSON.stringify(ev110.rows, null, 2));

    console.log("=== EVENTOS DE RECEITA DE SERVICO PARA OS 14 ===");
    const evRecServ = await client.query(`
      SELECT *
      FROM eventos_financeiros
      WHERE ordemservicoid = 14 AND natureza = 'RECEITA' AND origem = 'SERVICO'
    `);
    console.log(JSON.stringify(evRecServ.rows, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
