import fs from 'node:fs';
import path from 'node:path';
import {saveBackup,verifyBackup,rehearseRecovery,assertBackupStillCurrent} from './storefront-drift-backup';
import {connectDatabase,loadDatabaseConfigs,SCHEMA_QUERIES,normalizeFunction,normalizeConstraint} from './lib';
const migration='supabase/migrations/20261023140000_cleanup_storefront_objects_from_erp.sql';
const version='20261023140000';
const sql=fs.readFileSync(migration,'utf8').replace(/^begin;/i,'').replace(/commit;\s*$/i,'');
const backupDir='artifacts/db/backups/br-erp-storefront-drift-20261023';
const apply=process.argv.includes('--apply'),backup=process.argv.includes('--backup');
async function main(){
 const configs=loadDatabaseConfigs();
 if(configs.length!==6||!configs.some(c=>c.key==='brpecas'&&c.projectRef==='ufomohkhyyekflykqejc'))throw Error('Unexpected ERP targets.');
 if(backup){
  const {client}=await connectDatabase(configs.find(c=>c.key==='brpecas')!);
  try{
   if(fs.existsSync(path.join(backupDir,'manifest.json')))throw Error('Backup already exists; preserve it.');
   await saveBackup(client,backupDir);
  }finally{await client.end();}
  return;
 }
 verifyBackup(backupDir);
 let baseline:Record<string,string>|null=null;
 for(const config of configs){
  const {client}=await connectDatabase(config);
  try{
   await client.query('begin');
   await client.query("set local lock_timeout='2s';set local statement_timeout='15s';set local idle_in_transaction_session_timeout='30s'");
   await client.query("select pg_advisory_xact_lock(hashtext('supabase_migrations.schema_migrations'))");
   if(config.key==='brpecas')await assertBackupStillCurrent(client,backupDir);
   const preservedQuery="select coalesce(jsonb_agg(to_jsonb(v)-array['enviado_em','estoque_baixado','faturado_em','gateway_checkout_url','gateway_due_date','gateway_payment_id','gateway_status','payment_provider','transportadora','url_rastreio'] order by id),'[]'::jsonb)::text data from public.venda v";
   const before=(await client.query(preservedQuery)).rows[0].data;
   await client.query(sql);
   const schema:Record<string,string>={};
   for(const [category,query] of Object.entries(SCHEMA_QUERIES)){
    const rows=(await client.query(query)).rows.map(row=>category==='functions'?{...row,prosrc:normalizeFunction(row.prosrc)}:category==='constraints'?{...row,definition:normalizeConstraint(row.definition)}:row);
    schema[category]=JSON.stringify(rows);
   }
   if(baseline)for(const category of Object.keys(schema))if(schema[category]!==baseline[category])throw Error(`Schema still differs: ${config.label} ${category}`);
   baseline??=schema;
   if(before!==(await client.query(preservedQuery)).rows[0].data)throw Error('Sale data changed; rolling back.');
   if(!apply&&config.key==='brpecas')await rehearseRecovery(client,backupDir);
   if(apply){
    await client.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3) on conflict(version) do nothing',[version,'cleanup_storefront_objects_from_erp',[sql]]);
    await client.query('commit');await client.query("notify pgrst,'reload schema'");
   }else await client.query('rollback');
   console.log(config.label,apply?'applied + recorded':'dry-run passed; schema matches baseline; rolled back');
  }catch(error){await client.query('rollback');throw error;}finally{await client.end();}
 }
}
main().catch(error=>{console.error(String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,'[URL]'));process.exitCode=1;});
