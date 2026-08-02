-- Passa a calcular a comissao sobre o valor liquido da OS, nao sobre o bruto.
--
-- Antes: a receita do servico ja era registrada com o desconto da OS aplicado
-- (subtotal * fator), mas a comissao saia sobre o subtotal cheio. Numa OS de
-- R$ 200 com 20% de desconto e realizador a 10%, a oficina registrava R$ 160 de
-- receita e pagava R$ 20 de comissao — taxa efetiva de 12,5% sobre o que
-- entrou. O desconto era absorvido inteiramente pela oficina.
--
-- Agora o mesmo fator de desconto/acrescimo da OS entra na base da comissao:
-- no exemplo acima, R$ 160 de receita e R$ 16 de comissao, mantendo os 10%.
--
-- A mudanca e feita em `recalcular_comissao_osservico`, que e a fonte da
-- verdade: `valor_base` e `valor_comissao` passam a ser liquidos, e tudo que le
-- essas colunas (relatorio de comissao do usuario, eventos financeiros) segue
-- junto automaticamente. Aplicar o fator so na geracao do evento criaria
-- justamente a divergencia entre relatorio e financeiro que acabamos de fechar.
--
-- `valor_base` muda de significado: passa a ser a fatia liquida do realizador.
--
-- Como o fator depende de `ordemservico.orcamentototal`, que nao dispara os
-- gatilhos existentes (eles observam osservico_realizador e osservico.subtotal),
-- esta migracao acrescenta um gatilho na propria OS: mudou o total, as comissoes
-- dos servicos daquela OS sao recalculadas. Sem ele, editar o desconto deixaria
-- a comissao defasada ate alguem mexer nos realizadores.
--
-- OS ja fechadas nao sao reprocessadas: o recalculo so ocorre quando algo muda.
BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
  v_total_itens numeric := 0;
  v_total_os numeric := 0;
  v_fator numeric := 1;
  v_base_liquida numeric;
begin
  select coalesce(s.subtotal, 0)
    into v_subtotal
  from public.osservico s
  where s.ordemservicoid = p_ordemservicoid
    and s.servicoid = p_servicoid;

  -- Servico ausente (item removido do cadastro) mantem o comportamento antigo.
  select coalesce(sv.gera_comissao, true)
    into v_gera_comissao
  from public.servico sv
  where sv.id = p_servicoid;

  select count(*)
    into v_qtd
  from public.osservico_realizador r
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;

  if v_qtd <= 0 then
    return;
  end if;

  -- Mesmo fator usado pelos eventos financeiros: distribui o desconto (ou o
  -- acrescimo) da OS proporcionalmente entre os itens.
  select coalesce(o.orcamentototal, 0),
         coalesce((select sum(coalesce(op.subtotal, 0)) from public.osproduto op where op.ordemservicoid = o.id), 0)
           + coalesce((select sum(coalesce(os.subtotal, 0)) from public.osservico os where os.ordemservicoid = o.id), 0)
    into v_total_os, v_total_itens
  from public.ordemservico o
  where o.id = p_ordemservicoid;

  if v_total_itens > 0 then
    v_fator := v_total_os / v_total_itens;
  end if;

  v_base_liquida := round(v_subtotal * v_fator / v_qtd, 2);

  update public.osservico_realizador r
  set
    valor_base = v_base_liquida,
    valor_comissao = case
      when coalesce(v_gera_comissao, true)
        then round(v_base_liquida * coalesce(r.comissao_percent_aplicada, 0) / 100.0, 2)
      else 0
    end,
    updated_at = now()
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;
end;
$function$;

-- Mudou o total da OS (desconto, acrescimo, item novo) -> refaz as comissoes.
CREATE OR REPLACE FUNCTION public.tg_recalc_comissao_os_total()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.orcamentototal is distinct from old.orcamentototal then
    perform public.recalcular_comissao_osservico(new.id, s.servicoid)
      from public.osservico s
     where s.ordemservicoid = new.id;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_comissao_os_total ON public.ordemservico;
CREATE TRIGGER trg_recalc_comissao_os_total
AFTER UPDATE OF orcamentototal ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_comissao_os_total();

COMMIT;
