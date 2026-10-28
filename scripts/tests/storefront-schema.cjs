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
      const sql = fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/,'').replace('create extension if not exists pgcrypto;', '');
      try { await db.exec(sql); } catch (error) { throw new Error(`${name}: ${error.message}`); }
    }
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='venda'")).rows.map(r => r.column_name);
    for (const name of ['status_entrega','nfe_numero','nfe_chave_acesso','danfe_url','separacao_em','entregue_em']) assert.ok(columns.includes(name), name);
    const tables = (await db.query("select tablename from pg_tables where schemaname='public'")).rows.map(r => r.tablename);
    for (const name of ['cliente','cliente_endereco','produto','favorito','venda','vendaproduto','customer_payment_card','order_fulfillment_event','site_order_refund_request']) assert.ok(tables.includes(name), name);
    for(const name of ['store_shipping_connection','store_shipping_oauth_state']){
      assert.ok(tables.includes(name));
      const access=(await db.query("select has_table_privilege('anon',$1,'select') as anon_read,has_table_privilege('authenticated',$1,'update') as client_write",[name])).rows[0];
      assert.equal(access.anon_read,false);assert.equal(access.client_write,false);
    }
    for (const name of ['veiculo_compatibilidade','produto_compatibilidade']) assert.ok(!tables.includes(name), `${name} must remain deferred`);
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
    const attempt='10000000-0000-4000-8000-000000000001';
    const hash='a'.repeat(64);
    const start=async(key=attempt,customer=1)=>db.query(`select fn_start_checkout($1,$2,$3,'PIX','{}','[{"produtoid":101,"quantidade":1,"sub_total":125,"valor_total":125}]',125,125,'PIX') as result`,[key,customer,hash]);
    const legacyPending=Number((await db.query(`select fn_criar_pedido_site(1,'{}','[{"produtoid":101,"quantidade":1,"sub_total":125,"valor_total":125}]',125,125) as id`)).rows[0].id);
    assert.equal((await db.query('select fn_checkout_cutover_status() as state')).rows[0].state.pending,1);
    await assert.rejects(start(),/CHECKOUT_CUTOVER_PENDING/,'new reservations must not race unreserved legacy payable orders');
    await db.query("update venda set status='CANCELADO' where id=$1",[legacyPending]);
    const created=(await start()).rows[0].result;
    assert.equal(created.started,true);
    const centralId=Number(created.orderId);
    assert.equal((await db.query('select id from venda where id=$1',[centralId])).rows.length,0,'starting checkout must not create an order');
    assert.equal((await start()).rows[0].result.started,false);
    assert.equal(Number((await start('10000000-0000-4000-8000-000000000002')).rows[0].result.orderId),centralId,'two tabs with same cart must resume the same order');
    await assert.rejects(start(attempt,2),/ATTEMPT_CONFLICT/);
    await db.query("select fn_checkout_sending($1,'cus_alice')",[centralId]);
    await assert.rejects(db.query("select fn_checkout_sending($1,'cus_alice')",[centralId]),/NOT_SENDABLE/);
    await assert.rejects(db.query("select fn_checkout_bind($1,'pay_central','cus_bob',125,'PIX','2026-10-24',null,'PENDING')",[centralId]),/PAYMENT_ORDER_MISMATCH/);
    await db.query("select fn_checkout_bind($1,'pay_central','cus_alice',125,'PIX','2026-10-24',null,'PENDING')",[centralId]);
    assert.equal((await db.query('select id from venda where id=$1',[centralId])).rows.length,0,'an unpaid charge must remain an internal attempt');
    await db.query("select fn_checkout_bind($1,'pay_central','cus_alice',125,'PIX','2026-10-24',null,'CONFIRMED')",[centralId]);
    await db.query("select fn_checkout_bind($1,'pay_central','cus_alice',125,'PIX','2026-10-24',null,'CONFIRMED')",[centralId]);
    assert.equal((await db.query('select id from venda where id=$1',[centralId])).rows.length,1,'confirmed payment creates exactly one order');
    assert.equal((await db.query('select * from vendaproduto where venda_id=$1',[centralId])).rows.length,1,'order items are materialized once');
    await db.query("select fn_checkout_bind($1,'pay_central','cus_alice',125,'PIX','2026-10-24',null,'PENDING')",[centralId]);
    const beforeCentral=Number((await db.query('select estoque from produto where id=101')).rows[0].estoque);
    await db.query("select fn_processar_evento_pagamento_asaas('evt_central','PAYMENT_RECEIVED','pay_central',$1,'RECEIVED','PAGO','PIX')",[centralId]);
    assert.equal(Number((await db.query('select estoque from produto where id=101')).rows[0].estoque),beforeCentral,'central order must never debit the storefront snapshot');
    await assert.rejects(db.query("select fn_checkout_cancel_bound($1,'pay_central')",[centralId]),/CANCELLATION_CONFLICT/);
    await db.query("update checkout_attempt set phase='DONE' where order_id=$1",[centralId]);
    const abandoned=Number((await start('10000000-0000-4000-8000-000000000003')).rows[0].result.orderId);
    await db.query("update checkout_attempt set created_at=now()-interval '21 minutes' where order_id=$1",[abandoned]);
    assert.equal((await db.query('select fn_checkout_abandon($1) as done',[abandoned])).rows[0].done,true);
    assert.equal((await db.query('select id from venda where id=$1',[abandoned])).rows.length,0,'abandoned checkout does not leave a cancelled order');
    await assert.rejects(db.query("select fn_checkout_sending($1,'cus_alice')",[abandoned]),/NOT_SENDABLE/);
    const uncertain=Number((await start('10000000-0000-4000-8000-000000000004')).rows[0].result.orderId);
    await db.query("select fn_checkout_sending($1,'cus_alice')",[uncertain]);
    assert.equal((await db.query('select fn_checkout_fail($1,false) as released',[uncertain])).rows[0].released,false,'timeout cannot release a possibly charged order');
    assert.equal((await db.query('select phase from checkout_attempt where order_id=$1',[uncertain])).rows[0].phase,'REVIEW');
    assert.equal((await db.query('select id from venda where id=$1',[uncertain])).rows.length,0,'an ambiguous payment attempt is not a customer order');
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${bob}';`);
    assert.equal((await db.query('select * from venda')).rows.length, 0);
    assert.equal((await db.query('select * from cliente_endereco')).rows.length, 1);
    assert.equal((await db.query('select * from favorito')).rows.length, 1);
    assert.equal((await db.query('select * from produto')).rows.length, 1);
    await db.exec('reset role');
    console.log('PASS: cadeia completa, checkout idempotente entre abas, exclusão de cobrança concorrente, fencing de abandono, timeout sem liberação, pagamento sem dupla baixa, legado e RLS.');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
