-- O valor bruto da reserva aparece automaticamente no painel de resultados.
-- É um registro informativo: a receita da DRE permanece sendo a taxa administrativa.
BEGIN;

DO $constraint$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
    WHERE conrelid='public.eventos_financeiros'::regclass AND conname='eventos_financeiros_origem_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'Constraint das origens financeiras não encontrada.'; END IF;
  IF strpos(v_def,'''RECEITA_RESERVA''')=0 THEN
    ALTER TABLE public.eventos_financeiros DROP CONSTRAINT eventos_financeiros_origem_check;
    -- Preserva todas as origens vigentes, acrescentando apenas o valor informativo.
    EXECUTE 'ALTER TABLE public.eventos_financeiros ADD CONSTRAINT eventos_financeiros_origem_check '
      || regexp_replace(v_def,'^CHECK \(','CHECK (origem = ''RECEITA_RESERVA'' OR ');
  END IF;
END $constraint$;

INSERT INTO public.classificacoes_resultado(codigo,nome,descricao,familia,tratamento,naturezas,motivo_exclusao)
VALUES('IMOB_VALOR_RESERVA','Valor informativo da reserva','Valor bruto contratado pelo hóspede, acompanhado no painel da reserva.',
  'PATRIMONIAL','PATRIMONIAL',ARRAY['RECEITA'],'O valor bruto pertence ao proprietário. A receita da administradora é reconhecida pela taxa administrativa.')
ON CONFLICT(codigo) DO NOTHING;

DO $mapping$
DECLARE t record; v_class integer;
BEGIN
  SELECT id INTO v_class FROM public.classificacoes_resultado WHERE codigo='IMOB_VALOR_RESERVA';
  FOR t IN SELECT id FROM public.dre_template WHERE ativo LOOP
    INSERT INTO public.dre_mapeamento(template_id,linha_id,exclui_do_resultado,origem_tipo,classificacao_resultado_id,observacao)
    SELECT t.id,NULL,true,'CLASSIFICACAO_RESULTADO',v_class,'Valor bruto informativo: receita reconhecida somente pela taxa administrativa.'
    WHERE NOT EXISTS(SELECT 1 FROM public.dre_mapeamento WHERE template_id=t.id AND origem_tipo='CLASSIFICACAO_RESULTADO'
      AND classificacao_resultado_id=v_class AND ativo);
    INSERT INTO public.dre_mapeamento(template_id,linha_id,exclui_do_resultado,origem_tipo,origem_valor,classificacao_resultado_id,observacao)
    SELECT t.id,NULL,true,'EVENTO_ORIGEM','RECEITA_RESERVA:RECEITA',v_class,'Valor informativo do painel da reserva.'
    WHERE NOT EXISTS(SELECT 1 FROM public.dre_mapeamento WHERE template_id=t.id AND origem_tipo='EVENTO_ORIGEM'
      AND origem_valor='RECEITA_RESERVA:RECEITA' AND ativo);
  END LOOP;
END $mapping$;

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
  -- A nova regra não reescreve o passado quando uma reserva antiga muda de situação.
  IF NOT FOUND AND TG_OP='UPDATE' THEN RETURN NEW; END IF;
  v_data:=(NEW.inicio+time '12:00') AT TIME ZONE 'America/Fortaleza';
  v_snapshot:=jsonb_build_object('reserva_id',NEW.id,'imovel_id',NEW.imovel_id,'proprietario_id',NEW.proprietario_id,
    'valor_reserva_base',NEW.valor_total,'registro_informativo',true,'auth_actor_id',NEW.auth_actor_id);
  IF e.id IS NULL THEN
    INSERT INTO public.eventos_financeiros(source_type,source_id,origem,natureza,natureza_dre,chave_origem,
      descricao,valor,data_evento,competencia_em,is_manual,pode_gerar_transacao,status,dados_snapshot,created_by)
    VALUES('RESERVA',NEW.id,'RECEITA_RESERVA','RECEITA',NULL,'VALOR_TOTAL','Valor da reserva #'||NEW.id,
      NEW.valor_total,v_data,v_data,false,false,CASE WHEN NEW.status='CANCELADA' THEN 'CANCELADO' ELSE 'ATIVO' END,
      v_snapshot,NEW.created_by) RETURNING * INTO e;
  ELSE
    -- Uma correção manual continua valendo em check-in/out e sincronizações. Uma
    -- alteração real do preço no cadastro passa a ser a nova referência do registro.
    v_valor:=CASE WHEN (e.dados_snapshot->>'valor_reserva_base')::numeric IS NOT DISTINCT FROM NEW.valor_total
      THEN e.valor ELSE NEW.valor_total END;
    IF e.dados_snapshot->>'data_ajustada'='true' THEN v_data:=e.competencia_em; END IF;
    UPDATE public.eventos_financeiros SET valor=v_valor,data_evento=v_data,competencia_em=v_data,
      status=CASE WHEN NEW.status='CANCELADA' OR dados_snapshot->>'excluido_manualmente'='true' THEN 'CANCELADO' ELSE 'ATIVO' END,
      dados_snapshot=coalesce(dados_snapshot,'{}')||v_snapshot,updated_at=clock_timestamp()
      WHERE id=e.id RETURNING * INTO e;
  END IF;
  PERFORM public.imob_classificar_evento_reserva(e.id,coalesce(NEW.updated_by,NEW.created_by));
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.imob_evento_valor_reserva() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_evento_valor_reserva() TO service_role;
DROP TRIGGER IF EXISTS imob_reserva_valor_evento ON public.reserva_imovel;
CREATE TRIGGER imob_reserva_valor_evento AFTER INSERT OR UPDATE OF valor_total,inicio,status
  ON public.reserva_imovel FOR EACH ROW EXECUTE FUNCTION public.imob_evento_valor_reserva();

-- O registro informativo acompanha as mesmas ações de edição e exclusão do painel.
DO $actions$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.imob_alterar_evento_reserva(bigint,bigint,text,jsonb,uuid)'::regprocedure) INTO v_sql;
  IF strpos(v_sql,'''RECEITA_RESERVA''')=0 THEN
    IF strpos(v_sql,'e.origem IN (''DESPESA_RESERVA'',''CONSUMO'')')=0 THEN
      RAISE EXCEPTION 'Validação de edição dos eventos da reserva não encontrada.';
    END IF;
    EXECUTE replace(v_sql,'e.origem IN (''DESPESA_RESERVA'',''CONSUMO'')',
      'e.origem IN (''DESPESA_RESERVA'',''CONSUMO'',''RECEITA_RESERVA'')');
  END IF;
  SELECT pg_get_functiondef('public.imob_excluir_evento_reserva(bigint,bigint,jsonb,uuid)'::regprocedure) INTO v_sql;
  IF strpos(v_sql,'''RECEITA_RESERVA''')=0 THEN
    IF strpos(v_sql,'ELSIF e.origem=''DESPESA_RESERVA'' THEN')=0 THEN
      RAISE EXCEPTION 'Validação de exclusão dos eventos da reserva não encontrada.';
    END IF;
    EXECUTE replace(v_sql,'ELSIF e.origem=''DESPESA_RESERVA'' THEN',
      'ELSIF e.origem IN (''DESPESA_RESERVA'',''RECEITA_RESERVA'') THEN');
  END IF;
END $actions$;

NOTIFY pgrst,'reload schema';
COMMIT;
