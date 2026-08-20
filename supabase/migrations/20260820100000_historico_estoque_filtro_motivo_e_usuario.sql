-- Busca e filtro do historico de estoque por motivo e por usuario.
--
-- O texto de `busca` das duas visoes nasceu cobrindo o que a saida tem — motivo
-- e observacao — e deixou a entrada de fora: quem procurava "devolucao" ou
-- "garantia" nao achava a entrada correspondente, porque `entrada.tipo` (o
-- motivo da entrada, cadastrado em Configuracoes > Tipos) nunca entrou na
-- concatenacao. Aqui o codigo e o nome do tipo entram, junto com a observacao
-- da entrada e o nome legivel do motivo da saida — assim "Ajuste de inventario"
-- acha a linha de quem digita com acento, e nao so a de quem digita o codigo.
--
-- As mesmas colunas ficam expostas soltas (`entrada_tipo`, `saida_motivo`,
-- `created_by`) para virarem filtro exato na tela, sem depender de LIKE.
--
-- As visoes sao recriadas do zero porque `CREATE OR REPLACE VIEW` so acrescenta
-- coluna no fim, e a visao financeira consome `historico.*` — que foi expandido
-- no momento em que ela foi criada e nao enxerga coluna nova sozinha.

BEGIN;

DROP VIEW IF EXISTS public.estoque_movimento_financeiro_historico;
DROP VIEW IF EXISTS public.estoque_movimento_historico;
DROP VIEW IF EXISTS public.usoconsumo_movimento_financeiro_historico;
DROP VIEW IF EXISTS public.usoconsumo_movimento_historico;

-- ---------------------------------------------------------------------------
-- 1) Razao de produtos
-- ---------------------------------------------------------------------------

CREATE VIEW public.estoque_movimento_historico AS
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
  e.tipo AS entrada_tipo,
  te.nome AS entrada_tipo_nome,
  e.observacao AS entrada_observacao,
  f.nomerazaosocial AS fornecedor_nome,

  s.status AS saida_status,
  s.motivo AS saida_motivo,
  tms.nome AS saida_motivo_nome,
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
    replace(coalesce(e.tipo, ''), '_', ' '),
    te.nome,
    e.observacao,
    replace(coalesce(s.motivo, ''), '_', ' '),
    tms.nome,
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
LEFT JOIN public.tipos_entrada te ON te.codigo = e.tipo
LEFT JOIN public.fornecedor f ON f.id = e.fornecedorid
LEFT JOIN public.estoque_saida s ON s.id = m.saida_id
LEFT JOIN public.tipos_motivo_saida tms ON tms.codigo = s.motivo
LEFT JOIN public.usuario u ON u.id = m.created_by;

COMMENT ON VIEW public.estoque_movimento_historico IS
  'Razao de estoque de produtos achatado para a tela de historico: status derivado, marca fiscal, motivo da entrada e da saida e texto de busca.';

ALTER VIEW public.estoque_movimento_historico OWNER TO postgres;

CREATE VIEW public.estoque_movimento_financeiro_historico AS
SELECT
  historico.*,
  CASE
    WHEN historico.origem = 'ENTRADA'
     AND historico.acao = 'REGISTRO'
     AND historico.entrada_id IS NOT NULL
    THEN EXISTS (
      SELECT 1
        FROM public.transacao transacao
       WHERE transacao.entrada_id = historico.entrada_id
         AND transacao.is_deleted = false
    )
    ELSE NULL
  END AS financeiro_lancado
FROM public.estoque_movimento_historico historico;

COMMENT ON VIEW public.estoque_movimento_financeiro_historico IS
  'Historico de produtos acrescido do indicador de lancamento financeiro ativo da entrada.';

ALTER VIEW public.estoque_movimento_financeiro_historico OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2) Uso e consumo
-- ---------------------------------------------------------------------------

CREATE VIEW public.usoconsumo_movimento_historico AS
SELECT
  'entrada'::text AS sentido,
  e.id,
  e.created_at,
  e.status,
  e.valor_total,
  e.numero_nota,
  e.tipo,
  te.nome AS tipo_nome,
  e.origem,
  NULL::text AS motivo,
  NULL::text AS motivo_nome,
  e.observacao,
  f.nomerazaosocial AS parte,
  (
    coalesce(e.fiscal, false)
    OR nullif(btrim(coalesce(e.numero_nota, '')), '') IS NOT NULL
    OR e.origem = 'NFE_TERCEIRO'
  ) AS fiscal,
  itens.resumo AS itens_resumo,
  e.created_by,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    e.id::text,
    e.numero_nota,
    f.nomerazaosocial,
    replace(coalesce(e.tipo, ''), '_', ' '),
    te.nome,
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
LEFT JOIN public.tipos_entrada te ON te.codigo = e.tipo
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
  NULL::text AS tipo_nome,
  NULL::text AS origem,
  s.motivo,
  tms.nome AS motivo_nome,
  s.observacao,
  coalesce(nullif(btrim(coalesce(s.funcionario, '')), ''),
           nullif(btrim(coalesce(s.setor, '')), ''),
           cc.nome) AS parte,
  false AS fiscal,
  itens.resumo AS itens_resumo,
  s.created_by,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    s.id::text,
    replace(coalesce(s.motivo, ''), '_', ' '),
    tms.nome,
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
LEFT JOIN public.tipos_motivo_saida tms ON tms.codigo = s.motivo
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
  'Entradas e saidas de uso e consumo em uma linha do tempo unica, com resumo de itens, autor e texto de busca.';

ALTER VIEW public.usoconsumo_movimento_historico OWNER TO postgres;

CREATE VIEW public.usoconsumo_movimento_financeiro_historico AS
SELECT
  historico.*,
  CASE
    WHEN historico.sentido = 'entrada'
    THEN EXISTS (
      SELECT 1
        FROM public.transacao transacao
       WHERE transacao.usoconsumo_entrada_id = historico.id
         AND transacao.is_deleted = false
    )
    ELSE NULL
  END AS financeiro_lancado
FROM public.usoconsumo_movimento_historico historico;

COMMENT ON VIEW public.usoconsumo_movimento_financeiro_historico IS
  'Historico de uso e consumo acrescido do indicador de lancamento financeiro ativo da entrada.';

ALTER VIEW public.usoconsumo_movimento_financeiro_historico OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 3) Autores que aparecem no historico
--
-- A tela precisa montar o seletor de usuario sem varrer o razao inteiro e sem
-- pedir a lista completa de usuarios do sistema, que exige outra permissao.
-- Estas visoes devolvem so quem de fato assinou movimento, e o DISTINCT
-- acontece no banco.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.estoque_movimento_autor AS
SELECT u.id, u.nome
FROM public.usuario u
WHERE EXISTS (
  SELECT 1 FROM public.estoque_movimento m WHERE m.created_by = u.id
);

COMMENT ON VIEW public.estoque_movimento_autor IS
  'Usuarios com pelo menos um movimento no razao de produtos.';

ALTER VIEW public.estoque_movimento_autor OWNER TO postgres;

CREATE OR REPLACE VIEW public.usoconsumo_movimento_autor AS
SELECT u.id, u.nome
FROM public.usuario u
WHERE EXISTS (
  SELECT 1 FROM public.usoconsumo_entrada e WHERE e.created_by = u.id
) OR EXISTS (
  SELECT 1 FROM public.usoconsumo_saida s WHERE s.created_by = u.id
);

COMMENT ON VIEW public.usoconsumo_movimento_autor IS
  'Usuarios com pelo menos uma entrada ou saida de uso e consumo.';

ALTER VIEW public.usoconsumo_movimento_autor OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 4) Acesso: mesma politica das visoes que estas substituem.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.estoque_movimento_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.estoque_movimento_historico TO service_role;

REVOKE ALL ON public.estoque_movimento_financeiro_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.estoque_movimento_financeiro_historico TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_historico TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_financeiro_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_financeiro_historico TO service_role;

REVOKE ALL ON public.estoque_movimento_autor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.estoque_movimento_autor TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_autor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_autor TO service_role;

COMMIT;

-- O PostgREST so enxerga a mudanca depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';
