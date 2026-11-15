-- Mínimo de noites geral das reservas de temporada (Configurações > Geral).
--
-- Até aqui o mínimo vinha só do imóvel (imovel.min_noites, sem campo no ERP) e das tarifas
-- do período. Agora há um mínimo que vale para todos os imóveis; a estadia precisa atender
-- o maior dos três: geral, imóvel e tarifa.
--
-- O mínimo geral entra nas duas cotações:
--   * imob_cotar_reserva (site, simulador e confirmação da reserva do site): barra o período;
--   * imob_cotar_reserva_erp (reserva pelo ERP): volta como violação MIN_NOITES, que o
--     operador pode aceitar com confirmação, como as demais regras de tarifa.
-- Padrão 1: nada muda até alguém alterar a configuração.
BEGIN;

ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS reserva_min_noites integer NOT NULL DEFAULT 1
  CHECK (reserva_min_noites BETWEEN 1 AND 365);

-- Mesma linha que a API de configuração usa: a mais recente.
CREATE OR REPLACE FUNCTION public.imob_min_noites_geral() RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT reserva_min_noites FROM public.config_geral ORDER BY id DESC LIMIT 1), 1);
$$;
REVOKE ALL ON FUNCTION public.imob_min_noites_geral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_min_noites_geral() TO service_role;

-- Igual a 20261102190000, com o mínimo geral e mensagens que dizem qual limite faltou.
CREATE OR REPLACE FUNCTION public.imob_cotar_reserva(p_imovel_id bigint,p_inicio date,p_fim date,p_hospedes integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; v_dia date; v_valor numeric; v_total numeric:=0; v_min integer; v_tarifa record; v_noites integer; v_diarias jsonb:='[]'; v_result jsonb; v_id uuid; v_expira timestamptz:=clock_timestamp()+interval '15 minutes';
BEGIN
 SELECT * INTO i FROM public.imovel WHERE id=p_imovel_id AND ativo;
 IF NOT FOUND OR NOT ('TEMPORADA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.' USING ERRCODE='22023'; END IF;
 IF p_inicio IS NULL OR p_fim IS NULL OR p_fim<=p_inicio OR p_fim-p_inicio>730 OR p_hospedes IS NULL OR p_hospedes<1 OR p_hospedes>i.capacidade THEN RAISE EXCEPTION 'Período ou quantidade de hóspedes inválido.' USING ERRCODE='22023'; END IF;
 v_noites:=p_fim-p_inicio; v_min:=greatest(i.min_noites,public.imob_min_noites_geral());
 FOR v_dia IN SELECT generate_series(p_inicio::timestamp,(p_fim-1)::timestamp,interval '1 day')::date LOOP
  SELECT diaria,min_noites,inicio,fim,reserva_exclusiva,descricao INTO v_tarifa FROM public.imovel_tarifa WHERE imovel_id=i.id AND ativo AND inicio<=v_dia AND fim>v_dia ORDER BY prioridade DESC,id DESC LIMIT 1;
  IF FOUND THEN
   v_valor:=v_tarifa.diaria; v_min:=greatest(v_min,v_tarifa.min_noites);
   -- Pacote fechado: a estadia inteira tem de caber no período da tarifa (fim exclusivo = dia de saída).
   IF v_tarifa.reserva_exclusiva AND (p_inicio<v_tarifa.inicio OR p_fim>v_tarifa.fim) THEN
    RAISE EXCEPTION '% (% a %) aceita apenas reservas dentro desse período, com mínimo de % noite(s). Ajuste as datas.',
     coalesce(nullif(btrim(v_tarifa.descricao),''),'Este período'), to_char(v_tarifa.inicio,'DD/MM/YYYY'), to_char(v_tarifa.fim,'DD/MM/YYYY'), v_tarifa.min_noites
     USING ERRCODE='22023';
   END IF;
  ELSE v_valor:=i.diaria; END IF;
  IF v_valor<=0 THEN RAISE EXCEPTION 'Diária não configurada para %.',v_dia USING ERRCODE='22023'; END IF;
  v_total:=v_total+v_valor; v_diarias:=v_diarias||jsonb_build_array(jsonb_build_object('data',v_dia,'diaria',v_valor));
 END LOOP;
 -- v_min >= 2 sempre que barra (a estadia tem ao menos 1 noite).
 IF v_noites<v_min THEN RAISE EXCEPTION 'A estadia mínima para essas datas é de % noites. Ajuste as datas.',v_min USING ERRCODE='22023'; END IF;
 IF i.max_noites IS NOT NULL AND v_noites>i.max_noites THEN RAISE EXCEPTION 'A estadia máxima neste imóvel é de % noite(s). Ajuste as datas.',i.max_noites USING ERRCODE='22023'; END IF;
 v_result:=jsonb_build_object('imovel_id',i.id,'inicio',p_inicio,'fim',p_fim,'hospedes',p_hospedes,'noites',v_noites,'diarias',v_diarias,'valor_diarias',v_total,'taxa_limpeza',i.taxa_limpeza,'valor_total',v_total+i.taxa_limpeza,'percentual_admin',i.percentual_admin,'disponivel',NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(p_inicio,p_fim,'[)')),'cotacao_em',clock_timestamp(),'expira_em',v_expira);
 INSERT INTO public.imovel_cotacao(imovel_id,snapshot,expira_em) VALUES(i.id,v_result,v_expira) RETURNING id INTO v_id;
 RETURN v_result||jsonb_build_object('cotacao_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.imob_cotar_reserva(bigint,date,date,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_cotar_reserva(bigint,date,date,integer) TO service_role;

-- Igual a 20261102230000, com o mínimo geral entre as origens do MIN_NOITES.
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
    IF v_valor <= 0 THEN RAISE EXCEPTION 'Diária não configurada para %.', v_dia USING ERRCODE = '22023'; END IF;
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
