-- Completa os registros informativos das reservas criadas antes da ativação do gatilho.
-- Só as reservas com check-out: a receita é reconhecida quando a hospedagem foi prestada
-- (20261109010000), com competência no dia do check-out ou, sem ele, na saída prevista.
-- Não cria cobranças, não altera pagamentos e não reconhece receita bruta na DRE.
BEGIN;
DO $backfill$
DECLARE r public.reserva_imovel%ROWTYPE; v_evento bigint; v_data timestamptz;
BEGIN
  FOR r IN SELECT ri.* FROM public.reserva_imovel ri
    WHERE ri.status='CONCLUIDA' AND NOT EXISTS(
      SELECT 1 FROM public.eventos_financeiros e
      WHERE e.source_type='RESERVA' AND e.source_id=ri.id AND e.origem='RECEITA_RESERVA')
    ORDER BY ri.id FOR UPDATE
  LOOP
    v_data:=(coalesce((r.checkout_em AT TIME ZONE 'America/Fortaleza')::date,r.fim)+time '12:00') AT TIME ZONE 'America/Fortaleza';
    INSERT INTO public.eventos_financeiros(source_type,source_id,origem,natureza,natureza_dre,chave_origem,
      descricao,valor,data_evento,competencia_em,is_manual,pode_gerar_transacao,status,dados_snapshot,created_by)
    VALUES('RESERVA',r.id,'RECEITA_RESERVA','RECEITA',NULL,'VALOR_TOTAL','Valor da reserva #'||r.id,
      r.valor_total,v_data,v_data,false,false,'ATIVO',
      jsonb_build_object('reserva_id',r.id,'imovel_id',r.imovel_id,'proprietario_id',r.proprietario_id,
        'valor_reserva_base',r.valor_total,'registro_informativo',true,'auth_actor_id',r.auth_actor_id,
        'registro_recuperado',true,'reconhecido_no_checkout',true),r.created_by)
    ON CONFLICT(source_type,source_id,origem,chave_origem,natureza) WHERE ordemservicoid IS NULL DO NOTHING
    RETURNING id INTO v_evento;
    IF v_evento IS NOT NULL THEN
      PERFORM public.imob_classificar_evento_reserva(v_evento,coalesce(r.updated_by,r.created_by));
    END IF;
  END LOOP;
END $backfill$;
COMMIT;
