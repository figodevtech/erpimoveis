BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $test$
DECLARE
  actor uuid;
  c integer;
  p bigint;
  i bigint;
  r bigint;
  r2 bigint;
  e bigint;
  taxa bigint;
  tx bigint;
  pago bigint;
  grupo bigint;
  conta bigint;
  ajuste bigint;
  b integer;
  j jsonb;
  v_versao timestamptz;
  v_pago numeric;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  PERFORM pg_temp.exigir(actor IS NOT NULL,'usuário ativo disponível para testar');
  PERFORM set_config('app.audit_user_id',actor::text,true);
  UPDATE public.config_geral SET habilitar_edicao_transacoes=true;
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status) VALUES('FISICA',pg_temp.cpf('995001001'),'Teste de edição da reserva','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,percentual_admin,created_by)
    VALUES('Proprietário de teste de edição',pg_temp.cpf('995001002'),10,actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,percentual_admin,created_by)
    VALUES(p,'Imóvel de teste de edição',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,10,actor) RETURNING id INTO i;
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,valor_diarias,valor_total,percentual_admin,idempotency_key,payload_hash,created_by)
    VALUES(i,c,p,current_date,current_date+2,1,200,200,10,gen_random_uuid()::text,'teste',actor) RETURNING id INTO r;
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,valor_diarias,valor_total,percentual_admin,idempotency_key,payload_hash,created_by)
    VALUES(i,c,p,current_date+3,current_date+5,1,200,200,10,gen_random_uuid()::text,'teste',actor) RETURNING id INTO r2;
  INSERT INTO public.bancoconta(titulo,valorinicial,created_at,updated_at) VALUES('Banco de teste de edição',0,now(),now()) RETURNING id INTO b;

  -- Custo manual, versão concorrente e isolamento entre reservas.
  j:=public.imob_criar_evento_reserva(r,'Faxina',NULL,100,current_date,actor); e:=(j->>'id')::bigint;
  v_versao:=(j->>'updated_at')::timestamptz;
  j:=public.imob_alterar_evento_reserva(r,e,'EDITAR',jsonb_build_object('valor',120,'descricao','Faxina ajustada','atualizado_em',v_versao),actor);
  PERFORM pg_temp.exigir((j->>'valor')::numeric=120 AND j->>'descricao'='Faxina ajustada','editar custo manual');
  BEGIN
    PERFORM public.imob_alterar_evento_reserva(r,e,'EDITAR',jsonb_build_object('valor',150,'atualizado_em',v_versao),actor);
    RAISE EXCEPTION 'aceitou versão antiga';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM public.imob_alterar_evento_reserva(r2,e,'EDITAR','{"valor":150}',actor);
    RAISE EXCEPTION 'aceitou evento de outra reserva';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- Duas parcelas em aberto: edição mantém o grupo e fecha a soma em centavos.
  grupo:=public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(e),
    'descricao','Faxina','created_by',actor,'pendente',true,'linhas',jsonb_build_array(
      jsonb_build_object('parcela',1,'total_parcelas',2,'valor',60,'vencimento_em',current_date),
      jsonb_build_object('parcela',2,'total_parcelas',2,'valor',60,'vencimento_em',current_date+1))));
  BEGIN
    PERFORM public.imob_alterar_evento_reserva(r,e,'EDITAR','{"valor":140.01}',actor);
    RAISE EXCEPTION 'aceitou editar transações sem permissão';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  j:=public.imob_alterar_evento_reserva(r,e,'EDITAR','{"valor":140.01,"pode_editar_financeiro":true}',actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=140.01 AND count(*)=2 FROM public.transacao WHERE lancamento_id=grupo AND NOT is_deleted),'editar custo convertido rateia as parcelas sem perder centavos');

  -- Com parcela paga: mantém o caixa pago e cria apenas a diferença em aberto.
  SELECT id INTO tx FROM public.transacao WHERE lancamento_id=grupo ORDER BY id LIMIT 1;
  j:=public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  SELECT id INTO pago FROM public.transacao WHERE lancamento_id=grupo AND NOT pendente ORDER BY id LIMIT 1;
  SELECT valor INTO v_pago FROM public.transacao WHERE id=pago;
  j:=public.imob_alterar_evento_reserva(r,e,'EDITAR','{"valor":130.01,"pode_editar_financeiro":true}',actor); ajuste:=(j->>'ajuste_transacao_id')::bigint;
  PERFORM pg_temp.exigir((SELECT tipo::text='RECEITA' AND valor=10 AND pendente AND lancamento_id=grupo FROM public.transacao WHERE id=ajuste),'redução de custo pago cria ajuste a receber');
  PERFORM pg_temp.exigir((SELECT NOT pendente AND valor=v_pago FROM public.transacao WHERE id=pago),'edição preserva pagamento anterior');
  PERFORM pg_temp.exigir((SELECT sum(CASE WHEN tipo::text='DESPESA' THEN valor ELSE -valor END)=130.01 FROM public.transacao WHERE lancamento_id=grupo AND NOT is_deleted AND baixa_de_transacao_id IS NULL),'custo editado e financeiro continuam conciliados');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='TRANSACAO' AND source_id=ajuste),'ajuste de caixa não duplica custo na DRE');

  -- Taxa automática: muda só a taxa, preserva bruto, DRE, histórico e retries/estorno.
  tx:=public.imob_criar_titulo(i,p,c,100,current_date,10,'TESTE:'||gen_random_uuid(),'Recebimento de teste',actor,r);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  SELECT id INTO taxa FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx AND natureza='RECEITA';
  PERFORM pg_temp.exigir((SELECT valor=10 FROM public.eventos_financeiros WHERE id=taxa),'pagamento gera taxa automática');
  j:=public.imob_alterar_evento_reserva(r,taxa,'EDITAR',jsonb_build_object('valor',15,'descricao','Taxa negociada','detalhe','Acordo','data',current_date-2),actor);
  UPDATE public.transacao SET updated_at=clock_timestamp() WHERE id=tx;
  PERFORM pg_temp.exigir((SELECT valor=15 AND descricao='Taxa negociada' AND detalhe='Acordo' AND competencia_em::date=current_date-2 FROM public.eventos_financeiros WHERE id=taxa),'taxa editada e competência sobrevivem à sincronização');
  PERFORM pg_temp.exigir((SELECT valor=100 AND "valorLiquido"=100 FROM public.transacao WHERE id=tx)
    AND (SELECT sum(valor)=100 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='BRUTO_RECEBIDO')
    AND (SELECT sum(valor)=15 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='TAXA_ADMIN'),'ajuste altera extrato e taxa sem mudar pagamento do hóspede');
  PERFORM pg_temp.exigir((SELECT (dados_snapshot->>'taxa_admin_valor_automatico')::numeric=10 AND (dados_snapshot->>'taxa_admin_ajustada')::boolean FROM public.eventos_financeiros WHERE id=taxa),'snapshot guarda cálculo original e ajuste');
  UPDATE public.transacao SET is_deleted=true WHERE id=tx;
  PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='TAXA_ADMIN')
    AND (SELECT status='CANCELADO' AND valor=0 FROM public.eventos_financeiros WHERE id=taxa),'estorno do recebimento também estorna a taxa ajustada');

  tx:=public.imob_criar_titulo(i,p,c,20,current_date,10,'TESTE:'||gen_random_uuid(),'Reembolso de teste',actor,r,NULL,NULL,'REEMBOLSO');
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  SELECT id INTO taxa FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx AND natureza='DESPESA';
  j:=public.imob_alterar_evento_reserva(r,taxa,'EDITAR','{"valor":3}',actor);
  UPDATE public.transacao SET updated_at=clock_timestamp() WHERE id=tx;
  PERFORM pg_temp.exigir((SELECT valor=3 AND natureza='DESPESA' FROM public.eventos_financeiros WHERE id=taxa)
    AND (SELECT sum(valor)=-3 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='TAXA_ADMIN'),'estorno automático da taxa também permite edição');

  -- Consumo: editar seu custo não repete nem desfaz a saída física do estoque.
  j:=public.imob_criar_evento_reserva(r,'Material',NULL,5,current_date,actor); tx:=(j->>'id')::bigint;
  UPDATE public.eventos_financeiros SET origem='CONSUMO',pode_gerar_transacao=false WHERE id=tx;
  j:=public.imob_alterar_evento_reserva(r,tx,'EDITAR','{"valor":8,"descricao":"Material ajustado"}',actor);
  PERFORM pg_temp.exigir((j->>'valor')::numeric=8 AND (j->>'pode_gerar_transacao')::boolean=false,'custo de consumo também pode ser editado');

  -- Conta do proprietário antes/depois do caixa e estorno posterior à edição.
  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',50,'descricao','Repasse de teste','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  j:=public.imob_editar_lancamento_reserva(r,conta,'{"valor":60,"descricao":"Repasse ajustado"}',actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=60 FROM public.imovel_movimento WHERE lancamento_id=conta),'editar repasse corrige saldo preservando razão');
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
    VALUES('Repasse no caixa',60,60,now(),'DESPESA',true,true,actor,'Proprietário','NAO INFORMADO') RETURNING id INTO tx;
  PERFORM public.imob_vincular_lancamento(conta,tx);
  j:=public.imob_editar_lancamento_reserva(r,conta,'{"valor":70,"pode_editar_financeiro":true}',actor);
  PERFORM pg_temp.exigir((SELECT valor=70 FROM public.transacao WHERE id=tx),'editar repasse em aberto atualiza transação vinculada');
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  j:=public.imob_editar_lancamento_reserva(r,conta,'{"valor":65,"pode_editar_financeiro":true}',actor); ajuste:=(j->>'ajuste_transacao_id')::bigint;
  PERFORM pg_temp.exigir((SELECT tipo::text='RECEITA' AND valor=5 AND pendente AND recurso_terceiros AND imovel_lancamento_contabil_id=conta FROM public.transacao WHERE id=ajuste),'repasse pago recebe ajuste fora da DRE');
  PERFORM pg_temp.exigir((SELECT sum(valor)=65 FROM public.imovel_movimento WHERE lancamento_id=conta),'saldo do proprietário acompanha edição de repasse pago');
  BEGIN
    PERFORM public.imob_editar_lancamento_reserva(r2,conta,'{"valor":30}',actor);
    RAISE EXCEPTION 'aceitou conta de outra reserva';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','DESPESA_PROPRIETARIO','valor',30,'descricao','Limpeza do proprietário','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  j:=public.imob_editar_lancamento_reserva(r,conta,'{"valor":25}',actor);
  PERFORM public.imob_cancelar_lancamento(conta,actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE lancamento_id=conta),'despesa do proprietário pode ser editada e depois estornada pelo valor corrigido');

  PERFORM pg_temp.exigir(NOT has_function_privilege('anon','public.imob_alterar_evento_reserva(bigint,bigint,text,jsonb,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.imob_editar_lancamento_reserva(bigint,bigint,jsonb,uuid)','EXECUTE'),'edição restrita às APIs do ERP');
END $test$;

ROLLBACK;
