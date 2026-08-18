-- Testa dre_linha_da_transacao contra dados reais, sem gravar nada.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/dre_linha_da_transacao.sql demir
--
-- O arquivo cria a versao nova da funcao dentro da propria transacao de teste
-- (identica a da migration 20260818110000) e a exercita nos quatro casos que a
-- tela precisa distinguir. O ROLLBACK no fim desfaz tudo, inclusive o CREATE.

BEGIN;

DROP FUNCTION IF EXISTS public.dre_linha_da_transacao(bigint);

CREATE FUNCTION public.dre_linha_da_transacao(p_transacaoid bigint)
RETURNS TABLE (
  papel          text,
  documento_tipo text,
  documento_id   bigint,
  linha_id       integer,
  codigo         text,
  nome           text,
  natureza_dre   text,
  valor          numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH template_ativo AS (
    SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1
  ),
  tx AS (
    SELECT * FROM public.transacao WHERE id = p_transacaoid
  ),
  -- Documentos que esta transacao LIQUIDA. Pagamento multiplo cobre varios (o
  -- rateio diz quais); pagamento comum cobre um; avulso nao cobre nenhum.
  --
  -- `evento_financeiro_id IS NULL` e o que separa liquidar de materializar.
  -- Uma despesa da OS — servico terceirizado, comissao — vira transacao com
  -- `ordemservicoid` preenchido, mas ela nao paga a OS: ela E aquela despesa, e
  -- aponta para o evento que virou. Sem este filtro, abrir os R$ 200 de um
  -- terceirizado mostraria tambem a receita inteira da OS, como se aquele
  -- pagamento a tivesse quitado. O papel dela e DIRETO, so.
  documentos AS (
    SELECT 'OS'::text AS tipo, t.ordemservicoid::bigint AS id
      FROM tx t WHERE t.ordemservicoid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT 'VENDA'::text, t.vendaid::bigint
      FROM tx t WHERE t.vendaid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT r.tipo_documento::text, r.documento_id::bigint
      FROM public.pagamento_multiplo_rateio r
     WHERE r.transacao_id = p_transacaoid
  ),
  eventos AS (
    SELECT 'DIRETO'::text AS papel, NULL::text AS doc_tipo, NULL::bigint AS doc_id,
           e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND ((e.source_type = 'TRANSACAO' AND e.source_id = p_transacaoid)
            OR e.transacaoid = p_transacaoid)
    UNION ALL
    SELECT 'DOCUMENTO'::text, d.tipo, d.id,
           e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM documentos d
      JOIN public.eventos_financeiros e
        -- OS tem DOIS vinculos possiveis. `ordemservicoid` e a coluna original,
        -- de quando o livro so servia a OS; `source_type`/`source_id` vieram na
        -- 20260802160000, que generalizou a tabela mas nao fez backfill das
        -- linhas antigas. No Demir isso e a maioria: 225 dos 377 eventos de OS
        -- tem `source_type` nulo. Casar so pelo par novo perderia todos eles —
        -- e a OS apareceria como se nao tivesse lancamento nenhum.
        -- Venda nasceu depois da generalizacao e nao tem esse legado.
        ON (d.tipo = 'OS'    AND (e.ordemservicoid = d.id
                                  OR (e.source_type = 'ORDEM_SERVICO' AND e.source_id = d.id)))
        OR (d.tipo = 'VENDA' AND e.source_type = 'VENDA' AND e.source_id = d.id)
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       -- Ja contado como DIRETO: e a despesa que esta propria transacao pagou.
       AND e.transacaoid IS DISTINCT FROM p_transacaoid
  ),
  resolvidos AS (
    SELECT ev.papel, ev.doc_tipo, ev.doc_id, ev.valor,
           coalesce(
             ev.dre_linha_id,
             (SELECT mp.linha_id
                FROM public.dre_mapeamento mp, template_ativo t
               WHERE mp.template_id = t.id
                 AND mp.ativo
                 AND mp.origem_tipo = 'EVENTO_ORIGEM'
                 AND mp.origem_valor = ev.origem || ':' || ev.natureza
                 AND (mp.vigencia_inicio IS NULL OR ev.competencia_em >= mp.vigencia_inicio)
                 AND (mp.vigencia_fim IS NULL OR ev.competencia_em <= mp.vigencia_fim)
               LIMIT 1)
           ) AS linha_id
      FROM eventos ev
  )
  SELECT r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre,
         round(sum(r.valor), 2) AS valor
    FROM resolvidos r
    JOIN public.dre_linha dl ON dl.id = r.linha_id
   GROUP BY r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre
   ORDER BY r.doc_id NULLS FIRST, dl.codigo;
$function$;

DO $t$
DECLARE
  r        record;
  v_id     bigint;
  v_n      int;
  v_docs   int;
  v_papel  text;
  v_falhas int := 0;
BEGIN

  /* ========================================= 1. avulsa: papel DIRETO, 1 linha */

  SELECT e.source_id INTO v_id
    FROM public.eventos_financeiros e
   WHERE e.source_type = 'TRANSACAO'
     AND e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.dre_linha_id IS NOT NULL
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    SELECT count(*), max(papel) INTO v_n, v_papel
      FROM public.dre_linha_da_transacao(v_id);

    IF v_n < 1 OR v_papel <> 'DIRETO' THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 1: transacao avulsa #% devolveu % linha(s), papel %', v_id, v_n, v_papel;
    ELSE
      FOR r IN SELECT * FROM public.dre_linha_da_transacao(v_id) LOOP
        RAISE NOTICE 'OK 1: avulsa #% -> % linha % (%) R$ %', v_id, r.papel, r.codigo, r.nome, r.valor;
      END LOOP;
    END IF;
  ELSE
    RAISE NOTICE 'PULADO 1: nenhuma transacao avulsa com linha gravada neste banco';
  END IF;

  /* ========================= 2. pagamento multiplo: papel DOCUMENTO, N docs */

  SELECT t.id INTO v_id
    FROM public.transacao t
   WHERE t.pagamento_multiplo_id IS NOT NULL
     AND t.is_deleted = false
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    SELECT count(*), count(DISTINCT documento_id) INTO v_n, v_docs
      FROM public.dre_linha_da_transacao(v_id);

    IF v_n < 1 THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 2: pagamento multiplo #% nao resolveu linha nenhuma', v_id;
    ELSIF EXISTS (SELECT 1 FROM public.dre_linha_da_transacao(v_id) WHERE papel <> 'DOCUMENTO') THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 2: pagamento multiplo #% trouxe linha com papel DIRETO', v_id;
    ELSE
      RAISE NOTICE 'OK 2: pagamento multiplo #% -> % documento(s), % linha(s):', v_id, v_docs, v_n;
      FOR r IN SELECT * FROM public.dre_linha_da_transacao(v_id) LOOP
        RAISE NOTICE '        % #% -> % % R$ %', r.documento_tipo, r.documento_id, r.codigo, r.nome, r.valor;
      END LOOP;
    END IF;
  ELSE
    RAISE NOTICE 'PULADO 2: nenhum pagamento multiplo neste banco';
  END IF;

  /* ============================ 3. pagamento de UMA OS: papel DOCUMENTO, 1 doc */

  SELECT t.id INTO v_id
    FROM public.transacao t
   WHERE t.ordemservicoid IS NOT NULL
     AND t.is_deleted = false
     AND EXISTS (SELECT 1 FROM public.eventos_financeiros e
                  WHERE e.source_type = 'ORDEM_SERVICO'
                    AND e.source_id = t.ordemservicoid
                    AND e.status IN ('ATIVO', 'CONVERTIDO'))
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    SELECT count(*), count(DISTINCT documento_id) INTO v_n, v_docs
      FROM public.dre_linha_da_transacao(v_id);

    IF v_n < 1 OR v_docs <> 1 THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 3: pagamento de OS #% devolveu % linha(s) em % documento(s)', v_id, v_n, v_docs;
    ELSE
      RAISE NOTICE 'OK 3: pagamento de OS #% -> % linha(s) de 1 documento:', v_id, v_n;
      FOR r IN SELECT * FROM public.dre_linha_da_transacao(v_id) LOOP
        RAISE NOTICE '        % #% -> % % (%) R$ %',
          r.documento_tipo, r.documento_id, r.codigo, r.nome, r.natureza_dre, r.valor;
      END LOOP;
    END IF;
  ELSE
    RAISE NOTICE 'PULADO 3: nenhum pagamento de OS com evento neste banco';
  END IF;

  /* ================= 4. nenhum evento e nenhum documento: sem badge */

  SELECT t.id INTO v_id
    FROM public.transacao t
   WHERE t.is_deleted = false
     AND t.ordemservicoid IS NULL
     AND t.vendaid IS NULL
     AND t.pagamento_multiplo_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros e
        WHERE e.status IN ('ATIVO', 'CONVERTIDO')
          AND ((e.source_type = 'TRANSACAO' AND e.source_id = t.id) OR e.transacaoid = t.id)
     )
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.dre_linha_da_transacao(v_id);
    IF v_n <> 0 THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 4: transacao #% sem evento e sem documento devolveu % linha(s)', v_id, v_n;
    ELSE
      RAISE NOTICE 'OK 4: transacao #% fora da DRE -> 0 linhas (sem badge)', v_id;
    END IF;
  ELSE
    RAISE NOTICE 'PULADO 4: nao ha transacao fora da DRE neste banco';
  END IF;

  /* ============ 5. despesa da OS que virou transacao e DIRETO, nunca DOCUMENTO

     Servico terceirizado e comissao viram transacao com `ordemservicoid`
     preenchido, mas nao liquidam a OS — elas SAO aquela despesa. Se a funcao as
     tratasse como liquidacao, abrir os R$ 200 de um terceirizado mostraria a
     receita inteira da OS junto, como se ele a tivesse quitado. */

  v_n := 0;
  FOR r IN
    SELECT t.id
      FROM public.transacao t
     WHERE t.is_deleted = false
       AND t.evento_financeiro_id IS NOT NULL
       AND (t.ordemservicoid IS NOT NULL OR t.vendaid IS NOT NULL)
     LIMIT 20
  LOOP
    v_n := v_n + 1;
    IF EXISTS (SELECT 1 FROM public.dre_linha_da_transacao(r.id) WHERE papel <> 'DIRETO') THEN
      v_falhas := v_falhas + 1;
      RAISE NOTICE 'FALHA 5: transacao #% materializa um evento mas trouxe linha do documento', r.id;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE 'PULADO 5: nenhuma despesa de documento virou transacao neste banco';
  ELSE
    RAISE NOTICE 'OK 5: % despesa(s) de documento -> so DIRETO, sem a receita da OS junto', v_n;
  END IF;

  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% falha(s) — ver NOTICEs acima', v_falhas;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Resultado: todas as verificacoes passaram.';
END;
$t$;

ROLLBACK;
