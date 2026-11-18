-- Reserva pelo ERP em imóvel sem diária definida.
--
-- Até aqui a cotação do ERP recusava o período quando alguma noite ficava com diária zero
-- (imóvel com diária R$ 0,00 e sem tarifa especial na data): "Diária não configurada para ...".
-- O operador não conseguia nem abrir os valores para digitar a diária.
--
-- Agora, só na cotação do ERP (imob_cotar_reserva_erp), a noite sem diária entra com R$ 0,00. A tela
-- mostra os valores zerados para o operador informar a diária; imob_salvar_reserva já aceita os
-- valores digitados no ERP e continua exigindo total maior que zero.
--
-- Site, simulador e confirmação da reserva do site usam imob_cotar_reserva, que segue recusando.
-- O resto da função fica exatamente como em 20261115120000.
BEGIN;

CREATE OR REPLACE FUNCTION public.imob_cotar_reserva_erp(p_imovel_id bigint, p_inicio date, p_fim date, p_hospedes integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  i public.imovel%ROWTYPE;
  v_dia date;
  v_valor numeric;
  v_total numeric := 0;
  v_min integer;
  v_min_geral integer;
  v_min_do_geral boolean := false;
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
  v_min_geral := public.imob_min_noites_geral();
  -- Origem do mínimo: tarifa (v_min_origem), configurações gerais (v_min_do_geral) ou cadastro do imóvel.
  IF v_min_geral > v_min THEN v_min := v_min_geral; v_min_do_geral := true; END IF;

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
    -- Sem diária na data: entra zerada para o operador informar o valor na reserva.
    v_valor := greatest(coalesce(v_valor, 0), 0);
    v_total := v_total + v_valor;
    v_diarias := v_diarias || jsonb_build_array(jsonb_build_object('data', v_dia, 'diaria', v_valor));
  END LOOP;

  IF v_noites < v_min THEN
    v_violacoes := v_violacoes || jsonb_build_array(jsonb_build_object(
      'codigo', 'MIN_NOITES',
      'mensagem', format('A estadia tem %s noite(s), abaixo do mínimo de %s noite(s) %s.', v_noites, v_min,
        CASE WHEN v_min_origem IS NOT NULL THEN format('da tarifa "%s", definida no cadastro do imóvel', v_min_origem)
             WHEN v_min_do_geral THEN 'definido nas configurações gerais do ERP'
             ELSE 'definido no cadastro do imóvel' END)));
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

NOTIFY pgrst, 'reload schema';
COMMIT;
