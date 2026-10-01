-- A comissão ajustada no evento financeiro vale também no vínculo.
--
-- Como rodar (banco com a migration 20261001130000 aplicada):
--   npm run db:test:sql -- supabase/tests/comissao_ajustada_espelha_no_vinculo.sql demir
-- Antes do deploy, `npm run db:test:comissao-ajustada -- <banco>` aplica as
-- migrations pendentes e roda este mesmo arquivo, tudo revertido.
--
-- Prova:
--   1. nenhum evento COMISSAO ativo diverge do vínculo de origem (realização e
--      criação) — o backfill fechou o que havia;
--   2. ajustar o evento (o que `editarEventoDaOs` faz) espelha no vínculo;
--   3. recalcular depois mantém o ajuste, e base/percentual seguem o cálculo;
--   4. cancelar o evento devolve o vínculo ao valor calculado;
--   5. o mesmo para a comissão de criação, quando o banco tem uma.
--
-- Tudo dentro de uma transação que termina em ROLLBACK. Nada é escrito.

BEGIN;

DO $$
DECLARE
  v_divergentes integer;
  v_evento record;
  v_valor numeric;
  v_manual numeric;
  v_calculado numeric;
  v_ajuste numeric;
BEGIN
  IF to_regprocedure('public.tg_espelhar_comissao_ajustada()') IS NULL THEN
    RAISE EXCEPTION 'tg_espelhar_comissao_ajustada não existe. Aplique a migration 20261001130000.';
  END IF;

  /* ---------------- 1. nada diverge ---------------- */

  SELECT count(*) INTO v_divergentes
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o ON o.id = e.ordemservicoid
    JOIN public.osservico_realizador r
      ON r.ordemservicoid = e.ordemservicoid
     AND e.chave_origem = r.servicoid || ':' || r.usuarioid
   WHERE e.origem = 'COMISSAO' AND e.natureza = 'DESPESA'
     AND e.status <> 'CANCELADO'
     AND o.execucao_fim_em IS NOT NULL
     AND coalesce(o.is_deleted, false) = false
     AND e.valor <> coalesce(r.valor_comissao, 0);
  IF v_divergentes <> 0 THEN
    RAISE EXCEPTION 'Há % comissão(ões) de realização com evento diferente do vínculo.', v_divergentes;
  END IF;

  SELECT count(*) INTO v_divergentes
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o ON o.id = e.ordemservicoid
    JOIN public.os_comissao_criacao c
      ON c.ordemservicoid = e.ordemservicoid
     AND e.chave_origem = 'CRIACAO:' || c.usuarioid || ':'
         || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
         || c.item_id
   WHERE e.origem = 'COMISSAO' AND e.natureza = 'DESPESA'
     AND e.status <> 'CANCELADO'
     AND o.execucao_fim_em IS NOT NULL
     AND coalesce(o.is_deleted, false) = false
     AND e.valor <> coalesce(c.valor_comissao, 0);
  IF v_divergentes <> 0 THEN
    RAISE EXCEPTION 'Há % comissão(ões) de criação com evento diferente do vínculo.', v_divergentes;
  END IF;

  /* ---------------- 2-4. realização ---------------- */

  SELECT e.id, e.ordemservicoid, r.servicoid, r.usuarioid, r.valor_comissao, r.valor_base,
         r.comissao_percent_efetiva
    INTO v_evento
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o ON o.id = e.ordemservicoid
    JOIN public.osservico_realizador r
      ON r.ordemservicoid = e.ordemservicoid
     AND e.chave_origem = r.servicoid || ':' || r.usuarioid
   WHERE e.origem = 'COMISSAO' AND e.natureza = 'DESPESA'
     AND e.status = 'ATIVO' AND e.transacaoid IS NULL
     AND NOT coalesce(e.is_manual, false)
     AND o.execucao_fim_em IS NOT NULL
     AND coalesce(o.is_deleted, false) = false
   ORDER BY e.id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'Sem comissão de realização para servir de fixture; etapas 2-4 puladas.';
  ELSE
    v_calculado := v_evento.valor_comissao;
    v_ajuste := v_calculado + 123.45;

    -- O mesmo UPDATE que `editarEventoDaOs` faz no override de comissão.
    UPDATE public.eventos_financeiros
       SET valor = v_ajuste, is_manual = true, updated_at = now()
     WHERE id = v_evento.id;

    SELECT r.valor_comissao, r.valor_comissao_manual INTO v_valor, v_manual
      FROM public.osservico_realizador r
     WHERE r.ordemservicoid = v_evento.ordemservicoid
       AND r.servicoid = v_evento.servicoid AND r.usuarioid = v_evento.usuarioid;
    IF v_valor <> v_ajuste OR v_manual IS DISTINCT FROM v_ajuste THEN
      RAISE EXCEPTION 'Ajuste não espelhou: vínculo %, manual %, esperado %.', v_valor, v_manual, v_ajuste;
    END IF;

    -- Um segundo ajuste substitui o primeiro.
    v_ajuste := v_ajuste + 1;
    UPDATE public.eventos_financeiros SET valor = v_ajuste WHERE id = v_evento.id;

    PERFORM public.recalcular_comissao_osservico(v_evento.ordemservicoid, v_evento.servicoid);

    SELECT r.valor_comissao INTO v_valor
      FROM public.osservico_realizador r
     WHERE r.ordemservicoid = v_evento.ordemservicoid
       AND r.servicoid = v_evento.servicoid AND r.usuarioid = v_evento.usuarioid;
    IF v_valor <> v_ajuste THEN
      RAISE EXCEPTION 'O recálculo desfez o ajuste: vínculo %, esperado %.', v_valor, v_ajuste;
    END IF;

    UPDATE public.eventos_financeiros SET status = 'CANCELADO' WHERE id = v_evento.id;

    SELECT r.valor_comissao, r.valor_comissao_manual INTO v_valor, v_manual
      FROM public.osservico_realizador r
     WHERE r.ordemservicoid = v_evento.ordemservicoid
       AND r.servicoid = v_evento.servicoid AND r.usuarioid = v_evento.usuarioid;
    IF v_manual IS NOT NULL OR v_valor <> v_calculado THEN
      RAISE EXCEPTION 'Cancelar não devolveu o cálculo: vínculo %, manual %, esperado %.', v_valor, v_manual, v_calculado;
    END IF;

    RAISE NOTICE 'Realização: OS #% serviço % espelhou, resistiu ao recálculo e voltou ao cálculo.',
      v_evento.ordemservicoid, v_evento.servicoid;
  END IF;

  /* ---------------- 5. criação ---------------- */

  SELECT e.id, e.ordemservicoid, c.tipo, c.item_id, c.valor_comissao
    INTO v_evento
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o ON o.id = e.ordemservicoid
    JOIN public.os_comissao_criacao c
      ON c.ordemservicoid = e.ordemservicoid
     AND e.chave_origem = 'CRIACAO:' || c.usuarioid || ':'
         || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
         || c.item_id
   WHERE e.origem = 'COMISSAO' AND e.natureza = 'DESPESA'
     AND e.status = 'ATIVO' AND e.transacaoid IS NULL
     AND NOT coalesce(e.is_manual, false)
     AND coalesce(o.is_deleted, false) = false
   ORDER BY e.id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'Sem comissão de criação para servir de fixture; etapa 5 pulada.';
  ELSE
    v_calculado := v_evento.valor_comissao;
    v_ajuste := v_calculado + 50;

    UPDATE public.eventos_financeiros
       SET valor = v_ajuste, is_manual = true, updated_at = now()
     WHERE id = v_evento.id;

    PERFORM public.recalcular_comissao_criacao_os(v_evento.ordemservicoid);

    SELECT c.valor_comissao, c.valor_comissao_manual INTO v_valor, v_manual
      FROM public.os_comissao_criacao c
     WHERE c.ordemservicoid = v_evento.ordemservicoid
       AND c.tipo = v_evento.tipo AND c.item_id = v_evento.item_id;
    IF v_valor <> v_ajuste OR v_manual IS DISTINCT FROM v_ajuste THEN
      RAISE EXCEPTION 'Criação: ajuste não espelhou ou não resistiu ao recálculo: vínculo %, manual %, esperado %.',
        v_valor, v_manual, v_ajuste;
    END IF;

    UPDATE public.eventos_financeiros SET status = 'CANCELADO' WHERE id = v_evento.id;

    SELECT c.valor_comissao, c.valor_comissao_manual INTO v_valor, v_manual
      FROM public.os_comissao_criacao c
     WHERE c.ordemservicoid = v_evento.ordemservicoid
       AND c.tipo = v_evento.tipo AND c.item_id = v_evento.item_id;
    IF v_manual IS NOT NULL OR v_valor <> v_calculado THEN
      RAISE EXCEPTION 'Criação: cancelar não devolveu o cálculo: vínculo %, manual %, esperado %.', v_valor, v_manual, v_calculado;
    END IF;

    RAISE NOTICE 'Criação: OS #% item %/% espelhou, resistiu ao recálculo e voltou ao cálculo.',
      v_evento.ordemservicoid, v_evento.tipo, v_evento.item_id;
  END IF;

  RAISE NOTICE 'OK - comissão ajustada espelha no vínculo.';
END
$$;

ROLLBACK;
