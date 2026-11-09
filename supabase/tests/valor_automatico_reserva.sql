BEGIN;
DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; r bigint; r_site bigint; e bigint; tx bigint; b bigint; template integer;
  j jsonb; payload jsonb; q jsonb; d date := current_date - 1;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  SELECT id INTO template FROM public.dre_template WHERE ativo ORDER BY versao DESC,id DESC LIMIT 1;
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995005001'),'Teste valor automático da reserva','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste valor automático',pg_temp.cpf('995005002'),actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,created_by)
    VALUES(p,'Imóvel teste valor automático',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,20,10,actor) RETURNING id INTO i;
  INSERT INTO public.bancoconta(titulo,valorinicial,created_at,updated_at) VALUES('Banco teste valor automático',0,now(),now()) RETURNING id INTO b;

  payload:=jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+12,'hospedes',1,'origem','ERP','idempotency_key',gen_random_uuid());
  SET LOCAL ROLE service_role;
  j:=public.imob_salvar_reserva(payload,actor); r:=(j->>'id')::bigint;
  RESET ROLE;
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA' AND status='ATIVO'),
    'criar reserva não lança a receita antes do check-out');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r),'criar reserva ERP não cria cobrança');
  j:=public.imob_salvar_reserva(payload,actor);

  -- Mudar os valores no cadastro antes do check-out continua sem receita.
  payload:=payload||jsonb_build_object('valor_diarias',250,'taxa_limpeza',30);
  j:=public.imob_salvar_reserva(payload,actor,r);
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO',checkin_em=((d-1)+time '14:00') AT TIME ZONE 'America/Fortaleza' WHERE id=r;
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA' AND status='ATIVO'),
    'check-in não lança a receita da reserva');

  -- Pagamento antes do check-out é pagamento/adiantamento: não cria a receita da reserva.
  tx:=public.imob_criar_titulo(i,p,c,100,current_date,10,'TESTE:'||gen_random_uuid(),'Pagamento teste valor automático',actor,r);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA' AND status='ATIVO'),
    'pagamento antes do check-out não lança a receita da reserva');
  PERFORM pg_temp.exigir((SELECT sum(valor)=10 FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx AND status='ATIVO')
    AND (SELECT bool_and(public.dre_linha_do_evento(id,template,'LEGADO',NULL) IS NOT NULL) FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx),'somente a taxa administrativa do pagamento compõe receita na DRE');

  -- Check-out: a receita nasce com o valor vigente e competência no dia da saída registrada.
  UPDATE public.reserva_imovel SET status='CONCLUIDA',checkout_em=(d+time '10:00') AT TIME ZONE 'America/Fortaleza' WHERE id=r;
  SELECT id INTO e FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA';
  PERFORM pg_temp.exigir((SELECT valor=280 AND natureza='RECEITA' AND status='ATIVO' AND NOT pode_gerar_transacao
      AND competencia_em=(d+time '12:00') AT TIME ZONE 'America/Fortaleza' FROM public.eventos_financeiros WHERE id=e),
    'check-out lança a receita da reserva com competência no dia da saída');
  PERFORM pg_temp.exigir((SELECT count(*)=1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA'),'check-out não duplica a receita');
  PERFORM pg_temp.exigir((SELECT resultado='EXCLUIDO' FROM public.eventos_financeiros_classificacao WHERE evento_id=e AND vigente)
    AND public.dre_linha_do_evento(e,template,'LEGADO',NULL) IS NULL
    AND public.dre_linha_do_evento(e,template,'ATIVO',current_date) IS NULL,'valor bruto não entra na receita da DRE em nenhum modo');

  j:=public.imob_alterar_evento_reserva(r,e,'EDITAR','{"valor":275,"descricao":"Valor ajustado no painel"}',actor);
  UPDATE public.reserva_imovel SET checkout_em=checkout_em WHERE id=r;
  PERFORM pg_temp.exigir((SELECT valor=275 AND descricao='Valor ajustado no painel' FROM public.eventos_financeiros WHERE id=e),'edição do registro é preservada após o check-out');
  PERFORM pg_temp.exigir((SELECT resultado='EXCLUIDO' FROM public.eventos_financeiros_classificacao WHERE evento_id=e AND vigente),'editar registro informativo não o transforma em receita da DRE');

  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO' WHERE id=r;
  UPDATE public.reserva_imovel SET status='CONCLUIDA' WHERE id=r;
  PERFORM pg_temp.exigir((SELECT status='CANCELADO' FROM public.eventos_financeiros WHERE id=e)
    AND (SELECT NOT is_deleted AND valor=100 FROM public.transacao WHERE id=tx),'excluir referência não apaga pagamento nem recria registro num novo check-out');

  -- O mesmo gatilho vale para as reservas do site e mantém somente uma cobrança.
  payload:=jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+20,'fim',current_date+22,'hospedes',1,'origem','SITE','idempotency_key',gen_random_uuid());
  SET LOCAL ROLE service_role;
  j:=public.imob_salvar_reserva(payload,actor); r_site:=(j->>'id')::bigint;
  RESET ROLE;
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r_site AND origem='RECEITA_RESERVA' AND status='ATIVO')
    AND (SELECT count(*)=1 FROM public.transacao WHERE reserva_imovel_id=r_site AND NOT is_deleted),'reserva do site não lança receita antes do check-out nem duplica a cobrança');
  PERFORM public.imob_acao_reserva(r_site,'CANCELAR','{"motivo":"Teste","tratamento_financeiro":"MANTER","tratamento_pendentes":"MANTER"}',actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r_site AND origem='RECEITA_RESERVA' AND status='ATIVO'),
    'reserva cancelada não tem receita da reserva');
  -- Mudança de situação sem check-out não cria receita em reservas anteriores.
  SELECT ri.id INTO r FROM public.reserva_imovel ri WHERE payload_hash='teste' AND created_by=actor AND ri.id NOT IN(r_site)
    AND NOT EXISTS(SELECT 1 FROM public.eventos_financeiros e WHERE e.source_type='RESERVA' AND e.source_id=ri.id AND e.origem='RECEITA_RESERVA')
    ORDER BY ri.id LIMIT 1;
  IF r IS NOT NULL THEN
    UPDATE public.reserva_imovel SET status='EM_ANDAMENTO' WHERE id=r;
    PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r AND origem='RECEITA_RESERVA'),'reservas sem check-out não recebem receita em mudanças de situação');
  END IF;
END $test$;
ROLLBACK;
