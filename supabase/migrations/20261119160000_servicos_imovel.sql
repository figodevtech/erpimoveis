-- Serviços do imóvel: a limpeza passa a ser um dos tipos de serviço do catálogo
-- (Configurações > Tipos > Serviços), e a Execução passa a mostrar serviços em geral.
--
-- Depende de 20261118120000 a 20261118180000 (limpeza do imóvel).
--
-- - servico.chave_sistema: serviço que o próprio sistema usa. Hoje só LIMPEZA, pedida no
--   check-out. É semeado aqui e não pode ser excluído, desativado nem mudar de código.
-- - imovel_limpeza passa a se chamar imovel_servico e ganha servico_id (o tipo) e prazo_em
--   (opcional). As limpezas existentes ficam com o serviço LIMPEZA.
-- - Só a limpeza muda a situação do imóvel (LIMPEZA) e continua única por imóvel enquanto
--   pendente. Os outros tipos podem ter vários pedidos abertos no mesmo imóvel.
-- - imob_solicitar_servico abre o pedido; imob_solicitar_limpeza vira um atalho para ela.
-- - imob_acao_servico substitui imob_acao_limpeza: igual a 20261118180000, com o prazo e a
--   regra da pendente única só na limpeza.
-- - imob_acao_reserva: igual a 20261118160000, apontando para imovel_servico.
-- - imovel_resumo: igual a 20261118120000; a situação LIMPEZA olha só o serviço de limpeza.
-- - Permissões: execucao:visualizar (as próprias tarefas), execucao:ver_todas e
--   execucao:trocar_realizador substituem limpezas:gerenciar. Antes a Execução não pedia
--   permissão, então todo perfil existente recebe execucao:visualizar; quem gerenciava
--   limpezas recebe as outras duas. Perfil novo "Prestador de serviço", só com a Execução.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- --------------------------------------------------------------------------- catálogo
ALTER TABLE public.servico ADD COLUMN IF NOT EXISTS chave_sistema text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servico_chave_sistema_check') THEN
    ALTER TABLE public.servico ADD CONSTRAINT servico_chave_sistema_check CHECK (chave_sistema IN ('LIMPEZA'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS servico_chave_sistema_uidx ON public.servico(chave_sistema) WHERE chave_sistema IS NOT NULL;

COMMENT ON COLUMN public.servico.chave_sistema IS 'Serviço usado pelo próprio sistema (LIMPEZA: pedida no check-out). Não pode ser excluído, desativado nem mudar de código.';

-- Limpeza: aproveita um serviço LIMPEZA já cadastrado; senão, cria.
UPDATE public.servico SET chave_sistema = 'LIMPEZA', ativo = true
 WHERE id = (SELECT id FROM public.servico WHERE upper(btrim(codigo)) = 'LIMPEZA' ORDER BY id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.servico WHERE chave_sistema = 'LIMPEZA');
INSERT INTO public.servico (codigo, descricao, precohora, ativo, gera_comissao, chave_sistema)
SELECT 'LIMPEZA', 'Limpeza', 0, true, false, 'LIMPEZA'
 WHERE NOT EXISTS (SELECT 1 FROM public.servico WHERE chave_sistema = 'LIMPEZA');

CREATE OR REPLACE FUNCTION public.imob_servico_limpeza_id() RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT id FROM public.servico WHERE chave_sistema = 'LIMPEZA'
$$;

REVOKE ALL ON FUNCTION public.imob_servico_limpeza_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_servico_limpeza_id() TO service_role;

-- O check-out depende do serviço do sistema: ele não sai do catálogo nem fica inativo.
CREATE OR REPLACE FUNCTION public.imob_proteger_servico_sistema() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF old.chave_sistema IS NOT NULL THEN
      RAISE EXCEPTION 'O serviço % é usado pelo sistema e não pode ser excluído.', old.descricao USING ERRCODE = '22023';
    END IF;
    RETURN old;
  END IF;
  IF old.chave_sistema IS NOT NULL THEN
    IF new.chave_sistema IS DISTINCT FROM old.chave_sistema OR new.codigo IS DISTINCT FROM old.codigo THEN
      RAISE EXCEPTION 'O serviço % é usado pelo sistema: o código dele não pode mudar.', old.descricao USING ERRCODE = '22023';
    END IF;
    IF new.ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'O serviço % é usado pelo sistema e não pode ser desativado.', old.descricao USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS imob_proteger_servico_sistema ON public.servico;
CREATE TRIGGER imob_proteger_servico_sistema BEFORE UPDATE OR DELETE ON public.servico
  FOR EACH ROW EXECUTE FUNCTION public.imob_proteger_servico_sistema();

-- --------------------------------------------------------------------------- tabela
DO $$
BEGIN
  IF to_regclass('public.imovel_servico') IS NULL THEN
    ALTER TABLE public.imovel_limpeza RENAME TO imovel_servico;
    ALTER INDEX IF EXISTS public.imovel_limpeza_reserva_uidx RENAME TO imovel_servico_reserva_uidx;
    ALTER INDEX IF EXISTS public.imovel_limpeza_responsavel_idx RENAME TO imovel_servico_responsavel_idx;
    -- Volta logo abaixo, valendo só para a limpeza.
    DROP INDEX IF EXISTS public.imovel_limpeza_pendente_uidx;
  END IF;
END $$;

-- O id da limpeza muda de banco para banco: a coluna nasce com ele como default (sem reescrever
-- a tabela nem disparar a auditoria em cada linha) e o índice parcial é montado com ele.
DO $$
DECLARE v_limpeza integer := public.imob_servico_limpeza_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'imovel_servico' AND column_name = 'servico_id') THEN
    EXECUTE format('ALTER TABLE public.imovel_servico ADD COLUMN servico_id integer NOT NULL DEFAULT %s REFERENCES public.servico(id)', v_limpeza);
    ALTER TABLE public.imovel_servico ALTER COLUMN servico_id DROP DEFAULT;
  END IF;
  -- No máximo uma limpeza aberta por imóvel. Os outros serviços não têm esse limite.
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS imovel_servico_limpeza_pendente_uidx ON public.imovel_servico(imovel_id) WHERE status = %L AND servico_id = %s',
                 'PENDENTE', v_limpeza);
END $$;

ALTER TABLE public.imovel_servico ADD COLUMN IF NOT EXISTS prazo_em timestamptz;
CREATE INDEX IF NOT EXISTS imovel_servico_servico_idx ON public.imovel_servico(servico_id, status);
CREATE INDEX IF NOT EXISTS imovel_servico_imovel_idx ON public.imovel_servico(imovel_id, solicitada_em DESC);

COMMENT ON TABLE public.imovel_servico IS 'Serviços pedidos para o imóvel (limpeza no check-out, manutenção, vistoria...), acompanhados na Execução pelo responsável. Só a limpeza pendente deixa o imóvel em LIMPEZA.';
COMMENT ON COLUMN public.imovel_servico.servico_id IS 'Tipo de serviço (Configurações > Tipos > Serviços).';
COMMENT ON COLUMN public.imovel_servico.descricao IS 'O que fazer, informado no pedido (ex.: trocar enxoval completo).';
COMMENT ON COLUMN public.imovel_servico.observacoes IS 'Anotação de quem concluiu o serviço.';
COMMENT ON COLUMN public.imovel_servico.prazo_em IS 'Prazo opcional para o serviço ficar pronto.';

-- O histórico da auditoria fica num nome só.
UPDATE public.auditoria_evento SET tabela = 'imovel_servico' WHERE tabela = 'imovel_limpeza';

-- --------------------------------------------------------------------------- pedido de serviço
-- Limpeza: reaproveita a que já está aberta no imóvel (só preenche o responsável se estiver sem,
-- soma a descrição com " · " e fica com o prazo mais curto). Outros serviços: sempre um pedido novo.
CREATE OR REPLACE FUNCTION public.imob_solicitar_servico(p_imovel_id bigint, p_servico_id integer, p_reserva_id bigint,
  p_responsavel uuid, p_actor uuid, p_descricao text DEFAULT NULL, p_prazo timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_servico%ROWTYPE; s public.servico%ROWTYPE;
  v_descricao text := nullif(btrim(p_descricao), ''); v_limpeza integer := public.imob_servico_limpeza_id();
BEGIN
  SELECT * INTO s FROM public.servico WHERE id = p_servico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tipo de serviço não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF s.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'O serviço % está inativo em Configurações > Tipos.', s.descricao USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.imovel WHERE id = p_imovel_id) THEN
    RAISE EXCEPTION 'Imóvel não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_responsavel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_responsavel AND ativo) THEN
    RAISE EXCEPTION 'O responsável pelo serviço precisa ser um usuário ativo.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_descricao) > 500 THEN
    RAISE EXCEPTION 'A descrição do serviço deve ter até 500 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_prazo IS NOT NULL AND p_prazo < clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'O prazo do serviço não pode estar no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_servico_id = v_limpeza THEN
    -- Dois pedidos de limpeza do mesmo imóvel ao mesmo tempo não abrem duas limpezas.
    PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:' || p_imovel_id, 0));
    SELECT * INTO l FROM public.imovel_servico
     WHERE imovel_id = p_imovel_id AND servico_id = v_limpeza AND status = 'PENDENTE' FOR UPDATE;
    IF FOUND THEN
      IF (l.responsavel_id IS NULL AND p_responsavel IS NOT NULL)
         OR (v_descricao IS NOT NULL AND v_descricao IS DISTINCT FROM l.descricao)
         OR (p_prazo IS NOT NULL AND (l.prazo_em IS NULL OR p_prazo < l.prazo_em)) THEN
        UPDATE public.imovel_servico
           SET responsavel_id = coalesce(responsavel_id, p_responsavel),
               descricao = CASE WHEN v_descricao IS NULL OR v_descricao = descricao THEN descricao
                                WHEN descricao IS NULL THEN v_descricao
                                ELSE left(descricao || ' · ' || v_descricao, 500) END,
               prazo_em = CASE WHEN p_prazo IS NULL THEN prazo_em ELSE least(coalesce(prazo_em, p_prazo), p_prazo) END,
               updated_by = p_actor, updated_at = now()
         WHERE id = l.id RETURNING * INTO l;
      END IF;
      RETURN to_jsonb(l);
    END IF;
  END IF;

  INSERT INTO public.imovel_servico (imovel_id, servico_id, reserva_id, responsavel_id, descricao, prazo_em, solicitada_por, updated_by)
  VALUES (p_imovel_id, p_servico_id, p_reserva_id, p_responsavel, v_descricao, p_prazo, p_actor, p_actor)
  RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_solicitar_servico(bigint, integer, bigint, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_solicitar_servico(bigint, integer, bigint, uuid, uuid, text, timestamptz) TO service_role;

-- Mesma assinatura de 20261118140000: o check-out e a edição do check-out continuam chamando.
CREATE OR REPLACE FUNCTION public.imob_solicitar_limpeza(p_imovel_id bigint, p_reserva_id bigint, p_responsavel uuid, p_actor uuid, p_descricao text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT public.imob_solicitar_servico(p_imovel_id, public.imob_servico_limpeza_id(), p_reserva_id, p_responsavel, p_actor, p_descricao, NULL)
$$;

REVOKE ALL ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid, text) TO service_role;

-- --------------------------------------------------------------------------- ações do serviço
-- Igual a imob_acao_limpeza de 20261118180000, com:
--   REABRIR  a recusa por outra pendente vale só para a limpeza;
--   EDITAR   também muda prazo_em (vazio limpa; não pode ser antes do pedido).
-- Quem pode o quê é decidido na API do ERP.
DROP FUNCTION IF EXISTS public.imob_acao_limpeza(bigint, text, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.imob_acao_servico(p_id bigint, p_acao text, p_payload jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_servico%ROWTYPE; v_actor uuid; v_acao text := upper(coalesce(p_acao, '')); v_resp uuid;
  v_descricao text; v_obs text; v_conclusao timestamptz; v_prazo timestamptz; v_limpeza integer := public.imob_servico_limpeza_id();
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ações do serviço são exclusivas do ERP.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.imovel_servico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'P0002'; END IF;

  IF v_acao = 'CONCLUIR' THEN
    IF l.status = 'CONCLUIDA' THEN RETURN to_jsonb(l); END IF;
    IF l.status <> 'PENDENTE' THEN RAISE EXCEPTION 'Só um serviço pendente pode ser concluído.' USING ERRCODE = '22023'; END IF;
    UPDATE public.imovel_servico
       SET status = 'CONCLUIDA', concluida_em = clock_timestamp(), concluida_por = v_actor,
           observacoes = coalesce(nullif(btrim(p_payload->>'observacoes'), ''), observacoes),
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSIF v_acao = 'ATRIBUIR' THEN
    IF l.status <> 'PENDENTE' THEN RAISE EXCEPTION 'Só um serviço pendente pode mudar de responsável.' USING ERRCODE = '22023'; END IF;
    v_resp := nullif(p_payload->>'responsavel_id', '')::uuid;
    IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = v_resp AND ativo) THEN
      RAISE EXCEPTION 'O responsável pelo serviço precisa ser um usuário ativo.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.imovel_servico SET responsavel_id = v_resp, updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSIF v_acao = 'REABRIR' THEN
    IF l.status = 'PENDENTE' THEN RETURN to_jsonb(l); END IF;
    IF l.servico_id = v_limpeza THEN
      -- Mesma trava do pedido de limpeza: dois pedidos do imóvel ao mesmo tempo não se cruzam.
      PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:' || l.imovel_id, 0));
      IF EXISTS (SELECT 1 FROM public.imovel_servico
                  WHERE imovel_id = l.imovel_id AND servico_id = v_limpeza AND status = 'PENDENTE' AND id <> l.id) THEN
        RAISE EXCEPTION 'Este imóvel já tem outra limpeza pendente. Conclua aquela antes de reabrir esta.' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.imovel_servico
       SET status = 'PENDENTE', concluida_em = NULL, concluida_por = NULL, observacoes = NULL,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSIF v_acao = 'EDITAR' THEN
    v_descricao := CASE WHEN p_payload ? 'descricao' THEN nullif(btrim(p_payload->>'descricao'), '') ELSE l.descricao END;
    IF char_length(v_descricao) > 500 THEN
      RAISE EXCEPTION 'A descrição do serviço deve ter até 500 caracteres.' USING ERRCODE = '22023';
    END IF;
    v_resp := CASE WHEN p_payload ? 'responsavel_id' THEN nullif(p_payload->>'responsavel_id', '')::uuid ELSE l.responsavel_id END;
    IF v_resp IS DISTINCT FROM l.responsavel_id AND v_resp IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = v_resp AND ativo) THEN
      RAISE EXCEPTION 'O responsável pelo serviço precisa ser um usuário ativo.' USING ERRCODE = '22023';
    END IF;
    v_prazo := CASE WHEN p_payload ? 'prazo_em' THEN nullif(p_payload->>'prazo_em', '')::timestamptz ELSE l.prazo_em END;
    IF v_prazo IS DISTINCT FROM l.prazo_em AND v_prazo < l.solicitada_em THEN
      RAISE EXCEPTION 'O prazo (%) não pode ser antes do pedido do serviço (%).',
        to_char(v_prazo AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
        to_char(l.solicitada_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') USING ERRCODE = '22023';
    END IF;
    v_obs := l.observacoes;
    v_conclusao := l.concluida_em;
    IF l.status = 'CONCLUIDA' THEN
      IF p_payload ? 'observacoes' THEN v_obs := nullif(btrim(p_payload->>'observacoes'), ''); END IF;
      IF char_length(v_obs) > 2000 THEN
        RAISE EXCEPTION 'As observações da conclusão devem ter até 2000 caracteres.' USING ERRCODE = '22023';
      END IF;
      IF nullif(p_payload->>'data_conclusao', '') IS NOT NULL THEN
        v_conclusao := public.imob_momento_informado(
          jsonb_build_object('data_registro', p_payload->>'data_conclusao', 'hora_registro', p_payload->>'hora_conclusao'),
          'conclusão do serviço');
        IF v_conclusao < l.solicitada_em THEN
          RAISE EXCEPTION 'A conclusão (%) não pode ser antes do pedido do serviço (%).',
            to_char(v_conclusao AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            to_char(l.solicitada_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
    UPDATE public.imovel_servico
       SET descricao = v_descricao, responsavel_id = v_resp, prazo_em = v_prazo, observacoes = v_obs, concluida_em = v_conclusao,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSE
    RAISE EXCEPTION 'Ação de serviço inválida.' USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_acao_servico(bigint, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_acao_servico(bigint, text, jsonb, uuid) TO service_role;

-- --------------------------------------------------------------------------- ações da reserva
-- Igual a 20261118160000, com imovel_servico no lugar de imovel_limpeza e a limpeza da saída
-- procurada só entre os serviços de limpeza. CREATE OR REPLACE preserva as permissões.
CREATE OR REPLACE FUNCTION public.imob_acao_reserva(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.reserva_imovel%ROWTYPE; l public.imovel_servico%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao); v_momento timestamptz;
 v_obs text:=left(nullif(btrim(p_payload->>'observacoes'),''),2000);
 v_resp uuid; v_desc text; v_limpeza integer;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor);
 SELECT * INTO r FROM public.reserva_imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Ações da reserva são exclusivas do ERP.' USING ERRCODE='42501'; END IF;
 IF v_acao='CONFIRMAR' AND r.status='CONFIRMADA' THEN RETURN to_jsonb(r);
 ELSIF v_acao IN ('CHECKIN','CHECK_IN') THEN
  IF r.status='EM_ANDAMENTO' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'CONFIRMADA' THEN RAISE EXCEPTION 'Check-in exige reserva confirmada.'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-in');
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO',checkin_em=v_momento,checkin_por=v_actor,checkin_observacoes=v_obs WHERE id=p_id;
 ELSIF v_acao IN ('CHECKOUT','CHECK_OUT','CONCLUIR') THEN
  IF r.status='CONCLUIDA' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'EM_ANDAMENTO' THEN RAISE EXCEPTION 'Check-out exige check-in registrado.'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-out');
  IF r.checkin_em IS NOT NULL AND v_momento<r.checkin_em THEN
   RAISE EXCEPTION 'O check-out (%) não pode ser antes do check-in (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkin_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET status='CONCLUIDA',checkout_em=v_momento,checkout_por=v_actor,checkout_observacoes=v_obs WHERE id=p_id;
  -- Limpeza pedida no diálogo do check-out: abre junto, ou nada acontece.
  IF coalesce(p_payload->>'solicitar_limpeza','false')='true' THEN
   PERFORM public.imob_solicitar_limpeza(r.imovel_id,r.id,nullif(p_payload->>'responsavel_limpeza_id','')::uuid,v_actor,p_payload->>'descricao_limpeza');
  END IF;
 ELSIF v_acao='EDITAR_CHECKIN' THEN
  IF r.status NOT IN ('EM_ANDAMENTO','CONCLUIDA') THEN
   RAISE EXCEPTION 'Esta reserva não tem check-in registrado para editar.' USING ERRCODE='22023';
  END IF;
  IF nullif(p_payload->>'data_registro','') IS NULL THEN RAISE EXCEPTION 'Informe a data e a hora do check-in.' USING ERRCODE='22023'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-in');
  IF r.checkout_em IS NOT NULL AND v_momento>r.checkout_em THEN
   RAISE EXCEPTION 'O check-in (%) não pode ser depois do check-out (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkout_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET checkin_em=v_momento,checkin_observacoes=v_obs WHERE id=p_id;
 ELSIF v_acao='EDITAR_CHECKOUT' THEN
  IF r.status<>'CONCLUIDA' THEN RAISE EXCEPTION 'Esta reserva não tem check-out registrado para editar.' USING ERRCODE='22023'; END IF;
  IF nullif(p_payload->>'data_registro','') IS NULL THEN RAISE EXCEPTION 'Informe a data e a hora do check-out.' USING ERRCODE='22023'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-out');
  IF r.checkin_em IS NOT NULL AND v_momento<r.checkin_em THEN
   RAISE EXCEPTION 'O check-out (%) não pode ser antes do check-in (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkin_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET checkout_em=v_momento,checkout_observacoes=v_obs WHERE id=p_id;
  -- Sem solicitar_limpeza no payload, a limpeza fica como está.
  IF p_payload ? 'solicitar_limpeza' THEN
   v_limpeza:=public.imob_servico_limpeza_id();
   v_resp:=nullif(p_payload->>'responsavel_limpeza_id','')::uuid;
   v_desc:=left(nullif(btrim(p_payload->>'descricao_limpeza'),''),500);
   IF v_resp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.usuario WHERE id=v_resp AND ativo) THEN
    RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE='22023';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:'||r.imovel_id,0));
   SELECT * INTO l FROM public.imovel_servico WHERE reserva_id=p_id AND servico_id=v_limpeza FOR UPDATE;
   IF (p_payload->>'solicitar_limpeza')='true' THEN
    IF NOT FOUND THEN
     PERFORM public.imob_solicitar_limpeza(r.imovel_id,r.id,v_resp,v_actor,v_desc);
    ELSIF l.status='PENDENTE' THEN
     UPDATE public.imovel_servico SET responsavel_id=v_resp,descricao=v_desc,updated_by=v_actor,updated_at=now() WHERE id=l.id;
    ELSIF l.status='CANCELADA' THEN
     -- Outra limpeza já aberta no imóvel recebe o pedido; senão, esta volta a ficar pendente.
     IF EXISTS(SELECT 1 FROM public.imovel_servico WHERE imovel_id=r.imovel_id AND servico_id=v_limpeza AND status='PENDENTE') THEN
      PERFORM public.imob_solicitar_limpeza(r.imovel_id,NULL,v_resp,v_actor,v_desc);
     ELSE
      UPDATE public.imovel_servico SET status='PENDENTE',responsavel_id=v_resp,descricao=v_desc,
        solicitada_em=now(),solicitada_por=v_actor,updated_by=v_actor,updated_at=now() WHERE id=l.id;
     END IF;
    END IF;
   ELSIF FOUND AND l.status='PENDENTE' THEN
    UPDATE public.imovel_servico SET status='CANCELADA',updated_by=v_actor,updated_at=now() WHERE id=l.id;
   END IF;
  END IF;
 ELSIF v_acao='CANCELAR' THEN
  IF r.status='CANCELADA' THEN RETURN to_jsonb(r); END IF;
  IF r.status='CONCLUIDA' THEN RAISE EXCEPTION 'Reserva concluída não pode ser cancelada.'; END IF;
  IF nullif(btrim(p_payload->>'motivo'),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  IF v_actor IS NULL AND coalesce(p_payload->>'tratamento_financeiro','MANTER')<>'MANTER' THEN RAISE EXCEPTION 'Tratamento financeiro exige operador ERP.'; END IF;
  IF v_actor IS NOT NULL AND EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r.id AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL) AND p_payload->>'tratamento_pendentes' IS NULL THEN RAISE EXCEPTION 'Escolha como tratar as cobranças pendentes.'; END IF;
  PERFORM public.imob_tratar_cancelamento(r.id,NULL,coalesce(p_payload->>'tratamento_recebidos',p_payload->>'tratamento_financeiro','MANTER'),v_actor,coalesce(p_payload->>'tratamento_pendentes','MANTER'));
  UPDATE public.reserva_imovel SET status='CANCELADA',cancelamento_motivo=p_payload->>'motivo' WHERE id=p_id;
  UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now() WHERE reserva_id=p_id;
 ELSE RAISE EXCEPTION 'Ação de reserva inválida.'; END IF;
 UPDATE public.reserva_imovel SET updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

-- --------------------------------------------------------------------------- situação do imóvel
-- Igual a 20261118120000: só a limpeza pendente deixa o imóvel em LIMPEZA. Colunas e ordem não mudam.
CREATE OR REPLACE VIEW public.imovel_resumo WITH(security_invoker=true) AS
 SELECT i.*,
 CASE WHEN NOT i.ativo THEN 'INATIVO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='MANUTENCAO' AND o.periodo @> current_date) THEN 'MANUTENCAO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='LOCACAO' AND o.periodo @> current_date) THEN 'ALUGADO'
  WHEN EXISTS(SELECT 1 FROM public.reserva_imovel r WHERE r.imovel_id=i.id AND r.status='EM_ANDAMENTO' AND daterange(r.inicio,r.fim,'[)') @> current_date) THEN 'OCUPADO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_servico l JOIN public.servico s ON s.id=l.servico_id
               WHERE l.imovel_id=i.id AND l.status='PENDENTE' AND s.chave_sistema='LIMPEZA') THEN 'LIMPEZA'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo @> current_date) THEN 'RESERVADO'
  ELSE 'DISPONIVEL' END::text AS situacao_operacional,
 CASE WHEN i.vendido_em IS NOT NULL THEN 'VENDIDO'
  WHEN EXISTS(SELECT 1 FROM public.venda_imovel v WHERE v.imovel_id=i.id AND v.status='RASCUNHO') THEN 'EM_NEGOCIACAO'
  ELSE 'DISPONIVEL' END::text AS situacao_comercial
 FROM public.imovel i;

-- --------------------------------------------------------------------------- permissões
INSERT INTO public.permissao(nome, descricao) VALUES
  ('execucao:visualizar', 'Acessar a Execução e ver as próprias tarefas'),
  ('execucao:ver_todas', 'Ver as tarefas de todos os executores na Execução'),
  ('execucao:trocar_realizador', 'Trocar o realizador das tarefas na Execução')
ON CONFLICT(nome) DO NOTHING;

-- Só na primeira execução (enquanto limpezas:gerenciar existe): reexecutar não devolve a
-- Execução a um perfil de quem ela foi tirada depois.
DO $$
DECLARE v_antiga public.permissao.id%TYPE;
BEGIN
  SELECT id INTO v_antiga FROM public.permissao WHERE lower(btrim(nome)) = 'limpezas:gerenciar';
  IF v_antiga IS NULL THEN RETURN; END IF;
  -- Antes a Execução não pedia permissão: todo perfil existente continua com ela.
  INSERT INTO public.perfilpermissao(perfilid, permissaoid)
  SELECT p.id, pe.id FROM public.perfil p CROSS JOIN public.permissao pe WHERE pe.nome = 'execucao:visualizar'
  ON CONFLICT(perfilid, permissaoid) DO NOTHING;
  -- Quem gerenciava limpezas vê as tarefas de todos e troca o realizador.
  INSERT INTO public.perfilpermissao(perfilid, permissaoid)
  SELECT pp.perfilid, pe.id FROM public.perfilpermissao pp CROSS JOIN public.permissao pe
   WHERE pp.permissaoid = v_antiga AND pe.nome IN ('execucao:ver_todas', 'execucao:trocar_realizador')
  ON CONFLICT(perfilid, permissaoid) DO NOTHING;
  DELETE FROM public.perfilpermissao WHERE permissaoid = v_antiga;
  DELETE FROM public.permissao WHERE id = v_antiga;
END $$;

INSERT INTO public.perfilpermissao(perfilid, permissaoid)
SELECT p.id, pe.id FROM public.perfil p CROSS JOIN public.permissao pe
 WHERE p.nome = 'Administrador' AND pe.nome IN ('execucao:visualizar', 'execucao:ver_todas', 'execucao:trocar_realizador')
ON CONFLICT(perfilid, permissaoid) DO NOTHING;

-- Prestador de serviço: entra direto na Execução e vê só as tarefas sob a sua responsabilidade.
INSERT INTO public.perfil(nome, descricao)
VALUES ('Prestador de serviço', 'Só a Execução: vê e conclui as próprias tarefas.')
ON CONFLICT(nome) DO NOTHING;

INSERT INTO public.perfilpermissao(perfilid, permissaoid)
SELECT p.id, pe.id FROM public.perfil p CROSS JOIN public.permissao pe
 WHERE p.nome = 'Prestador de serviço' AND pe.nome = 'execucao:visualizar'
ON CONFLICT(perfilid, permissaoid) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
