BEGIN;

-- Os cadastros antigos podem conter documentos incompletos. NOT VALID evita
-- bloquear a migration, mas passa a proteger toda inclusao/alteracao futura.
ALTER TABLE public.cliente
  DROP CONSTRAINT IF EXISTS cliente_documento_canonico_chk;
ALTER TABLE public.cliente
  ADD CONSTRAINT cliente_documento_canonico_chk CHECK (
    (tipopessoa::text = 'FISICA' AND cpfcnpj ~ '^[0-9]{11}$')
    OR (
      tipopessoa::text = 'JURIDICA'
      AND cpfcnpj = public.fiscal_cnpj_normalizar(cpfcnpj)
      AND public.fiscal_cnpj_valido(cpfcnpj)
    )
  ) NOT VALID;

ALTER TABLE public.fornecedor
  DROP CONSTRAINT IF EXISTS fornecedor_documento_canonico_chk;
ALTER TABLE public.fornecedor
  ADD CONSTRAINT fornecedor_documento_canonico_chk CHECK (
    cpfcnpj ~ '^[0-9]{11}$'
    OR (
      cpfcnpj = public.fiscal_cnpj_normalizar(cpfcnpj)
      AND public.fiscal_cnpj_valido(cpfcnpj)
    )
  ) NOT VALID;

-- Preserva letras na verificacao e no snapshot do aprovador da OS.
CREATE OR REPLACE FUNCTION public.responder_aprovacao_os(
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
  v_token public.osaprovacao%ROWTYPE;
  v_os public.ordemservico%ROWTYPE;
  v_documento_cliente text;
  v_documento text := public.fiscal_cnpj_normalizar(p_documento);
  v_acao text := upper(btrim(coalesce(p_acao, '')));
  v_resultado public.enum_status_aprovacao;
  v_novo_status public.enum_status_os;
BEGIN
  IF v_acao NOT IN ('APROVAR', 'REPROVAR') THEN
    RAISE EXCEPTION 'Acao de aprovacao invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token
    FROM public.osaprovacao
   WHERE token = p_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link de aprovacao invalido.' USING ERRCODE = 'P0002';
  END IF;
  IF v_token.usado_em IS NOT NULL
     OR (v_token.expira_em IS NOT NULL AND v_token.expira_em <= now()) THEN
    RAISE EXCEPTION 'Este link nao esta mais disponivel para resposta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_os
    FROM public.ordemservico
   WHERE id = v_token.ordemservicoid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de servico nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_os.status::text <> 'APROVACAO_ORCAMENTO'
     OR v_os.statusaprovacao::text IS DISTINCT FROM 'PENDENTE' THEN
    RAISE EXCEPTION 'Este orcamento nao esta aguardando aprovacao.' USING ERRCODE = '22023';
  END IF;

  SELECT public.fiscal_cnpj_normalizar(c.cpfcnpj)
    INTO v_documento_cliente
    FROM public.cliente c
   WHERE c.id = v_os.clienteid;
  IF coalesce(v_documento, '') = '' OR v_documento IS DISTINCT FROM v_documento_cliente THEN
    RAISE EXCEPTION 'Documento nao confere para este orcamento.' USING ERRCODE = '22023';
  END IF;

  v_resultado := CASE
    WHEN v_acao = 'APROVAR' THEN 'APROVADA'::public.enum_status_aprovacao
    ELSE 'REPROVADA'::public.enum_status_aprovacao
  END;
  v_novo_status := CASE
    WHEN v_acao = 'APROVAR' THEN 'ORCAMENTO_APROVADO'::public.enum_status_os
    ELSE 'ORCAMENTO_RECUSADO'::public.enum_status_os
  END;

  UPDATE public.osaprovacao
     SET usado_em = now(),
         origem = 'LINK',
         resultado = v_resultado::text,
         aprovador_doc = v_documento,
         aprovador_usuario_id = NULL
   WHERE id = v_token.id
     AND usado_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este link ja foi respondido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ordemservico
     SET status = v_novo_status,
         statusaprovacao = v_resultado,
         updatedat = now()
   WHERE id = v_os.id;

  RETURN jsonb_build_object(
    'ordemservicoid', v_os.id,
    'status', v_novo_status::text,
    'statusaprovacao', v_resultado::text
  );
END;
$$;

-- Mesma garantia para o link publico de aprovacao de venda.
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
  v_documento text := public.fiscal_cnpj_normalizar(p_documento);
  v_acao text := upper(btrim(coalesce(p_acao, '')));
  v_resultado public.enum_status_aprovacao;
  v_novo_status public.enum_status_venda;
BEGIN
  IF v_acao NOT IN ('APROVAR', 'REPROVAR') THEN
    RAISE EXCEPTION 'Acao de aprovacao invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_token
    FROM public.vendaaprovacao
   WHERE token = p_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link de aprovacao invalido.' USING ERRCODE = 'P0002';
  END IF;
  IF v_token.usado_em IS NOT NULL OR v_token.invalidado_em IS NOT NULL OR v_token.expira_em <= now() THEN
    RAISE EXCEPTION 'Este link nao esta mais disponivel para resposta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venda
    FROM public.venda
   WHERE id = v_token.vendaid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text <> 'APROVACAO_ORCAMENTO'
     OR v_venda.statusaprovacao::text IS DISTINCT FROM 'PENDENTE' THEN
    RAISE EXCEPTION 'Este orcamento nao esta aguardando aprovacao.' USING ERRCODE = '22023';
  END IF;

  SELECT public.fiscal_cnpj_normalizar(c.cpfcnpj)
    INTO v_documento_cliente
    FROM public.cliente c
   WHERE c.id = v_venda.clienteid;
  IF coalesce(v_documento, '') = '' OR v_documento IS DISTINCT FROM v_documento_cliente THEN
    RAISE EXCEPTION 'Documento nao confere para este orcamento.' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Este link ja foi respondido.' USING ERRCODE = '22023';
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

ALTER FUNCTION public.responder_aprovacao_os(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.responder_aprovacao_venda(uuid, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.responder_aprovacao_os(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.responder_aprovacao_venda(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responder_aprovacao_os(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.responder_aprovacao_venda(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
