-- Servico com mais de um realizador passa a adotar o MAIOR percentual entre
-- eles, e o valor e dividido pela quantidade de realizadores.
--
-- Antes cada um recebia a sua propria taxa sobre a propria fatia: num servico
-- de R$ 5.000 com dois realizadores a 10% e 5%, saiam R$ 250 para um e R$ 125
-- para o outro. Agora adota-se 10% e divide-se por 2 — R$ 250 para cada.
--
-- A conta ja cai naturalmente na estrutura existente: `valor_base` sempre foi o
-- subtotal liquido dividido pela quantidade de realizadores, entao aplicar o
-- maior percentual sobre ele e exatamente "calcular pelo maior e dividir pela
-- quantidade". Nao ha caminho novo de rateio.
--
-- DE ONDE VEM O PERCENTUAL. Do carimbo do vinculo (`comissao_percent_aplicada`),
-- que guarda a taxa de cada um na epoca em que o servico foi feito — e nao do
-- cadastro de hoje. Ha realizador cujo cadastro subiu depois do trabalho
-- encerrado; ler o cadastro faria um aumento reescrever comissao antiga a cada
-- recalculo, e o carimbo existe justamente para impedir isso.
--
-- O QUE NAO MUDA. `comissao_percent_aplicada` continua sendo a taxa individual
-- de cada realizador e nao e sobrescrita. Sobrescreve-la com o maior pareceria
-- mais simples, mas e uma catraca: removido o realizador de taxa alta, o que
-- fica herdaria a taxa dele para sempre. Quem paga passa a viver na coluna nova
-- `comissao_percent_efetiva`, escrita pelo recalculo — assim
-- `valor_base x percentual efetivo = valor_comissao` fecha em qualquer
-- relatorio, sem perder o historico individual.
--
-- OS JA ENCERRADAS NAO SAO REPROCESSADAS: mesma convencao da flag
-- `gera_comissao`. O valor gravado e historico e so muda se algo disparar o
-- recalculo daquele item. Por isso esta migracao nao faz backfill.

BEGIN;

-- 1) A taxa que de fato pagou a linha.
ALTER TABLE public.osservico_realizador
  ADD COLUMN IF NOT EXISTS comissao_percent_efetiva numeric;

COMMENT ON COLUMN public.osservico_realizador.comissao_percent_efetiva IS
  'Percentual que gerou valor_comissao: o maior entre os realizadores do servico. Nulo em vinculo anterior a esta regra, quando valia comissao_percent_aplicada.';

COMMENT ON COLUMN public.osservico_realizador.comissao_percent_aplicada IS
  'Taxa individual do realizador no momento do vinculo. Preservada como historico; quem paga e comissao_percent_efetiva.';

-- 2) Recalculo: mesma base liquida de antes, percentual agora e o maior do grupo.
CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
  v_total_itens numeric := 0;
  v_total_os_sem_frete numeric := 0;
  v_fator numeric := 1;
  v_base_liquida numeric;
  v_percent_maior numeric := 0;
BEGIN
  SELECT coalesce(s.subtotal, 0) INTO v_subtotal
    FROM public.osservico s
   WHERE s.ordemservicoid = p_ordemservicoid AND s.servicoid = p_servicoid;
  SELECT coalesce(sv.gera_comissao, true) INTO v_gera_comissao
    FROM public.servico sv WHERE sv.id = p_servicoid;
  SELECT count(*) INTO v_qtd FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
  IF v_qtd <= 0 THEN RETURN; END IF;

  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os_sem_frete, v_total_itens
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;
  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;
  v_base_liquida := round(v_subtotal * v_fator / v_qtd, 2);

  -- O maior percentual entre quem executou. Com um realizador so, e a taxa dele
  -- e nada muda em relacao ao comportamento anterior.
  SELECT coalesce(max(coalesce(r.comissao_percent_aplicada, 0)), 0)
    INTO v_percent_maior
    FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;

  -- Servico que nao comissiona zera a taxa efetiva, e nao so o valor: assim a
  -- linha zerada no relatorio se explica sozinha.
  IF NOT coalesce(v_gera_comissao, true) THEN
    v_percent_maior := 0;
  END IF;

  UPDATE public.osservico_realizador r
     SET valor_base = v_base_liquida,
         comissao_percent_efetiva = v_percent_maior,
         valor_comissao = round(v_base_liquida * v_percent_maior / 100.0, 2),
         updated_at = now()
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
END;
$function$;

-- 3) Entrar ou sair um realizador muda a quantidade e pode mudar o maior
--    percentual, entao o rateio precisa ser refeito nesse instante.
--
--    Antes o recalculo so era disparado por mudanca de `orcamentototal` ou
--    `valor_frete` na OS: adicionar um segundo realizador nao redividia nada
--    ate alguem mexer no total. Com a regra do maior percentual isso seria pior
--    ainda, porque o efeito da regra so apareceria por acidente.
--
--    So INSERT e DELETE: o proprio recalculo faz UPDATE nesta tabela, e incluir
--    UPDATE aqui criaria recursao infinita.
CREATE OR REPLACE FUNCTION public.tg_recalc_comissao_realizadores()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_os integer;
  v_servico integer;
BEGIN
  IF tg_op = 'DELETE' THEN
    v_os := old.ordemservicoid;
    v_servico := old.servicoid;
  ELSE
    v_os := new.ordemservicoid;
    v_servico := new.servicoid;
  END IF;

  PERFORM public.recalcular_comissao_osservico(v_os, v_servico);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_comissao_realizadores ON public.osservico_realizador;
CREATE TRIGGER trg_recalc_comissao_realizadores
AFTER INSERT OR DELETE ON public.osservico_realizador
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_realizadores();

COMMIT;
