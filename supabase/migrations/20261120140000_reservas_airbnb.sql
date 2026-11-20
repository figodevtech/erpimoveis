BEGIN;

-- Reservas do Airbnb no ERP.
--
-- 1) O calendário do Airbnb separa reserva ("Reserved", com o código HM…) de bloqueio
--    ("Airbnb (Not available)"). A ocupação externa passa a guardar esse tipo e o código.
--    Telefone, nome e o resto da descrição continuam fora do banco.
-- 2) A reserva registrada a partir de um evento do Airbnb (origem AIRBNB) se liga a ele pelo
--    código. O próprio bloqueio do Airbnb segue sendo a ocupação das datas: a reserva não cria
--    outra, e um cancelamento no Airbnb libera as datas na sincronização seguinte.
-- 3) Cadastro automático: a cada leitura do calendário do Airbnb, a reserva nova (que ainda não
--    terminou) vira reserva no ERP em nome do cadastro do sistema HÓSPEDE AIRBNB, com valores
--    R$ 0,00 a informar (o iCal não traz hóspede nem valores). O operador troca o hóspede e
--    informa os valores; o check-in exige os valores. Datas alteradas no Airbnb acompanham a
--    reserva.
-- 4) O Airbnb manda: reserva do Airbnb não é cancelada nem excluída no ERP. Cancela-se no Airbnb,
--    e a reserva confirmada que sai do calendário antes de terminar é cancelada aqui pela
--    sincronização (lançamentos financeiros ficam como estão, para o financeiro tratar).

ALTER TABLE public.imovel_ocupacao
  ADD COLUMN IF NOT EXISTS calendario_tipo text,
  ADD COLUMN IF NOT EXISTS calendario_codigo text;
ALTER TABLE public.imovel_ocupacao DROP CONSTRAINT IF EXISTS imovel_ocupacao_calendario_tipo_check;
ALTER TABLE public.imovel_ocupacao ADD CONSTRAINT imovel_ocupacao_calendario_tipo_check
  CHECK (calendario_tipo IS NULL OR (canal_calendario_id IS NOT NULL AND calendario_tipo IN ('RESERVA','BLOQUEIO')));
ALTER TABLE public.imovel_ocupacao DROP CONSTRAINT IF EXISTS imovel_ocupacao_calendario_codigo_check;
ALTER TABLE public.imovel_ocupacao ADD CONSTRAINT imovel_ocupacao_calendario_codigo_check
  CHECK (calendario_codigo IS NULL OR (canal_calendario_id IS NOT NULL AND calendario_codigo ~ '^[A-Z0-9]{4,40}$'));
CREATE INDEX IF NOT EXISTS imovel_ocupacao_calendario_codigo
  ON public.imovel_ocupacao(imovel_id, calendario_codigo) WHERE calendario_codigo IS NOT NULL;

ALTER TABLE public.reserva_imovel ADD COLUMN IF NOT EXISTS codigo_externo text;
ALTER TABLE public.reserva_imovel DROP CONSTRAINT IF EXISTS reserva_imovel_origem_check;
ALTER TABLE public.reserva_imovel ADD CONSTRAINT reserva_imovel_origem_check CHECK (origem IN ('ERP','SITE','AIRBNB'));
ALTER TABLE public.reserva_imovel DROP CONSTRAINT IF EXISTS reserva_imovel_codigo_externo_check;
ALTER TABLE public.reserva_imovel ADD CONSTRAINT reserva_imovel_codigo_externo_check
  CHECK (CASE WHEN origem = 'AIRBNB' THEN coalesce(codigo_externo ~ '^[A-Z0-9]{4,40}$', false) ELSE codigo_externo IS NULL END);
-- Uma reserva do Airbnb vira no máximo uma reserva ativa no ERP.
CREATE UNIQUE INDEX IF NOT EXISTS reserva_imovel_codigo_externo
  ON public.reserva_imovel(origem, codigo_externo) WHERE codigo_externo IS NOT NULL AND status <> 'CANCELADA';
-- Valores a informar: só a reserva do Airbnb pode ficar com R$ 0,00 (o iCal não traz valores).
ALTER TABLE public.reserva_imovel DROP CONSTRAINT IF EXISTS reserva_imovel_valor_total_check;
ALTER TABLE public.reserva_imovel ADD CONSTRAINT reserva_imovel_valor_total_check
  CHECK (valor_total > 0 OR (origem = 'AIRBNB' AND valor_total = 0));

-- HÓSPEDE AIRBNB: cadastro do sistema, sem documento e intocável como o Consumidor Final, em nome
-- de quem nasce a reserva cadastrada sozinha. A busca de clientes não o mostra.
ALTER TABLE public.cliente DROP CONSTRAINT IF EXISTS cliente_codigo_sistema_check;
ALTER TABLE public.cliente ADD CONSTRAINT cliente_codigo_sistema_check
  CHECK (codigo_sistema IS NULL OR codigo_sistema IN ('consumidor_final','hospede_airbnb'));

CREATE OR REPLACE FUNCTION public.cliente_sistema_protegido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text;
BEGIN
  IF OLD.codigo_sistema IS NULL OR current_setting('app.cliente_sistema_liberado', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_nome := CASE OLD.codigo_sistema WHEN 'hospede_airbnb' THEN 'O Hóspede Airbnb' ELSE 'O Consumidor Final' END;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% é um cadastro do sistema e não pode ser excluído.', v_nome;
  END IF;
  IF NEW.saldo_credito IS DISTINCT FROM OLD.saldo_credito THEN
    RAISE EXCEPTION '% não acumula crédito: não há cliente identificado para receber o saldo.', v_nome;
  END IF;
  -- Carimbo de atualização sozinho passa (o recálculo do saldo o regrava);
  -- qualquer outro campo, não.
  IF (to_jsonb(NEW) - 'updatedat' - 'updated_by') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedat' - 'updated_by') THEN
    RAISE EXCEPTION '% é um cadastro do sistema e não pode ser alterado.', v_nome;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_hospede_airbnb_id()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_id integer;
BEGIN
  SELECT id INTO v_id FROM public.cliente WHERE codigo_sistema = 'hospede_airbnb';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.cliente (tipopessoa, cpfcnpj, nomerazaosocial, status, codigo_sistema)
  VALUES ('FISICA', NULL, 'HÓSPEDE AIRBNB', 'ATIVO', 'hospede_airbnb')
  ON CONFLICT (codigo_sistema) WHERE codigo_sistema IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  -- Outra chamada criou no meio do caminho.
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.cliente WHERE codigo_sistema = 'hospede_airbnb'; END IF;
  RETURN v_id;
END;
$function$;

-- Regras da reserva do Airbnb em qualquer caminho (tela, rota ou SQL):
-- • não é cancelada nem excluída no ERP: o cancelamento é feito no Airbnb e chega pela
--   sincronização do calendário, que liga `app.imob_reserva_airbnb_liberada` só para isso;
-- • o check-in trava hóspede e valores (a edição só vale antes dele): sem valores, não começa.
CREATE OR REPLACE FUNCTION public.imob_reserva_airbnb_regras()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_liberada boolean := coalesce(current_setting('app.imob_reserva_airbnb_liberada', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.origem = 'AIRBNB' AND NOT v_liberada THEN
      RAISE EXCEPTION 'Reservas do Airbnb não podem ser excluídas no ERP. Cancele a reserva no Airbnb: na próxima sincronização do calendário, o ERP a cancela aqui.'
        USING ERRCODE = 'P0001', HINT = 'RESERVA_AIRBNB';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.origem = 'AIRBNB' AND NEW.status = 'CANCELADA' AND OLD.status <> 'CANCELADA' AND NOT v_liberada THEN
    RAISE EXCEPTION 'Reservas do Airbnb são canceladas no Airbnb. Cancele a reserva lá: na próxima sincronização do calendário, o ERP a cancela aqui.'
      USING ERRCODE = 'P0001', HINT = 'RESERVA_AIRBNB';
  END IF;
  IF NEW.origem = 'AIRBNB' AND OLD.status = 'CONFIRMADA' AND NEW.status IN ('EM_ANDAMENTO','CONCLUIDA') AND NEW.valor_total <= 0 THEN
    RAISE EXCEPTION 'Informe os valores da reserva do Airbnb antes do check-in.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS imob_reserva_airbnb_regras ON public.reserva_imovel;
CREATE TRIGGER imob_reserva_airbnb_regras BEFORE UPDATE OF status OR DELETE ON public.reserva_imovel
  FOR EACH ROW EXECUTE FUNCTION public.imob_reserva_airbnb_regras();

-- Reservas do Airbnb deste calendário no ERP: cadastra as novas, acompanha datas alteradas e
-- cancela a que saiu do Airbnb. Roda dentro da leitura do calendário (imob_aplicar_calendario),
-- depois de o snapshot ser aplicado. Cada reserva é tratada à parte: uma falha não impede as
-- outras nem a atualização da disponibilidade.
-- O iCal do Airbnb só traz datas de hoje em diante: a reserva que terminou some (não é
-- cancelamento), e a que está em andamento pode chegar com a entrada cortada em hoje (não é
-- mudança de data).
CREATE OR REPLACE FUNCTION public.imob_sincronizar_reservas_airbnb(p_calendario_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.imovel_canal_calendario; i public.imovel%ROWTYPE; o record; r record;
 v_hoje date := (now() AT TIME ZONE 'America/Fortaleza')::date;
 v_inicio date;
 v_cliente integer; v_criadas integer := 0; v_atualizadas integer := 0; v_canceladas integer := 0; v_falhas integer := 0;
BEGIN
 SELECT * INTO c FROM public.imovel_canal_calendario WHERE id = p_calendario_id;
 IF c.id IS NULL OR c.canal <> 'AIRBNB' THEN RETURN '{}'::jsonb; END IF;
 SELECT * INTO i FROM public.imovel WHERE id = c.imovel_id;

 -- 1) O hóspede mudou as datas no Airbnb (mesmo código): a reserva acompanha. Depois do check-in,
 --    só a saída (extensão ou saída antecipada). Entrada que avançou até hoje é o corte do iCal.
 FOR r IN
  SELECT ri.id, ri.status, ri.inicio AS inicio_atual, ri.fim AS fim_atual, ev.inicio, ev.fim FROM public.reserva_imovel ri
  JOIN LATERAL (SELECT oc.inicio, oc.fim FROM public.imovel_ocupacao oc
                 WHERE oc.canal_calendario_id = c.id AND oc.ativo AND oc.calendario_codigo = ri.codigo_externo
                 ORDER BY oc.id DESC LIMIT 1) ev ON true
  WHERE ri.imovel_id = c.imovel_id AND ri.origem = 'AIRBNB' AND ri.status IN ('CONFIRMADA','EM_ANDAMENTO')
    AND (ri.inicio <> ev.inicio OR ri.fim <> ev.fim)
 LOOP
  v_inicio := CASE WHEN r.status = 'EM_ANDAMENTO' OR (r.inicio > r.inicio_atual AND r.inicio <= v_hoje) THEN r.inicio_atual ELSE r.inicio END;
  CONTINUE WHEN v_inicio = r.inicio_atual AND r.fim = r.fim_atual;
  BEGIN
   UPDATE public.reserva_imovel SET inicio = v_inicio, fim = r.fim, updated_at = now(),
     cotacao_snapshot = coalesce(cotacao_snapshot, '{}') || jsonb_build_object('datas_do_airbnb_em', clock_timestamp())
    WHERE id = r.id;
   v_atualizadas := v_atualizadas + 1;
  EXCEPTION WHEN OTHERS THEN
   v_falhas := v_falhas + 1;
   RAISE WARNING 'Reserva #% do Airbnb: datas não atualizadas (%).', r.id, SQLERRM;
  END;
 END LOOP;

 -- 2) Saiu do calendário do Airbnb antes de terminar: cancelada no Airbnb. A confirmada é
 --    cancelada aqui também; os lançamentos financeiros ficam como estão (como no cancelamento
 --    com "manter"), para o financeiro tratar. Com check-in feito, o hóspede está no imóvel: fica
 --    para o check-out (a tela avisa).
 FOR r IN
  SELECT ri.id FROM public.reserva_imovel ri
  WHERE ri.imovel_id = c.imovel_id AND ri.origem = 'AIRBNB' AND ri.status = 'CONFIRMADA' AND ri.fim > v_hoje
    AND NOT EXISTS (SELECT 1 FROM public.imovel_ocupacao oc WHERE oc.canal_calendario_id = c.id AND oc.ativo AND oc.calendario_codigo = ri.codigo_externo)
 LOOP
  BEGIN
   PERFORM set_config('app.imob_reserva_airbnb_liberada', 'on', true);
   UPDATE public.reserva_imovel SET status = 'CANCELADA', updated_at = now(),
     cancelamento_motivo = 'Cancelada no Airbnb: a reserva saiu do calendário do Airbnb.',
     cotacao_snapshot = coalesce(cotacao_snapshot, '{}') || jsonb_build_object('cancelada_pelo_airbnb', true, 'cancelada_em', clock_timestamp())
    WHERE id = r.id;
   PERFORM set_config('app.imob_reserva_airbnb_liberada', '', true);
   v_canceladas := v_canceladas + 1;
  EXCEPTION WHEN OTHERS THEN
   PERFORM set_config('app.imob_reserva_airbnb_liberada', '', true);
   v_falhas := v_falhas + 1;
   RAISE WARNING 'Reserva #% do Airbnb: cancelamento não aplicado (%).', r.id, SQLERRM;
  END;
 END LOOP;

 -- 3) Reserva nova no Airbnb que ainda não terminou: cadastrada no ERP. A cancelada pela
 --    sincronização volta se o Airbnb a reativar.
 IF i.ativo AND 'TEMPORADA' = ANY(i.modalidades) THEN
  FOR o IN
   SELECT DISTINCT ON (oc.calendario_codigo) oc.calendario_codigo AS codigo, oc.inicio, oc.fim
   FROM public.imovel_ocupacao oc
   WHERE oc.canal_calendario_id = c.id AND oc.ativo AND oc.calendario_tipo = 'RESERVA' AND oc.calendario_codigo IS NOT NULL AND oc.fim > v_hoje
   ORDER BY oc.calendario_codigo, oc.id DESC
  LOOP
   BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('reserva-airbnb:' || o.codigo, 0));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.reserva_imovel ri WHERE ri.origem = 'AIRBNB' AND ri.codigo_externo = o.codigo
      AND (ri.status <> 'CANCELADA' OR NOT coalesce((ri.cotacao_snapshot->>'cancelada_pelo_airbnb')::boolean, false)));
    v_cliente := coalesce(v_cliente, public.cliente_hospede_airbnb_id());
    INSERT INTO public.reserva_imovel(imovel_id, cliente_id, proprietario_id, inicio, fim, hospedes, origem, codigo_externo,
      valor_diarias, taxa_limpeza, valor_total, percentual_admin, cotacao_snapshot, observacoes, idempotency_key, payload_hash)
    VALUES (i.id, v_cliente, i.proprietario_id, o.inicio, o.fim, 1, 'AIRBNB', o.codigo, 0, 0, 0, i.percentual_admin,
      jsonb_build_object('origem', 'AIRBNB', 'registro_automatico', true, 'valores_pendentes', true,
        'inicio', o.inicio, 'fim', o.fim, 'noites', o.fim - o.inicio, 'registrado_em', clock_timestamp()),
      'Cadastrada automaticamente pelo calendário do Airbnb. Troque o Hóspede Airbnb pelo hóspede real e informe os valores.',
      'AIRBNB:' || o.codigo || ':' || gen_random_uuid(), md5('AIRBNB:' || o.codigo));
    v_criadas := v_criadas + 1;
   EXCEPTION WHEN OTHERS THEN
    v_falhas := v_falhas + 1;
    RAISE WARNING 'Reserva % do Airbnb não cadastrada (%).', o.codigo, SQLERRM;
   END;
  END LOOP;
 END IF;

 RETURN jsonb_build_object('reservas_criadas', v_criadas, 'reservas_atualizadas', v_atualizadas,
   'reservas_canceladas', v_canceladas, 'reservas_com_falha', v_falhas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.imob_aplicar_calendario(p_id bigint, p_token uuid, p_url text, p_eventos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.imovel_canal_calendario; e jsonb; v_count integer; v_conflicts integer;
 v_tipo text; v_codigo text; v_canal text; v_reservas jsonb := '{}'::jsonb;
BEGIN
 SELECT * INTO c FROM public.imovel_canal_calendario WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.sincronizacao_token IS DISTINCT FROM p_token OR c.calendario_url<>p_url
 OR c.sincronizacao_ate<now() THEN RAISE EXCEPTION 'Sincronização desatualizada.'; END IF;
 IF jsonb_typeof(p_eventos)<>'array' OR jsonb_array_length(p_eventos)>10000 THEN RAISE EXCEPTION 'Calendário inválido.'; END IF;
 PERFORM 1 FROM public.imovel WHERE id=c.imovel_id FOR UPDATE;
 v_canal:=CASE c.canal WHEN 'AIRBNB' THEN 'Airbnb' WHEN 'BOOKING' THEN 'Booking' WHEN 'STAYS' THEN 'Stays' ELSE c.canal END;
 FOR e IN SELECT value FROM jsonb_array_elements(p_eventos) LOOP
  -- Tipo e código só valem quando o canal os informa (hoje, o Airbnb); o resto fica nulo.
  v_tipo:=CASE WHEN e->>'tipo' IN ('RESERVA','BLOQUEIO') THEN e->>'tipo' END;
  v_codigo:=CASE WHEN upper(e->>'codigo') ~ '^[A-Z0-9]{4,40}$' THEN upper(e->>'codigo') END;
  INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,ativo,motivo,canal_calendario_id,calendario_uid,calendario_tipo,calendario_codigo)
  VALUES(c.imovel_id,'BLOQUEIO',(e->>'inicio')::date,(e->>'fim')::date,true,
   CASE v_tipo WHEN 'RESERVA' THEN 'Reserva '||v_canal||coalesce(' · '||v_codigo,'') WHEN 'BLOQUEIO' THEN 'Bloqueio '||v_canal ELSE 'Reserva/bloqueio · '||v_canal END,
   c.id,e->>'uid',v_tipo,v_codigo)
  ON CONFLICT(canal_calendario_id,calendario_uid) DO UPDATE SET
   inicio=EXCLUDED.inicio,fim=EXCLUDED.fim,ativo=true,motivo=EXCLUDED.motivo,
   calendario_tipo=EXCLUDED.calendario_tipo,calendario_codigo=EXCLUDED.calendario_codigo,updated_at=now();
 END LOOP;
 UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now()
 WHERE canal_calendario_id=c.id AND ativo AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_eventos) AS incoming(value) WHERE incoming.value->>'uid'=calendario_uid);
 SELECT count(*) INTO v_count FROM public.imovel_ocupacao WHERE canal_calendario_id=c.id AND ativo;
 SELECT count(*) INTO v_conflicts FROM public.imovel_ocupacao a WHERE a.canal_calendario_id=c.id AND a.ativo
 AND EXISTS (SELECT 1 FROM public.imovel_ocupacao b WHERE b.imovel_id=a.imovel_id AND b.ativo AND b.id<>a.id
 AND b.canal_calendario_id IS DISTINCT FROM a.canal_calendario_id AND b.periodo&&a.periodo);
 UPDATE public.imovel_canal_calendario SET ultima_sincronizacao=now(),ultimo_erro=NULL,eventos_ativos=v_count,conflitos=v_conflicts,
 sincronizacao_token=NULL,sincronizacao_ate=NULL WHERE id=c.id;
 -- Reservas do Airbnb no ERP. Uma falha aqui não desfaz a disponibilidade já atualizada.
 IF c.canal='AIRBNB' THEN
  BEGIN
   v_reservas:=public.imob_sincronizar_reservas_airbnb(c.id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Reservas do Airbnb não sincronizadas (calendário %): %', c.id, SQLERRM;
   v_reservas:=jsonb_build_object('reservas_com_falha',1);
  END;
 END IF;
 RETURN jsonb_build_object('eventos',v_count,'conflitos',v_conflicts)||v_reservas;
END $function$;

CREATE OR REPLACE FUNCTION public.imob_salvar_reserva(p_payload jsonb, p_actor uuid, p_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE i public.imovel%ROWTYPE; r public.reserva_imovel%ROWTYPE; q jsonb; v_cot public.imovel_cotacao%ROWTYPE; v_actor uuid; v_hash text:=md5(p_payload::text); v_key text:=nullif(p_payload->>'idempotency_key',''); v_origem text:=coalesce(p_payload->>'origem','ERP'); v_inicio date:=(p_payload->>'inicio')::date; v_fim date:=(p_payload->>'fim')::date; v_hosp integer:=(p_payload->>'hospedes')::integer; v_cliente integer:=(p_payload->>'cliente_id')::integer;
 v_erp boolean:=false; v_mesmo boolean:=false; v_diarias numeric(14,2); v_limpeza numeric(14,2); v_total numeric(14,2); v_ajuste jsonb:='{}'; v_lancado numeric(14,2);
 v_airbnb boolean:=false; v_codigo text; v_bloco public.imovel_ocupacao%ROWTYPE;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor);
 IF p_id IS NULL AND v_key IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
 IF p_id IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva-key:'||v_key,0));
  SELECT * INTO r FROM public.reserva_imovel WHERE idempotency_key=v_key;
  IF FOUND THEN IF r.payload_hash<>v_hash THEN RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE='23505'; END IF; RETURN to_jsonb(r); END IF;
 ELSE
  SELECT * INTO r FROM public.reserva_imovel WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE='P0002'; END IF;
  IF r.status<>'CONFIRMADA' OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE reserva_id=r.id) THEN RAISE EXCEPTION 'Reserva iniciada ou com movimentos financeiros não pode ter período e valores reescritos.'; END IF;
 END IF;
 SELECT * INTO i FROM public.imovel WHERE id=(p_payload->>'imovel_id')::bigint AND ativo FOR UPDATE;
 IF NOT FOUND OR NOT ('TEMPORADA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.'; END IF;
 -- Reserva do Airbnb: o código HM a liga ao evento que o calendário do Airbnb trouxe. As datas
 -- são as do Airbnb, e as regras de tarifa do ERP não barram (a venda seguiu as regras do Airbnb).
 -- Pode seguir em nome do HÓSPEDE AIRBNB e com valores a informar (R$ 0,00) até o check-in.
 v_airbnb:=CASE WHEN p_id IS NULL THEN v_origem='AIRBNB' ELSE r.origem='AIRBNB' END;
 IF p_id IS NOT NULL AND v_origem='AIRBNB' AND r.origem<>'AIRBNB' THEN RAISE EXCEPTION 'Esta reserva não veio do Airbnb.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cliente WHERE id=v_cliente AND NOT is_deleted AND status='ATIVO'
   AND (cpfcnpj IS NOT NULL OR (v_airbnb AND codigo_sistema='hospede_airbnb'))) THEN RAISE EXCEPTION 'Cliente ativo com documento é obrigatório.'; END IF;
 IF v_airbnb THEN
  v_codigo:=CASE WHEN p_id IS NULL THEN upper(nullif(btrim(p_payload->>'codigo_externo'),'')) ELSE r.codigo_externo END;
  IF v_codigo IS NULL OR v_codigo !~ '^[A-Z0-9]{4,40}$' THEN RAISE EXCEPTION 'Informe o código da reserva do Airbnb.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva-airbnb:'||v_codigo,0));
  IF EXISTS(SELECT 1 FROM public.reserva_imovel WHERE origem='AIRBNB' AND codigo_externo=v_codigo AND status<>'CANCELADA' AND id IS DISTINCT FROM p_id) THEN
   RAISE EXCEPTION 'A reserva % do Airbnb já está registrada no ERP.',v_codigo USING ERRCODE='23505';
  END IF;
  IF p_id IS NULL OR r.imovel_id<>i.id OR r.inicio<>v_inicio OR r.fim<>v_fim THEN
   SELECT o.* INTO v_bloco FROM public.imovel_ocupacao o JOIN public.imovel_canal_calendario c ON c.id=o.canal_calendario_id
    WHERE o.imovel_id=i.id AND c.canal='AIRBNB' AND o.ativo AND o.calendario_codigo=v_codigo ORDER BY o.id DESC LIMIT 1;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'A reserva % não está no calendário do Airbnb deste imóvel. Atualize o calendário na aba Booking e Airbnb e tente de novo.',v_codigo USING ERRCODE='22023';
   END IF;
   IF v_bloco.inicio<>v_inicio OR v_bloco.fim<>v_fim THEN
    RAISE EXCEPTION 'As datas precisam ser as do Airbnb: entrada em % e saída em %.',to_char(v_bloco.inicio,'DD/MM/YYYY'),to_char(v_bloco.fim,'DD/MM/YYYY') USING ERRCODE='22023';
   END IF;
  END IF;
 END IF;

 IF v_origem='SITE' AND v_actor IS NULL THEN
  IF NOT i.publicado OR NOT EXISTS(SELECT 1 FROM public.site_usuario WHERE user_id=p_actor AND tipo='CLIENTE' AND status='ATIVO' AND cliente_id=v_cliente) THEN RAISE EXCEPTION 'Conta sem autorização para a reserva.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_cot FROM public.imovel_cotacao WHERE id=(p_payload->>'cotacao_id')::uuid AND expira_em>clock_timestamp();
  IF NOT FOUND OR v_cot.imovel_id<>i.id OR (v_cot.snapshot->>'inicio')::date<>v_inicio OR (v_cot.snapshot->>'fim')::date<>v_fim OR (v_cot.snapshot->>'hospedes')::integer<>v_hosp THEN RAISE EXCEPTION 'Cotação expirada ou incompatível; consulte novamente.' USING ERRCODE='22023'; END IF;
  q:=public.imob_cotar_reserva(i.id,v_inicio,v_fim,v_hosp);
  IF q->'diarias' IS DISTINCT FROM v_cot.snapshot->'diarias' OR q->'valor_total' IS DISTINCT FROM v_cot.snapshot->'valor_total' OR q->'taxa_limpeza' IS DISTINCT FROM v_cot.snapshot->'taxa_limpeza' THEN RAISE EXCEPTION 'A tarifa mudou; confirme a nova cotação.' USING ERRCODE='22023'; END IF;
 ELSE
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Reserva ERP exige operador interno.' USING ERRCODE='42501'; END IF;
  v_erp:=true;
  q:=public.imob_cotar_reserva_erp(i.id,v_inicio,v_fim,v_hosp);
  -- Edição que não mexe em imóvel, datas nem hóspedes não volta a cobrar regra já aceita.
  v_mesmo:=p_id IS NOT NULL AND r.imovel_id=i.id AND r.inicio=v_inicio AND r.fim=v_fim AND r.hospedes=v_hosp;
  IF jsonb_array_length(q->'violacoes')>0 AND NOT v_mesmo AND NOT v_airbnb AND NOT coalesce((p_payload->>'ignorar_regras')::boolean,false) THEN
   RAISE EXCEPTION '%', q->'violacoes'->0->>'mensagem' USING ERRCODE='22023', HINT='REGRA_TARIFA';
  END IF;
 END IF;
 IF p_payload->>'expected_total' IS NOT NULL AND (p_payload->>'expected_total')::numeric<>(q->>'valor_total')::numeric THEN RAISE EXCEPTION 'O valor da cotação mudou; consulte novamente.' USING ERRCODE='22023'; END IF;
 -- O evento do Airbnb desta reserva é a ocupação dela: não conta como conflito.
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo&&daterange(v_inicio,v_fim,'[)') AND (p_id IS NULL OR o.reserva_id IS DISTINCT FROM p_id)
   AND NOT (v_airbnb AND o.calendario_codigo=v_codigo AND EXISTS(SELECT 1 FROM public.imovel_canal_calendario c WHERE c.id=o.canal_calendario_id AND c.canal='AIRBNB'))) THEN
  RAISE EXCEPTION 'O imóvel já está ocupado neste período.' USING ERRCODE='23P01';
 END IF;

 v_diarias:=(q->>'valor_diarias')::numeric; v_limpeza:=(q->>'taxa_limpeza')::numeric;
 IF v_erp THEN
  IF nullif(p_payload->>'valor_diarias','') IS NOT NULL THEN v_diarias:=round((p_payload->>'valor_diarias')::numeric,2); END IF;
  IF nullif(p_payload->>'taxa_limpeza','') IS NOT NULL THEN v_limpeza:=round((p_payload->>'taxa_limpeza')::numeric,2); END IF;
  IF v_diarias<0 OR v_limpeza<0 THEN RAISE EXCEPTION 'Diárias e taxa de limpeza não podem ser negativas.' USING ERRCODE='22023'; END IF;
  v_ajuste:=jsonb_strip_nulls(jsonb_build_object(
   'valor_diarias_cotado',CASE WHEN v_diarias<>(q->>'valor_diarias')::numeric THEN q->'valor_diarias' END,
   'taxa_limpeza_cotada',CASE WHEN v_limpeza<>(q->>'taxa_limpeza')::numeric THEN q->'taxa_limpeza' END,
   'regras_ignoradas',CASE WHEN jsonb_array_length(q->'violacoes')>0 THEN q->'violacoes' END));
  IF v_ajuste<>'{}'::jsonb THEN v_ajuste:=v_ajuste||jsonb_build_object('ajustado_por',v_actor,'ajustado_em',clock_timestamp()); END IF;
 END IF;
 v_total:=v_diarias+v_limpeza;
 IF v_total<=0 AND NOT v_airbnb THEN RAISE EXCEPTION 'O valor total da reserva deve ser maior que zero.' USING ERRCODE='22023'; END IF;
 -- O snapshot guarda o que foi cotado e, ao lado, o que o operador mudou.
 q:=q||v_ajuste||jsonb_build_object('valor_diarias',v_diarias,'taxa_limpeza',v_limpeza,'valor_total',v_total);

 IF p_id IS NULL THEN
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,origem,codigo_externo,valor_diarias,taxa_limpeza,valor_total,percentual_admin,cotacao_snapshot,observacoes,idempotency_key,payload_hash,created_by,auth_actor_id)
  VALUES(i.id,v_cliente,i.proprietario_id,v_inicio,v_fim,v_hosp,v_origem,v_codigo,v_diarias,v_limpeza,v_total,(q->>'percentual_admin')::numeric,q,p_payload->>'observacoes',v_key,v_hash,v_actor,CASE WHEN v_actor IS NULL THEN p_actor END) RETURNING * INTO r;
 ELSE
  -- O cliente não muda, salvo o HÓSPEDE AIRBNB, que existe para ser trocado pelo hóspede real.
  IF v_cliente<>r.cliente_id AND NOT (v_airbnb AND EXISTS(SELECT 1 FROM public.cliente WHERE id=r.cliente_id AND codigo_sistema='hospede_airbnb')) THEN
   RAISE EXCEPTION 'Cliente da reserva é imutável.';
  END IF;
  UPDATE public.reserva_imovel SET cliente_id=v_cliente,imovel_id=i.id,proprietario_id=i.proprietario_id,inicio=v_inicio,fim=v_fim,hospedes=v_hosp,valor_diarias=v_diarias,taxa_limpeza=v_limpeza,valor_total=v_total,percentual_admin=(q->>'percentual_admin')::numeric,cotacao_snapshot=q,observacoes=p_payload->>'observacoes',updated_by=v_actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  -- Só a cobrança automática (reserva do site) acompanha o novo total; pagamentos lançados à mão ficam como estão.
  UPDATE public.transacao SET imovel_id=i.id,proprietario_id=i.proprietario_id,imovel_percentual_admin=r.percentual_admin,valor=r.valor_total,"valorLiquido"=r.valor_total,data=r.inicio::timestamptz,vencimento_em=r.inicio::timestamptz,descricao='Reserva #'||r.id||' - '||i.titulo WHERE imovel_chave='RESERVA:'||r.id AND baixa_de_transacao_id IS NULL AND pendente;
  SELECT coalesce(sum(valor),0) INTO v_lancado FROM public.transacao WHERE reserva_imovel_id=r.id AND imovel_natureza='RECEBIMENTO' AND baixa_de_transacao_id IS NULL AND NOT is_deleted AND imovel_chave IS DISTINCT FROM 'RESERVA:'||r.id;
  IF v_lancado>r.valor_total THEN RAISE EXCEPTION 'Os pagamentos já lançados (R$ %) passam do novo total da reserva (R$ %). Ajuste ou exclua pagamentos antes.',to_char(v_lancado,'FM999G999G990D00'),to_char(r.valor_total,'FM999G999G990D00') USING ERRCODE='22023'; END IF;
 END IF;
 -- A reserva do Airbnb não cria ocupação própria: as datas ficam com o evento do calendário do Airbnb.
 IF NOT v_airbnb THEN
  INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,reserva_id,created_by) VALUES(i.id,'RESERVA',r.inicio,r.fim,r.id,v_actor)
  ON CONFLICT(reserva_id) DO UPDATE SET imovel_id=excluded.imovel_id,inicio=excluded.inicio,fim=excluded.fim,ativo=true,updated_at=now();
 END IF;
 -- Reserva do site nasce com a cobrança a receber, vencendo no check-in. A do ERP (e a do Airbnb)
 -- nasce sem: os pagamentos são lançados pelo financeiro, ligados à reserva, até o total.
 IF p_id IS NULL AND v_origem='SITE' THEN
  PERFORM public.imob_criar_titulo(i.id,r.proprietario_id,v_cliente,r.valor_total,r.inicio,r.percentual_admin,'RESERVA:'||r.id,'Reserva #'||r.id||' - '||i.titulo,v_actor,r.id);
 END IF;
 RETURN to_jsonb(r);
END $function$;

REVOKE ALL ON FUNCTION public.cliente_sistema_protegido() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cliente_hospede_airbnb_id() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.imob_reserva_airbnb_regras() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.imob_sincronizar_reservas_airbnb(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_hospede_airbnb_id() TO service_role;
REVOKE ALL ON FUNCTION public.imob_aplicar_calendario(bigint,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.imob_salvar_reserva(jsonb,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_aplicar_calendario(bigint,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.imob_salvar_reserva(jsonb,uuid,bigint) TO service_role;

COMMIT;
