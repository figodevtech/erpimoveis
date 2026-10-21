const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    const directory = path.resolve(__dirname, '../../storefront-template/supabase/migrations');
    for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
      // UUID generation is built into this embedded PostgreSQL; pgcrypto extension is Supabase-owned.
      const sql = fs.readFileSync(path.join(directory, name), 'utf8').replace('create extension if not exists pgcrypto;', '');
      try { await db.exec(sql); } catch (error) { throw new Error(`${name}: ${error.message}`); }
    }
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='venda'")).rows.map(r => r.column_name);
    for (const name of ['status_entrega','nfe_numero','nfe_chave_acesso','danfe_url','separacao_em','entregue_em']) assert.ok(columns.includes(name), name);
    const tables = (await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(r => r.tablename);
    for (const name of ['cliente','cliente_endereco','produto','favorito','venda','vendaproduto','customer_payment_card','order_fulfillment_event','site_order_refund_request','veiculo_compatibilidade','produto_compatibilidade']) assert.ok(tables.includes(name), name);
    const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users values($1),($2)', [alice, bob]);
    await db.query(`insert into cliente(user_id,tipopessoa,cpfcnpj,nomerazaosocial,email,telefone)
      values($1,'FISICA','11111111111','Alice','alice@example.test','83999990000'),($2,'FISICA','22222222222','Bob','bob@example.test','83999990001')`, [alice,bob]);
    await db.exec(`insert into produto(id,titulo,precovenda,estoque,visible) values(101,'Peca',125,4,true),(102,'Oculta',10,2,false);
      insert into favorito(cliente_id,produto_id) values(1,101),(2,101);
      insert into cliente_endereco(cliente_id,cep,logradouro,numero,bairro,cidade,estado) values(1,'58000000','Rua A','1','Centro','Cabedelo','PB'),(2,'58000000','Rua B','2','Centro','Cabedelo','PB');`);
    const order = await db.query(`select fn_criar_pedido_site(1,'{}','[{"produtoid":101,"quantidade":1,"sub_total":125,"valor_total":125}]',125,125) as id`);
    const id = Number(order.rows[0].id);
    await db.query("update venda set gateway_payment_id='pay_test' where id=$1", [id]);
    await db.query("select fn_processar_evento_pagamento_asaas('evt_1','PAYMENT_RECEIVED','pay_test',$1,'RECEIVED','PAGO','PIX')", [id]);
    await db.query("select fn_processar_evento_pagamento_asaas('evt_1','PAYMENT_RECEIVED','pay_test',$1,'RECEIVED','PAGO','PIX')", [id]);
    assert.equal(Number((await db.query('select estoque from produto where id=101')).rows[0].estoque), 3);
    assert.equal((await db.query('select status_entrega from venda where id=$1', [id])).rows[0].status_entrega, 'SEPARACAO');
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${bob}';`);
    assert.equal((await db.query('select * from venda')).rows.length, 0);
    assert.equal((await db.query('select * from cliente_endereco')).rows.length, 1);
    assert.equal((await db.query('select * from favorito')).rows.length, 1);
    assert.equal((await db.query('select * from produto')).rows.length, 1);
    await db.exec('reset role');
    console.log('PASS: cadeia completa, pedido, pagamento idempotente, entrega e isolamento RLS entre clientes.');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
