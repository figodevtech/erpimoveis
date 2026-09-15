-- Linha da DRE escolhida por plano de conta, valendo no modo em que os bancos
-- apuram hoje.
--
-- O PROBLEMA
-- Os bancos apuram em LEGADO. Nesse modo o lancamento avulso ia para a linha do
-- mapeamento do GRUPO da conta (`dre_mapeamento` PLANO_GRUPO), e a classificacao
-- que a tela de planos de conta deixa escolher era ignorada: classificar uma
-- conta nao mexia no relatorio. Pior, a tela lia so a classificacao, que estava
-- vazia, e mostrava "Sem classificacao" para todas as contas que a DRE somava.
-- A fila de pendencias fazia a mesma leitura e acusava 411 contas "sem regra".
--
-- Ligar o modo ATIVO nao resolvia: ele le uma revisao gravada por evento, e
-- nenhuma gravacao de evento registra essa revisao. Os lancamentos novos
-- sumiriam da soma.
--
-- A SAIDA
-- Uma regra so para o destino de um cadastro, `dre_destino_do_cadastro`:
--   1. classificacao da conta;
--   2. classificacao do grupo;
--   3. sem nenhuma das duas, o mapeamento antigo do grupo.
-- Usam essa regra a sincronizacao do lancamento avulso, a decisao de ficar fora
-- do resultado, a visao da tela, a previa do financeiro e a fila de pendencias.
-- Conta e grupo sem classificacao continuam exatamente onde estavam: o
-- mapeamento antigo e o ultimo degrau, e a DRE so muda quando alguem escolhe.
--
-- VIGENCIA — decisao de 15/09/2026
-- Mudar a linha corrige TODO o historico por padrao. Vigencia em branco apaga as
-- regras anteriores daquele cadastro e grava a nova desde o inicio do historico;
-- uma data explicita continua valendo "a partir de". Ao salvar, os lancamentos
-- afetados sao refeitos na mesma transacao: o total da DRE muda na hora.
--
-- O campo do cadastro so decide quando o cadastro nao tem regra nenhuma. Antes,
-- uma primeira classificacao gravada "a partir de setembro" valia tambem para
-- tras, pelo campo, e a tela prometia o contrario.
--
-- FAMILIA
-- A trava que prendia a excecao da conta a familia do grupo sai. Com ela, grupos
-- amplos nao conseguiam mandar cada conta para a sua linha: IRPJ dentro de
-- "Impostos e taxas" nao chegava a 13.1. O que continua protegido e a natureza:
-- lancamento de despesa numa conta classificada como receita nao entra em linha
-- nenhuma e aparece na fila.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Inicio do historico
-- ---------------------------------------------------------------------------
-- Data que a regra "vale para todo o historico" grava. Nomeada para que quem
-- le uma regra saiba que 1900 nao e um dado digitado, e sim "desde sempre".

CREATE OR REPLACE FUNCTION public.plano_contas_inicio_do_historico()
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT DATE '1900-01-01';
$function$;

-- ---------------------------------------------------------------------------
-- 2) Classificacao efetiva de um cadastro numa competencia
-- ---------------------------------------------------------------------------
-- Precedencia: conta antes do grupo. Dentro de cada um, a regra com vigencia
-- decide; o campo do cadastro so vale quando aquele cadastro nao tem regra
-- nenhuma — e o caso de cadastro semeado direto, sem passar pelas RPCs.

CREATE OR REPLACE FUNCTION public.dre_classificacao_do_cadastro(
  p_conta_id integer,
  p_grupo_id integer,
  p_competencia date
)
RETURNS TABLE (classificacao_id integer, origem text, regra_id integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH grupo AS (
    SELECT coalesce(p_grupo_id, (SELECT c.grupo_id FROM public.planosdeconta c WHERE c.id = p_conta_id)) AS id
  ),
  candidatos AS (
    SELECT 1 AS ordem, r.classificacao_id, 'CONTA'::text AS origem, r.id AS regra_id
      FROM public.plano_contas_classificacao_regra r
     WHERE p_conta_id IS NOT NULL
       AND r.conta_id = p_conta_id
       AND p_competencia >= r.vigencia_inicio
       AND (r.vigencia_fim IS NULL OR p_competencia < r.vigencia_fim)
    UNION ALL
    SELECT 2, c.classificacao_especifica_id, 'CONTA', NULL
      FROM public.planosdeconta c
     WHERE c.id = p_conta_id
       AND c.classificacao_especifica_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r WHERE r.conta_id = c.id)
    UNION ALL
    SELECT 3, r.classificacao_id, 'GRUPO', r.id
      FROM public.plano_contas_classificacao_regra r, grupo g
     WHERE g.id IS NOT NULL
       AND r.grupo_id = g.id
       AND p_competencia >= r.vigencia_inicio
       AND (r.vigencia_fim IS NULL OR p_competencia < r.vigencia_fim)
    UNION ALL
    SELECT 4, gr.classificacao_padrao_id, 'GRUPO', NULL
      FROM public.planosdecontagrupos gr, grupo g
     WHERE gr.id = g.id
       AND gr.classificacao_padrao_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r WHERE r.grupo_id = gr.id)
  )
  -- Qualificado: numa funcao SQL, um nome que serve a coluna e a parametro de
  -- saida ao mesmo tempo e ambiguo e o Postgres recusa.
  SELECT c.classificacao_id, c.origem, c.regra_id
    FROM candidatos c
   ORDER BY c.ordem
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.dre_classificacao_do_cadastro(integer, integer, date) IS
  'Classificacao efetiva de conta/grupo numa competencia: conta antes do grupo; regra com vigencia decide, e o campo do cadastro so vale quando o cadastro nao tem regra nenhuma.';

-- ---------------------------------------------------------------------------
-- 3) Destino de um cadastro — a regra unica
-- ---------------------------------------------------------------------------
-- Conta informada: resolve a conta (e, por ela, o grupo). So o grupo: resolve o
-- que uma conta sem excecao daquele grupo receberia. Nenhum dos dois: pendente.
--
-- Situacoes: CLASSIFICADO (tem linha), EXCLUIDO (fora do resultado, com
-- motivo), PENDENTE (sem destino) e INCOMPATIVEL (so quando a natureza e
-- informada e a classificacao nao a aceita).
--
-- Origens: CONTA, GRUPO ou MAPEAMENTO_GRUPO — este ultimo e o degrau antigo, e
-- e o que permite a tela dizer "pelo grupo" em vez de "sem classificacao".

CREATE OR REPLACE FUNCTION public.dre_destino_do_cadastro(
  p_conta_id integer,
  p_grupo_id integer,
  p_competencia date,
  p_natureza text DEFAULT NULL,
  p_template_id integer DEFAULT NULL
)
RETURNS TABLE (
  situacao         text,
  linha_id         integer,
  classificacao_id integer,
  origem           text,
  regra_id         integer,
  motivo           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo     integer := p_grupo_id;
  v_template  integer;
  v_class     integer;
  v_origem    text;
  v_regra     integer;
  v_naturezas text[];
  v_nome      text;
  v_linha     integer;
  v_exclui    boolean;
  v_motivo    text;
BEGIN
  IF p_conta_id IS NULL AND p_grupo_id IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer, NULL::text, NULL::integer,
      'Lancamento sem conta do plano de contas.'::text;
    RETURN;
  END IF;

  IF p_conta_id IS NOT NULL THEN
    SELECT c.grupo_id INTO v_grupo FROM public.planosdeconta c WHERE c.id = p_conta_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer, NULL::text, NULL::integer,
        'Conta inexistente.'::text;
      RETURN;
    END IF;
  END IF;

  SELECT r.classificacao_id, r.origem, r.regra_id
    INTO v_class, v_origem, v_regra
    FROM public.dre_classificacao_do_cadastro(p_conta_id, v_grupo, coalesce(p_competencia, current_date)) r;

  IF v_class IS NULL THEN
    -- Ultimo degrau: o mapeamento do grupo, lido do mesmo jeito que a
    -- sincronizacao sempre leu. E o que mantem a DRE identica enquanto ninguem
    -- classificar nada.
    SELECT mp.linha_id, coalesce(mp.exclui_do_resultado, false)
      INTO v_linha, v_exclui
      FROM public.dre_mapeamento mp
     WHERE mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = v_grupo AND mp.ativo
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer, NULL::text, NULL::integer,
        'Nem a conta nem o grupo tem linha da DRE definida.'::text;
    ELSIF v_exclui THEN
      RETURN QUERY SELECT 'EXCLUIDO'::text, NULL::integer, NULL::integer, 'MAPEAMENTO_GRUPO'::text,
        NULL::integer, 'Grupo marcado como fora do resultado.'::text;
    ELSIF v_linha IS NULL THEN
      RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer, 'MAPEAMENTO_GRUPO'::text,
        NULL::integer, 'O mapeamento do grupo nao aponta linha.'::text;
    ELSE
      RETURN QUERY SELECT 'CLASSIFICADO'::text, v_linha, NULL::integer, 'MAPEAMENTO_GRUPO'::text,
        NULL::integer, NULL::text;
    END IF;
    RETURN;
  END IF;

  SELECT c.naturezas, c.nome INTO v_naturezas, v_nome
    FROM public.classificacoes_resultado c
   WHERE c.id = v_class AND c.ativo;

  IF v_naturezas IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, v_class, v_origem, v_regra,
      'Classificacao inativa ou inexistente.'::text;
    RETURN;
  END IF;

  IF p_natureza IS NOT NULL AND NOT (p_natureza = ANY (v_naturezas)) THEN
    RETURN QUERY SELECT 'INCOMPATIVEL'::text, NULL::integer, v_class, v_origem, v_regra,
      format('%s nao aceita lancamento de %s.', v_nome, lower(p_natureza));
    RETURN;
  END IF;

  v_template := coalesce(
    p_template_id,
    (SELECT t.id FROM public.dre_template t WHERE t.ativo ORDER BY t.versao DESC LIMIT 1));

  SELECT d.linha_id, d.exclui, d.motivo
    INTO v_linha, v_exclui, v_motivo
    FROM public.dre_destino_da_classificacao(v_template, v_class) d;

  IF v_exclui IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, v_class, v_origem, v_regra,
      format('%s nao tem linha no template ativo.', v_nome);
  ELSIF v_exclui THEN
    RETURN QUERY SELECT 'EXCLUIDO'::text, NULL::integer, v_class, v_origem, v_regra,
      coalesce(v_motivo, 'Nao compoe o resultado.');
  ELSE
    RETURN QUERY SELECT 'CLASSIFICADO'::text, v_linha, v_class, v_origem, v_regra, NULL::text;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.dre_destino_do_cadastro(integer, integer, date, text, integer) IS
  'Destino de conta/grupo numa competencia: classificacao da conta, do grupo e, sem nenhuma, o mapeamento antigo do grupo. Regra unica da sincronizacao, da exclusao do resultado, da tela, da previa e da fila.';

-- ---------------------------------------------------------------------------
-- 4) Quem gera evento de resultado
-- ---------------------------------------------------------------------------
-- Identica a 20260910160000 ate a ultima pergunta. O "fora do resultado" deixa
-- de ler so o mapeamento do grupo e passa a vir do destino do cadastro: uma
-- conta classificada como patrimonial fica fora mesmo num grupo que soma, e uma
-- conta classificada como perda entra mesmo num grupo que ficava fora.

CREATE OR REPLACE FUNCTION public.transacao_gera_evento_de_resultado(
  p_transacao_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx public.transacao%ROWTYPE;
  v_exclui boolean;
BEGIN
  SELECT * INTO v_tx FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, ou saldo de
  -- abertura trazido de outro sistema: nao e resultado novo.
  --
  -- `baixa_de_transacao_id` e a baixa parcial de um titulo que ja tem evento;
  -- `pagamento_multiplo_id`, a parcela que quita varios documentos de uma vez;
  -- `lancamento_id`, o boleto que quita despesas de OS. Os tres sao a mesma
  -- ideia do `evento_financeiro_id`, em formatos diferentes.
  --
  -- `eh_adiantamento` e `adiantamento_id` sao antecipacao de recebivel: o
  -- dinheiro chega antes, a receita ja foi (ou sera) reconhecida no documento.
  -- Contar os dois e faturar duas vezes.
  --
  -- SAQUE, DEPOSITO e `transferencia_id` sao tesouraria: dinheiro mudando de
  -- lugar entre o caixa e a conta da propria empresa. Nao dependem da conta do
  -- plano — um saque numa conta de despesa continua sendo saque. Quando um
  -- gasto de verdade for lancado como saque, o conserto e trocar o tipo do
  -- lancamento, nao fazer a DRE adivinhar.
  IF v_tx.is_deleted
     OR v_tx.evento_financeiro_id IS NOT NULL
     OR v_tx.lancamento_id IS NOT NULL
     OR v_tx.pagamento_multiplo_id IS NOT NULL
     OR v_tx.baixa_de_transacao_id IS NOT NULL
     OR v_tx.ordemservicoid IS NOT NULL
     OR v_tx.vendaid IS NOT NULL
     OR v_tx.entrada_id IS NOT NULL
     OR v_tx.usoconsumo_entrada_id IS NOT NULL
     OR v_tx.origem = 'ORIGEM_MIGRACAO'
     OR coalesce(v_tx.eh_adiantamento, false)
     OR v_tx.adiantamento_id IS NOT NULL
     OR v_tx.transferencia_id IS NOT NULL
     OR upper(v_tx.tipo::text) IN ('SAQUE', 'DEPOSITO') THEN
    RETURN false;
  END IF;

  -- Conta fora do resultado, pela mesma regra que a tela mostra: classificacao
  -- patrimonial da conta ou do grupo, ou, sem nenhuma, o mapeamento antigo do
  -- grupo marcado para ficar fora.
  SELECT d.situacao = 'EXCLUIDO'
    INTO v_exclui
    FROM public.dre_destino_do_cadastro(
           v_tx.plano_de_conta_id, NULL, coalesce(v_tx.competencia_em, v_tx.data)::date) d;

  RETURN NOT coalesce(v_exclui, false);
END;
$function$;

COMMENT ON FUNCTION public.transacao_gera_evento_de_resultado(bigint) IS
  'Verdadeiro quando a transacao deve gerar evento financeiro proprio. Regra unica, usada pela sincronizacao e pela fila de pendencias. Ficam de fora: liquidacao de algo ja reconhecido (evento, lancamento de eventos, pagamento multiplo, baixa parcial, OS, venda, entrada, uso e consumo), carga de migracao, antecipacao de recebivel, tesouraria (saque, deposito e transferencia entre contas proprias) e conta cujo destino (dre_destino_do_cadastro) e fora do resultado.';

-- ---------------------------------------------------------------------------
-- 5) Sincronizacao do lancamento avulso
-- ---------------------------------------------------------------------------
-- Identica a 20260910160000, com a linha vindo de `dre_destino_do_cadastro`.
-- A natureza entra na pergunta: despesa numa conta classificada como receita
-- fica sem linha — e aparece na fila — em vez de somar receita.

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_natureza text;
  v_natureza_dre text;
begin
  select * into v_tx from public.transacao where id = p_transacaoid;
  if not found then return; end if;

  -- Nao e fato novo. Se ja existir evento (a transacao foi religada, ou a conta
  -- dela passou a ficar fora do resultado), cancela o que houver e encerra.
  if not public.transacao_gera_evento_de_resultado(p_transacaoid) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select d.linha_id
    into v_linha_id
    from public.dre_destino_do_cadastro(
           v_tx.plano_de_conta_id, null, coalesce(v_tx.competencia_em, v_tx.data)::date, v_natureza) d
   where d.situacao = 'CLASSIFICADO';

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

  update public.eventos_financeiros
     set natureza = v_natureza, updated_at = now()
   where source_type = 'TRANSACAO'
     and source_id = p_transacaoid
     and status <> 'CONVERTIDO'
     and natureza is distinct from v_natureza;

  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, dre_linha_id,
     centro_custo_id, transacaoid, dados_snapshot, pode_gerar_transacao, status)
  values
    (null, 'TRANSACAO', p_transacaoid, 'AVULSO', v_natureza, v_natureza_dre,
     'TRANSACAO', coalesce(nullif(v_tx.descricao, ''), 'Lancamento #' || p_transacaoid),
     nullif(v_tx.plano_de_conta, ''), round(coalesce(v_tx.valor, 0), 2),
     coalesce(v_tx.competencia_em, v_tx.data), v_linha_id,
     v_tx.centro_custo_id, p_transacaoid,
     jsonb_build_object('categoria', v_tx.categoria, 'sem_classificacao', v_linha_id is null),
     false, 'ATIVO')
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                competencia_em = excluded.competencia_em,
                dre_linha_id = excluded.dre_linha_id,
                natureza_dre = excluded.natureza_dre,
                centro_custo_id = excluded.centro_custo_id,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';
end;
$function$;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) IS
  'Evento de resultado de uma transacao avulsa. Quem decide se ha evento e transacao_gera_evento_de_resultado; a linha vem de dre_destino_do_cadastro. Realinha a natureza antes do upsert porque ela faz parte da chave do on conflict.';

-- ---------------------------------------------------------------------------
-- 6) Refazer os lancamentos de um cadastro
-- ---------------------------------------------------------------------------
-- Chamada por quem muda a classificacao, na mesma transacao. Sem isso, a
-- mudanca so apareceria quando alguem editasse cada lancamento — o mesmo "gravei
-- e o total nao mexeu" que esta migration veio acabar.
--
-- Refaz todas as transacoes do cadastro a partir da data (ou todas, sem data).
-- A sincronizacao e idempotente: uma transacao cujo destino nao mudou sai igual.

CREATE OR REPLACE FUNCTION public.plano_contas_refazer_lancamentos(
  p_conta_id integer,
  p_grupo_id integer,
  p_desde date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id    bigint;
  v_total integer := 0;
BEGIN
  IF p_conta_id IS NULL AND p_grupo_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta ou o grupo cujos lancamentos serao refeitos.' USING ERRCODE = '22023';
  END IF;

  FOR v_id IN
    SELECT t.id
      FROM public.transacao t
      JOIN public.planosdeconta c ON c.id = t.plano_de_conta_id
     WHERE (p_conta_id IS NULL OR c.id = p_conta_id)
       AND (p_grupo_id IS NULL OR c.grupo_id = p_grupo_id)
       AND (p_desde IS NULL OR coalesce(t.competencia_em, t.data)::date >= p_desde)
     ORDER BY t.id
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7) Historico da regra
-- ---------------------------------------------------------------------------
-- Vigencia em branco: historico inteiro. As regras anteriores do cadastro sao
-- apagadas — a classificacao antiga estava errada, nao apenas deixou de valer, e
-- mante-la faria os meses passados continuarem no destino que acabou de ser
-- corrigido.
--
-- Vigencia informada: como antes. Fecha a regra aberta na data e abre a
-- seguinte; recusa comecar antes de uma regra ja registrada.

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
  v_versao   integer;
  v_id       integer;
  v_conflito date;
  v_inicio   date;
BEGIN
  IF num_nonnulls(p_grupo_id, p_conta_id) <> 1 THEN
    RAISE EXCEPTION 'A regra e de um grupo OU de uma conta.' USING ERRCODE = '22023';
  END IF;

  IF p_vigencia_inicio IS NULL THEN
    DELETE FROM public.plano_contas_classificacao_regra
     WHERE grupo_id IS NOT DISTINCT FROM p_grupo_id
       AND conta_id IS NOT DISTINCT FROM p_conta_id;
    v_inicio := public.plano_contas_inicio_do_historico();
  ELSE
    v_inicio := p_vigencia_inicio;

    SELECT max(vigencia_inicio) INTO v_conflito
      FROM public.plano_contas_classificacao_regra r
     WHERE r.grupo_id IS NOT DISTINCT FROM p_grupo_id
       AND r.conta_id IS NOT DISTINCT FROM p_conta_id
       AND r.vigencia_inicio > v_inicio;

    IF v_conflito IS NOT NULL THEN
      RAISE EXCEPTION
        'Ja existe regra a partir de % para este cadastro: uma vigencia nova nao pode comecar antes dela. Para corrigir o passado, grave sem data (todo o historico).',
        v_conflito
        USING ERRCODE = 'PT422';
    END IF;

    UPDATE public.plano_contas_classificacao_regra
       SET vigencia_fim = v_inicio
     WHERE grupo_id IS NOT DISTINCT FROM p_grupo_id
       AND conta_id IS NOT DISTINCT FROM p_conta_id
       AND vigencia_fim IS NULL
       AND vigencia_inicio < v_inicio;

    -- Regra que comecaria no mesmo dia da anterior substitui a anterior: duas
    -- regras iniciando na mesma data nao tem ordem definida.
    DELETE FROM public.plano_contas_classificacao_regra
     WHERE grupo_id IS NOT DISTINCT FROM p_grupo_id
       AND conta_id IS NOT DISTINCT FROM p_conta_id
       AND vigencia_inicio = v_inicio;
  END IF;

  IF p_classificacao_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT max(versao_catalogo) INTO v_versao FROM public.classificacoes_resultado;

  INSERT INTO public.plano_contas_classificacao_regra
    (grupo_id, conta_id, classificacao_id, origem_regra, vigencia_inicio,
     versao_catalogo, justificativa, created_by)
  VALUES (p_grupo_id, p_conta_id, p_classificacao_id, coalesce(p_origem, 'MANUAL'),
          v_inicio, coalesce(v_versao, 1), p_justificativa, p_usuario)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8) Compatibilidade de excecao
-- ---------------------------------------------------------------------------
-- A trava de familia sai (ver o cabecalho). A funcao continua existindo para
-- nao quebrar quem a chame, e responde sempre que sim.

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
  SELECT true;
$function$;

-- ---------------------------------------------------------------------------
-- 9) Salvar grupo
-- ---------------------------------------------------------------------------
-- Igual a 20260908120000, menos a trava de familia, com a vigencia em branco
-- significando historico inteiro e os lancamentos refeitos na mesma operacao.

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
      v_id, NULL, p_classificacao_id, p_vigencia_inicio, p_origem_regra, p_usuario, p_justificativa);

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
      p_id, NULL, p_classificacao_id, p_vigencia_inicio, p_origem_regra, p_usuario, p_justificativa);
    PERFORM public.plano_contas_refazer_lancamentos(NULL, p_id, p_vigencia_inicio);
  END IF;

  RETURN to_jsonb((SELECT g FROM public.planosdecontagrupos g WHERE g.id = p_id));
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_salvar_grupo(integer, text, text, text, boolean, integer, integer, date, uuid, text, text) IS
  'Salva grupo, classificacao padrao e regra de vigencia numa transacao, e refaz os lancamentos das contas do grupo. Vigencia em branco = historico inteiro. Concorrencia otimista por versao_registro (PT409).';

-- ---------------------------------------------------------------------------
-- 10) Salvar conta
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
  v_atual       public.planosdeconta%rowtype;
  v_id          integer;
  v_grupo_ativo boolean;
BEGIN
  IF nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nome da conta e obrigatorio.' USING ERRCODE = '22023';
  END IF;

  SELECT ativo INTO v_grupo_ativo FROM public.planosdecontagrupos WHERE id = p_grupo_id;
  IF v_grupo_ativo IS NULL THEN
    RAISE EXCEPTION 'Grupo de plano de conta nao encontrado.' USING ERRCODE = 'P0002';
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
        NULL, v_id, p_classificacao_id, p_vigencia_inicio, p_origem_regra, p_usuario, p_justificativa);
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
  -- ou de grupo abre regra nova e refaz os lancamentos.
  IF p_classificacao_id IS DISTINCT FROM v_atual.classificacao_especifica_id
     OR p_grupo_id IS DISTINCT FROM v_atual.grupo_id THEN
    PERFORM public.plano_contas_registrar_regra(
      NULL, p_id, p_classificacao_id, p_vigencia_inicio, p_origem_regra, p_usuario, p_justificativa);
    PERFORM public.plano_contas_refazer_lancamentos(p_id, NULL, p_vigencia_inicio);
  END IF;

  RETURN to_jsonb((SELECT c FROM public.planosdeconta c WHERE c.id = p_id));
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_salvar_conta(integer, text, text, text, boolean, integer, integer, integer, date, uuid, text, text) IS
  'Salva conta, classificacao e regra de vigencia numa transacao, e refaz os lancamentos da conta. Vigencia em branco = historico inteiro. Editar nome ou codigo nao abre regra nova.';

-- ---------------------------------------------------------------------------
-- 11) Previa de uma conta
-- ---------------------------------------------------------------------------
-- Mesmo contrato de antes, agora uma leitura direta do destino do cadastro.

CREATE OR REPLACE FUNCTION public.dre_previa_da_conta(
  p_conta_id integer,
  p_natureza text,
  p_competencia date DEFAULT current_date,
  p_template_id integer DEFAULT NULL
)
RETURNS TABLE (
  resultado        text,
  classificacao    text,
  classificacao_nome text,
  linha_codigo     text,
  linha_nome       text,
  origem           text,
  motivo           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_natureza IS NULL OR p_natureza NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION 'Natureza invalida: %.', p_natureza USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT d.situacao, c.codigo, c.nome, l.codigo, l.nome, coalesce(d.origem, 'RESOLVEDOR'), d.motivo
    FROM public.dre_destino_do_cadastro(
           p_conta_id, NULL, coalesce(p_competencia, current_date), p_natureza, p_template_id) d
    LEFT JOIN public.classificacoes_resultado c ON c.id = d.classificacao_id
    LEFT JOIN public.dre_linha l ON l.id = d.linha_id;
END;
$function$;

COMMENT ON FUNCTION public.dre_previa_da_conta(integer, text, date, integer) IS
  'Explica, sem gravar, para onde um lancamento nesta conta vai: linha da DRE, exclusao com motivo, incompatibilidade de natureza ou pendencia. Leitura de dre_destino_do_cadastro, a mesma regra da sincronizacao.';

-- ---------------------------------------------------------------------------
-- 12) Visoes da tela
-- ---------------------------------------------------------------------------
-- Mesmas colunas. `classificacao_origem` passa a poder dizer MAPEAMENTO_GRUPO:
-- a conta tem linha pelo grupo, sem classificacao — e a tela deixa de chamar
-- isso de "sem classificacao".
--
-- Competencia nula vira hoje. As rotas passam `null`, e comparar data com nulo
-- nao casava regra nenhuma: a tela lia so o campo do cadastro.

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
  SELECT c.id, c.codigo, c.nome, c.descricao, c.ativo, c.origem_cadastro, c.codigo_sistema,
         c.versao_registro,
         g.id, g.codigo, g.nome, g.ativo, g.origem_cadastro, g.codigo_sistema, g.versao_registro,
         excecao.codigo, efetiva.codigo, efetiva.nome, d.origem, efetiva.familia, efetiva.tratamento,
         efetiva.naturezas,
         l.codigo, l.nome,
         CASE WHEN d.situacao <> 'CLASSIFICADO' THEN d.motivo END,
         d.situacao,
         (SELECT count(*) FROM public.transacao tr WHERE tr.plano_de_conta_id = c.id)
    FROM public.planosdeconta c
    JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
    LEFT JOIN public.classificacoes_resultado excecao ON excecao.id = c.classificacao_especifica_id
    LEFT JOIN LATERAL public.dre_destino_do_cadastro(
      c.id, g.id, coalesce(p_competencia, current_date)) d ON true
    LEFT JOIN public.classificacoes_resultado efetiva ON efetiva.id = d.classificacao_id
    LEFT JOIN public.dre_linha l ON l.id = d.linha_id
   ORDER BY g.codigo, c.codigo NULLS LAST, c.nome;
$function$;

COMMENT ON FUNCTION public.plano_contas_visao(date) IS
  'Contas com origem, classificacao herdada ou de excecao, destino na DRE e motivo, resolvidos por dre_destino_do_cadastro — a mesma regra da sincronizacao.';

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
  SELECT g.id, g.codigo, g.nome, g.descricao, g.ativo, g.origem_cadastro, g.codigo_sistema,
         g.versao_registro,
         efetiva.codigo, efetiva.nome, efetiva.familia, efetiva.tratamento, efetiva.naturezas,
         l.codigo, l.nome,
         CASE WHEN d.situacao <> 'CLASSIFICADO' THEN d.motivo END,
         d.situacao,
         (SELECT count(*) FROM public.planosdeconta c WHERE c.grupo_id = g.id),
         (SELECT count(*) FROM public.planosdeconta c WHERE c.grupo_id = g.id AND c.ativo)
    FROM public.planosdecontagrupos g
    LEFT JOIN LATERAL public.dre_destino_do_cadastro(
      NULL, g.id, coalesce(p_competencia, current_date)) d ON true
    LEFT JOIN public.classificacoes_resultado efetiva ON efetiva.id = d.classificacao_id
    LEFT JOIN public.dre_linha l ON l.id = d.linha_id
   ORDER BY g.codigo, g.nome;
$function$;

COMMENT ON FUNCTION public.plano_contas_grupos_visao(date) IS
  'Grupos com classificacao padrao e destino — inclusive o destino pelo mapeamento antigo — e os que ainda nao tem conta nenhuma.';

-- ---------------------------------------------------------------------------
-- 13) Fila de pendencias
-- ---------------------------------------------------------------------------
-- Identica a 20260908160000 em tudo, menos nos tres motivos que liam o cadastro:
-- GRUPO_SEM_DESTINO e CONTA_SEM_REGRA passam a perguntar ao destino do cadastro
-- (grupo com mapeamento antigo tem destino), e EXCLUSAO_NAO_REVISADA deixa de
-- contar conta que alguem ja classificou.

CREATE OR REPLACE FUNCTION public.dre_pendencias(
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (
  motivo      text,
  descricao   text,
  escopo      text,
  quantidade  bigint,
  valor       numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_template integer;
  v_modo record;
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;

  RETURN QUERY
  -- Cadastro: nao depende do periodo. Um grupo sem destino e um problema hoje,
  -- mesmo que ninguem tenha lancado nele ainda.
  SELECT 'GRUPO_SEM_DESTINO'::text,
         'Grupo ativo sem linha da DRE: as contas dele sem excecao nao tem para onde ir.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdecontagrupos g
   WHERE g.ativo
     AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(NULL, g.id, current_date) d) = 'PENDENTE'
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'CONTA_SEM_REGRA'::text,
         'Conta ativa sem linha da DRE: nem a conta nem o grupo definem destino.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdeconta c
    JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
   WHERE c.ativo AND g.ativo
     AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(c.id, g.id, current_date) d) = 'PENDENTE'
  HAVING count(*) > 0;

  RETURN QUERY
  -- Periodo: o que existe e nao entra em total nenhum.
  SELECT 'EVENTO_SEM_LINHA'::text,
         'Lancamento no periodo que nao entra em nenhuma linha da DRE.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em BETWEEN p_de AND p_ate
     AND public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio) IS NULL
  HAVING count(*) > 0;

  RETURN QUERY
  -- Item vendido sem custo. Ja existia como contagem avulsa na rota da DRE, e
  -- por isso era o unico aviso sem lista: a tela dizia "6 itens" e nao sabia
  -- dizer quais. Como motivo da fila, ganha o mesmo drill-down dos outros e
  -- deixa de ser um caminho a parte.
  SELECT 'ITEM_SEM_CUSTO'::text,
         'Item vendido sem custo cadastrado: a margem esta superestimada.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.natureza_dre = 'CUSTO'
     AND e.dados_snapshot @> '{"custo_nao_informado": true}'::jsonb
     AND e.competencia_em BETWEEN p_de AND p_ate
  HAVING count(*) > 0;

  RETURN QUERY
  -- OS ainda em execucao: competencia nula aqui e estado legitimo, porque o
  -- carimbo so vem no encerramento. Fica na fila como informacao — a receita ja
  -- foi reconhecida e ainda nao pertence a mes nenhum —, nao como defeito.
  SELECT 'EVENTO_OS_EM_ABERTO'::text,
         'Lancamento de OS ainda em execucao: a competencia so e carimbada no encerramento.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o
      ON o.id = public.os_do_evento(e.ordemservicoid, e.source_type, e.source_id)
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
     AND o.execucao_fim_em IS NULL
  HAVING count(*) > 0;

  RETURN QUERY
  -- Sem fonte nao ha de onde herdar competencia: nenhuma acao no documento
  -- original conserta, porque nao ha documento original.
  SELECT 'EVENTO_SEM_FONTE'::text,
         'Lancamento sem fonte e sem competencia: nao ha de onde herdar o periodo.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
     AND e.source_id IS NULL
     AND e.ordemservicoid IS NULL
  HAVING count(*) > 0;

  RETURN QUERY
  -- O que sobra: tem fonte, a fonte ja encerrou (ou nao e OS) e mesmo assim o
  -- lancamento ficou sem periodo. Anomalia de verdade.
  SELECT 'EVENTO_SEM_COMPETENCIA'::text,
         'Lancamento sem competencia: nao pertence a nenhum periodo.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
     AND (e.source_id IS NOT NULL OR e.ordemservicoid IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.ordemservico o
        WHERE o.id = public.os_do_evento(e.ordemservicoid, e.source_type, e.source_id)
          AND o.execucao_fim_em IS NULL)
  HAVING count(*) > 0;

  RETURN QUERY
  -- Natureza incompativel produz uma DRE que parece valida: uma despesa somando
  -- em receita de servicos nao viola nada, so mente.
  SELECT 'NATUREZA_INCOMPATIVEL'::text,
         'Lancamento numa linha de natureza contraria a dele.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
    JOIN public.dre_linha l
      ON l.id = public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio)
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em BETWEEN p_de AND p_ate
     AND l.natureza_dre IS NOT NULL
     AND ((l.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
       OR (l.natureza_dre IN ('CUSTO', 'DESPESA') AND e.natureza <> 'DESPESA'))
  HAVING count(*) > 0;

  RETURN QUERY
  -- Ausencia de evento nao dispensa controle: a transacao existe, e nada dela
  -- chega ao resultado. So conta quando a transacao DEVERIA ter gerado evento —
  -- acusar o que o sistema decidiu manter fora do resultado ensina a ignorar a
  -- fila.
  SELECT 'TRANSACAO_SEM_EVENTO'::text,
         'Transacao de resultado no periodo que nao gerou lancamento na DRE.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(t.valor), 0), 2)
    FROM public.transacao t
   WHERE t.competencia_em BETWEEN p_de AND p_ate
     AND upper(t.tipo::text) IN ('RECEITA', 'DESPESA')
     AND public.transacao_gera_evento_de_resultado(t.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros e
        WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
          AND e.status IN ('ATIVO', 'CONVERTIDO'))
  HAVING count(*) > 0;

  RETURN QUERY
  -- Exclusao que ninguem revisou: o mapeamento inicial foi sugerido por palavra
  -- no nome do grupo, e nem a conta nem o grupo ganharam classificacao desde
  -- entao. Classificar qualquer um dos dois ja e a revisao.
  SELECT 'EXCLUSAO_NAO_REVISADA'::text,
         'Valor fora da DRE por sugestao automatica de migracao, ainda sem revisao.'::text,
         'PERIODO'::text,
         count(t.id)::bigint,
         round(coalesce(sum(t.valor), 0), 2)
    FROM public.dre_mapeamento m
    JOIN public.planosdecontagrupos g ON g.id = m.origem_id
    JOIN public.planosdeconta c ON c.grupo_id = g.id
    JOIN public.transacao t
      ON t.plano_de_conta_id = c.id
     AND t.competencia_em BETWEEN p_de AND p_ate
   WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.exclui_do_resultado
     AND m.observacao ILIKE '%sugestao automatica%'
     AND g.classificacao_padrao_id IS NULL
     AND c.classificacao_especifica_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r
                      WHERE r.grupo_id = g.id OR r.conta_id = c.id)
  HAVING count(t.id) > 0;
END;
$function$;

COMMENT ON FUNCTION public.dre_pendencias(timestamptz, timestamptz) IS
  'Fila de integridade da DRE, com quantidade e valor por motivo. Escopo CADASTRO nao depende do periodo; PERIODO e GERAL dependem. Destino de cadastro e exclusao vem de dre_destino_do_cadastro e transacao_gera_evento_de_resultado, as mesmas regras da sincronizacao.';

CREATE OR REPLACE FUNCTION public.dre_pendencias_itens(
  p_motivo text,
  p_de timestamptz,
  p_ate timestamptz,
  p_limite integer DEFAULT 100,
  p_deslocamento integer DEFAULT 0
)
RETURNS TABLE (
  referencia_tipo text,
  referencia_id   bigint,
  descricao       text,
  grupo_nome      text,
  conta_nome      text,
  competencia     date,
  valor           numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_template integer;
  v_modo record;
  v_limite integer := least(greatest(coalesce(p_limite, 100), 1), 500);
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;

  IF p_motivo = 'GRUPO_SEM_DESTINO' THEN
    RETURN QUERY
    SELECT 'GRUPO'::text, g.id::bigint, g.nome, g.nome, NULL::text, NULL::date, NULL::numeric
      FROM public.planosdecontagrupos g
     WHERE g.ativo
       AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(NULL, g.id, current_date) d) = 'PENDENTE'
     ORDER BY g.codigo
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'CONTA_SEM_REGRA' THEN
    RETURN QUERY
    SELECT 'CONTA'::text, c.id::bigint, c.nome, g.nome, c.nome, NULL::date,
           (SELECT round(coalesce(sum(t.valor), 0), 2) FROM public.transacao t
             WHERE t.plano_de_conta_id = c.id
               AND t.competencia_em BETWEEN p_de AND p_ate)
      FROM public.planosdeconta c
      JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
     WHERE c.ativo AND g.ativo
       AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(c.id, g.id, current_date) d) = 'PENDENTE'
     ORDER BY g.codigo, c.codigo
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo IN ('EVENTO_SEM_LINHA', 'NATUREZA_INCOMPATIVEL', 'EVENTO_SEM_COMPETENCIA',
                     'EVENTO_OS_EM_ABERTO', 'EVENTO_SEM_FONTE', 'ITEM_SEM_CUSTO') THEN
    RETURN QUERY
    SELECT 'EVENTO'::text, e.id::bigint, e.descricao, g.nome, c.nome,
           e.competencia_em::date, round(e.valor, 2)
      FROM public.eventos_financeiros e
      LEFT JOIN public.transacao t ON t.id = e.source_id AND e.source_type = 'TRANSACAO'
      LEFT JOIN public.planosdeconta c ON c.id = t.plano_de_conta_id
      LEFT JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
      LEFT JOIN public.dre_linha l
        ON l.id = public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio)
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND CASE p_motivo
             WHEN 'EVENTO_OS_EM_ABERTO' THEN
               e.competencia_em IS NULL
               AND EXISTS (SELECT 1 FROM public.ordemservico o
                            WHERE o.id = public.os_do_evento(e.ordemservicoid, e.source_type, e.source_id)
                              AND o.execucao_fim_em IS NULL)
             WHEN 'EVENTO_SEM_FONTE' THEN
               e.competencia_em IS NULL AND e.source_id IS NULL AND e.ordemservicoid IS NULL
             WHEN 'EVENTO_SEM_COMPETENCIA' THEN
               e.competencia_em IS NULL
               AND (e.source_id IS NOT NULL OR e.ordemservicoid IS NOT NULL)
               AND NOT EXISTS (
                 SELECT 1 FROM public.ordemservico o
                  WHERE o.id = public.os_do_evento(e.ordemservicoid, e.source_type, e.source_id)
                    AND o.execucao_fim_em IS NULL)
             WHEN 'ITEM_SEM_CUSTO' THEN
               e.natureza_dre = 'CUSTO'
               AND e.dados_snapshot @> '{"custo_nao_informado": true}'::jsonb
               AND e.competencia_em BETWEEN p_de AND p_ate
             WHEN 'EVENTO_SEM_LINHA' THEN
               e.competencia_em BETWEEN p_de AND p_ate AND l.id IS NULL
             ELSE
               e.competencia_em BETWEEN p_de AND p_ate
               AND l.natureza_dre IS NOT NULL
               AND ((l.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
                 OR (l.natureza_dre IN ('CUSTO', 'DESPESA') AND e.natureza <> 'DESPESA'))
           END
     ORDER BY e.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'TRANSACAO_SEM_EVENTO' THEN
    RETURN QUERY
    SELECT 'TRANSACAO'::text, t.id::bigint, t.descricao, g.nome, c.nome,
           t.competencia_em::date, round(t.valor, 2)
      FROM public.transacao t
      LEFT JOIN public.planosdeconta c ON c.id = t.plano_de_conta_id
      LEFT JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
     WHERE t.competencia_em BETWEEN p_de AND p_ate
       AND upper(t.tipo::text) IN ('RECEITA', 'DESPESA')
       AND public.transacao_gera_evento_de_resultado(t.id)
       AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros e
                        WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
                          AND e.status IN ('ATIVO', 'CONVERTIDO'))
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'EXCLUSAO_NAO_REVISADA' THEN
    RETURN QUERY
    SELECT 'TRANSACAO'::text, t.id::bigint, t.descricao, g.nome, c.nome,
           t.competencia_em::date, round(t.valor, 2)
      FROM public.dre_mapeamento m
      JOIN public.planosdecontagrupos g ON g.id = m.origem_id
      JOIN public.planosdeconta c ON c.grupo_id = g.id
      JOIN public.transacao t ON t.plano_de_conta_id = c.id
       AND t.competencia_em BETWEEN p_de AND p_ate
     WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.exclui_do_resultado
       AND m.observacao ILIKE '%sugestao automatica%'
       AND g.classificacao_padrao_id IS NULL
       AND c.classificacao_especifica_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r
                        WHERE r.grupo_id = g.id OR r.conta_id = c.id)
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSE
    RAISE EXCEPTION 'Motivo de pendencia desconhecido: %.', p_motivo USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 14) Acesso
-- ---------------------------------------------------------------------------
-- As funcoes substituidas mantem os grants que ja tinham. As novas nascem com
-- EXECUTE para PUBLIC, e financeiro nao pode ficar aberto a anon.

REVOKE ALL ON FUNCTION public.plano_contas_inicio_do_historico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_destino_do_cadastro(integer, integer, date, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_refazer_lancamentos(integer, integer, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.plano_contas_inicio_do_historico() TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_destino_do_cadastro(integer, integer, date, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_refazer_lancamentos(integer, integer, date) TO service_role;

COMMIT;
