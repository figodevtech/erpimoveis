-- DRE — evento de OS criado depois do fim da execucao nascia sem competencia.
--
-- PROBLEMA
-- `competencia_em` de evento de OS so era preenchido pelo trigger
-- `trg_carimbar_competencia_eventos_os`, que dispara AFTER UPDATE OF
-- execucao_fim_em em ordemservico. Ele carimba todos os eventos que ja existem
-- naquele instante — e nada carimba os que nascem depois.
--
-- Como `dre_somar_por_linha` filtra `competencia_em IS NOT NULL`, todo evento
-- inserido apos o fim da execucao ficava fora da DRE. Sem erro, sem aviso: a
-- despesa simplesmente nao aparecia no relatorio.
--
-- Atinge mais do que o lancamento avulso da tela da OS:
--   1. AVULSO criado durante o PAGAMENTO (POST /eventos-financeiros);
--   2. eventos novos vindos de `reconciliar_eventos_financeiros_os` — o insert
--      dessa funcao nao lista `competencia_em`, entao um produto acrescentado
--      ao orcamento depois da execucao entrava mudo;
--   3. qualquer caminho futuro que insira na tabela.
--
-- SOLUCAO
-- Trigger BEFORE INSERT que copia `execucao_fim_em` da OS quando a linha nao
-- traz competencia propria. Fica no banco, e nao na rota, justamente porque os
-- tres casos acima entram por portas diferentes.
--
-- A regra nao muda: competencia de OS continua sendo o fim da execucao, e
-- continua NULL enquanto o servico nao foi entregue. Eventos de venda e de
-- transacao chegam com `ordemservicoid` nulo e competencia ja preenchida, entao
-- o trigger nao os alcanca.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_carimbar_competencia_evento_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.competencia_em is null and new.ordemservicoid is not null then
    select o.execucao_fim_em
      into new.competencia_em
      from public.ordemservico o
     where o.id = new.ordemservicoid;
  end if;
  return new;
end;
$function$;

COMMENT ON FUNCTION public.tg_carimbar_competencia_evento_novo() IS
  'Carimba a competencia de evento de OS criado depois do fim da execucao. Sem isso o evento fica fora da DRE, que filtra competencia_em not null.';

DROP TRIGGER IF EXISTS trg_carimbar_competencia_evento_novo ON public.eventos_financeiros;
CREATE TRIGGER trg_carimbar_competencia_evento_novo
BEFORE INSERT ON public.eventos_financeiros
FOR EACH ROW EXECUTE FUNCTION public.tg_carimbar_competencia_evento_novo();

-- Recupera os eventos que ja nasceram orfaos. Mesma regra do trigger: so OS com
-- execucao encerrada, so evento ainda sem competencia, cancelado fica de fora.
UPDATE public.eventos_financeiros e
   SET competencia_em = o.execucao_fim_em,
       updated_at = now()
  FROM public.ordemservico o
 WHERE o.id = e.ordemservicoid
   AND o.execucao_fim_em IS NOT NULL
   AND e.competencia_em IS NULL
   AND e.status <> 'CANCELADO';

COMMIT;
