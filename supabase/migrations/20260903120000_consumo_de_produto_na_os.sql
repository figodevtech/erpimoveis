-- Consumo de produto direto na ordem de servico.
--
-- O caso: um desengripante sai do estoque durante a OS, vira custo dela, e NAO e
-- cobrado do cliente. Hoje isso exige duas operacoes desconectadas -- uma saida
-- avulsa em Estoque > Historico e um evento financeiro manual na OS -- e nada
-- liga as duas. Esta migracao faz das duas uma so.
--
-- DESENHO
--
-- 1) O documento de baixa continua sendo uma SAIDA de verdade (`estoque_saida` ou
--    `usoconsumo_saida`), porque fisicamente e isso. Reusar as RPCs de saida que
--    ja existem traz de graca a trava de linha, a checagem de saldo, o carimbo no
--    razao, a tela de detalhes e o filtro do historico. O vinculo com a OS entra
--    como coluna nova `ordemservicoid`, e o motivo `CONSUMO_EM_OS` identifica a
--    linha no historico.
--
-- 2) O evento financeiro nasce com origem propria `CONSUMO`, nao `PRODUTO`. Como
--    PRODUTO:DESPESA o custo cairia na linha 4.1 da DRE (custo da mercadoria
--    VENDIDA, que nao e o caso) e o agrupador do painel da OS o colaria sob o
--    card de venda do mesmo produto, como se o cliente pagasse por ele. Origem
--    propria vira linha solta e mapeia para a 4.4 -- Materiais aplicados.
--
-- 3) Estorno nos dois sentidos, porque saldo sem caminho de volta nao e
--    auditavel:
--      - pela OS, com `cancelar_consumo_produto_os`;
--      - automatico, quando a OS e cancelada ou tem o orcamento recusado.
--    E o caminho pelo Estoque fica FECHADO: cancelar a saida por la devolveria o
--    saldo e deixaria a despesa viva na OS. A RPC recusa e aponta a OS.
--
-- ORDEM DOS GATILHOS -- e o detalhe que manda no desenho do estorno automatico.
-- `trg_reconciliar_eventos_ao_finalizar_os` e BEFORE UPDATE OF status e cancela
-- TODOS os eventos ATIVO da OS; `ordemservico_status_estorno` e AFTER. Quando o
-- estorno roda, o evento de consumo JA ESTA CANCELADO. Por isso
-- `estornar_consumos_os` seleciona pelo DOCUMENTO (saida CONFIRMADA com
-- ordemservicoid e motivo CONSUMO_EM_OS), nunca pelo status do evento.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Motivo de saida
-- ---------------------------------------------------------------------------
-- `AMBOS` porque o consumo pode sair de qualquer um dos tres estoques.
INSERT INTO public.tipos_motivo_saida (codigo, nome, descricao, escopo) VALUES
  ('CONSUMO_EM_OS', 'Consumo em ordem de serviço',
   'Material consumido durante uma ordem de serviço, sem repasse ao cliente.', 'AMBOS')
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Vinculo do documento de saida com a OS
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, e nao CASCADE: apagar a OS nao pode apagar a prova de que
-- o material saiu do estoque.
ALTER TABLE public.estoque_saida
  ADD COLUMN IF NOT EXISTS ordemservicoid integer
    REFERENCES public.ordemservico(id) ON DELETE SET NULL;
ALTER TABLE public.usoconsumo_saida
  ADD COLUMN IF NOT EXISTS ordemservicoid integer
    REFERENCES public.ordemservico(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS estoque_saida_os_idx
  ON public.estoque_saida(ordemservicoid) WHERE ordemservicoid IS NOT NULL;
CREATE INDEX IF NOT EXISTS usoconsumo_saida_os_idx
  ON public.usoconsumo_saida(ordemservicoid) WHERE ordemservicoid IS NOT NULL;

COMMENT ON COLUMN public.estoque_saida.ordemservicoid IS
  'OS que consumiu o material. Preenchido por registrar_consumo_produto_os; trava o cancelamento pelo Estoque.';
COMMENT ON COLUMN public.usoconsumo_saida.ordemservicoid IS
  'OS que consumiu o material. Preenchido por registrar_consumo_produto_os; trava o cancelamento pelo Estoque.';

-- ---------------------------------------------------------------------------
-- 3) Origem CONSUMO no livro de eventos
-- ---------------------------------------------------------------------------
ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_origem_check
  CHECK (origem = ANY (ARRAY[
    'PRODUTO', 'SERVICO', 'COMISSAO', 'AVULSO', 'DESCONTO', 'FRETE',
    'ENTRADA_FISCAL', 'CONSUMO']));

-- Ponteiro para o documento de baixa. Coluna, e nao dados_snapshot, porque o
-- estorno e o portao precisam navegar nos dois sentidos com FK e indice.
ALTER TABLE public.eventos_financeiros
  ADD COLUMN IF NOT EXISTS consumo_saida_id bigint
    REFERENCES public.estoque_saida(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS consumo_usoconsumo_saida_id bigint
    REFERENCES public.usoconsumo_saida(id) ON DELETE RESTRICT;

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_consumo_documento_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_consumo_documento_check
  CHECK (consumo_saida_id IS NULL OR consumo_usoconsumo_saida_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS eventos_financeiros_consumo_saida_uk
  ON public.eventos_financeiros (consumo_saida_id) WHERE consumo_saida_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eventos_financeiros_consumo_usoconsumo_uk
  ON public.eventos_financeiros (consumo_usoconsumo_saida_id) WHERE consumo_usoconsumo_saida_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Registro do consumo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_consumo_produto_os(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_os_id       integer := nullif(p_payload->>'ordemservicoid', '')::integer;
  v_escopo      text    := upper(btrim(coalesce(p_payload->>'escopo', '')));
  v_item_id     integer := nullif(p_payload->>'item_id', '')::integer;
  v_quantidade  integer := nullif(p_payload->>'quantidade', '')::integer;
  v_observacao  text    := nullif(btrim(coalesce(p_payload->>'observacao', '')), '');
  v_descricao   text    := nullif(btrim(coalesce(p_payload->>'descricao', '')), '');
  v_detalhe     text    := nullif(btrim(coalesce(p_payload->>'detalhe', '')), '');
  v_valor       numeric(14,2) := nullif(p_payload->>'valor', '')::numeric;
  v_pode_gerar  boolean := coalesce((p_payload->>'pode_gerar_transacao')::boolean, false);
  v_user        uuid    := nullif(p_payload->>'created_by', '')::uuid;
  v_status_os   text;
  v_saida       jsonb;
  v_saida_id    bigint;
  v_custo       numeric(14,4);
  v_saldo       integer;
  v_titulo      text;
  v_unidade     text;
  v_valor_base  numeric(14,2);
  v_editado     boolean := false;
  v_evento_id   bigint;
BEGIN
  IF v_os_id IS NULL OR v_os_id <= 0 THEN
    RAISE EXCEPTION 'Informe a ordem de servico.' USING ERRCODE = '22023';
  END IF;
  IF v_escopo NOT IN ('PRODUTO', 'USOCONSUMO', 'GERAL') THEN
    RAISE EXCEPTION 'Estoque invalido: %.', v_escopo USING ERRCODE = '22023';
  END IF;
  IF v_item_id IS NULL OR v_item_id <= 0 THEN
    RAISE EXCEPTION 'Selecione o item consumido.' USING ERRCODE = '22023';
  END IF;
  IF v_quantidade IS NULL OR v_quantidade <= 0 THEN
    RAISE EXCEPTION 'A quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF v_valor IS NOT NULL AND v_valor < 0 THEN
    RAISE EXCEPTION 'O valor da despesa nao pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  SELECT o.status::text INTO v_status_os
    FROM public.ordemservico o
   WHERE o.id = v_os_id AND coalesce(o.is_deleted, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- Os tres primeiros sao a mesma regra do POST de eventos financeiros. O quarto
  -- entra porque ORCAMENTO_RECUSADO e um estado em que o estoque esta voltando.
  IF v_status_os IN ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO', 'ORCAMENTO_RECUSADO') THEN
    RAISE EXCEPTION 'Nao e possivel registrar consumo numa OS com status %.',
      replace(v_status_os, '_', ' ') USING ERRCODE = 'P0001';
  END IF;

  IF v_escopo = 'PRODUTO' THEN
    SELECT p.titulo, p.unidade::text INTO v_titulo, v_unidade
      FROM public.produto p
     WHERE p.id = v_item_id AND coalesce(p.is_deleted, false) = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto nao encontrado.' USING ERRCODE = 'P0002';
    END IF;

    -- A RPC inteira, e nao um recorte dela: e ela que trava a linha, confere o
    -- saldo e carimba a origem no razao.
    v_saida := public.registrar_saida_estoque(
      v_item_id, v_quantidade, 'CONSUMO_EM_OS', v_observacao, v_user
    );
    v_saida_id := (v_saida->>'saida_id')::bigint;
    v_saldo    := (v_saida->>'saldo_resultante')::integer;

    UPDATE public.estoque_saida SET ordemservicoid = v_os_id WHERE id = v_saida_id;

    SELECT i.valor_custo_aplicado INTO v_custo
      FROM public.estoque_saida_item i
     WHERE i.saida_id = v_saida_id AND i.produto_id = v_item_id;
  ELSE
    SELECT i.titulo, i.unidade::text INTO v_titulo, v_unidade
      FROM public.usoconsumo_item i
     WHERE i.id = v_item_id AND i.ativo AND i.escopo = v_escopo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item nao encontrado neste estoque.' USING ERRCODE = 'P0002';
    END IF;

    v_saida := public.registrar_saida_usoconsumo(
      jsonb_build_object(
        'escopo', v_escopo, 'motivo', 'CONSUMO_EM_OS',
        'observacao', v_observacao, 'created_by', v_user
      ),
      jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantidade', v_quantidade))
    );
    v_saida_id := (v_saida->>'saida_id')::bigint;

    UPDATE public.usoconsumo_saida SET ordemservicoid = v_os_id WHERE id = v_saida_id;

    SELECT i.valor_custo_aplicado, i.saldo_resultante INTO v_custo, v_saldo
      FROM public.usoconsumo_saida_item i
     WHERE i.saida_id = v_saida_id AND i.item_id = v_item_id;
  END IF;

  -- O custo do cadastro e a base; o valor informado a mao e o escape, e ele
  -- marca a linha para a correcao nao passar despercebida.
  v_valor_base := round(coalesce(v_custo, 0) * v_quantidade, 2);
  IF v_valor IS NULL THEN
    v_valor := v_valor_base;
  ELSE
    v_valor := round(v_valor, 2);
    v_editado := v_valor IS DISTINCT FROM v_valor_base;
  END IF;

  v_titulo := coalesce(nullif(btrim(coalesce(v_titulo, '')), ''), 'Item #' || v_item_id);

  INSERT INTO public.eventos_financeiros (
    ordemservicoid, source_type, source_id, source_item_id,
    origem, natureza, natureza_dre, chave_origem,
    descricao, detalhe, valor,
    produtoid, quantidade_snapshot, valor_unitario_snapshot,
    is_manual, pode_gerar_transacao,
    consumo_saida_id, consumo_usoconsumo_saida_id,
    dados_snapshot, created_by
  ) VALUES (
    v_os_id, 'ORDEM_SERVICO', v_os_id, v_item_id,
    'CONSUMO', 'DESPESA', 'CUSTO', 'CONSUMO:' || v_saida_id,
    coalesce(v_descricao, 'Consumo - ' || v_titulo),
    coalesce(
      v_detalhe,
      v_quantidade || ' ' || coalesce(v_unidade, 'UN')
        || ' - ' || CASE v_escopo
                      WHEN 'PRODUTO'    THEN 'Estoque de produtos'
                      WHEN 'USOCONSUMO' THEN 'Uso e consumo'
                      ELSE 'Geral/Avulso'
                    END
    ),
    v_valor,
    CASE WHEN v_escopo = 'PRODUTO' THEN v_item_id END,
    v_quantidade, coalesce(v_custo, 0),
    true, v_pode_gerar,
    CASE WHEN v_escopo = 'PRODUTO' THEN v_saida_id END,
    CASE WHEN v_escopo <> 'PRODUTO' THEN v_saida_id END,
    jsonb_build_object(
      'consumo_de_estoque', true,
      'escopo', v_escopo,
      'item_id', v_item_id,
      'item_titulo', v_titulo,
      'unidade', coalesce(v_unidade, 'UN'),
      'saida_id', v_saida_id,
      'custo_unitario', coalesce(v_custo, 0),
      'valor_base', v_valor_base,
      'valor_editado', v_editado,
      'observacao', v_observacao
    ),
    v_user
  ) RETURNING id INTO v_evento_id;

  RETURN jsonb_build_object(
    'evento_id', v_evento_id,
    'saida_id', v_saida_id,
    'escopo', v_escopo,
    'valor', v_valor,
    'saldo_resultante', v_saldo
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5) Estorno pela OS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_consumo_produto_os(
  p_evento_id bigint,
  p_motivo text,
  p_usuario uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_evento    public.eventos_financeiros%ROWTYPE;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_status_os text;
BEGIN
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_evento FROM public.eventos_financeiros WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consumo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_evento.origem <> 'CONSUMO' THEN
    RAISE EXCEPTION 'Este evento nao e um consumo de estoque.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Este consumo ja foi cancelado.' USING ERRCODE = 'P0001';
  END IF;
  -- Dinheiro real amarrado: desfazer aqui deixaria uma transacao orfa.
  IF v_evento.status = 'CONVERTIDO'
     OR v_evento.transacaoid IS NOT NULL
     OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este consumo ja foi lancado no financeiro. Exclua a transacao vinculada antes de devolver o item ao estoque.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT o.status::text INTO v_status_os
    FROM public.ordemservico o WHERE o.id = v_evento.ordemservicoid;
  -- Mesma frase que o lancamento de despesas ja usa, para o operador reconhecer
  -- o caminho: reabrir a OS destrava.
  IF v_status_os IN ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO') THEN
    RAISE EXCEPTION 'A OS #% ja foi finalizada. Reabra a OS para desfazer este consumo.',
      v_evento.ordemservicoid USING ERRCODE = 'P0001';
  END IF;

  IF v_evento.consumo_saida_id IS NOT NULL THEN
    PERFORM set_config('app.consumo_os_estorno', 'permitido', true);
    PERFORM public.cancelar_saida_estoque(v_evento.consumo_saida_id, v_motivo, p_usuario);
    PERFORM set_config('app.consumo_os_estorno', '', true);
  ELSIF v_evento.consumo_usoconsumo_saida_id IS NOT NULL THEN
    PERFORM set_config('app.consumo_os_estorno', 'permitido', true);
    PERFORM public.cancelar_saida_usoconsumo(v_evento.consumo_usoconsumo_saida_id, v_motivo, p_usuario);
    PERFORM set_config('app.consumo_os_estorno', '', true);
  ELSE
    RAISE EXCEPTION 'Este consumo nao tem saida de estoque vinculada.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.eventos_financeiros
     SET status = 'CANCELADO',
         updated_at = now(),
         dados_snapshot = coalesce(dados_snapshot, '{}'::jsonb) || jsonb_build_object(
           'cancelado_em', now(),
           'cancelado_por', p_usuario,
           'motivo_cancelamento', v_motivo
         )
   WHERE id = p_evento_id;

  RETURN jsonb_build_object('evento_id', p_evento_id, 'status', 'CANCELADO');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6) Estorno automatico ao cancelar a OS
-- ---------------------------------------------------------------------------
-- Seleciona pelo DOCUMENTO, nunca pelo status do evento: o gatilho BEFORE ja
-- cancelou o evento quando este AFTER roda (ver cabecalho). Consumo com
-- transacao vinculada fica de fora -- ele e reportado, nao desfeito em silencio.
CREATE OR REPLACE FUNCTION public.estornar_consumos_os(p_os_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_linha  record;
  v_total  integer := 0;
  v_motivo text := 'Estorno automatico: OS #' || p_os_id || ' cancelada ou orcamento recusado';
BEGIN
  FOR v_linha IN
    SELECT s.id AS saida_id, 'PRODUTO'::text AS tipo, e.id AS evento_id
      FROM public.estoque_saida s
      LEFT JOIN public.eventos_financeiros e ON e.consumo_saida_id = s.id
     WHERE s.ordemservicoid = p_os_id
       AND s.motivo = 'CONSUMO_EM_OS'
       AND s.status = 'CONFIRMADA'
       AND (e.id IS NULL OR (e.status <> 'CONVERTIDO'
            AND e.transacaoid IS NULL AND e.lancamento_id IS NULL))
    UNION ALL
    SELECT s.id, 'USOCONSUMO'::text, e.id
      FROM public.usoconsumo_saida s
      LEFT JOIN public.eventos_financeiros e ON e.consumo_usoconsumo_saida_id = s.id
     WHERE s.ordemservicoid = p_os_id
       AND s.motivo = 'CONSUMO_EM_OS'
       AND s.status = 'CONFIRMADA'
       AND (e.id IS NULL OR (e.status <> 'CONVERTIDO'
            AND e.transacaoid IS NULL AND e.lancamento_id IS NULL))
  LOOP
    PERFORM set_config('app.consumo_os_estorno', 'permitido', true);
    IF v_linha.tipo = 'PRODUTO' THEN
      PERFORM public.cancelar_saida_estoque(v_linha.saida_id, v_motivo, NULL);
    ELSE
      PERFORM public.cancelar_saida_usoconsumo(v_linha.saida_id, v_motivo, NULL);
    END IF;
    PERFORM set_config('app.consumo_os_estorno', '', true);

    -- Em CANCELADO o gatilho BEFORE ja fechou o evento; em ORCAMENTO_RECUSADO,
    -- nao -- aquele caminho nao mexe em evento nenhum.
    IF v_linha.evento_id IS NOT NULL THEN
      UPDATE public.eventos_financeiros
         SET status = 'CANCELADO',
             updated_at = now(),
             dados_snapshot = coalesce(dados_snapshot, '{}'::jsonb) || jsonb_build_object(
               'estorno_automatico', true,
               'motivo_cancelamento', v_motivo
             )
       WHERE id = v_linha.evento_id AND status <> 'CANCELADO';
    END IF;

    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$fn$;

-- Uma linha nova no gatilho que ja devolve o estoque de `osproduto_baixa`.
CREATE OR REPLACE FUNCTION public.trg_os_status_estornar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- Rejeicao do orcamento e cancelamento definitivo devolvem qualquer baixa existente.
  IF new.status IN ('ORCAMENTO_RECUSADO', 'CANCELADO')
     AND old.status IS DISTINCT FROM new.status THEN
    PERFORM public.estornar_baixa_estoque_os(new.id);
    PERFORM public.estornar_consumos_os(new.id);
  END IF;
  RETURN new;
END;
$fn$;

ALTER FUNCTION public.trg_os_status_estornar() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 7) Portao do cancelamento pelo Estoque
-- ---------------------------------------------------------------------------
-- Sem isso, cancelar a saida pelo historico devolveria o saldo e deixaria a
-- despesa viva na OS -- divergencia silenciosa entre estoque e resultado. O
-- portao e um set_config transacional, o mesmo mecanismo de
-- `app.usoconsumo_movimento` e de `app.estoque_origem`. So as duas funcoes de
-- estorno acima o abrem.
CREATE OR REPLACE FUNCTION public.cancelar_saida_estoque(
  p_saida_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_os integer;
BEGIN
  SELECT ordemservicoid INTO v_os FROM public.estoque_saida WHERE id = p_saida_id;
  IF v_os IS NOT NULL
     AND coalesce(nullif(current_setting('app.consumo_os_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo consumo registrado na OS #%. Cancele a despesa na ordem de servico para devolver o item ao estoque.',
      v_os USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.estoque_definir_contexto(
    'SAIDA_MANUAL', p_saida_id, 'Saida #' || p_saida_id || ' - cancelada', p_cancelada_by
  );
  RETURN public.cancelar_saida_estoque_interna(p_saida_id, p_motivo, p_cancelada_by);
END;
$fn$;

-- `cancelar_saida_usoconsumo` nao tem casca `_interna`: o corpo abaixo e o de
-- 20260730180000 com o portao acrescentado, e nada mais.
CREATE OR REPLACE FUNCTION public.cancelar_saida_usoconsumo(
  p_saida_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_saida public.usoconsumo_saida%ROWTYPE; v_linha record;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_saida FROM public.usoconsumo_saida WHERE id=p_saida_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saida nao encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_saida.status='CANCELADA' THEN RAISE EXCEPTION 'Saida ja cancelada.' USING ERRCODE='22023'; END IF;
  IF v_saida.ordemservicoid IS NOT NULL
     AND coalesce(nullif(current_setting('app.consumo_os_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo consumo registrado na OS #%. Cancele a despesa na ordem de servico para devolver o item ao estoque.',
      v_saida.ordemservicoid USING ERRCODE='P0001';
  END IF;
  FOR v_linha IN SELECT * FROM public.usoconsumo_saida_item WHERE saida_id=p_saida_id ORDER BY id FOR UPDATE LOOP
    PERFORM 1 FROM public.usoconsumo_item WHERE id=v_linha.item_id FOR UPDATE;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque+v_linha.quantidade,updated_by=p_cancelada_by WHERE id=v_linha.item_id;
  END LOOP;
  UPDATE public.usoconsumo_saida
    SET status='CANCELADA',cancelada_at=now(),cancelada_by=p_cancelada_by,motivo_cancelamento=v_motivo
    WHERE id=p_saida_id;
  RETURN jsonb_build_object('saida_id',p_saida_id,'status','CANCELADA');
END $fn$;

-- ---------------------------------------------------------------------------
-- 8) DRE
-- ---------------------------------------------------------------------------
-- 4.4 "Materiais aplicados" existe no template desde 20260802180000 e ate hoje
-- nao tinha fonte. E exatamente isto: material aplicado na OS, sem repasse.
WITH template AS (
  SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1
), linha AS (
  SELECT dl.id, dl.template_id
    FROM public.dre_linha dl
    JOIN template t ON t.id = dl.template_id
   WHERE dl.codigo = '4.4'
)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT linha.template_id, linha.id, 'EVENTO_ORIGEM', 'CONSUMO:DESPESA', 100,
       'Material consumido durante a ordem de servico, sem repasse ao cliente.'
  FROM linha
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento existente
    WHERE existente.template_id = linha.template_id
      AND existente.origem_tipo = 'EVENTO_ORIGEM'
      AND existente.origem_valor = 'CONSUMO:DESPESA'
 );

-- ---------------------------------------------------------------------------
-- 9) Acesso
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE
  v_assinatura text;
BEGIN
  FOREACH v_assinatura IN ARRAY ARRAY[
    'public.registrar_consumo_produto_os(jsonb)',
    'public.cancelar_consumo_produto_os(bigint, text, uuid)',
    'public.estornar_consumos_os(integer)',
    'public.cancelar_saida_estoque(bigint, text, uuid)',
    'public.cancelar_saida_usoconsumo(bigint, text, uuid)'
  ]
  LOOP
    IF to_regprocedure(v_assinatura) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_assinatura);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_assinatura);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_assinatura);
    END IF;
  END LOOP;
END;
$grants$;

COMMIT;
