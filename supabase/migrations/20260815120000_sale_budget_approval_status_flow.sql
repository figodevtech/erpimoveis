BEGIN;

-- Enquadra os links e recusas criados pela versão anterior sem quebrar URLs
-- ainda válidas durante a implantação dos novos estados.
ALTER TABLE public.venda DISABLE TRIGGER trg_venda_status_invalidar_aprovacao;

UPDATE public.venda v
   SET status = 'APROVACAO_ORCAMENTO'
 WHERE v.status::text = 'ORCAMENTO'
   AND v.statusaprovacao::text = 'PENDENTE'
   AND EXISTS (
     SELECT 1
       FROM public.vendaaprovacao a
      WHERE a.vendaid = v.id
        AND a.usado_em IS NULL
        AND a.invalidado_em IS NULL
        AND a.expira_em > now()
   );

UPDATE public.venda
   SET status = 'ORCAMENTO_RECUSADO'
 WHERE status::text = 'ORCAMENTO'
   AND statusaprovacao::text = 'REPROVADA';

UPDATE public.venda
   SET statusaprovacao = NULL
 WHERE status::text = 'ORCAMENTO'
   AND statusaprovacao::text = 'PENDENTE';

ALTER TABLE public.venda ENABLE TRIGGER trg_venda_status_invalidar_aprovacao;

-- Uma alteração no conteúdo público invalida a proposta que o cliente recebeu.
-- Se ela estava aguardando resposta, volta a ser um orçamento editável.
CREATE OR REPLACE FUNCTION public.tg_invalidar_aprovacao_venda_alterada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda_id integer;
  v_invalidacoes integer := 0;
  v_status text;
  v_eh_troca_status boolean := TG_NAME = 'trg_venda_status_invalidar_aprovacao';
  v_status_mudou_na_edicao boolean := false;
BEGIN
  IF TG_NAME = 'trg_venda_invalidar_aprovacao_alterada' THEN
    v_status_mudou_na_edicao :=
      (to_jsonb(OLD)->>'status') IS DISTINCT FROM (to_jsonb(NEW)->>'status');
  END IF;

  IF TG_TABLE_NAME = 'venda' THEN
    IF TG_OP = 'DELETE' THEN
      v_venda_id := OLD.id;
    ELSE
      v_venda_id := NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_venda_id := OLD.venda_id;
  ELSE
    v_venda_id := NEW.venda_id;
  END IF;

  v_invalidacoes := public.invalidar_aprovacoes_venda(v_venda_id, 'ORCAMENTO_ALTERADO');

  SELECT status::text INTO v_status FROM public.venda WHERE id = v_venda_id;

  IF v_invalidacoes > 0
     OR (
       NOT v_eh_troca_status
       AND NOT v_status_mudou_na_edicao
       AND v_status IN ('APROVACAO_ORCAMENTO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO')
     ) THEN
    UPDATE public.venda
       SET status = CASE
             WHEN v_status IN ('APROVACAO_ORCAMENTO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO')
               THEN 'ORCAMENTO'::public.enum_status_venda
             ELSE status
           END,
           statusaprovacao = NULL,
           updatedat = now()
     WHERE id = v_venda_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Gera ou reutiliza um link sob a mesma trava da venda e já move o orçamento
-- para a etapa operacional de espera. Assim não existe token sem status (ou o
-- inverso) em caso de falha ou concorrência.
CREATE OR REPLACE FUNCTION public.preparar_venda_para_aprovacao(
  p_venda_id integer,
  p_novo_token uuid,
  p_expira_em timestamptz,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_aprovacao public.vendaaprovacao%ROWTYPE;
  v_documento text;
  v_reutilizado boolean := false;
BEGIN
  SELECT * INTO v_venda
    FROM public.venda
   WHERE id = p_venda_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text NOT IN ('ORCAMENTO', 'APROVACAO_ORCAMENTO', 'ORCAMENTO_RECUSADO') THEN
    RAISE EXCEPTION 'Esta venda não pode ser enviada para aprovação no status atual.'
      USING ERRCODE = '22023';
  END IF;

  SELECT regexp_replace(coalesce(c.cpfcnpj, ''), '\D', '', 'g')
    INTO v_documento
    FROM public.cliente c
   WHERE c.id = v_venda.clienteid;
  IF coalesce(v_documento, '') = '' THEN
    RAISE EXCEPTION 'O cliente precisa possuir CPF/CNPJ para receber o link de aprovação.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_aprovacao
    FROM public.vendaaprovacao
   WHERE vendaid = p_venda_id
     AND usado_em IS NULL
     AND invalidado_em IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND
     AND v_venda.status::text = 'APROVACAO_ORCAMENTO'
     AND v_venda.statusaprovacao::text = 'PENDENTE'
     AND v_aprovacao.expira_em > now() THEN
    v_reutilizado := true;
  ELSE
    IF v_aprovacao.id IS NOT NULL THEN
      UPDATE public.vendaaprovacao
         SET invalidado_em = now(),
             motivo_invalidacao = CASE
               WHEN v_aprovacao.expira_em <= now() THEN 'EXPIRADO'
               ELSE 'NOVO_ENVIO'
             END
       WHERE id = v_aprovacao.id;
    END IF;

    UPDATE public.venda
       SET status = 'APROVACAO_ORCAMENTO',
           statusaprovacao = 'PENDENTE',
           updated_by = coalesce(p_usuario_id, updated_by),
           updatedat = now()
     WHERE id = p_venda_id;

    INSERT INTO public.vendaaprovacao (
      vendaid, token, expira_em, created_by
    ) VALUES (
      p_venda_id, p_novo_token, p_expira_em, p_usuario_id
    )
    RETURNING * INTO v_aprovacao;
  END IF;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'APROVACAO_ORCAMENTO',
    'statusaprovacao', 'PENDENTE',
    'token', v_aprovacao.token,
    'expiraEm', v_aprovacao.expira_em,
    'reutilizado', v_reutilizado
  );
END;
$$;

-- Aprovação interna registra a decisão, mas não pula a etapa de orçamento
-- aprovado. O avanço para pagamento é uma operação própria logo abaixo.
CREATE OR REPLACE FUNCTION public.aprovar_orcamento_venda(
  p_venda_id integer,
  p_dados jsonb DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
BEGIN
  SELECT * INTO v_venda
    FROM public.venda
   WHERE id = p_venda_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text = 'ORCAMENTO_APROVADO' THEN
    RETURN jsonb_build_object(
      'vendaId', p_venda_id,
      'status', 'ORCAMENTO_APROVADO',
      'statusaprovacao', 'APROVADA'
    );
  END IF;
  IF v_venda.status::text NOT IN ('ORCAMENTO', 'APROVACAO_ORCAMENTO') THEN
    RAISE EXCEPTION 'Este orçamento não pode ser aprovado no status atual.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.invalidar_aprovacoes_venda(p_venda_id, 'APROVACAO_INTERNA');

  UPDATE public.venda
     SET status = 'ORCAMENTO_APROVADO',
         statusaprovacao = 'APROVADA',
         forma_pagamento = CASE
           WHEN p_dados ? 'formaPagamento' THEN nullif(p_dados->>'formaPagamento', '')
           ELSE forma_pagamento END,
         pagamentos_previstos = CASE
           WHEN p_dados ? 'pagamentosPrevistos' THEN nullif(p_dados->'pagamentosPrevistos', 'null'::jsonb)
           ELSE pagamentos_previstos END,
         parcelas_pagamento = CASE
           WHEN p_dados ? 'parcelasPagamento' THEN nullif(p_dados->>'parcelasPagamento', '')::integer
           ELSE parcelas_pagamento END,
         descricao = CASE
           WHEN p_dados ? 'descricao' THEN nullif(btrim(p_dados->>'descricao'), '')
           ELSE descricao END,
         observacoes = CASE
           WHEN p_dados ? 'observacoes' THEN nullif(btrim(p_dados->>'observacoes'), '')
           ELSE observacoes END,
         descricao_financeiro = CASE
           WHEN p_dados ? 'descricaoFinanceiro' THEN nullif(btrim(p_dados->>'descricaoFinanceiro'), '')
           ELSE descricao_financeiro END,
         observacoes_fiscais = CASE
           WHEN p_dados ? 'observacoesFiscais' THEN nullif(btrim(p_dados->>'observacoesFiscais'), '')
           ELSE observacoes_fiscais END,
         garantia = CASE
           WHEN p_dados ? 'garantia' THEN nullif(btrim(p_dados->>'garantia'), '')
           ELSE garantia END,
         updated_by = coalesce(p_usuario_id, updated_by),
         updatedat = now()
   WHERE id = p_venda_id;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'ORCAMENTO_APROVADO',
    'statusaprovacao', 'APROVADA'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.responder_aprovacao_venda(
  p_token uuid,
  p_documento text,
  p_acao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.vendaaprovacao%ROWTYPE;
  v_venda public.venda%ROWTYPE;
  v_documento_cliente text;
  v_documento text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_acao text := upper(btrim(coalesce(p_acao, '')));
  v_resultado public.enum_status_aprovacao;
  v_novo_status public.enum_status_venda;
BEGIN
  IF v_acao NOT IN ('APROVAR', 'REPROVAR') THEN
    RAISE EXCEPTION 'Ação de aprovação inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token
    FROM public.vendaaprovacao
   WHERE token = p_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link de aprovação inválido.' USING ERRCODE = 'P0002';
  END IF;
  IF v_token.usado_em IS NOT NULL OR v_token.invalidado_em IS NOT NULL OR v_token.expira_em <= now() THEN
    RAISE EXCEPTION 'Este link não está mais disponível para resposta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venda
    FROM public.venda
   WHERE id = v_token.vendaid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text <> 'APROVACAO_ORCAMENTO'
     OR v_venda.statusaprovacao::text IS DISTINCT FROM 'PENDENTE' THEN
    RAISE EXCEPTION 'Este orçamento não está aguardando aprovação.' USING ERRCODE = '22023';
  END IF;

  SELECT regexp_replace(coalesce(c.cpfcnpj, ''), '\D', '', 'g')
    INTO v_documento_cliente
    FROM public.cliente c
   WHERE c.id = v_venda.clienteid;
  IF v_documento = '' OR v_documento IS DISTINCT FROM v_documento_cliente THEN
    RAISE EXCEPTION 'Documento não confere para este orçamento.' USING ERRCODE = '22023';
  END IF;

  v_resultado := CASE WHEN v_acao = 'APROVAR' THEN 'APROVADA' ELSE 'REPROVADA' END;
  v_novo_status := CASE
    WHEN v_acao = 'APROVAR' THEN 'ORCAMENTO_APROVADO'::public.enum_status_venda
    ELSE 'ORCAMENTO_RECUSADO'::public.enum_status_venda
  END;

  UPDATE public.vendaaprovacao
     SET usado_em = now(),
         origem = 'LINK',
         resultado = v_resultado,
         aprovador_doc = v_documento
   WHERE id = v_token.id
     AND usado_em IS NULL
     AND invalidado_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este link já foi respondido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.venda
     SET status = v_novo_status,
         statusaprovacao = v_resultado,
         updatedat = now()
   WHERE id = v_venda.id;

  RETURN jsonb_build_object(
    'vendaId', v_venda.id,
    'status', v_novo_status::text,
    'statusaprovacao', v_resultado
  );
END;
$$;

-- Único ponto que transforma um orçamento aprovado em venda a receber. A
-- função de estoque já registra a baixa por venda/produto e é idempotente.
CREATE OR REPLACE FUNCTION public.avancar_venda_aprovada_pagamento(
  p_venda_id integer,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
BEGIN
  SELECT * INTO v_venda
    FROM public.venda
   WHERE id = p_venda_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text IN ('PAGAMENTO', 'PAGO', 'FINALIZADA') THEN
    RETURN jsonb_build_object(
      'vendaId', p_venda_id,
      'status', v_venda.status::text,
      'statusaprovacao', v_venda.statusaprovacao::text
    );
  END IF;
  IF v_venda.status::text <> 'ORCAMENTO_APROVADO' THEN
    RAISE EXCEPTION 'Apenas um orçamento aprovado pode avançar para pagamento.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.fn_baixar_estoque_venda(p_venda_id);

  UPDATE public.venda
     SET status = 'PAGAMENTO',
         statusaprovacao = 'APROVADA',
         updated_by = coalesce(p_usuario_id, updated_by),
         updatedat = now()
   WHERE id = p_venda_id;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'PAGAMENTO',
    'statusaprovacao', 'APROVADA'
  );
END;
$$;

ALTER FUNCTION public.tg_invalidar_aprovacao_venda_alterada() OWNER TO postgres;
ALTER FUNCTION public.preparar_venda_para_aprovacao(integer, uuid, timestamptz, uuid) OWNER TO postgres;
ALTER FUNCTION public.aprovar_orcamento_venda(integer, jsonb, uuid) OWNER TO postgres;
ALTER FUNCTION public.responder_aprovacao_venda(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.avancar_venda_aprovada_pagamento(integer, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.preparar_venda_para_aprovacao(integer, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprovar_orcamento_venda(integer, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.responder_aprovacao_venda(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avancar_venda_aprovada_pagamento(integer, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preparar_venda_para_aprovacao(integer, uuid, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aprovar_orcamento_venda(integer, jsonb, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.responder_aprovacao_venda(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.avancar_venda_aprovada_pagamento(integer, uuid)
  TO service_role;

COMMIT;
