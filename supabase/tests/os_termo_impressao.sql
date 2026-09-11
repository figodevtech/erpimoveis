BEGIN;
DO $test$
DECLARE
  v_total integer; v_titulo text; v_ordem integer; v_status text[]; v_alvos text[];
  v_erro boolean;
BEGIN
  -- A migration semeia os dizeres que já eram impressos. Num banco onde a
  -- oficina apagou tudo de propósito isso é estado legítimo, então aqui vira
  -- aviso e não falha.
  SELECT count(*) INTO v_total FROM public.os_termo_impressao;
  IF v_total = 0 THEN
    RAISE NOTICE 'Tabela sem dizeres: ou a migration não semeou, ou a oficina apagou os blocos.';
  END IF;

  DELETE FROM public.os_termo_impressao;

  PERFORM public.salvar_os_termos_impressao('[
    {"titulo":"Primeiro","intro":"Declaro:","itens":["a","b"],
     "status":["ORCAMENTO","EM_ANDAMENTO"],"alvos":["VEICULO"]},
    {"titulo":"Segundo","intro":"","itens":["c"],
     "status":["CONCLUIDO"],"alvos":["PECA","EQUIPAMENTO"]}
  ]'::jsonb);

  SELECT count(*) INTO v_total FROM public.os_termo_impressao;
  IF v_total <> 2 THEN RAISE EXCEPTION 'Esperava 2 blocos, achei %.', v_total; END IF;

  -- A ordem da lista recebida é a ordem impressa.
  SELECT titulo, ordem, status::text[], alvos INTO v_titulo, v_ordem, v_status, v_alvos
    FROM public.os_termo_impressao ORDER BY ordem LIMIT 1;
  IF v_titulo <> 'Primeiro' OR v_ordem <> 0
     OR v_status <> ARRAY['ORCAMENTO','EM_ANDAMENTO']::text[]
     OR v_alvos <> ARRAY['VEICULO']::text[] THEN
    RAISE EXCEPTION 'Primeiro bloco perdeu ordem, status ou alvos: % / % / % / %',
      v_titulo, v_ordem, v_status, v_alvos;
  END IF;

  SELECT ordem INTO v_ordem FROM public.os_termo_impressao WHERE titulo = 'Segundo';
  IF v_ordem <> 10 THEN RAISE EXCEPTION 'Segundo bloco deveria ter ordem 10, tem %.', v_ordem; END IF;

  IF (SELECT itens FROM public.os_termo_impressao WHERE titulo = 'Primeiro') <> '["a","b"]'::jsonb THEN
    RAISE EXCEPTION 'Os itens não sobreviveram ao salvamento.';
  END IF;

  -- Salvar de novo substitui a lista inteira; nada acumula.
  PERFORM public.salvar_os_termos_impressao('[
    {"titulo":"Único","intro":"","itens":["x"],"status":["CANCELADO"],"alvos":["VEICULO"]}
  ]'::jsonb);
  SELECT count(*) INTO v_total FROM public.os_termo_impressao;
  IF v_total <> 1 THEN RAISE EXCEPTION 'Substituição deixou % blocos.', v_total; END IF;

  -- Lista vazia é o "restaurar padrão": a tabela esvazia e a aplicação volta
  -- aos textos que já vinham impressos.
  PERFORM public.salvar_os_termos_impressao('[]'::jsonb);
  SELECT count(*) INTO v_total FROM public.os_termo_impressao;
  IF v_total <> 0 THEN RAISE EXCEPTION 'Restaurar padrão deixou % blocos.', v_total; END IF;

  -- Status fora do enum da OS não entra: a coluna é enum_status_os[].
  v_erro := false;
  BEGIN
    PERFORM public.salvar_os_termos_impressao('[
      {"titulo":"T","intro":"","itens":["x"],"status":["INVENTADO"],"alvos":["VEICULO"]}
    ]'::jsonb);
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou status inexistente.'; END IF;

  -- Alvo fora dos três conhecidos também não.
  v_erro := false;
  BEGIN
    PERFORM public.salvar_os_termos_impressao('[
      {"titulo":"T","intro":"","itens":["x"],"status":["CONCLUIDO"],"alvos":["MARCIANO"]}
    ]'::jsonb);
  EXCEPTION WHEN check_violation THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou alvo desconhecido.'; END IF;

  -- Título vazio derrubaria um bloco sem cabeçalho no papel.
  v_erro := false;
  BEGIN
    PERFORM public.salvar_os_termos_impressao('[
      {"titulo":"   ","intro":"","itens":["x"],"status":["CONCLUIDO"],"alvos":["VEICULO"]}
    ]'::jsonb);
  EXCEPTION WHEN check_violation THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou bloco sem título.'; END IF;

  -- Payload que não é lista.
  v_erro := false;
  BEGIN
    PERFORM public.salvar_os_termos_impressao('{"titulo":"T"}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'Aceitou payload que não é lista.'; END IF;

  RAISE NOTICE 'os_termo_impressao: todas as verificações passaram.';
END;
$test$;
ROLLBACK;
