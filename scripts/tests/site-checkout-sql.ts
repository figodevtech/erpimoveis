import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {connectDatabase,loadDatabaseConfigs} from '../db/lib';

async function main() {
 const config=loadDatabaseConfigs().find(c=>c.key==='brpecas')!;
 const {client:a}=await connectDatabase(config);
 const {client:b}=await connectDatabase(config);
 const schema=`site_checkout_test_${randomUUID().replaceAll('-','')}`;
 assert.match(schema,/^site_checkout_test_[a-f0-9]{32}$/);
 try {
  await a.query(`create schema ${schema}`);
  for(const client of [a,b])await client.query(`set search_path=${schema},public`);
  await a.query(`create table ${schema}.empresa(id integer primary key);
   insert into ${schema}.empresa values(1);
   create table ${schema}.produto(id integer primary key,estoque integer not null,preco numeric not null default 10);
   create view ${schema}.site_catalog_export as select 1 empresa_id,id produto_id,estoque,preco,true visible from ${schema}.produto;
   create table ${schema}.site_order_link(empresa_id integer,site_order_id bigint);
   create table ${schema}.vendaproduto_baixa(venda_id integer,produtoid integer,quantidade integer,created_at timestamptz,updated_at timestamptz,unique(venda_id,produtoid));
   create table ${schema}.estoque_movimento(id serial primary key,produto_id integer,sentido text,origem text constraint estoque_movimento_origem_check check(origem in ('ENTRADA','SAIDA_MANUAL','VENDA','ORDEM_SERVICO','NAO_IDENTIFICADA')),acao text,quantidade integer,saldo_anterior integer,saldo_resultante integer,entrada_id bigint,saida_id bigint,venda_id integer,ordemservicoid integer,documento_label text,created_by uuid);
   create table ${schema}.test_sales(id serial primary key,payload jsonb);
   create function ${schema}.fn_baixa_estoque_produto(p_id integer,p_qty integer) returns void language plpgsql as $$begin
    perform 1 from ${schema}.produto where id=p_id for update;
    update ${schema}.produto set estoque=estoque-p_qty where id=p_id and estoque>=p_qty;
    if not found then raise exception 'INSUFFICIENT_STOCK';end if;end$$;
   create function ${schema}.estoque_definir_contexto(o text,d bigint,l text,u uuid) returns void language plpgsql as $$begin
    perform set_config('app.estoque_origem',o,true);perform set_config('app.estoque_documento_id',d::text,true);perform set_config('app.estoque_documento_label',l,true);end$$;
   create function ${schema}.fn_importar_pedido_site(e integer,p jsonb) returns integer language plpgsql as $$declare id integer;i jsonb;begin
    insert into ${schema}.test_sales(payload)values(p)returning test_sales.id into id;
    for i in select * from jsonb_array_elements(p->'items') loop
     if coalesce((i->>'baixarEstoque')::boolean,true)then perform ${schema}.fn_baixa_estoque_produto((i->>'produtoId')::integer,(i->>'quantidade')::integer);end if;
    end loop;return id;end$$;`);
  const trigger=fs.readFileSync('supabase/migrations/20260805180000_razao_movimento_estoque.sql','utf8').match(/CREATE OR REPLACE FUNCTION public\.tg_estoque_movimento_registrar\(\)[\s\S]*?\$\$;/)![0].replaceAll('public',schema);
  await a.query(trigger);
  await a.query(`create trigger stock_test after update of estoque on ${schema}.produto for each row execute function ${schema}.tg_estoque_movimento_registrar()`);
  const migration=fs.readFileSync('supabase/migrations/20261021210000_site_checkout_inventory.sql','utf8').replaceAll('public.',`${schema}.`).replaceAll('search_path=public',`search_path=${schema}`);
  await a.query(migration);
  await a.query(`insert into ${schema}.produto(id,estoque)values(1,1),(2,0),(3,5),(4,3)`);
  const reserve=(client:any,id:number,items:any[])=>client.query(`select ${schema}.fn_site_checkout_reserve(1,$1,$2)`,[id,JSON.stringify(items)]);
  const item=(id:number,quantity=1)=>({productId:id,quantity,unitPrice:10});
  const race=await Promise.allSettled([reserve(a,101,[item(1)]),reserve(b,102,[item(1)])]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1,'only one checkout can reserve the last unit');
  const stock=async(id:number)=>Number((await a.query(`select estoque from ${schema}.produto where id=$1`,[id])).rows[0].estoque);
  assert.equal(await stock(1),0);
  await assert.rejects(reserve(a,103,[item(3),item(2)]),/INSUFFICIENT_STOCK/);
  assert.equal(await stock(3),5,'whole basket must roll back');
  const result=await Promise.all([reserve(a,104,[item(3,2)]),reserve(b,104,[item(3,2)])]);
  assert.equal(result.length,2);assert.equal(await stock(3),3,'retry must not debit twice');
  await assert.rejects(reserve(a,104,[item(3,1)]),/CHECKOUT_CLOSED/);
  await a.query(`select ${schema}.fn_site_checkout_release(1,104,'test')`);
  await a.query(`select ${schema}.fn_site_checkout_release(1,104,'test duplicate')`);
  assert.equal(await stock(3),5,'cancel returns the reservation exactly once');
  await assert.rejects(reserve(a,104,[item(3,2)]),/CHECKOUT_CLOSED/);
  await a.query(`select ${schema}.fn_site_checkout_release(1,105,'cancel before reservation arrived')`);
  await assert.rejects(reserve(a,105,[item(3)]),/CHECKOUT_CLOSED/);
  await reserve(a,106,[item(4,2)]);
  const order={id:106,status:'PAGO',gatewayPaymentId:'pay_test',centralInventory:true,items:[{produtoId:4,quantidade:2,valorTotal:20}]};
  await a.query(`select ${schema}.fn_confirmar_checkout_site(1,$1)`,[order]);
  await a.query(`select ${schema}.fn_confirmar_checkout_site(1,$1)`,[order]);
  assert.equal(await stock(4),1,'paid import must not debit the reserved quantity again');
  assert.equal(Number((await a.query(`select count(*) from ${schema}.test_sales`)).rows[0].count),1);
  assert.equal(Number((await a.query(`select quantidade from ${schema}.vendaproduto_baixa`)).rows[0].quantidade),2);
  await assert.rejects(a.query(`select ${schema}.fn_site_checkout_release(1,106,'wrong release')`),/RETURN_WORKFLOW/);
  assert.equal((await a.query(`select ${schema}.fn_site_checkout_refund_before_import(1,106) released`)).rows[0].released,false);
  assert.equal(await stock(4),1,'refund of imported sale must use the physical return workflow');
  await reserve(a,107,[item(3)]);
  assert.equal((await a.query(`select ${schema}.fn_site_checkout_refund_before_import(1,107) released`)).rows[0].released,true);
  await a.query(`select ${schema}.fn_site_checkout_refund_before_import(1,107)`);
  assert.equal(await stock(3),5,'refund before import restores the reservation once');
  const origins=(await a.query(`select distinct origem from ${schema}.estoque_movimento`)).rows;
  assert.deepEqual(origins,[{origem:'PEDIDO_ONLINE'}]);
  await assert.rejects(a.query(`select ${schema}.fn_confirmar_checkout_site(1,$1)`,[{...order,id:999}]),/MISSING_ERP_RESERVATION/);
  console.log('PASS: concurrent last unit, atomic basket rollback, idempotent reserve/release, cancellation fencing, single paid sale, no double debit, stock ledger origin.');
 } finally {
  await a.query('rollback').catch(()=>{});
  await a.query(`drop schema if exists ${schema} cascade`);
  await Promise.all([a.end(),b.end()]);
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
