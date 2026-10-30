-- Excluir um cliente cadastrado pelo site leva junto a conta dele no site e o login no
-- Supabase Auth, numa transação só: se o cliente tiver histórico (reserva, venda,
-- lançamento...), nada é apagado. Sem a conta, um novo login recriaria o cliente.
CREATE OR REPLACE FUNCTION public.imob_excluir_cliente(p_id integer,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_logins uuid[];
BEGIN
 IF public.imob_definir_ator(p_actor) IS NULL THEN RAISE EXCEPTION 'Exclusão exige operador ERP.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.cliente WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE='P0002'; END IF;
 -- Só logins que são exclusivamente de cliente do site: conta interna do ERP e de proprietário ficam.
 SELECT coalesce(array_agg(DISTINCT u.id),'{}') INTO v_logins
 FROM auth.users u
 WHERE (u.id IN (SELECT s.user_id FROM public.site_usuario s WHERE s.cliente_id=p_id AND s.tipo='CLIENTE')
        OR u.id=(SELECT c.user_id FROM public.cliente c WHERE c.id=p_id))
   AND NOT EXISTS(SELECT 1 FROM public.usuario x WHERE x.id=u.id)
   AND NOT EXISTS(SELECT 1 FROM public.proprietario p WHERE p.user_id=u.id)
   AND NOT EXISTS(SELECT 1 FROM public.site_usuario s WHERE s.user_id=u.id AND s.tipo<>'CLIENTE');
 BEGIN
  DELETE FROM public.site_usuario WHERE cliente_id=p_id AND tipo='CLIENTE';
  -- Dados pessoais do próprio cliente, sem valor histórico.
  DELETE FROM public.cliente_endereco WHERE cliente_id=p_id;
  DELETE FROM public.favorito WHERE cliente_id=p_id;
  DELETE FROM public.cliente WHERE id=p_id;
 EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este cliente tem reservas, locações, vendas ou lançamentos vinculados e não pode ser excluído. Inative o cadastro para preservar o histórico.' USING ERRCODE='P0001';
 END;
 -- Sessões, identidades e fatores do login saem em cascata no próprio Auth.
 DELETE FROM auth.users WHERE id=ANY(v_logins);
 RETURN jsonb_build_object('excluido',true,'logins_removidos',cardinality(v_logins));
END $$;
REVOKE ALL ON FUNCTION public.imob_excluir_cliente(integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_cliente(integer,uuid) TO service_role;
