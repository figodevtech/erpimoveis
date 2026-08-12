-- Busca e paginacao do historico de estoque.
--
-- A tela de historico lia as listas cruas (razao de produtos, entradas e saidas
-- de uso/consumo), trazia um lote grande e filtrava tudo no navegador: a busca
-- so enxergava o que ja tinha sido baixado e a paginacao mentia sobre o total.
--
-- Estas duas visoes achatam o que a tela precisa filtrar — status derivado,
-- marca de nota fiscal e um texto unico de busca — para que a consulta aconteca
-- no banco, com contagem exata e uma pagina por vez. Nada aqui altera saldo nem
-- escreve: e leitura.
--
-- A coluna `busca` e calculada por linha (nao ha indice possivel sobre ela).
-- Enquanto o volume for o de uma oficina isso e varredura barata; se um dia
-- pesar, o caminho e materializar `busca` na tabela com trigger + indice trgm.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Razao de produtos
--
-- Status da linha: um estorno e sempre cancelamento, e um documento cancelado
-- derruba o registro original junto. Mesma regra que a tela aplicava a mao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.estoque_movimento_historico AS
SELECT
  m.id,
  m.created_at,
  m.produto_id,
  m.sentido,
  m.origem,
  m.acao,
  m.quantidade,
  m.saldo_anterior,
  m.saldo_resultante,
  m.entrada_id,
  m.saida_id,
  m.venda_id,
  m.ordemservicoid,
  m.documento_label,
  m.observacao,
  m.reconstruido,
  m.created_by,

  p.titulo AS produto_titulo,
  p.referencia AS produto_referencia,
  p.unidade AS produto_unidade,

  e.status AS entrada_status,
  e.origem AS entrada_origem,
  e.fiscal AS entrada_fiscal,
  e.numero_nota AS entrada_numero_nota,
  f.nomerazaosocial AS fornecedor_nome,

  s.status AS saida_status,
  s.motivo AS saida_motivo,
  s.observacao AS saida_observacao,

  u.nome AS criador_nome,

  CASE
    WHEN m.acao = 'ESTORNO' THEN 'CANCELADA'
    WHEN coalesce(e.status::text, s.status) = 'CANCELADA' THEN 'CANCELADA'
    ELSE 'CONFIRMADA'
  END AS status,

  (
    coalesce(e.fiscal, false)
    OR nullif(btrim(coalesce(e.numero_nota, '')), '') IS NOT NULL
    OR coalesce(e.origem IN ('MANUAL_COM_NF', 'XML', 'NFE_TERCEIRO'), false)
  ) AS fiscal,

  lower(concat_ws(' ',
    m.id::text,
    m.documento_label,
    m.observacao,
    p.titulo,
    p.referencia,
    e.numero_nota,
    f.nomerazaosocial,
    replace(coalesce(s.motivo, ''), '_', ' '),
    s.observacao,
    u.nome,
    m.venda_id::text,
    m.ordemservicoid::text,
    replace(m.origem, '_', ' '),
    CASE WHEN m.acao = 'ESTORNO' THEN 'estorno' END,
    CASE
      WHEN m.acao = 'ESTORNO' OR coalesce(e.status::text, s.status) = 'CANCELADA'
      THEN 'cancelada'
      ELSE 'confirmada'
    END,
    CASE
      WHEN coalesce(e.fiscal, false) OR e.numero_nota IS NOT NULL
      THEN 'nf-e nota fiscal'
    END
  )) AS busca

FROM public.estoque_movimento m
LEFT JOIN public.produto p ON p.id = m.produto_id
LEFT JOIN public.entrada e ON e.id = m.entrada_id
LEFT JOIN public.fornecedor f ON f.id = e.fornecedorid
LEFT JOIN public.estoque_saida s ON s.id = m.saida_id
LEFT JOIN public.usuario u ON u.id = m.created_by;

COMMENT ON VIEW public.estoque_movimento_historico IS
  'Razao de estoque de produtos achatado para a tela de historico: status derivado, marca fiscal e texto de busca.';

ALTER VIEW public.estoque_movimento_historico OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2) Uso e consumo
--
-- Entrada e saida moram em tabelas separadas, e a tela precisa das duas na
-- mesma linha do tempo. Antes isso era feito no navegador — baixava-se um lote
-- de cada lado e concatenava, o que quebra qualquer paginacao honesta. A uniao
-- aqui devolve um fluxo unico, ordenavel e contavel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.usoconsumo_movimento_historico AS
SELECT
  'entrada'::text AS sentido,
  e.id,
  e.created_at,
  e.status,
  e.valor_total,
  e.numero_nota,
  e.tipo,
  e.origem,
  NULL::text AS motivo,
  e.observacao,
  f.nomerazaosocial AS parte,
  (
    coalesce(e.fiscal, false)
    OR nullif(btrim(coalesce(e.numero_nota, '')), '') IS NOT NULL
    OR e.origem = 'NFE_TERCEIRO'
  ) AS fiscal,
  itens.resumo AS itens_resumo,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    e.id::text,
    e.numero_nota,
    f.nomerazaosocial,
    replace(e.tipo, '_', ' '),
    e.observacao,
    itens.resumo,
    u.nome,
    'entrada',
    e.status,
    CASE
      WHEN coalesce(e.fiscal, false) OR e.numero_nota IS NOT NULL
      THEN 'nf-e nota fiscal'
    END
  )) AS busca
FROM public.usoconsumo_entrada e
LEFT JOIN public.fornecedor f ON f.id = e.fornecedor_id
LEFT JOIN public.usuario u ON u.id = e.created_by
LEFT JOIN LATERAL (
  SELECT string_agg(
           coalesce(nullif(btrim(coalesce(ei.titulo, '')), ''), i.titulo, 'Item')
             || ' (' || ei.quantidade || ' ' || ei.unidade::text || ')',
           ', ' ORDER BY ei.id
         ) AS resumo
  FROM public.usoconsumo_entrada_item ei
  LEFT JOIN public.usoconsumo_item i ON i.id = ei.item_id
  WHERE ei.entrada_id = e.id
) itens ON true

UNION ALL

SELECT
  'saida'::text AS sentido,
  s.id,
  s.created_at,
  s.status,
  NULL::numeric AS valor_total,
  NULL::text AS numero_nota,
  NULL::text AS tipo,
  NULL::text AS origem,
  s.motivo,
  s.observacao,
  coalesce(nullif(btrim(coalesce(s.funcionario, '')), ''),
           nullif(btrim(coalesce(s.setor, '')), ''),
           cc.nome) AS parte,
  false AS fiscal,
  itens.resumo AS itens_resumo,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    s.id::text,
    replace(s.motivo, '_', ' '),
    s.observacao,
    s.funcionario,
    s.setor,
    cc.nome,
    itens.resumo,
    u.nome,
    'saida',
    s.status
  )) AS busca
FROM public.usoconsumo_saida s
LEFT JOIN public.centrosdecusto cc ON cc.id = s.centro_custo_id
LEFT JOIN public.usuario u ON u.id = s.created_by
LEFT JOIN LATERAL (
  SELECT string_agg(
           coalesce(i.titulo, 'Item') || ' (' || si.quantidade || ' ' || i.unidade::text || ')',
           ', ' ORDER BY si.id
         ) AS resumo
  FROM public.usoconsumo_saida_item si
  LEFT JOIN public.usoconsumo_item i ON i.id = si.item_id
  WHERE si.saida_id = s.id
) itens ON true;

COMMENT ON VIEW public.usoconsumo_movimento_historico IS
  'Entradas e saidas de uso e consumo em uma linha do tempo unica, com resumo de itens e texto de busca.';

ALTER VIEW public.usoconsumo_movimento_historico OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 3) Acesso
--
-- Mesma politica das tabelas de origem: nada exposto a anon/authenticated,
-- leitura apenas pelo servidor.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.estoque_movimento_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.estoque_movimento_historico TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_historico TO service_role;

COMMIT;

-- O PostgREST so enxerga a visao depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';
