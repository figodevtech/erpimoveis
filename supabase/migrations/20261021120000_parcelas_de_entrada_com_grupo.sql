BEGIN;

-- Parcelas de nota de compra nascem com grupo, qualquer que seja o caminho.
--
-- O CASO
-- No Demir, a NF 22555 (uso e consumo #92) foi lançada em 3x no cadastro da
-- entrada. A aba Parcelas mostrou as três, mas com o aviso de "anterior ao
-- registro de grupos" e sem o botão de reparcelar. O usuário excluiu as três e
-- lançou de novo pela tela de financeiro da entrada, que cria o grupo.
--
-- POR QUE AINDA ACONTECIA
-- 20260903260000 corrigiu `POST /api/entradas/[id]/financeiro` e fez o backfill,
-- mas o financeiro também nasce junto com a entrada, dentro dos motores:
-- `registrar_entrada_confirmada`, `registrar_entrada_comercial_apropriada`,
-- `registrar_entrada_usoconsumo`, `registrar_entrada_fiscal_mista`,
-- `registrar_entrada_fiscal_personalizada` e `registrar_entrada_fiscal_hibrida`.
-- Nenhum deles cria `transacao_parcelamento`. O caminho com ajuste de valores
-- também não: chama `registrar_financeiro_entrada` com `p_criar_grupo => false`.
-- Entre o backfill e 20/10/2026 entraram 63 parcelas sem grupo só no Demir.
--
-- A CORREÇÃO
-- Um gatilho em `transacao`, e não seis motores reescritos: o grupo é
-- consequência de "várias parcelas da mesma entrada no mesmo registro", e é isso
-- que ele confere. Caminho novo de entrada fica coberto sem lembrar disto.
--
-- Irmãs são as linhas da mesma entrada, gravadas na mesma transação de banco
-- (mesmo `created_at`, que é o `now()` dela) e com a mesma descrição a menos do
-- índice da parcela. Quem já chega com `parcelamento_id` não é tocado.

-- ---------------------------------------------------------------------------
-- 1) O gatilho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_transacao_agrupar_parcelas_de_entrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- "Compra NF 1 - Parcela 2/3" e "Compra NF 1 - Parcela 3/3" viram a mesma
  -- chave; "Compra NF 1 - Parcela 1/2" não, porque o total de parcelas difere.
  v_chave text := regexp_replace(NEW.descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1');
  v_grupo bigint;
BEGIN
  -- Uma irmã que já tem grupo empresta o dela.
  SELECT t.parcelamento_id INTO v_grupo
    FROM public.transacao t
   WHERE t.created_at = NEW.created_at
     AND t.entrada_id IS NOT DISTINCT FROM NEW.entrada_id
     AND t.usoconsumo_entrada_id IS NOT DISTINCT FROM NEW.usoconsumo_entrada_id
     AND t.parcelamento_id IS NOT NULL
     AND t.is_deleted = false
     AND t.estorno_transacao_id IS NULL
     AND regexp_replace(t.descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1') = v_chave
   ORDER BY t.id
   LIMIT 1;

  IF v_grupo IS NULL THEN
    -- A primeira parcela entra sozinha. O grupo nasce na segunda, que leva a
    -- primeira junto.
    PERFORM 1
      FROM public.transacao t
     WHERE t.created_at = NEW.created_at
       AND t.entrada_id IS NOT DISTINCT FROM NEW.entrada_id
       AND t.usoconsumo_entrada_id IS NOT DISTINCT FROM NEW.usoconsumo_entrada_id
       AND t.parcelamento_id IS NULL
       AND t.is_deleted = false
       AND t.estorno_transacao_id IS NULL
       AND regexp_replace(t.descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1') = v_chave;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- A descrição do grupo é a BASE, sem o sufixo: é dela que o reparcelamento
    -- monta a renumeração.
    INSERT INTO public.transacao_parcelamento (descricao, created_at)
    VALUES (regexp_replace(NEW.descricao, ' - Parcela [0-9]+/[0-9]+$', ''), NEW.created_at)
    RETURNING id INTO v_grupo;

    UPDATE public.transacao t
       SET parcelamento_id = v_grupo
     WHERE t.created_at = NEW.created_at
       AND t.entrada_id IS NOT DISTINCT FROM NEW.entrada_id
       AND t.usoconsumo_entrada_id IS NOT DISTINCT FROM NEW.usoconsumo_entrada_id
       AND t.parcelamento_id IS NULL
       AND t.is_deleted = false
       AND t.estorno_transacao_id IS NULL
       AND regexp_replace(t.descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1') = v_chave;
  END IF;

  NEW.parcelamento_id := v_grupo;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_transacao_agrupar_parcelas_de_entrada() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tg_transacao_agrupar_parcelas_de_entrada() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tg_transacao_agrupar_parcelas_de_entrada() IS
  'Dá grupo (transacao_parcelamento) às parcelas que os motores de entrada gravam junto com a nota. Ver 20261021120000.';

-- Os mesmos vínculos que o backfill de 20260903260000 deixou de fora: neles o
-- botão apareceria para depois o reparcelamento recusar.
DROP TRIGGER IF EXISTS transacao_agrupar_parcelas_de_entrada_trg ON public.transacao;
CREATE TRIGGER transacao_agrupar_parcelas_de_entrada_trg
  BEFORE INSERT ON public.transacao
  FOR EACH ROW
  WHEN (
    NEW.parcelamento_id IS NULL
    AND (NEW.entrada_id IS NOT NULL OR NEW.usoconsumo_entrada_id IS NOT NULL)
    AND NEW.descricao ~ ' - Parcela [0-9]+/[0-9]+$'
    AND NEW.estorno_transacao_id IS NULL
    AND NEW.ordemservicoid IS NULL
    AND NEW.vendaid IS NULL
    AND NEW.pagamento_multiplo_id IS NULL
    AND NEW.evento_financeiro_id IS NULL
    AND NEW.adiantamento_id IS NULL
    AND NEW.transferencia_id IS NULL
    AND coalesce(NEW.eh_adiantamento, false) = false
  )
  EXECUTE FUNCTION public.tg_transacao_agrupar_parcelas_de_entrada();

-- ---------------------------------------------------------------------------
-- 2) Grupo para as parcelas de entrada gravadas desde o último backfill
-- ---------------------------------------------------------------------------
--
-- Mesmo critério de 20260903260000 (vínculo com a entrada, não horário), com
-- duas travas a mais: estorno de cancelamento fica fora — "Estorno: ... -
-- Parcela 1/3" também casa o sufixo —, e o total de parcelas entra na chave.

DO $$
DECLARE
  v_grupo record;
  v_id bigint;
BEGIN
  FOR v_grupo IN
    SELECT
      regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '') AS base,
      min(created_at) AS nasceu_em,
      array_agg(id) AS ids
    FROM public.transacao
    WHERE is_deleted = false
      AND parcelamento_id IS NULL
      AND descricao ~ ' - Parcela [0-9]+/[0-9]+$'
      AND (entrada_id IS NOT NULL OR usoconsumo_entrada_id IS NOT NULL)
      AND estorno_transacao_id IS NULL
      AND ordemservicoid IS NULL
      AND vendaid IS NULL
      AND pagamento_multiplo_id IS NULL
      AND evento_financeiro_id IS NULL
      AND adiantamento_id IS NULL
      AND transferencia_id IS NULL
      AND coalesce(eh_adiantamento, false) = false
    GROUP BY entrada_id, usoconsumo_entrada_id,
             regexp_replace(descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1'),
             regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '')
    HAVING count(*) > 1
  LOOP
    INSERT INTO public.transacao_parcelamento (descricao, created_at)
    VALUES (v_grupo.base, v_grupo.nasceu_em)
    RETURNING id INTO v_id;

    UPDATE public.transacao
       SET parcelamento_id = v_id
     WHERE id = ANY(v_grupo.ids);
  END LOOP;
END $$;

COMMIT;
