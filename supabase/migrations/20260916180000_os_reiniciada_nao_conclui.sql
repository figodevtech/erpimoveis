-- OS reiniciada não é OS concluída.
--
-- O QUE ESTAVA ERRADO
-- Voltar a OS para orçamento — o "reiniciar" — já apaga os recebimentos
-- (20260809200000), mas deixava o carimbo `execucao_fim_em`. E o carimbo é a
-- definição de OS concluída no sistema inteiro (20260902100000).
--
-- A OS #346 do Demir, devolvida de PAGAMENTO para ORCAMENTO em 16/09/2026,
-- continuou assim:
--   - concluída no dashboard, que lê só o carimbo;
--   - na DRE de setembro, porque a competência dos eventos da OS é o carimbo:
--     R$ 6.300 de receita, R$ 1.240 de despesa e R$ 63 de comissão.
-- A Central Pessoal e o relatório de comissão só escaparam porque também
-- filtram por status — que é justamente o que a regra do carimbo existe para
-- tornar desnecessário.
--
-- Não é caso raro. No Demir a OS voltou de PAGAMENTO para ORCAMENTO 37 vezes e
-- de EM_ANDAMENTO 32; na Garage, 2 e 5. Só a #346 ficou presa porque todas as
-- outras voltaram a EM_ANDAMENTO, que apaga o carimbo.
--
-- A CORREÇÃO
-- A mesma do cancelamento: consertar na origem. Status anterior à execução não
-- tem conclusão, e `fn_os_execucao_set_times` apaga o carimbo. A competência sai
-- junto sem código novo — `tg_carimbar_competencia_eventos_os` copia o carimbo
-- para os eventos da OS —, e evento sem competência a DRE não soma.
--
-- Medido nos três bancos: OS em status anterior à execução e sem carimbo tem
-- eventos ativos, nenhum com competência. É o estado para onde a #346 vai.
--
-- A lista cobre todos os status anteriores à execução, não só ORCAMENTO. Hoje o
-- reinício só usa ORCAMENTO, mas o carimbo é inválido em qualquer um deles, e a
-- regra é idempotente como a do cancelamento: não depende de pegar a transição.
--
-- O QUE ISTO NÃO MEXE
-- - `execucao_inicio_em`, pelo motivo do cancelamento: a execução começou de
--   fato. E é ele que permite PAGAMENTO carimbar o fim de novo.
-- - Os eventos. Receita, despesa e comissão continuam ATIVOS, só perdem a
--   competência. Cancelar a comissão aqui abriria outro buraco: voltar a
--   EM_ANDAMENTO publica com `sincronizar_eventos_financeiros_os`, que não
--   reativa evento cancelado, e a comissão sumiria da fila até o pagamento.
-- - A Central Pessoal: o filtro de status dela fica como está.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Daqui para a frente
-- ---------------------------------------------------------------------------
-- Idêntica à de 20260902100000, com a quarta regra no fim.
CREATE OR REPLACE FUNCTION public.fn_os_execucao_set_times()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  -- Quando entra em EM_ANDAMENTO, marca início (só se ainda não tiver)
  if (new.status::text = 'EM_ANDAMENTO' and old.status is distinct from new.status) then
    new.execucao_inicio_em := coalesce(old.execucao_inicio_em, now());
    new.execucao_fim_em := null; -- se voltar para andamento, reabre a execução
  end if;

  -- Quando entra em PAGAMENTO, marca fim (só se tiver início e ainda não tiver fim)
  if (new.status::text = 'PAGAMENTO' and old.status is distinct from new.status) then
    if (old.execucao_inicio_em is not null) then
      new.execucao_inicio_em := old.execucao_inicio_em;
      new.execucao_fim_em := coalesce(old.execucao_fim_em, now());
    end if;
  end if;

  -- Cancelar desfaz a conclusão: o carimbo é o que define OS concluída no
  -- sistema inteiro, e trabalho cancelado não é produção.
  if (new.status::text = 'CANCELADO') then
    new.execucao_fim_em := null;
  end if;

  -- Reiniciar também: OS de volta ao orçamento não terminou trabalho nenhum.
  if (new.status::text in (
        'AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO',
        'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO')) then
    new.execucao_fim_em := null;
  end if;

  return new;
end;
$function$;

ALTER FUNCTION public.fn_os_execucao_set_times() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_os_execucao_set_times() IS
  'Mantém execucao_inicio_em e execucao_fim_em conforme o status: abre em EM_ANDAMENTO, fecha em PAGAMENTO e desfaz a conclusão em CANCELADO e nos status anteriores à execução. O carimbo de fim é o que define "OS concluída" em todo o sistema, então quem muda status é quem responde por ele.';

-- ---------------------------------------------------------------------------
-- 2) O que já está gravado
-- ---------------------------------------------------------------------------
-- Diferente do cancelamento, os gatilhos ficam ligados: o de competência é o
-- que tira os eventos da DRE, e é exatamente o efeito desejado. Os gatilhos que
-- avisam e notificam são `UPDATE OF status` e não disparam aqui.
UPDATE public.ordemservico
   SET execucao_fim_em = NULL
 WHERE status::text IN ('AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO',
                        'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO')
   AND execucao_fim_em IS NOT NULL;

COMMIT;
