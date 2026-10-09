const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table venda(id bigint primary key);insert into venda values(1);
   create table site_order_refund_request(order_id bigint primary key references venda(id),payment_id text,reason text,created_at timestamptz,denied_at timestamptz,denial_reason text);
   insert into site_order_refund_request values(1,'pay_test','old request','2026-10-06T12:00:00Z','2026-10-06T12:01:00Z','denied');`);
  await db.exec(fs.readFileSync('site_demirdiesel/supabase/migrations/20261008_retry_denied_refund.sql','utf8'));
  const retry=async(payment='pay_test',date='2026-10-06T12:01:00Z',reason='Retry test')=>(await db.query('select fn_reabrir_estorno_recusado_site($1,$2,$3,$4) as accepted',[1,payment,date,reason])).rows[0].accepted;
  assert.equal(await retry('pay_other'),false);
  assert.equal(await retry('pay_test','2026-10-06T12:02:00Z'),false);
  await assert.rejects(retry('pay_test','2026-10-06T12:01:00Z','x'));
  assert.equal(await retry(),true);
  assert.equal(await retry(),false,'same denial can only be reopened once');
  const history=(await db.query('select * from site_order_refund_attempt_history')).rows;
  assert.equal(history.length,1);assert.equal(history[0].reason,'old request');assert.equal(history[0].denial_reason,'denied');
  const claim=(await db.query('select * from site_order_refund_request')).rows[0];
  assert.equal(claim.denied_at,null);assert.equal(claim.denial_reason,null);assert.equal(claim.reason,'Retry test');
  console.log('PASS: retry payment/date binding, invalid reason rejected, one retry per denial, archived history and reset denial.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
