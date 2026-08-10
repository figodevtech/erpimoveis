BEGIN;

ALTER TABLE public.ordemservico
  ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.ordemservico
  DROP CONSTRAINT IF EXISTS ordemservico_valor_frete_check,
  ADD CONSTRAINT ordemservico_valor_frete_check CHECK (valor_frete >= 0);

COMMENT ON COLUMN public.ordemservico.valor_frete IS
  'Frete comercial da OS. Compoe orcamentototal e e sugerido integralmente na NF-e; nao se aplica a NFS-e.';

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_origem_check
  CHECK (origem = ANY (ARRAY['PRODUTO', 'SERVICO', 'COMISSAO', 'AVULSO', 'DESCONTO', 'FRETE']));

CREATE OR REPLACE FUNCTION public.ajustar_eventos_frete_os(p_ordemservicoid integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF v_status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO') THEN
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

-- As funcoes legadas de reconciliacao ainda montam sua tabela temporaria sem
-- FRETE. Esta protecao impede que a etapa final cancele o evento correto ou
-- recalcule o desconto como se o frete fosse receita de item.
CREATE OR REPLACE FUNCTION public.tg_preservar_eventos_frete_os()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_frete numeric := 0;
  v_total numeric := 0;
  v_bruto numeric := 0;
  v_desconto numeric := 0;
BEGIN
  IF old.ordemservicoid IS NULL
     OR old.origem NOT IN ('FRETE', 'DESCONTO')
     OR coalesce(old.is_manual, false)
     OR old.status = 'CONVERTIDO' THEN
    RETURN new;
  END IF;

  SELECT o.status::text, coalesce(o.valor_frete, 0), coalesce(o.orcamentototal, 0),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_status, v_frete, v_total, v_bruto
    FROM public.ordemservico o WHERE o.id = old.ordemservicoid;

  IF v_status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO') THEN
    IF old.origem = 'FRETE' AND v_frete > 0 THEN
      new.valor := round(v_frete, 2);
      new.natureza_dre := 'RECEITA';
      new.status := 'ATIVO';
    ELSIF old.origem = 'DESCONTO' THEN
      v_desconto := round(greatest(v_bruto + v_frete - v_total, 0), 2);
      IF v_desconto > 0 THEN
        new.valor := v_desconto;
        new.natureza_dre := 'DEDUCAO';
        new.dados_snapshot := jsonb_build_object('bruto', v_bruto, 'frete', v_frete, 'total_os', v_total);
        new.status := 'ATIVO';
      END IF;
    END IF;
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_preservar_eventos_frete_os ON public.eventos_financeiros;
CREATE TRIGGER trg_preservar_eventos_frete_os
BEFORE UPDATE ON public.eventos_financeiros
FOR EACH ROW EXECUTE FUNCTION public.tg_preservar_eventos_frete_os();

CREATE OR REPLACE FUNCTION public.tg_ajustar_eventos_frete_os()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.ajustar_eventos_frete_os(new.id);
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ajustar_eventos_frete_os ON public.ordemservico;
CREATE TRIGGER trg_ajustar_eventos_frete_os
AFTER UPDATE OF status, orcamentototal, valor_frete ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_ajustar_eventos_frete_os();

CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
  v_total_itens numeric := 0;
  v_total_os_sem_frete numeric := 0;
  v_fator numeric := 1;
  v_base_liquida numeric;
BEGIN
  SELECT coalesce(s.subtotal, 0) INTO v_subtotal
    FROM public.osservico s
   WHERE s.ordemservicoid = p_ordemservicoid AND s.servicoid = p_servicoid;
  SELECT coalesce(sv.gera_comissao, true) INTO v_gera_comissao
    FROM public.servico sv WHERE sv.id = p_servicoid;
  SELECT count(*) INTO v_qtd FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
  IF v_qtd <= 0 THEN RETURN; END IF;

  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os_sem_frete, v_total_itens
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;
  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;
  v_base_liquida := round(v_subtotal * v_fator / v_qtd, 2);

  UPDATE public.osservico_realizador r
     SET valor_base = v_base_liquida,
         valor_comissao = CASE WHEN coalesce(v_gera_comissao, true)
           THEN round(v_base_liquida * coalesce(r.comissao_percent_aplicada, 0) / 100.0, 2)
           ELSE 0 END,
         updated_at = now()
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_recalc_comissao_os_total()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF new.orcamentototal IS DISTINCT FROM old.orcamentototal
     OR new.valor_frete IS DISTINCT FROM old.valor_frete THEN
    PERFORM public.recalcular_comissao_osservico(new.id, s.servicoid)
      FROM public.osservico s WHERE s.ordemservicoid = new.id;
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_comissao_os_total ON public.ordemservico;
CREATE TRIGGER trg_recalc_comissao_os_total
AFTER UPDATE OF orcamentototal, valor_frete ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_os_total();

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT t.id, dl.id, 'EVENTO_ORIGEM', 'FRETE:RECEITA', 100,
       'Receita de frete cobrada em ordem de servico.'
  FROM t JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = '1.3'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'EVENTO_ORIGEM'
      AND x.origem_valor = 'FRETE:RECEITA'
 );

DO $backfill$
DECLARE v_os record;
BEGIN
  FOR v_os IN
    SELECT id FROM public.ordemservico
     WHERE status::text IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
  LOOP
    PERFORM public.ajustar_eventos_frete_os(v_os.id);
  END LOOP;
END;
$backfill$;

COMMIT;
