BEGIN;

-- Busca no catálogo de NCM: o que a coluna gerada e os índices têm de garantir
-- para o seletor das telas funcionar. Tudo dentro de uma transação revertida.
DO $$
DECLARE
  v_n integer;
  v_desc text;
BEGIN
  -- 1. Código exato: o caso da venda 180 depois da correção do cadastro.
  SELECT count(*) INTO v_n FROM public.fiscal_ncm WHERE codigo = '90328925';
  IF v_n <> 1 THEN RAISE EXCEPTION 'NCM 90328925 deveria existir; achou %', v_n; END IF;

  SELECT descricao INTO v_desc FROM public.fiscal_ncm WHERE codigo = '90328925';
  IF v_desc IS DISTINCT FROM 'De sistemas de injeção' THEN
    RAISE EXCEPTION 'descrição inesperada para 90328925: %', v_desc;
  END IF;

  -- 2. Código inexistente continua inexistente; é o que alimenta a sugestão.
  SELECT count(*) INTO v_n FROM public.fiscal_ncm WHERE codigo = '90328920';
  IF v_n <> 0 THEN RAISE EXCEPTION 'NCM 90328920 não deveria existir'; END IF;

  -- 3. Prefixo de 6 dígitos traz a subposição inteira, que é a sugestão.
  SELECT count(*) INTO v_n FROM public.fiscal_ncm WHERE codigo LIKE '903289%';
  IF v_n < 5 THEN RAISE EXCEPTION 'subposição 903289 com poucos códigos: %', v_n; END IF;

  -- 4. Busca por descrição sem acento acha o texto acentuado.
  SELECT count(*) INTO v_n FROM public.fiscal_ncm WHERE descricao_busca LIKE '%injecao%';
  IF v_n < 1 THEN RAISE EXCEPTION 'busca sem acento não achou "injeção"'; END IF;

  -- 5. E acha justamente o código do caso real.
  SELECT count(*) INTO v_n
    FROM public.fiscal_ncm
   WHERE descricao_busca LIKE '%injecao%' AND codigo = '90328925';
  IF v_n <> 1 THEN RAISE EXCEPTION '"injecao" deveria achar 90328925'; END IF;

  -- 6. HTML do portal não entra na coluna de busca.
  SELECT count(*) INTO v_n FROM public.fiscal_ncm WHERE descricao_busca LIKE '%<i>%';
  IF v_n <> 0 THEN RAISE EXCEPTION '% linhas com HTML na coluna de busca', v_n; END IF;

  -- 7. A coluna é gerada: escrever nela direto é recusado pelo banco.
  BEGIN
    UPDATE public.fiscal_ncm SET descricao_busca = 'manipulado' WHERE codigo = '90328925';
    RAISE EXCEPTION 'o banco aceitou escrever numa coluna GENERATED';
  EXCEPTION
    WHEN generated_always THEN NULL;
    WHEN syntax_error_or_access_rule_violation THEN NULL;
  END;

  -- 8. E ela acompanha a descrição sozinha, sem ninguém lembrar de atualizar.
  INSERT INTO public.fiscal_ncm (codigo, descricao, fonte)
  VALUES ('00000001', 'Peça de INJEÇÃO com <b>marcação</b>', 'teste');
  SELECT descricao_busca INTO v_desc FROM public.fiscal_ncm WHERE codigo = '00000001';
  IF v_desc NOT LIKE '%injecao%' OR v_desc LIKE '%<b>%' THEN
    RAISE EXCEPTION 'coluna gerada não normalizou: %', v_desc;
  END IF;

  RAISE NOTICE 'busca por código, por texto e coluna gerada: ok';
END $$;

-- 8b. Família: a hierarquia é o que dá sentido à descrição publicada.
DO $$
DECLARE
  v_caminho text;
  v_n integer;
BEGIN
  UPDATE public.fiscal_ncm
     SET caminho = 'Instrumentos e aparelhos para regulação ou controle, automáticos › Controladores eletrônicos do tipo utilizado em veículos automóveis'
   WHERE codigo IN ('90328925', '90328929');

  SELECT caminho INTO v_caminho FROM public.fiscal_ncm WHERE codigo = '90328925';
  IF v_caminho IS NULL OR v_caminho NOT LIKE '%Controladores eletrônicos%' THEN
    RAISE EXCEPTION 'caminho do 90328925 não foi gravado: %', v_caminho;
  END IF;

  -- O caminho entra na busca: "controlador" tem de achar o 9032.89.25, cuja
  -- descrição própria ("De sistemas de injeção") não tem essa palavra.
  SELECT count(*) INTO v_n
    FROM public.fiscal_ncm
   WHERE descricao_busca LIKE '%controlador%' AND codigo = '90328925';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '"controlador" deveria achar o 90328925 pelo caminho';
  END IF;

  -- E um código "Outros" fica pesquisável pela família.
  SELECT count(*) INTO v_n
    FROM public.fiscal_ncm
   WHERE descricao_busca LIKE '%veiculos automoveis%' AND codigo = '90328929';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'o código "Outros" deveria ser achado pela família';
  END IF;

  RAISE NOTICE 'família na busca: ok';
END $$;

-- 9. Vigência: o recorte que a API aplica.
DO $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.fiscal_ncm (codigo, descricao, vigencia_inicio, vigencia_fim, fonte)
  VALUES ('00000002', 'Código de teste encerrado', DATE '2020-01-01', DATE '2025-12-31', 'teste');

  -- Não aparece hoje.
  SELECT count(*) INTO v_n
    FROM public.fiscal_ncm
   WHERE codigo = '00000002'
     AND (vigencia_inicio IS NULL OR vigencia_inicio <= DATE '2026-09-22')
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2026-09-22');
  IF v_n <> 0 THEN RAISE EXCEPTION 'código encerrado apareceu na data atual'; END IF;

  -- Aparece numa consulta histórica.
  SELECT count(*) INTO v_n
    FROM public.fiscal_ncm
   WHERE codigo = '00000002'
     AND (vigencia_inicio IS NULL OR vigencia_inicio <= DATE '2024-06-10')
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2024-06-10');
  IF v_n <> 1 THEN RAISE EXCEPTION 'consulta histórica não achou o código que valia'; END IF;

  RAISE NOTICE 'recorte de vigência: ok';
END $$;

-- 10. Índices e segurança: a busca por texto não pode virar varredura, e a
-- tabela continua fora do alcance do cliente.
DO $$
DECLARE
  v_rls boolean;
  v_privs integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'fiscal_ncm' AND indexname = 'fiscal_ncm_descricao_busca'
  ) THEN
    RAISE EXCEPTION 'índice de trigrama da descrição não existe';
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.fiscal_ncm'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS não está ligada em fiscal_ncm'; END IF;

  SELECT count(*) INTO v_privs
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'fiscal_ncm'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_privs <> 0 THEN
    RAISE EXCEPTION 'anon/authenticated têm % privilégio(s) em fiscal_ncm', v_privs;
  END IF;

  RAISE NOTICE 'índices e RLS: ok';
END $$;

ROLLBACK;
