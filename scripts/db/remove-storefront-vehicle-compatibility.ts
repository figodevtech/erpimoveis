// Explicitly authorized removal; no business data changes. Backup precedes DDL.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {SCHEMA_QUERIES} from './lib';
const targets=[{site:'site_brpecaspb',ref:'omicuflzwpajzainwboq'},{site:'site_demirdiesel',ref:'ohlylsxvvughgedgcimg'}];
const tables=['veiculo_compatibilidade','produto_compatibilidade'];
const version='20261023150000';
const backupRoot='artifacts/db/backups/storefront-compatibility-20261023';
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const lit=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const unwrap=(s:string)=>s.replace(/^begin;\s*/i,'').replace(/commit;\s*$/i,'');
const backup=process.argv.includes('--backup'),apply=process.argv.includes('--apply');
async function main(){
 for(const target of targets){
 const raw=fs.readFileSync(`${target.site}/.env.migrations`,'utf8');
 const url=raw.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'');
 if(!url||!url.includes(target.ref))throw Error('Unexpected storefront target.');
 const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:8000});
 try{
 await c.connect();await c.query(backup?'begin isolation level repeatable read read only':'begin');
 await c.query("set local lock_timeout='2s';set local statement_timeout='15s';set local idle_in_transaction_session_timeout='30s'");
 const dir=path.join(backupRoot,target.site);
 if(backup){
 if(fs.existsSync(path.join(dir,'manifest.json')))throw Error('Backup already exists; preserve it.');
 const schema:Record<string,unknown[]>={};for(const [key,query] of Object.entries(SCHEMA_QUERIES))schema[key]=(await c.query(query)).rows;
 const data:Record<string,string>={},sequences:Record<string,unknown>={};
 for(const table of tables){
 const exists=(await c.query('select to_regclass($1)::text name',['public.'+table])).rows[0].name;
 if(exists){data[table]=(await c.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from public.${table} t`)).rows[0].data;sequences[table]=(await c.query(`select last_value::text,is_called from public.${table}_id_seq`)).rows[0];}
 }
 const ledger=(await c.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
 let restore=fs.readFileSync(`${target.site}/supabase/migrations/20261020120000_br_vehicle_compatibility.sql`,'utf8');
 restore='-- Recovery only; do not execute automatically.\nbegin;\n'+restore+'\n';
 for(const [table,json] of Object.entries(data)){
 restore+=`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${lit(json)}::jsonb);\n`;
 const sequence=sequences[table] as {last_value:string;is_called:boolean};restore+=`select setval('public.${table}_id_seq',${sequence.last_value},${sequence.is_called});\n`;
 }
 restore+='commit;\n';
 const files:Record<string,string>={'schema-before.json':JSON.stringify(schema,null,2),'compatibility-data.json':JSON.stringify(data,null,2),'migration-history-before.json':JSON.stringify(ledger,null,2),'restore-compatibility.sql':restore};
 fs.mkdirSync(dir,{recursive:true});for(const [file,value] of Object.entries(files))fs.writeFileSync(path.join(dir,file),value,{flag:'wx'});
 const counts=Object.fromEntries(Object.entries(data).map(([table,json])=>[table,JSON.parse(json).length]));
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({project:target.ref,createdAt:new Date().toISOString(),counts,files:Object.fromEntries(Object.entries(files).map(([file,value])=>[file,hash(value)]))},null,2),{flag:'wx'});
 await c.query('rollback');console.log(target.site,'read-only backup saved:',counts);continue;
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.project!==target.ref)throw Error('Backup target mismatch.');for(const [file,checksum] of Object.entries(manifest.files))if(hash(fs.readFileSync(path.join(dir,file),'utf8'))!==checksum)throw Error('Backup checksum mismatch.');
 await c.query("select pg_advisory_xact_lock(hashtext('supabase_migrations.schema_migrations'))");
 const history=new Set((await c.query('select version from supabase_migrations.schema_migrations')).rows.map(r=>r.version));
 const files=fs.readdirSync(`${target.site}/supabase/migrations`).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
 const pending=files.filter(f=>!history.has(f.split('_')[0]));
 if(!pending.some(f=>f.startsWith(version)))throw Error('Cleanup already applied or missing locally.');
 const allowed=new Set(['20261002160000','20261020120000',version]);
 if(pending.some(f=>!allowed.has(f.split('_')[0])))throw Error('Unrelated pending migration; aborting.');
 const existingData=JSON.parse(fs.readFileSync(path.join(dir,'compatibility-data.json'),'utf8'));
 if(Object.keys(existingData).length)await c.query(`lock table ${Object.keys(existingData).map(t=>'public.'+t).join(',')} in access exclusive mode`);
 for(const table of Object.keys(existingData)){const data=(await c.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from public.${table} t`)).rows[0].data;if(data!==existingData[table])throw Error('Compatibility data changed since backup; aborting.');}
 const business=async()=>{
 const names=(await c.query("select tablename from pg_tables where schemaname='public' and tablename<>all($1::text[]) order by tablename",[tables])).rows;
 const hashes:Record<string,string>={};for(const {tablename} of names)hashes[tablename]=(await c.query(`select md5(coalesce(string_agg(rowhash,'' order by rowhash),'')) hash from (select md5(to_jsonb(t)::text) rowhash from public."${tablename.replaceAll('"','""')}" t) x`)).rows[0].hash;
 return JSON.stringify(hashes);
 };
 const before=await business();
 for(const file of pending){
 const migrationSql=fs.readFileSync(`${target.site}/supabase/migrations/${file}`,'utf8');
 await c.query(unwrap(migrationSql));
 await c.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[file.split('_')[0],file.replace(/^\d+_|\.sql$/g,''),[migrationSql]]);
 }
 if(before!==await business())throw Error('Business data changed; rolling back.');
 const remaining=(await c.query("select to_regclass('public.produto_compatibilidade') p,to_regclass('public.veiculo_compatibilidade') v")).rows[0];if(remaining.p||remaining.v)throw Error('Compatibility tables still exist.');
 await c.query(apply?'commit':'rollback');console.log(target.site,apply?'cleanup applied; all business table hashes preserved':'dry-run passed; all business table hashes preserved; rolled back',pending);
 if(apply)await c.query("notify pgrst,'reload schema'");
 }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{await c.end();}
 }
}
main().catch(error=>{console.error(String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,'[URL]'));process.exitCode=1;});
