-- Integração real. Sempre ROLLBACK: fixtures não são publicadas nem persistidas.
BEGIN;
CREATE FUNCTION pg_temp.exigir(p_ok boolean,p_mensagem text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_mensagem; END IF; RAISE NOTICE 'OK: %',p_mensagem; END $$;
CREATE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $teste$
DECLARE actor uuid; au uuid:=gen_random_uuid(); au2 uuid:=gen_random_uuid(); own_auth uuid:=gen_random_uuid();
 p bigint; p2 bigint; i bigint; i2 bigint; b bigint; c integer; c2 integer; r bigint; r2 bigint; l bigint; v bigint;
 t bigint; f1 bigint; f2 bigint; rp bigint; q jsonb; j jsonb; payload jsonb; n integer; n2 integer; x numeric; v_email text:=gen_random_uuid()||'@teste.invalid'; v_mov bigint; v_empresa integer; v_nf bigint; i3 bigint;
BEGIN
 SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY createdat LIMIT 1;
 PERFORM pg_temp.exigir(actor IS NOT NULL,'operador interno preservado');
 SELECT count(*) INTO n FROM public.usuario;
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES('00000000-0000-0000-0000-000000000000',au,'authenticated','authenticated',v_email,'',NULL,jsonb_build_object('cpf',pg_temp.cpf('999000001'),'nome','Pessoa Teste','telefone','85999990000','perfilid',(SELECT perfilid FROM public.usuario WHERE id=actor),'setorid',1,'tipo','PROPRIETARIO'),'{}',now(),now());
 PERFORM pg_temp.exigir((SELECT count(*)=n FROM public.usuario),'signup com perfil forjado não cria usuario ERP');
 PERFORM pg_temp.exigir((SELECT tipo='CLIENTE' AND status='PENDENTE' AND cliente_id IS NOT NULL FROM public.site_usuario WHERE user_id=au),'signup ignora tipo proprietário e prepara conta de cliente pendente');
 PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND origem_cadastro='SITE' AND user_id IS NULL FROM public.cliente WHERE id=(SELECT cliente_id FROM public.site_usuario WHERE user_id=au)),'signup cria cliente pendente na lista de clientes');
 j:=public.imob_sincronizar_cliente_site(au);
 PERFORM pg_temp.exigir(j->>'status'='PENDENTE','não vincula cliente antes de confirmar e-mail');
 UPDATE auth.users SET email_confirmed_at=now() WHERE id=au;
 PERFORM pg_temp.exigir((SELECT s.status='ATIVO' AND cl.status='ATIVO' AND cl.user_id=au FROM public.site_usuario s JOIN public.cliente cl ON cl.id=s.cliente_id WHERE s.user_id=au),'confirmação do e-mail ativa cliente sem depender do site');
 SET LOCAL ROLE service_role;
 j:=public.imob_sincronizar_cliente_site(au);
 RESET ROLE;
 c:=(j->>'cliente_id')::integer;
 PERFORM pg_temp.exigir(c IS NOT NULL AND j->>'status'='ATIVO','sincronização funciona como service_role invoker');
 j:=public.imob_sincronizar_cliente_site(au);
 PERFORM pg_temp.exigir((j->>'cliente_id')::integer=c,'sincronização repetida não duplica cliente');
 j:=public.imob_atualizar_perfil_cliente(au,'Pessoa Atualizada','85999990000');
 PERFORM pg_temp.exigir((SELECT nomerazaosocial='Pessoa Atualizada' AND saldo_credito=0 FROM public.cliente WHERE id=c),'perfil externo altera somente contatos permitidos');
 PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='cliente' AND auth_actor_id=au),'auditoria conserva identidade externa');
 INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,email,status) VALUES('FISICA',pg_temp.cpf('999000002'),'Pessoa Atualizada',gen_random_uuid()||'@teste.invalid','ATIVO') RETURNING id INTO c2;
 PERFORM pg_temp.exigir(c2<>c,'homônimos são permitidos sem perder clientes existentes');
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES('00000000-0000-0000-0000-000000000000',au2,'authenticated','authenticated',gen_random_uuid()||'@teste.invalid','',now(),jsonb_build_object('cpf',pg_temp.cpf('999000002'),'nome','Outro Nome','telefone','85999990001'),'{}',now(),now());
 j:=public.imob_sincronizar_cliente_site(au2);
 PERFORM pg_temp.exigir(j->>'status'='PENDENTE' AND j->>'motivo'='CADASTRO_DIVERGENTE','CPF existente com outro e-mail exige resolução ERP');
 PERFORM pg_temp.exigir((SELECT cl.status='ATIVO' AND cl.user_id IS NULL AND s.cliente_id=c2 FROM public.site_usuario s JOIN public.cliente cl ON cl.id=s.cliente_id WHERE s.user_id=au2),'conta divergente aparece no cliente existente sem acessar seu histórico');
 BEGIN PERFORM public.imob_liberar_cadastro_site(c2,NULL); RAISE EXCEPTION 'liberou sem operador'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 j:=public.imob_liberar_cadastro_site(c2,actor);
 PERFORM pg_temp.exigir(j->>'status'='ATIVO' AND (SELECT user_id=au2 FROM public.cliente WHERE id=c2),'liberação no cadastro do cliente vincula a conta');
 BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  VALUES('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',gen_random_uuid()||'@teste.invalid','',jsonb_build_object('cpf',pg_temp.cpf('999000002'),'nome','Terceiro','telefone','85999990002'),'{}',now(),now());
  RAISE EXCEPTION 'aceitou segunda conta para o mesmo CPF';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  VALUES('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',(SELECT email FROM public.cliente WHERE id=c2),'',jsonb_build_object('cpf',pg_temp.cpf('999000005'),'nome','Quarto','telefone','85999990003'),'{}',now(),now());
  RAISE EXCEPTION 'aceitou e-mail de outro cliente';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,email,percentual_admin,created_by) VALUES('Proprietário Teste',pg_temp.cpf('999000003'),gen_random_uuid()||'@teste.invalid',10,actor) RETURNING id INTO p;
 INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,email,created_by) VALUES('Novo Proprietário Teste',pg_temp.cpf('999000004'),gen_random_uuid()||'@teste.invalid',actor) RETURNING id INTO p2;
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES('00000000-0000-0000-0000-000000000000',own_auth,'authenticated','authenticated',(SELECT email FROM public.proprietario WHERE id=p),'',now(),'{}','{}',now(),now());
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.site_usuario WHERE user_id=own_auth),'convite proprietário não cria cliente automaticamente');
 UPDATE public.proprietario SET user_id=own_auth WHERE id=p;
 INSERT INTO public.site_usuario(user_id,tipo,email,proprietario_id,status,created_by) VALUES(own_auth,'PROPRIETARIO',(SELECT email FROM public.proprietario WHERE id=p),p,'ATIVO',actor);
 BEGIN
  UPDATE public.site_usuario SET tipo='PROPRIETARIO',cliente_id=NULL,proprietario_id=p,created_by=NULL WHERE user_id=au;
  RAISE EXCEPTION 'deveria recusar concessão sem ERP';
 EXCEPTION WHEN check_violation THEN NULL; WHEN raise_exception THEN IF SQLERRM NOT LIKE '%concessão pelo ERP%' THEN RAISE; END IF; END;
 PERFORM pg_temp.exigir((SELECT tipo='CLIENTE' FROM public.site_usuario WHERE user_id=au),'cliente não assume papel de proprietário');

 INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,publicado,capacidade,diaria,taxa_limpeza,percentual_admin,valor_locacao,valor_venda,created_by)
 VALUES(p,'Imóvel Teste',gen_random_uuid()::text,ARRAY['TEMPORADA','LOCACAO','VENDA'],true,4,100,20,10,1000,100000,actor) RETURNING id INTO i;
 INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,diaria,capacidade,percentual_admin,created_by)
 VALUES(p,'Imóvel Contrato',gen_random_uuid()::text,ARRAY['TEMPORADA','LOCACAO','VENDA'],100,4,10,actor) RETURNING id INTO i2;
 INSERT INTO public.imovel_tarifa(imovel_id,inicio,fim,diaria,min_noites,prioridade) VALUES(i,current_date+11,current_date+12,200,2,1);
 INSERT INTO public.bancoconta(titulo,created_at,updated_at,valorinicial) VALUES('Banco Teste Imobiliário',now(),now(),0) RETURNING id INTO b;
 q:=public.imob_cotar_reserva(i,current_date+10,current_date+13,2);
 PERFORM pg_temp.exigir((q->>'valor_total')::numeric=420 AND (q->>'noites')::integer=3,'cotação soma tarifa diária e limpeza no servidor');
 UPDATE public.imovel SET diaria=110 WHERE id=i;
 BEGIN
  PERFORM public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+13,'hospedes',2,'origem','SITE','cotacao_id',q->>'cotacao_id','idempotency_key',gen_random_uuid()),au);
  RAISE EXCEPTION 'não rejeitou tarifa alterada';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.imovel SET diaria=100 WHERE id=i;
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.reserva_imovel WHERE imovel_id=i),'preço alterado não cria reserva com cotação antiga');
 BEGIN
  PERFORM public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+13,'hospedes',2,'expected_total',1,'idempotency_key',gen_random_uuid()),actor);
  RAISE EXCEPTION 'não rejeitou expected_total';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 payload:=jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+13,'hospedes',2,'origem','SITE','cotacao_id',q->>'cotacao_id','idempotency_key',gen_random_uuid());
 j:=public.imob_salvar_reserva(payload,au); r:=(j->>'id')::bigint;
 PERFORM pg_temp.exigir(j->>'status'='CONFIRMADA' AND j->>'financeiro_status'='PENDENTE','reserva confirmada bloqueia período sem pagamento ou expiração');
 j:=public.imob_salvar_reserva(payload,au);
 PERFORM pg_temp.exigir((j->>'id')::bigint=r,'repetição de reserva retorna mesmo registro');
 BEGIN PERFORM public.imob_salvar_reserva(payload||jsonb_build_object('hospedes',3),au); RAISE EXCEPTION 'não bloqueou chave divergente'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM public.imob_salvar_reserva(payload||jsonb_build_object('idempotency_key',gen_random_uuid()),au); RAISE EXCEPTION 'não bloqueou conflito'; EXCEPTION WHEN exclusion_violation THEN NULL; END;
 q:=public.imob_cotar_reserva(i,current_date+13,current_date+14,1);
 j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+13,'fim',current_date+14,'hospedes',1,'idempotency_key',gen_random_uuid()),actor); r2:=(j->>'id')::bigint;
 PERFORM pg_temp.exigir(r2<>r,'check-out exclusivo permite nova entrada no mesmo dia');
 BEGIN INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim) VALUES(i,'BLOQUEIO',current_date+10,current_date+11); RAISE EXCEPTION 'não aplicou constraint'; EXCEPTION WHEN exclusion_violation THEN NULL; END;
 PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.imovel_ocupacao'::regclass AND contype='x' AND conname='imovel_ocupacao_sem_sobreposicao'),'exclusion constraint impede conflito mesmo sem validação da API');
 BEGIN PERFORM public.imob_acao_reserva(r2,'CANCELAR',jsonb_build_object('motivo','Teste'),au); RAISE EXCEPTION 'cliente executou ação exclusiva ERP'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i2,'cliente_id',c,'inicio',current_date+100,'fim',current_date+101,'hospedes',1),actor,r2);
 PERFORM pg_temp.exigir((SELECT imovel_id=i2 AND inicio=current_date+100 FROM public.imovel_ocupacao WHERE reserva_id=r2) AND (SELECT imovel_id=i2 AND valor=100 FROM public.transacao WHERE reserva_imovel_id=r2 AND baixa_de_transacao_id IS NULL),'edição pré-financeiro transfere imóvel, preço, título e ocupação');
 j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+13,'fim',current_date+14,'hospedes',1),actor,r2);
 SELECT id INTO t FROM public.transacao WHERE reserva_imovel_id=r AND baixa_de_transacao_id IS NULL AND imovel_natureza='RECEBIMENTO';
 PERFORM pg_temp.exigir(NOT public.transacao_gera_evento_de_resultado(t),'bruto proprietário não entra na DRE');
 j:=public.baixar_transacao_pendente(t,now(),b,'PIX',NULL,NULL,actor,200);
 f1:=(j->>'baixa_id')::bigint;
 PERFORM pg_temp.exigir((SELECT sum(valor)=200 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO'),'baixa parcial registra só dinheiro recebido');
 PERFORM pg_temp.exigir((SELECT sum(valor)=20 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='TAXA_ADMIN'),'taxa incide apenas sobre recebimento parcial');
 PERFORM pg_temp.exigir((SELECT financeiro_status='PARCIAL' FROM public.reserva_imovel WHERE id=r),'status financeiro parcial acompanha baixa genérica');
 BEGIN PERFORM public.imob_salvar_reserva(jsonb_build_object('imovel_id',i2,'cliente_id',c,'inicio',current_date+100,'fim',current_date+101,'hospedes',1),actor,r); RAISE EXCEPTION 'alterou histórico financeiro'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%movimentos financeiros%' THEN RAISE; END IF; END;
 SELECT count(*) INTO n FROM public.imovel_movimento WHERE reserva_id=r;
 UPDATE public.transacao SET updated_at=now() WHERE id=f1;
 PERFORM pg_temp.exigir((SELECT count(*)=n FROM public.imovel_movimento WHERE reserva_id=r),'reexecução de trigger não duplica razão');
 j:=public.baixar_transacao_pendente(t,now(),b,'PIX',NULL,NULL,actor);
 f2:=(j->>'baixa_id')::bigint;
 PERFORM pg_temp.exigir((SELECT sum(valor)=420 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO') AND (SELECT sum(valor)=42 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='TAXA_ADMIN'),'quitação em partes não conta título e filhos duas vezes');
 DELETE FROM public.transacao WHERE id=f1;
 PERFORM pg_temp.exigir((SELECT sum(valor)=220 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO') AND (SELECT count(*)>=3 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO'),'excluir baixa cria estorno e preserva histórico');
 j:=public.baixar_transacao_pendente(t,now(),b,'PIX',NULL,NULL,actor);
 PERFORM pg_temp.exigir((SELECT financeiro_status='PAGO' FROM public.reserva_imovel WHERE id=r),'nova baixa após estorno recompõe total');
 PERFORM pg_temp.exigir((SELECT sum(e.valor)=42 AND bool_and(public.dre_linha_do_evento(e.id,(SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC,id DESC LIMIT 1),'LEGADO',NULL) IS NOT NULL) AND bool_and(public.dre_linha_do_evento(e.id,(SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC,id DESC LIMIT 1),'ATIVO',current_date) IS NOT NULL) FROM public.eventos_financeiros e WHERE source_type='IMOVEL_TAXA' AND status='ATIVO' AND (dados_snapshot->>'reserva_id')::bigint=r),'taxa efetivamente classificada na DRE legada e ativa sem incluir bruto');
 BEGIN PERFORM public.imob_registrar_repasse(jsonb_build_object('imovel_id',i,'proprietario_id',p,'valor',1000,'idempotency_key',gen_random_uuid()),actor); RAISE EXCEPTION 'não bloqueou repasse sem saldo'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 payload:=jsonb_build_object('imovel_id',i,'proprietario_id',p,'valor',100,'idempotency_key',gen_random_uuid(),'banco_id',b,'metodopagamento','PIX');
 j:=public.imob_registrar_repasse(payload,actor); rp:=(j->>'id')::bigint;
 j:=public.imob_registrar_repasse(payload,actor);
 PERFORM pg_temp.exigir((j->>'id')::bigint=rp AND (SELECT sum(valor)=100 FROM public.imovel_movimento WHERE transacao_chave=rp AND tipo='REPASSE'),'repasse baixa e retry atômicos');
 j:=public.imob_registrar_repasse(jsonb_build_object('tipo','DESPESA','imovel_id',i,'proprietario_id',p,'valor',20,'idempotency_key',gen_random_uuid(),'banco_id',b),actor);
 PERFORM pg_temp.exigir((SELECT sum(valor)=20 FROM public.imovel_movimento WHERE imovel_id=i AND tipo='DESPESA_PROPRIETARIO'),'despesa do proprietário compõe extrato sem virar DRE da empresa');
 SELECT id INTO v_empresa FROM public.empresa ORDER BY id LIMIT 1;
 IF v_empresa IS NULL THEN INSERT INTO public.empresa(cnpj,razaosocial,endereco,codigomunicipio,regimetributario) VALUES('11222333000181','Emissora de Teste','Endereço de Teste','2304400','1') RETURNING id INTO v_empresa; END IF;
 SELECT m.id,m.valor INTO v_mov,x FROM public.imovel_movimento m WHERE reserva_id=r AND tipo='TAXA_ADMIN' AND valor>0 AND (SELECT sum(z.valor) FROM public.imovel_movimento z WHERE z.transacao_chave=m.transacao_chave AND z.tipo='TAXA_ADMIN')>=m.valor ORDER BY m.id LIMIT 1;
 SET LOCAL ROLE service_role;
 j:=public.imob_reservar_nfse(ARRAY[v_mov],ARRAY[]::bigint[],v_empresa,jsonb_build_object('cpf_tomador',(SELECT cpfcnpj FROM public.proprietario WHERE id=p),'valor_servico',x),'NACIONAL',gen_random_uuid()::text,actor);
 RESET ROLE;
 v_nf:=(j->>'id')::bigint;
 PERFORM pg_temp.exigir(v_nf IS NOT NULL AND NOT (j->>'already_exists')::boolean AND (SELECT nfse_id=v_nf FROM public.imovel_movimento WHERE id=v_mov),'reserva fiscal atômica vincula apenas taxa administrativa recebida');
 j:=public.imob_reservar_nfse(ARRAY[v_mov],ARRAY[]::bigint[],v_empresa,'{}','NACIONAL',gen_random_uuid()::text,actor);
 PERFORM pg_temp.exigir((j->>'id')::bigint=v_nf AND (j->>'already_exists')::boolean,'repetir emissão conserva referência e não duplica nota');
 BEGIN PERFORM public.imob_reservar_nfse(ARRAY[v_mov],ARRAY[]::bigint[],v_empresa,'{}','NACIONAL',gen_random_uuid()::text,actor,true); RAISE EXCEPTION 'permitiu reemitir processamento incerto'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%rejeição confirmada%' THEN RAISE; END IF; END;
 UPDATE public.nfse SET status='REJEITADA' WHERE id=v_nf;
 j:=public.imob_reservar_nfse(ARRAY[v_mov],ARRAY[]::bigint[],v_empresa,jsonb_build_object('cpf_tomador',(SELECT cpfcnpj FROM public.proprietario WHERE id=p),'valor_servico',x),'NACIONAL',gen_random_uuid()::text,actor,true);
 PERFORM pg_temp.exigir((j->>'id')::bigint=v_nf AND (SELECT status='PROCESSANDO' AND jsonb_array_length(tentativas)=1 FROM public.nfse WHERE id=v_nf),'rejeição confirmada aceita correção e arquiva payload/referência anterior');
 BEGIN PERFORM public.imob_reservar_nfse(ARRAY[(SELECT id FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO' LIMIT 1)],ARRAY[]::bigint[],v_empresa,'{}','NACIONAL',gen_random_uuid()::text,actor); RAISE EXCEPTION 'faturou bruto'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%taxas administrativas%' THEN RAISE; END IF; END;

 j:=public.imob_salvar_locacao(jsonb_build_object('imovel_id',i2,'cliente_id',c,'inicio',current_date,'fim',current_date+90,'valor_mensal',1000,'dia_vencimento',31,'idempotency_key',gen_random_uuid()),actor); l:=(j->>'id')::bigint;
 SELECT count(*) INTO n FROM public.transacao WHERE locacao_imovel_id=l;
 j:=public.imob_gerar_cobrancas_locacao(l);
 PERFORM pg_temp.exigir((j->>'geradas')::integer=0 AND (SELECT count(*)=n FROM public.transacao WHERE locacao_imovel_id=l),'geração mensal repetida não duplica cobranças');
 BEGIN PERFORM public.imob_salvar_reserva(jsonb_build_object('imovel_id',i2,'cliente_id',c,'inicio',current_date+5,'fim',current_date+6,'hospedes',1,'idempotency_key',gen_random_uuid()),actor); RAISE EXCEPTION 'não bloqueou contrato'; EXCEPTION WHEN exclusion_violation THEN NULL; END;
 j:=public.imob_acao_locacao(l,'REAJUSTAR',jsonb_build_object('valor_mensal',1100,'inicio',current_date+30,'proximo_reajuste',current_date+395),actor);
 PERFORM pg_temp.exigir((SELECT valor_inicial=1000 AND jsonb_array_length(reajustes)=1 FROM public.locacao_imovel WHERE id=l),'reajuste mantém valor anterior e vigência');

 j:=public.imob_salvar_venda(jsonb_build_object('imovel_id',i2,'comprador_id',c2,'data_venda',current_date,'valor_total',100000,'comissao_percentual',5,'novo_proprietario_id',p2,'idempotency_key',gen_random_uuid()),actor); v:=(j->>'id')::bigint;
 BEGIN PERFORM public.imob_acao_venda(v,'CONCLUIR','{}',actor); RAISE EXCEPTION 'não exigiu decisão'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%uma decisão%' THEN RAISE; END IF; END;
 j:=public.imob_acao_venda(v,'CONCLUIR',jsonb_build_object('operacoes',jsonb_build_array(jsonb_build_object('tipo','LOCACAO','id',l,'decisao','MANTER','beneficiario_proprietario_id',p2,'vigencia_inicio',current_date))),actor);
 PERFORM pg_temp.exigir(j->>'status'='CONCLUIDA' AND (SELECT vendido_em=current_date AND proprietario_id=p2 AND NOT ('VENDA'=ANY(modalidades)) FROM public.imovel WHERE id=i2),'venda exige decisão e retira oferta de venda');
 PERFORM pg_temp.exigir((SELECT status='ATIVA' AND proprietario_id=p AND beneficiario_futuro_id=p2 FROM public.locacao_imovel WHERE id=l),'venda mantém contrato, snapshot e beneficiário futuro explícito');
 PERFORM pg_temp.exigir((SELECT situacao_comercial='VENDIDO' AND situacao_operacional='ALUGADO' FROM public.imovel_resumo WHERE id=i2),'situação comercial independente da ocupação');
 PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.transacao WHERE venda_imovel_id=v AND imovel_natureza='COMISSAO' AND NOT recurso_terceiros AND valor=5000),'comissão de venda separada dos recursos do proprietário');
 PERFORM pg_temp.exigir((SELECT sum(valor)=100000 FROM public.transacao WHERE venda_imovel_id=v AND imovel_natureza='RECEBIMENTO' AND recurso_terceiros),'venda gera cobrança integral separada da comissão');
 INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades) VALUES(p,'Venda Exclusiva',gen_random_uuid()::text,ARRAY['VENDA']) RETURNING id INTO i3;
 j:=public.imob_salvar_venda(jsonb_build_object('imovel_id',i3,'comprador_id',c2,'data_venda',current_date,'valor_total',1000,'parcelas',jsonb_build_array(jsonb_build_object('valor',400,'vencimento',current_date),jsonb_build_object('valor',600,'vencimento',current_date+30)),'idempotency_key',gen_random_uuid()),actor);
 j:=public.imob_acao_venda((j->>'id')::bigint,'CONCLUIR','{}',actor);
 PERFORM pg_temp.exigir((SELECT count(*)=2 AND sum(valor)=1000 FROM public.transacao WHERE venda_imovel_id=(j->>'id')::bigint AND imovel_natureza='RECEBIMENTO') AND (SELECT NOT publicado AND vendido_em IS NOT NULL AND cardinality(modalidades)=0 FROM public.imovel WHERE id=i3),'parcelas da venda e imóvel exclusivo vendido não violam modalidades');

 j:=public.imob_acao_reserva(r,'CANCELAR',jsonb_build_object('motivo','Teste de reembolso','tratamento_pendentes','CANCELAR_PENDENTES','tratamento_recebidos','ESTORNAR'),actor);
 SELECT id INTO t FROM public.transacao WHERE reserva_imovel_id=r AND imovel_natureza='REEMBOLSO';
 PERFORM pg_temp.exigir(t IS NOT NULL AND (SELECT pendente AND valor=420 FROM public.transacao WHERE id=t),'cancelamento cria reembolso pendente sem fingir saída de caixa');
 PERFORM pg_temp.exigir((SELECT sum(valor)=420 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO'),'cancelar não apaga recebimentos históricos');
 j:=public.baixar_transacao_pendente(t,now(),b,'PIX',NULL,NULL,actor);
 PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='BRUTO_RECEBIDO') AND (SELECT sum(valor)=0 FROM public.imovel_movimento WHERE reserva_id=r AND tipo='TAXA_ADMIN'),'reembolso efetivo reverte bruto e taxa proporcionalmente');
 PERFORM pg_temp.exigir((SELECT sum(CASE WHEN natureza='RECEITA' THEN valor ELSE -valor END)=0 FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND status='ATIVO' AND (dados_snapshot->>'reserva_id')::bigint=r),'DRE deduz taxa devolvida no reembolso efetivo');
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE reserva_id=r AND ativo),'cancelamento libera somente ocupação da reserva');
 PERFORM pg_temp.exigir(NOT has_table_privilege('authenticated','public.cliente','UPDATE') AND NOT has_table_privilege('authenticated','public.cliente','INSERT'),'cliente não escreve saldo/status por Data API');
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='authenticated can upload vistoria'),'política de upload antigo removida');
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'imob\_%' ESCAPE '\' AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))),'nenhuma RPC imobiliária executável pelo navegador');
 PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('proprietario','imovel','site_usuario','reserva_imovel','locacao_imovel','venda_imovel','imovel_movimento','imovel_arquivo') AND (NOT c.relrowsecurity OR has_table_privilege('authenticated',c.oid,'SELECT'))),'tabelas novas com RLS e sem grants externos');
 RAISE NOTICE 'Domínio imobiliário: todos os cenários passaram; ROLLBACK obrigatório.';
END $teste$;
ROLLBACK;
