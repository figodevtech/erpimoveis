-- Consumo de estoque na reserva, como o da OS na oficina (20260903120000).
--
-- Reposição de sabonete, toalha, papel higiênico: material que a administradora tem em estoque
-- e gasta numa reserva. Numa operação só, o item sai do estoque (com as RPCs de saída de sempre,
-- que travam a linha, conferem o saldo e carimbam o razão) e nasce um custo da imobiliária pelo
-- preço de custo do item. O custo entra na DRE como material direto (CONSUMO:DESPESA, a mesma
-- classificação do consumo da OS) e reduz o resultado da reserva.
--
-- O custo não vai ao fluxo de caixa: o item já foi pago quando entrou no estoque.
-- Cancelar o consumo devolve o item ao estoque e tira o custo da DRE.
BEGIN;

-- ---------------------------------------------------------------- 1) motivo e vínculo da saída
INSERT INTO public.tipos_motivo_saida (codigo, nome, descricao, escopo) VALUES
  ('CONSUMO_EM_RESERVA', 'Consumo em reserva',
   'Material reposto ou gasto numa reserva (ex.: sabonetes, toalhas), por conta da administradora.', 'AMBOS')
ON CONFLICT (codigo) DO NOTHING;

-- SET NULL e não CASCADE: apagar a reserva não pode apagar a prova de que o material saiu.
ALTER TABLE public.estoque_saida
  ADD COLUMN IF NOT EXISTS reserva_imovel_id bigint REFERENCES public.reserva_imovel(id) ON DELETE SET NULL;
ALTER TABLE public.usoconsumo_saida
  ADD COLUMN IF NOT EXISTS reserva_imovel_id bigint REFERENCES public.reserva_imovel(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS estoque_saida_reserva_idx ON public.estoque_saida (reserva_imovel_id) WHERE reserva_imovel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usoconsumo_saida_reserva_idx ON public.usoconsumo_saida (reserva_imovel_id) WHERE reserva_imovel_id IS NOT NULL;

-- Portão: a saída da reserva só é cancelada pela reserva, que leva junto o custo. Pelo módulo
-- de estoque, o item voltaria e o custo ficaria na DRE. Gatilho, e não mais um trecho nas RPCs
-- de cancelamento, para valer em qualquer caminho que cancele a saída.
CREATE OR REPLACE FUNCTION public.imob_proteger_saida_da_reserva() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF old.reserva_imovel_id IS NOT NULL AND new.status = 'CANCELADA' AND old.status IS DISTINCT FROM 'CANCELADA'
     AND coalesce(nullif(current_setting('app.consumo_reserva_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saída foi gerada pelo consumo registrado na Reserva #%. Cancele o consumo na aba Eventos financeiros da reserva para devolver o item ao estoque.',
      old.reserva_imovel_id USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END $fn$;

DROP TRIGGER IF EXISTS imob_proteger_saida_da_reserva ON public.estoque_saida;
CREATE TRIGGER imob_proteger_saida_da_reserva BEFORE UPDATE OF status ON public.estoque_saida
  FOR EACH ROW EXECUTE FUNCTION public.imob_proteger_saida_da_reserva();
DROP TRIGGER IF EXISTS imob_proteger_saida_da_reserva ON public.usoconsumo_saida;
CREATE TRIGGER imob_proteger_saida_da_reserva BEFORE UPDATE OF status ON public.usoconsumo_saida
  FOR EACH ROW EXECUTE FUNCTION public.imob_proteger_saida_da_reserva();

-- ---------------------------------------------------------------- 2) registro do consumo
CREATE OR REPLACE FUNCTION public.imob_registrar_consumo_reserva(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_reserva_id  bigint  := nullif(p_payload->>'reserva_id', '')::bigint;
  v_escopo      text    := upper(btrim(coalesce(p_payload->>'escopo', '')));
  v_item_id     integer := nullif(p_payload->>'item_id', '')::integer;
  v_quantidade  integer := nullif(p_payload->>'quantidade', '')::integer;
  v_observacao  text    := nullif(btrim(coalesce(p_payload->>'observacao', '')), '');
  v_descricao   text    := nullif(btrim(coalesce(p_payload->>'descricao', '')), '');
  v_valor       numeric(14,2) := nullif(p_payload->>'valor', '')::numeric;
  v_data        date    := nullif(p_payload->>'data', '')::date;
  v_user        uuid    := nullif(p_payload->>'created_by', '')::uuid;
  r             public.reserva_imovel%ROWTYPE;
  v_saida       jsonb;
  v_saida_id    bigint;
  v_custo       numeric(14,4);
  v_saldo       integer;
  v_titulo      text;
  v_unidade     text;
  v_valor_base  numeric(14,2);
  v_editado     boolean := false;
  v_competencia timestamptz;
  v_evento      public.eventos_financeiros%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Operador não identificado.' USING ERRCODE = '42501'; END IF;
  IF v_escopo NOT IN ('PRODUTO', 'USOCONSUMO', 'GERAL') THEN
    RAISE EXCEPTION 'Estoque inválido: %.', v_escopo USING ERRCODE = '22023';
  END IF;
  IF v_item_id IS NULL OR v_item_id <= 0 THEN RAISE EXCEPTION 'Selecione o item consumido.' USING ERRCODE = '22023'; END IF;
  IF v_quantidade IS NULL OR v_quantidade <= 0 THEN RAISE EXCEPTION 'A quantidade deve ser maior que zero.' USING ERRCODE = '22023'; END IF;
  IF v_valor IS NOT NULL AND v_valor < 0 THEN RAISE EXCEPTION 'O valor do custo não pode ser negativo.' USING ERRCODE = '22023'; END IF;
  IF v_descricao IS NOT NULL AND char_length(v_descricao) > 200 THEN
    RAISE EXCEPTION 'O título do custo aceita até 200 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.reserva_imovel WHERE id = v_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF r.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Reserva cancelada não recebe consumo de estoque.' USING ERRCODE = 'P0001';
  END IF;

  IF v_escopo = 'PRODUTO' THEN
    SELECT p.titulo, p.unidade::text INTO v_titulo, v_unidade
      FROM public.produto p WHERE p.id = v_item_id AND coalesce(p.is_deleted, false) = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002'; END IF;
    v_saida := public.registrar_saida_estoque(v_item_id, v_quantidade, 'CONSUMO_EM_RESERVA', v_observacao, v_user);
    v_saida_id := (v_saida->>'saida_id')::bigint;
    v_saldo := (v_saida->>'saldo_resultante')::integer;
    UPDATE public.estoque_saida SET reserva_imovel_id = r.id WHERE id = v_saida_id;
    SELECT i.valor_custo_aplicado INTO v_custo
      FROM public.estoque_saida_item i WHERE i.saida_id = v_saida_id AND i.produto_id = v_item_id;
  ELSE
    SELECT i.titulo, i.unidade::text INTO v_titulo, v_unidade
      FROM public.usoconsumo_item i WHERE i.id = v_item_id AND i.ativo AND i.escopo = v_escopo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado neste estoque.' USING ERRCODE = 'P0002'; END IF;
    v_saida := public.registrar_saida_usoconsumo(
      jsonb_build_object('escopo', v_escopo, 'motivo', 'CONSUMO_EM_RESERVA', 'observacao', v_observacao, 'created_by', v_user),
      jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantidade', v_quantidade)));
    v_saida_id := (v_saida->>'saida_id')::bigint;
    UPDATE public.usoconsumo_saida SET reserva_imovel_id = r.id WHERE id = v_saida_id;
    SELECT i.valor_custo_aplicado, i.saldo_resultante INTO v_custo, v_saldo
      FROM public.usoconsumo_saida_item i WHERE i.saida_id = v_saida_id AND i.item_id = v_item_id;
  END IF;

  -- O custo do cadastro é a base; o valor informado à mão é o escape, e fica marcado.
  v_valor_base := round(coalesce(v_custo, 0) * v_quantidade, 2);
  IF v_valor IS NULL THEN
    v_valor := v_valor_base;
  ELSE
    v_valor := round(v_valor, 2);
    v_editado := v_valor IS DISTINCT FROM v_valor_base;
  END IF;
  v_titulo := coalesce(nullif(btrim(coalesce(v_titulo, '')), ''), 'Item #' || v_item_id);
  -- Competência como a dos outros custos da reserva: o dia escolhido ou a entrada do hóspede.
  v_competencia := (coalesce(v_data, r.inicio) + time '12:00') AT TIME ZONE 'America/Fortaleza';

  PERFORM set_config('app.audit_user_id', v_user::text, true);
  INSERT INTO public.eventos_financeiros (
    ordemservicoid, source_type, source_id, source_item_id,
    origem, natureza, natureza_dre, chave_origem,
    descricao, detalhe, valor, data_evento, competencia_em,
    produtoid, quantidade_snapshot, valor_unitario_snapshot,
    is_manual, pode_gerar_transacao, status,
    consumo_saida_id, consumo_usoconsumo_saida_id,
    dados_snapshot, created_by
  ) VALUES (
    NULL, 'RESERVA', r.id, v_item_id,
    'CONSUMO', 'DESPESA', public.natureza_dre_de_evento('CONSUMO', 'DESPESA'),
    -- Os dois estoques numeram as saídas em sequências próprias: o escopo desempata a chave.
    'CONSUMO:' || v_escopo || ':' || v_saida_id,
    coalesce(v_descricao, 'Consumo - ' || v_titulo),
    v_quantidade || ' ' || coalesce(v_unidade, 'UN') || ' - ' || CASE v_escopo
      WHEN 'PRODUTO' THEN 'Estoque de produtos' WHEN 'USOCONSUMO' THEN 'Uso e consumo' ELSE 'Geral/Avulso' END
      || coalesce(' · ' || v_observacao, ''),
    v_valor, v_competencia, v_competencia,
    CASE WHEN v_escopo = 'PRODUTO' THEN v_item_id END, v_quantidade, coalesce(v_custo, 0),
    true, false, 'ATIVO',
    CASE WHEN v_escopo = 'PRODUTO' THEN v_saida_id END,
    CASE WHEN v_escopo <> 'PRODUTO' THEN v_saida_id END,
    jsonb_build_object(
      'consumo_de_estoque', true, 'escopo', v_escopo, 'item_id', v_item_id, 'item_titulo', v_titulo,
      'unidade', coalesce(v_unidade, 'UN'), 'saida_id', v_saida_id, 'custo_unitario', coalesce(v_custo, 0),
      'valor_base', v_valor_base, 'valor_editado', v_editado, 'observacao', v_observacao,
      'reserva_id', r.id, 'imovel_id', r.imovel_id, 'proprietario_id', r.proprietario_id),
    v_user
  ) RETURNING * INTO v_evento;

  PERFORM public.imob_classificar_evento_reserva(v_evento.id, v_user);

  RETURN jsonb_build_object('evento_id', v_evento.id, 'saida_id', v_saida_id, 'escopo', v_escopo,
    'valor', v_valor, 'saldo_resultante', v_saldo, 'competencia_em', v_evento.competencia_em);
END $fn$;

-- ---------------------------------------------------------------- 3) cancelamento pela reserva
CREATE OR REPLACE FUNCTION public.imob_cancelar_consumo_reserva(
  p_reserva_id bigint, p_evento_id bigint, p_motivo text, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_evento public.eventos_financeiros%ROWTYPE;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF p_usuario IS NULL THEN RAISE EXCEPTION 'Operador não identificado.' USING ERRCODE = '42501'; END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.reserva_imovel WHERE id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros
   WHERE id = p_evento_id AND source_type = 'RESERVA' AND source_id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consumo não encontrado nesta reserva.' USING ERRCODE = 'P0002'; END IF;
  IF v_evento.origem <> 'CONSUMO' THEN RAISE EXCEPTION 'Este evento não é um consumo de estoque.' USING ERRCODE = 'P0001'; END IF;
  IF v_evento.status = 'CANCELADO' THEN RAISE EXCEPTION 'Este consumo já foi cancelado.' USING ERRCODE = 'P0001'; END IF;
  IF v_evento.status = 'CONVERTIDO' OR v_evento.transacaoid IS NOT NULL OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este consumo já está no financeiro. Desfaça o lançamento antes de devolver o item ao estoque.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.consumo_reserva_estorno', 'permitido', true);
  IF v_evento.consumo_saida_id IS NOT NULL THEN
    PERFORM public.cancelar_saida_estoque(v_evento.consumo_saida_id, v_motivo, p_usuario);
  ELSIF v_evento.consumo_usoconsumo_saida_id IS NOT NULL THEN
    PERFORM public.cancelar_saida_usoconsumo(v_evento.consumo_usoconsumo_saida_id, v_motivo, p_usuario);
  ELSE
    PERFORM set_config('app.consumo_reserva_estorno', '', true);
    RAISE EXCEPTION 'Este consumo não tem saída de estoque vinculada.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.consumo_reserva_estorno', '', true);

  PERFORM set_config('app.audit_user_id', p_usuario::text, true);
  UPDATE public.eventos_financeiros
     SET status = 'CANCELADO', updated_at = now(),
         dados_snapshot = coalesce(dados_snapshot, '{}'::jsonb)
           || jsonb_build_object('cancelado_em', now(), 'cancelado_por', p_usuario, 'motivo_cancelamento', v_motivo)
   WHERE id = v_evento.id;

  RETURN jsonb_build_object('evento_id', v_evento.id, 'status', 'CANCELADO', 'competencia_em', v_evento.competencia_em);
END $fn$;

REVOKE ALL ON FUNCTION public.imob_proteger_saida_da_reserva() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imob_registrar_consumo_reserva(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_registrar_consumo_reserva(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.imob_cancelar_consumo_reserva(bigint, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_cancelar_consumo_reserva(bigint, bigint, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
