-- Reserva pelo ERP: valores editáveis e regras de tarifa que se confirmam em vez de barrar.
--
-- No site nada muda: a cotação continua recusando o período que quebra uma regra (pacote
-- fechado, mínimo e máximo de noites) e a reserva vale exatamente o que foi cotado.
--
-- No ERP o operador pode:
--   * alterar o total das diárias e a taxa de limpeza que a cotação sugeriu;
--   * passar por cima das regras de tarifa, desde que confirme (ignorar_regras = true).
-- Ocupação do imóvel, capacidade, imóvel inativo e diária não configurada continuam barrando.
-- O que foi ajustado e quais regras foram ignoradas ficam no cotacao_snapshot da reserva.
BEGIN;

-- Mesma conta de imob_cotar_reserva, mas as regras de tarifa voltam como lista, sem erro.
CREATE OR REPLACE FUNCTION public.imob_cotar_reserva_erp(p_imovel_id bigint, p_inicio date, p_fim date, p_hospedes integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  i public.imovel%ROWTYPE;
  v_dia date;
  v_valor numeric;
  v_total numeric := 0;
  v_min integer;
  v_min_origem text;
  v_tarifa record;
  v_rotulo text;
  v_noites integer;
  v_diarias jsonb := '[]';
  v_violacoes jsonb := '[]';
  v_pacotes bigint[] := '{}';
BEGIN
  SELECT * INTO i FROM public.imovel WHERE id = p_imovel_id AND ativo;
  IF NOT FOUND OR NOT ('TEMPORADA' = ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.' USING ERRCODE = '22023'; END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim <= p_inicio OR p_fim - p_inicio > 730 OR p_hospedes IS NULL OR p_hospedes < 1 OR p_hospedes > i.capacidade THEN
    RAISE EXCEPTION 'Período ou quantidade de hóspedes inválido.' USING ERRCODE = '22023';
  END IF;
  v_noites := p_fim - p_inicio;
  v_min := i.min_noites;

  FOR v_dia IN SELECT generate_series(p_inicio::timestamp, (p_fim - 1)::timestamp, interval '1 day')::date LOOP
    SELECT id, diaria, min_noites, inicio, fim, reserva_exclusiva, descricao INTO v_tarifa
      FROM public.imovel_tarifa WHERE imovel_id = i.id AND ativo AND inicio <= v_dia AND fim > v_dia
      ORDER BY prioridade DESC, id DESC LIMIT 1;
    IF FOUND THEN
      v_valor := v_tarifa.diaria;
      v_rotulo := coalesce(nullif(btrim(v_tarifa.descricao), ''), 'de ' || to_char(v_tarifa.inicio, 'DD/MM/YYYY') || ' a ' || to_char(v_tarifa.fim, 'DD/MM/YYYY'));
      IF v_tarifa.min_noites > v_min THEN v_min := v_tarifa.min_noites; v_min_origem := v_rotulo; END IF;
      IF v_tarifa.reserva_exclusiva AND (p_inicio < v_tarifa.inicio OR p_fim > v_tarifa.fim) AND NOT (v_tarifa.id = ANY(v_pacotes)) THEN
        v_pacotes := v_pacotes || v_tarifa.id;
        v_violacoes := v_violacoes || jsonb_build_array(jsonb_build_object(
          'codigo', 'PACOTE_FECHADO',
          'mensagem', format('O período selecionado ultrapassa a regra da tarifa "%s" (%s a %s), definida no cadastro do imóvel: ela aceita apenas reservas dentro desse período.',
            v_rotulo, to_char(v_tarifa.inicio, 'DD/MM/YYYY'), to_char(v_tarifa.fim, 'DD/MM/YYYY'))));
      END IF;
    ELSE
      v_valor := i.diaria;
    END IF;
    IF v_valor <= 0 THEN RAISE EXCEPTION 'Diária não configurada para %.', v_dia USING ERRCODE = '22023'; END IF;
    v_total := v_total + v_valor;
    v_diarias := v_diarias || jsonb_build_array(jsonb_build_object('data', v_dia, 'diaria', v_valor));
  END LOOP;

  IF v_noites < v_min THEN
    v_violacoes := v_violacoes || jsonb_build_array(jsonb_build_object(
      'codigo', 'MIN_NOITES',
      'mensagem', format('A estadia tem %s noite(s), abaixo do mínimo de %s noite(s) %s.', v_noites, v_min,
        CASE WHEN v_min_origem IS NULL THEN 'definido no cadastro do imóvel' ELSE format('da tarifa "%s", definida no cadastro do imóvel', v_min_origem) END)));
  END IF;
  IF i.max_noites IS NOT NULL AND v_noites > i.max_noites THEN
    v_violacoes := v_violacoes || jsonb_build_array(jsonb_build_object(
      'codigo', 'MAX_NOITES',
      'mensagem', format('A estadia tem %s noites, acima do máximo de %s noite(s) definido no cadastro do imóvel.', v_noites, i.max_noites)));
  END IF;

  RETURN jsonb_build_object('imovel_id', i.id, 'inicio', p_inicio, 'fim', p_fim, 'hospedes', p_hospedes, 'noites', v_noites,
    'diarias', v_diarias, 'valor_diarias', v_total, 'taxa_limpeza', i.taxa_limpeza, 'valor_total', v_total + i.taxa_limpeza,
    'percentual_admin', i.percentual_admin,
    'disponivel', NOT EXISTS (SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id = i.id AND ativo AND periodo && daterange(p_inicio, p_fim, '[)')),
    'violacoes', v_violacoes, 'cotacao_em', clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.imob_cotar_reserva_erp(bigint, date, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_cotar_reserva_erp(bigint, date, date, integer) TO service_role;

-- Igual à versão anterior no caminho do site; no do ERP, cota com a função acima, aplica os
-- valores informados e exige ignorar_regras para gravar um período que quebra regra de tarifa.
CREATE OR REPLACE FUNCTION public.imob_salvar_reserva(p_payload jsonb,p_actor uuid,p_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; r public.reserva_imovel%ROWTYPE; q jsonb; v_cot public.imovel_cotacao%ROWTYPE; v_actor uuid; v_hash text:=md5(p_payload::text); v_key text:=nullif(p_payload->>'idempotency_key',''); v_origem text:=coalesce(p_payload->>'origem','ERP'); v_inicio date:=(p_payload->>'inicio')::date; v_fim date:=(p_payload->>'fim')::date; v_hosp integer:=(p_payload->>'hospedes')::integer; v_cliente integer:=(p_payload->>'cliente_id')::integer;
 v_erp boolean:=false; v_mesmo boolean:=false; v_diarias numeric(14,2); v_limpeza numeric(14,2); v_total numeric(14,2); v_ajuste jsonb:='{}';
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
 IF NOT EXISTS(SELECT 1 FROM public.cliente WHERE id=v_cliente AND NOT is_deleted AND status='ATIVO' AND cpfcnpj IS NOT NULL) THEN RAISE EXCEPTION 'Cliente ativo com documento é obrigatório.'; END IF;
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
  IF jsonb_array_length(q->'violacoes')>0 AND NOT v_mesmo AND NOT coalesce((p_payload->>'ignorar_regras')::boolean,false) THEN
   RAISE EXCEPTION '%', q->'violacoes'->0->>'mensagem' USING ERRCODE='22023', HINT='REGRA_TARIFA';
  END IF;
 END IF;
 IF p_payload->>'expected_total' IS NOT NULL AND (p_payload->>'expected_total')::numeric<>(q->>'valor_total')::numeric THEN RAISE EXCEPTION 'O valor da cotação mudou; consulte novamente.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(v_inicio,v_fim,'[)') AND (p_id IS NULL OR reserva_id IS DISTINCT FROM p_id)) THEN RAISE EXCEPTION 'O imóvel já está ocupado neste período.' USING ERRCODE='23P01'; END IF;

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
 IF v_total<=0 THEN RAISE EXCEPTION 'O valor total da reserva deve ser maior que zero.' USING ERRCODE='22023'; END IF;
 -- O snapshot guarda o que foi cotado e, ao lado, o que o operador mudou.
 q:=q||v_ajuste||jsonb_build_object('valor_diarias',v_diarias,'taxa_limpeza',v_limpeza,'valor_total',v_total);

 IF p_id IS NULL THEN
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,origem,valor_diarias,taxa_limpeza,valor_total,percentual_admin,cotacao_snapshot,observacoes,idempotency_key,payload_hash,created_by,auth_actor_id)
  VALUES(i.id,v_cliente,i.proprietario_id,v_inicio,v_fim,v_hosp,v_origem,v_diarias,v_limpeza,v_total,(q->>'percentual_admin')::numeric,q,p_payload->>'observacoes',v_key,v_hash,v_actor,CASE WHEN v_actor IS NULL THEN p_actor END) RETURNING * INTO r;
 ELSE
  IF v_cliente<>r.cliente_id THEN RAISE EXCEPTION 'Cliente da reserva é imutável.'; END IF;
  UPDATE public.reserva_imovel SET imovel_id=i.id,proprietario_id=i.proprietario_id,inicio=v_inicio,fim=v_fim,hospedes=v_hosp,valor_diarias=v_diarias,taxa_limpeza=v_limpeza,valor_total=v_total,percentual_admin=(q->>'percentual_admin')::numeric,cotacao_snapshot=q,observacoes=p_payload->>'observacoes',updated_by=v_actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  UPDATE public.transacao SET imovel_id=i.id,proprietario_id=i.proprietario_id,imovel_percentual_admin=r.percentual_admin,valor=r.valor_total,"valorLiquido"=r.valor_total,data=r.inicio::timestamptz,vencimento_em=r.inicio::timestamptz,descricao='Reserva #'||r.id||' - '||i.titulo WHERE reserva_imovel_id=r.id AND imovel_natureza='RECEBIMENTO' AND baixa_de_transacao_id IS NULL AND pendente;
 END IF;
 INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,reserva_id,created_by) VALUES(i.id,'RESERVA',r.inicio,r.fim,r.id,v_actor)
 ON CONFLICT(reserva_id) DO UPDATE SET imovel_id=excluded.imovel_id,inicio=excluded.inicio,fim=excluded.fim,ativo=true,updated_at=now();
 PERFORM public.imob_criar_titulo(i.id,r.proprietario_id,v_cliente,r.valor_total,r.inicio,r.percentual_admin,'RESERVA:'||r.id,'Reserva #'||r.id||' - '||i.titulo,v_actor,r.id);
 RETURN to_jsonb(r);
END $$;

COMMIT;
