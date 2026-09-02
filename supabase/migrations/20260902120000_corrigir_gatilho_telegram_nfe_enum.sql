-- Corrige o gatilho de aviso fiscal que derrubava toda gravacao de NF-e em
-- producao.
--
-- Sintoma: "Gerar rascunho" na OS respondia
--   Erro ao criar rascunho de NF-e avulsa:
--   invalid input value for enum enum_status_nfe: ""
-- e o mesmo valia para autorizar, cancelar ou qualquer escrita que mexesse em
-- nfe.status. So em producao.
--
-- Causa: em 20260901200000_telegram_notificacoes_fiscais.sql a funcao
-- fn_notificar_telegram_nfe compara o status assim:
--
--   CASE upper(btrim(coalesce(NEW.status, '')))
--
-- nfe.status e do tipo enum_status_nfe, entao os dois ramos do coalesce precisam
-- ter o mesmo tipo e o literal '' e convertido para enum_status_nfe. String
-- vazia nao e um rotulo valido do enum, e a conversao acontece no planejamento
-- da expressao -- ou seja, estoura mesmo quando NEW.status esta preenchido, que
-- e sempre. O coalesce nunca chega a proteger nada: status e NOT NULL.
--
-- Por que so em producao: a linha logo acima sai da funcao quando o ambiente da
-- nota nao e PRODUCAO, e a expressao quebrada fica para tras. Em homologacao a
-- gravacao passa; nas empresas com empresa.ambiente = 'PRODUCAO' nenhuma NF-e
-- podia ser gravada desde que aquela migration rodou.
--
-- A correcao e comparar como texto. A mesma leitura vale para o ambiente logo
-- acima: 'PRODUCAO' por acaso e um rotulo valido de enum_ambiente_nfe, entao
-- aquela linha funcionava, mas depende de sorte do mesmo jeito e tambem passa a
-- comparar por texto.
--
-- fn_notificar_telegram_nfse tem a mesma escrita e NAO estourava, porque
-- nfse.status e character varying. Vai junto com o ::text para o dia em que
-- alguem transformar aquela coluna em enum -- mantendo a chave de deduplicacao
-- por referencia, introduzida em 20260901230000_nfse_tentativas_reenvio.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_nfe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;
  -- Homologacao e teste: nota de teste nao vira aviso. Rascunho antigo sem
  -- ambiente gravado conta como producao para nao engolir aviso legitimo.
  IF coalesce(NEW.ambiente::text, 'PRODUCAO') <> 'PRODUCAO' THEN
    RETURN NEW;
  END IF;

  v_evento := CASE upper(btrim(coalesce(NEW.status::text, '')))
    WHEN 'AUTORIZADA' THEN 'NFE_AUTORIZADA'
    WHEN 'REJEITADA' THEN 'NFE_REJEITADA'
    WHEN 'DENEGADA' THEN 'NFE_DENEGADA'
    WHEN 'CANCELADA' THEN 'NFE_CANCELADA'
    WHEN 'RESULTADO_INCERTO' THEN 'NFE_RESULTADO_INCERTO'
    ELSE NULL
  END;

  IF v_evento IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_enfileirar_notificacao_fiscal(
    'NFE', NEW.id::bigint, v_evento, 'NFE:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_nfse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Denegacao de NFS-e volta com o motivo no mesmo lugar da rejeicao e exige a
  -- mesma correcao: um evento so.
  v_evento := CASE upper(btrim(coalesce(NEW.status::text, '')))
    WHEN 'AUTORIZADA' THEN 'NFSE_AUTORIZADA'
    WHEN 'REJEITADA' THEN 'NFSE_REJEITADA'
    WHEN 'DENEGADA' THEN 'NFSE_REJEITADA'
    WHEN 'CANCELADA' THEN 'NFSE_CANCELADA'
    ELSE NULL
  END;

  IF v_evento IS NULL THEN
    RETURN NEW;
  END IF;

  -- Uma mensagem por tentativa, nao por nota: o reenvio acontece na propria
  -- linha rejeitada, e a referencia e o que distingue um envio do outro.
  PERFORM public.fn_enfileirar_notificacao_fiscal(
    'NFSE',
    NEW.id::bigint,
    v_evento,
    'NFSE:' || NEW.id::text || ':' || coalesce(NEW.referencia::text, '')
  );
  RETURN NEW;
END;
$$;

COMMIT;
