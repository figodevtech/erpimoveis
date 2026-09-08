-- Fase 1 do plano de contas dinamico com padroes do sistema (docs/plano-execucao-plano-contas-dinamico-dre.md).
--
-- O QUE ESTA MIGRATION FAZ
-- Cria a estrutura do catalogo de classificacao de resultado, semeia o catalogo
-- e prepara o registro de implantacao. Nada mais.
--
-- O QUE ELA NAO FAZ, DE PROPOSITO
-- Nao classifica nenhum cadastro existente, nao altera mapeamento nenhum, nao
-- toca em `eventos_financeiros.dre_linha_id` e nao muda uma linha da DRE. Rodar
-- esta migration e reroda-la produz exatamente os mesmos totais de antes. A
-- classificacao dos cadastros e a ativacao sao passos posteriores, com
-- simulacao e decisao registrada por cliente.
--
-- POR QUE UM CATALOGO EM VEZ DE COPIAR NOMES ENTRE OS BANCOS
-- Os quatro bancos tem as mesmas funcoes de DRE e cadastros diferentes: 197,
-- 108, 0 e 103 contas. A classificacao hoje vem do grupo em que a conta foi
-- cadastrada, e o mapeamento inicial foi sugerido por palavra no nome do grupo.
-- Foi assim que IRPJ e CSLL, num grupo chamado "Impostos e taxas", passaram a
-- deduzir a receita. Um `codigo` semantico separa o significado (comum) do nome
-- e do id (locais).
--
-- POR QUE NADA DEPENDE DA STONE
-- A integracao Stone esta em stand-by e a migration 20260907100000 esta aplicada
-- somente na Demonstracao. Nenhum objeto criado aqui referencia campo, funcao ou
-- enum introduzido por ela.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Catalogo de classificacao
-- ---------------------------------------------------------------------------
-- `codigo` e a identidade entre bancos e nunca muda. `id` e local e nao serve
-- para comparar dois clientes.

CREATE TABLE IF NOT EXISTS public.classificacoes_resultado (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo            text NOT NULL,
  nome              text NOT NULL,
  descricao         text NOT NULL,
  familia           text NOT NULL,
  tratamento        text NOT NULL,
  -- Natureza de caixa aceita. Array porque so o patrimonial aceita as duas:
  -- aporte entra e retirada sai, com o mesmo significado.
  naturezas         text[] NOT NULL,
  -- Papel na DRE, distinto da natureza de caixa: um desconto sai do caixa
  -- (DESPESA) e deduz receita (DEDUCAO).
  papel_dre         text,
  motivo_exclusao   text,
  versao_catalogo   integer NOT NULL DEFAULT 1,
  observacao        text,
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classificacoes_resultado_codigo_key UNIQUE (codigo),
  CONSTRAINT classificacoes_resultado_familia_check CHECK (familia IN (
    'RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'FINANCEIRO',
    'OUTROS_RESULTADOS', 'TRIBUTO_LUCRO', 'PATRIMONIAL')),
  CONSTRAINT classificacoes_resultado_tratamento_check
    CHECK (tratamento IN ('RESULTADO', 'PATRIMONIAL')),
  CONSTRAINT classificacoes_resultado_papel_check
    CHECK (papel_dre IS NULL OR papel_dre IN ('RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA')),
  CONSTRAINT classificacoes_resultado_naturezas_check
    CHECK (array_length(naturezas, 1) > 0
       AND naturezas <@ ARRAY['RECEITA', 'DESPESA']::text[]),
  -- Resultado tem papel e nao tem motivo de exclusao; patrimonial e o inverso.
  -- Sem isto, "esqueceram de preencher" e "nao compoe resultado" ficariam
  -- indistinguiveis, que e o problema que este trabalho existe para resolver.
  CONSTRAINT classificacoes_resultado_coerencia_check CHECK (
    (tratamento = 'RESULTADO'   AND papel_dre IS NOT NULL AND motivo_exclusao IS NULL)
 OR (tratamento = 'PATRIMONIAL' AND papel_dre IS NULL     AND motivo_exclusao IS NOT NULL)),
  -- So o patrimonial aceita entrada e saida. Uma despesa administrativa que
  -- aceitasse RECEITA poderia somar em receita de servicos sem ninguem notar.
  CONSTRAINT classificacoes_resultado_natureza_dupla_check CHECK (
    array_length(naturezas, 1) = 1 OR tratamento = 'PATRIMONIAL')
);

COMMENT ON TABLE public.classificacoes_resultado IS
  'Significado financeiro comum aos bancos. `codigo` e a identidade estavel; nome e id sao locais. Nao guarda formula da DRE: a apresentacao continua em dre_template/dre_linha.';
COMMENT ON COLUMN public.classificacoes_resultado.naturezas IS
  'Natureza de caixa aceita (RECEITA/DESPESA). Duas naturezas so no tratamento patrimonial.';
COMMENT ON COLUMN public.classificacoes_resultado.papel_dre IS
  'Papel na DRE: RECEITA, DEDUCAO, CUSTO ou DESPESA. Diferente da natureza de caixa.';
COMMENT ON COLUMN public.classificacoes_resultado.motivo_exclusao IS
  'Por que o valor nao compoe resultado. Obrigatorio no patrimonial; proibido no resultado.';

-- ---------------------------------------------------------------------------
-- 2) Mapeamento por classificacao
-- ---------------------------------------------------------------------------
-- A origem nova aponta para uma FK de verdade. `origem_id` continua polimorfico
-- e sem FK para as origens legadas, que seguem valendo durante a transicao.

ALTER TABLE public.dre_mapeamento
  ADD COLUMN IF NOT EXISTS classificacao_resultado_id integer;

ALTER TABLE public.dre_mapeamento
  DROP CONSTRAINT IF EXISTS dre_mapeamento_classificacao_fkey;
ALTER TABLE public.dre_mapeamento
  ADD CONSTRAINT dre_mapeamento_classificacao_fkey
  FOREIGN KEY (classificacao_resultado_id)
  REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT;

ALTER TABLE public.dre_mapeamento
  DROP CONSTRAINT IF EXISTS dre_mapeamento_origem_check;
ALTER TABLE public.dre_mapeamento
  ADD CONSTRAINT dre_mapeamento_origem_check
  CHECK (origem_tipo IN ('PLANO_CONTA', 'PLANO_GRUPO', 'CATEGORIA_TRANSACAO',
                         'EVENTO_ORIGEM', 'CLASSIFICACAO_RESULTADO'));

ALTER TABLE public.dre_mapeamento
  DROP CONSTRAINT IF EXISTS dre_mapeamento_classificacao_coerencia_check;
ALTER TABLE public.dre_mapeamento
  ADD CONSTRAINT dre_mapeamento_classificacao_coerencia_check CHECK (
    (origem_tipo =  'CLASSIFICACAO_RESULTADO'
      AND classificacao_resultado_id IS NOT NULL
      AND origem_id IS NULL AND origem_valor IS NULL)
 OR (origem_tipo <> 'CLASSIFICACAO_RESULTADO'
      AND classificacao_resultado_id IS NULL));

-- Uma classificacao tem um destino vigente. Mais de um seria escolha por
-- LIMIT 1, que e o defeito que a resolucao nova precisa eliminar.
CREATE UNIQUE INDEX IF NOT EXISTS dre_mapeamento_classificacao_uk
  ON public.dre_mapeamento (template_id, classificacao_resultado_id)
  WHERE ativo AND origem_tipo = 'CLASSIFICACAO_RESULTADO';

-- ---------------------------------------------------------------------------
-- 3) Identidade e classificacao no cadastro
-- ---------------------------------------------------------------------------
-- Colunas aditivas e nulas: um cadastro existente continua exatamente como
-- esta, sem origem declarada e sem classificacao, ate a migracao da Entrega A.

ALTER TABLE public.planosdecontagrupos
  ADD COLUMN IF NOT EXISTS codigo_sistema text,
  ADD COLUMN IF NOT EXISTS origem_cadastro text NOT NULL DEFAULT 'PERSONALIZADO',
  ADD COLUMN IF NOT EXISTS classificacao_padrao_id integer,
  ADD COLUMN IF NOT EXISTS versao_registro integer NOT NULL DEFAULT 1;

ALTER TABLE public.planosdecontagrupos
  DROP CONSTRAINT IF EXISTS planosdecontagrupos_origem_check;
ALTER TABLE public.planosdecontagrupos
  ADD CONSTRAINT planosdecontagrupos_origem_check
  CHECK (origem_cadastro IN ('SISTEMA', 'PERSONALIZADO'));

ALTER TABLE public.planosdecontagrupos
  DROP CONSTRAINT IF EXISTS planosdecontagrupos_classificacao_fkey;
ALTER TABLE public.planosdecontagrupos
  ADD CONSTRAINT planosdecontagrupos_classificacao_fkey
  FOREIGN KEY (classificacao_padrao_id)
  REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS planosdecontagrupos_codigo_sistema_uk
  ON public.planosdecontagrupos (codigo_sistema)
  WHERE codigo_sistema IS NOT NULL;

ALTER TABLE public.planosdeconta
  ADD COLUMN IF NOT EXISTS codigo_sistema text,
  ADD COLUMN IF NOT EXISTS origem_cadastro text NOT NULL DEFAULT 'PERSONALIZADO',
  ADD COLUMN IF NOT EXISTS classificacao_especifica_id integer,
  ADD COLUMN IF NOT EXISTS versao_registro integer NOT NULL DEFAULT 1;

ALTER TABLE public.planosdeconta
  DROP CONSTRAINT IF EXISTS planosdeconta_origem_check;
ALTER TABLE public.planosdeconta
  ADD CONSTRAINT planosdeconta_origem_check
  CHECK (origem_cadastro IN ('SISTEMA', 'PERSONALIZADO'));

ALTER TABLE public.planosdeconta
  DROP CONSTRAINT IF EXISTS planosdeconta_classificacao_fkey;
ALTER TABLE public.planosdeconta
  ADD CONSTRAINT planosdeconta_classificacao_fkey
  FOREIGN KEY (classificacao_especifica_id)
  REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS planosdeconta_codigo_sistema_uk
  ON public.planosdeconta (codigo_sistema)
  WHERE codigo_sistema IS NOT NULL;

COMMENT ON COLUMN public.planosdeconta.classificacao_especifica_id IS
  'Excecao da conta. NULL significa herdar a classificacao padrao do grupo — e o caso comum.';
COMMENT ON COLUMN public.planosdeconta.versao_registro IS
  'Concorrencia otimista. Quem grava compara a versao lida na propria escrita.';
COMMENT ON COLUMN public.planosdeconta.codigo_sistema IS
  'Chave do catalogo quando a conta veio do sistema. Nome parecido nunca preenche esta coluna.';

-- ---------------------------------------------------------------------------
-- 4) Historico de regras por vigencia
-- ---------------------------------------------------------------------------
-- Os campos do cadastro sao a configuracao corrente; esta tabela e a fonte para
-- resolver uma competencia passada. Vigencia com inicio inclusivo e fim
-- exclusivo, para que dois intervalos consecutivos nao disputem o mesmo dia.

CREATE TABLE IF NOT EXISTS public.plano_contas_classificacao_regra (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grupo_id          integer REFERENCES public.planosdecontagrupos(id) ON DELETE CASCADE,
  conta_id          integer REFERENCES public.planosdeconta(id) ON DELETE CASCADE,
  classificacao_id  integer NOT NULL REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT,
  origem_regra      text NOT NULL DEFAULT 'MANUAL',
  vigencia_inicio   date NOT NULL,
  vigencia_fim      date,
  versao_catalogo   integer NOT NULL,
  justificativa     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  -- Exatamente uma entidade. Uma tabela de historico com id solto nao consegue
  -- provar de quem e a regra.
  CONSTRAINT plano_contas_classificacao_regra_entidade_check
    CHECK (num_nonnulls(grupo_id, conta_id) = 1),
  CONSTRAINT plano_contas_classificacao_regra_origem_check
    CHECK (origem_regra IN ('SISTEMA', 'MIGRACAO', 'MANUAL', 'RECLASSIFICACAO')),
  CONSTRAINT plano_contas_classificacao_regra_vigencia_check
    CHECK (vigencia_fim IS NULL OR vigencia_fim > vigencia_inicio)
);

COMMENT ON TABLE public.plano_contas_classificacao_regra IS
  'Historico de classificacao por grupo/conta. vigencia_inicio inclusivo, vigencia_fim exclusivo. Fonte para resolver a competencia de um fato passado.';

CREATE INDEX IF NOT EXISTS plano_contas_classificacao_regra_grupo_idx
  ON public.plano_contas_classificacao_regra (grupo_id, vigencia_inicio)
  WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plano_contas_classificacao_regra_conta_idx
  ON public.plano_contas_classificacao_regra (conta_id, vigencia_inicio)
  WHERE conta_id IS NOT NULL;

-- Sobreposicao de vigencia daria mais de uma regra valida para a mesma data, e
-- a resolucao voltaria a escolher por LIMIT 1.
--
-- Um EXCLUDE resolveria isso em uma linha, mas exige btree_gist, que nao esta
-- instalada nos bancos e cuja criacao a migration nao deve assumir. O gatilho
-- faz o mesmo com um lock por entidade: sem ele, duas transacoes simultaneas
-- leriam "nao ha conflito" e gravariam duas regras sobrepostas.
CREATE OR REPLACE FUNCTION public.tg_regra_classificacao_sem_sobreposicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_conflito integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('plano_contas_classificacao_regra'),
    coalesce(new.grupo_id, -new.conta_id));

  SELECT r.id INTO v_conflito
    FROM public.plano_contas_classificacao_regra r
   WHERE r.id IS DISTINCT FROM new.id
     AND r.grupo_id IS NOT DISTINCT FROM new.grupo_id
     AND r.conta_id IS NOT DISTINCT FROM new.conta_id
     AND daterange(r.vigencia_inicio, r.vigencia_fim, '[)')
       && daterange(new.vigencia_inicio, new.vigencia_fim, '[)')
   LIMIT 1;

  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION
      'Ja existe regra de classificacao vigente no periodo para esta entidade (regra %).', v_conflito
      USING ERRCODE = '23505';
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_regra_classificacao_sem_sobreposicao
  ON public.plano_contas_classificacao_regra;
CREATE TRIGGER trg_regra_classificacao_sem_sobreposicao
BEFORE INSERT OR UPDATE OF grupo_id, conta_id, vigencia_inicio, vigencia_fim
ON public.plano_contas_classificacao_regra
FOR EACH ROW EXECUTE FUNCTION public.tg_regra_classificacao_sem_sobreposicao();

-- ---------------------------------------------------------------------------
-- 5) Revisoes de classificacao do evento
-- ---------------------------------------------------------------------------
-- `eventos_financeiros.dre_linha_id` continua existindo e continua sendo o que
-- a DRE soma hoje. Esta tabela guarda a revisao e o porque; quando a resolucao
-- nova entrar, ela e a fonte e `dre_linha_id` passa a ser projecao mantida pela
-- mesma operacao — nunca duas classificacoes editaveis em paralelo.

CREATE TABLE IF NOT EXISTS public.eventos_financeiros_classificacao (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id            bigint NOT NULL REFERENCES public.eventos_financeiros(id) ON DELETE CASCADE,
  classificacao_id     integer REFERENCES public.classificacoes_resultado(id) ON DELETE RESTRICT,
  regra_id             integer REFERENCES public.plano_contas_classificacao_regra(id) ON DELETE SET NULL,
  conta_id             integer REFERENCES public.planosdeconta(id) ON DELETE SET NULL,
  grupo_id             integer REFERENCES public.planosdecontagrupos(id) ON DELETE SET NULL,
  template_id          integer REFERENCES public.dre_template(id) ON DELETE SET NULL,
  linha_id             integer REFERENCES public.dre_linha(id) ON DELETE SET NULL,
  resultado            text NOT NULL,
  motivo               text,
  versao_catalogo      integer NOT NULL,
  classificado_em      timestamptz NOT NULL DEFAULT now(),
  classificado_por     uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  vigente              boolean NOT NULL DEFAULT true,
  -- Revisao anterior desta mesma revisao. SET NULL e nao CASCADE: um fechamento
  -- pode referenciar uma revisao antiga, e apagar historico invalidaria uma
  -- apuracao ja publicada.
  reclassificacao_de_id bigint REFERENCES public.eventos_financeiros_classificacao(id) ON DELETE SET NULL,
  CONSTRAINT eventos_financeiros_classificacao_resultado_check
    CHECK (resultado IN ('CLASSIFICADO', 'EXCLUIDO', 'PENDENTE')),
  -- Classificado exige linha; excluido e pendente nunca tem linha. Pendente
  -- exige motivo: "sem destino" sem explicacao vira ruido na fila.
  CONSTRAINT eventos_financeiros_classificacao_coerencia_check CHECK (
    (resultado = 'CLASSIFICADO' AND linha_id IS NOT NULL AND classificacao_id IS NOT NULL)
 OR (resultado = 'EXCLUIDO'     AND linha_id IS NULL     AND classificacao_id IS NOT NULL)
 OR (resultado = 'PENDENTE'     AND linha_id IS NULL     AND motivo IS NOT NULL))
);

COMMENT ON TABLE public.eventos_financeiros_classificacao IS
  'Revisoes de classificacao de um evento. Uma vigente por evento; as anteriores ficam consultaveis e podem ser referenciadas por um fechamento.';

CREATE UNIQUE INDEX IF NOT EXISTS eventos_financeiros_classificacao_vigente_uk
  ON public.eventos_financeiros_classificacao (evento_id) WHERE vigente;
CREATE INDEX IF NOT EXISTS eventos_financeiros_classificacao_evento_idx
  ON public.eventos_financeiros_classificacao (evento_id, classificado_em DESC);
CREATE INDEX IF NOT EXISTS eventos_financeiros_classificacao_pendente_idx
  ON public.eventos_financeiros_classificacao (resultado) WHERE vigente AND resultado <> 'CLASSIFICADO';

-- ---------------------------------------------------------------------------
-- 6) Estado de implantacao
-- ---------------------------------------------------------------------------
-- Uma linha por banco. Separado da flag de faturamento de OS de proposito: sao
-- decisoes diferentes, tomadas em momentos diferentes.
--
-- Instalacao existente comeca em LEGADO. Preparar catalogo nao ativa apuracao.

CREATE TABLE IF NOT EXISTS public.dre_implantacao (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Coluna constante com unique: garante linha unica sem depender de disciplina
  -- de quem escrever a proxima migration.
  singleton             boolean NOT NULL DEFAULT true,
  estado                text NOT NULL DEFAULT 'LEGADO',
  versao_catalogo       integer,
  versao_classificador  integer,
  template_id           integer REFERENCES public.dre_template(id) ON DELETE SET NULL,
  vigencia_inicio       date,
  simulacao_ref         text,
  ativado_por           uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  ativado_em            timestamptz,
  observacao            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dre_implantacao_singleton_check CHECK (singleton),
  CONSTRAINT dre_implantacao_singleton_uk UNIQUE (singleton),
  CONSTRAINT dre_implantacao_estado_check
    CHECK (estado IN ('LEGADO', 'PREPARACAO', 'ATIVO')),
  -- ATIVO sem data de vigencia reclassificaria o passado inteiro por acidente.
  CONSTRAINT dre_implantacao_ativo_check CHECK (
    estado <> 'ATIVO'
 OR (vigencia_inicio IS NOT NULL AND versao_catalogo IS NOT NULL
     AND template_id IS NOT NULL AND ativado_em IS NOT NULL))
);

COMMENT ON TABLE public.dre_implantacao IS
  'Estado da implantacao do classificador novo neste banco. Ausencia de linha e ausencia de configuracao: nao equivale a modo legado por acidente, e sim exige leitura explicita.';

INSERT INTO public.dre_implantacao (estado, observacao)
SELECT 'LEGADO', 'Criado pela migration 20260908100000. Catalogo instalado, apuracao inalterada.'
 WHERE NOT EXISTS (SELECT 1 FROM public.dre_implantacao);

-- ---------------------------------------------------------------------------
-- 7) Linhas 11.1 e 11.2
-- ---------------------------------------------------------------------------
-- A linha 11 ("OUTRAS RECEITAS E DESPESAS") existe desde a 20260802180000 como
-- GRUPO sem filhos e sem mapeamento: hoje ela vale zero em todos os bancos.
-- Acrescentar dois filhos nao muda nenhum total enquanto ninguem classificar
-- nada neles — e o mesmo raciocinio, e o mesmo mecanismo, que a 20260828100000
-- usou para 4.8/4.9, sem versao nova de template: `dre_linha` e unica por
-- (template, codigo) e a arvore se monta por `parent_id`.
--
-- 11.1 soma e 11.2 subtrai dentro de um grupo de sinal +1, como 10.1/10.2 fazem
-- no resultado financeiro. A natureza acompanha a direcao do sinal, mantendo a
-- convencao que `checar_receitas_dre.sql` e `checar_custos_dre.sql` conferem.

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
linhas(codigo, nome, nivel, ordem, tipo, natureza_dre, sinal) AS (VALUES
  ('11.1', 'Outros ganhos', 2, 111, 'DETALHE', 'RECEITA',  1),
  ('11.2', 'Outras perdas', 2, 112, 'DETALHE', 'DESPESA', -1)
)
INSERT INTO public.dre_linha
  (template_id, codigo, nome, nivel, ordem, tipo, natureza_dre, sinal, sem_fonte, permite_manual)
SELECT t.id, l.codigo, l.nome, l.nivel, l.ordem, l.tipo, l.natureza_dre, l.sinal, true, true
  FROM linhas l CROSS JOIN t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_linha d WHERE d.template_id = t.id AND d.codigo = l.codigo);

UPDATE public.dre_linha f
   SET parent_id = p.id
  FROM public.dre_linha p
 WHERE f.template_id = p.template_id
   AND f.parent_id IS NULL
   AND f.codigo IN ('11.1', '11.2')
   AND p.codigo = '11';

-- ---------------------------------------------------------------------------
-- 8) Semeadura do catalogo
-- ---------------------------------------------------------------------------
-- Espelha src/lib/financeiro/plano-contas/catalogo.ts (CATALOGO_VERSAO = 1). O
-- teste `catalogo-sql.test.ts` compara os dois: divergir aqui quebra o build.
--
-- Idempotente por `codigo`. Reexecutar atualiza texto e destino, nunca duplica
-- e nunca reclassifica um cadastro.

WITH dados(codigo, nome, descricao, familia, tratamento, naturezas, papel_dre, motivo_exclusao, observacao) AS (VALUES
  ('RECEITA_PRODUTOS', 'Receita de produtos', 'Venda de pecas, pneus, lubrificantes e demais mercadorias.', 'RECEITA', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, NULL),
  ('RECEITA_SERVICOS', 'Receita de servicos', 'Mao de obra, diagnostico, reparo e demais servicos da oficina.', 'RECEITA', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, NULL),
  ('RECEITA_FRETE', 'Frete cobrado do cliente', 'Frete e entrega cobrados no documento, separados do preco do item.', 'RECEITA', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, NULL),
  ('RECEITA_OPERACIONAL_OUTRA', 'Outras receitas da atividade', 'Receita operacional que nao e produto, servico nem frete.', 'RECEITA', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, NULL),
  ('TRIBUTO_RECEITA', 'Tributos sobre receita', 'Tributo incidente sobre o faturamento. Nao inclui tributo sobre o lucro nem taxa administrativa.', 'DEDUCAO', 'RESULTADO', ARRAY['DESPESA'], 'DEDUCAO', NULL, 'Sem apuracao automatica a partir das notas: depende do lancamento financeiro.'),
  ('DEVOLUCAO_COMERCIAL', 'Devolucoes de vendas', 'Retorno de mercadoria vendida, reduzindo a receita do periodo.', 'DEDUCAO', 'RESULTADO', ARRAY['DESPESA'], 'DEDUCAO', NULL, 'Sem geracao automatica nesta entrega.'),
  ('CANCELAMENTO_COMERCIAL', 'Cancelamentos comerciais', 'Cancelamento de documento ja reconhecido como receita.', 'DEDUCAO', 'RESULTADO', ARRAY['DESPESA'], 'DEDUCAO', NULL, 'O cancelamento da OS/venda ja cancela os eventos originais; lancar aqui em cima disso deduziria o mesmo fato duas vezes.'),
  ('ABATIMENTO_COMERCIAL', 'Abatimentos concedidos', 'Reducao acordada apos a venda, sem devolucao da mercadoria.', 'DEDUCAO', 'RESULTADO', ARRAY['DESPESA'], 'DEDUCAO', NULL, NULL),
  ('DESCONTO_INCONDICIONAL', 'Descontos concedidos na operacao', 'Desconto dado no proprio documento: sai do valor recebido e reduz a receita bruta.', 'DEDUCAO', 'RESULTADO', ARRAY['DESPESA'], 'DEDUCAO', NULL, NULL),
  ('CUSTO_MERCADORIA', 'Custo de mercadorias vendidas', 'Custo das pecas e mercadorias aplicadas ou revendidas.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('CUSTO_PRODUTO_FABRICADO', 'Custo de produtos fabricados', 'Custo de produto produzido pela propria empresa.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('CUSTO_SERVICO', 'Custo dos servicos prestados', 'Custo direto de execucao do servico, sem separar material e mao de obra.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('CUSTO_MATERIAL_DIRETO', 'Materiais aplicados', 'Material de consumo aplicado diretamente no servico.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('CUSTO_MAO_OBRA_DIRETA', 'Mao de obra direta', 'Remuneracao e comissao de quem executa o servico vendido.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, 'As comissoes de OS ja chegam por evento proprio; nao reclassificar contas de comissao so pelo nome.'),
  ('CUSTO_TERCEIRO_DIRETO', 'Servicos terceirizados diretos', 'Retifica, guincho e demais servicos contratados para executar a OS.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('CUSTO_DIRETO_OUTRO', 'Outros custos diretos', 'Custo direto que nao cabe nas linhas anteriores.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, NULL),
  ('TRIBUTO_COMPRA_RESULTADO', 'Tributos de compra no resultado', 'Tributo da nota de entrada que a politica atual leva ao resultado do mes em vez do custo do estoque.', 'CUSTO', 'RESULTADO', ARRAY['DESPESA'], 'CUSTO', NULL, 'Politica gerencial existente (src/lib/nfe/tratamento-custo.ts). Revisao fiscal e dependencia separada.'),
  ('RECUPERACAO_COMPRA', 'Recuperacoes e desoneracoes de compras', 'Credito ou desoneracao que abate o custo. Entra no caixa e nao e faturamento.', 'CUSTO', 'RESULTADO', ARRAY['RECEITA'], 'CUSTO', NULL, NULL),
  ('DESPESA_COMERCIAL', 'Despesas comerciais', 'Marketing, publicidade, comissao de vendedor, taxas de marketplace, frete de venda.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DESPESA_ADMINISTRATIVA', 'Despesas administrativas', 'Contabilidade, juridico, material de escritorio, seguros, taxas administrativas.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DESPESA_PESSOAL', 'Despesas com pessoal', 'Salarios, encargos, beneficios, pro-labore, rescisoes.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DESPESA_OCUPACAO', 'Ocupacao e estrutura', 'Aluguel, condominio, energia, agua, manutencao predial, consumo da oficina.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DESPESA_TECNOLOGIA', 'Tecnologia', 'Sistemas, hospedagem, internet, telefonia, certificado digital.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DESPESA_OPERACIONAL_OUTRA', 'Outras despesas operacionais', 'Despesa operacional identificada que nao cabe nas anteriores. Nao e destino de despesa desconhecida.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('DEPRECIACAO', 'Depreciacao e amortizacao', 'Depreciacao registrada manualmente enquanto nao existir modulo de patrimonio.', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, 'Sem origem automatica: zero na linha nao prova ausencia de depreciacao.'),
  ('RECEITA_FINANCEIRA', 'Receitas financeiras', 'Rendimento de aplicacao, juros e multa recebidos de cliente, descontos obtidos.', 'FINANCEIRO', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, NULL),
  ('DESPESA_FINANCEIRA', 'Despesas financeiras', 'Tarifa bancaria, taxa de cartao/PIX, antecipacao de recebiveis, juros e multa pagos.', 'FINANCEIRO', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('OUTRO_GANHO', 'Outros ganhos', 'Ganho apurado fora da atividade. Na alienacao de um bem, e a diferenca entre o valor recebido e o valor contabil baixado.', 'OUTROS_RESULTADOS', 'RESULTADO', ARRAY['RECEITA'], 'RECEITA', NULL, 'Sem modulo de patrimonio o ganho nao e apuravel automaticamente: o recebimento fica pendente de complementacao.'),
  ('OUTRA_PERDA', 'Outras perdas', 'Perda apurada fora da atividade, inclusive baixa de ativo sem contrapartida de venda.', 'OUTROS_RESULTADOS', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('IRPJ_RESULTADO', 'IRPJ', 'Imposto de renda da pessoa juridica. Reduz o resultado, nao a receita.', 'TRIBUTO_LUCRO', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('CSLL_RESULTADO', 'CSLL', 'Contribuicao social sobre o lucro liquido.', 'TRIBUTO_LUCRO', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('TRIBUTO_LUCRO_OUTRO', 'Outros tributos sobre o lucro', 'Tributo equivalente ao IRPJ/CSLL em outro regime.', 'TRIBUTO_LUCRO', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', NULL, NULL),
  ('PATRIMONIAL_SOCIOS', 'Socios e patrimonio', 'Aporte, integralizacao, distribuicao de lucros e devolucao de capital. Pro-labore nao entra aqui.', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA', 'DESPESA'], NULL, 'Movimentacao de patrimonio liquido: nao e receita nem despesa do periodo.', NULL),
  ('PATRIMONIAL_EMPRESTIMO', 'Emprestimos e financiamentos', 'Principal recebido e amortizado. Juros e encargos vao para o resultado financeiro.', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA', 'DESPESA'], NULL, 'Principal de divida: altera passivo e caixa, nao o resultado.', NULL),
  ('PATRIMONIAL_IMOBILIZADO', 'Aquisicao de imobilizado', 'Compra de maquinas, ferramentas de alto valor, veiculos e obras.', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA', 'DESPESA'], NULL, 'Aquisicao de ativo: troca caixa por bem, sem efeito no resultado do mes.', NULL),
  ('TRANSFERENCIA_INTERNA', 'Transferencias internas', 'Movimento entre contas proprias, aplicacao e resgate.', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA', 'DESPESA'], NULL, 'O dinheiro muda de conta e continua sendo o mesmo dinheiro.', NULL),
  ('ADIANTAMENTO', 'Adiantamentos', 'Adiantamento de cliente ou a fornecedor, antes do fato que o consome.', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA', 'DESPESA'], NULL, 'Direito ou obrigacao: o resultado nasce quando o servico ou a compra acontece.', NULL)
)
INSERT INTO public.classificacoes_resultado
  (codigo, nome, descricao, familia, tratamento, naturezas, papel_dre, motivo_exclusao, observacao, versao_catalogo)
SELECT d.codigo, d.nome, d.descricao, d.familia, d.tratamento, d.naturezas,
       d.papel_dre, d.motivo_exclusao, d.observacao, 1
  FROM dados d
ON CONFLICT (codigo) DO UPDATE
   SET nome            = excluded.nome,
       descricao       = excluded.descricao,
       familia         = excluded.familia,
       tratamento      = excluded.tratamento,
       naturezas       = excluded.naturezas,
       papel_dre       = excluded.papel_dre,
       motivo_exclusao = excluded.motivo_exclusao,
       observacao      = excluded.observacao,
       versao_catalogo = excluded.versao_catalogo,
       updated_at      = now();

-- Destino de cada classificacao no template ativo. Este e o unico lugar que
-- liga significado a apresentacao; a classificacao em si nao sabe de linha.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
destinos(codigo, linha_codigo) AS (VALUES
  ('RECEITA_PRODUTOS', '1.1'), ('RECEITA_SERVICOS', '1.2'), ('RECEITA_FRETE', '1.3'),
  ('RECEITA_OPERACIONAL_OUTRA', '1.3'),
  ('TRIBUTO_RECEITA', '2.1'), ('DEVOLUCAO_COMERCIAL', '2.2'), ('CANCELAMENTO_COMERCIAL', '2.3'),
  ('ABATIMENTO_COMERCIAL', '2.4'), ('DESCONTO_INCONDICIONAL', '2.5'),
  ('CUSTO_MERCADORIA', '4.1'), ('CUSTO_PRODUTO_FABRICADO', '4.2'), ('CUSTO_SERVICO', '4.3'),
  ('CUSTO_MATERIAL_DIRETO', '4.4'), ('CUSTO_MAO_OBRA_DIRETA', '4.5'),
  ('CUSTO_TERCEIRO_DIRETO', '4.6'), ('CUSTO_DIRETO_OUTRO', '4.7'),
  ('TRIBUTO_COMPRA_RESULTADO', '4.8'), ('RECUPERACAO_COMPRA', '4.9'),
  ('DESPESA_COMERCIAL', '6.1'), ('DESPESA_ADMINISTRATIVA', '6.2'), ('DESPESA_PESSOAL', '6.3'),
  ('DESPESA_OCUPACAO', '6.4'), ('DESPESA_TECNOLOGIA', '6.5'), ('DESPESA_OPERACIONAL_OUTRA', '6.6'),
  ('DEPRECIACAO', '8'),
  ('RECEITA_FINANCEIRA', '10.1'), ('DESPESA_FINANCEIRA', '10.2'),
  ('OUTRO_GANHO', '11.1'), ('OUTRA_PERDA', '11.2'),
  ('IRPJ_RESULTADO', '13.1'), ('CSLL_RESULTADO', '13.2'), ('TRIBUTO_LUCRO_OUTRO', '13.3')
)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, exclui_do_resultado, origem_tipo, classificacao_resultado_id, percentual, observacao)
SELECT t.id, dl.id, false, 'CLASSIFICACAO_RESULTADO', c.id, 100,
       'Destino da classificacao ' || c.codigo || ' no catalogo versao 1.'
  FROM destinos d
  CROSS JOIN t
  JOIN public.classificacoes_resultado c ON c.codigo = d.codigo
  JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = d.linha_codigo
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento m
    WHERE m.template_id = t.id
      AND m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
      AND m.classificacao_resultado_id = c.id);

-- Patrimonial: mapeado como exclusao explicita, com motivo. Nao e pendencia.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, exclui_do_resultado, origem_tipo, classificacao_resultado_id, percentual, observacao)
SELECT t.id, NULL, true, 'CLASSIFICACAO_RESULTADO', c.id, 100, c.motivo_exclusao
  FROM public.classificacoes_resultado c
  CROSS JOIN t
 WHERE c.tratamento = 'PATRIMONIAL'
   AND NOT EXISTS (
     SELECT 1 FROM public.dre_mapeamento m
      WHERE m.template_id = t.id
        AND m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
        AND m.classificacao_resultado_id = c.id);

-- Toda classificacao precisa ter destino ou exclusao. Um catalogo com chave sem
-- destino produziria pendencia permanente que ninguem consegue resolver pela
-- tela.
DO $conferir_destinos$
DECLARE
  v_sem_destino text;
BEGIN
  SELECT string_agg(c.codigo, ', ' ORDER BY c.codigo) INTO v_sem_destino
    FROM public.classificacoes_resultado c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.dre_mapeamento m
      WHERE m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
        AND m.classificacao_resultado_id = c.id
        AND m.ativo);

  IF v_sem_destino IS NOT NULL THEN
    RAISE EXCEPTION 'Classificacoes sem destino no template ativo: %.', v_sem_destino;
  END IF;
END
$conferir_destinos$;

-- ---------------------------------------------------------------------------
-- 9) Acesso
-- ---------------------------------------------------------------------------
-- Tudo passa pelo servidor, como o resto do financeiro. Nenhum acesso anonimo
-- ou de usuario autenticado direto ao dado.

REVOKE ALL ON public.classificacoes_resultado FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.classificacoes_resultado TO service_role;

REVOKE ALL ON public.plano_contas_classificacao_regra FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.plano_contas_classificacao_regra TO service_role;

REVOKE ALL ON public.eventos_financeiros_classificacao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.eventos_financeiros_classificacao TO service_role;

REVOKE ALL ON public.dre_implantacao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dre_implantacao TO service_role;

REVOKE ALL ON FUNCTION public.tg_regra_classificacao_sem_sobreposicao()
  FROM PUBLIC, anon, authenticated;

COMMIT;
