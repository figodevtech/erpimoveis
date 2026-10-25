// Local-only backup/recovery for the authorized ERP drift cleanup. No credentials in artifacts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type pg from 'pg';
import {SCHEMA_QUERIES,normalizeFunction,normalizeConstraint} from './lib';
const tables=['veiculo_compatibilidade','produto_compatibilidade','payment_webhook_event','store_payment_config'];
const columns=['enviado_em','estoque_baixado','faturado_em','gateway_checkout_url','gateway_due_date','gateway_payment_id','gateway_status','payment_provider','transportadora','url_rastreio'];
const signatures=['public.fn_criar_pedido_site(bigint,jsonb,jsonb,numeric,numeric,text,text)','public.fn_baixar_estoque_venda(bigint)','public.fn_estornar_estoque_venda(bigint)'];
const ident=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
async function schema(client:pg.Client){
 const result:Record<string,pg.QueryResultRow[]>={};
 for(const [category,query] of Object.entries(SCHEMA_QUERIES)) result[category]=(await client.query(query)).rows;
 return result;
}
export async function saveBackup(client:pg.Client,dir:string){
 await client.query('begin isolation level repeatable read read only');
 await client.query("set local statement_timeout='15s';set local idle_in_transaction_session_timeout='30s'");
 try{
 const snapshot=await schema(client);
 const data:Record<string,string>={};
 for(const table of tables)data[table]=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from public.${ident(table)} t`)).rows[0].data;
 const venda=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from (select id,${columns.map(ident).join(',')} from public.venda) t`)).rows[0].data;
 const funcs=(await client.query('select pg_get_functiondef(p.oid) definition,p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner from pg_proc p where p.oid=any($1::regprocedure[])',[signatures])).rows;
 const grants=(await client.query(`select c.relname object,case when c.relkind='S' then 'SEQUENCE' else 'TABLE' end kind,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end grantee,a.privilege_type,a.is_grantable from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a where c.relnamespace='public'::regnamespace and (c.relname=any($1::text[]) or c.relname=any($2::text[]))`,[tables,tables.map(t=>t+'_id_seq')])).rows;
 const funcGrants=(await client.query(`select p.oid::regprocedure::text object,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end grantee,a.privilege_type,a.is_grantable from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=any($1::regprocedure[])`,[signatures])).rows;
 const sequences=[];
 for(const s of snapshot.sequences.filter(s=>tables.some(t=>s.sequencename===t+'_id_seq')))sequences.push({...s,...(await client.query(`select last_value::text,is_called from public.${ident(s.sequencename)}`)).rows[0]});
 const restore:string[]=['-- Manual recovery of ERP extras only.','begin;'];
 const seqOptions=(s:pg.QueryResultRow)=>`increment by ${s.increment_by} minvalue ${s.min_value} maxvalue ${s.max_value} start with ${s.start_value} cache ${s.cache_size} ${s.cycle?'cycle':'no cycle'}`;
 for(const table of tables){
 const cols=snapshot.columns.filter(c=>c.table_name===table);
 if(cols.some(c=>c.attgenerated))throw Error('Unexpected generated column; review backup.');
 restore.push(`create table public.${ident(table)} (${cols.map(c=>`${ident(c.attname)} ${c.type}${c.attidentity?` generated ${c.attidentity==='a'?'always':'by default'} as identity (${seqOptions(sequences.find(s=>s.sequencename===table+'_'+c.attname+'_seq')!)})`:c.default_expr?' default '+c.default_expr:''}${c.attnotnull?' not null':''}`).join(',')});`);
 restore.push(`insert into public.${ident(table)} overriding system value select * from jsonb_populate_recordset(null::public.${ident(table)},${literal(data[table])}::jsonb);`);
 }
 for(const table of tables)for(const c of snapshot.constraints.filter(c=>c.table_name===table))restore.push(`alter table public.${ident(table)} add constraint ${ident(c.conname)} ${c.definition};`);
 const constraintIndexes=(await client.query('select indexrelid::regclass::text name from pg_index where indexrelid in(select conindid from pg_constraint) and indrelid=any($1::regclass[])',[tables.map(t=>'public.'+t)])).rows.map(r=>r.name.replace(/^public\./,''));
 for(const i of snapshot.indexes.filter(i=>tables.includes(i.tablename)&&!constraintIndexes.includes(i.indexname)))restore.push(i.indexdef+';');
 for(const c of snapshot.columns.filter(c=>c.table_name==='venda'&&columns.includes(c.attname)))restore.push(`alter table public.venda add column ${ident(c.attname)} ${c.type}${c.default_expr?' default '+c.default_expr:''}${c.attnotnull?' not null':''};`);
 restore.push(`update public.venda v set ${columns.map(c=>`${ident(c)}=b.${ident(c)}`).join(',')} from jsonb_populate_recordset(null::public.venda,${literal(venda)}::jsonb) b where v.id=b.id;`);
 for(const f of funcs)restore.push(f.definition+';',`alter function ${f.signature} owner to ${ident(f.owner)};`,`revoke all on function ${f.signature} from public,anon,authenticated,service_role;`);
 for(const g of funcGrants)restore.push(`grant ${g.privilege_type} on function ${g.object} to ${g.grantee}${g.is_grantable?' with grant option':''};`);
 for(const r of snapshot.relations.filter(r=>tables.includes(r.relname)||sequences.some(s=>s.sequencename===r.relname))){
 const kind=r.relkind==='S'?'sequence':'table';
 restore.push(`alter ${kind} public.${ident(r.relname)} owner to ${ident(r.owner)};`,`revoke all on ${kind} public.${ident(r.relname)} from public,anon,authenticated,service_role;`);
 if(r.relrowsecurity)restore.push(`alter table public.${ident(r.relname)} enable row level security;`);
 if(r.relforcerowsecurity)restore.push(`alter table public.${ident(r.relname)} force row level security;`);
 }
 for(const g of grants)restore.push(`grant ${g.privilege_type} on ${g.kind} public.${ident(g.object)} to ${g.grantee}${g.is_grantable?' with grant option':''};`);
 for(const s of sequences)restore.push(`select setval(${literal('public.'+s.sequencename)},${s.last_value},${s.is_called});`);
 restore.push('commit;');
 const files:Record<string,string>={'schema-before.json':JSON.stringify(snapshot,null,2),'extra-tables-data.json':JSON.stringify(data,null,2),'venda-extra-columns.json':venda,'restore-extras.sql':restore.join('\n'),'extra-definitions.json':JSON.stringify({funcs,grants,funcGrants,sequences},null,2)};
 fs.mkdirSync(dir,{recursive:true});
 for(const [file,contents] of Object.entries(files))fs.writeFileSync(path.join(dir,file),contents,{flag:'wx'});
 const counts=Object.fromEntries(Object.entries(data).map(([table,json])=>[table,JSON.parse(json).length]));
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({project:'ufomohkhyyekflykqejc',createdAt:new Date().toISOString(),counts,files:Object.fromEntries(Object.entries(files).map(([file,contents])=>[file,digest(contents)]))},null,2),{flag:'wx'});
 console.log('Read-only backup saved outside Git:',dir,counts);
 }finally{await client.query('rollback');}
}
export function verifyBackup(dir:string){
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.project!=='ufomohkhyyekflykqejc')throw Error('Wrong backup target.');
 for(const [file,hash] of Object.entries(manifest.files))if(digest(fs.readFileSync(path.join(dir,file),'utf8'))!==hash)throw Error('Backup integrity check failed.');
}
export async function assertBackupStillCurrent(client:pg.Client,dir:string){
 // Locks are bounded by the caller's lock_timeout; no production rows are modified.
 await client.query(`lock table ${tables.map(t=>'public.'+ident(t)).join(',')},public.venda in access exclusive mode`);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'extra-tables-data.json'),'utf8'));
 for(const table of tables){
 const current=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from public.${ident(table)} t`)).rows[0].data;
 if(current!==saved[table])throw Error('Extra data changed since backup; aborting: '+table);
 }
 const current=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from (select id,${columns.map(ident).join(',')} from public.venda) t`)).rows[0].data;
 if(current!==fs.readFileSync(path.join(dir,'venda-extra-columns.json'),'utf8'))throw Error('Extra sale data changed since backup; aborting.');
}
export async function rehearseRecovery(client:pg.Client,dir:string){
 const restore=fs.readFileSync(path.join(dir,'restore-extras.sql'),'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 await client.query(restore);
 const before=JSON.parse(fs.readFileSync(path.join(dir,'schema-before.json'),'utf8'));
 const after=await schema(client);
 for(const category of Object.keys(after)){
 const norm=(rows:pg.QueryResultRow[])=>JSON.stringify(rows.map(r=>category==='functions'?{...r,prosrc:normalizeFunction(r.prosrc)}:category==='constraints'?{...r,definition:normalizeConstraint(r.definition)}:r));
 if(norm(before[category])!==norm(after[category]))throw Error('Recovery schema mismatch: '+category);
 }
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'extra-tables-data.json'),'utf8'));
 for(const table of tables){const data=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text data from public.${ident(table)} t`)).rows[0].data;if(data!==saved[table])throw Error('Recovery data mismatch: '+table);}
 console.log('Recovery rehearsal passed: definitions, permissions and extra data; transaction will roll back.');
}
