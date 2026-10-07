const assert=require('node:assert/strict');const fs=require('node:fs');
const {PGlite}=require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');
(async()=>{const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
create table telegram_usuario_preferencia(usuario_id uuid primary key,chat_id bigint,ativo boolean,notificar_marketplace boolean,marketplace_topicos_selecionados text[]);
create table system_notification(id bigint primary key,usuario_id uuid,category text,source text,telegram_sent_at timestamptz,telegram_attempts int default 0,telegram_next_retry_at timestamptz,telegram_locked_at timestamptz,source_event_id text,metadata jsonb default '{}',created_at timestamptz default now(),title text,message text,href text);
insert into telegram_usuario_preferencia values('00000000-0000-0000-0000-000000000001',1,true,true,null),('00000000-0000-0000-0000-000000000002',2,true,false,null);`);
await db.exec(fs.readFileSync('supabase/migrations/20261007120000_telegram_site_independent_preference.sql','utf8'));
assert.equal((await db.query('select notificar_site from telegram_usuario_preferencia where chat_id=1')).rows[0].notificar_site,true);
await db.exec(`update telegram_usuario_preferencia set notificar_site=false where chat_id=1;update telegram_usuario_preferencia set notificar_site=true,marketplace_topicos_selecionados='{}' where chat_id=2;
insert into system_notification(id,usuario_id,category,source,source_event_id) values
(1,'00000000-0000-0000-0000-000000000001','MARKETPLACE','MERCADOLIVRE_WEBHOOK','ml1'),
(2,'00000000-0000-0000-0000-000000000001','MARKETPLACE','SITE_ORDER','site1'),
(3,'00000000-0000-0000-0000-000000000002','MARKETPLACE','MERCADOLIVRE_WEBHOOK','ml2'),
(4,'00000000-0000-0000-0000-000000000002','MARKETPLACE','SITE_ORDER','site2');`);
const rows=(await db.query('select * from fn_reservar_notificacoes_marketplace_telegram(50,null)')).rows;
assert.deepEqual(rows.map(x=>Number(x.notification_id)).sort(),[1,4]);await db.close();console.log('PASS: legacy preferences preserved; Mercado Livre-only and Site-only recipients receive only their enabled source.');})().catch(e=>{console.error(e);process.exitCode=1});
