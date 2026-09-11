-- Regressao: reset, cancelamento e sem cobranca excluem pagamentos/titulos.
-- O teste inteiro termina em ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_os integer;
  v_modelo public.transacao%ROWTYPE;
  v_status_destino text;
  v_restantes integer;
  v_cols text;
BEGIN
  /*
   * Coluna gerada nao se insere.
   *
   * `data_dia` (20260901220000) veio depois deste teste e passou a fazer parte
   * do %ROWTYPE, quebrando os inserts com "cannot insert a non-DEFAULT value".
   * A lista de colunas passa a ser explicita e o registro entra por
   * `jsonb_populate_record` — o script continua sem conhecer o schema, e uma
   * coluna gerada nova amanha tambem nao o quebra.
   */
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.transacao'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attgenerated = '';
  SELECT o.id INTO v_os
  FROM public.ordemservico o
  WHERE coalesce(o.is_deleted, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.transacao t
      WHERE t.ordemservicoid = o.id AND t.is_deleted = false
    )
  LIMIT 1;

  IF v_os IS NULL THEN
    RAISE EXCEPTION 'Nenhuma OS sem transacoes disponivel para o teste.';
  END IF;

  SELECT t.* INTO v_modelo
  FROM public.transacao t
  WHERE t.is_deleted = false
    AND upper(t.tipo::text) = 'RECEITA'
  LIMIT 1;

  IF v_modelo.id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma receita disponivel como molde.';
  END IF;

  FOREACH v_status_destino IN ARRAY ARRAY['ORCAMENTO', 'CANCELADO', 'SEM_COBRANCA'] LOOP
    UPDATE public.ordemservico
       SET status = 'ORCAMENTO_APROVADO',
           orcamentototal = 1000,
           acrescimo_financeiro_tipo = NULL,
           acrescimo_financeiro_valor = 0
     WHERE id = v_os;

    v_modelo.id := nextval(pg_get_serial_sequence('public.transacao', 'id'));
    v_modelo.ordemservicoid := v_os;
    v_modelo.vendaid := NULL;
    v_modelo.entrada_id := NULL;
    v_modelo.usoconsumo_entrada_id := NULL;
    v_modelo.evento_financeiro_id := NULL;
    v_modelo.adiantamento_id := NULL;
    v_modelo.eh_adiantamento := false;
    v_modelo.estorno_transacao_id := NULL;
    v_modelo.is_deleted := false;
    v_modelo.pendente := false;
    v_modelo.valor := 400;
    v_modelo.valor_base := 400;
    v_modelo.valor_acrescimos := 0;
    v_modelo.valor_descontos := 0;
    v_modelo."valorLiquido" := 400;
    v_modelo.descricao := 'TESTE EXCLUSAO OS - recebido';
    v_modelo.data := now();
    EXECUTE format(
      'INSERT INTO public.transacao (%s) SELECT %s FROM jsonb_populate_record(null::public.transacao, $1)',
      v_cols, v_cols
    ) USING to_jsonb(v_modelo);

    v_modelo.id := nextval(pg_get_serial_sequence('public.transacao', 'id'));
    v_modelo.pendente := true;
    v_modelo.valor := 600;
    v_modelo.valor_base := 600;
    v_modelo."valorLiquido" := 600;
    v_modelo.descricao := 'TESTE EXCLUSAO OS - titulo';
    EXECUTE format(
      'INSERT INTO public.transacao (%s) SELECT %s FROM jsonb_populate_record(null::public.transacao, $1)',
      v_cols, v_cols
    ) USING to_jsonb(v_modelo);

    UPDATE public.ordemservico
       SET status = v_status_destino::public.enum_status_os
     WHERE id = v_os;

    SELECT count(*) INTO v_restantes
    FROM public.transacao t
    WHERE t.ordemservicoid = v_os
      AND upper(t.tipo::text) = 'RECEITA'
      AND t.evento_financeiro_id IS NULL
      AND t.is_deleted = false;

    IF v_restantes <> 0 THEN
      RAISE EXCEPTION 'Status % deixou % pagamento(s)/titulo(s) na OS.',
        v_status_destino, v_restantes;
    END IF;

    RAISE NOTICE 'OK: status % excluiu pagamentos e titulos.', v_status_destino;
  END LOOP;
END $$;

ROLLBACK;
