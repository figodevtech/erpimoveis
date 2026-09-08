-- Fixtures isoladas; não altera registros dos clientes nem deixa pagamentos.
BEGIN;
CREATE FUNCTION pg_temp.nova_os_teste() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  INSERT INTO public.ordemservico(usuariocriadorid,clienteid,status,orcamentototal,subtotal,valor_frete,dataentrada)
    VALUES((SELECT id FROM public.usuario WHERE ativo LIMIT 1),(SELECT id FROM public.cliente LIMIT 1),'ORCAMENTO',100,90,10,now())
    RETURNING id INTO v_id;
  UPDATE public.ordemservico SET status='ORCAMENTO_APROVADO' WHERE id=v_id;
  UPDATE public.ordemservico SET status='EM_ANDAMENTO' WHERE id=v_id;
  RETURN v_id;
END;
$$;
CREATE FUNCTION pg_temp.titulo(p_os integer,p_valor numeric) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.transacao(ordemservicoid,descricao,tipo,valor,"valorLiquido",pendente,data,metodopagamento,
    categoria,cliente_id,nomepagador,cpfcnpjpagador)
    VALUES(p_os,'Teste faturamento','RECEITA',p_valor,p_valor,true,now()+interval '1 month','BOLETO',
    'ORDEM DE SERVIÇO',(SELECT clienteid FROM public.ordemservico WHERE id=p_os),'Cliente teste','00000000000')
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
CREATE FUNCTION pg_temp.status_os(p_os integer,p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status::text FROM public.ordemservico WHERE id=p_os) IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'OS % deveria estar em %, encontrado %',p_os,p_status,(SELECT status FROM public.ordemservico WHERE id=p_os);
  END IF;
END;
$$;
DO $$
DECLARE v_os integer; v_pre integer; v_outro integer; v_t1 bigint; v_t2 bigint; v_pag bigint;
  v_erro boolean; v_antes jsonb; v_eventos jsonb; v_qtd bigint; v_grupo bigint; v_fim timestamptz;
  v_notif bigint;
BEGIN
  IF public.faturamento_os_habilitado() THEN RAISE EXCEPTION 'Demonstração deve iniciar no modo padrão.'; END IF;
  v_os := pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_os;
  v_t1 := pg_temp.titulo(v_os,100);
  PERFORM pg_temp.status_os(v_os,'CONCLUIDO');
  DELETE FROM public.transacao WHERE id=v_t1;
  PERFORM pg_temp.status_os(v_os,'PAGAMENTO');
  v_erro:=false;
  BEGIN UPDATE public.ordemservico SET status='FATURAMENTO' WHERE id=v_os;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Modo desligado aceitou faturamento.'; END IF;

  UPDATE public.config_geral SET habilitar_faturamento_os=true;
  PERFORM pg_temp.status_os(v_os,'PAGAMENTO');
  v_erro:=false;
  BEGIN PERFORM pg_temp.titulo(v_os,20);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Pagamento aceitou lançamento com modo ativo.'; END IF;
  v_erro:=false;
  BEGIN UPDATE public.ordemservico SET status='CONCLUIDO' WHERE id=v_os;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Conclusão direta sem cobertura passou.'; END IF;

  SELECT to_jsonb(o)-'status'-'updatedat' INTO v_antes FROM public.ordemservico o WHERE id=v_os;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') INTO v_eventos FROM public.eventos_financeiros e WHERE ordemservicoid=v_os;
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  PERFORM pg_temp.status_os(v_os,'FATURAMENTO');
  IF (SELECT to_jsonb(o)-'status'-'updatedat' FROM public.ordemservico o WHERE id=v_os) <> v_antes THEN
    RAISE EXCEPTION 'Transição alterou dados da OS.';
  END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.eventos_financeiros e WHERE ordemservicoid=v_os) <> v_eventos THEN
    RAISE EXCEPTION 'Transição alterou eventos financeiros.';
  END IF;
  v_t1 := pg_temp.titulo(v_os,40);
  PERFORM pg_temp.status_os(v_os,'FATURAMENTO');
  PERFORM public.transicionar_faturamento_os(v_os,'PAGAMENTO');
  IF NOT EXISTS(SELECT 1 FROM public.transacao WHERE id=v_t1 AND valor=40) THEN RAISE EXCEPTION 'Devolução apagou título.'; END IF;
  -- Baixa de um título existente continua permitida, mesmo na espera pelo cliente.
  UPDATE public.transacao SET pendente=false,banco_id=(SELECT id FROM public.bancoconta WHERE ativo LIMIT 1) WHERE id=v_t1;
  PERFORM pg_temp.status_os(v_os,'PAGAMENTO');
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  v_t2 := pg_temp.titulo(v_os,60);
  PERFORM pg_temp.status_os(v_os,'CONCLUIDO');
  DELETE FROM public.transacao WHERE id=v_t2;
  PERFORM pg_temp.status_os(v_os,'FATURAMENTO');

  -- Adiantamento integral conclui apenas depois de encerrar a execução.
  v_pre := pg_temp.nova_os_teste();
  PERFORM pg_temp.titulo(v_pre,100);
  PERFORM pg_temp.status_os(v_pre,'EM_ANDAMENTO');
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_pre;
  PERFORM public.recalcular_status_financeiro_os(v_pre);
  PERFORM pg_temp.status_os(v_pre,'CONCLUIDO');

  -- Desativação e rollback devolvem filas sem apagar lançamentos/marcos.
  SELECT execucao_fim_em INTO v_fim FROM public.ordemservico WHERE id=v_os;
  BEGIN
    UPDATE public.config_geral SET habilitar_faturamento_os=false;
    PERFORM pg_temp.status_os(v_os,'PAGAMENTO');
    RAISE EXCEPTION 'rollback intencional' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
  IF NOT public.faturamento_os_habilitado() THEN RAISE EXCEPTION 'Rollback perdeu configuração.'; END IF;
  PERFORM pg_temp.status_os(v_os,'FATURAMENTO');
  SELECT count(*) INTO v_notif FROM public.os_notificacao_evento WHERE ordemservico_id=v_os;
  UPDATE public.config_geral SET habilitar_faturamento_os=false;
  PERFORM pg_temp.status_os(v_os,'PAGAMENTO');
  -- Desligar a etapa é decisão administrativa: devolve a fila sem avisar OS por OS.
  IF (SELECT count(*) FROM public.os_notificacao_evento WHERE ordemservico_id=v_os) <> v_notif THEN
    RAISE EXCEPTION 'Devolução em massa gerou notificação.';
  END IF;
  IF (SELECT execucao_fim_em FROM public.ordemservico WHERE id=v_os) IS DISTINCT FROM v_fim THEN RAISE EXCEPTION 'Desativação alterou competência.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transacao WHERE id=v_t1 AND valor=40 AND NOT pendente) THEN RAISE EXCEPTION 'Desativação alterou recebimento.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='ordemservico' AND registro_id=v_os::text AND dados_novos->>'status'='PAGAMENTO' AND dados_anteriores->>'status'='FATURAMENTO') THEN
    RAISE EXCEPTION 'Devolução sem auditoria.';
  END IF;

  UPDATE public.config_geral SET habilitar_faturamento_os=true;
  SELECT count(*) INTO v_notif FROM public.os_notificacao_evento WHERE ordemservico_id=v_os;
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  IF (SELECT count(*) FROM public.os_notificacao_evento WHERE ordemservico_id=v_os) <= v_notif THEN
    RAISE EXCEPTION 'Encaminhamento manual deixou de notificar.';
  END IF;
  PERFORM public.transicionar_faturamento_os(v_os,'PAGAMENTO');
  v_outro := pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_outro;
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  SELECT count(*) INTO v_qtd FROM public.pagamento_multiplo;
  v_erro:=false;
  BEGIN
    PERFORM public.registrar_pagamento_multiplo(jsonb_build_object('tipo_documento','OS','modo','PARCELADO','valor_total',80,'metodopagamento','BOLETO',
      'linhas',jsonb_build_array(jsonb_build_object('documento_id',v_os,'parcela',1,'valor',40),jsonb_build_object('documento_id',v_outro,'parcela',1,'valor',40))));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_erro:=true; END;
  IF NOT v_erro OR (SELECT count(*) FROM public.pagamento_multiplo)<>v_qtd THEN RAISE EXCEPTION 'Múltiplo inválido deixou registro parcial.'; END IF;
  PERFORM public.transicionar_faturamento_os(v_outro,'FATURAMENTO');
  v_grupo:=public.registrar_pagamento_multiplo(jsonb_build_object('tipo_documento','OS','modo','PARCELADO','valor_total',160,'metodopagamento','BOLETO',
    'linhas',jsonb_build_array(jsonb_build_object('documento_id',v_os,'parcela',1,'total_parcelas',1,'valor',60),jsonb_build_object('documento_id',v_outro,'parcela',1,'total_parcelas',1,'valor',100))));
  PERFORM pg_temp.status_os(v_os,'CONCLUIDO');
  PERFORM pg_temp.status_os(v_outro,'CONCLUIDO');

  -- Stone preserva a confirmação externa enquanto aguarda o encaminhamento.
  v_outro:=pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_outro;
  INSERT INTO public.pagamento(ordemservicoid,valor,status,metodo) VALUES(v_outro,10000,'CRIADO','PIX') RETURNING id INTO v_pag;
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}');
  IF NOT EXISTS(SELECT 1 FROM public.pagamento WHERE id=v_pag AND status='PAGO' AND financeiro_pendente AND transacao_os_id IS NULL) THEN
    RAISE EXCEPTION 'Stone perdeu confirmação enquanto a OS aguarda faturamento.';
  END IF;
  PERFORM pg_temp.status_os(v_outro,'PAGAMENTO');
  PERFORM public.transicionar_faturamento_os(v_outro,'FATURAMENTO');
  PERFORM pg_temp.status_os(v_outro,'CONCLUIDO');
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}');
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}');
  PERFORM pg_temp.status_os(v_outro,'CONCLUIDO');
  IF (SELECT count(*) FROM public.transacao WHERE ordemservicoid=v_outro)<>1 THEN RAISE EXCEPTION 'Stone duplicou recebimento.'; END IF;
  RAISE NOTICE 'Dois modos, adiantamento, parcelas, baixas, correções, devoluções, auditoria, notificações, rollback, rateios e Stone verificados.';
END;
$$;
ROLLBACK;
