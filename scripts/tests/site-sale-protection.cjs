const assert = require('node:assert/strict');
const {PGlite} = require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create table venda(id integer primary key,status text,is_deleted boolean default false,valortotal numeric default 100);
 create table site_order_link(id bigint, venda_id integer, site_order_id bigint);
 create table vendaproduto(id integer,venda_id integer);
 create table transacao(id integer,vendaid integer);
 insert into venda(id,status) values(1,'FINALIZADA'),(2,'FINALIZADA');
 insert into site_order_link values(1,1,100);
 insert into vendaproduto values(1,1);
 insert into transacao values(1,1);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261006140000_site_sale_refund_protection.sql','utf8'));
 async function rejects(sql){await assert.rejects(db.exec(sql));}
 await db.exec(fs.readFileSync('supabase/migrations/20261006150000_fix_site_sale_guard_optional_deleted.sql','utf8'));
 await db.exec('alter table venda drop column is_deleted');
 await rejects('delete from venda where id=1');
 await rejects('delete from vendaproduto where venda_id=1');
 await rejects('delete from transacao where vendaid=1');
 await rejects('update transacao set id=10 where vendaid=1');
 await rejects('update vendaproduto set id=10 where venda_id=1');
 await rejects('update venda set valortotal=1 where id=1');
 await db.exec('insert into transacao values(2,2); update transacao set id=20 where vendaid=2');
 assert.equal((await db.query('select id from transacao where vendaid=2')).rows[0].id,20);
 await rejects("update venda set status='CANCELADA' where id=1");
 await rejects("update venda set status='ORCAMENTO' where id=1");

 await rejects('delete from site_order_link where venda_id=1');
 await rejects('update site_order_link set venda_id=null where venda_id=1');
 await db.exec("update site_order_link set refund_status='REFUNDED' where venda_id=1; update venda set status='CANCELADA' where id=1");
 await rejects('delete from venda where id=1');
 await db.exec('delete from venda where id=2');
 assert.equal((await db.query('select * from venda where id=2')).rows.length,0);
 await db.close();
 console.log('PASS: database blocks site sale/item/payment deletion, unlinking, status bypass and soft delete; confirmed refund permits cancellation; ordinary sales are unaffected.');
})().catch(e=>{console.error(e);process.exitCode=1});
