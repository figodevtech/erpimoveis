-- Categoria de sistema para antecipacao.
--
-- Venda e ordem de servico ja tem a sua (ver 20260718172000). Sem uma para a
-- antecipacao, o lancamento nascia em "NAO RELACIONADO" e se perdia no meio dos
-- avulsos — justamente o lancamento que concentra o dinheiro de varios titulos.
--
-- `codigo_sistema` e o que marca a linha como do proprio ERP: a tela usa esse
-- codigo para encontra-la, e ele impede que renomear a categoria quebre a busca.
-- O indice unico parcial em codigo_sistema garante que exista uma so.
--
-- Idempotente e conservadora, como a migracao das outras duas: se ja houver uma
-- categoria chamada ANTECIPACAO criada a mao, ela e adotada em vez de duplicada.
BEGIN;

DO $$
DECLARE
  v_id integer;
BEGIN
  SELECT id INTO v_id
    FROM public.categoriatransacao
   WHERE codigo_sistema = 'ADIANTAMENTO'
   ORDER BY id
   LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.categoriatransacao
     WHERE upper(btrim(nome)) IN ('ANTECIPACAO', 'ANTECIPAÇÃO', 'ADIANTAMENTO')
     ORDER BY id
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.categoriatransacao
      (nome, descricao, icone, ativo, codigo_sistema, createdat, updatedat)
    VALUES
      ('ANTECIPAÇÃO',
       'Categoria de sistema para lançamentos de antecipação de títulos.',
       'banknote', true, 'ADIANTAMENTO', now(), now());
  ELSE
    UPDATE public.categoriatransacao
       SET codigo_sistema = 'ADIANTAMENTO',
           ativo = true,
           updatedat = now()
     WHERE id = v_id;
  END IF;
END;
$$;

-- Antecipacoes ja registradas antes desta categoria existir passam a apontar
-- para ela. O gatilho sincronizar_categoria_transacao acerta o texto sozinho.
UPDATE public.transacao
   SET categoria_id = (
         SELECT id FROM public.categoriatransacao WHERE codigo_sistema = 'ADIANTAMENTO'
       )
 WHERE eh_adiantamento = true
   AND categoria_id IS DISTINCT FROM (
         SELECT id FROM public.categoriatransacao WHERE codigo_sistema = 'ADIANTAMENTO'
       );

COMMIT;
