-- Limpeza do imóvel pedida no check-out (20261118120000). Sempre revertido.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; i2 bigint; r bigint; r2 bigint; r3 bigint; l bigint; j jsonb; recusou boolean;
  situacao text; ontem date;
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
  SELECT id INTO l FROM public.imovel_limpeza WHERE imovel_id=i AND status='PENDENTE';
  PERFORM pg_temp.exigir(l IS NOT NULL AND (SELECT reserva_id=r AND responsavel_id=actor AND solicitada_por=actor FROM public.imovel_limpeza WHERE id=l),
    'check-out abre a limpeza com reserva, responsável e solicitante');
  PERFORM pg_temp.exigir((SELECT descricao='Trocar enxoval completo' FROM public.imovel_limpeza WHERE id=l),'descrição do check-out é gravada sem espaços nas pontas');

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
  PERFORM pg_temp.exigir((SELECT status='CANCELADA' FROM public.imovel_limpeza WHERE id=l)
      AND (SELECT situacao_operacional<>'LIMPEZA' FROM public.imovel_resumo WHERE id=i)
      AND (SELECT checkout_em=(ontem+time '18:00') AT TIME ZONE 'America/Fortaleza' AND checkout_observacoes='Chave na portaria' FROM public.reserva_imovel WHERE id=r),
    'edição do check-out corrige a saída e, desmarcada, cancela a limpeza pendente');
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKOUT',jsonb_build_object('data_registro',ontem,'hora_registro','18:00',
    'solicitar_limpeza',true,'responsavel_limpeza_id',actor,'descricao_limpeza','Trocar enxoval completo'),actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND responsavel_id=actor AND descricao='Trocar enxoval completo' FROM public.imovel_limpeza WHERE id=l)
      AND (SELECT count(*)=1 FROM public.imovel_limpeza WHERE reserva_id=r),'marcar de novo reabre a mesma limpeza');
  PERFORM public.imob_acao_reserva(r,'EDITAR_CHECKOUT',jsonb_build_object('data_registro',ontem,'hora_registro','19:00'),actor);
  PERFORM pg_temp.exigir((SELECT status='PENDENTE' AND descricao='Trocar enxoval completo' FROM public.imovel_limpeza WHERE id=l),
    'edição sem os campos da limpeza não mexe nela');
  PERFORM pg_temp.exigir((SELECT situacao_operacional='LIMPEZA' FROM public.imovel_resumo WHERE id=i),'imóvel com limpeza pendente aparece em LIMPEZA');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='imovel_limpeza' AND registro_id=l::text AND usuario_id=actor),
    'abertura da limpeza é auditada com o operador');

  -- Novo pedido com limpeza aberta reaproveita a existente.
  j:=public.imob_solicitar_limpeza(i,NULL,NULL,actor,'Repor amenities');
  PERFORM pg_temp.exigir((j->>'id')::bigint=l AND (SELECT count(*)=1 FROM public.imovel_limpeza WHERE imovel_id=i AND status='PENDENTE'),
    'segundo pedido reaproveita a limpeza aberta');
  PERFORM pg_temp.exigir((SELECT descricao='Trocar enxoval completo · Repor amenities' FROM public.imovel_limpeza WHERE id=l),
    'descrição do segundo pedido se soma à da limpeza aberta');

  -- Atribuir: tirar e devolver o responsável.
  PERFORM public.imob_acao_limpeza(l,'ATRIBUIR','{"responsavel_id":null}',actor);
  PERFORM pg_temp.exigir((SELECT responsavel_id IS NULL FROM public.imovel_limpeza WHERE id=l),'limpeza pode ficar sem responsável');
  j:=public.imob_solicitar_limpeza(i,NULL,actor,actor);
  PERFORM pg_temp.exigir((SELECT responsavel_id=actor FROM public.imovel_limpeza WHERE id=l),'pedido novo preenche o responsável da limpeza sem responsável');

  -- Concluir devolve o imóvel à situação da agenda; repetir não dá erro.
  PERFORM public.imob_acao_limpeza(l,'CONCLUIR','{"observacoes":"Tudo certo"}',actor);
  PERFORM pg_temp.exigir((SELECT status='CONCLUIDA' AND concluida_por=actor AND concluida_em IS NOT NULL AND observacoes='Tudo certo' FROM public.imovel_limpeza WHERE id=l),
    'conclusão grava quem, quando e a observação');
  SELECT situacao_operacional INTO situacao FROM public.imovel_resumo WHERE id=i;
  PERFORM pg_temp.exigir(situacao IN ('RESERVADO','DISPONIVEL'),'imóvel sai de LIMPEZA ao concluir (agora '||situacao||')');
  PERFORM public.imob_acao_limpeza(l,'CONCLUIR','{}',actor);
  BEGIN
    PERFORM public.imob_acao_limpeza(l,'ATRIBUIR','{"responsavel_id":null}',actor);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'limpeza concluída não muda de responsável');

  -- Check-out sem pedir limpeza não abre nada.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+10,'fim',current_date+12,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r2:=(j->>'id')::bigint;
  PERFORM public.imob_acao_reserva(r2,'CHECKIN','{}',actor);
  PERFORM public.imob_acao_reserva(r2,'CHECKOUT','{"solicitar_limpeza":false}',actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_limpeza WHERE reserva_id=r2)
    AND NOT EXISTS(SELECT 1 FROM public.imovel_limpeza WHERE imovel_id=i AND status='PENDENTE'),'check-out sem limpeza não abre limpeza');

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
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.permissao WHERE nome='limpezas:gerenciar'),'permissão limpezas:gerenciar no catálogo');
END $test$;
ROLLBACK;
