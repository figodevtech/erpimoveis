-- Exclusao segura dos eventos criados manualmente na OS e classificacao do
-- custo de frete terceirizado. A receita de frete continua pertencendo ao
-- orcamento e nunca e removida por este fluxo.

BEGIN;

-- O valor cobrado do cliente fica em 1.3. O custo pago a transportadora e um
-- servico terceirizado direto e, portanto, entra separadamente em 4.6.
WITH template AS (
  SELECT id
    FROM public.dre_template
   WHERE codigo = 'PADRAO' AND versao = 1
), linha AS (
  SELECT dl.id, dl.template_id
    FROM public.dre_linha dl
    JOIN template t ON t.id = dl.template_id
   WHERE dl.codigo = '4.6'
)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT linha.template_id, linha.id, 'EVENTO_ORIGEM', 'FRETE:DESPESA', 100,
       'Despesa manual de transportadora vinculada a receita de frete da ordem de servico.'
  FROM linha
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.dre_mapeamento existente
    WHERE existente.template_id = linha.template_id
      AND existente.origem_tipo = 'EVENTO_ORIGEM'
      AND existente.origem_valor = 'FRETE:DESPESA'
 );

CREATE OR REPLACE FUNCTION public.excluir_evento_financeiro_manual_os(
  p_ordemservico_id integer,
  p_evento_id bigint,
  p_motivo text DEFAULT NULL,
  p_usuario uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_evento public.eventos_financeiros%ROWTYPE;
  v_status_os text;
  v_os_excluida boolean;
  v_manual_de_origem boolean;
  v_consumo_com_estoque boolean;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF p_ordemservico_id IS NULL OR p_ordemservico_id <= 0
     OR p_evento_id IS NULL OR p_evento_id <= 0 THEN
    RAISE EXCEPTION 'Identificador invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_evento
    FROM public.eventos_financeiros
   WHERE id = p_evento_id
     AND ordemservicoid = p_ordemservico_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento financeiro nao encontrado nesta OS.' USING ERRCODE = 'P0002';
  END IF;

  v_consumo_com_estoque :=
    v_evento.origem = 'CONSUMO'
    AND v_evento.natureza = 'DESPESA'
    AND (v_evento.consumo_saida_id IS NOT NULL OR v_evento.consumo_usoconsumo_saida_id IS NOT NULL);
  v_manual_de_origem :=
    coalesce(v_evento.is_manual, false)
    AND (
      coalesce(v_evento.chave_origem, '') LIKE 'MANUAL:%'
      OR v_consumo_com_estoque
    );

  -- Uma comissao corrigida recebe is_manual para congelar seu calculo, mas
  -- continua sendo automatica. Frete/receita pertence ao orcamento.
  IF NOT v_manual_de_origem
     OR v_evento.origem = 'COMISSAO'
     OR (v_evento.origem = 'FRETE' AND v_evento.natureza = 'RECEITA') THEN
    RAISE EXCEPTION 'Este evento foi gerado automaticamente e deve ser corrigido na origem que o criou.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_evento.status = 'CONVERTIDO'
     OR v_evento.transacaoid IS NOT NULL
     OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este evento ja foi lancado no Financeiro. Exclua primeiro a transacao ou o lancamento vinculado.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Somente eventos financeiros ativos podem ser excluidos.' USING ERRCODE = 'P0001';
  END IF;

  SELECT o.status::text, coalesce(o.is_deleted, false)
    INTO v_status_os, v_os_excluida
    FROM public.ordemservico o
   WHERE o.id = p_ordemservico_id
   FOR UPDATE;
  IF NOT FOUND OR v_os_excluida THEN
    RAISE EXCEPTION 'OS nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status_os = 'CANCELADO' THEN
    RAISE EXCEPTION 'Esta OS esta cancelada e seus eventos financeiros nao podem mais ser alterados.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_consumo_com_estoque AND v_status_os IN ('CONCLUIDO', 'SEM_COBRANCA') THEN
    RAISE EXCEPTION 'A OS #% ja foi finalizada. Reabra a OS para excluir este consumo e devolver o item ao estoque.',
      p_ordemservico_id USING ERRCODE = 'P0001';
  END IF;
  IF v_consumo_com_estoque AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para devolver o item ao estoque.' USING ERRCODE = '22023';
  END IF;

  -- Faz o gatilho generico de auditoria atribuir UPDATE/DELETE ao operador que
  -- chamou a API, mesmo a RPC sendo executada pelo service_role.
  PERFORM set_config('app.audit_user_id', coalesce(p_usuario::text, ''), true);

  IF v_consumo_com_estoque THEN
    -- A funcao existente cancela a saida e devolve o saldo. Como esta chamada e
    -- interna a mesma RPC, qualquer falha no DELETE tambem desfaz o estorno.
    PERFORM public.cancelar_consumo_produto_os(p_evento_id, v_motivo, p_usuario);
  END IF;

  DELETE FROM public.eventos_financeiros
   WHERE id = p_evento_id
     AND ordemservicoid = p_ordemservico_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O evento mudou durante a exclusao. Recarregue a OS e tente novamente.'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'evento_id', p_evento_id,
    'excluido', true,
    'estoque_devolvido', v_consumo_com_estoque,
    'saida_id', coalesce(v_evento.consumo_saida_id, v_evento.consumo_usoconsumo_saida_id)
  );
END;
$fn$;

COMMENT ON FUNCTION public.excluir_evento_financeiro_manual_os(integer, bigint, text, uuid) IS
  'Exclui evento manual da OS; quando for consumo, cancela a saida e devolve o estoque atomicamente.';

ALTER FUNCTION public.excluir_evento_financeiro_manual_os(integer, bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.excluir_evento_financeiro_manual_os(integer, bigint, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_evento_financeiro_manual_os(integer, bigint, text, uuid)
  TO service_role;

COMMIT;
