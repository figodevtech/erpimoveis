-- Libera o evento assim que a transacao da OS for concluida.
-- O Database Webhook do Supabase chama o processador de forma assincrona apos o INSERT.
CREATE OR REPLACE FUNCTION public.fn_registrar_evento_notificacao_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_status_anterior text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'CRIADA';
    v_status_anterior := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_tipo := 'STATUS_ALTERADO';
    v_status_anterior := OLD.status::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.os_notificacao_evento (
    ordemservico_id, tipo, status_anterior, status_novo,
    ator_usuario_id, snapshot, disponivel_em
  ) VALUES (
    NEW.id, v_tipo, v_status_anterior, NEW.status::text,
    public.auditoria_usuario_requisicao(),
    jsonb_build_object(
      'cliente_id', NEW.clienteid,
      'veiculo_id', NEW.veiculoid,
      'peca_id', NEW.pecaid,
      'alvo_tipo', NEW.alvo_tipo,
      'equipamento_nome', NEW.equipamento_nome,
      'setor_id', NEW.setorid,
      'usuario_criador_id', NEW.usuariocriadorid,
      'prioridade', NEW.prioridade
    ),
    now()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_registrar_evento_notificacao_os() IS
  'Registra eventos de OS liberados para processamento assincrono imediato.';
