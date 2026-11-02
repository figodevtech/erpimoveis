-- Tarifa com "reservas só dentro do período" (pacote fechado, ex.: Carnaval): uma estadia que
-- tem alguma noite nessa tarifa precisa começar e terminar dentro dela. O mínimo de noites da
-- tarifa continua valendo. A regra fica na cotação, que o site, o ERP e a confirmação da
-- reserva (imob_salvar_reserva) usam: nenhum caminho cria reserva atravessando o pacote.
BEGIN;

ALTER TABLE public.imovel_tarifa ADD COLUMN IF NOT EXISTS reserva_exclusiva boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.imob_cotar_reserva(p_imovel_id bigint,p_inicio date,p_fim date,p_hospedes integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; v_dia date; v_valor numeric; v_total numeric:=0; v_min integer; v_tarifa record; v_noites integer; v_diarias jsonb:='[]'; v_result jsonb; v_id uuid; v_expira timestamptz:=clock_timestamp()+interval '15 minutes';
BEGIN
 SELECT * INTO i FROM public.imovel WHERE id=p_imovel_id AND ativo;
 IF NOT FOUND OR NOT ('TEMPORADA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.' USING ERRCODE='22023'; END IF;
 IF p_inicio IS NULL OR p_fim IS NULL OR p_fim<=p_inicio OR p_fim-p_inicio>730 OR p_hospedes IS NULL OR p_hospedes<1 OR p_hospedes>i.capacidade THEN RAISE EXCEPTION 'Período ou quantidade de hóspedes inválido.' USING ERRCODE='22023'; END IF;
 v_noites:=p_fim-p_inicio; v_min:=i.min_noites;
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
 IF v_noites<greatest(v_min,i.min_noites) OR (i.max_noites IS NOT NULL AND v_noites>i.max_noites) THEN RAISE EXCEPTION 'Quantidade de noites fora dos limites do imóvel.' USING ERRCODE='22023'; END IF;
 v_result:=jsonb_build_object('imovel_id',i.id,'inicio',p_inicio,'fim',p_fim,'hospedes',p_hospedes,'noites',v_noites,'diarias',v_diarias,'valor_diarias',v_total,'taxa_limpeza',i.taxa_limpeza,'valor_total',v_total+i.taxa_limpeza,'percentual_admin',i.percentual_admin,'disponivel',NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(p_inicio,p_fim,'[)')),'cotacao_em',clock_timestamp(),'expira_em',v_expira);
 INSERT INTO public.imovel_cotacao(imovel_id,snapshot,expira_em) VALUES(i.id,v_result,v_expira) RETURNING id INTO v_id;
 RETURN v_result||jsonb_build_object('cotacao_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.imob_cotar_reserva(bigint,date,date,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_cotar_reserva(bigint,date,date,integer) TO service_role;

COMMIT;
