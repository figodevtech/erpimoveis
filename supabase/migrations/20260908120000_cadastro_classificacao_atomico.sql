-- Fase 3 do plano de contas dinamico: cadastro atomico e bloqueio de gravacao.
--
-- O QUE ESTA MIGRATION FAZ
-- Cria as RPCs que salvam grupo e conta junto da classificacao e da regra de
-- vigencia, numa unica transacao e com concorrencia otimista. Acrescenta a
-- guarda que recusa, no banco, lancamento com classificacao incompativel.
--
-- POR QUE RPC E NAO TRES CHAMADAS REST
-- Gravar o cadastro, abrir a regra nova e fechar a anterior sao tres efeitos de
-- uma decisao so. Em chamadas separadas, uma falha no meio deixa o cadastro
-- dizendo uma coisa e o historico dizendo outra — e a resolucao de uma
-- competencia passada usa o historico. Ou os tres acontecem, ou nenhum.
--
-- POR QUE A GUARDA NAO VALE EM LEGADO
-- Enquanto a implantacao esta em LEGADO, a classificacao nova nao decide nada, e
-- os cadastros ainda nao foram migrados: bloquear agora recusaria lancamento que
-- o financeiro faz todo dia, sem melhorar numero nenhum.
--
-- CODIGOS DE ERRO
-- PT409 conflito de versao (alguem salvou antes). PT422 classificacao
-- semanticamente incompativel. As rotas traduzem para HTTP sem adivinhar pela
-- mensagem.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Compatibilidade entre a excecao da conta e a familia do grupo
-- ---------------------------------------------------------------------------
-- Trocar entre receita, despesa e patrimonio exige trocar de grupo. Uma excecao
-- que atravessa familia esconderia essa mudanca dentro de um campo avancado, e
-- a validacao de natureza deixaria de significar alguma coisa.
--
-- Grupo ainda sem classificacao padrao aceita qualquer excecao: nao ha familia
-- com que comparar. E o estado dos cadastros antes da migracao da Entrega A.

CREATE OR REPLACE FUNCTION public.plano_contas_excecao_compativel(
  p_grupo_id integer,
  p_classificacao_id integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_classificacao_id IS NULL
      OR NOT EXISTS (
        SELECT 1
          FROM public.planosdecontagrupos g
          JOIN public.classificacoes_resultado padrao ON padrao.id = g.classificacao_padrao_id
          JOIN public.classificacoes_resultado excecao ON excecao.id = p_classificacao_id
         WHERE g.id = p_grupo_id
           AND padrao.familia <> excecao.familia);
$function$;

-- ---------------------------------------------------------------------------
-- 2) Historico da regra
-- ---------------------------------------------------------------------------
-- Fecha a regra aberta na data da nova e abre a seguinte. Fim exclusivo: as duas
-- juntas cobrem a linha do tempo sem buraco e sem sobreposicao.
--
-- Uma regra que comecaria antes do fim que acabou de ser gravado seria
-- sobreposicao; o gatilho da Fase 1 recusaria, mas a mensagem daqui explica o
-- que a pessoa tentou fazer.

CREATE OR REPLACE FUNCTION public.plano_contas_registrar_regra(
  p_grupo_id integer,
  p_conta_id integer,
  p_classificacao_id integer,
  p_vigencia_inicio date,
  p_origem text,
  p_usuario uuid,
  p_justificativa text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_versao integer;
  v_id integer;
  v_conflito date;
BEGIN
  IF num_nonnulls(p_grupo_id, p_conta_id) <> 1 THEN
    RAISE EXCEPTION 'A regra e de um grupo OU de uma conta.' USING ERRCODE = '22023';
  END IF;

  SELECT max(vigencia_inicio) INTO v_conflito
    FROM public.plano_contas_classificacao_regra r
   WHERE r.grupo_id IS NOT DISTINCT FROM p_grupo_id
     AND r.conta_id IS NOT DISTINCT FROM p_conta_id
     AND r.vigencia_inicio > p_vigencia_inicio;

  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION
      'Ja existe regra a partir de % para este cadastro: uma vigencia nova nao pode comecar antes dela.',
      v_conflito
      USING ERRCODE = 'PT422';
  END IF;

  UPDATE public.plano_contas_classificacao_regra
     SET vigencia_fim = p_vigencia_inicio
   WHERE grupo_id IS NOT DISTINCT FROM p_grupo_id
     AND conta_id IS NOT DISTINCT FROM p_conta_id
     AND vigencia_fim IS NULL
     AND vigencia_inicio < p_vigencia_inicio;

  -- Regra que comecaria no mesmo dia da anterior substitui a anterior: duas
  -- regras iniciando na mesma data nao tem ordem definida.
  DELETE FROM public.plano_contas_classificacao_regra
   WHERE grupo_id IS NOT DISTINCT FROM p_grupo_id
     AND conta_id IS NOT DISTINCT FROM p_conta_id
     AND vigencia_inicio = p_vigencia_inicio;

  IF p_classificacao_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT max(versao_catalogo) INTO v_versao FROM public.classificacoes_resultado;

  INSERT INTO public.plano_contas_classificacao_regra
    (grupo_id, conta_id, classificacao_id, origem_regra, vigencia_inicio,
     versao_catalogo, justificativa, created_by)
  VALUES (p_grupo_id, p_conta_id, p_classificacao_id, coalesce(p_origem, 'MANUAL'),
          p_vigencia_inicio, coalesce(v_versao, 1), p_justificativa, p_usuario)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Salvar grupo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.plano_contas_salvar_grupo(
  p_id integer,
  p_codigo text,
  p_nome text,
  p_descricao text,
  p_ativo boolean,
  p_classificacao_id integer,
  p_versao_esperada integer DEFAULT NULL,
  p_vigencia_inicio date DEFAULT NULL,
  p_usuario uuid DEFAULT NULL,
  p_justificativa text DEFAULT NULL,
  p_origem_regra text DEFAULT 'MANUAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_atual   public.planosdecontagrupos%rowtype;
  v_id      integer;
  v_vigencia date := coalesce(p_vigencia_inicio, current_date);
  v_ativas  integer;
BEGIN
  IF nullif(btrim(coalesce(p_codigo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Codigo do grupo e obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do grupo e obrigatorio.' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.planosdecontagrupos
      (codigo, nome, descricao, ativo, classificacao_padrao_id, origem_cadastro, createdat, updatedat)
    VALUES (btrim(p_codigo), btrim(p_nome), nullif(btrim(coalesce(p_descricao, '')), ''),
            coalesce(p_ativo, true), p_classificacao_id, 'PERSONALIZADO', now(), now())
    RETURNING id INTO v_id;

    PERFORM public.plano_contas_registrar_regra(
      v_id, NULL, p_classificacao_id, v_vigencia, p_origem_regra, p_usuario, p_justificativa);

    RETURN to_jsonb((SELECT g FROM public.planosdecontagrupos g WHERE g.id = v_id));
  END IF;

  SELECT * INTO v_atual FROM public.planosdecontagrupos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF p_versao_esperada IS NOT NULL AND v_atual.versao_registro <> p_versao_esperada THEN
    RAISE EXCEPTION
      'O grupo foi alterado por outra pessoa (versao % em vez de %). Recarregue antes de salvar.',
      v_atual.versao_registro, p_versao_esperada
      USING ERRCODE = 'PT409';
  END IF;

  -- Grupo do sistema tem significado protegido: nome local e apresentacao, a
  -- finalidade nao muda sem uma versao nova do catalogo.
  IF v_atual.origem_cadastro = 'SISTEMA'
     AND p_classificacao_id IS DISTINCT FROM v_atual.classificacao_padrao_id THEN
    RAISE EXCEPTION
      'Grupo padrao do sistema nao muda de finalidade. Crie um grupo proprio para outra classificacao.'
      USING ERRCODE = 'PT422';
  END IF;

  -- Inativar grupo com conta ativa deixaria as contas sem destino sem que
  -- ninguem tivesse decidido nada sobre elas.
  IF coalesce(p_ativo, v_atual.ativo) = false AND v_atual.ativo THEN
    SELECT count(*) INTO v_ativas
      FROM public.planosdeconta c WHERE c.grupo_id = p_id AND c.ativo;
    IF v_ativas > 0 THEN
      RAISE EXCEPTION
        'O grupo tem % conta(s) ativa(s). Inative ou mova as contas antes de inativar o grupo.', v_ativas
        USING ERRCODE = 'PT422';
    END IF;
  END IF;

  -- Trocar a classificacao do grupo nao pode deixar uma excecao de conta em
  -- outra familia: a excecao viraria uma mudanca de natureza escondida.
  IF p_classificacao_id IS DISTINCT FROM v_atual.classificacao_padrao_id THEN
    IF EXISTS (
      SELECT 1
        FROM public.planosdeconta c
        JOIN public.classificacoes_resultado excecao ON excecao.id = c.classificacao_especifica_id
        JOIN public.classificacoes_resultado nova ON nova.id = p_classificacao_id
       WHERE c.grupo_id = p_id AND nova.familia <> excecao.familia
    ) THEN
      RAISE EXCEPTION
        'Ha contas com excecao de outra familia neste grupo. Ajuste as contas antes de mudar a classificacao do grupo.'
        USING ERRCODE = 'PT422';
    END IF;
  END IF;

  UPDATE public.planosdecontagrupos
     SET codigo = btrim(p_codigo),
         nome = btrim(p_nome),
         descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
         ativo = coalesce(p_ativo, ativo),
         classificacao_padrao_id = p_classificacao_id,
         versao_registro = versao_registro + 1,
         updatedat = now()
   WHERE id = p_id;

  IF p_classificacao_id IS DISTINCT FROM v_atual.classificacao_padrao_id THEN
    PERFORM public.plano_contas_registrar_regra(
      p_id, NULL, p_classificacao_id, v_vigencia, p_origem_regra, p_usuario, p_justificativa);
  END IF;

  RETURN to_jsonb((SELECT g FROM public.planosdecontagrupos g WHERE g.id = p_id));
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_salvar_grupo(integer, text, text, text, boolean, integer, integer, date, uuid, text, text) IS
  'Salva grupo, classificacao padrao e regra de vigencia numa transacao. Concorrencia otimista por versao_registro (PT409). Incompatibilidade semantica usa PT422.';

-- ---------------------------------------------------------------------------
-- 4) Salvar conta
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.plano_contas_salvar_conta(
  p_id integer,
  p_codigo text,
  p_nome text,
  p_descricao text,
  p_ativo boolean,
  p_grupo_id integer,
  p_classificacao_id integer,
  p_versao_esperada integer DEFAULT NULL,
  p_vigencia_inicio date DEFAULT NULL,
  p_usuario uuid DEFAULT NULL,
  p_justificativa text DEFAULT NULL,
  p_origem_regra text DEFAULT 'MANUAL'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_atual    public.planosdeconta%rowtype;
  v_id       integer;
  v_vigencia date := coalesce(p_vigencia_inicio, current_date);
  v_grupo_ativo boolean;
BEGIN
  IF nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nome da conta e obrigatorio.' USING ERRCODE = '22023';
  END IF;

  SELECT ativo INTO v_grupo_ativo FROM public.planosdecontagrupos WHERE id = p_grupo_id;
  IF v_grupo_ativo IS NULL THEN
    RAISE EXCEPTION 'Grupo de plano de conta nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.plano_contas_excecao_compativel(p_grupo_id, p_classificacao_id) THEN
    RAISE EXCEPTION
      'A classificacao escolhida e de outra familia que a do grupo. Para mudar entre receita, despesa e patrimonio, mude o grupo.'
      USING ERRCODE = 'PT422';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.planosdeconta
      (codigo, nome, descricao, ativo, grupo_id, classificacao_especifica_id,
       origem_cadastro, createdat, updatedat)
    VALUES (nullif(btrim(coalesce(p_codigo, '')), ''), btrim(p_nome),
            nullif(btrim(coalesce(p_descricao, '')), ''), coalesce(p_ativo, true),
            p_grupo_id, p_classificacao_id, 'PERSONALIZADO', now(), now())
    RETURNING id INTO v_id;

    IF p_classificacao_id IS NOT NULL THEN
      PERFORM public.plano_contas_registrar_regra(
        NULL, v_id, p_classificacao_id, v_vigencia, p_origem_regra, p_usuario, p_justificativa);
    END IF;

    RETURN to_jsonb((SELECT c FROM public.planosdeconta c WHERE c.id = v_id));
  END IF;

  SELECT * INTO v_atual FROM public.planosdeconta WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_versao_esperada IS NOT NULL AND v_atual.versao_registro <> p_versao_esperada THEN
    RAISE EXCEPTION
      'A conta foi alterada por outra pessoa (versao % em vez de %). Recarregue antes de salvar.',
      v_atual.versao_registro, p_versao_esperada
      USING ERRCODE = 'PT409';
  END IF;

  -- Conta do sistema mantem a chave e a finalidade; nome e codigo continuam
  -- editaveis, porque sao apresentacao.
  IF v_atual.origem_cadastro = 'SISTEMA'
     AND (p_grupo_id IS DISTINCT FROM v_atual.grupo_id
          OR p_classificacao_id IS DISTINCT FROM v_atual.classificacao_especifica_id) THEN
    RAISE EXCEPTION
      'Conta padrao do sistema nao muda de grupo nem de classificacao.'
      USING ERRCODE = 'PT422';
  END IF;

  UPDATE public.planosdeconta
     SET codigo = nullif(btrim(coalesce(p_codigo, '')), ''),
         nome = btrim(p_nome),
         descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
         ativo = coalesce(p_ativo, ativo),
         grupo_id = p_grupo_id,
         classificacao_especifica_id = p_classificacao_id,
         versao_registro = versao_registro + 1,
         updatedat = now()
   WHERE id = p_id;

  -- Editar nome ou codigo nao reclassifica nada: so a mudanca de classificacao
  -- ou de grupo abre regra nova.
  IF p_classificacao_id IS DISTINCT FROM v_atual.classificacao_especifica_id
     OR p_grupo_id IS DISTINCT FROM v_atual.grupo_id THEN
    PERFORM public.plano_contas_registrar_regra(
      NULL, p_id, p_classificacao_id, v_vigencia, p_origem_regra, p_usuario, p_justificativa);
  END IF;

  RETURN to_jsonb((SELECT c FROM public.planosdeconta c WHERE c.id = p_id));
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_salvar_conta(integer, text, text, text, boolean, integer, integer, integer, date, uuid, text, text) IS
  'Salva conta, excecao de classificacao e regra de vigencia numa transacao. Editar nome ou codigo nao abre regra nova: nome e apresentacao.';

-- ---------------------------------------------------------------------------
-- 5) Uso de um cadastro
-- ---------------------------------------------------------------------------
-- A tela precisa dizer quantos vinculos uma mudanca alcanca antes de a pessoa
-- confirmar. Contagem agregada: o detalhe fica no drill-down da DRE.

CREATE OR REPLACE FUNCTION public.plano_contas_uso_da_conta(p_conta_id integer)
RETURNS TABLE (transacoes bigint, eventos bigint, primeira date, ultima date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.eventos_financeiros e
            WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
              AND e.status IN ('ATIVO', 'CONVERTIDO')))::bigint,
         min(t.competencia_em)::date,
         max(t.competencia_em)::date
    FROM public.transacao t
   WHERE t.plano_de_conta_id = p_conta_id;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Bloqueio de gravacao incompativel
-- ---------------------------------------------------------------------------
-- A tela valida antes de enviar e a rota valida de novo. Esta guarda existe
-- porque nenhuma das duas cobre importacao, script ou acesso direto.
--
-- Vale apenas em ATIVO, e apenas para movimento de resultado: SAQUE e DEPOSITO
-- sao tesouraria e nao tem natureza de resultado a conferir.
--
-- Banco sem registro de implantacao aborta a gravacao em vez de liberar: uma
-- guarda que se desliga sozinha quando a configuracao some nao e uma guarda.

CREATE OR REPLACE FUNCTION public.tg_transacao_valida_classificacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_estado text;
  v_previa record;
  v_natureza text;
BEGIN
  IF new.plano_de_conta_id IS NULL THEN
    RETURN new;
  END IF;

  -- `dre_modo_apuracao` aborta quando nao ha configuracao. Ler a tabela direto
  -- devolveria NULL, a guarda concluiria "nao e ATIVO" e deixaria passar — e
  -- falta de configuracao teria virado uma decisao.
  SELECT m.estado INTO v_estado FROM public.dre_modo_apuracao() m;
  IF v_estado IS DISTINCT FROM 'ATIVO' THEN
    RETURN new;
  END IF;

  v_natureza := CASE upper(new.tipo::text)
                  WHEN 'RECEITA' THEN 'RECEITA'
                  WHEN 'DESPESA' THEN 'DESPESA'
                  ELSE NULL
                END;
  IF v_natureza IS NULL THEN
    RETURN new;
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(
      new.plano_de_conta_id, v_natureza,
      coalesce(new.competencia_em, new.data, now())::date);

  IF v_previa.resultado = 'INCOMPATIVEL' THEN
    RAISE EXCEPTION '%', v_previa.motivo USING ERRCODE = 'PT422';
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_transacao_valida_classificacao ON public.transacao;
CREATE TRIGGER trg_transacao_valida_classificacao
BEFORE INSERT OR UPDATE OF plano_de_conta_id, tipo, competencia_em ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_valida_classificacao();

-- ---------------------------------------------------------------------------
-- 7) Visao do cadastro para a tela
-- ---------------------------------------------------------------------------
-- A tela precisa mostrar, por conta: origem do cadastro, se a classificacao e
-- herdada ou excecao, o destino na DRE e o motivo quando fica fora dela.
--
-- Isso poderia ser montado na aplicacao a partir de quatro consultas. Seria uma
-- segunda copia da regra de precedencia — e a tela passaria a explicar um
-- destino que a soma nao usa. Aqui a explicacao vem da mesma funcao que resolve.

CREATE OR REPLACE FUNCTION public.plano_contas_visao(
  p_competencia date DEFAULT current_date
)
RETURNS TABLE (
  conta_id integer, conta_codigo text, conta_nome text, conta_descricao text,
  conta_ativo boolean, conta_origem text, conta_codigo_sistema text, conta_versao integer,
  grupo_id integer, grupo_codigo text, grupo_nome text, grupo_ativo boolean,
  grupo_origem text, grupo_codigo_sistema text, grupo_versao integer,
  classificacao_especifica text, classificacao text, classificacao_nome text,
  classificacao_origem text, familia text, tratamento text, naturezas text[],
  linha_codigo text, linha_nome text, motivo text, situacao text,
  transacoes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
  SELECT c.id, c.codigo, c.nome, c.descricao, c.ativo, c.origem_cadastro, c.codigo_sistema,
         c.versao_registro,
         g.id, g.codigo, g.nome, g.ativo, g.origem_cadastro, g.codigo_sistema, g.versao_registro,
         excecao.codigo, efetiva.codigo, efetiva.nome, r.origem, efetiva.familia, efetiva.tratamento,
         efetiva.naturezas,
         l.codigo, l.nome,
         CASE WHEN d.exclui THEN d.motivo END,
         CASE
           WHEN efetiva.id IS NULL THEN 'PENDENTE'
           WHEN d.exclui THEN 'EXCLUIDO'
           WHEN l.id IS NULL THEN 'PENDENTE'
           ELSE 'CLASSIFICADO'
         END,
         (SELECT count(*) FROM public.transacao tr WHERE tr.plano_de_conta_id = c.id)
    FROM public.planosdeconta c
    JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
    CROSS JOIN t
    LEFT JOIN public.classificacoes_resultado excecao ON excecao.id = c.classificacao_especifica_id
    LEFT JOIN LATERAL public.dre_classificacao_do_cadastro(c.id, g.id, p_competencia) r ON true
    LEFT JOIN public.classificacoes_resultado efetiva ON efetiva.id = r.classificacao_id
    LEFT JOIN LATERAL public.dre_destino_da_classificacao(t.id, efetiva.id) d ON efetiva.id IS NOT NULL
    LEFT JOIN public.dre_linha l ON l.id = d.linha_id
   ORDER BY g.codigo, c.codigo NULLS LAST, c.nome;
$function$;

COMMENT ON FUNCTION public.plano_contas_visao(date) IS
  'Contas com origem, classificacao herdada ou de excecao, destino na DRE e motivo de exclusao, resolvidos pela mesma funcao que a soma usa.';

CREATE OR REPLACE FUNCTION public.plano_contas_grupos_visao(
  p_competencia date DEFAULT current_date
)
RETURNS TABLE (
  grupo_id integer, codigo text, nome text, descricao text, ativo boolean,
  origem text, codigo_sistema text, versao integer,
  classificacao text, classificacao_nome text, familia text, tratamento text,
  naturezas text[], linha_codigo text, linha_nome text, motivo text, situacao text,
  contas bigint, contas_ativas bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
  SELECT g.id, g.codigo, g.nome, g.descricao, g.ativo, g.origem_cadastro, g.codigo_sistema,
         g.versao_registro,
         efetiva.codigo, efetiva.nome, efetiva.familia, efetiva.tratamento, efetiva.naturezas,
         l.codigo, l.nome,
         CASE WHEN d.exclui THEN d.motivo END,
         CASE
           WHEN efetiva.id IS NULL THEN 'PENDENTE'
           WHEN d.exclui THEN 'EXCLUIDO'
           WHEN l.id IS NULL THEN 'PENDENTE'
           ELSE 'CLASSIFICADO'
         END,
         (SELECT count(*) FROM public.planosdeconta c WHERE c.grupo_id = g.id),
         (SELECT count(*) FROM public.planosdeconta c WHERE c.grupo_id = g.id AND c.ativo)
    FROM public.planosdecontagrupos g
    CROSS JOIN t
    LEFT JOIN LATERAL public.dre_classificacao_do_cadastro(NULL, g.id, p_competencia) r ON true
    LEFT JOIN public.classificacoes_resultado efetiva ON efetiva.id = r.classificacao_id
    LEFT JOIN LATERAL public.dre_destino_da_classificacao(t.id, efetiva.id) d ON efetiva.id IS NOT NULL
    LEFT JOIN public.dre_linha l ON l.id = d.linha_id
   ORDER BY g.codigo, g.nome;
$function$;

COMMENT ON FUNCTION public.plano_contas_grupos_visao(date) IS
  'Grupos com origem, classificacao padrao e destino, inclusive os que ainda nao tem conta nenhuma.';

-- ---------------------------------------------------------------------------
-- 8) Acesso
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.plano_contas_excecao_compativel(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_registrar_regra(integer, integer, integer, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_salvar_grupo(integer, text, text, text, boolean, integer, integer, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_salvar_conta(integer, text, text, text, boolean, integer, integer, integer, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_uso_da_conta(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_visao(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_grupos_visao(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_transacao_valida_classificacao() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.plano_contas_excecao_compativel(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_registrar_regra(integer, integer, integer, date, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_salvar_grupo(integer, text, text, text, boolean, integer, integer, date, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_salvar_conta(integer, text, text, text, boolean, integer, integer, integer, date, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_uso_da_conta(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_visao(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_grupos_visao(date) TO service_role;

COMMIT;
