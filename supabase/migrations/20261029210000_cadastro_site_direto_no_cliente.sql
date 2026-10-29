-- Cadastro do site sem fila própria: a conta cria (ou aponta) o cliente no ato e a situação
-- aparece na lista de Clientes. Pendente até a confirmação do e-mail, que ativa o cliente.
-- CPF já cadastrado com outro e-mail fica pendente no próprio cliente até a liberação no ERP.
ALTER TABLE public.cliente ADD COLUMN origem_cadastro text NOT NULL DEFAULT 'ERP' CHECK(origem_cadastro IN ('ERP','SITE'));
UPDATE public.cliente c SET origem_cadastro='SITE' FROM public.site_usuario s WHERE s.cliente_id=c.id AND s.tipo='CLIENTE';

CREATE FUNCTION public.imob_registrar_cadastro_site(p_auth_id uuid) RETURNS public.site_usuario LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a record; s public.site_usuario%ROWTYPE; c public.cliente%ROWTYPE; v_cpf text; v_email text; v_nome text; v_tel text; v_id integer;
BEGIN
 SELECT id,email,raw_user_meta_data INTO a FROM auth.users WHERE id=p_auth_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.site_usuario WHERE user_id=p_auth_id;
 IF FOUND THEN RETURN s; END IF;
 v_cpf:=regexp_replace(coalesce(a.raw_user_meta_data->>'cpf',''),'[^0-9]','','g'); v_email:=lower(a.email);
 v_nome:=left(btrim(coalesce(a.raw_user_meta_data->>'nome','')),150); v_tel:=btrim(coalesce(a.raw_user_meta_data->>'telefone',''));
 IF NOT public.imob_cpf_valido(v_cpf) THEN RAISE EXCEPTION 'CPF inválido.' USING ERRCODE='22023'; END IF;
 IF length(v_nome)<2 OR length(regexp_replace(v_tel,'[^0-9]','','g'))<8 OR length(v_tel)>30 THEN RAISE EXCEPTION 'Nome ou telefone inválido.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('imob-cliente:'||v_cpf,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('imob-email:'||v_email,0));
 SELECT * INTO c FROM public.cliente WHERE cpfcnpj=v_cpf FOR UPDATE;
 IF FOUND THEN
  -- O cliente existente recebe a conta; histórico só fica acessível após e-mail confirmado (e conferência, se divergente).
  IF c.is_deleted OR c.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.site_usuario WHERE cliente_id=c.id) THEN RAISE EXCEPTION 'CPF já possui acesso ao site.' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.cliente WHERE lower(email)=v_email AND id<>c.id) THEN RAISE EXCEPTION 'E-mail já pertence a outro cliente.' USING ERRCODE='23505'; END IF;
  v_id:=c.id;
 ELSE
  IF EXISTS(SELECT 1 FROM public.cliente WHERE lower(email)=v_email) THEN RAISE EXCEPTION 'E-mail já pertence a outro cliente.' USING ERRCODE='23505'; END IF;
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,email,telefone,status,origem_cadastro)
  VALUES('FISICA',v_cpf,v_nome,v_email,v_tel,'PENDENTE','SITE') RETURNING id INTO v_id;
 END IF;
 INSERT INTO public.site_usuario(user_id,tipo,email,cliente_id,status,motivo_pendencia,dados_cadastro)
 VALUES(a.id,'CLIENTE',v_email,v_id,'PENDENTE',CASE WHEN c.id IS NULL OR lower(coalesce(c.email,''))=v_email THEN 'EMAIL_NAO_CONFIRMADO' ELSE 'CADASTRO_DIVERGENTE' END,jsonb_build_object('cpf',v_cpf,'nome',v_nome,'telefone',v_tel))
 RETURNING * INTO s;
 RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.imob_sincronizar_cliente_site(p_auth_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a record; s public.site_usuario%ROWTYPE; c public.cliente%ROWTYPE; v_email text; v_motivo text;
BEGIN
 SELECT id,email,email_confirmed_at,raw_user_meta_data INTO a FROM auth.users WHERE id=p_auth_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.site_usuario WHERE user_id=p_auth_id FOR UPDATE;
 IF NOT FOUND THEN
  IF NOT public.imob_cpf_valido(regexp_replace(coalesce(a.raw_user_meta_data->>'cpf',''),'[^0-9]','','g')) THEN RETURN jsonb_build_object('status','PENDENTE','motivo','CPF_INVALIDO'); END IF;
  -- O motivo da recusa não é exposto ao site; o atendimento resolve pelo cadastro do cliente.
  BEGIN s:=public.imob_registrar_cadastro_site(p_auth_id);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','PENDENTE','tipo','CLIENTE','motivo','CADASTRO_RECUSADO'); END;
 END IF;
 IF s.tipo<>'CLIENTE' THEN RETURN jsonb_build_object('status',s.status,'tipo',s.tipo); END IF;
 IF s.status IN ('ATIVO','BLOQUEADO') THEN RETURN jsonb_build_object('status',s.status,'tipo','CLIENTE','cliente_id',s.cliente_id); END IF;
 v_email:=lower(a.email);
 IF a.email_confirmed_at IS NULL THEN v_motivo:='EMAIL_NAO_CONFIRMADO';
 ELSIF EXISTS(SELECT 1 FROM public.usuario WHERE id=a.id) THEN v_motivo:='CONTA_INTERNA';
 ELSIF EXISTS(SELECT 1 FROM public.proprietario p WHERE p.user_id=a.id OR (p.user_id IS NOT NULL AND lower(p.email)=v_email)) THEN v_motivo:='EMAIL_PROPRIETARIO';
 ELSE
  SELECT * INTO c FROM public.cliente WHERE id=s.cliente_id FOR UPDATE;
  IF NOT FOUND OR c.is_deleted OR (c.user_id IS NOT NULL AND c.user_id<>a.id) OR lower(coalesce(c.email,''))<>v_email THEN v_motivo:='CADASTRO_DIVERGENTE'; END IF;
 END IF;
 IF v_motivo IS NULL THEN
  UPDATE public.cliente SET user_id=a.id,status=CASE WHEN status='PENDENTE' AND origem_cadastro='SITE' THEN 'ATIVO' ELSE status END,updatedat=now() WHERE id=c.id;
 END IF;
 UPDATE public.site_usuario SET email=v_email,status=CASE WHEN v_motivo IS NULL THEN 'ATIVO' ELSE 'PENDENTE' END,motivo_pendencia=v_motivo,updated_at=now() WHERE user_id=a.id;
 RETURN jsonb_build_object('status',CASE WHEN v_motivo IS NULL THEN 'ATIVO' ELSE 'PENDENTE' END,'tipo','CLIENTE','cliente_id',s.cliente_id,'motivo',v_motivo);
END $$;

-- Conferência feita no cadastro do cliente: o operador atesta que a conta pertence a ele.
CREATE FUNCTION public.imob_liberar_cadastro_site(p_cliente_id integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.site_usuario%ROWTYPE; c public.cliente%ROWTYPE;
BEGIN
 IF public.imob_definir_ator(p_actor) IS NULL THEN RAISE EXCEPTION 'Liberação exige operador ERP.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.site_usuario WHERE cliente_id=p_cliente_id AND tipo='CLIENTE' FOR UPDATE;
 IF NOT FOUND OR s.status<>'PENDENTE' OR s.motivo_pendencia IS DISTINCT FROM 'CADASTRO_DIVERGENTE' THEN RAISE EXCEPTION 'Não há conta do site aguardando conferência para este cliente.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=s.user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'O cliente ainda não confirmou o e-mail da conta.'; END IF;
 SELECT * INTO c FROM public.cliente WHERE id=p_cliente_id FOR UPDATE;
 IF c.is_deleted OR (c.user_id IS NOT NULL AND c.user_id<>s.user_id) THEN RAISE EXCEPTION 'Cliente indisponível para vínculo com a conta do site.'; END IF;
 UPDATE public.cliente SET user_id=s.user_id,updated_by=p_actor,updatedat=now() WHERE id=p_cliente_id;
 UPDATE public.site_usuario SET status='ATIVO',motivo_pendencia=NULL,updated_at=now() WHERE user_id=s.user_id;
 RETURN jsonb_build_object('status','ATIVO','cliente_id',p_cliente_id);
END $$;

CREATE OR REPLACE FUNCTION public.imob_preparar_usuario_site() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Sem CPF: convites de proprietário e usuários internos não viram clientes.
 -- Tipo/perfil informados pelo próprio usuário continuam ignorados.
 IF nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf',''),'[^0-9]','','g'),'') IS NULL THEN RETURN new; END IF;
 -- Recusas (CPF inválido ou já com acesso, e-mail de outro cliente) impedem a criação da conta.
 PERFORM public.imob_registrar_cadastro_site(new.id);
 IF new.email_confirmed_at IS NOT NULL THEN PERFORM public.imob_sincronizar_cliente_site(new.id); END IF;
 RETURN new;
END $$;

CREATE FUNCTION public.imob_ativar_cadastro_site() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.site_usuario WHERE user_id=new.id AND tipo='CLIENTE') THEN RETURN new; END IF;
 -- A confirmação do e-mail nunca falha por causa do ERP; a sincronização do login refaz o passo.
 BEGIN PERFORM public.imob_sincronizar_cliente_site(new.id);
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'imob: ativação do cadastro % adiada: %',new.id,SQLERRM; END;
 RETURN new;
END $$;
CREATE TRIGGER imob_auth_user_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW
 WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL) EXECUTE FUNCTION public.imob_ativar_cadastro_site();

DO $$
DECLARE v_function record;
BEGIN
 FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('imob_registrar_cadastro_site','imob_liberar_cadastro_site','imob_ativar_cadastro_site') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_function.signature);
 END LOOP;
END $$;
