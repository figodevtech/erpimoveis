const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`create table venda(id bigint primary key, status text, payment_provider text,
    gateway_payment_id text, estoque_baixado boolean, status_entrega text, enviado_em timestamptz,
    entregue_em timestamptz, forma_pagamento text, gateway_status text, updatedat timestamptz);
    create table produto(id bigint primary key, estoque integer, updatedat timestamptz);
    create table vendaproduto(venda_id bigint, produtoid bigint, quantidade integer);
    create table payment_webhook_event(id bigserial primary key, provider text, event_id text,
      event_type text, payment_id text, venda_id bigint, gateway_status text, resulting_order_status text,
      unique(provider,event_id));
    insert into produto values(1,10,null);`);
  await db.exec(fs.readFileSync('site_demirdiesel/supabase/migrations/20261007090000_refund_physical_stock_guard.sql','utf8'));
  for (const [id, delivery, gateway, expected] of [
    [1,'SEPARACAO','REFUNDED',11], [2,'ENVIADO','REFUNDED',11],
    [3,'ENTREGUE','REFUNDED',11], [4,'SEPARACAO','CHARGEBACK_REQUESTED',11],
  ]) {
    await db.query(`insert into venda(id,status,payment_provider,gateway_payment_id,estoque_baixado,status_entrega)
      values($1,'PAGO','ASAAS',$2,true,$3)`,[id,`pay_${id}`,delivery]);
    await db.query('insert into vendaproduto values($1,1,1)',[id]);
    const params=[`event_${id}`,'TEST',`pay_${id}`,id,gateway,gateway.startsWith('CHARGEBACK')?'PENDENTE':'CANCELADO','PIX'];
    await db.query('select fn_processar_evento_pagamento_asaas($1,$2,$3,$4,$5,$6,$7)',params);
    await db.query('select fn_processar_evento_pagamento_asaas($1,$2,$3,$4,$5,$6,$7)',params);
    assert.equal((await db.query('select estoque from produto where id=1')).rows[0].estoque,expected);
    assert.equal((await db.query('select estoque_baixado from venda where id=$1',[id])).rows[0].estoque_baixado,id!==1);
  }
  await db.exec(`create role anon; create role authenticated;
    create table site_order_link(venda_id bigint,refund_requested_at timestamptz,refund_status text);
    insert into site_order_link values(2,null,'REFUNDED'),(4,now(),'REFUND_REQUESTED');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261007130000_site_refund_delivery_guard.sql','utf8'));
  await assert.rejects(db.exec("update venda set status_entrega='SEPARACAO' where id=2"));
  await assert.rejects(db.exec("update venda set status='PAGO' where id=2; update venda set status='CANCELADO' where id=2"));
  await assert.rejects(db.exec("update venda set status_entrega='ENVIADO' where id=4"));
  await db.close();
  console.log('PASS: pre-shipment refund, duplicate events, shipped stock preservation, chargeback, ERP delivery guards.');
})().catch(error=>{console.error(error);process.exitCode=1});
