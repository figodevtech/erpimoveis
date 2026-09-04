-- Apurar a comissao de criacao de uma OS que ja encerrou.
--
-- 20260904130000 fechou essa porta de proposito: OS com execucao encerrada e
-- nunca apurada nao ganha comissao depois. Sem a guarda, ligar o beneficio no
-- cadastro e depois mexer numa ordem antiga — corrigir um item, reabrir o
-- orcamento — criaria comissao num mes ja publicado, sem ninguem pedir.
--
-- O QUE MUDA
-- A guarda continua sendo o padrao. Ganha uma saida explicita, `p_forcar`, que
-- so quem chama nomeando a OS consegue acionar: e o caminho de quando a decisao
-- de pagar retroativamente foi tomada por uma pessoa, para ordens escolhidas a
-- dedo. Nenhum gatilho passa `true` — todos continuam chamando com um argumento
-- so, e o default os mantem no comportamento de antes.
--
-- POR QUE DROP E NAO SO REPLACE
-- Acrescentar um parametro cria uma SEGUNDA funcao, e `f(x)` passaria a ser
-- ambiguo entre as duas. O DROP e seguro: corpo de funcao nao e dependencia
-- rastreada no Postgres, entao os gatilhos que a chamam por nome continuam
-- validos e resolvem para a assinatura nova na proxima execucao.

BEGIN;

DROP FUNCTION IF EXISTS public.recalcular_comissao_criacao_os(integer);

CREATE OR REPLACE FUNCTION public.recalcular_comissao_criacao_os(
  p_ordemservicoid integer,
  p_forcar boolean DEFAULT false
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

  -- Execucao encerrada e nunca apurada: fica assim, a menos que alguem tenha
  -- pedido nomeando a OS. Ver o cabecalho desta migration.
  IF NOT v_existe AND v_execucao_encerrada AND NOT p_forcar THEN
    RETURN;
  END IF;

  -- Forcar tambem significa reler o cadastro: a apuracao retroativa existe
  -- justamente porque os percentuais de hoje ainda nao tinham sido aplicados.
  IF p_forcar THEN
    v_execucao_encerrada := false;
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

COMMENT ON FUNCTION public.recalcular_comissao_criacao_os(integer, boolean) IS
  'Recalcula a comissao de criacao da OS sobre a base liquida. Criador sem percentual: apaga a linha. Execucao encerrada: usa os percentuais congelados no snapshot, e nao apura o que nunca foi apurado — salvo com p_forcar, a apuracao retroativa pedida OS a OS.';

COMMIT;
