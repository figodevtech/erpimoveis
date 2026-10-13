import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {raw,label,clean} from './ordens-realtime-cli.mjs';
import {createOrdensRealtimeConnection} from '../../src/lib/ordens/realtime-client.ts';

const configs=[];let current;
for(const line of raw.split(/\r?\n/)){const m=line.match(/^\s*(?:#\s*)?([A-Z_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;const value=m[2].replace(/^(['"])(.*)\1$/,'$2');if(m[1]==='NEXT_PUBLIC_SUPABASE_URL')current={url:value};else if(current&&m[1]==='NEXT_PUBLIC_SUPABASE_ANON_KEY')current.anon=value;else if(current&&m[1]==='SUPABASE_SERVICE_ROLE_KEY')current.service=value;else if(current&&m[1]==='DATABASE_URL'){current.db=value;configs.push(current);}}
const wait=async(check,name,timeout=15000)=>{const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw new Error('Timeout: '+name);await new Promise(r=>setTimeout(r,40));}};
const subscribe=channel=>new Promise(resolve=>{const timer=setTimeout(()=>resolve('LOCAL_TIMEOUT'),15000);channel.subscribe(status=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);resolve(status);}});});

async function run(config){
 assert.ok(config.anon&&config.service&&config.db,'Credenciais incompletas');
 const client=new pg.Client({connectionString:config.db,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000,statement_timeout:10000});
 const userClients=[];const connections=[];
 try{
  await client.connect();
  const tenant=Number((await client.query('select min(id) as id from public.empresa')).rows[0].id);
  // Credenciais de servidor já existentes; nenhum usuário ou privilégio é criado.
  // A autorização de usuários é validada separadamente em ordens_realtime.sql.
  const credentials={userId:'00000000-0000-4000-8000-000000000000',tenantId:tenant,topic:'ordens:tenant:'+tenant,token:config.service,expiresAt:new Date(Date.now()+600000).toISOString()};
  const received=[[],[]];let joins=[0,0];
  for(let i=0;i<2;i++){
   connections.push(createOrdensRealtimeConnection({fetchCredentials:async()=>credentials,createClient:accessToken=>{const socket=createClient(config.url,config.anon,{accessToken:async()=>config.anon,realtime:{accessToken}});userClients.push(socket); if(process.env.ORDENS_REALTIME_DEBUG)socket.channel(credentials.topic,{config:{private:true}}).on('broadcast',{event:'*'},({event,payload})=>console.log('wire',event,Object.keys(payload??{}),payload?.table,payload?.payload?.table));return socket;},onChange:table=>{if(table)received[i].push(table);else joins[i]++;}}));
  }
  await wait(()=>joins.every(count=>count>0),'join das duas telas');
  // Tabelas temporárias usam o gatilho real e não alteram OS da oficina.
  for(const table of ['ordemservico','osservico','osservico_realizador']){
   await client.query('create temporary table '+table+'(id integer,status text)');
   await client.query('create trigger smoke_changed after insert or update or delete on pg_temp.'+table+' for each statement execute function public.ordens_realtime_emit()');
  }
  async function emit(sql,params,table){const before=received.map(events=>events.filter(item=>item===table).length);await client.query(sql,params);await wait(()=>received.every((events,i)=>events.filter(item=>item===table).length>before[i]),table+' nas duas telas');}
  await emit('insert into pg_temp.ordemservico values(1,$1)',['ORCAMENTO'],'ordemservico');
  const statuses=(await client.query('select unnest(enum_range(null::public.enum_status_os))::text as status')).rows;
  for(const {status} of statuses)await emit('update pg_temp.ordemservico set status=$1 where id=1',[status],'ordemservico');
  await emit('insert into pg_temp.osservico values(1,null)',[],'osservico');
  await emit('insert into pg_temp.osservico_realizador values(1,null)',[],'osservico_realizador');
  const oldJoins=joins[0];connections[0].reconnect();await wait(()=>joins[0]>oldJoins,'reconexão');
  await emit('delete from pg_temp.ordemservico',[],'ordemservico');
  console.log(label(config.db)+': '+statuses.length+' status recebidos em duas conexões de servidor; serviços e reconexão validados');
 }finally{
  connections.forEach(c=>c.dispose());
  for(const socket of userClients)await socket.removeAllChannels().catch(()=>{});
  await client.end().catch(()=>{});
 }
}
try{for(const config of configs.filter(c=>!process.argv[2]||label(c.db)===process.argv[2]))await run(config);}catch(error){console.error(clean(error?.message||String(error)));process.exitCode=1;}
