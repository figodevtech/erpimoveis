-- Fase 4 do plano de contas dinamico: pendencias, simulacao e migracao.
--
-- O QUE ESTA MIGRATION FAZ
-- Cria a fila de integridade (com quantidade E valor), o lote de migracao
-- persistido, a aplicacao idempotente por unidade e a instalacao das contas
-- padrao do catalogo.
--
-- O QUE ELA NAO FAZ
-- Nao classifica nada sozinha. Criar o lote e simulacao; aplicar exige uma
-- chamada separada, e cada unidade so e aplicada se o cadastro nao tiver mudado
-- desde a simulacao.
--
-- POR QUE QUANTIDADE E VALOR
-- "12 lancamentos sem classificacao" nao diz se o problema vale R$ 300 ou
-- R$ 300.000. A decisao de resolver agora ou depois depende do valor, e uma fila
-- que so conta itens empurra o julgamento para quem nao tem o dado.
--
-- POR QUE A FILA NAO PODE DEVOLVER ZERO EM CASO DE FALHA
-- Uma consulta que falha e devolve lista vazia faz a tela dizer "sem
-- pendencias". Aqui cada motivo e uma linha propria: se a consulta inteira
-- falhar, a rota devolve erro, e nao um zero tranquilizador.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fila de integridade
-- ---------------------------------------------------------------------------

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
         'Grupo ativo sem classificacao: as contas dele nao tem para onde ir.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdecontagrupos g
   WHERE g.ativo
     AND g.classificacao_padrao_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.dre_mapeamento m
        WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.origem_id = g.id)
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'CONTA_SEM_REGRA'::text,
         'Conta ativa sem classificacao propria nem herdada.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdeconta c
    JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
   WHERE c.ativo AND g.ativo
     AND (SELECT r.classificacao_id
            FROM public.dre_classificacao_do_cadastro(c.id, g.id, current_date) r) IS NULL
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
  -- Competencia ausente e diferente de sem destino: o lancamento existe e nao
  -- tem periodo, entao nao aparece em nenhuma DRE, de nenhum mes.
  SELECT 'EVENTO_SEM_COMPETENCIA'::text,
         'Lancamento sem competencia: nao pertence a nenhum periodo.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
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
  -- chega ao resultado.
  SELECT 'TRANSACAO_SEM_EVENTO'::text,
         'Transacao de resultado no periodo que nao gerou lancamento na DRE.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(t.valor), 0), 2)
    FROM public.transacao t
   WHERE t.competencia_em BETWEEN p_de AND p_ate
     AND upper(t.tipo::text) IN ('RECEITA', 'DESPESA')
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros e
        WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
          AND e.status IN ('ATIVO', 'CONVERTIDO'))
  HAVING count(*) > 0;

  RETURN QUERY
  -- Exclusao que ninguem revisou. O mapeamento inicial foi sugerido por palavra
  -- no nome do grupo; enquanto a observacao original continuar la, a exclusao e
  -- um palpite de migracao, nao uma decisao.
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
  HAVING count(t.id) > 0;
END;
$function$;

COMMENT ON FUNCTION public.dre_pendencias(timestamptz, timestamptz) IS
  'Fila de integridade da DRE, com quantidade e valor por motivo. Escopo CADASTRO nao depende do periodo; PERIODO e GERAL dependem.';

/** Itens de um motivo, para a tela poder resolver um a um. */
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
     WHERE g.ativo AND g.classificacao_padrao_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.dre_mapeamento m
                        WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.origem_id = g.id)
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
       AND (SELECT r.classificacao_id
              FROM public.dre_classificacao_do_cadastro(c.id, g.id, current_date) r) IS NULL
     ORDER BY g.codigo, c.codigo
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo IN ('EVENTO_SEM_LINHA', 'NATUREZA_INCOMPATIVEL', 'EVENTO_SEM_COMPETENCIA') THEN
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
             WHEN 'EVENTO_SEM_COMPETENCIA' THEN e.competencia_em IS NULL
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
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSE
    RAISE EXCEPTION 'Motivo de pendencia desconhecido: %.', p_motivo USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Lote de migracao
-- ---------------------------------------------------------------------------
-- A proposta e gravada antes de ser aplicada, com a versao de cada cadastro no
-- momento da simulacao. Se alguem editar o cadastro entre a simulacao e a
-- aplicacao, aquela unidade fica em CONFLITO e nao e aplicada — em vez de
-- sobrescrever uma decisao mais recente com uma proposta velha.

CREATE TABLE IF NOT EXISTS public.plano_contas_lote (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referencia       text NOT NULL,
  estado           text NOT NULL DEFAULT 'SIMULADO',
  vigencia_inicio  date NOT NULL,
  versao_catalogo  integer NOT NULL,
  observacao       text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  aplicado_em      timestamptz,
  aplicado_por     uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT plano_contas_lote_referencia_key UNIQUE (referencia),
  CONSTRAINT plano_contas_lote_estado_check
    CHECK (estado IN ('SIMULADO', 'APLICADO', 'CANCELADO'))
);

COMMENT ON TABLE public.plano_contas_lote IS
  'Proposta de classificacao gravada antes de aplicar. `referencia` e a chave idempotente: reenviar a mesma simulacao nao cria um lote novo.';

CREATE TABLE IF NOT EXISTS public.plano_contas_lote_item (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id               integer NOT NULL REFERENCES public.plano_contas_lote(id) ON DELETE CASCADE,
  entidade              text NOT NULL,
  entidade_id           integer NOT NULL,
  classificacao_id      integer REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT,
  classificacao_anterior_id integer REFERENCES public.classificacoes_resultado(id) ON DELETE SET NULL,
  versao_esperada       integer NOT NULL,
  certeza               text NOT NULL,
  justificativa         text,
  destino_atual         text,
  destino_proposto      text,
  estado                text NOT NULL DEFAULT 'PENDENTE',
  motivo                text,
  aplicado_em           timestamptz,
  CONSTRAINT plano_contas_lote_item_entidade_check CHECK (entidade IN ('GRUPO', 'CONTA')),
  CONSTRAINT plano_contas_lote_item_estado_check
    CHECK (estado IN ('PENDENTE', 'APLICADO', 'CONFLITO', 'IGNORADO', 'ERRO')),
  CONSTRAINT plano_contas_lote_item_certeza_check
    CHECK (certeza IN ('ALTA', 'MEDIA', 'BAIXA', 'NENHUMA')),
  CONSTRAINT plano_contas_lote_item_unico UNIQUE (lote_id, entidade, entidade_id)
);

CREATE INDEX IF NOT EXISTS plano_contas_lote_item_lote_idx
  ON public.plano_contas_lote_item (lote_id, estado);

/**
 * Aplica o lote, uma unidade por vez.
 *
 * Idempotente: item ja APLICADO e pulado. Retomavel: `p_limite` processa um
 * pedaco e a chamada seguinte continua de onde parou. Nunca marca o lote como
 * aplicado enquanto sobrar unidade PENDENTE.
 */
CREATE OR REPLACE FUNCTION public.plano_contas_aplicar_lote(
  p_lote_id integer,
  p_usuario uuid DEFAULT NULL,
  p_limite integer DEFAULT 500
)
RETURNS TABLE (aplicados integer, conflitos integer, erros integer, restantes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lote   public.plano_contas_lote%rowtype;
  v_item   record;
  v_versao integer;
  v_atual  integer;
  v_aplicados integer := 0;
  v_conflitos integer := 0;
  v_erros integer := 0;
  v_restantes integer;
BEGIN
  SELECT * INTO v_lote FROM public.plano_contas_lote WHERE id = p_lote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote % nao encontrado.', p_lote_id USING ERRCODE = 'P0002';
  END IF;
  IF v_lote.estado = 'CANCELADO' THEN
    RAISE EXCEPTION 'Lote % esta cancelado.', p_lote_id USING ERRCODE = 'PT422';
  END IF;

  FOR v_item IN
    SELECT * FROM public.plano_contas_lote_item
     WHERE lote_id = p_lote_id AND estado = 'PENDENTE'
     ORDER BY id
     LIMIT greatest(coalesce(p_limite, 500), 1)
  LOOP
    IF v_item.entidade = 'GRUPO' THEN
      SELECT versao_registro, classificacao_padrao_id INTO v_versao, v_atual
        FROM public.planosdecontagrupos WHERE id = v_item.entidade_id;
    ELSE
      SELECT versao_registro, classificacao_especifica_id INTO v_versao, v_atual
        FROM public.planosdeconta WHERE id = v_item.entidade_id;
    END IF;

    IF v_versao IS NULL THEN
      UPDATE public.plano_contas_lote_item
         SET estado = 'CONFLITO', motivo = 'Cadastro nao existe mais.'
       WHERE id = v_item.id;
      v_conflitos := v_conflitos + 1;
      CONTINUE;
    END IF;

    IF v_versao <> v_item.versao_esperada THEN
      UPDATE public.plano_contas_lote_item
         SET estado = 'CONFLITO',
             motivo = format('Cadastro alterado depois da simulacao (versao %s, esperada %s).',
                             v_versao, v_item.versao_esperada)
       WHERE id = v_item.id;
      v_conflitos := v_conflitos + 1;
      CONTINUE;
    END IF;

    BEGIN
      IF v_item.entidade = 'GRUPO' THEN
        PERFORM public.plano_contas_salvar_grupo(
          v_item.entidade_id,
          (SELECT codigo FROM public.planosdecontagrupos WHERE id = v_item.entidade_id),
          (SELECT nome FROM public.planosdecontagrupos WHERE id = v_item.entidade_id),
          (SELECT descricao FROM public.planosdecontagrupos WHERE id = v_item.entidade_id),
          NULL, v_item.classificacao_id, v_item.versao_esperada,
          v_lote.vigencia_inicio, p_usuario, v_item.justificativa, 'MIGRACAO');
      ELSE
        PERFORM public.plano_contas_salvar_conta(
          v_item.entidade_id,
          (SELECT codigo FROM public.planosdeconta WHERE id = v_item.entidade_id),
          (SELECT nome FROM public.planosdeconta WHERE id = v_item.entidade_id),
          (SELECT descricao FROM public.planosdeconta WHERE id = v_item.entidade_id),
          NULL,
          (SELECT grupo_id FROM public.planosdeconta WHERE id = v_item.entidade_id),
          v_item.classificacao_id, v_item.versao_esperada,
          v_lote.vigencia_inicio, p_usuario, v_item.justificativa, 'MIGRACAO');
      END IF;

      UPDATE public.plano_contas_lote_item
         SET estado = 'APLICADO',
             classificacao_anterior_id = v_atual,
             aplicado_em = now(),
             motivo = NULL
       WHERE id = v_item.id;
      v_aplicados := v_aplicados + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Uma unidade que falha nao derruba o lote: ela fica marcada com o erro e
      -- as outras seguem. Sem isso, um cadastro estranho impediria a migracao
      -- inteira e ninguem saberia qual era.
      UPDATE public.plano_contas_lote_item
         SET estado = 'ERRO', motivo = left(SQLERRM, 500)
       WHERE id = v_item.id;
      v_erros := v_erros + 1;
    END;
  END LOOP;

  SELECT count(*) INTO v_restantes
    FROM public.plano_contas_lote_item WHERE lote_id = p_lote_id AND estado = 'PENDENTE';

  IF v_restantes = 0 THEN
    UPDATE public.plano_contas_lote
       SET estado = 'APLICADO', aplicado_em = now(), aplicado_por = p_usuario
     WHERE id = p_lote_id;
  END IF;

  RETURN QUERY SELECT v_aplicados, v_conflitos, v_erros, v_restantes;
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_aplicar_lote(integer, uuid, integer) IS
  'Aplica o lote por unidades, idempotente e retomavel. Cadastro alterado desde a simulacao vira CONFLITO e nao e sobrescrito. O lote so fica APLICADO quando nao sobra unidade pendente.';

-- ---------------------------------------------------------------------------
-- 3) Instalacao das contas padrao
-- ---------------------------------------------------------------------------
-- Recebe o catalogo do repositorio como JSON. A definicao mora em
-- `src/lib/financeiro/plano-contas/catalogo.ts`, versionada junto do codigo;
-- repetir a lista aqui criaria duas fontes que divergiriam na primeira revisao.
--
-- Nunca sobrescreve cadastro existente. Se ja existe grupo ou conta com o mesmo
-- nome, o padrao NAO e vinculado por nome: fica de fora e aparece no retorno,
-- para revisao humana. Colisao de codigo visual resolve-se com um codigo livre.

CREATE OR REPLACE FUNCTION public.plano_contas_instalar_padrao(
  p_definicao jsonb,
  p_vigencia_inicio date DEFAULT NULL,
  p_apenas_base boolean DEFAULT true,
  p_usuario uuid DEFAULT NULL
)
RETURNS TABLE (
  entidade text,
  codigo_sistema text,
  acao text,
  detalhe text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo jsonb;
  v_conta jsonb;
  v_classificacao integer;
  v_id integer;
  v_codigo text;
  v_sufixo integer;
  v_vigencia date := coalesce(p_vigencia_inicio, current_date);
BEGIN
  FOR v_grupo IN SELECT * FROM jsonb_array_elements(p_definicao -> 'grupos')
  LOOP
    SELECT g.id INTO v_id FROM public.planosdecontagrupos g
     WHERE g.codigo_sistema = v_grupo ->> 'codigo';

    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT 'GRUPO'::text, v_grupo ->> 'codigo', 'JA_INSTALADO'::text, NULL::text;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.planosdecontagrupos g
                WHERE upper(btrim(g.nome)) = upper(btrim(v_grupo ->> 'nome'))) THEN
      RETURN QUERY SELECT 'GRUPO'::text, v_grupo ->> 'codigo', 'COLISAO_NOME'::text,
        format('Ja existe um grupo chamado "%s". Vincular por nome nao e seguro: revise a mao.',
               v_grupo ->> 'nome');
      CONTINUE;
    END IF;

    SELECT cr.id INTO v_classificacao FROM public.classificacoes_resultado cr
     WHERE cr.codigo = v_grupo ->> 'classificacao';

    -- Codigo visual livre: o sugerido e preferencia, nao exigencia.
    v_codigo := v_grupo ->> 'codigo_sugerido';
    v_sufixo := 0;
    WHILE EXISTS (SELECT 1 FROM public.planosdecontagrupos g
                   WHERE upper(btrim(g.codigo)) = upper(btrim(v_codigo))) LOOP
      v_sufixo := v_sufixo + 1;
      v_codigo := (v_grupo ->> 'codigo_sugerido') || '-' || v_sufixo;
    END LOOP;

    INSERT INTO public.planosdecontagrupos
      (codigo, nome, descricao, ativo, classificacao_padrao_id, origem_cadastro,
       codigo_sistema, createdat, updatedat)
    VALUES (v_codigo, v_grupo ->> 'nome', NULL, true, v_classificacao, 'SISTEMA',
            v_grupo ->> 'codigo', now(), now())
    RETURNING id INTO v_id;

    PERFORM public.plano_contas_registrar_regra(
      v_id, NULL, v_classificacao, v_vigencia, 'SISTEMA', p_usuario,
      'Grupo padrao instalado pelo catalogo.');

    RETURN QUERY SELECT 'GRUPO'::text, v_grupo ->> 'codigo', 'CRIADO'::text, v_codigo;
  END LOOP;

  FOR v_conta IN SELECT * FROM jsonb_array_elements(p_definicao -> 'contas')
  LOOP
    CONTINUE WHEN p_apenas_base AND (v_conta ->> 'instalacao') <> 'BASE';

    IF EXISTS (SELECT 1 FROM public.planosdeconta c WHERE c.codigo_sistema = v_conta ->> 'codigo') THEN
      RETURN QUERY SELECT 'CONTA'::text, v_conta ->> 'codigo', 'JA_INSTALADA'::text, NULL::text;
      CONTINUE;
    END IF;

    SELECT g.id INTO v_id FROM public.planosdecontagrupos g
     WHERE g.codigo_sistema = v_conta ->> 'grupo';
    IF v_id IS NULL THEN
      RETURN QUERY SELECT 'CONTA'::text, v_conta ->> 'codigo', 'SEM_GRUPO'::text,
        format('O grupo padrao %s nao foi instalado.', v_conta ->> 'grupo');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.planosdeconta c
                WHERE c.grupo_id = v_id
                  AND upper(btrim(c.nome)) = upper(btrim(v_conta ->> 'nome'))) THEN
      RETURN QUERY SELECT 'CONTA'::text, v_conta ->> 'codigo', 'COLISAO_NOME'::text,
        format('Ja existe "%s" neste grupo.', v_conta ->> 'nome');
      CONTINUE;
    END IF;

    SELECT cr.id INTO v_classificacao FROM public.classificacoes_resultado cr
     WHERE cr.codigo = v_conta ->> 'classificacao';

    v_codigo := (SELECT g.codigo FROM public.planosdecontagrupos g WHERE g.id = v_id);
    v_sufixo := 0;
    LOOP
      v_sufixo := v_sufixo + 1;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.planosdeconta c
         WHERE upper(btrim(c.codigo)) = upper(btrim(v_codigo || '.' || v_sufixo)));
    END LOOP;

    INSERT INTO public.planosdeconta
      (codigo, nome, descricao, ativo, grupo_id, classificacao_especifica_id,
       origem_cadastro, codigo_sistema, createdat, updatedat)
    VALUES (v_codigo || '.' || v_sufixo, v_conta ->> 'nome', NULL, true, v_id,
            v_classificacao, 'SISTEMA', v_conta ->> 'codigo', now(), now());

    RETURN QUERY SELECT 'CONTA'::text, v_conta ->> 'codigo', 'CRIADA'::text,
      v_codigo || '.' || v_sufixo;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.plano_contas_instalar_padrao(jsonb, date, boolean, uuid) IS
  'Instala grupos e contas do catalogo. Idempotente por codigo_sistema. Nunca vincula por nome: colisao vira aviso para revisao humana.';

-- ---------------------------------------------------------------------------
-- 4) Acesso
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.plano_contas_lote FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.plano_contas_lote_item FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.plano_contas_lote TO service_role;
GRANT ALL ON TABLE public.plano_contas_lote_item TO service_role;

REVOKE ALL ON FUNCTION public.dre_pendencias(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_pendencias_itens(text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_aplicar_lote(integer, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plano_contas_instalar_padrao(jsonb, date, boolean, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dre_pendencias(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_pendencias_itens(text, timestamptz, timestamptz, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_aplicar_lote(integer, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.plano_contas_instalar_padrao(jsonb, date, boolean, uuid) TO service_role;

COMMIT;
