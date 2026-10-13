import fs from 'node:fs/promises';
import pg from 'pg';
import { databases,label } from './ordens-realtime-cli.mjs';
const body=(await fs.readFile(process.argv[2],'utf8')).replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
const tests=(await fs.readFile('supabase/tests/ordens_realtime.sql','utf8')).replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'');
for(const url of [...databases].sort((a,b)=>(label(a)==='Demonstração'?-1:label(b)==='Demonstração'?1:0))){const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000,statement_timeout:30000});try{await client.connect();await client.query('BEGIN');await client.query(body);await client.query(tests);await client.query('ROLLBACK');console.log(label(url)+': migration e todos os status validados; ROLLBACK concluído');}finally{await client.end();}}
