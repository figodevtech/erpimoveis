-- Serviços do imóvel (20261118120000 a 20261119160000): limpeza do check-out e demais tipos. Sempre revertido.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; i2 bigint; r bigint; r2 bigint; r3 bigint; l bigint; j jsonb; recusou boolean;
  situacao text; ontem date; l2 bigint; sl integer; sm integer; i3 bigint; s1 bigint; s2 bigint; l3 bigint;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  PERFORM pg_temp.exigir(actor IS NOT NULL,'usuário ativo disponível para testar');
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995118001'),'Teste limpeza do imóvel','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste limpeza',pg_temp.cpf('995118002'),actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,created_by)
    VALUES(p,'Imóvel teste limpeza',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,20,10,actor) RETURNING id INTO i;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,created_by)
    VALUES(p,'Imóvel teste limpeza 2',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,20,10,actor) RETURNING id INTO i2;

  -- Hospedagem de hoje: no check-in o imóvel fica OCUPADO.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date,'fim',current_date+2,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r:=(j->>'id')::bigint;
  PERFORM public.imob_acao_reserva(r,'CHECKIN','{"observacoes":"  Hóspede chegou com 1 pet  "}',actor);
  PERFORM pg_temp.exigir((SELECT situacao_operacional='OCUPADO' FROM public.imovel_resumo WHERE id=i),'check-in deixa o imóvel ocupado');
  PERFORM pg_temp.exigir((SELECT checkin_por=actor AND checkin_observacoes='Hóspede chegou com 1 pet' FROM public.reserva_imovel WHERE id=r),
    'check-in grava quem registrou e as observações');

  -- Responsável inexistente ou inativo é recusado e o check-out inteiro volta atrás.
  BEGIN
    PERFORM public.imob_acao_reserva(r,'CHECKOUT',jsonb_build_object('solicitar_limpeza',true,'responsavel_limpeza_id',gen_random_uuid()),actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou AND (SELECT status='EM_ANDAMENTO' FROM public.reserva_imovel WHERE id=r),'responsável que não é usuário ativo é recusado');

  -- Check-out com limpeza: o imóvel vai para LIMPEZA, mesmo com a ocupação ativa até o fim previsto.
  PERFORM public.imob_acao_reserva(r,'CHECKOUT',jsonb_build_object('solicitar_limpeza',true,'responsavel_limpeza_id',actor,
    'descricao_limpeza','  Trocar enxoval completo  ','observacoes','Chave entregue na portaria'),actor);
  PERFORM pg_temp.exigir((SELECT checkout_por=actor AND checkout_observacoes='Chave entregue na portaria'
      AND checkin_observacoes='Hóspede chegou com 1 pet' FROM public.reserva_imovel WHERE id=r),
    'check-out grava quem registrou e as observações, sem apagar as do check-in');
  SELECT id INTO l FROM public.imovel_servico WHERE imovel_id=i AND status='PENDENTE';
  PERFORM pg_temp.exigir(l IS NOT NULL AND (SELECT reserva_id=r AND responsavel_id=actor AND solicitada_por=actor FROM public.imovel_servico WHERE id=l),
    'check-out abre a limpeza com reserva, responsável e solicitante');
  PERFORM pg_temp.exigir((SELECT descricao='Trocar enxoval completo' FROM public.imovel_servico WHERE id=l),'descrição do check-out é gravada sem espaços nas pontas');

  -- Edição do check-in: momento e observações mudam; quem registrou, não.
  ontem:=(now() AT TIME ZONE 'America/Fortaleza')::date-1;
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKIN',jsonb_build_object('data_registro',ontem,'hora_registro','10:00','observacoes','Chegou com 2 pets'),actor);
  PERFORM pg_temp.exigir((SELECT checkin_em=(ontem+time '10:00') AT TIME ZONE 'America/Fortaleza' AND checkin_observacoes='Chegou com 2 pets'
      AND checkin_por=actor AND status='CONCLUIDA' FROM public.reserva_imovel WHERE id=r),'edição do check-in corrige momento e observações sem mudar a situação');
  BEGIN
    PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKIN',jsonb_build_object('data_registro',(now() AT TIME ZONE 'America/Fortaleza')::date+1,'hora_registro','10:00'),actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'check-in editado não pode ficar depois do check-out nem no futuro');

  -- Edição do check-out: desmarcar cancela a limpeza pendente; marcar de novo a reabre.
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKOUT',jsonb_build_object('data_registro',ontem,'hora_registro','18:00',
    'observacoes','Chave na portaria','solicitar_limpeza',false),actor);
  PERFORM pg_temp.exigir((SELECT status='CANCELADA' FROM public.imovel_servico WHERE id=l)
      AND (SELECT situacao_operacional<>'LIMPEZA' FROM public.imovel_resumo WHERE id=i)
      AND (SELECT checkout_em=(ontem+time '18:00') AT TIME ZONE 'America/Fortaleza' AND checkout_observacoes='Chave na portaria' FROM public.reserva_imovel WHERE id=r),
    'edição do check-out corrige a saída e, desmarcada, cancela a limpeza pendente');
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKOUT',jsonb_build_object('data_registro',ontem,'hora_registro','18:00',
    'solicitar_limpeza',true,'responsavel_limpeza_id',actor,'descricao_limpeza','Trocar enxoval completo'),actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND responsavel_id=actor AND descricao='Trocar enxoval completo' FROM public.imovel_servico WHERE id=l)
      AND (SELECT count(*)=1 FROM public.imovel_servico WHERE reserva_id=r),'marcar de novo reabre a mesma limpeza');
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKOUT',jsonb_build_object('data_registro',ontem,'hora_registro','19:00'),actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND descricao='Trocar enxoval completo' FROM public.imovel_servico WHERE id=l),
    'edição sem os campos da limpeza não mexe nela');
  PERFORM pg_temp.exigir((SELECT situacao_operacional='LIMPEZA' FROM public.imovel_resumo WHERE id=i),'imóvel com limpeza pendente aparece em LIMPEZA');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='imovel_servico' AND registro_id=l::text AND usuario_id=actor),
    'abertura da limpeza é auditada com o operador');

  -- Novo pedido com limpeza aberta reaproveita a existente.
  j:=public.imob_solicitar_limpeza(i,NULL,NULL,actor,'Repor amenities');
  PERFORM pg_temp.exigir((j->>'id')::bigint=l AND (SELECT count(*)=1 FROM public.imovel_servico WHERE imovel_id=i AND status='PENDENTE'),
    'segundo pedido reaproveita a limpeza aberta');
  PERFORM pg_temp.exigir((SELECT descricao='Trocar enxoval completo · Repor amenities' FROM public.imovel_servico WHERE id=l),
    'descrição do segundo pedido se soma à da limpeza aberta');

  -- Atribuir: tirar e devolver o responsável.
  PERFORM public.imob_acao_servico(l,'ATRIBUIR','{"responsavel_id":null}',actor);
  PERFORM pg_temp.exigir((SELECT responsavel_id IS NULL FROM public.imovel_servico WHERE id=l),'limpeza pode ficar sem responsável');
  j:=public.imob_solicitar_limpeza(i,NULL,actor,actor);
  PERFORM pg_temp.exigir((SELECT responsavel_id=actor FROM public.imovel_servico WHERE id=l),'pedido novo preenche o responsável da limpeza sem responsável');

  -- Concluir devolve o imóvel à situação da agenda; repetir não dá erro.
  PERFORM public.imob_acao_servico(l,'CONCLUIR','{"observacoes":"Tudo certo"}',actor);
  PERFORM pg_temp.exigir((SELECT status='CONCLUIDA' AND concluida_por=actor AND concluida_em IS NOT NULL AND observacoes='Tudo certo' FROM public.imovel_servico WHERE id=l),
    'conclusão grava quem, quando e a observação');
  SELECT situacao_operacional INTO situacao FROM public.imovel_resumo WHERE id=i;
  PERFORM pg_temp.exigir(situacao IN ('RESERVADO','DISPONIVEL'),'imóvel sai de LIMPEZA ao concluir (agora '||situacao||')');
  PERFORM public.imob_acao_servico(l,'CONCLUIR','{}',actor);
  BEGIN
    PERFORM public.imob_acao_servico(l,'ATRIBUIR','{"responsavel_id":null}',actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'limpeza concluída não muda de responsável');

  -- Voltar para pendente: a conclusão sai e o imóvel volta para LIMPEZA.
  PERFORM public.imob_acao_servico(l,'REABRIR','{}',actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND concluida_em IS NULL AND concluida_por IS NULL AND observacoes IS NULL FROM public.imovel_servico WHERE id=l)
      AND (SELECT situacao_operacional='LIMPEZA' FROM public.imovel_resumo WHERE id=i),'voltar para pendente reabre a limpeza e o imóvel volta a LIMPEZA');
  PERFORM public.imob_acao_servico(l,'CONCLUIR','{}',actor);
  -- Com outra limpeza aberta no imóvel, reabrir é recusado.
  l2:=(public.imob_solicitar_limpeza(i,NULL,NULL,actor)->>'id')::bigint;
  BEGIN
    PERFORM public.imob_acao_servico(l,'REABRIR','{}',actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou AND (SELECT status='CONCLUIDA' FROM public.imovel_servico WHERE id=l),'não reabre com outra limpeza pendente no imóvel');
  PERFORM public.imob_acao_servico(l2,'CONCLUIR','{}',actor);

  -- Editar o serviço: descrição, responsável, observações e momento da conclusão.
  -- O pedido vai para ontem de manhã, para a conclusão de ontem à tarde caber depois dele.
  UPDATE public.imovel_servico SET solicitada_em=(ontem+time '08:00') AT TIME ZONE 'America/Fortaleza' WHERE id=l;
  PERFORM public.imob_acao_servico(l,'EDITAR',jsonb_build_object('descricao','  Lavar cortinas  ','responsavel_id',NULL,
    'observacoes','Faltou sabão','data_conclusao',ontem,'hora_conclusao','16:30'),actor);
  PERFORM pg_temp.exigir((SELECT descricao='Lavar cortinas' AND responsavel_id IS NULL AND observacoes='Faltou sabão' AND status='CONCLUIDA'
      AND concluida_em=(ontem+time '16:30') AT TIME ZONE 'America/Fortaleza'
      FROM public.imovel_servico WHERE id=l),'editar muda descrição, responsável, observações e conclusão sem mudar a situação');
  BEGIN
    PERFORM public.imob_acao_servico(l,'EDITAR',jsonb_build_object('data_conclusao',ontem,'hora_conclusao','07:00'),actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'conclusão antes do pedido é recusada');
  PERFORM public.imob_acao_servico(l,'EDITAR','{"descricao":"Só a descrição"}',actor);
  PERFORM pg_temp.exigir((SELECT descricao='Só a descrição' AND observacoes='Faltou sabão' FROM public.imovel_servico WHERE id=l),
    'campo ausente no payload fica como está');
  BEGIN
    PERFORM public.imob_acao_servico(l,'EDITAR',jsonb_build_object('data_conclusao',(now() AT TIME ZONE 'America/Fortaleza')::date+1,'hora_conclusao','10:00'),actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'conclusão no futuro é recusada');

  -- Check-out sem pedir limpeza não abre nada.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+12,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r2:=(j->>'id')::bigint;
  PERFORM public.imob_acao_reserva(r2,'CHECKIN','{}',actor);
  PERFORM public.imob_acao_reserva(r2,'CHECKOUT','{"solicitar_limpeza":false}',actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_servico WHERE reserva_id=r2)
    AND NOT EXISTS(SELECT 1 FROM public.imovel_servico WHERE imovel_id=i AND status='PENDENTE'),'check-out sem limpeza não abre limpeza');

  -- Hóspede novo em check-in vence a limpeza pendente: o imóvel aparece OCUPADO.
  PERFORM public.imob_solicitar_limpeza(i2,NULL,NULL,actor);
  PERFORM pg_temp.exigir((SELECT situacao_operacional='LIMPEZA' FROM public.imovel_resumo WHERE id=i2),'limpeza sem reserva também deixa o imóvel em LIMPEZA');
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i2,'cliente_id',c,'inicio',current_date,'fim',current_date+2,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r3:=(j->>'id')::bigint;
  PERFORM public.imob_acao_reserva(r3,'CHECKIN','{}',actor);
  PERFORM pg_temp.exigir((SELECT situacao_operacional='OCUPADO' FROM public.imovel_resumo WHERE id=i2),'hóspede em check-in tem precedência sobre a limpeza');

  -- Configuração: padrão é sempre solicitar, sem responsável.
  PERFORM pg_temp.exigir((SELECT limpeza_sempre_solicitar FROM public.config_geral ORDER BY id DESC LIMIT 1) IS NOT FALSE,
    'configuração nasce com "Sempre solicitar limpeza" ligado');

  -- Catálogo: a limpeza do sistema existe, os pedidos de limpeza apontam para ela e ela não sai do
  -- catálogo, não fica inativa nem muda de código. A descrição pode mudar.
  sl:=public.imob_servico_limpeza_id();
  PERFORM pg_temp.exigir(sl IS NOT NULL AND (SELECT ativo AND chave_sistema='LIMPEZA' FROM public.servico WHERE id=sl),'serviço Limpeza do sistema no catálogo');
  PERFORM pg_temp.exigir((SELECT bool_and(servico_id=sl) FROM public.imovel_servico WHERE imovel_id IN (i,i2)),'pedidos de limpeza ficam com o serviço Limpeza');
  BEGIN
    UPDATE public.servico SET ativo=false WHERE id=sl;
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'limpeza do sistema não pode ser desativada');
  BEGIN
    UPDATE public.servico SET codigo='LIMPEZA-2' WHERE id=sl;
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'limpeza do sistema não muda de código');
  BEGIN
    DELETE FROM public.servico WHERE id=sl;
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou AND EXISTS(SELECT 1 FROM public.servico WHERE id=sl),'limpeza do sistema não pode ser excluída');
  UPDATE public.servico SET descricao='Limpeza completa' WHERE id=sl;
  PERFORM pg_temp.exigir((SELECT descricao='Limpeza completa' FROM public.servico WHERE id=sl),'descrição da limpeza do sistema pode mudar');

  -- Outro tipo de serviço: vários pendentes no mesmo imóvel, sem mudar a situação dele.
  INSERT INTO public.servico(codigo,descricao,precohora,ativo)
    VALUES('TESTE-'||left(gen_random_uuid()::text,8),'Manutenção teste',0,true) RETURNING id INTO sm;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,created_by)
    VALUES(p,'Imóvel teste serviços',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,20,10,actor) RETURNING id INTO i3;
  SELECT situacao_operacional INTO situacao FROM public.imovel_resumo WHERE id=i3;
  s1:=(public.imob_solicitar_servico(i3,sm,NULL,actor,actor,'  Trocar chuveiro  ',now()+interval '1 day')->>'id')::bigint;
  s2:=(public.imob_solicitar_servico(i3,sm,NULL,NULL,actor,'Pintar parede',NULL)->>'id')::bigint;
  PERFORM pg_temp.exigir(s1<>s2 AND (SELECT count(*)=2 FROM public.imovel_servico WHERE imovel_id=i3 AND status='PENDENTE'),
    'outro tipo de serviço abre um pedido novo a cada vez, sem limite de pendentes');
  PERFORM pg_temp.exigir((SELECT situacao_operacional FROM public.imovel_resumo WHERE id=i3)=situacao,'serviço que não é limpeza não muda a situação do imóvel');
  PERFORM pg_temp.exigir((SELECT servico_id=sm AND prazo_em IS NOT NULL AND descricao='Trocar chuveiro' AND responsavel_id=actor AND solicitada_por=actor
      FROM public.imovel_servico WHERE id=s1),'pedido grava tipo, prazo, descrição, responsável e solicitante');
  BEGIN
    PERFORM public.imob_solicitar_servico(i3,sm,NULL,NULL,actor,NULL,now()-interval '1 day');
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'prazo no passado é recusado no pedido');
  BEGIN
    PERFORM public.imob_acao_servico(s1,'EDITAR',jsonb_build_object('prazo_em',(now()-interval '2 days')::text),actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'prazo antes do pedido é recusado na edição');
  PERFORM public.imob_acao_servico(s1,'EDITAR','{"prazo_em":""}',actor);
  PERFORM pg_temp.exigir((SELECT prazo_em IS NULL AND descricao='Trocar chuveiro' FROM public.imovel_servico WHERE id=s1),'prazo vazio na edição limpa o prazo e mantém o resto');
  PERFORM public.imob_acao_servico(s1,'CONCLUIR','{}',actor);
  PERFORM public.imob_acao_servico(s1,'REABRIR','{}',actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' FROM public.imovel_servico WHERE id=s1),'reabrir outro tipo de serviço não depende dos outros pendentes do imóvel');

  -- Limpeza ao lado deles: continua única, fica com o prazo mais curto e leva o imóvel a LIMPEZA.
  l3:=(public.imob_solicitar_servico(i3,sl,NULL,NULL,actor,'Limpeza pós-obra',now()+interval '2 days')->>'id')::bigint;
  j:=public.imob_solicitar_servico(i3,sl,NULL,NULL,actor,NULL,now()+interval '1 day');
  PERFORM pg_temp.exigir((j->>'id')::bigint=l3 AND (SELECT count(*)=1 FROM public.imovel_servico WHERE imovel_id=i3 AND servico_id=sl AND status='PENDENTE'),
    'limpeza continua única por imóvel ao lado de outros serviços');
  PERFORM pg_temp.exigir((SELECT prazo_em < now()+interval '36 hours' FROM public.imovel_servico WHERE id=l3),'novo pedido de limpeza com prazo menor encurta o prazo');
  PERFORM pg_temp.exigir((SELECT situacao_operacional='LIMPEZA' FROM public.imovel_resumo WHERE id=i3),'limpeza pedida pelo imóvel leva à situação LIMPEZA');
  PERFORM public.imob_acao_servico(l3,'CONCLUIR','{}',actor);
  PERFORM pg_temp.exigir((SELECT situacao_operacional=situacao FROM public.imovel_resumo WHERE id=i3),'serviços pendentes de outro tipo não seguram o imóvel em LIMPEZA');

  UPDATE public.servico SET ativo=false WHERE id=sm;
  BEGIN
    PERFORM public.imob_solicitar_servico(i3,sm,NULL,NULL,actor,NULL,NULL);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'serviço inativo não pode ser pedido');

  -- Permissões da Execução.
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.permissao WHERE nome='limpezas:gerenciar'),'limpezas:gerenciar saiu do catálogo');
  PERFORM pg_temp.exigir((SELECT count(*)=3 FROM public.permissao WHERE nome IN ('execucao:visualizar','execucao:ver_todas','execucao:trocar_realizador')),
    'permissões da Execução no catálogo');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.perfil WHERE nome='Administrador')
      OR (SELECT count(*)=3 FROM public.perfil pf JOIN public.perfilpermissao pp ON pp.perfilid=pf.id JOIN public.permissao pe ON pe.id=pp.permissaoid
           WHERE pf.nome='Administrador' AND pe.nome LIKE 'execucao:%'),
    'Administrador com as três permissões da Execução');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.perfil pf JOIN public.perfilpermissao pp ON pp.perfilid=pf.id JOIN public.permissao pe ON pe.id=pp.permissaoid
      WHERE pf.nome='Prestador de serviço' AND pe.nome='execucao:visualizar'),'perfil Prestador de serviço com a Execução');
END $test$;
ROLLBACK;
