-- O repasse ao proprietário passa a ser uma transação do tipo REPASSE (20261112130000).
--
-- Onde a conta do proprietário somava "DESPESA sai, o resto volta", REPASSE soma como saída.
-- Fora da DRE pelo tipo, além de recurso_terceiros. Transação de repasse antiga, gravada como
-- DESPESA, continua aceita e somada do mesmo jeito.
--
-- Cada função é ajustada no trecho exato, conferido antes: se o trecho não existir, a
-- migration aborta em vez de seguir com uma regra pela metade. O comentário /* tipo_repasse */
-- marca a função já ajustada, então reexecutar não muda nada.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.imob_trocar_trechos(p_funcao regprocedure, p_pares text[])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_sql text; i integer;
BEGIN
  SELECT pg_get_functiondef(p_funcao) INTO v_sql;
  IF strpos(v_sql, '/* tipo_repasse */') > 0 THEN RETURN; END IF;
  FOR i IN 1 .. array_length(p_pares, 1) / 2 LOOP
    IF strpos(v_sql, p_pares[2*i-1]) = 0 THEN
      RAISE EXCEPTION 'Trecho não encontrado em %: %', p_funcao, p_pares[2*i-1];
    END IF;
    v_sql := replace(v_sql, p_pares[2*i-1], p_pares[2*i] || ' /* tipo_repasse */');
  END LOOP;
  EXECUTE v_sql;
END $fn$;

-- Repasse não é resultado: fica fora da DRE pelo próprio tipo.
SELECT pg_temp.imob_trocar_trechos('public.transacao_gera_evento_de_resultado(bigint)'::regprocedure,
  ARRAY['t.tipo::text IN (''SAQUE'',''DEPOSITO'')', 't.tipo::text IN (''SAQUE'',''DEPOSITO'',''REPASSE'')']);

-- Extrato do proprietário: o pago em REPASSE quita a dívida como a DESPESA antiga quitava.
SELECT pg_temp.imob_trocar_trechos('public.imob_sincronizar_repasse(bigint,uuid,bigint,text)'::regprocedure,
  ARRAY['CASE WHEN t.tipo::text = ''DESPESA'' THEN 1 ELSE -1 END', 'CASE WHEN t.tipo::text IN (''DESPESA'',''REPASSE'') THEN 1 ELSE -1 END']);

-- Vínculo: repasse aceita REPASSE (e DESPESA, de antes deste tipo); despesa do proprietário, DESPESA.
SELECT pg_temp.imob_trocar_trechos('public.imob_vincular_lancamento(bigint,bigint)'::regprocedure,
  ARRAY['IF t.tipo::text <> ''DESPESA'' OR',
        'IF NOT (t.tipo::text = ANY (CASE WHEN l.natureza = ''REPASSE'' THEN ARRAY[''REPASSE'',''DESPESA''] ELSE ARRAY[''DESPESA''] END)) OR']);

-- Edição do lançamento: soma o que já está no financeiro com o sinal certo.
SELECT pg_temp.imob_trocar_trechos('public.imob_editar_lancamento_reserva(bigint,bigint,jsonb,uuid)'::regprocedure,
  ARRAY['sum(CASE WHEN tipo::text=''DESPESA'' THEN valor ELSE -valor END)', 'sum(CASE WHEN tipo::text IN (''DESPESA'',''REPASSE'') THEN valor ELSE -valor END)']);

-- Ajuste de um repasse já pago: a diferença a pagar ao proprietário também é REPASSE.
SELECT pg_temp.imob_trocar_trechos('public.imob_criar_ajuste_financeiro_reserva(bigint,numeric,text,timestamptz,uuid,bigint,bigint)'::regprocedure,
  ARRAY['CASE WHEN p_delta>0 THEN ''DESPESA''::public.tipos_transacao ELSE',
        'CASE WHEN p_delta>0 THEN (CASE WHEN EXISTS(SELECT 1 FROM public.imovel_lancamento WHERE id=p_conta AND natureza=''REPASSE'') THEN ''REPASSE'' ELSE ''DESPESA'' END)::public.tipos_transacao ELSE']);

-- Exclusão do lançamento: repasse a pagar é apagado como a despesa a pagar; o pago vira ajuste.
SELECT pg_temp.imob_trocar_trechos('public.imob_excluir_vinculo_financeiro_reserva(bigint,numeric,text,uuid,bigint,bigint)'::regprocedure,
  ARRAY['sum(CASE WHEN tipo::text=''DESPESA'' THEN valor ELSE -valor END)', 'sum(CASE WHEN tipo::text IN (''DESPESA'',''REPASSE'') THEN valor ELSE -valor END)',
        '(NOT pendente OR tipo::text<>''DESPESA'')', '(NOT pendente OR tipo::text NOT IN (''DESPESA'',''REPASSE''))',
        'CASE WHEN v_alvo>v_total THEN ''DESPESA''::public.tipos_transacao ELSE',
        'CASE WHEN v_alvo>v_total THEN (CASE WHEN EXISTS(SELECT 1 FROM public.imovel_lancamento WHERE id=p_conta AND natureza=''REPASSE'') THEN ''REPASSE'' ELSE ''DESPESA'' END)::public.tipos_transacao ELSE']);

NOTIFY pgrst, 'reload schema';
COMMIT;
