-- Acrescimos e descontos de uma transacao financeira.
--
-- Hoje uma transacao tem `valor` e `valorLiquido`, e a unica diferenca possivel
-- entre os dois e a taxa da maquineta — implicita, sem registro do que foi. Nao
-- ha como lancar juros de atraso, multa, ou desconto de antecipacao.
--
-- A CADEIA
--   valor_base  ->  + acrescimos  ->  valor  ->  - descontos  ->  valorLiquido
--
-- `valor` continua sendo o que o cliente paga, agora ja com os acrescimos; o
-- liquido continua sendo o que entra na conta. Como desconto sempre subtrai, o
-- invariante `liquido <= bruto`, que a rota e ajustar_valores_transacao ja
-- validam, permanece verdadeiro — nada precisou ser afrouxado.
--
-- O valor de face nao se perde: e `valor - valor_acrescimos`. Isso importa
-- porque o total pago de uma OS ou venda passa a somar a face, e nao o bruto:
-- juros e multa sao do pagamento, nao do documento. Mesma linha do que o sistema
-- ja faz com acrescimo_financeiro, que "nao altera itens ou valores fiscais".
--
-- QUANDO CADA UM PODE ENTRAR
-- Acrescimo mexe no bruto, entao esbarra na trava criada em
-- 20260806120000_travar_valor_apos_baixa: so em transacao pendente. Desconto
-- mexe so no liquido e continua liberado depois da baixa — a taxa da maquineta
-- costuma ser conhecida bem depois de o pagamento ter sido registrado, e
-- bloquear seria regressao.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Catalogo de tipos
--
-- Mesmo formato de public.tipos_motivo_saida: codigo estavel para o sistema,
-- nome para a tela, ativo em vez de exclusao. `codigo_sistema` marca a linha que
-- o proprio ERP usa e o usuario nao pode remover, como em categoriatransacao.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tipos_ajuste_transacao (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  natureza text NOT NULL,
  codigo_sistema text,
  ativo boolean NOT NULL DEFAULT true,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipos_ajuste_transacao_codigo_unique UNIQUE (codigo),
  CONSTRAINT tipos_ajuste_transacao_natureza_check
    CHECK (natureza IN ('ACRESCIMO', 'DESCONTO'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tipos_ajuste_transacao_codigo_sistema_key
  ON public.tipos_ajuste_transacao (codigo_sistema)
  WHERE codigo_sistema IS NOT NULL;

ALTER TABLE public.tipos_ajuste_transacao OWNER TO postgres;

INSERT INTO public.tipos_ajuste_transacao (codigo, nome, natureza, codigo_sistema, descricao) VALUES
  ('JUROS',                'Juros',                  'ACRESCIMO', NULL, 'Juros por atraso no pagamento.'),
  ('MULTA',                'Multa',                  'ACRESCIMO', NULL, 'Multa contratual ou por atraso.'),
  ('OUTRO_ACRESCIMO',      'Outro acréscimo',        'ACRESCIMO', NULL, NULL),
  -- A taxa da maquineta deixa de ser implicita e passa a ser uma linha como as
  -- outras. E de sistema porque o dialog a insere sozinho quando o usuario marca
  -- que o recebimento teve taxa.
  ('TAXA_RECEBIMENTO',     'Taxa de recebimento',    'DESCONTO',  'TAXA_RECEBIMENTO',
   'Taxa cobrada pela maquineta ou pelo meio de pagamento.'),
  ('DESCONTO_ANTECIPACAO', 'Desconto por antecipação', 'DESCONTO', NULL, 'Abatimento por pagamento antecipado.'),
  ('DESCONTO_COMERCIAL',   'Desconto comercial',     'DESCONTO',  NULL, NULL),
  ('OUTRO_DESCONTO',       'Outro desconto',         'DESCONTO',  NULL, NULL)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Colunas derivadas em transacao
--
-- `valor_base` e o que o usuario digita; `valor` passa a ser resultado. O
-- backfill copia o valor atual, entao toda transacao que ja existe continua com
-- base igual ao bruto e nenhum ajuste — exatamente o estado de hoje.
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS valor_base numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_acrescimos numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_descontos numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.transacao SET valor_base = valor WHERE valor_base IS NULL;

ALTER TABLE public.transacao
  ALTER COLUMN valor_base SET DEFAULT 0;

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_ajustes_nao_negativos_check,
  ADD CONSTRAINT transacao_ajustes_nao_negativos_check
    CHECK (valor_acrescimos >= 0 AND valor_descontos >= 0);

COMMENT ON COLUMN public.transacao.valor_base IS
  'Valor de face, antes dos acrescimos. valor = valor_base + valor_acrescimos.';
COMMENT ON COLUMN public.transacao.valor_acrescimos IS
  'Soma das linhas de acrescimo em transacao_ajuste. Mantida por gatilho.';
COMMENT ON COLUMN public.transacao.valor_descontos IS
  'Soma das linhas de desconto em transacao_ajuste. Mantida por gatilho.';

-- Todo caminho de criacao que existe hoje informa `valor` e nao conhece
-- `valor_base`. Preencher aqui evita ter que alterar as dezenas de INSERTs
-- espalhados pelas RPCs de entrada, venda, OS e uso/consumo.
CREATE OR REPLACE FUNCTION public.tg_transacao_valor_base_padrao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.valor_base IS NULL OR new.valor_base = 0 THEN
    new.valor_base := coalesce(new.valor, 0);
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_valor_base_padrao() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_valor_base_padrao_trg ON public.transacao;
CREATE TRIGGER transacao_valor_base_padrao_trg
  BEFORE INSERT ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_valor_base_padrao();

-- ---------------------------------------------------------------------------
-- 3) As linhas de ajuste
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transacao_ajuste (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  transacao_id bigint NOT NULL REFERENCES public.transacao(id) ON DELETE CASCADE,
  tipo_id integer NOT NULL REFERENCES public.tipos_ajuste_transacao(id) ON DELETE RESTRICT,

  -- Repetida do tipo de proposito: o gatilho de recalculo soma por natureza e
  -- nao pode depender de join para saber de que lado a linha cai.
  natureza text NOT NULL,

  modo text NOT NULL,
  -- Em PORCENTAGEM guarda o percentual; em FIXO, o proprio valor em reais.
  valor_informado numeric(14,4) NOT NULL,
  -- O que de fato entrou na conta da transacao, sempre em reais.
  valor_calculado numeric(14,2) NOT NULL,

  observacao text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT transacao_ajuste_natureza_check CHECK (natureza IN ('ACRESCIMO', 'DESCONTO')),
  CONSTRAINT transacao_ajuste_modo_check CHECK (modo IN ('FIXO', 'PORCENTAGEM')),
  CONSTRAINT transacao_ajuste_valores_check CHECK (
    valor_informado > 0
    AND valor_calculado > 0
    AND (modo <> 'PORCENTAGEM' OR valor_informado <= 100)
  )
);

CREATE INDEX IF NOT EXISTS transacao_ajuste_transacao_idx
  ON public.transacao_ajuste(transacao_id);

ALTER TABLE public.transacao_ajuste OWNER TO postgres;

-- A natureza da linha tem que ser a do tipo escolhido; sem isto daria para
-- cadastrar um "desconto" apontando para o tipo Juros e somar do lado errado.
CREATE OR REPLACE FUNCTION public.tg_transacao_ajuste_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_natureza text;
  v_ativo boolean;
  v_pendente boolean;
BEGIN
  SELECT natureza, ativo INTO v_natureza, v_ativo
    FROM public.tipos_ajuste_transacao WHERE id = new.tipo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de ajuste nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Tipo de ajuste inativo.' USING ERRCODE = '22023';
  END IF;
  IF new.natureza <> v_natureza THEN
    RAISE EXCEPTION 'A natureza informada nao confere com a do tipo escolhido.'
      USING ERRCODE = '22023';
  END IF;

  -- Acrescimo altera o bruto, e bruto de transacao baixada e imutavel (ver
  -- 20260806120000_travar_valor_apos_baixa). Recusar aqui da mensagem util em
  -- vez de deixar estourar a trava do `valor`, que falaria de outra coisa.
  -- Desconto mexe so no liquido e segue liberado: a taxa da maquineta costuma
  -- ser conhecida depois do pagamento.
  IF new.natureza = 'ACRESCIMO' THEN
    SELECT pendente INTO v_pendente FROM public.transacao WHERE id = new.transacao_id;
    IF coalesce(v_pendente, false) = false THEN
      RAISE EXCEPTION
        'Nao da para lancar acrescimo em transacao ja baixada, porque ele altera o valor bruto.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_ajuste_coerente() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_ajuste_coerente_trg ON public.transacao_ajuste;
CREATE TRIGGER transacao_ajuste_coerente_trg
  BEFORE INSERT OR UPDATE ON public.transacao_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_ajuste_coerente();

-- ---------------------------------------------------------------------------
-- 4) Recalculo do pai
--
-- Percentual incide sobre a base, nunca sobre o acumulado: dois descontos de 10%
-- somam 20% da base, e nao 19%. E o que o usuario espera ao ler duas linhas de
-- 10% na tela.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalcular_valores_transacao(p_transacao_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acrescimos numeric(14,2);
  v_descontos numeric(14,2);
  v_base numeric(14,2);
  v_valor numeric(14,2);
BEGIN
  SELECT coalesce(valor_base, valor, 0) INTO v_base
    FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    coalesce(sum(valor_calculado) FILTER (WHERE natureza = 'ACRESCIMO'), 0),
    coalesce(sum(valor_calculado) FILTER (WHERE natureza = 'DESCONTO'), 0)
    INTO v_acrescimos, v_descontos
    FROM public.transacao_ajuste
   WHERE transacao_id = p_transacao_id;

  v_valor := round(v_base + v_acrescimos, 2);

  IF v_descontos > v_valor THEN
    RAISE EXCEPTION
      'A soma dos descontos (%) nao pode passar do valor bruto (%).', v_descontos, v_valor
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.transacao
     SET valor_acrescimos = v_acrescimos,
         valor_descontos = v_descontos,
         valor = v_valor,
         "valorLiquido" = round(v_valor - v_descontos, 2),
         updated_at = now()
   WHERE id = p_transacao_id;
END;
$$;

ALTER FUNCTION public.recalcular_valores_transacao(bigint) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tg_transacao_ajuste_recalcular()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    PERFORM public.recalcular_valores_transacao(old.transacao_id);
    RETURN old;
  END IF;

  PERFORM public.recalcular_valores_transacao(new.transacao_id);
  -- Mover a linha de uma transacao para outra tem que acertar as duas pontas.
  IF tg_op = 'UPDATE' AND old.transacao_id <> new.transacao_id THEN
    PERFORM public.recalcular_valores_transacao(old.transacao_id);
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_ajuste_recalcular() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_ajuste_recalcular_trg ON public.transacao_ajuste;
CREATE TRIGGER transacao_ajuste_recalcular_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.transacao_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_ajuste_recalcular();

-- Quem escreve `valor` direto — a RPC ajustar_valores_transacao, o PATCH da
-- rota, e o que vier depois — nao conhece `valor_base`. Sem isto, editar o bruto
-- de um lancamento que ja tem acrescimo deixaria a base velha, e o proximo
-- recalculo desfaria a edicao.
--
-- Nao ha recursao: este gatilho e BEFORE e so ajusta campos de NEW. Quando o
-- recalculo da secao anterior grava valor = base + acrescimos, a conta inversa
-- aqui devolve exatamente a mesma base.
CREATE OR REPLACE FUNCTION public.tg_transacao_valor_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.valor IS DISTINCT FROM old.valor THEN
    new.valor_base := round(coalesce(new.valor, 0) - coalesce(new.valor_acrescimos, 0), 2);
  END IF;

  -- Havendo desconto lancado, o liquido e resultado, nao entrada: qualquer valor
  -- que o chamador tenha mandado seria uma segunda verdade sobre o mesmo numero.
  -- Sem ajuste nenhum, o liquido continua livre como sempre foi — e o caso de
  -- todo registro anterior a esta migracao.
  IF coalesce(new.valor_descontos, 0) > 0 THEN
    new."valorLiquido" := round(coalesce(new.valor, 0) - new.valor_descontos, 2);
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_valor_coerente() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_valor_coerente_trg ON public.transacao;
CREATE TRIGGER transacao_valor_coerente_trg
  BEFORE UPDATE ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_valor_coerente();

-- ---------------------------------------------------------------------------
-- 5) Carga da taxa que ja existia
--
-- Ate aqui a taxa da maquineta era implicita: vivia na diferenca entre valor e
-- valorLiquido, sem linha que dissesse o que era. Sem esta carga, transacao
-- antiga ficaria com valor_descontos = 0 e valorLiquido menor que o bruto —
-- quebrando a regra que a secao 4 acabou de estabelecer, e fazendo a tela
-- mostrar "sem taxa" onde havia taxa.
--
-- O gatilho de recalculo dispara em cada linha inserida e regrava o pai com
-- exatamente os mesmos numeros (nao ha acrescimo, e o desconto e a diferenca que
-- ja estava la), entao a carga nao move dinheiro nenhum.
INSERT INTO public.transacao_ajuste (
  transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, observacao
)
SELECT
  t.id,
  (SELECT id FROM public.tipos_ajuste_transacao WHERE codigo = 'TAXA_RECEBIMENTO'),
  'DESCONTO',
  'FIXO',
  round(t.valor - t."valorLiquido", 2),
  round(t.valor - t."valorLiquido", 2),
  'Taxa que já estava registrada na diferença entre bruto e líquido.'
FROM public.transacao t
WHERE t."valorLiquido" IS NOT NULL
  AND t."valorLiquido" > 0
  AND t."valorLiquido" < t.valor
  AND NOT EXISTS (
    SELECT 1 FROM public.transacao_ajuste a WHERE a.transacao_id = t.id
  );

-- ---------------------------------------------------------------------------
-- 6) Acesso
--
-- O catalogo e lido pela tela; as linhas de ajuste passam pelo servidor, como o
-- resto do financeiro.
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE public.tipos_ajuste_transacao TO anon, authenticated;
GRANT ALL ON TABLE public.tipos_ajuste_transacao TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.tipos_ajuste_transacao_id_seq TO service_role;

REVOKE ALL ON public.transacao_ajuste FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.transacao_ajuste TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.transacao_ajuste_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.recalcular_valores_transacao(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_valores_transacao(bigint) TO service_role;

COMMIT;
