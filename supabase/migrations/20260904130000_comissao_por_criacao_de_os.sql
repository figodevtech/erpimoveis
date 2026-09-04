-- Comissao por criacao de OS: quem abre a ordem recebe sobre o que ela contem.
--
-- O motor de comissao so conhecia a REALIZACAO: paga a quem executou o servico,
-- guardada em `osservico_realizador`. Na Demir Diesel ha um arranjo que isso nao
-- expressa — a pessoa da recepcao recebe 1% dos servicos e 0,5% dos produtos das
-- OS que ela abriu, independentemente de quem executou. Ate aqui era conta a
-- mao, fora do sistema.
--
-- O DESENHO COPIA O QUE JA EXISTE
-- O valor nao nasce no evento financeiro: ele e calculado e gravado num
-- snapshot (aqui, `os_comissao_criacao`), e o evento COMISSAO/DESPESA e uma
-- copia publicada pela reconciliacao, que nao multiplica nada. Mesma divisao de
-- `osservico_realizador` + `recalcular_comissao_osservico`.
--
-- A BASE E A MESMA
-- `fator = greatest(orcamentototal - valor_frete, 0) / soma dos subtotais`, e a
-- base de cada item e `subtotal * fator`. Reusar a expressao literal de
-- `recalcular_comissao_osservico` e o que impede as duas comissoes da mesma OS
-- de discordarem sobre quanto o desconto encolheu a base.
--
-- NASCE INERTE
-- Sem percentual no cadastro nao ha linha e nao ha evento — que e o estado de
-- todos os usuarios hoje. Esta migration, sozinha, nao muda numero nenhum.
--
-- CUIDADO QUE ESTA MIGRATION PRECISA TER
-- 1. A parte 7 muda comportamento EXISTENTE: OS sem cobranca passa a cancelar
--    tambem os eventos de comissao — os de realizacao inclusive. O valor deles
--    ja era R$ 0,00 (a rota de status zera o orcamento antes de trocar o status,
--    o que zera o fator), entao a DRE nao se move; some a linha zerada. Isso
--    reverte, SO PARA ESTE CASO, a escolha de 20260903180000. Ver o comentario
--    la embaixo para por que as duas decisoes convivem.
-- 2. Os gatilhos de `osproduto`/`osproduto_avulso` sao novos: a comissao de
--    realizacao nunca olhou produto. Eles escrevem apenas em
--    `os_comissao_criacao`, que nao tem gatilho nenhum — nao ha recursao.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O cadastro
-- ---------------------------------------------------------------------------
ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS comissao_criacao_servico_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS comissao_criacao_produto_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS comissao_criacao_somente_comissionaveis boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuario.comissao_criacao_servico_percent IS
  'Percentual sobre os servicos das OS que este usuario criou, pago por ter aberto a ordem. Nulo ou zero: nao recebe por criacao. Independente de comissao_percent, que e a de realizacao.';

COMMENT ON COLUMN public.usuario.comissao_criacao_produto_percent IS
  'Percentual sobre os produtos das OS que este usuario criou. Nulo ou zero: nao recebe por criacao.';

COMMENT ON COLUMN public.usuario.comissao_criacao_somente_comissionaveis IS
  'Quando true, a base de servicos da comissao de criacao conta so servicos com gera_comissao. Default false: o arranjo que originou o recurso paga sobre todos os servicos da OS.';

-- ---------------------------------------------------------------------------
-- 2) O snapshot
-- ---------------------------------------------------------------------------
-- Uma linha por OS — o criador e um so. Quem paga e o que esta gravado aqui,
-- nunca um calculo refeito na leitura: e o que faz a Central Pessoal, o evento
-- financeiro e o relatorio nunca divergirem entre si.
CREATE TABLE IF NOT EXISTS public.os_comissao_criacao (
  ordemservicoid integer PRIMARY KEY
    REFERENCES public.ordemservico(id) ON DELETE CASCADE,
  usuarioid uuid NOT NULL REFERENCES public.usuario(id),
  base_servicos numeric(12,2) NOT NULL DEFAULT 0,
  base_produtos numeric(12,2) NOT NULL DEFAULT 0,
  pct_servicos numeric(5,2) NOT NULL DEFAULT 0,
  pct_produtos numeric(5,2) NOT NULL DEFAULT 0,
  somente_comissionaveis boolean NOT NULL DEFAULT false,
  valor_servicos numeric(12,2) NOT NULL DEFAULT 0,
  valor_produtos numeric(12,2) NOT NULL DEFAULT 0,
  valor_comissao numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.os_comissao_criacao OWNER TO postgres;

COMMENT ON TABLE public.os_comissao_criacao IS
  'Comissao paga a quem criou a OS, sobre os servicos e produtos dela. Analogo de osservico_realizador para a comissao de criacao: e o snapshot que paga, e o evento financeiro COMISSAO e copia dele. Linha ausente significa criador sem percentual cadastrado.';

COMMENT ON COLUMN public.os_comissao_criacao.usuarioid IS
  'O criador, carimbado. Nao e lido de ordemservico.usuariocriadorid na hora de pagar: a troca de titularidade da OS nao deve transferir comissao ja apurada.';

COMMENT ON COLUMN public.os_comissao_criacao.base_servicos IS
  'Soma dos subtotais de servico ja multiplicada pelo fator de desconto da OS. Mesma base liquida da comissao de realizacao.';

CREATE INDEX IF NOT EXISTS idx_os_comissao_criacao_usuario
  ON public.os_comissao_criacao (usuarioid);

ALTER TABLE public.os_comissao_criacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_comissao_criacao NO FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) Carimbo pelo cadastro
-- ---------------------------------------------------------------------------
-- Espelha `recarimbar_comissao_osservico`: enquanto a execucao nao encerrou, a
-- taxa e relida do cadastro; depois, congela. Um aumento de percentual nao pode
-- reescrever mes ja pago.
CREATE OR REPLACE FUNCTION public.recarimbar_comissao_criacao_os(
  p_ordemservicoid integer
)
RETURNS void
LANGUAGE sql
AS $function$
  UPDATE public.os_comissao_criacao c
     SET pct_servicos = coalesce(u.comissao_criacao_servico_percent, 0),
         pct_produtos = coalesce(u.comissao_criacao_produto_percent, 0),
         somente_comissionaveis = coalesce(u.comissao_criacao_somente_comissionaveis, false),
         updated_at = now()
    FROM public.usuario u
   WHERE c.ordemservicoid = p_ordemservicoid
     AND u.id = c.usuarioid;
$function$;

COMMENT ON FUNCTION public.recarimbar_comissao_criacao_os(integer) IS
  'Traz os percentuais de comissao de criacao do cadastro do usuario para o snapshot da OS.';

-- ---------------------------------------------------------------------------
-- 4) O recalculo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_comissao_criacao_os(
  p_ordemservicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_criador uuid;
  v_pct_servicos numeric := 0;
  v_pct_produtos numeric := 0;
  v_somente boolean := false;
  v_execucao_encerrada boolean := false;
  v_total_os_sem_frete numeric := 0;
  v_total_itens numeric := 0;
  v_fator numeric := 1;
  v_base_servicos numeric := 0;
  v_base_produtos numeric := 0;
  v_existe boolean;
BEGIN
  SELECT o.usuariocriadorid, o.execucao_fim_em IS NOT NULL
    INTO v_criador, v_execucao_encerrada
    FROM public.ordemservico o
   WHERE o.id = p_ordemservicoid;

  IF v_criador IS NULL THEN
    DELETE FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid;
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid)
    INTO v_existe;

  -- Execucao encerrada e nunca apurada: fica assim. Sem esta guarda, ligar o
  -- beneficio no cadastro e depois mexer numa OS antiga — corrigir um item,
  -- reabrir o orcamento — criaria comissao num mes ja fechado e reescreveria a
  -- DRE daquele periodo. E a mesma razao pela qual esta migration nao faz
  -- backfill: o que passou, passou.
  IF NOT v_existe AND v_execucao_encerrada THEN
    RETURN;
  END IF;

  -- Execucao encerrada: os percentuais viraram historico e saem do proprio
  -- snapshot. Ainda em execucao: releem o cadastro.
  IF v_existe AND v_execucao_encerrada THEN
    SELECT c.pct_servicos, c.pct_produtos, c.somente_comissionaveis
      INTO v_pct_servicos, v_pct_produtos, v_somente
      FROM public.os_comissao_criacao c
     WHERE c.ordemservicoid = p_ordemservicoid;
  ELSE
    SELECT coalesce(u.comissao_criacao_servico_percent, 0),
           coalesce(u.comissao_criacao_produto_percent, 0),
           coalesce(u.comissao_criacao_somente_comissionaveis, false)
      INTO v_pct_servicos, v_pct_produtos, v_somente
      FROM public.usuario u
     WHERE u.id = v_criador;
  END IF;

  -- Criador sem percentual nenhum: nao ha comissao de criacao nesta OS. O
  -- DELETE tambem e o caminho de desligar o beneficio — some a linha, e a
  -- reconciliacao cancela o evento por nao encontrar a chave desejada.
  IF coalesce(v_pct_servicos, 0) = 0 AND coalesce(v_pct_produtos, 0) = 0 THEN
    DELETE FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid;
    RETURN;
  END IF;

  -- Expressao identica a de `recalcular_comissao_osservico`. Mudar uma sem a
  -- outra faz as duas comissoes da mesma OS discordarem sobre o desconto.
  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os_sem_frete, v_total_itens
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;

  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;

  SELECT round(coalesce(sum(coalesce(os.subtotal, 0)), 0) * v_fator, 2)
    INTO v_base_servicos
    FROM public.osservico os
    JOIN public.servico s ON s.id = os.servicoid
   WHERE os.ordemservicoid = p_ordemservicoid
     AND (NOT v_somente OR coalesce(s.gera_comissao, true));

  SELECT round((
           coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = p_ordemservicoid), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = p_ordemservicoid), 0)
         ) * v_fator, 2)
    INTO v_base_produtos;

  INSERT INTO public.os_comissao_criacao AS c (
    ordemservicoid, usuarioid, base_servicos, base_produtos,
    pct_servicos, pct_produtos, somente_comissionaveis,
    valor_servicos, valor_produtos, valor_comissao, updated_at
  ) VALUES (
    p_ordemservicoid, v_criador,
    coalesce(v_base_servicos, 0), coalesce(v_base_produtos, 0),
    v_pct_servicos, v_pct_produtos, v_somente,
    round(coalesce(v_base_servicos, 0) * v_pct_servicos / 100.0, 2),
    round(coalesce(v_base_produtos, 0) * v_pct_produtos / 100.0, 2),
    round(coalesce(v_base_servicos, 0) * v_pct_servicos / 100.0, 2)
      + round(coalesce(v_base_produtos, 0) * v_pct_produtos / 100.0, 2),
    now()
  )
  ON CONFLICT (ordemservicoid) DO UPDATE SET
    -- `usuarioid` de proposito NAO entra no UPDATE: o criador e carimbado no
    -- primeiro calculo e nao acompanha troca de titularidade.
    base_servicos = excluded.base_servicos,
    base_produtos = excluded.base_produtos,
    pct_servicos = excluded.pct_servicos,
    pct_produtos = excluded.pct_produtos,
    somente_comissionaveis = excluded.somente_comissionaveis,
    valor_servicos = excluded.valor_servicos,
    valor_produtos = excluded.valor_produtos,
    valor_comissao = excluded.valor_comissao,
    updated_at = now();
END;
$function$;

COMMENT ON FUNCTION public.recalcular_comissao_criacao_os(integer) IS
  'Recalcula a comissao de criacao da OS sobre a base liquida (mesmo fator de desconto da comissao de realizacao). Criador sem percentual: apaga a linha. Execucao encerrada: usa os percentuais congelados no snapshot.';

-- ---------------------------------------------------------------------------
-- 5) Os gatilhos
-- ---------------------------------------------------------------------------
-- Gatilhos proprios, em vez de estender os da comissao de realizacao: aqueles
-- sao por (os, servico) e nao olham produto, e redefini-los para acomodar uma
-- segunda regra tornaria os dois caminhos dificeis de ler em separado.

-- Itens da OS: servico, produto e produto avulso. DELETE traz o valor em OLD.
CREATE OR REPLACE FUNCTION public.tg_recalc_comissao_criacao_por_item()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalcular_comissao_criacao_os(old.ordemservicoid);
    RETURN NULL;
  END IF;

  PERFORM public.recalcular_comissao_criacao_os(new.ordemservicoid);

  -- Item movido de OS: a de origem tambem encolheu.
  IF TG_OP = 'UPDATE' AND old.ordemservicoid IS DISTINCT FROM new.ordemservicoid THEN
    PERFORM public.recalcular_comissao_criacao_os(old.ordemservicoid);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_comissao_criacao_osservico ON public.osservico;
CREATE TRIGGER trg_comissao_criacao_osservico
  AFTER INSERT OR UPDATE OR DELETE ON public.osservico
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_criacao_por_item();

DROP TRIGGER IF EXISTS trg_comissao_criacao_osproduto ON public.osproduto;
CREATE TRIGGER trg_comissao_criacao_osproduto
  AFTER INSERT OR UPDATE OR DELETE ON public.osproduto
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_criacao_por_item();

DROP TRIGGER IF EXISTS trg_comissao_criacao_osproduto_avulso ON public.osproduto_avulso;
CREATE TRIGGER trg_comissao_criacao_osproduto_avulso
  AFTER INSERT OR UPDATE OR DELETE ON public.osproduto_avulso
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_criacao_por_item();

-- Total da OS: o fator de desconto mudou, entao a base inteira muda.
CREATE OR REPLACE FUNCTION public.tg_recalc_comissao_criacao_os_total()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.recalcular_comissao_criacao_os(new.id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_comissao_criacao_os_total ON public.ordemservico;
CREATE TRIGGER trg_comissao_criacao_os_total
  AFTER UPDATE OF orcamentototal, valor_frete ON public.ordemservico
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_criacao_os_total();

-- Congelamento. AFTER UPDATE sem lista de colunas pelo mesmo motivo de
-- `trg_congelar_comissao_ao_encerrar_execucao`: `execucao_fim_em` e escrito por
-- um BEFORE quando o UPDATE menciona apenas `status`, e a clausula OF olha o SET
-- do comando, nao o que o BEFORE mudou.
CREATE OR REPLACE FUNCTION public.tg_congelar_comissao_criacao()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF new.execucao_fim_em IS NOT NULL AND old.execucao_fim_em IS NULL THEN
    PERFORM public.recarimbar_comissao_criacao_os(new.id);
    PERFORM public.recalcular_comissao_criacao_os(new.id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_congelar_comissao_criacao ON public.ordemservico;
CREATE TRIGGER trg_congelar_comissao_criacao
  AFTER UPDATE ON public.ordemservico
  FOR EACH ROW EXECUTE FUNCTION public.tg_congelar_comissao_criacao();

-- ---------------------------------------------------------------------------
-- 6) O evento financeiro
-- ---------------------------------------------------------------------------
-- Identica a versao de 20260903180000, com UM bloco a mais dentro do
-- `IF p_incluir_comissoes` que ja existia: a comissao de criacao.


CREATE OR REPLACE FUNCTION public.reconciliar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_os numeric := 0;
  v_bruto numeric := 0;
  v_frete numeric := 0;
  v_deducao numeric := 0;
BEGIN
  SELECT coalesce(o.orcamentototal, 0),
         round(coalesce(o.valor_frete, 0), 2),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                         FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                         FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os, v_frete, v_bruto
  FROM public.ordemservico o
  WHERE o.id = p_ordemservicoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'OS nao encontrada.'; END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS pg_temp.eventos_os_desejados (
    origem text NOT NULL,
    natureza text NOT NULL,
    chave_origem text NOT NULL,
    descricao text NOT NULL,
    detalhe text,
    valor numeric(14,2) NOT NULL,
    produtoid integer,
    servicoid integer,
    usuarioid uuid,
    quantidade_snapshot numeric(14,4),
    valor_unitario_snapshot numeric(14,4),
    percentual_snapshot numeric(8,4),
    valor_base_snapshot numeric(14,2),
    dados_snapshot jsonb NOT NULL,
    pode_gerar_transacao boolean NOT NULL,
    natureza_dre text,
    PRIMARY KEY (origem, natureza, chave_origem)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.eventos_os_desejados;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade, op.precounitario, null, null,
         jsonb_build_object('subtotal', op.subtotal, 'bruto', round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2)), false,
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA')
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'PRODUTO', 'RECEITA', 'AVULSO:' || opa.id,
         'Venda - ' || coalesce(nullif(opa.titulo, ''), 'Produto avulso #' || opa.id),
         opa.quantidade || ' unidade(s) (produto avulso)',
         round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2),
         null, null, null, opa.quantidade, opa.precounitario, null, null,
         jsonb_build_object(
           'produto_avulso', true,
           'produto_avulso_id', opa.id,
           'subtotal', opa.subtotal,
           'bruto', round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2)
         ), false,
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA')
  FROM public.osproduto_avulso opa
  WHERE opa.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         CASE
           WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'Custo registrado na OS'
           WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'Ultimo valor de compra do produto'
           WHEN coalesce(p.precocompra, 0) > 0 THEN 'Preco medio de compra do produto'
           ELSE 'Produto sem custo cadastrado'
         END,
         round(coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0)
               * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade,
         coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0), null, null,
         jsonb_build_object(
           'custo_nao_informado',
             coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0) = 0,
           'custo_origem', CASE
             WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'OS'
             WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'ULTIMA_COMPRA'
             WHEN coalesce(p.precocompra, 0) > 0 THEN 'PRECO_MEDIO'
             ELSE 'SEM_CUSTO'
           END), false,
         public.natureza_dre_de_evento('PRODUTO', 'DESPESA')
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         null, os.servicoid, null, os.quantidade, os.precounitario, null, null,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2)), false,
         public.natureza_dre_de_evento('SERVICO', 'RECEITA')
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
  WHERE os.ordemservicoid = p_ordemservicoid;

  IF v_frete > 0 THEN
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot,
       pode_gerar_transacao, natureza_dre)
    VALUES ('FRETE', 'RECEITA', 'FRETE',
            'Frete - OS #' || p_ordemservicoid, 'Receita de frete da ordem de servico',
            v_frete, jsonb_build_object('valor_frete', v_frete), false,
            public.natureza_dre_de_evento('FRETE', 'RECEITA'));
  END IF;

  v_deducao := round(greatest(v_bruto + v_frete - v_total_os, 0), 2);

  IF v_deducao > 0 THEN
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot,
       pode_gerar_transacao, natureza_dre)
    VALUES ('DESCONTO', 'DESPESA', 'DESCONTO',
            'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
            v_deducao, jsonb_build_object('bruto', v_bruto, 'frete', v_frete, 'total_os', v_total_os),
            false, public.natureza_dre_de_evento('DESCONTO', 'DESPESA'));
  END IF;

  IF p_incluir_comissoes THEN
    WITH comissoes AS (
      SELECT r.servicoid,
             r.usuarioid,
             coalesce(r.valor_comissao, 0) AS valor_comissao,
             r.valor_base,
             coalesce(r.comissao_percent_aplicada, 0) AS pct_proprio,
             -- Quem pagou a linha. A coluna efetiva e nula em vinculo anterior
             -- a regra do maior percentual; la a taxa individual era a que valia.
             coalesce(r.comissao_percent_efetiva, r.comissao_percent_aplicada, 0) AS pct_aplicado,
             count(*) OVER (PARTITION BY r.servicoid) AS realizadores,
             coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid) AS titulo,
             coalesce(os.subtotal, 0) AS subtotal_servico,
             coalesce(u.nome, 'Realizador') AS realizador_nome,
             coalesce(s.gera_comissao, true) AS comissiona
        FROM public.osservico_realizador r
        JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
        JOIN public.servico s ON s.id = r.servicoid
        LEFT JOIN public.usuario u ON u.id = r.usuarioid
       WHERE r.ordemservicoid = p_ordemservicoid
    )
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA', c.servicoid || ':' || c.usuarioid,
           'Comissão - ' || c.titulo,
           CASE WHEN NOT c.comissiona THEN
             c.realizador_nome || ' · serviço não gera comissão'
             || CASE WHEN c.realizadores > 1
                     THEN ' · executado por ' || c.realizadores || ' realizadores'
                     ELSE '' END
           ELSE
           c.realizador_nome
             || ' · ' || public.formatar_percentual_comissao(c.pct_aplicado) || '%'
             || CASE WHEN c.realizadores > 1
                     THEN ' (maior entre ' || c.realizadores || ' realizadores) sobre 1/'
                          || c.realizadores || ' do serviço'
                     ELSE ' do serviço' END
             -- A comissao sai do liquido: o desconto da OS e rateado entre os
             -- itens antes do calculo. Sem dizer isso, R$ 88,30 de 5% sobre um
             -- servico de R$ 1.800 parece erro de conta.
             --
             -- A tolerancia e de um centavo por realizador: a base e arredondada
             -- por pessoa, entao 333,33 x 3 fica um centavo abaixo de 1.000 sem
             -- que exista desconto nenhum.
             || CASE WHEN c.subtotal_servico - coalesce(c.valor_base, 0) * c.realizadores
                          > 0.01 * c.realizadores
                     THEN ', já com o desconto da OS'
                     ELSE '' END
             || CASE WHEN c.pct_proprio <> c.pct_aplicado
                     THEN ' · taxa própria ' || public.formatar_percentual_comissao(c.pct_proprio) || '%'
                     ELSE '' END
           END,
           -- Servico sem comissao ja tem valor_comissao zerado pelo recalculo; o
           -- greatest e cinto de seguranca para vinculo que nunca foi recalculado
           -- depois de a flag mudar, para nao publicar despesa que nao existe.
           CASE WHEN c.comissiona THEN c.valor_comissao ELSE 0 END,
           null, c.servicoid, c.usuarioid, null, null,
           CASE WHEN c.comissiona THEN c.pct_aplicado ELSE 0 END, c.valor_base,
           jsonb_build_object(
             'realizador_nome', c.realizador_nome,
             'percentual_aplicado', CASE WHEN c.comissiona THEN c.pct_aplicado ELSE 0 END,
             'percentual_proprio', c.pct_proprio,
             'realizadores_no_servico', c.realizadores,
             'valor_servico', c.subtotal_servico,
             'gera_comissao', c.comissiona
           ),
           -- Zero nao vira transacao: nao ha o que pagar.
           c.comissiona,
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA')
      FROM comissoes c;

    -- A comissao de criacao: uma linha por OS, do criador, sobre servicos e
    -- produtos. Origem COMISSAO reaproveitada com chave `CRIACAO:<uuid>`, que
    -- nao colide com a da realizacao (`<servicoid>:<uuid>`, comecando por
    -- digito) e herda o mapeamento da DRE, a proibicao de exclusao e o override
    -- manual que ja existem para comissao.
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA', 'CRIACAO:' || c.usuarioid,
           'Comissão de criação - OS #' || p_ordemservicoid,
           coalesce(u.nome, 'Criador') || ' · por ter criado a OS'
             || CASE WHEN c.pct_servicos > 0
                     THEN ' · ' || public.formatar_percentual_comissao(c.pct_servicos)
                          || '% dos serviços'
                     ELSE '' END
             || CASE WHEN c.pct_produtos > 0
                     THEN CASE WHEN c.pct_servicos > 0 THEN ' e ' ELSE ' · ' END
                          || public.formatar_percentual_comissao(c.pct_produtos)
                          || '% dos produtos'
                     ELSE '' END
             -- Mesma frase da comissao de realizacao, pelo mesmo motivo: a base
             -- e liquida, e sem dizer isso o valor parece erro de conta. A
             -- tolerancia de um centavo cobre o arredondamento das duas bases.
             || CASE WHEN (brutos.subtotal_servicos + brutos.subtotal_produtos)
                          - (c.base_servicos + c.base_produtos) > 0.02
                     THEN ', já com o desconto da OS'
                     ELSE '' END,
           c.valor_comissao,
           null, null, c.usuarioid, null, null,
           null, c.base_servicos + c.base_produtos,
           jsonb_build_object(
             'comissao_de_criacao', true,
             'criador_nome', coalesce(u.nome, 'Criador'),
             'base_servicos', c.base_servicos,
             'base_produtos', c.base_produtos,
             'pct_servicos', c.pct_servicos,
             'pct_produtos', c.pct_produtos,
             'valor_servicos', c.valor_servicos,
             'valor_produtos', c.valor_produtos,
             'somente_comissionaveis', c.somente_comissionaveis
           ),
           -- Zero nao vira transacao: nao ha o que pagar.
           c.valor_comissao > 0,
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA')
      FROM public.os_comissao_criacao c
      LEFT JOIN public.usuario u ON u.id = c.usuarioid
      CROSS JOIN LATERAL (
        SELECT
          coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os
                     WHERE os.ordemservicoid = c.ordemservicoid), 0) AS subtotal_servicos,
          coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op
                     WHERE op.ordemservicoid = c.ordemservicoid), 0)
            + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa
                         WHERE opa.ordemservicoid = c.ordemservicoid), 0) AS subtotal_produtos
      ) brutos
     WHERE c.ordemservicoid = p_ordemservicoid;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.eventos_financeiros e
    LEFT JOIN pg_temp.eventos_os_desejados d
      ON d.origem = e.origem AND d.natureza = e.natureza AND d.chave_origem = e.chave_origem
    WHERE e.ordemservicoid = p_ordemservicoid
      AND e.origem <> 'AVULSO'
      AND NOT coalesce(e.is_manual, false)
      AND e.status = 'CONVERTIDO'
      AND (d.chave_origem IS NULL OR e.valor <> d.valor)
  ) THEN
    RAISE EXCEPTION 'Existem eventos convertidos divergentes. Exclua as transacoes vinculadas antes de alterar o orcamento.';
  END IF;

  INSERT INTO public.eventos_financeiros (
    ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
    produtoid, servicoid, usuarioid, quantidade_snapshot, valor_unitario_snapshot,
    percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao,
    natureza_dre, status, updated_at
  )
  SELECT p_ordemservicoid, d.origem, d.natureza, d.chave_origem, d.descricao, d.detalhe, d.valor,
         d.produtoid, d.servicoid, d.usuarioid, d.quantidade_snapshot, d.valor_unitario_snapshot,
         d.percentual_snapshot, d.valor_base_snapshot, d.dados_snapshot, d.pode_gerar_transacao,
         d.natureza_dre, 'ATIVO', now()
  FROM pg_temp.eventos_os_desejados d
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO UPDATE SET
    descricao = excluded.descricao,
    detalhe = excluded.detalhe,
    valor = excluded.valor,
    produtoid = excluded.produtoid,
    servicoid = excluded.servicoid,
    usuarioid = excluded.usuarioid,
    quantidade_snapshot = excluded.quantidade_snapshot,
    valor_unitario_snapshot = excluded.valor_unitario_snapshot,
    percentual_snapshot = excluded.percentual_snapshot,
    valor_base_snapshot = excluded.valor_base_snapshot,
    dados_snapshot = excluded.dados_snapshot,
    pode_gerar_transacao = excluded.pode_gerar_transacao,
    -- Vem da linha mapeada no template; o coalesce so protege o valor ja gravado
    -- caso uma origem fique sem mapeamento algum.
    natureza_dre = coalesce(excluded.natureza_dre, eventos_financeiros.natureza_dre),
    status = 'ATIVO',
    updated_at = now()
  WHERE eventos_financeiros.status <> 'CONVERTIDO'
    AND NOT coalesce(eventos_financeiros.is_manual, false);

  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.ordemservicoid = p_ordemservicoid
     AND e.origem <> 'AVULSO'
     AND NOT coalesce(e.is_manual, false)
     AND e.status <> 'CONVERTIDO'
     AND NOT EXISTS (
       SELECT 1
       FROM pg_temp.eventos_os_desejados d
       WHERE d.origem = e.origem
         AND d.natureza = e.natureza
         AND d.chave_origem = e.chave_origem
     );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 7) OS sem cobranca nao tem comissao nenhuma
-- ---------------------------------------------------------------------------
-- Identica a versao de 20260806250000, com `origem = 'COMISSAO'` a mais na
-- lista de cancelamento.
--
-- O que muda e a LINHA, nao o dinheiro: a rota de status ja zera o orcamento
-- num UPDATE anterior ao da mudanca de status, o que zera o fator e faz as duas
-- comissoes sairem R$ 0,00. O que sobrava era a linha de R$ 0,00 no livro.
--
-- Isso reverte, SO PARA ESTE CASO, a escolha de 20260903180000 ("comissao
-- zerada consta no historico"). As duas convivem porque respondem a perguntas
-- diferentes: la, um servico com gera_comissao = false numa OS COBRADA — e a
-- linha zerada explica por que aquele realizador nao recebeu. Aqui, a OS
-- inteira nao gerou receita, e nao ha nada a explicar por linha. Sem esta nota,
-- a proxima leitura vai achar que uma das duas esta errada.
--
-- `status = 'ATIVO'` preserva o que ja virou transacao: comissao convertida e
-- dinheiro comprometido, e se desfaz pelo financeiro, nao pela troca de status.
CREATE OR REPLACE FUNCTION public.tg_reconciliar_eventos_ao_finalizar_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status::text = 'CANCELADO' then
    -- Cancelar a OS nao remove seus itens, entao reconciliar recriaria os
    -- eventos com valor cheio. O correto e encerra-los.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO';

  elsif new.status::text = 'SEM_COBRANCA' then
    -- Acerta custo pelo caminho normal...
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
    -- ...e retira receita, deducao e comissao, que nao existem numa OS sem
    -- cobranca. Sobra o custo da peca, que foi consumida de verdade.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO'
       and (natureza = 'RECEITA' or origem = 'DESCONTO' or origem = 'COMISSAO');

  elsif new.status::text = 'CONCLUIDO' then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;

  return new;
end;
$function$;

COMMIT;
