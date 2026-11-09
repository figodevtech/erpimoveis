-- A receita da reserva passa a ser lançada no check-out.
--
-- A receita é reconhecida quando a hospedagem é prestada, e não quando a reserva é cadastrada
-- nem quando o hóspede paga. Antes do check-out, o que o hóspede paga é pagamento/adiantamento
-- (aba Pagamentos) e o evento "Valor da reserva" não aparece nos resultados.
--
-- O gatilho de 20261109003531 criava o evento na criação da reserva, com competência na
-- entrada. Agora:
-- - reserva sem check-out (qualquer situação diferente de CONCLUIDA): não há evento ativo. Um
--   evento já criado pela regra anterior fica CANCELADO, marcado como aguardando o check-out;
-- - no check-out (CONCLUIDA): o evento é criado ou reativado, com competência no dia do
--   check-out registrado (checkout_em, 20261108150000); sem ele, na saída prevista.
-- Exclusão manual (excluido_manualmente), valor e data ajustados no painel continuam valendo.
BEGIN;

CREATE OR REPLACE FUNCTION public.imob_evento_valor_reserva() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
  e public.eventos_financeiros%ROWTYPE;
  v_data timestamptz;
  v_valor numeric;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO e FROM public.eventos_financeiros
    WHERE source_type='RESERVA' AND source_id=NEW.id AND origem='RECEITA_RESERVA'
      AND chave_origem='VALOR_TOTAL' AND natureza='RECEITA' AND ordemservicoid IS NULL FOR UPDATE;

  -- Sem check-out a hospedagem não foi prestada: não há receita a reconhecer.
  IF NEW.status<>'CONCLUIDA' THEN
    IF e.id IS NOT NULL AND e.status<>'CANCELADO' THEN
      UPDATE public.eventos_financeiros SET status='CANCELADO',
          dados_snapshot=coalesce(dados_snapshot,'{}')||jsonb_build_object('aguardando_checkout',true),
          updated_at=clock_timestamp()
        WHERE id=e.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Competência: o dia do check-out registrado, no fuso do imobiliário; sem ele, a saída prevista.
  v_data:=(coalesce((NEW.checkout_em AT TIME ZONE 'America/Fortaleza')::date,NEW.fim)+time '12:00') AT TIME ZONE 'America/Fortaleza';
  v_snapshot:=jsonb_build_object('reserva_id',NEW.id,'imovel_id',NEW.imovel_id,'proprietario_id',NEW.proprietario_id,
    'valor_reserva_base',NEW.valor_total,'registro_informativo',true,'auth_actor_id',NEW.auth_actor_id,
    'reconhecido_no_checkout',true,'aguardando_checkout',false);
  IF e.id IS NULL THEN
    INSERT INTO public.eventos_financeiros(source_type,source_id,origem,natureza,natureza_dre,chave_origem,
      descricao,valor,data_evento,competencia_em,is_manual,pode_gerar_transacao,status,dados_snapshot,created_by)
    VALUES('RESERVA',NEW.id,'RECEITA_RESERVA','RECEITA',NULL,'VALOR_TOTAL','Valor da reserva #'||NEW.id,
      NEW.valor_total,v_data,v_data,false,false,'ATIVO',v_snapshot,coalesce(NEW.updated_by,NEW.created_by))
    RETURNING * INTO e;
  ELSE
    -- Uma correção manual do valor continua valendo; uma alteração real do preço no cadastro
    -- passa a ser a nova referência do registro.
    v_valor:=CASE WHEN (e.dados_snapshot->>'valor_reserva_base')::numeric IS NOT DISTINCT FROM NEW.valor_total
      THEN e.valor ELSE NEW.valor_total END;
    IF e.dados_snapshot->>'data_ajustada'='true' THEN v_data:=e.competencia_em; END IF;
    UPDATE public.eventos_financeiros SET valor=v_valor,data_evento=v_data,competencia_em=v_data,
      status=CASE WHEN dados_snapshot->>'excluido_manualmente'='true' THEN 'CANCELADO' ELSE 'ATIVO' END,
      dados_snapshot=coalesce(dados_snapshot,'{}')||v_snapshot,updated_at=clock_timestamp()
      WHERE id=e.id RETURNING * INTO e;
  END IF;
  PERFORM public.imob_classificar_evento_reserva(e.id,coalesce(NEW.updated_by,NEW.created_by));
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.imob_evento_valor_reserva() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_evento_valor_reserva() TO service_role;

-- O check-out grava status e checkout_em juntos; fim e checkout_em entram para que uma correção
-- posterior da saída mova a competência.
DROP TRIGGER IF EXISTS imob_reserva_valor_evento ON public.reserva_imovel;
CREATE TRIGGER imob_reserva_valor_evento AFTER INSERT OR UPDATE OF valor_total,inicio,fim,status,checkout_em
  ON public.reserva_imovel FOR EACH ROW EXECUTE FUNCTION public.imob_evento_valor_reserva();

-- Registros já existentes (gatilho anterior e recuperação de 20261109005923) seguem a nova regra.
-- Idempotente: na segunda execução nada muda.
DO $ajuste$
DECLARE x record; v_data timestamptz;
BEGIN
  FOR x IN
    SELECT e.id AS evento_id, e.status, e.competencia_em, e.dados_snapshot,
           ri.status AS reserva_status, ri.checkout_em, ri.fim, coalesce(ri.updated_by,ri.created_by) AS usuario
      FROM public.eventos_financeiros e
      JOIN public.reserva_imovel ri ON ri.id=e.source_id
     WHERE e.source_type='RESERVA' AND e.origem='RECEITA_RESERVA' AND e.chave_origem='VALOR_TOTAL'
       AND e.natureza='RECEITA' AND e.ordemservicoid IS NULL
     ORDER BY e.id
       FOR UPDATE OF e
  LOOP
    IF x.reserva_status<>'CONCLUIDA' THEN
      IF x.status<>'CANCELADO' THEN
        UPDATE public.eventos_financeiros SET status='CANCELADO',
            dados_snapshot=coalesce(dados_snapshot,'{}')||jsonb_build_object('aguardando_checkout',true),
            updated_at=clock_timestamp()
          WHERE id=x.evento_id;
      END IF;
    ELSIF coalesce(x.dados_snapshot->>'data_ajustada','false')<>'true' THEN
      v_data:=(coalesce((x.checkout_em AT TIME ZONE 'America/Fortaleza')::date,x.fim)+time '12:00') AT TIME ZONE 'America/Fortaleza';
      IF x.competencia_em IS DISTINCT FROM v_data THEN
        UPDATE public.eventos_financeiros SET data_evento=v_data,competencia_em=v_data,
            dados_snapshot=coalesce(dados_snapshot,'{}')||jsonb_build_object('reconhecido_no_checkout',true),
            updated_at=clock_timestamp()
          WHERE id=x.evento_id;
        PERFORM public.imob_classificar_evento_reserva(x.evento_id,x.usuario);
      END IF;
    END IF;
  END LOOP;
END $ajuste$;

NOTIFY pgrst,'reload schema';
COMMIT;
