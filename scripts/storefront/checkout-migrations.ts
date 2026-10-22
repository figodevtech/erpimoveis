import fs from 'node:fs';
import {connectDatabase,loadDatabaseConfigs,parseSimpleEnv,type DatabaseConfig} from '../db/lib';

const apply=process.argv.includes('--apply');
const selected=process.argv.filter(a=>a.startsWith('--target=')).map(a=>a.slice(9));
const rootMigration='supabase/migrations/20261021210000_site_checkout_inventory.sql';
// Preserve the immutable experiment + compensating rollback in chronological
// order. Replaying that older experiment after the new payment guard would fail.
const storeMigrations=['supabase/migrations/20261021171000_central_stock_checkout.sql','supabase/migrations/20261021181000_revert_central_stock_checkout.sql','supabase/migrations/20261021211000_checkout_attempts.sql','supabase/migrations/20261021212000_checkout_event_retry.sql','supabase/migrations/20261021213000_checkout_cutover_guard.sql','supabase/migrations/20261022090000_checkout_order_after_payment.sql'];
export function storeConfig(site:string):DatabaseConfig {
 const values=new Map([...parseSimpleEnv(`${site}/.env`),...parseSimpleEnv(`${site}/.env.migrations`),...parseSimpleEnv(`${site}/.env.migrations.local`)]);
 const url=values.get('DATABASE_URL')||values.get('MIGRATIONS_DATABASE_URL');
 const projectRef=site==='site_brpecaspb'?'omicuflzwpajzainwboq':'ohlylsxvvughgedgcimg';
 if(!url)throw new Error(`Configure a conexão de migrations de ${site}.`);
 const parsed=new URL(url);
 if(!(parsed.hostname===`db.${projectRef}.supabase.co` || (parsed.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(parsed.username)===`postgres.${projectRef}`)))throw new Error(`Projeto inesperado para ${site}.`);
 return {key:site,label:site,projectRef,envName:'DATABASE_URL',url,poolerHosts:['aws-0-us-east-1.pooler.supabase.com','aws-1-sa-east-1.pooler.supabase.com','aws-0-sa-east-1.pooler.supabase.com','aws-1-us-east-1.pooler.supabase.com','aws-1-us-west-2.pooler.supabase.com']};
}
async function run() {
 const targets=[...loadDatabaseConfigs().filter(c=>['brpecas','demir'].includes(c.key)).map(config=>({config,file:rootMigration})),...['site_brpecaspb','site_demirdiesel'].flatMap(site=>storeMigrations.map(file=>({config:storeConfig(site),file:`${site}/${file}`})))].filter(t=>!selected.length||selected.includes(t.config.key));
 if(!targets.length)throw new Error('Nenhum alvo autorizado selecionado.');
 for(const {config,file} of targets) {
  const {client}=await connectDatabase(config);
  try {
   const store=config.key.startsWith('site_');
   if(!store) {
    const {rows}=await client.query("select id,coalesce(to_jsonb(empresa)->>'razaosocial',to_jsonb(empresa)->>'nomefantasia','') name from empresa");
    if(rows.length!==1||Number(rows[0].id)!==1)throw new Error(`Empresa ambígua: ${config.key}.`);
    console.log(config.key,'empresa validada',rows[0].name);
   }
   const version=file.split('/').at(-1)!.split('_')[0];
   const history=await client.query('select version from supabase_migrations.schema_migrations where version=$1',[version]);
   const routines=await client.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any($1::text[])`,[store?['fn_criar_pedido_site','fn_processar_evento_pagamento_asaas_sem_devolucao']:['fn_importar_pedido_site','fn_baixa_estoque_produto','tg_estoque_movimento_registrar']]);
   if(routines.rows.length<(store?2:3))throw new Error(`Pré-requisitos ausentes: ${config.key}.`);
   console.log(config.key,{project:config.projectRef,version,applied:!!history.rowCount,mode:apply?'apply':'inspect'});
   if(history.rowCount) {
    if(!store) {
      const probe=await client.query('select public.fn_site_checkout_available(1,array[]::integer[]) as result');
      if(JSON.stringify(probe.rows[0].result)!=='[]')throw new Error('Consulta de disponibilidade inválida.');
      const {rows}=await client.query("select has_function_privilege('anon','public.fn_site_checkout_reserve(integer,bigint,jsonb)','execute') as anon,has_function_privilege('authenticated','public.fn_site_checkout_reserve(integer,bigint,jsonb)','execute') as authenticated");
      if(rows[0].anon||rows[0].authenticated)throw new Error('Função de estoque exposta a usuários públicos.');
      console.log(config.key,'disponibilidade e isolamento das funções verificados.');
    }
    continue;
   }
   if(!apply)continue;
   const sql=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').replace(/^\s*begin\s*;/i,'').replace(/commit\s*;\s*$/i,'');
   await client.query('begin');
   try {
    await client.query("set local lock_timeout='5s'; set local statement_timeout='60s'");
    await client.query("select pg_advisory_xact_lock(hashtext('supabase_migrations.schema_migrations'))");
    const exists=await client.query('select version from supabase_migrations.schema_migrations where version=$1',[version]);
    if(exists.rowCount){await client.query('commit');continue;}
    await client.query(sql);
    await client.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)',[version,file.split('/').at(-1)!.replace(/^\d+_/,'').replace(/\.sql$/,''),[sql]]);
    await client.query('commit');
    await client.query("notify pgrst,'reload schema'");
    console.log(config.key,'migration aplicada; nenhum pedido, cobrança ou saldo existente alterado.');
   }catch(error){await client.query('rollback');throw error;}
  }finally{await client.end();}
 }
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/checkout-migrations.ts'))run().catch(error=>{console.error(String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,'[URL]'));process.exitCode=1;});
