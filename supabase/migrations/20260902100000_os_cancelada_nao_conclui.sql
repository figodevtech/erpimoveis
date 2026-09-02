-- OS cancelada não é OS concluída.
--
-- O QUE ESTAVA ERRADO
-- No sistema inteiro, "OS concluída" é `execucao_fim_em` carimbado — não o
-- status. `isServiceOrderCompleted` responde por esse carimbo, e o dashboard, a
-- Central Pessoal e a DRE seguem a mesma definição.
--
-- Só que cancelar uma OS nunca apagou o carimbo: `PUT /api/ordens/[id]/cancelar`
-- grava `status` e `motivo_cancelamento`, e mais nada. Uma OS que foi executada
-- e depois cancelada continuava atendendo à definição de concluída — entrava na
-- contagem, somava no valor e contava tempo médio.
--
-- Deu para medir: em agosto/2026 no Demir, o card "Valor concluído" do dashboard
-- mostrava R$ 366.637,50 e o relatório de ordens, para o mesmo período e o mesmo
-- eixo de data, mostrava R$ 345.837,50. A diferença eram exatamente três OS
-- canceladas — #178, #213 e #257, R$ 20.800,00. O relatório filtra por status; o
-- dashboard, por carimbo. Dois lugares, dois números, o mesmo mês.
--
-- A CORREÇÃO
-- Consertar na origem, não em cada leitor: cancelar apaga o carimbo. Assim a
-- definição continua uma só — quem tem `execucao_fim_em` concluiu — e nenhuma
-- consulta precisa aprender uma lista de status.
--
-- A ideia já existe no schema: `fn_os_execucao_set_times` apaga o carimbo quando
-- a OS volta para EM_ANDAMENTO ("se voltar para andamento, reabre a execução").
-- Cancelar é o mesmo caso, e por isso a regra entra nessa função em vez de virar
-- um gatilho concorrente disputando a mesma coluna.
--
-- O QUE ISTO NÃO MEXE
-- A DRE. `tg_carimbar_competencia_eventos_os` propaga a mudança do carimbo para
-- `eventos_financeiros.competencia_em`, mas só em evento com status <> 'CANCELADO'
-- — e cancelar a OS já cancela os eventos dela. Conferido nos quatro bancos antes
-- de escrever isto: nenhum evento com competência preenchida seria afetado.
--
-- `execucao_inicio_em` fica. Só o fim é que deixa de valer: a execução começou
-- mesmo, e o que o cancelamento desfaz é a conclusão.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Daqui para a frente
-- ---------------------------------------------------------------------------
--
-- A função vinha do baseline e nunca esteve numa migration própria; fica agora
-- versionada por inteiro. As duas regras antigas estão intactas — a terceira é
-- a nova.
--
-- A regra do cancelamento não pede `old.status is distinct from new.status` como
-- as outras duas: qualquer update que deixe a linha em CANCELADO limpa o carimbo.
-- É idempotente e conserta sozinha qualquer linha que volte a ganhar carimbo
-- estando cancelada, em vez de depender de pegar a transição no ato.
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

  return new;
end;
$function$;

ALTER FUNCTION public.fn_os_execucao_set_times() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_os_execucao_set_times() IS
  'Mantém execucao_inicio_em e execucao_fim_em conforme o status: abre em EM_ANDAMENTO, fecha em PAGAMENTO e desfaz a conclusão em CANCELADO. O carimbo de fim é o que define "OS concluída" em todo o sistema, então quem muda status é quem responde por ele.';

-- O gatilho já existe como BEFORE UPDATE OF status; recriado aqui só para que a
-- migration seja completa em si mesma se rodar num banco novo.
DROP TRIGGER IF EXISTS trg_os_execucao_set_times ON public.ordemservico;
CREATE TRIGGER trg_os_execucao_set_times
  BEFORE UPDATE OF status ON public.ordemservico
  FOR EACH ROW EXECUTE FUNCTION public.fn_os_execucao_set_times();

-- ---------------------------------------------------------------------------
-- 2) O que já está gravado
-- ---------------------------------------------------------------------------
--
-- Os gatilhos saem do caminho: este UPDATE toca uma coluna e mais nada, mas os
-- AFTER UPDATE da ordemservico (evento da central, notificação, reconciliação de
-- eventos financeiros) reprocessariam OS canceladas meses atrás e chegariam a
-- disparar aviso sobre elas. Nenhum gatilho da ordemservico está desativado de
-- propósito hoje — conferido nos quatro bancos —, então ENABLE devolve o estado.
ALTER TABLE public.ordemservico DISABLE TRIGGER USER;

UPDATE public.ordemservico
   SET execucao_fim_em = NULL
 WHERE status::text = 'CANCELADO'
   AND execucao_fim_em IS NOT NULL;

ALTER TABLE public.ordemservico ENABLE TRIGGER USER;

COMMIT;
