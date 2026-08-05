-- Corrige "column reference \"serie\" is ambiguous" (42702) em nfe_alocar_numero.
--
-- A funcao declara RETURNS TABLE (numero, serie, ...), entao `numero` e `serie`
-- sao variaveis PL/pgSQL em escopo. Na subquery que escolhe o menor numero
-- liberado, as colunas homonimas de nfe_numero_liberado apareciam sem
-- qualificacao, e o Postgres nao tinha como decidir entre coluna e variavel.
-- Como esse DELETE roda em toda alocacao, qualquer transmissao de NF-e falhava.
--
-- Unica mudanca: as referencias da subquery passam a ser qualificadas pelo
-- alias da tabela. O comportamento pretendido e o mesmo.
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

  -- O lock na config acima serializa as alocações concorrentes.
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
