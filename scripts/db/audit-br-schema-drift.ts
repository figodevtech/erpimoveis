// Read-only object-level comparison; never reads business/customer records.
import {connectDatabase,loadDatabaseConfigs,SCHEMA_QUERIES,normalizeFunction,normalizeConstraint} from './lib';
const keys=['demo','brpecas'];
async function inspect(key:string){
 const config=loadDatabaseConfigs().find(c=>c.key===key)!;
 const {client}=await connectDatabase(config);
 try{
  await client.query('begin read only');
  const data:Record<string,any[]>={};
  for(const category of ['relations','columns','constraints','indexes','sequences','functions']){
   const result=await client.query(SCHEMA_QUERIES[category]);
   data[category]=result.rows.map(row=>category==='functions'?{...row,prosrc:normalizeFunction(row.prosrc)}:category==='constraints'?{...row,definition:normalizeConstraint(row.definition)}:row);
  }
  await client.query('rollback');return data;
 }finally{await client.end();}
}
async function main(){
 const [demo,br]=await Promise.all(keys.map(inspect));
 const identity=(category:string,row:any)=>category==='functions'?`${row.proname}(${row.args})`:category==='columns'?`${row.table_name}.${row.attname}`:category==='constraints'?`${row.table_name}.${row.conname}`:category==='indexes'?row.indexname:category==='sequences'?row.sequencename:row.relname;
 for(const category of Object.keys(demo)){
  const a=new Map(demo[category].map(row=>[identity(category,row),row]));
  const b=new Map(br[category].map(row=>[identity(category,row),row]));
  const extra=[...b.keys()].filter(k=>!a.has(k));
  const missing=[...a.keys()].filter(k=>!b.has(k));
  const changed=[...a.keys()].filter(k=>b.has(k)&&JSON.stringify(a.get(k))!==JSON.stringify(b.get(k))).map(k=>({object:k,fields:Object.keys(a.get(k)).filter(f=>JSON.stringify(a.get(k)[f])!==JSON.stringify(b.get(k)[f]))}));
  console.log(JSON.stringify({category,extra,missing,changed},null,2));
 }
 const config=loadDatabaseConfigs().find(c=>c.key==='brpecas')!;
 const {client}=await connectDatabase(config);
 try{
  await client.query('begin read only');
  for(const table of ['payment_webhook_event','produto_compatibilidade','store_payment_config','veiculo_compatibilidade']){
   const rows=await client.query(`select count(*)::int count from public.${table}`);
   console.log({extraTable:table,records:rows.rows[0].count});
  }
  const extras=br.columns.filter(row=>row.table_name==='venda'&&!demo.columns.some(base=>base.table_name===row.table_name&&base.attname===row.attname));
  for(const column of extras){
   const result=await client.query(`select count(*)::int count from public.venda where "${column.attname}" is not null`);
   console.log({extraColumn:`venda.${column.attname}`,nonNullRows:result.rows[0].count,default:column.default_expr});
  }
  const dependencies=await client.query(`select c.relname,pg_get_viewdef(c.oid,true) definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and (pg_get_viewdef(c.oid,true) ilike '%payment_webhook_event%' or pg_get_viewdef(c.oid,true) ilike '%store_payment_config%' or pg_get_viewdef(c.oid,true) ilike '%produto_compatibilidade%' or pg_get_viewdef(c.oid,true) ilike '%veiculo_compatibilidade%')`);
  console.log({dependentPublicViews:dependencies.rows.map(row=>row.relname)});
  await client.query('rollback');
 }finally{await client.end();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
