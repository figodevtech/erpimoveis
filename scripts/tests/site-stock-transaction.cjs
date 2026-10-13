const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`create table venda(id bigint primary key,status text,payment_provider text,gateway_payment_id text,
    estoque_baixado boolean,status_entrega text,enviado_em timestamptz,entregue_em timestamptz,
    forma_pagamento text,gateway_status text,updatedat timestamptz);
    create table produto(id bigint primary key,estoque integer,updatedat timestamptz);
    create table vendaproduto(venda_id bigint,produtoid bigint,quantidade integer);
    create table payment_webhook_event(id bigserial primary key,provider text,event_id text,event_type text,
    payment_id text,venda_id bigint,gateway_status text,resulting_order_status text,unique(provider,event_id));
    insert into produto values(1,1,null),(2,0,null);
    insert into venda(id,status,payment_provider,gateway_payment_id,estoque_baixado,status_entrega)
      values(1,'PENDENTE','ASAAS','pay_1',false,'SEPARACAO'),(2,'PENDENTE','ASAAS','pay_2',false,'SEPARACAO');
    insert into vendaproduto values(1,1,1),(1,2,1),(2,1,1);`);
  await db.exec(fs.readFileSync('site_demirdiesel/supabase/migrations/20261007090000_refund_physical_stock_guard.sql','utf8'));
  const processEvent = (event,id,gateway,status) => db.query('select fn_processar_evento_pagamento_asaas($1,$2,$3,$4,$5,$6,$7) as result',[event,'TEST',`pay_${id}`,id,gateway,status,'PIX']);
  await assert.rejects(processEvent('insufficient',1,'RECEIVED','PAGO'),/Estoque insuficiente/);
  assert.equal((await db.query('select estoque from produto where id=1')).rows[0].estoque,1,'first item debit must roll back');
  assert.equal((await db.query('select count(*)::int as n from payment_webhook_event')).rows[0].n,0,'failed event must be retryable');
  await processEvent('paid',2,'RECEIVED','PAGO');
  await processEvent('paid-other-event',2,'CONFIRMED','PAGO');
  assert.equal((await db.query('select estoque from produto where id=1')).rows[0].estoque,0,'different paid event IDs must not double debit');
  await processEvent('pending-late',2,'PENDING','PENDENTE');
  assert.equal((await db.query('select status from venda where id=2')).rows[0].status,'PAGO');
  await processEvent('refund',2,'REFUNDED','CANCELADO');
  await processEvent('refund-other-event',2,'REFUNDED','CANCELADO');
  await processEvent('pending-after-refund',2,'PENDING','PENDENTE');
  assert.equal((await db.query('select estoque from produto where id=1')).rows[0].estoque,1,'different refund event IDs must not double restore');
  assert.equal((await db.query('select status from venda where id=2')).rows[0].status,'CANCELADO');
  await db.close();
  console.log('PASS: multi-item rollback, failed event rollback, different payment/refund event IDs and late pending events.');
})().catch(error => { console.error(error); process.exitCode = 1; });
