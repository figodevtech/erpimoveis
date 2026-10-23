// Read-only structural comparison of the two independent storefront databases.
import fs from 'node:fs';
import pg from 'pg';
import {SCHEMA_QUERIES,normalizeFunction,normalizeConstraint} from './lib';
async function inspect(site:string,ref:string){
 const raw=fs.readFileSync(`${site}/.env.migrations`,'utf8');
 const url=raw.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'');
 if(!url||!url.includes(ref))throw Error('Unexpected storefront database target: '+site);
 const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:8000});
 try{
 await client.connect();await client.query('begin isolation level repeatable read read only');
 await client.query("set local statement_timeout='15s';set local idle_in_transaction_session_timeout='30s'");
 const result:Record<string,pg.QueryResultRow[]>={};
 for(const [category,query] of Object.entries(SCHEMA_QUERIES))result[category]=(await client.query(query)).rows.map(row=>category==='functions'?{...row,prosrc:normalizeFunction(row.prosrc)}:category==='constraints'?{...row,definition:normalizeConstraint(row.definition)}:row);
 const ledger=await client.query("select to_regclass('supabase_migrations.schema_migrations')::text name");
 if(ledger.rows[0].name)result.migrations=(await client.query('select version from supabase_migrations.schema_migrations order by version')).rows;
 await client.query('rollback');return result;
 }finally{await client.end();}
}
const key=(category:string,row:pg.QueryResultRow)=>{
 const keys:Record<string,string[]>={relations:['relname'],columns:['table_name','attname'],constraints:['table_name','conname'],indexes:['tablename','indexname'],triggers:['table_name','tgname'],policies:['schemaname','tablename','policyname'],enums:['typname','posicao'],sequences:['sequencename'],realtime:['relname','pubname'],authTriggers:['tgname'],storageBuckets:['id'],extensions:['extname'],functions:['proname','args'],migrations:['version']};
 return keys[category].map(k=>row[k]).join('.');
};
async function main(){
 const results=await Promise.allSettled([inspect('site_demirdiesel','ohlylsxvvughgedgcimg'),inspect('site_brpecaspb','omicuflzwpajzainwboq')]);
 for(const r of results)if(r.status==='rejected')throw r.reason;
 const [demir,br]=results.map(r=>(r as PromiseFulfilledResult<Record<string,pg.QueryResultRow[]>>).value);
 let differences=0;
 for(const category of Object.keys(demir)){
 const a=new Map(demir[category].map(row=>[key(category,row),row]));
 const b=new Map((br[category]||[]).map(row=>[key(category,row),row]));
 const onlyDemir=[...a.keys()].filter(k=>!b.has(k));const onlyBR=[...b.keys()].filter(k=>!a.has(k));
 const changed=[...a.keys()].filter(k=>b.has(k)&&JSON.stringify(a.get(k))!==JSON.stringify(b.get(k))).map(k=>({object:k,fields:Object.keys(a.get(k)!).filter(f=>JSON.stringify(a.get(k)![f])!==JSON.stringify(b.get(k)![f]))}));
 const equal=!onlyDemir.length&&!onlyBR.length&&!changed.length;
 console.log(JSON.stringify({category,demir:a.size,br:b.size,equal,...(!equal?{onlyDemir,onlyBR,changed}:{})}));
 if(!equal)differences++;
 }
 console.log('Categories with differences:',differences);if(differences)process.exitCode=1;
}
main().catch(error=>{console.error(String(error.message).replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g,'[URL]'));process.exitCode=1;});
