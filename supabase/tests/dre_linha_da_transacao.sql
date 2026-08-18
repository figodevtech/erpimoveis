-- Testa dre_linha_da_transacao contra dados reais, sem gravar nada.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/dre_linha_da_transacao.sql demir
--
-- A funcao ainda nao existe no banco quando este arquivo roda pela primeira
-- vez, entao ele a cria dentro da propria transacao de teste — o CREATE OR
-- REPLACE e igual ao da migration, e o ROLLBACK no fim desfaz tudo.

BEGIN;

CREATE OR REPLACE FUNCTION public.dre_linha_da_transacao(p_transacaoid bigint)
RETURNS TABLE (linha_id integer, codigo text, nome text, valor numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH template_ativo AS (
    SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1
  ),
  eventos AS (
    SELECT e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND (
             (e.source_type = 'TRANSACAO' AND e.source_id = p_transacaoid)
          OR e.transacaoid = p_transacaoid
       )
  ),
  resolvidos AS (
    SELECT ev.valor,
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
  SELECT dl.id AS linha_id, dl.codigo, dl.nome, round(sum(r.valor), 2) AS valor
    FROM resolvidos r
    JOIN public.dre_linha dl ON dl.id = r.linha_id
   WHERE r.linha_id IS NOT NULL
   GROUP BY dl.id, dl.codigo, dl.nome
   ORDER BY dl.codigo;
$function$;

DO $t$
DECLARE
  r record;
  v_falhas int := 0;
BEGIN

  /* ================================================== 1. transacao avulsa,
     origem TRANSACAO, com dre_linha_id ja gravado */
  SELECT e.source_id AS transacaoid, e.dre_linha_id, dl.codigo, dl.nome, e.valor
    INTO r
    FROM public.eventos_financeiros e
    JOIN public.dre_linha dl ON dl.id = e.dre_linha_id
   WHERE e.source_type = 'TRANSACAO'
     AND e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.dre_linha_id IS NOT NULL
   LIMIT 1;

  IF r.transacaoid IS NOT NULL THEN
    DECLARE
      v_codigo text;
      v_valor  numeric;
      v_n      int;
    BEGIN
      SELECT count(*), max(codigo), max(valor)
        INTO v_n, v_codigo, v_valor
        FROM public.dre_linha_da_transacao(r.transacaoid);

      IF v_n <> 1 OR v_codigo IS DISTINCT FROM r.codigo THEN
        v_falhas := v_falhas + 1;
        RAISE NOTICE 'FALHA 1: transacao # (avulsa) esperava linha %, veio % linha(s), codigo %',
          r.codigo, v_n, v_codigo;
      ELSE
        RAISE NOTICE 'OK 1: transacao avulsa -> linha % (%) R$ %', v_codigo, r.nome, v_valor;
      END IF;
    END;
  ELSE
    RAISE NOTICE 'PULADO 1: nenhuma transacao avulsa com dre_linha_id gravado neste banco';
  END IF;

  /* ================================================== 2. transacao que
     baixou evento de OS/venda (EVENTO_ORIGEM, resolvido em consulta) */
  SELECT e.transacaoid, e.origem, e.natureza, e.valor
    INTO r
    FROM public.eventos_financeiros e
   WHERE e.transacaoid IS NOT NULL
     AND e.source_type IN ('ORDEM_SERVICO', 'VENDA')
     AND e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.dre_linha_id IS NULL
   LIMIT 1;

  IF r.transacaoid IS NOT NULL THEN
    DECLARE
      v_n int;
    BEGIN
      SELECT count(*) INTO v_n FROM public.dre_linha_da_transacao(r.transacaoid);
      IF v_n < 1 THEN
        v_falhas := v_falhas + 1;
        RAISE NOTICE 'FALHA 2: transacao # (baixa de %:%) nao resolveu linha nenhuma',
          r.origem, r.natureza;
      ELSE
        RAISE NOTICE 'OK 2: transacao (baixa de %:%) resolveu % linha(s)', r.origem, r.natureza, v_n;
      END IF;
    END;
  ELSE
    RAISE NOTICE 'PULADO 2: nenhuma baixa de evento OS/venda com dre_linha_id nulo neste banco';
  END IF;

  /* ================================================== 3. transacao fora da
     DRE (grupo excluido, sem plano de conta, ou cancelada) nao deve aparecer */
  SELECT t.id
    INTO r
    FROM public.transacao t
   WHERE t.is_deleted = false
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros e
        WHERE e.status IN ('ATIVO', 'CONVERTIDO')
          AND ((e.source_type = 'TRANSACAO' AND e.source_id = t.id) OR e.transacaoid = t.id)
     )
   LIMIT 1;

  IF r.id IS NOT NULL THEN
    DECLARE v_n int;
    BEGIN
      SELECT count(*) INTO v_n FROM public.dre_linha_da_transacao(r.id);
      IF v_n <> 0 THEN
        v_falhas := v_falhas + 1;
        RAISE NOTICE 'FALHA 3: transacao # sem evento algum devolveu % linha(s)', v_n;
      ELSE
        RAISE NOTICE 'OK 3: transacao sem evento -> 0 linhas (sem badge)';
      END IF;
    END;
  ELSE
    RAISE NOTICE 'PULADO 3: toda transacao ativa deste banco tem evento — nada para testar aqui';
  END IF;

  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% falha(s) — ver NOTICEs acima', v_falhas;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'Resultado: todas as verificacoes passaram.';
END;
$t$;

ROLLBACK;
