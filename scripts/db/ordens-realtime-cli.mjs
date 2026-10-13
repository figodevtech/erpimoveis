import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
const root = path.resolve(import.meta.dirname, "../..");
export const raw = await fs.readFile(path.join(root,'.env'),'utf8');
export const databases = [...raw.matchAll(/^\s*(?:#\s*)?DATABASE_URL\s*=\s*([^\r\n]+)/gm)].map(m=>m[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
const names = {ozluphhwktyvqfrypjin:'Demonstração',lkpwaiynvnfedvxcjmrp:'Demir',qwvyhtjqjjicjbfiwjfm:'Garage Premium'};
const cli = path.join(root,'node_modules/supabase/bin/supabase.exe');
const temp = process.env.TEMP || process.env.TMP;
export function clean(s) { for(const url of databases){const u = new URL(url); for(const secret of [url,u.password,decodeURIComponent(u.password)])if(secret)s=s.replaceAll(secret,'[redacted]');} return s; }
export async function query(url, sql) {
 const result = await new Promise(resolve=>execFile(cli,['db','query',sql,'--db-url',url,'--output','json'],{cwd:temp,windowsHide:true,timeout:45000,maxBuffer:8*1024*1024},(err,stdout,stderr)=>resolve({err,stdout,stderr})));
 if(result.err) throw new Error(clean(result.stderr || result.err.message));
 const start=result.stdout.indexOf('{');const end=result.stdout.lastIndexOf('}');
 const output=JSON.parse(result.stdout.slice(start,end+1));return output.rows;
}
export function label(url) {return names[new URL(url).hostname.split('.')[1]] || new URL(url).hostname;}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.argv[2]){const sql=await fs.readFile(process.argv[2],'utf8');for(const url of databases.filter(url=>!process.argv[3]||label(url)===process.argv[3])){console.log(JSON.stringify({database:label(url),rows:await query(url,sql)}));}}

export async function migrate(url, file) {
 const dir=await fs.mkdtemp(path.join(temp,'ordens-migration-'));
 await fs.mkdir(path.join(dir,'supabase/migrations'),{recursive:true});
 const history=await query(url,'select version from supabase_migrations.schema_migrations order by version');
 const local=await fs.readdir(path.join(root,'supabase/migrations'));
 for(const row of history){const match=local.find(name=>name.startsWith(row.version+'_') && name.endsWith('.sql'));if(!match)throw new Error('Migration remota sem arquivo local: '+row.version);await fs.copyFile(path.join(root,'supabase/migrations',match),path.join(dir,'supabase/migrations',match));}
 await fs.copyFile(path.resolve(root,file),path.join(dir,'supabase/migrations',path.basename(file)));
 const result=await new Promise(resolve=>execFile(cli,['migration','up','--db-url',url,'--yes'],{cwd:dir,windowsHide:true,timeout:45000,maxBuffer:4*1024*1024},(err,stdout,stderr)=>resolve({err,stdout,stderr})));
 if(result.err) throw new Error(clean(result.stderr || result.err.message));
 return clean(result.stdout+'\n'+result.stderr);
}

export async function advisors(url) {
 const result=await new Promise(resolve=>execFile(cli,['db','advisors','--db-url',url,'--type','security','--level','error','--output','json'],{cwd:temp,windowsHide:true,timeout:45000,maxBuffer:8*1024*1024},(err,stdout,stderr)=>resolve({err,stdout,stderr})));
 if(result.err)throw new Error(clean(result.stderr||result.err.message));
 return clean(result.stdout+result.stderr);
}
