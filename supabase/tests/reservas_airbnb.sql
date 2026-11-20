-- Reservas do Airbnb (20261120140000). Sempre revertido.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;
-- Mensagem do erro de uma chamada, ou NULL se ela passou.
CREATE OR REPLACE FUNCTION pg_temp.erro_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- Uma leitura do calendário com os eventos dados (como o sync faz).
CREATE OR REPLACE FUNCTION pg_temp.ler(p_cal bigint,p_url text,p_eventos jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE tk uuid:=gen_random_uuid();
BEGIN
 UPDATE public.imovel_canal_calendario SET ultima_tentativa=NULL,sincronizacao_ate=NULL WHERE id=p_cal;
 PERFORM public.imob_claim_calendario(p_cal,tk,true);
 RETURN public.imob_aplicar_calendario(p_cal,tk,p_url,p_eventos);
END $$;

DO $test$
DECLARE
  actor uuid; c integer; hospede integer; p bigint; i bigint; cal bigint; booking bigint; j jsonb; r bigint; r2 bigint; erro text;
  url text:='https://www.airbnb.com/calendar/ical/teste-airbnb.ics';
  d0 date:=current_date+400;
  ev_futura jsonb; ev_bloqueio jsonb; ev_passada jsonb; ev_andamento jsonb; ev_paga jsonb;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  PERFORM pg_temp.exigir(actor IS NOT NULL,'usuário ativo disponível para testar');
  PERFORM set_config('app.audit_user_id',actor::text,true);
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995140001'),'Hóspede teste Airbnb','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste Airbnb',pg_temp.cpf('995140002'),actor) RETURNING id INTO p;
  -- Mínimo de 5 noites no imóvel: a reserva do Airbnb (2 noites) passa mesmo assim.
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,min_noites,created_by)
    VALUES(p,'Imóvel teste Airbnb',gen_random_uuid()::text,ARRAY['TEMPORADA'],4,100,50,10,5,actor) RETURNING id INTO i;
  INSERT INTO public.imovel_canal_calendario(imovel_id,canal,calendario_url) VALUES(i,'AIRBNB',url) RETURNING id INTO cal;

  ev_futura:=jsonb_build_object('uid','res-1@airbnb.com','inicio',d0,'fim',d0+2,'tipo','RESERVA','codigo','hmtest12345');
  ev_bloqueio:=jsonb_build_object('uid','blk-1@airbnb.com','inicio',d0+10,'fim',d0+14,'tipo','BLOQUEIO');
  ev_passada:=jsonb_build_object('uid','old-1@airbnb.com','inicio',current_date-10,'fim',current_date-7,'tipo','RESERVA','codigo','HMPASSADA1');
  ev_andamento:=jsonb_build_object('uid','now-1@airbnb.com','inicio',current_date-1,'fim',current_date+2,'tipo','RESERVA','codigo','HMANDAMENTO1');

  -- 1) Leitura do calendário: tipo e código gravados; reservas que não terminaram cadastradas sozinhas.
  j:=pg_temp.ler(cal,url,jsonb_build_array(ev_futura,ev_bloqueio,ev_passada,ev_andamento,
    jsonb_build_object('uid','sem-tipo','inicio',d0+20,'fim',d0+21)));
  PERFORM pg_temp.exigir((j->>'reservas_criadas')::int=2 AND (j->>'reservas_com_falha')::int=0,'leitura cadastrou as 2 reservas que ainda não terminaram');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=cal AND calendario_uid='res-1@airbnb.com'
      AND calendario_tipo='RESERVA' AND calendario_codigo='HMTEST12345' AND motivo='Reserva Airbnb · HMTEST12345' AND tipo='BLOQUEIO' AND ativo),
    'reserva do Airbnb gravada com tipo e código (em maiúsculas)');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=cal AND calendario_uid='blk-1@airbnb.com'
      AND calendario_tipo='BLOQUEIO' AND calendario_codigo IS NULL AND motivo='Bloqueio Airbnb'),
    'bloqueio do Airbnb gravado como bloqueio');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=cal AND calendario_uid='sem-tipo'
      AND calendario_tipo IS NULL AND motivo='Reserva/bloqueio · Airbnb'),
    'evento sem tipo (versão anterior do leitor) continua aceito');
  hospede:=public.cliente_hospede_airbnb_id();
  SELECT id INTO r FROM public.reserva_imovel WHERE origem='AIRBNB' AND codigo_externo='HMTEST12345';
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r AND imovel_id=i AND cliente_id=hospede AND status='CONFIRMADA'
      AND inicio=d0 AND fim=d0+2 AND valor_total=0 AND hospedes=1 AND created_by IS NULL AND (cotacao_snapshot->>'registro_automatico')::boolean),
    'reserva cadastrada sozinha: Hóspede Airbnb, valores a informar, datas do Airbnb');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.cliente WHERE id=hospede AND codigo_sistema='hospede_airbnb' AND cpfcnpj IS NULL),
    'Hóspede Airbnb é cadastro do sistema sem documento');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.reserva_imovel WHERE codigo_externo='HMPASSADA1'),'reserva já terminada não é cadastrada sozinha');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE reserva_id=r),'a reserva do Airbnb não cria ocupação própria');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r),'a reserva do Airbnb nasce sem cobrança');
  erro:=pg_temp.erro_de(format('UPDATE public.cliente SET nomerazaosocial=%L WHERE id=%s','Outro nome',hospede));
  PERFORM pg_temp.exigir(erro LIKE 'O Hóspede Airbnb é um cadastro do sistema%','Hóspede Airbnb não pode ser alterado');

  -- 2) Nova leitura igual não duplica.
  j:=pg_temp.ler(cal,url,jsonb_build_array(ev_futura,ev_bloqueio,ev_passada,ev_andamento));
  PERFORM pg_temp.exigir((j->>'reservas_criadas')::int=0 AND (SELECT count(*) FROM public.reserva_imovel WHERE codigo_externo='HMTEST12345')=1,
    'leitura repetida não duplica a reserva');

  -- 3) Registro manual: duplicado, datas erradas, código desconhecido, sem código, sem operador.
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0,'fim',d0+2,'hospedes',2,'origem','AIRBNB','codigo_externo','HMTEST12345',
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE '%já está registrada no ERP%','a mesma reserva do Airbnb não é registrada duas vezes');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date-10,'fim',current_date-6,'hospedes',2,'origem','AIRBNB','codigo_externo','HMPASSADA1',
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE 'As datas precisam ser as do Airbnb%','datas diferentes das do Airbnb são recusadas');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0,'fim',d0+2,'hospedes',2,'origem','AIRBNB','codigo_externo','HMNAOEXISTE',
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE '%não está no calendário do Airbnb%','código fora do calendário do imóvel é recusado');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0,'fim',d0+2,'hospedes',2,'origem','AIRBNB',
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE 'Informe o código%','reserva do Airbnb sem código é recusada');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,NULL::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date-10,'fim',current_date-7,'hospedes',2,'origem','AIRBNB','codigo_externo','HMPASSADA1',
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid())));
  PERFORM pg_temp.exigir(erro IS NOT NULL,'reserva do Airbnb exige operador do ERP');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',hospede,'inicio',d0+30,'fim',d0+36,'hospedes',2,'origem','ERP','ignorar_regras',true,
      'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE 'Cliente ativo com documento%','reserva comum não aceita o Hóspede Airbnb');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0,'fim',d0+2,'hospedes',2,'origem','ERP','ignorar_regras',true,
      'valor_diarias',300,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE '%já está ocupado%','reserva comum continua barrada nas datas do Airbnb');
  -- Registro manual da que já terminou (o sync não cadastra): também com valores a informar.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',hospede,'inicio',current_date-10,'fim',current_date-7,'hospedes',2,
      'origem','AIRBNB','codigo_externo','HMPASSADA1','valor_diarias',0,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor);
  PERFORM pg_temp.exigir(j->>'origem'='AIRBNB' AND (j->>'valor_total')::numeric=0 AND jsonb_array_length(j->'cotacao_snapshot'->'regras_ignoradas')>0,
    'registro manual aceita valores a informar e anota as regras do ERP não atendidas');

  -- 4) Check-in exige os valores.
  erro:=pg_temp.erro_de(format('SELECT public.imob_acao_reserva(%s,%L,%L::jsonb,%L::uuid)',r,'CHECKIN','{}',actor));
  PERFORM pg_temp.exigir(erro LIKE 'Informe os valores da reserva do Airbnb%','check-in sem valores é recusado');

  -- 5) Completar: troca o Hóspede Airbnb pelo hóspede real e informa valores; depois, o cliente não muda mais.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0,'fim',d0+2,'hospedes',3,'origem','ERP',
      'codigo_externo','OUTRO123','valor_diarias',350,'taxa_limpeza',80),actor,r);
  PERFORM pg_temp.exigir(j->>'origem'='AIRBNB' AND j->>'codigo_externo'='HMTEST12345' AND (j->>'cliente_id')::int=c
      AND (j->>'valor_total')::numeric=430 AND (j->>'hospedes')::int=3,
    'completar troca o Hóspede Airbnb, mantém origem e código e grava os valores');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid,%s)',
    jsonb_build_object('imovel_id',i,'cliente_id',hospede,'inicio',d0,'fim',d0+2,'hospedes',3,'valor_diarias',350,'taxa_limpeza',80),actor,r));
  PERFORM pg_temp.exigir(erro LIKE 'Cliente da reserva é imutável%','com o hóspede real, o cliente não muda mais');

  -- 6) O hóspede mudou as datas no Airbnb (mesmo código, outro UID): a reserva acompanha sozinha.
  j:=pg_temp.ler(cal,url,jsonb_build_array(jsonb_build_object('uid','res-1b@airbnb.com','inicio',d0+1,'fim',d0+4,'tipo','RESERVA','codigo','HMTEST12345'),
    ev_bloqueio,ev_passada,ev_andamento));
  PERFORM pg_temp.exigir((j->>'reservas_atualizadas')::int=1 AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r AND inicio=d0+1 AND fim=d0+4 AND valor_total=430),
    'datas alteradas no Airbnb atualizam a reserva (valores ficam)');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid,%s)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0+1,'fim',d0+5,'hospedes',3,'valor_diarias',450,'taxa_limpeza',80),actor,r));
  PERFORM pg_temp.exigir(erro LIKE 'As datas precisam ser as do Airbnb%','edição não inventa datas fora do Airbnb');

  -- 7) No ERP, reserva do Airbnb não se cancela nem se exclui: o aviso manda fazer no Airbnb.
  erro:=pg_temp.erro_de(format('SELECT public.imob_acao_reserva(%s,%L,%L::jsonb,%L::uuid)',r,'CANCELAR',jsonb_build_object('motivo','Teste'),actor));
  PERFORM pg_temp.exigir(erro LIKE 'Reservas do Airbnb são canceladas no Airbnb%','cancelar no ERP é recusado com o aviso do Airbnb');
  erro:=pg_temp.erro_de(format('SELECT public.imob_excluir_reserva(%s,%L::uuid,true,true)',r,actor));
  PERFORM pg_temp.exigir(erro LIKE 'Reservas do Airbnb não podem ser excluídas%','excluir no ERP é recusado com o aviso do Airbnb');
  erro:=pg_temp.erro_de(format('DELETE FROM public.reserva_imovel WHERE id=%s',r));
  PERFORM pg_temp.exigir(erro LIKE 'Reservas do Airbnb não podem ser excluídas%','nem por SQL a reserva do Airbnb é apagada');
  erro:=pg_temp.erro_de(format('UPDATE public.reserva_imovel SET status=%L WHERE id=%s','CANCELADA',r));
  PERFORM pg_temp.exigir(erro LIKE 'Reservas do Airbnb são canceladas no Airbnb%','nem por SQL a reserva do Airbnb é cancelada');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r AND status='CONFIRMADA'),'a reserva segue confirmada depois das recusas');

  -- 8) O iCal corta em hoje a entrada da estadia em andamento: não é mudança de data.
  j:=pg_temp.ler(cal,url,jsonb_build_array(jsonb_build_object('uid','res-1b@airbnb.com','inicio',d0+1,'fim',d0+4,'tipo','RESERVA','codigo','HMTEST12345'),
    ev_bloqueio,ev_passada,ev_andamento||jsonb_build_object('inicio',current_date)));
  PERFORM pg_temp.exigir((j->>'reservas_atualizadas')::int=0 AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE codigo_externo='HMANDAMENTO1' AND inicio=current_date-1),
    'entrada cortada em hoje não muda a reserva em andamento');

  -- 9) Cancelada no Airbnb: a sincronização cancela aqui, mesmo já começada ou com lançamento no
  --    financeiro (que fica como está). Com check-in feito, fica para o check-out.
  ev_paga:=jsonb_build_object('uid','pay-1@airbnb.com','inicio',d0+50,'fim',d0+53,'tipo','RESERVA','codigo','HMPAGA12345');
  j:=pg_temp.ler(cal,url,jsonb_build_array(ev_bloqueio,ev_passada,ev_andamento,ev_paga,
    jsonb_build_object('uid','hosp-1@airbnb.com','inicio',d0+80,'fim',d0+83,'tipo','RESERVA','codigo','HMHOSPEDADO1')));
  PERFORM pg_temp.exigir((j->>'reservas_canceladas')::int=1 AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r AND status='CANCELADA'
      AND cancelamento_motivo LIKE 'Cancelada no Airbnb%' AND (cotacao_snapshot->>'cancelada_pelo_airbnb')::boolean),
    'reserva que saiu do Airbnb é cancelada pela sincronização');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=cal AND calendario_codigo='HMTEST12345' AND ativo),
    'cancelamento no Airbnb libera as datas');
  PERFORM pg_temp.exigir(current_setting('app.imob_reserva_airbnb_liberada',true) IS DISTINCT FROM 'on','a liberação do cancelamento não fica ligada depois do sync');
  SELECT id INTO r FROM public.reserva_imovel WHERE codigo_externo='HMPAGA12345';
  PERFORM public.imob_criar_titulo(i,p,c,200,d0+50,10,'TESTE:'||gen_random_uuid(),'Recebimento da reserva',actor,r);
  SELECT id INTO r2 FROM public.reserva_imovel WHERE codigo_externo='HMHOSPEDADO1';
  PERFORM public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0+80,'fim',d0+83,'hospedes',2,
      'valor_diarias',500,'taxa_limpeza',50),actor,r2);
  PERFORM public.imob_acao_reserva(r2,'CHECKIN','{}'::jsonb,actor);
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r2 AND status='EM_ANDAMENTO'),'check-in com valores informados passa');
  j:=pg_temp.ler(cal,url,jsonb_build_array(ev_bloqueio,ev_passada));
  PERFORM pg_temp.exigir((j->>'reservas_canceladas')::int=2
      AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE codigo_externo='HMANDAMENTO1' AND status='CANCELADA'),
    'reserva já começada (sem check-in) que sai do Airbnb é cancelada');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r AND status='CANCELADA')
      AND EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r AND NOT is_deleted),
    'reserva com lançamento é cancelada e o lançamento fica para o financeiro');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r2 AND status='EM_ANDAMENTO'),'hóspede já em check-in não tem a reserva cancelada');

  -- 10) Reativada no Airbnb: cadastrada de novo.
  j:=pg_temp.ler(cal,url,jsonb_build_array(ev_futura,ev_bloqueio,ev_passada));
  SELECT id INTO r2 FROM public.reserva_imovel WHERE codigo_externo='HMTEST12345' AND status='CONFIRMADA';
  PERFORM pg_temp.exigir((j->>'reservas_criadas')::int=1 AND r2 IS NOT NULL AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r2 AND cliente_id=hospede AND valor_total=0),
    'reserva reativada no Airbnb é cadastrada de novo');

  -- 11) Reserva comum segue igual: cria a própria ocupação, cancela e exclui no ERP.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0+30,'fim',d0+36,'hospedes',2,'origem','ERP',
      'ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  PERFORM pg_temp.exigir(j->>'origem'='ERP' AND j->>'codigo_externo' IS NULL
      AND EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE reserva_id=(j->>'id')::bigint AND tipo='RESERVA' AND ativo),
    'reserva do ERP continua criando a própria ocupação');
  PERFORM public.imob_acao_reserva((j->>'id')::bigint,'CANCELAR',jsonb_build_object('motivo','Teste'),actor);
  PERFORM public.imob_excluir_reserva((j->>'id')::bigint,actor,true,true);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=(j->>'id')::bigint),'reserva do ERP continua podendo ser cancelada e excluída');
  erro:=pg_temp.erro_de(format('SELECT public.imob_salvar_reserva(%L::jsonb,%L::uuid)',
    jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',d0+60,'fim',d0+66,'hospedes',2,'origem','ERP','ignorar_regras',true,
      'valor_diarias',0,'taxa_limpeza',0,'idempotency_key',gen_random_uuid()),actor));
  PERFORM pg_temp.exigir(erro LIKE 'O valor total da reserva deve ser maior que zero%','reserva comum continua exigindo valor');

  -- 12) Booking (sem tipo) não ganha código, tipo nem reservas.
  INSERT INTO public.imovel_canal_calendario(imovel_id,canal,calendario_url) VALUES(i,'BOOKING','https://ical.booking.com/v1/export?t=teste') RETURNING id INTO booking;
  j:=pg_temp.ler(booking,'https://ical.booking.com/v1/export?t=teste',jsonb_build_array(jsonb_build_object('uid','bk-1','inicio',d0+70,'fim',d0+72)));
  PERFORM pg_temp.exigir(j->'reservas_criadas' IS NULL AND EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=booking AND calendario_tipo IS NULL
      AND calendario_codigo IS NULL AND motivo='Reserva/bloqueio · Booking'),'Booking segue como reserva/bloqueio, sem cadastro de reservas');
END $test$;

ROLLBACK;
