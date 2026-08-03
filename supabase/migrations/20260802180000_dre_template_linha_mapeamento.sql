-- DRE — Fase 0, passos 3 e 4: template versionado, linhas e mapeamento.
--
-- ESTRUTURA
-- `dre_template` guarda versoes do relatorio. `dre_linha` guarda a hierarquia
-- (grupo, detalhe, subtotal, formula). `dre_mapeamento` liga uma origem — conta
-- do plano, grupo do plano, categoria de transacao ou origem de evento — a uma
-- linha, com vigencia e rateio.
--
-- POR QUE VERSIONADO
-- Um periodo fechado precisa poder ser reaberto e reproduzido exatamente como
-- foi publicado. Guardar a versao do template usada e o que torna isso possivel.
--
-- POR QUE O MAPEAMENTO E DADO, NAO CODIGO
-- O plano de contas varia entre os bancos: o Demonstracao tem 15 grupos e 197
-- contas; o Demir tem 9 grupos e 94 contas, com nomes e codigos diferentes.
-- Embutir a classificacao no codigo funcionaria em um banco e quebraria nos
-- outros. Esta migracao semeia o template (igual em todos) e apenas *sugere* o
-- mapeamento a partir de palavras-chave no nome do grupo.
--
-- O que nao casar fica sem mapeamento — de proposito. Classificar automaticamente
-- o desconhecido como "outras despesas" produz um numero que parece certo e nao
-- e. Sem mapeamento, o lancamento aparece na tela de pendencias.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dre_template (
  id            serial PRIMARY KEY,
  codigo        text NOT NULL,
  nome          text NOT NULL,
  descricao     text,
  versao        integer NOT NULL DEFAULT 1,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  UNIQUE (codigo, versao)
);

COMMENT ON TABLE public.dre_template IS
  'Versoes do relatorio de DRE. Um periodo fechado guarda a versao usada, para poder ser reproduzido.';

CREATE TABLE IF NOT EXISTS public.dre_linha (
  id             serial PRIMARY KEY,
  template_id    integer NOT NULL REFERENCES public.dre_template(id) ON DELETE CASCADE,
  parent_id      integer REFERENCES public.dre_linha(id) ON DELETE CASCADE,
  codigo         text NOT NULL,
  nome           text NOT NULL,
  nivel          integer NOT NULL DEFAULT 1,
  ordem          integer NOT NULL DEFAULT 0,
  tipo           text NOT NULL DEFAULT 'DETALHE',
  natureza_dre   text,
  formula        text,
  sinal          smallint NOT NULL DEFAULT 1,
  permite_manual boolean NOT NULL DEFAULT false,
  sem_fonte      boolean NOT NULL DEFAULT false,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, codigo),
  CONSTRAINT dre_linha_tipo_check CHECK (tipo IN ('GRUPO', 'DETALHE', 'SUBTOTAL', 'FORMULA')),
  CONSTRAINT dre_linha_natureza_check
    CHECK (natureza_dre IS NULL OR natureza_dre IN ('RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA')),
  CONSTRAINT dre_linha_sinal_check CHECK (sinal IN (-1, 1)),
  CONSTRAINT dre_linha_sem_ciclo CHECK (parent_id IS NULL OR parent_id <> id)
);

COMMENT ON COLUMN public.dre_linha.sinal IS
  'Como a linha entra no total do pai: 1 soma, -1 subtrai. Deducoes e custos usam -1.';
COMMENT ON COLUMN public.dre_linha.sem_fonte IS
  'Linha sem origem automatica no sistema (depreciacao, IRPJ/CSLL). A tela avisa quando o periodo nao tem lancamento manual.';
COMMENT ON COLUMN public.dre_linha.formula IS
  'Expressao sobre codigos de outras linhas, para tipo FORMULA. Ex: "3 - 4".';

CREATE INDEX IF NOT EXISTS dre_linha_template_idx ON public.dre_linha (template_id, ordem);
CREATE INDEX IF NOT EXISTS dre_linha_parent_idx ON public.dre_linha (parent_id);

CREATE TABLE IF NOT EXISTS public.dre_mapeamento (
  id              serial PRIMARY KEY,
  template_id     integer NOT NULL REFERENCES public.dre_template(id) ON DELETE CASCADE,
  linha_id        integer REFERENCES public.dre_linha(id) ON DELETE CASCADE,
  exclui_do_resultado boolean NOT NULL DEFAULT false,
  origem_tipo     text NOT NULL,
  origem_id       bigint,
  origem_valor    text,
  centro_custo_id integer REFERENCES public.centrosdecusto(id) ON DELETE SET NULL,
  percentual      numeric(7,4) NOT NULL DEFAULT 100,
  vigencia_inicio date,
  vigencia_fim    date,
  ativo           boolean NOT NULL DEFAULT true,
  observacao      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT dre_mapeamento_origem_check
    CHECK (origem_tipo IN ('PLANO_CONTA', 'PLANO_GRUPO', 'CATEGORIA_TRANSACAO', 'EVENTO_ORIGEM')),
  CONSTRAINT dre_mapeamento_percentual_check CHECK (percentual > 0 AND percentual <= 100),
  CONSTRAINT dre_mapeamento_vigencia_check
    CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  -- Ou a origem aponta para uma linha, ou esta explicitamente fora do resultado.
  -- Nunca as duas coisas, nunca nenhuma: sem isso, "esqueceram de mapear" e
  -- "nao pertence a DRE" ficariam indistinguiveis na tela de pendencias.
  CONSTRAINT dre_mapeamento_destino_check
    CHECK ((linha_id IS NOT NULL AND NOT exclui_do_resultado)
        OR (linha_id IS NULL AND exclui_do_resultado))
);

COMMENT ON COLUMN public.dre_mapeamento.exclui_do_resultado IS
  'Origem que nao compoe resultado por natureza: aporte de socio, emprestimo, transferencia entre contas, compra de imobilizado. Mapeada de proposito, nao pendente.';

COMMENT ON TABLE public.dre_mapeamento IS
  'Liga uma origem (conta, grupo, categoria ou origem de evento) a uma linha da DRE. Uma origem pode ser rateada entre linhas, desde que a soma dos percentuais vigentes seja 100.';
COMMENT ON COLUMN public.dre_mapeamento.origem_valor IS
  'Usado quando a origem e textual em vez de id — ex.: origem de evento (SERVICO, PRODUTO, COMISSAO).';

CREATE INDEX IF NOT EXISTS dre_mapeamento_origem_idx
  ON public.dre_mapeamento (origem_tipo, origem_id, origem_valor) WHERE ativo;
CREATE INDEX IF NOT EXISTS dre_mapeamento_linha_idx ON public.dre_mapeamento (linha_id);

-- Liga o livro de lancamentos a linha da DRE.
ALTER TABLE public.eventos_financeiros
  ADD COLUMN IF NOT EXISTS dre_linha_id integer;

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_dre_linha_id_fkey;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_dre_linha_id_fkey
  FOREIGN KEY (dre_linha_id) REFERENCES public.dre_linha(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS eventos_financeiros_dre_linha_idx
  ON public.eventos_financeiros (dre_linha_id, competencia_em) WHERE status = 'ATIVO';

-- ------------------------------------------------------------- template padrao
INSERT INTO public.dre_template (codigo, nome, descricao, versao)
SELECT 'PADRAO', 'DRE Padrao', 'Estrutura inicial por regime de competencia.', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1);

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
linhas(codigo, nome, nivel, ordem, tipo, natureza_dre, sinal, formula, sem_fonte) AS (VALUES
  ('1',    'RECEITA BRUTA',                        1,  10, 'GRUPO',    NULL,      1,  NULL,              false),
  ('1.1',  'Receita de venda de produtos',         2,  11, 'DETALHE',  'RECEITA', 1,  NULL,              false),
  ('1.2',  'Receita de prestacao de servicos',     2,  12, 'DETALHE',  'RECEITA', 1,  NULL,              false),
  ('1.3',  'Outras receitas da atividade',         2,  13, 'DETALHE',  'RECEITA', 1,  NULL,              false),
  ('2',    'DEDUCOES DA RECEITA',                  1,  20, 'GRUPO',    NULL,     -1,  NULL,              false),
  ('2.1',  'Impostos sobre vendas e servicos',     2,  21, 'DETALHE',  'DEDUCAO',-1,  NULL,              false),
  ('2.2',  'Devolucoes',                           2,  22, 'DETALHE',  'DEDUCAO',-1,  NULL,              false),
  ('2.3',  'Cancelamentos',                        2,  23, 'DETALHE',  'DEDUCAO',-1,  NULL,              false),
  ('2.4',  'Abatimentos',                          2,  24, 'DETALHE',  'DEDUCAO',-1,  NULL,              false),
  ('2.5',  'Descontos incondicionais',             2,  25, 'DETALHE',  'DEDUCAO',-1,  NULL,              false),
  ('3',    'RECEITA LIQUIDA',                      1,  30, 'FORMULA',  NULL,      1,  '1 - 2',           false),
  ('4',    'CUSTOS',                               1,  40, 'GRUPO',    NULL,     -1,  NULL,              false),
  ('4.1',  'Custo das mercadorias vendidas',       2,  41, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.2',  'Custo dos produtos vendidos',          2,  42, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.3',  'Custo dos servicos prestados',         2,  43, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.4',  'Materiais aplicados',                  2,  44, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.5',  'Mao de obra direta',                   2,  45, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.6',  'Servicos terceirizados diretos',       2,  46, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('4.7',  'Outros custos diretos',                2,  47, 'DETALHE',  'CUSTO',  -1,  NULL,              false),
  ('5',    'LUCRO BRUTO',                          1,  50, 'FORMULA',  NULL,      1,  '3 - 4',           false),
  ('6',    'DESPESAS OPERACIONAIS',                1,  60, 'GRUPO',    NULL,     -1,  NULL,              false),
  ('6.1',  'Despesas comerciais',                  2,  61, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('6.2',  'Despesas administrativas',             2,  62, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('6.3',  'Despesas com pessoal',                 2,  63, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('6.4',  'Despesas de ocupacao',                 2,  64, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('6.5',  'Despesas com tecnologia',              2,  65, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('6.6',  'Outras despesas operacionais',         2,  66, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('7',    'EBITDA GERENCIAL',                     1,  70, 'FORMULA',  NULL,      1,  '5 - 6',           false),
  ('8',    'DEPRECIACAO E AMORTIZACAO',            1,  80, 'DETALHE',  'DESPESA',-1,  NULL,              true),
  ('9',    'RESULTADO OPERACIONAL',                1,  90, 'FORMULA',  NULL,      1,  '7 - 8',           false),
  ('10',   'RESULTADO FINANCEIRO',                 1, 100, 'GRUPO',    NULL,      1,  NULL,              false),
  ('10.1', 'Receitas financeiras',                 2, 101, 'DETALHE',  'RECEITA', 1,  NULL,              false),
  ('10.2', 'Despesas financeiras',                 2, 102, 'DETALHE',  'DESPESA',-1,  NULL,              false),
  ('11',   'OUTRAS RECEITAS E DESPESAS',           1, 110, 'GRUPO',    NULL,      1,  NULL,              false),
  ('12',   'RESULTADO ANTES DOS TRIBUTOS',         1, 120, 'FORMULA',  NULL,      1,  '9 + 10 + 11',     false),
  ('13',   'TRIBUTOS SOBRE O LUCRO',               1, 130, 'GRUPO',    NULL,     -1,  NULL,              true),
  ('13.1', 'IRPJ',                                 2, 131, 'DETALHE',  'DESPESA',-1,  NULL,              true),
  ('13.2', 'CSLL',                                 2, 132, 'DETALHE',  'DESPESA',-1,  NULL,              true),
  ('13.3', 'Tributos equivalentes',                2, 133, 'DETALHE',  'DESPESA',-1,  NULL,              true),
  ('14',   'RESULTADO LIQUIDO',                    1, 140, 'FORMULA',  NULL,      1,  '12 - 13',         false)
)
INSERT INTO public.dre_linha
  (template_id, codigo, nome, nivel, ordem, tipo, natureza_dre, sinal, formula, sem_fonte, permite_manual)
SELECT t.id, l.codigo, l.nome, l.nivel, l.ordem, l.tipo, l.natureza_dre, l.sinal, l.formula, l.sem_fonte, l.sem_fonte
  FROM linhas l CROSS JOIN t
 WHERE NOT EXISTS (SELECT 1 FROM public.dre_linha d WHERE d.template_id = t.id AND d.codigo = l.codigo);

-- Hierarquia: "1.1" e filha de "1".
UPDATE public.dre_linha f
   SET parent_id = p.id
  FROM public.dre_linha p
 WHERE f.template_id = p.template_id
   AND f.parent_id IS NULL
   AND position('.' in f.codigo) > 0
   AND p.codigo = split_part(f.codigo, '.', 1);

-- --------------------------------------------------- mapeamento sugerido
-- Casa grupos do plano de contas por palavra-chave. O que nao casar fica sem
-- mapeamento e aparece como pendencia — nunca vira "outras despesas".
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
regras(padrao, linha_codigo) AS (VALUES
  ('receita%financeir%',        '10.1'),
  ('%financeir%',               '10.2'),
  ('receita%',                  '1.2'),
  ('custo%',                    '4.3'),
  ('pessoal%',                  '6.3'),
  ('deduc%',                    '2.1'),
  ('imposto%',                  '2.1'),
  ('tributo%',                  '2.1'),
  ('despesa%administrativ%',    '6.2'),
  ('despesa%comercial%',        '6.1'),
  ('despesa%operacion%',        '6.6'),
  ('veiculo%',                  '6.6'),
  ('oficina%',                  '6.4')
)
INSERT INTO public.dre_mapeamento (template_id, linha_id, origem_tipo, origem_id, percentual, observacao)
SELECT t.id, dl.id, 'PLANO_GRUPO', g.id, 100, 'Sugestao automatica por nome do grupo — revisar com o contador.'
  FROM public.planosdecontagrupos g
  CROSS JOIN t
  -- translate() em vez de unaccent(): a extensao nao esta instalada nos bancos
  -- e habilita-la aqui exigiria privilegio que a migration nao deve assumir.
  JOIN LATERAL (
    SELECT r.linha_codigo FROM regras r
     WHERE translate(lower(g.nome), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') LIKE r.padrao
     ORDER BY length(r.padrao) DESC LIMIT 1
  ) m ON true
  JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = m.linha_codigo
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'PLANO_GRUPO' AND x.origem_id = g.id
 );

-- Grupos que nao compoem resultado por natureza. Marcados explicitamente para
-- nao ficarem eternamente na tela de pendencias.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
fora(padrao) AS (VALUES
  ('%investiment%'), ('%imobilizado%'), ('%nao operacion%'),
  ('%emprestimo%'), ('%socio%'), ('%transferenc%')
)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, exclui_do_resultado, origem_tipo, origem_id, percentual, observacao)
SELECT t.id, NULL, true, 'PLANO_GRUPO', g.id, 100,
       'Nao compoe resultado: movimentacao patrimonial ou de caixa. Sugestao automatica — revisar.'
  FROM public.planosdecontagrupos g CROSS JOIN t
 WHERE EXISTS (
   SELECT 1 FROM fora f
    WHERE translate(lower(g.nome), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') LIKE f.padrao
 )
   AND NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'PLANO_GRUPO' AND x.origem_id = g.id
 );

-- Origens de evento de OS: ja sabemos o que cada uma significa.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
regras(origem, natureza, linha_codigo) AS (VALUES
  ('SERVICO',  'RECEITA', '1.2'),
  ('PRODUTO',  'RECEITA', '1.1'),
  ('PRODUTO',  'DESPESA', '4.1'),
  ('COMISSAO', 'DESPESA', '4.5')
)
INSERT INTO public.dre_mapeamento (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT t.id, dl.id, 'EVENTO_ORIGEM', r.origem || ':' || r.natureza, 100,
       'Origem de evento de ordem de servico.'
  FROM regras r CROSS JOIN t
  JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = r.linha_codigo
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'EVENTO_ORIGEM'
      AND x.origem_valor = r.origem || ':' || r.natureza
 );

COMMIT;
