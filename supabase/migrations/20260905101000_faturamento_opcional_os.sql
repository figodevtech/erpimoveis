-- Sem recálculo histórico. Todas as oficinas permanecem no fluxo padrão.
ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS habilitar_faturamento_os boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.faturamento_os_habilitado()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN coalesce((SELECT habilitar_faturamento_os FROM public.config_geral ORDER BY id DESC LIMIT 1), false);
END;
$$;

-- A configuração toma o lock exclusivo ANTES das linhas. Operações financeiras
-- usam o compartilhado, mantido até commit/rollback, sem serializar entre si.
CREATE OR REPLACE FUNCTION public.travar_fluxo_faturamento_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'config_geral' THEN
    PERFORM pg_advisory_xact_lock(87009, 1);
  ELSE
    PERFORM pg_advisory_xact_lock_shared(87009, 1);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS aa_travar_fluxo_faturamento ON public.config_geral;
CREATE TRIGGER aa_travar_fluxo_faturamento BEFORE INSERT OR UPDATE OR DELETE
ON public.config_geral FOR EACH STATEMENT EXECUTE FUNCTION public.travar_fluxo_faturamento_os();
DROP TRIGGER IF EXISTS aa_travar_fluxo_faturamento ON public.ordemservico;
CREATE TRIGGER aa_travar_fluxo_faturamento BEFORE INSERT OR UPDATE OR DELETE
ON public.ordemservico FOR EACH STATEMENT EXECUTE FUNCTION public.travar_fluxo_faturamento_os();
DROP TRIGGER IF EXISTS aa_travar_fluxo_faturamento ON public.transacao;
CREATE TRIGGER aa_travar_fluxo_faturamento BEFORE INSERT OR UPDATE OR DELETE
ON public.transacao FOR EACH STATEMENT EXECUTE FUNCTION public.travar_fluxo_faturamento_os();
DROP TRIGGER IF EXISTS aa_travar_fluxo_faturamento ON public.pagamento_multiplo_rateio;
CREATE TRIGGER aa_travar_fluxo_faturamento BEFORE INSERT OR UPDATE OR DELETE
ON public.pagamento_multiplo_rateio FOR EACH STATEMENT EXECUTE FUNCTION public.travar_fluxo_faturamento_os();

CREATE OR REPLACE FUNCTION public.devolver_os_ao_desativar_faturamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.habilitar_faturamento_os AND NOT NEW.habilitar_faturamento_os THEN
    -- Desligar a etapa é uma decisão administrativa, não um acontecimento de
    -- cada OS: avisar a equipe uma vez por OS devolvida seria só ruído. A
    -- auditoria continua registrando tudo; apenas a notificação é silenciada.
    PERFORM set_config('app.devolucao_faturamento_em_massa', 'on', true);
    UPDATE public.ordemservico SET status = 'PAGAMENTO', updatedat = now()
    WHERE status = 'FATURAMENTO' AND NOT coalesce(is_deleted, false);
    PERFORM set_config('app.devolucao_faturamento_em_massa', 'off', true);
  END IF;
  -- A auditoria de configuração e de cada OS é feita pelos triggers existentes,
  -- na mesma transação, preservando o contexto do autor da requisição.
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS devolver_os_ao_desativar_faturamento ON public.config_geral;
CREATE TRIGGER devolver_os_ao_desativar_faturamento AFTER UPDATE OF habilitar_faturamento_os
ON public.config_geral FOR EACH ROW EXECUTE FUNCTION public.devolver_os_ao_desativar_faturamento();

CREATE OR REPLACE FUNCTION public.fn_registrar_evento_notificacao_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text;
  v_status_anterior text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'CRIADA';
    v_status_anterior := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Devolução em massa por desativação da etapa não notifica: ver
    -- devolver_os_ao_desativar_faturamento.
    IF coalesce(current_setting('app.devolucao_faturamento_em_massa', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
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

CREATE OR REPLACE FUNCTION public.validar_status_faturamento_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ativo boolean := public.faturamento_os_habilitado();
  v_quitada boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status = 'FATURAMENTO' THEN
    IF NOT v_ativo THEN
      RAISE EXCEPTION 'A etapa de faturamento está desativada. Atualize a tela.' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('PAGAMENTO', 'CONCLUIDO') THEN
      RAISE EXCEPTION 'Somente uma OS em Pagamento pode ser enviada para faturamento.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_ativo AND NEW.status = 'CONCLUIDO' AND NEW.migracao_referencia IS NULL THEN
    SELECT quitada INTO v_quitada FROM public.resumo_financeiro_os(NEW.id);
    IF NOT coalesce(v_quitada, false) THEN
      RAISE EXCEPTION 'Registre a cobertura integral da OS em Faturamento antes de concluir.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aa_validar_status_faturamento ON public.ordemservico;
CREATE TRIGGER aa_validar_status_faturamento BEFORE INSERT OR UPDATE OF status
ON public.ordemservico FOR EACH ROW EXECUTE FUNCTION public.validar_status_faturamento_os();

CREATE OR REPLACE FUNCTION public.validar_novo_recebimento_os(p_os_id integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  PERFORM pg_advisory_xact_lock(87001, p_os_id);
  SELECT status::text INTO v_status FROM public.ordemservico
    WHERE id = p_os_id AND NOT coalesce(is_deleted, false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO')
     AND v_status <> (CASE WHEN public.faturamento_os_habilitado() THEN 'FATURAMENTO' ELSE 'PAGAMENTO' END) THEN
    RAISE EXCEPTION 'A OS não está disponível para novos registros financeiros. Verifique o status e a configuração de faturamento.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_rateio_faturamento_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo_documento = 'OS' AND (TG_OP = 'INSERT'
      OR OLD.documento_id IS DISTINCT FROM NEW.documento_id
      OR OLD.tipo_documento IS DISTINCT FROM NEW.tipo_documento
      OR NEW.valor > OLD.valor) THEN
    PERFORM public.validar_novo_recebimento_os(NEW.documento_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validar_rateio_faturamento_os ON public.pagamento_multiplo_rateio;
CREATE TRIGGER validar_rateio_faturamento_os BEFORE INSERT OR UPDATE
ON public.pagamento_multiplo_rateio FOR EACH ROW EXECUTE FUNCTION public.validar_rateio_faturamento_os();

-- RPC de transição manual: valida origem e modo no mesmo lock da alteração.
CREATE OR REPLACE FUNCTION public.transicionar_faturamento_os(p_os_id integer, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_os public.ordemservico;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  PERFORM pg_advisory_xact_lock(87001, p_os_id);
  SELECT * INTO v_os FROM public.ordemservico WHERE id = p_os_id AND NOT coalesce(is_deleted, false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.faturamento_os_habilitado() THEN
    RAISE EXCEPTION 'A etapa de faturamento está desativada. Atualize a tela.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT ((v_os.status = 'PAGAMENTO' AND p_status = 'FATURAMENTO')
      OR (v_os.status = 'FATURAMENTO' AND p_status = 'PAGAMENTO')) THEN
    RAISE EXCEPTION 'O status da OS mudou. Atualize a tela antes de continuar.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ordemservico SET status = p_status::public.enum_status_os, updatedat = now() WHERE id = p_os_id;
  IF p_status = 'FATURAMENTO' THEN PERFORM public.recalcular_status_financeiro_os(p_os_id); END IF;
  SELECT * INTO v_os FROM public.ordemservico WHERE id = p_os_id;
  RETURN to_jsonb(v_os);
END;
$$;
REVOKE ALL ON FUNCTION public.transicionar_faturamento_os(integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_faturamento_os(integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_ajustar_eventos_frete_os()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('PAGAMENTO', 'FATURAMENTO') AND NEW.status IN ('PAGAMENTO', 'FATURAMENTO')
     AND OLD.orcamentototal IS NOT DISTINCT FROM NEW.orcamentototal
     AND OLD.valor_frete IS NOT DISTINCT FROM NEW.valor_frete THEN RETURN NEW; END IF;
  PERFORM public.ajustar_eventos_frete_os(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_limite_pagamento_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_total_devido numeric(14,2);
  v_ja_comprometido numeric(14,2);
  v_novo_valor_face numeric(14,2);
BEGIN
  IF NEW.ordemservicoid IS NULL
     OR upper(NEW.tipo::text) <> 'RECEITA'
     OR NEW.evento_financeiro_id IS NOT NULL
     OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(87009, 1);

  -- O lock vive até o fim da transação que efetivamente insere/edita a linha.
  PERFORM pg_advisory_xact_lock(87001, NEW.ordemservicoid);

  SELECT o.status::text,
         round(
           greatest(coalesce(o.orcamentototal, 0), 0) +
           CASE
             WHEN o.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
               greatest(coalesce(o.orcamentototal, 0), 0) *
               least(greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0), 100) / 100
             WHEN o.acrescimo_financeiro_tipo = 'FIXO' THEN
               greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0)
             ELSE 0
           END,
           2
         )
    INTO v_status, v_total_devido
  FROM public.ordemservico o
  WHERE o.id = NEW.ordemservicoid
    AND coalesce(o.is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF TG_OP = 'INSERT' OR OLD.ordemservicoid IS DISTINCT FROM NEW.ordemservicoid
     OR OLD.tipo IS DISTINCT FROM NEW.tipo
     OR OLD.evento_financeiro_id IS DISTINCT FROM NEW.evento_financeiro_id
     OR (OLD.is_deleted AND NOT NEW.is_deleted)
     OR (public.faturamento_os_habilitado() AND NEW.valor - coalesce(NEW.valor_acrescimos,0) > OLD.valor - coalesce(OLD.valor_acrescimos,0)) THEN
    PERFORM public.validar_novo_recebimento_os(NEW.ordemservicoid);
  END IF;

  IF v_total_devido <= 0 THEN
    RAISE EXCEPTION 'A OS não possui valor financeiro disponível para pagamento.'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(round(sum(r.valor), 2), 0) INTO v_ja_comprometido
    FROM public.recebimento_por_documento r
   WHERE r.tipo_documento = 'OS' AND r.documento_id = NEW.ordemservicoid
     AND (TG_OP = 'INSERT' OR r.transacao_id <> NEW.id);

  v_novo_valor_face := round(
    greatest(coalesce(NEW.valor, 0) - greatest(coalesce(NEW.valor_acrescimos, 0), 0), 0),
    2
  );

  IF round(v_ja_comprometido + v_novo_valor_face, 2) > v_total_devido THEN
    RAISE EXCEPTION 'A soma de pagamentos e títulos ultrapassa o total financeiro da OS. Saldo disponível: R$ %.',
      to_char(greatest(v_total_devido - v_ja_comprometido, 0), 'FM999G999G990D00')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_status_financeiro_os(p_ordemservicoid integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_pagamento_concluido_em timestamptz;
  v_total_devido numeric(14,2);
  v_valor_comprometido numeric(14,2);
  v_quitada boolean;
  v_novo_status text;
  v_novo_pagamento_concluido_em timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  SELECT o.status::text, o.pagamento_concluido_em
    INTO v_status, v_pagamento_concluido_em
  FROM public.ordemservico o
  WHERE o.id = p_ordemservicoid
    AND coalesce(o.is_deleted, false) = false
    AND o.migracao_referencia IS NULL FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT r.total_devido, r.valor_comprometido, r.quitada
    INTO v_total_devido, v_valor_comprometido, v_quitada
  FROM public.resumo_financeiro_os(p_ordemservicoid) r;

  v_novo_status := v_status;
  IF v_status IN ('PAGAMENTO', 'FATURAMENTO') AND v_quitada THEN
    v_novo_status := 'CONCLUIDO';
  ELSIF v_status = 'CONCLUIDO'
        AND v_total_devido > 0
        AND v_valor_comprometido < v_total_devido THEN
    v_novo_status := CASE WHEN public.faturamento_os_habilitado() THEN 'FATURAMENTO' ELSE 'PAGAMENTO' END;
  END IF;

  v_novo_pagamento_concluido_em := CASE
    WHEN v_quitada THEN coalesce(v_pagamento_concluido_em, now())
    ELSE NULL
  END;

  UPDATE public.ordemservico
  SET status = v_novo_status::public.enum_status_os,
      pagamento_concluido_em = v_novo_pagamento_concluido_em,
      updatedat = now()
  WHERE id = p_ordemservicoid
    AND (
      status::text IS DISTINCT FROM v_novo_status OR
      pagamento_concluido_em IS DISTINCT FROM v_novo_pagamento_concluido_em
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_multiplo(p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo_documento text := upper(coalesce(p_payload->>'tipo_documento', ''));
  v_modo text := upper(coalesce(p_payload->>'modo', ''));
  v_valor_total numeric(14,2) := round(coalesce((p_payload->>'valor_total')::numeric, 0), 2);
  v_liquido_total numeric(14,2) := round(coalesce((p_payload->>'valor_liquido')::numeric, 0), 2);
  v_data timestamptz := coalesce(nullif(p_payload->>'data', '')::timestamptz, now());
  v_banco_id bigint := nullif(p_payload->>'banco_id', '')::bigint;
  v_metodo public.metodo_pagamento := nullif(p_payload->>'metodopagamento', '')::public.metodo_pagamento;
  v_created_by uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_categoria text := coalesce(nullif(p_payload->>'categoria', ''), 'NÃO RELACIONADO');
  v_categoria_id integer := nullif(p_payload->>'categoria_id', '')::integer;
  v_plano_id integer := nullif(p_payload->>'plano_de_conta_id', '')::integer;
  v_centro_id integer := nullif(p_payload->>'centro_custo_id', '')::integer;
  v_pendente boolean := (v_modo = 'PARCELADO');
  v_grupo_id bigint;
  v_soma numeric(14,2);
  v_doc_id integer;
  v_documentos integer[] := ARRAY[]::integer[];
  v_cliente_id integer := nullif(p_payload->>'cliente_id', '')::integer;
  v_nome text := nullif(btrim(p_payload->>'nomepagador'), '');
  v_cpfcnpj text := nullif(btrim(p_payload->>'cpfcnpjpagador'), '');
  v_clientes integer[];
  v_descricao_grupo text;
  v_descricao text;
  v_parcela record;
  v_transacao_id bigint;
  v_total_parcelas integer;
  v_comprometido numeric(14,2);
  v_devido numeric(14,2);
  v_liquido numeric(14,2);
  v_liquido_acumulado numeric(14,2) := 0;
  v_indice integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  IF v_tipo_documento NOT IN ('OS', 'VENDA') THEN
    RAISE EXCEPTION 'tipo_documento deve ser OS ou VENDA.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modo NOT IN ('AVISTA', 'PARCELADO') THEN
    RAISE EXCEPTION 'modo deve ser AVISTA ou PARCELADO.' USING ERRCODE = 'P0001';
  END IF;
  IF v_valor_total <= 0 THEN
    RAISE EXCEPTION 'O valor do pagamento deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'linhas') <> 'array'
     OR jsonb_array_length(p_payload->'linhas') = 0 THEN
    RAISE EXCEPTION 'Informe as linhas do rateio.' USING ERRCODE = 'P0001';
  END IF;

  -- Sem líquido informado, líquido é o próprio valor: não houve taxa.
  IF v_liquido_total <= 0 THEN v_liquido_total := v_valor_total; END IF;

  SELECT round(coalesce(sum((item->>'valor')::numeric), 0), 2) INTO v_soma
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  IF v_soma <> v_valor_total THEN
    RAISE EXCEPTION 'A soma do rateio (%) difere do valor do pagamento (%).',
      v_soma, v_valor_total USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT (item->>'documento_id')::integer ORDER BY (item->>'documento_id')::integer)
    INTO v_documentos
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
    PERFORM pg_advisory_xact_lock(87001, v_doc_id);
    IF v_tipo_documento = 'OS' THEN PERFORM public.validar_novo_recebimento_os(v_doc_id); END IF;
  END LOOP;

  IF v_cliente_id IS NULL THEN
    IF v_tipo_documento = 'OS' THEN
      SELECT array_agg(DISTINCT o.clienteid) INTO v_clientes
        FROM public.ordemservico o WHERE o.id = ANY (v_documentos);
    ELSE
      SELECT array_agg(DISTINCT v.clienteid) INTO v_clientes
        FROM public.venda v WHERE v.id = ANY (v_documentos);
    END IF;

    IF array_length(v_clientes, 1) = 1 THEN
      v_cliente_id := v_clientes[1];
    END IF;
  END IF;

  IF v_cliente_id IS NOT NULL AND (v_nome IS NULL OR v_cpfcnpj IS NULL) THEN
    SELECT coalesce(v_nome, c.nomerazaosocial), coalesce(v_cpfcnpj, c.cpfcnpj)
      INTO v_nome, v_cpfcnpj
      FROM public.cliente c WHERE c.id = v_cliente_id;
  END IF;

  v_descricao_grupo := coalesce(
    nullif(btrim(p_payload->>'descricao'), ''),
    'Pagamento múltiplo de ' || array_length(v_documentos, 1) || ' documento(s)');

  INSERT INTO public.pagamento_multiplo (
    descricao, modo, tipo_documento, valor_total, data, banco_id, metodopagamento, created_by
  ) VALUES (
    v_descricao_grupo, v_modo, v_tipo_documento, v_valor_total, v_data,
    v_banco_id, v_metodo, v_created_by
  ) RETURNING id INTO v_grupo_id;

  SELECT max((item->>'total_parcelas')::integer) INTO v_total_parcelas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;
  v_total_parcelas := greatest(coalesce(v_total_parcelas, 1), 1);

  FOR v_parcela IN
    SELECT (item->>'parcela')::integer AS numero,
           round(sum((item->>'valor')::numeric), 2) AS valor,
           min(nullif(item->>'vencimento_em', '')) AS vencimento
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     GROUP BY (item->>'parcela')::integer
     ORDER BY 1
  LOOP
    v_indice := v_indice + 1;

    -- O líquido acompanha a proporção do valor. A última parcela leva a sobra
    -- para a soma dos líquidos fechar exatamente com o informado.
    IF v_indice = v_total_parcelas THEN
      v_liquido := round(v_liquido_total - v_liquido_acumulado, 2);
    ELSE
      v_liquido := round(v_parcela.valor * v_liquido_total / v_valor_total, 2);
      v_liquido_acumulado := v_liquido_acumulado + v_liquido;
    END IF;

    v_descricao := v_descricao_grupo;
    IF v_total_parcelas > 1 THEN
      v_descricao := v_descricao || ' - Parcela ' || v_parcela.numero || '/' || v_total_parcelas;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
      plano_de_conta_id, centro_custo_id, tipo, cliente_id, banco_id,
      nomepagador, cpfcnpjpagador, pendente, pago_em,
      ordemservicoid, vendaid, pagamento_multiplo_id, created_by
    ) VALUES (
      v_descricao,
      v_parcela.valor,
      greatest(v_liquido, 0),
      coalesce(v_parcela.vencimento::timestamptz, v_data),
      v_metodo, v_categoria, v_categoria_id, v_plano_id, v_centro_id,
      'RECEITA'::public.tipos_transacao, v_cliente_id,
      CASE WHEN v_pendente THEN NULL ELSE v_banco_id END,
      coalesce(v_nome, 'Diversos'),
      coalesce(v_cpfcnpj, 'NÃO INFORMADO'),
      v_pendente,
      CASE WHEN v_pendente THEN NULL ELSE v_data END,
      NULL, NULL,
      v_grupo_id, v_created_by
    ) RETURNING id INTO v_transacao_id;

    INSERT INTO public.pagamento_multiplo_rateio (
      pagamento_multiplo_id, transacao_id, tipo_documento, documento_id, valor
    )
    SELECT v_grupo_id, v_transacao_id, v_tipo_documento,
           (item->>'documento_id')::integer,
           round((item->>'valor')::numeric, 2)
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     WHERE (item->>'parcela')::integer = v_parcela.numero
       AND round((item->>'valor')::numeric, 2) > 0;
  END LOOP;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
    IF v_tipo_documento = 'OS' THEN
      SELECT r.total_devido, r.valor_comprometido
        INTO v_devido, v_comprometido
        FROM public.resumo_financeiro_os(v_doc_id) r;
    ELSE
      SELECT round(
               greatest(coalesce(v.valortotal, 0), 0) +
               CASE
                 WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
                   greatest(coalesce(v.valortotal, 0), 0) *
                   least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
                 WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN
                   greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
                 ELSE 0
               END, 2)
        INTO v_devido
        FROM public.venda v WHERE v.id = v_doc_id;

      SELECT coalesce(round(sum(r.valor), 2), 0) INTO v_comprometido
        FROM public.recebimento_por_documento r
       WHERE r.tipo_documento = 'VENDA' AND r.documento_id = v_doc_id;
    END IF;

    IF coalesce(v_devido, 0) <= 0 THEN
      RAISE EXCEPTION 'O documento #% não possui valor financeiro disponível para pagamento.',
        v_doc_id USING ERRCODE = '23514';
    END IF;
    IF round(coalesce(v_comprometido, 0), 2) > v_devido THEN
      RAISE EXCEPTION 'O rateio ultrapassa o saldo do documento #%: comprometido % de %.',
        v_doc_id, v_comprometido, v_devido USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN v_grupo_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.separar_conclusao_financeira_da_saida_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status::text = 'CONCLUIDO'
     and old.status::text is distinct from 'CONCLUIDO' then
    new.pagamento_concluido_em := coalesce(new.pagamento_concluido_em, new.datasaida, now());
  end if;
  if old.status::text = 'CONCLUIDO' and new.status::text IN ('PAGAMENTO', 'FATURAMENTO') then
    new.pagamento_concluido_em := null;
  end if;

  if new.datasaida is distinct from old.datasaida
     and not exists (
       select 1 from public.os_saida s where s.ordemservico_id = old.id
     ) then
    new.datasaida := old.datasaida;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_eventos_frete_os(p_ordemservicoid integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_frete numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_bruto numeric(14,2) := 0;
  v_desconto numeric(14,2) := 0;
BEGIN
  SELECT o.status::text, round(coalesce(o.valor_frete, 0), 2), round(coalesce(o.orcamentototal, 0), 2),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                         FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                         FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_status, v_frete, v_total, v_bruto
    FROM public.ordemservico o
   WHERE o.id = p_ordemservicoid;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO') THEN
    UPDATE public.eventos_financeiros
       SET status = 'CANCELADO', updated_at = now()
     WHERE ordemservicoid = p_ordemservicoid
       AND origem IN ('FRETE', 'DESCONTO') AND status = 'ATIVO';
    RETURN;
  END IF;

  IF v_frete > 0 THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao,
       detalhe, valor, dados_snapshot, pode_gerar_transacao, status, updated_at)
    VALUES
      (p_ordemservicoid, 'FRETE', 'RECEITA', 'RECEITA', 'FRETE',
       'Frete - OS #' || p_ordemservicoid, 'Receita de frete da ordem de servico',
       v_frete, jsonb_build_object('valor_frete', v_frete), false, 'ATIVO', now())
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO UPDATE SET
      valor = excluded.valor,
      natureza_dre = 'RECEITA',
      dados_snapshot = excluded.dados_snapshot,
      status = 'ATIVO',
      updated_at = now()
    WHERE public.eventos_financeiros.status <> 'CONVERTIDO';
  ELSE
    UPDATE public.eventos_financeiros
       SET status = 'CANCELADO', updated_at = now()
     WHERE ordemservicoid = p_ordemservicoid
       AND origem = 'FRETE' AND status <> 'CONVERTIDO';
  END IF;

  -- O total comercial inclui frete. Para recuperar o desconto sobre os itens,
  -- a formula correta e bruto + frete - total da OS.
  v_desconto := round(greatest(v_bruto + v_frete - v_total, 0), 2);
  IF v_desconto > 0 THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao,
       detalhe, valor, dados_snapshot, pode_gerar_transacao, status, updated_at)
    VALUES
      (p_ordemservicoid, 'DESCONTO', 'DESPESA', 'DEDUCAO', 'DESCONTO',
       'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
       v_desconto, jsonb_build_object('bruto', v_bruto, 'frete', v_frete, 'total_os', v_total),
       false, 'ATIVO', now())
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO UPDATE SET
      valor = excluded.valor,
      natureza_dre = 'DEDUCAO',
      dados_snapshot = excluded.dados_snapshot,
      status = 'ATIVO',
      updated_at = now()
    WHERE public.eventos_financeiros.status <> 'CONVERTIDO';
  ELSE
    UPDATE public.eventos_financeiros
       SET status = 'CANCELADO', updated_at = now()
     WHERE ordemservicoid = p_ordemservicoid
       AND origem = 'DESCONTO' AND status <> 'CONVERTIDO';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vincular_produto_avulso_os(p_ordem_id integer, p_avulso_id bigint, p_produto_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_modo text := 'ORCAMENTO';
  v_quantidade integer;
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_ordem_id::bigint, 'OS #' || p_ordem_id);
  PERFORM public.vincular_produto_avulso_os_interna(p_ordem_id, p_avulso_id, p_produto_id);

  SELECT status::text
    INTO v_status
  FROM public.ordemservico
  WHERE id = p_ordem_id;

  SELECT COALESCE(modo_baixa_estoque_os::text, 'ORCAMENTO')
    INTO v_modo
  FROM public.config_geral
  ORDER BY id DESC
  LIMIT 1;

  -- PAGAMENTO acompanha EM_ANDAMENTO pela mesma razao que no PUT do orcamento:
  -- a OS ja consumiu material, entao mexer nos itens tem que mexer no saldo.
  IF v_modo = 'EXECUCAO' AND v_status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO') THEN
    SELECT quantidade::integer
      INTO v_quantidade
    FROM public.osproduto
    WHERE ordemservicoid = p_ordem_id AND produtoid = p_produto_id;

    IF v_quantidade IS NOT NULL AND v_quantidade > 0 THEN
      PERFORM public.sincronizar_baixa_estoque_os_produto(p_ordem_id, p_produto_id, v_quantidade);
    END IF;
  END IF;

  IF v_status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO') THEN
    PERFORM public.reconciliar_eventos_financeiros_os(
      p_ordem_id,
      v_status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO')
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_reconciliar_eventos_ao_finalizar_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status::text in ('PAGAMENTO', 'FATURAMENTO') and new.status::text in ('PAGAMENTO', 'FATURAMENTO') then
    return new;
  end if;

  if new.status::text = 'CANCELADO' then
    -- Cancelar a OS nao remove seus itens, entao reconciliar recriaria os
    -- eventos com valor cheio. O correto e encerra-los.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO';

  elsif new.status::text = 'SEM_COBRANCA' then
    -- Acerta custo pelo caminho normal...
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
    -- ...e retira receita, deducao e comissao, que nao existem numa OS sem
    -- cobranca. Sobra o custo da peca, que foi consumida de verdade.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO'
       and (natureza = 'RECEITA' or origem = 'DESCONTO' or origem = 'COMISSAO');

  -- PAGAMENTO junto de CONCLUIDO: nos dois o trabalho terminou e
  -- `execucao_fim_em` ja foi carimbado. Deixar PAGAMENTO de fora fazia a OS
  -- entrar nos relatorios por conclusao sem nunca ter publicado a comissao.
  elsif new.status::text in ('CONCLUIDO', 'PAGAMENTO') then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;

  return new;
end;
$function$;
