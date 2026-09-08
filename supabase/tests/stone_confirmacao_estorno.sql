-- Fixtures isoladas na demonstração, com rollback inclusive em caso de falha.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.nova_os_teste() RETURNS integer LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION pg_temp.titulo(p_os integer,p_valor numeric) RETURNS bigint LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION pg_temp.status_os(p_os integer,p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status::text FROM public.ordemservico WHERE id=p_os) IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'OS % deveria estar em %, encontrado %',p_os,p_status,(SELECT status FROM public.ordemservico WHERE id=p_os);
  END IF;
END;
$$;
DO $$
DECLARE v_os integer; v_pag bigint; v_tx bigint; v_qtd bigint; v_modo boolean; v_data timestamptz;
BEGIN
  FOREACH v_modo IN ARRAY ARRAY[true,false] LOOP
    UPDATE public.config_geral SET habilitar_faturamento_os=v_modo;
    v_os:=pg_temp.nova_os_teste();
    UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_os;
    IF v_modo THEN PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO'); END IF;
    INSERT INTO public.pagamento(ordemservicoid,valor,status,metodo) VALUES(v_os,10000,'CRIADO','PIX') RETURNING id INTO v_pag;
    PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}',true);
    SELECT transacao_os_id INTO v_tx FROM public.pagamento WHERE id=v_pag;
    IF v_tx IS NULL THEN RAISE EXCEPTION 'Recebimento não foi registrado.'; END IF;
    PERFORM public.confirmar_pagamento_stone_os(v_pag,'ESTORNADO','TESTE','{}');
    PERFORM public.confirmar_pagamento_stone_os(v_pag,'ESTORNADO','TESTE','{}');
    PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE_ATRASADO','{}');
    IF NOT EXISTS(SELECT 1 FROM public.transacao WHERE id=v_tx AND is_deleted AND pendente) THEN RAISE EXCEPTION 'Recebimento estornado continua no caixa.'; END IF;
    IF (SELECT count(*) FROM public.transacao_baixa_historico WHERE transacao_id=v_tx AND operacao='ESTORNO')<>1 THEN RAISE EXCEPTION 'Histórico de estorno ausente ou duplicado.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.pagamento WHERE id=v_pag AND status='ESTORNADO' AND NOT financeiro_pendente) THEN RAISE EXCEPTION 'Webhook atrasado reativou estorno.'; END IF;
    PERFORM pg_temp.status_os(v_os,CASE WHEN v_modo THEN 'FATURAMENTO' ELSE 'PAGAMENTO' END);
    IF (SELECT valor_comprometido FROM public.resumo_financeiro_os(v_os))<>0 THEN RAISE EXCEPTION 'Estorno não liberou cobertura.'; END IF;
  END LOOP;

  -- Confirmação após ativação: só o encaminhamento registra, sem novo webhook.
  UPDATE public.config_geral SET habilitar_faturamento_os=true;
  v_os:=pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_os;
  INSERT INTO public.pagamento(ordemservicoid,valor,status,metodo) VALUES(v_os,10000,'CRIADO','PIX') RETURNING id INTO v_pag;
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}',false);
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE_DUPLICADO','{}',false);
  SELECT confirmado_em INTO v_data FROM public.pagamento WHERE id=v_pag;
  IF (SELECT count(*) FROM public.transacao WHERE ordemservicoid=v_os)<>0 THEN RAISE EXCEPTION 'Registrou antes do faturamento.'; END IF;
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  IF (SELECT count(*) FROM public.transacao WHERE ordemservicoid=v_os AND data=v_data)<>1 THEN RAISE EXCEPTION 'Recebimento pendente duplicado ou com data alterada.'; END IF;
  PERFORM pg_temp.status_os(v_os,'CONCLUIDO');

  -- Estorno antes de liberar o faturamento nunca pode criar receita depois.
  v_os:=pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_os;
  INSERT INTO public.pagamento(ordemservicoid,valor,status,metodo) VALUES(v_os,10000,'CRIADO','PIX') RETURNING id INTO v_pag;
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}');
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'ESTORNADO','TESTE','{}');
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  IF EXISTS(SELECT 1 FROM public.transacao WHERE ordemservicoid=v_os) THEN RAISE EXCEPTION 'Cobrança estornada gerou receita ao encaminhar.'; END IF;

  -- Falha financeira não perde a confirmação e pode ser retomada explicitamente.
  INSERT INTO public.pagamento(ordemservicoid,valor,status,metodo) VALUES(v_os,10000,'CRIADO','METODO_INVALIDO') RETURNING id INTO v_pag;
  PERFORM public.confirmar_pagamento_stone_os(v_pag,'PAGO','TESTE','{}');
  IF NOT EXISTS(SELECT 1 FROM public.pagamento WHERE id=v_pag AND status='PAGO' AND financeiro_pendente AND financeiro_erro IS NOT NULL) THEN RAISE EXCEPTION 'Falha financeira perdeu confirmação ou pendência.'; END IF;
  UPDATE public.pagamento SET metodo='PIX' WHERE id=v_pag;
  PERFORM public.conciliar_financeiro_stone_os(v_pag);
  PERFORM pg_temp.status_os(v_os,'CONCLUIDO');

  -- Salvar uma alteração concorrente com valor original divergente não devolve OS.
  v_os:=pg_temp.nova_os_teste();
  UPDATE public.ordemservico SET status='PAGAMENTO' WHERE id=v_os;
  PERFORM public.transicionar_faturamento_os(v_os,'FATURAMENTO');
  UPDATE public.config_geral SET habilitar_faturamento_os=false WHERE habilitar_faturamento_os=false;
  GET DIAGNOSTICS v_qtd=ROW_COUNT;
  IF v_qtd<>0 OR NOT public.faturamento_os_habilitado() THEN RAISE EXCEPTION 'Comparação concorrente alterou configuração.'; END IF;
  PERFORM pg_temp.status_os(v_os,'FATURAMENTO');
  RAISE NOTICE 'Stone: estorno nos dois modos, repetição, atraso, confirmação pendente, conciliação automática e conflito de configuração passaram.';
END;
$$;
ROLLBACK;
