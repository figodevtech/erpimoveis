-- A fila de integridade da DRE passa a usar a MESMA regra que decide se uma
-- transacao gera evento.
--
-- O PROBLEMA
-- `sincronizar_eventos_financeiros_transacao` lista, desde a 20260805200000, os
-- casos em que uma transacao deliberadamente NAO gera evento: liquidacao de algo
-- ja reconhecido (OS, venda, entrada, uso e consumo), saldo de abertura
-- (ORIGEM_MIGRACAO) e conta em grupo excluido do resultado. O motivo
-- TRANSACAO_SEM_EVENTO, criado depois na 20260908130000, nao replicou nenhum
-- desses casos: so perguntava se existe evento. Toda transacao que o sistema
-- decidiu manter fora do resultado passou a ser acusada como pendencia.
--
-- No Demir isso significava 1.024 itens e R$ 2.542.669,16 na fila, dos quais
-- 1.005 eram exatamente o comportamento desejado. Em setembro/2026, 24 de 24
-- eram ruido: parcelas de OS e venda, compras com entrada fiscal, uso e consumo,
-- carga de migracao e retirada de socios. Uma fila que acusa o correto ensina a
-- ignorar a fila.
--
-- A CORRECAO
-- A condicao vira funcao unica, `transacao_gera_evento_de_resultado`, chamada
-- pela sincronizacao E pela fila. E o mesmo principio que a 20260908110000
-- adotou para a resolucao de linha: duas copias de uma regra divergem, e quando
-- divergem nao ha como saber qual das duas esta certa.
--
-- ALEM DISSO: COMPETENCIA AUSENTE DEIXA DE SER UM BALAIO SO
-- `competencia_em` de evento de OS e carimbado com `execucao_fim_em`. Enquanto a
-- execucao nao encerra, competencia nula e estado legitimo, nao defeito — e ler
-- isso como buraco assusta a toa. No Demir, os R$ 161.907,36 de EVENTO_SEM_
-- COMPETENCIA eram R$ 161.907,36 de servico em andamento, mais cinco comissoes
-- de valor zero.
--
-- Tres motivos, entao, no lugar de um: OS em execucao (espera), evento sem
-- fonte alguma (buraco) e o resto (anomalia — OS ja encerrada cujo evento ficou
-- sem carimbo). Os tres particionam o conjunto: nenhum evento sem competencia
-- pode ficar de fora nem ser contado duas vezes, e o teste verifica isso.
--
-- E ITEM_SEM_CUSTO ENTRA NA FILA
-- "Item vendido sem custo" ja era apurado, mas como contagem avulsa na rota da
-- DRE — o unico aviso da tarja sem lista por tras. A tela dizia "6 itens" e nao
-- sabia dizer quais, entao o usuario nao tinha por onde comecar. Como motivo da
-- fila, ganha o mesmo drill-down dos outros e deixa de precisar de um caminho
-- proprio.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A regra, em um lugar so
-- ---------------------------------------------------------------------------

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
  IF v_tx.is_deleted
     OR v_tx.evento_financeiro_id IS NOT NULL
     OR v_tx.ordemservicoid IS NOT NULL
     OR v_tx.vendaid IS NOT NULL
     OR v_tx.entrada_id IS NOT NULL
     OR v_tx.usoconsumo_entrada_id IS NOT NULL
     OR v_tx.origem = 'ORIGEM_MIGRACAO' THEN
    RETURN false;
  END IF;

  -- Grupo marcado para ficar fora do resultado. O `limit 1` e o mesmo criterio
  -- da sincronizacao: mais de um mapeamento ativo por grupo ja e barrado pelo
  -- indice unico parcial.
  SELECT mp.exclui_do_resultado
    INTO v_exclui
    FROM public.planosdeconta pc
    JOIN public.dre_mapeamento mp
      ON mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = pc.grupo_id AND mp.ativo
   WHERE pc.id = v_tx.plano_de_conta_id
   LIMIT 1;

  RETURN NOT coalesce(v_exclui, false);
END;
$function$;

COMMENT ON FUNCTION public.transacao_gera_evento_de_resultado(bigint) IS
  'Verdadeiro quando a transacao deve gerar evento financeiro proprio. Regra unica, usada pela sincronizacao e pela fila de pendencias: transacao ligada a OS, venda, entrada ou uso e consumo, carga de migracao e conta em grupo excluido nao geram evento — nao sao fato novo.';

REVOKE ALL ON FUNCTION public.transacao_gera_evento_de_resultado(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transacao_gera_evento_de_resultado(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 1b) Qual OS e a fonte de um evento
-- ---------------------------------------------------------------------------
-- Um evento de OS aponta a ordem de duas maneiras, por idade do codigo:
-- `sincronizar_eventos_financeiros_os` grava `ordemservicoid` e e anterior ao
-- par source_type/source_id, que `sincronizar_eventos_financeiros_venda` ja usa.
-- Quem so olhar `source_id` conclui que 657 eventos de OS deste banco nao tem
-- fonte — e eles tem. Uma expressao unica, e nao a leitura de uma coluna so,
-- evita repetir esse engano em cada consulta nova.
CREATE OR REPLACE FUNCTION public.os_do_evento(
  p_ordemservicoid integer,
  p_source_type    text,
  p_source_id      bigint
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT coalesce(
    p_ordemservicoid::bigint,
    CASE WHEN p_source_type = 'ORDEM_SERVICO' THEN p_source_id END);
$function$;

COMMENT ON FUNCTION public.os_do_evento(integer, text, bigint) IS
  'Id da OS que originou o evento, seja pela coluna antiga (ordemservicoid) ou pelo par source_type/source_id. Sem acesso a tabela: e barata o suficiente para entrar em WHERE.';

-- ---------------------------------------------------------------------------
-- 2) A sincronizacao passa a consultar a regra em vez de repeti-la
-- ---------------------------------------------------------------------------
-- Comportamento identico ao da 20260805200000. O que muda e de onde vem a
-- decisao: os dois blocos `if` que cancelavam o evento viraram uma chamada.

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

  -- Nao e fato novo. Se ja existir evento (a transacao foi religada, ou o grupo
  -- dela passou a ser excluido do resultado), cancela o que houver e encerra.
  if not public.transacao_gera_evento_de_resultado(p_transacaoid) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  select mp.linha_id
    into v_linha_id
    from public.planosdeconta pc
    join public.dre_mapeamento mp
      on mp.origem_tipo = 'PLANO_GRUPO' and mp.origem_id = pc.grupo_id and mp.ativo
   where pc.id = v_tx.plano_de_conta_id
   limit 1;

  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

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

-- ---------------------------------------------------------------------------
-- 3) A fila
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
  'Fila de integridade da DRE, com quantidade e valor por motivo. Escopo CADASTRO nao depende do periodo; PERIODO e GERAL dependem. TRANSACAO_SEM_EVENTO usa transacao_gera_evento_de_resultado, a mesma regra da sincronizacao.';

-- ---------------------------------------------------------------------------
-- 4) Itens de cada motivo
-- ---------------------------------------------------------------------------

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
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSE
    RAISE EXCEPTION 'Motivo de pendencia desconhecido: %.', p_motivo USING ERRCODE = '22023';
  END IF;
END;
$function$;

COMMIT;
