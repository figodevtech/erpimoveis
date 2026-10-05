BEGIN;

-- Eventos do operador pertencem ao documento, mas não ao seu orçamento/status.
CREATE OR REPLACE FUNCTION public.criar_evento_financeiro_manual_venda(
  p_venda_id bigint, p_natureza text, p_tipo text, p_descricao text,
  p_detalhe text, p_valor numeric, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_evento public.eventos_financeiros%ROWTYPE;
BEGIN
  IF p_natureza IS NULL OR p_natureza NOT IN ('RECEITA','DESPESA')
     OR p_tipo IS NULL OR p_tipo NOT IN ('PRODUTO','SERVICO','CONSUMO')
     OR (p_tipo = 'CONSUMO' AND p_natureza <> 'DESPESA')
     OR nullif(btrim(p_descricao),'') IS NULL OR p_valor IS NULL
     OR p_valor::text IN ('NaN','Infinity','-Infinity') OR round(p_valor,2) <= 0
     OR p_usuario IS NULL THEN
    RAISE EXCEPTION 'Informe natureza, tipo, título e valor positivo válidos.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venda FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('app.audit_user_id', p_usuario::text, true);
  INSERT INTO public.eventos_financeiros
    (ordemservicoid,source_type,source_id,origem,natureza,natureza_dre,
     chave_origem,descricao,detalhe,valor,competencia_em,is_manual,
     pode_gerar_transacao,created_by,status,dados_snapshot)
  VALUES (NULL,'VENDA',p_venda_id,p_tipo,p_natureza,
    public.natureza_dre_de_evento(p_tipo,p_natureza),'MANUAL:' || gen_random_uuid(),
    btrim(p_descricao),nullif(btrim(p_detalhe),''),round(p_valor,2),
    coalesce(v_venda.datavenda,v_venda.createdat,now()),true,true,p_usuario,'ATIVO',
    jsonb_build_object('lancamento_avulso_manual',true,'tipo_informado',p_tipo,
      'consumo_de_estoque',false,'criado_em',now())) RETURNING * INTO v_evento;
  RETURN to_jsonb(v_evento);
END;
$fn$;

-- Releitura sob lock: nunca edita/exclui dinheiro que outra tela acabou de vincular.
CREATE OR REPLACE FUNCTION public.alterar_evento_financeiro_manual_venda(
  p_venda_id bigint, p_evento_id bigint, p_operacao text, p_payload jsonb, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_evento public.eventos_financeiros%ROWTYPE;
  v_valor numeric;
  v_descricao text;
  v_detalhe text;
BEGIN
  IF p_usuario IS NULL OR p_operacao IS NULL OR p_operacao NOT IN ('EDITAR','EXCLUIR') THEN
    RAISE EXCEPTION 'Operação inválida.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros
   WHERE id = p_evento_id AND source_type = 'VENDA' AND source_id = p_venda_id
     AND ordemservicoid IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento financeiro não encontrado nesta venda.' USING ERRCODE = 'P0002'; END IF;
  IF NOT coalesce(v_evento.is_manual,false) OR coalesce(v_evento.chave_origem,'') NOT LIKE 'MANUAL:%'
     OR v_evento.origem = 'COMISSAO' OR (v_evento.origem = 'FRETE' AND v_evento.natureza = 'RECEITA')
     OR v_evento.consumo_saida_id IS NOT NULL OR v_evento.consumo_usoconsumo_saida_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este evento deve ser corrigido na origem que o criou.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status = 'CONVERTIDO' OR v_evento.transacaoid IS NOT NULL OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Exclua primeiro a transação ou o lançamento financeiro vinculado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Somente eventos ativos podem ser alterados.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.audit_user_id',p_usuario::text,true);
  IF p_operacao = 'EXCLUIR' THEN
    DELETE FROM public.eventos_financeiros WHERE id = v_evento.id;
    RETURN jsonb_build_object('evento_id',v_evento.id,'excluido',true,'estoque_devolvido',false);
  END IF;
  v_valor := (p_payload->>'valor')::numeric;
  v_descricao := btrim(coalesce(p_payload->>'descricao',v_evento.descricao));
  v_detalhe := CASE WHEN p_payload ? 'detalhe' THEN nullif(btrim(p_payload->>'detalhe'),'') ELSE v_evento.detalhe END;
  IF v_valor IS NULL OR v_valor::text IN ('NaN','Infinity','-Infinity') OR round(v_valor,2) < 0
     OR nullif(v_descricao,'') IS NULL THEN
    RAISE EXCEPTION 'Informe título e valor válidos.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.eventos_financeiros SET descricao = v_descricao, detalhe = v_detalhe,
    valor = round(v_valor,2),updated_at = now(),dados_snapshot = coalesce(dados_snapshot,'{}'::jsonb)
      || jsonb_build_object('ajuste_manual',true,'ajustado_em',now(),'ajustado_por',p_usuario)
    WHERE id = v_evento.id RETURNING * INTO v_evento;
  RETURN to_jsonb(v_evento);
END;
$fn$;

REVOKE ALL ON FUNCTION public.criar_evento_financeiro_manual_venda(bigint,text,text,text,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.criar_evento_financeiro_manual_venda(bigint,text,text,text,text,numeric,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.alterar_evento_financeiro_manual_venda(bigint,bigint,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.alterar_evento_financeiro_manual_venda(bigint,bigint,text,jsonb,uuid) TO service_role;

-- Patch genérico da versão vigente: preserva comissão, frete e overrides.
-- Toda seleção da sincronização exclui a proveniência MANUAL, inclusive PRODUTO.
DO $patch$
DECLARE v_sql text; v_antigo text; v_novo text;
BEGIN
  SELECT pg_get_functiondef('public.sincronizar_eventos_financeiros_venda(bigint)'::regprocedure) INTO v_sql;
  v_antigo := 'source_id = p_vendaid';
  v_novo := $new$source_id = p_vendaid AND NOT (coalesce(is_manual,false) AND coalesce(chave_origem,'') LIKE 'MANUAL:%')$new$;
  -- Também corresponde a e.source_id; qualifica as colunas nesse trecho.
  IF strpos(v_sql, 'AND NOT (coalesce(is_manual,false)') = 0 THEN
    IF strpos(v_sql,v_antigo) = 0 THEN RAISE EXCEPTION 'Escopo da sincronização da venda não encontrado.'; END IF;
    v_sql := replace(v_sql,'e.' || v_antigo,
      $new$e.source_id = p_vendaid AND NOT (coalesce(e.is_manual,false) AND coalesce(e.chave_origem,'') LIKE 'MANUAL:%')$new$);
    -- Os demais UPDATEs não usam alias. Evita aplicar novamente ao trecho e.source_id.
    v_sql := replace(v_sql,'where source_type = ''VENDA'' and ' || v_antigo,
      'where source_type = ''VENDA'' and ' || v_novo);
    EXECUTE v_sql;
  END IF;

  SELECT pg_get_functiondef('public.registrar_lancamento_de_eventos(jsonb)'::regprocedure) INTO v_sql;
  v_antigo := $old$(e.origem = 'COMISSAO' OR (e.origem = 'FRETE' AND e.is_manual))$old$;
  v_novo := $new$(e.origem = 'COMISSAO' OR (e.is_manual AND coalesce(e.chave_origem,'') LIKE 'MANUAL:%'))$new$;
  IF strpos(v_sql,v_novo) = 0 THEN
    IF strpos(v_sql,v_antigo) = 0 THEN RAISE EXCEPTION 'Validação de origem do lançamento não encontrada.'; END IF;
    v_sql := replace(v_sql,v_antigo,v_novo);
    v_sql := replace(v_sql,'OS, comissao ou despesa de frete de venda','OS, comissao ou despesa manual de venda');
    v_sql := replace(v_sql,'Comissões de ','Despesas de ');
    EXECUTE v_sql;
  END IF;
END;
$patch$;

-- Mantém as colunas/ACLs da fila e acrescenta receitas e despesas do operador.
CREATE OR REPLACE VIEW public.eventos_financeiros_fila WITH (security_invoker=true) AS
SELECT e.*, CASE WHEN o.id IS NOT NULL THEN 'OS' ELSE 'VENDA' END AS documento_tipo,
       coalesce(o.id,v.id) AS documento_id,coalesce(o.clienteid,v.clienteid) AS cliente_id,
       CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id',o.id,'status',o.status,'dataentrada',o.dataentrada,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS ordem,
       CASE WHEN v.id IS NOT NULL THEN jsonb_build_object('id',v.id,'status',v.status,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS venda
 FROM public.eventos_financeiros e
 LEFT JOIN public.ordemservico o ON o.id=e.ordemservicoid
 LEFT JOIN public.venda v ON e.source_type='VENDA' AND e.source_id=v.id
   AND (e.origem='COMISSAO' OR (e.is_manual AND coalesce(e.chave_origem,'') LIKE 'MANUAL:%'))
 LEFT JOIN public.cliente c ON c.id=coalesce(o.clienteid,v.clienteid)
 WHERE (o.id IS NOT NULL AND NOT o.is_deleted) OR (e.ordemservicoid IS NULL AND v.id IS NOT NULL);

-- Vínculo pelo evento, sem vendaid comercial: não abate pagamento do cliente.
CREATE OR REPLACE FUNCTION public.tg_vincular_transacao_evento_financeiro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_evento public.eventos_financeiros%ROWTYPE;
BEGIN
  IF new.evento_financeiro_id IS NULL THEN RETURN new; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros WHERE id=new.evento_financeiro_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento financeiro não encontrado.'; END IF;
  IF v_evento.status <> 'ATIVO' OR v_evento.transacaoid IS NOT NULL OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este evento já foi convertido ou cancelado.';
  END IF;
  IF NOT v_evento.pode_gerar_transacao THEN RAISE EXCEPTION 'Este evento não pode gerar uma transação.'; END IF;
  IF v_evento.ordemservicoid IS DISTINCT FROM new.ordemservicoid OR v_evento.natureza <> new.tipo::text THEN
    RAISE EXCEPTION 'A transação não corresponde ao documento ou à natureza do evento financeiro.';
  END IF;
  IF v_evento.source_type = 'VENDA' AND (new.vendaid IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.venda WHERE id=v_evento.source_id)) THEN
    RAISE EXCEPTION 'Use apenas o vínculo do evento para este fato complementar da venda.';
  END IF;
  IF round(v_evento.valor,2) <> round(new.valor,2) THEN
    RAISE EXCEPTION 'O valor da transação deve ser igual ao valor do evento financeiro.';
  END IF;
  RETURN new;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_vincular_transacao_evento_financeiro() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
