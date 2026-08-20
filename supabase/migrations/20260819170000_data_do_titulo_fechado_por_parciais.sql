-- A data de liquidação do título fechado por baixas parciais.
--
-- O QUE ESTAVA ERRADO
-- `data` é a data de liquidação: a baixa comum a move do vencimento para o dia do
-- pagamento, e é por ela que as listas e os KPIs recortam o período. Quem fecha um
-- título em 19/08 espera vê-lo em agosto.
--
-- A baixa parcial (20260819130000) nunca mexeu em `data` do título — o dinheiro
-- estava nas filhas, e mexer no pai parecia desnecessário. Só que quando as
-- parciais cobrem o valor o título FECHA, e fechava carregando ainda a data do
-- vencimento. Dois títulos de R$ 1.000 quitados no mesmo 19/08 caíam em meses
-- diferentes:
--
--   baixado de uma vez ....... data = 19/08  (aparece em agosto)
--   fechado por parciais ..... data = 10/07  (aparecia em julho)
--
-- A CORREÇÃO
-- Quando as parciais fecham o título, `data` vai para o dia do último pagamento —
-- o mesmo que `pago_em` já registrava. Quando um estorno o reabre, `data` volta ao
-- vencimento, que é o que a baixa comum também faz ao ser estornada.
--
-- Título antecipado não entra aqui: nele quem fecha é a baixa, não a soma das
-- filhas, e ela já gravou a data informada. A função devolve antes de chegar
-- neste ponto.
BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_baixas_transacao(p_transacao_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_baixado numeric(14,2);
  v_quantas int;
  v_liquido numeric(14,2);
  v_ultimo_pago timestamptz;
  v_antecipado boolean;
  v_fechou boolean;
BEGIN
  SELECT coalesce(sum(coalesce(nullif(f."valorLiquido", 0), f.valor)), 0),
         count(*), max(f.pago_em)
    INTO v_baixado, v_quantas, v_ultimo_pago
    FROM public.transacao f
   WHERE f.baixa_de_transacao_id = p_transacao_id
     AND f.is_deleted = false;

  SELECT coalesce(nullif(t."valorLiquido", 0), t.valor), t.adiantamento_id IS NOT NULL
    INTO v_liquido, v_antecipado
    FROM public.transacao t WHERE t.id = p_transacao_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF round(v_baixado, 2) > round(coalesce(v_liquido, 0), 2) THEN
    RAISE EXCEPTION
      'As baixas do título #% somam % e passam do valor dele (%).',
      p_transacao_id, v_baixado, v_liquido USING ERRCODE = '22023';
  END IF;

  IF v_quantas = 0 THEN
    UPDATE public.transacao SET valor_baixado = 0, updated_at = now()
     WHERE id = p_transacao_id AND valor_baixado <> 0;
    RETURN;
  END IF;

  /*
   * Em título antecipado a filha é REPASSE DE CAIXA, não quitação.
   *
   * A antecipação já respondeu pelo principal; o que entra agora é só a parte
   * que o banco não reteve. Quem fecha o título é a baixa, que sabe que o boleto
   * foi pago por inteiro — e ela já gravou a data informada.
   */
  IF coalesce(v_antecipado, false) THEN
    UPDATE public.transacao
       SET valor_baixado = round(v_baixado, 2), updated_at = now()
     WHERE id = p_transacao_id;
    RETURN;
  END IF;

  v_fechou := round(v_baixado, 2) >= round(coalesce(v_liquido, 0), 2);

  UPDATE public.transacao
     SET valor_baixado = round(v_baixado, 2),
         pendente = NOT v_fechou,
         pago_em = CASE WHEN v_fechou THEN v_ultimo_pago ELSE NULL END,
         -- `data` é a data de liquidação, e é por ela que as listas recortam o
         -- período. Fechado, o título vale pelo dia do último pagamento; reaberto
         -- por estorno, volta a valer pelo vencimento — a mesma ida e volta que a
         -- baixa comum e o estorno dela já fazem.
         data = CASE
           WHEN v_fechou THEN coalesce(v_ultimo_pago, data)
           ELSE coalesce(vencimento_em, data)
         END,
         updated_at = now()
   WHERE id = p_transacao_id;
END;
$function$;

ALTER FUNCTION public.recalcular_baixas_transacao(bigint) OWNER TO postgres;

COMMENT ON FUNCTION public.recalcular_baixas_transacao(bigint) IS
  'Refaz valor_baixado do título a partir das baixas parciais dele, e decide se está aberto. Fechado, leva `data` para o dia do último pagamento; reaberto, devolve ao vencimento. Em título antecipado só atualiza o valor: lá quem fecha é a baixa, porque a filha é repasse de caixa e não quitação.';

COMMIT;
