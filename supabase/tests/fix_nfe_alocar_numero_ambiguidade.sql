-- Teste da migration 20260805150000_fix_nfe_alocar_numero_ambiguidade.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/fix_nfe_alocar_numero_ambiguidade.sql demir
--
-- Tudo dentro de uma transação que termina em ROLLBACK: a função é substituída,
-- números são alocados, e no fim nada é persistido — nem a função, nem o
-- consumo de numeração.
--
-- Verifica:
--   1. a função atual realmente falha com 42702 (reproduz o bug relatado);
--   2. depois do fix, a alocação reaproveita o menor número liberado da série;
--   3. esgotada a fila, avança ultimo_numero;
--   4. números de outra série não são consumidos por engano.
BEGIN;

DO $$
DECLARE
  v_config_id bigint;
  v_erro text;
BEGIN
  SELECT id INTO v_config_id FROM public.nfe_config ORDER BY id LIMIT 1;
  IF v_config_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma nfe_config neste banco: teste não se aplica.';
  END IF;

  BEGIN
    PERFORM * FROM public.nfe_alocar_numero(v_config_id);
    RAISE EXCEPTION 'A função NÃO falhou — o bug já não existe neste banco?';
  EXCEPTION
    WHEN sqlstate '42702' THEN
      RAISE NOTICE 'Bug reproduzido: 42702 (referência ambígua), como no erro de produção.';
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
      RAISE EXCEPTION 'Esperava 42702 e veio outro erro: % (%)', v_erro, SQLSTATE;
  END;
END $$;

-- ==========================================================================
-- Corpo da migration (cópia fiel de 20260805150000).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.nfe_alocar_numero(p_config_id bigint)
RETURNS TABLE (
  numero integer,
  serie integer,
  empresaid bigint,
  modelo public.enum_modelo_nfe,
  ambiente public.enum_ambiente_nfe
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_config public.nfe_config%ROWTYPE;
  v_reaproveitado integer;
BEGIN
  SELECT *
    INTO v_config
    FROM public.nfe_config
   WHERE id = p_config_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de NF-e % não encontrada.', p_config_id;
  END IF;

  DELETE FROM public.nfe_numero_liberado l
   WHERE l.id = (
     SELECT candidato.id
       FROM public.nfe_numero_liberado candidato
      WHERE candidato.config_id = p_config_id
        AND candidato.serie = v_config.serie
      ORDER BY candidato.numero
      LIMIT 1
   )
  RETURNING l.numero INTO v_reaproveitado;

  IF v_reaproveitado IS NOT NULL THEN
    numero := v_reaproveitado;
    serie := v_config.serie;
    empresaid := v_config.empresaid;
    modelo := v_config.modelo;
    ambiente := v_config.ambiente;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.nfe_config
     SET ultimo_numero = COALESCE(ultimo_numero, 0) + 1,
         updatedat = now()
   WHERE id = p_config_id
   RETURNING ultimo_numero, nfe_config.serie, nfe_config.empresaid, nfe_config.modelo, nfe_config.ambiente
    INTO numero, serie, empresaid, modelo, ambiente;

  RETURN NEXT;
END;
$$;

-- ==========================================================================
-- Verificações.
-- ==========================================================================
DO $$
DECLARE
  v_config public.nfe_config%ROWTYPE;
  v_serie_outra integer;
  v_resultado record;
  v_ultimo_antes integer;
  v_sobrou integer;
BEGIN
  SELECT * INTO v_config FROM public.nfe_config ORDER BY id LIMIT 1;
  v_serie_outra := v_config.serie + 77;

  -- Fila controlada: limpa o que houver desta config e planta números conhecidos.
  DELETE FROM public.nfe_numero_liberado WHERE config_id = v_config.id;
  INSERT INTO public.nfe_numero_liberado (config_id, serie, numero, motivo)
  VALUES (v_config.id, v_config.serie, 900002, 'TESTE'),
         (v_config.id, v_config.serie, 900001, 'TESTE'),
         (v_config.id, v_serie_outra,  900000, 'TESTE_OUTRA_SERIE');

  -- 1) reaproveita o MENOR da série da config.
  SELECT * INTO v_resultado FROM public.nfe_alocar_numero(v_config.id);
  IF v_resultado.numero <> 900001 OR v_resultado.serie <> v_config.serie THEN
    RAISE EXCEPTION 'Esperava numero 900001 na serie %, veio % na serie %',
      v_config.serie, v_resultado.numero, v_resultado.serie;
  END IF;
  IF v_resultado.empresaid <> v_config.empresaid THEN
    RAISE EXCEPTION 'empresaid divergente: % vs %', v_resultado.empresaid, v_config.empresaid;
  END IF;
  RAISE NOTICE 'OK 1: reaproveitou o menor liberado (900001).';

  -- 2) o seguinte da fila.
  SELECT * INTO v_resultado FROM public.nfe_alocar_numero(v_config.id);
  IF v_resultado.numero <> 900002 THEN
    RAISE EXCEPTION 'Esperava 900002, veio %', v_resultado.numero;
  END IF;
  RAISE NOTICE 'OK 2: consumiu o proximo da fila (900002).';

  -- 3) fila da série esgotada: avança ultimo_numero.
  SELECT ultimo_numero INTO v_ultimo_antes FROM public.nfe_config WHERE id = v_config.id;
  SELECT * INTO v_resultado FROM public.nfe_alocar_numero(v_config.id);
  IF v_resultado.numero <> v_ultimo_antes + 1 THEN
    RAISE EXCEPTION 'Esperava ultimo_numero+1 (%), veio %', v_ultimo_antes + 1, v_resultado.numero;
  END IF;
  RAISE NOTICE 'OK 3: avancou ultimo_numero (% -> %).', v_ultimo_antes, v_resultado.numero;

  -- 4) o número da outra série continua intacto na fila.
  SELECT count(*) INTO v_sobrou
    FROM public.nfe_numero_liberado
   WHERE config_id = v_config.id AND serie = v_serie_outra AND numero = 900000;
  IF v_sobrou <> 1 THEN
    RAISE EXCEPTION 'O numero da outra serie foi consumido indevidamente';
  END IF;
  RAISE NOTICE 'OK 4: numero de outra serie preservado.';
END $$;

-- Nada acima é persistido.
ROLLBACK;
