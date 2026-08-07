-- DRE vazia: a competencia nunca era carimbada no caminho normal da OS.
--
-- PROBLEMA
-- Duas pecas que nunca se encontraram:
--
--   trg_os_execucao_set_times          BEFORE UPDATE OF status
--     -> ao entrar em PAGAMENTO, preenche new.execucao_fim_em
--
--   trg_carimbar_competencia_eventos_os  AFTER UPDATE OF execucao_fim_em
--     -> carimba competencia_em nos eventos da OS
--
-- No PostgreSQL, `UPDATE OF coluna` dispara apenas quando a coluna aparece no
-- SET do comando — nao quando ela e preenchida por um trigger BEFORE. Como a
-- aplicacao envia `UPDATE ordemservico SET status = 'PAGAMENTO'`, quem escreve
-- `execucao_fim_em` e o trigger BEFORE, e o AFTER nunca dispara.
--
-- Efeito: OS com `execucao_fim_em` preenchido e todos os eventos com
-- `competencia_em` nulo. Como `dre_somar_por_linha` filtra
-- `competencia_em IS NOT NULL`, a OS inteira — receita e custo — fica fora da
-- DRE. Verificado em producao: 38 eventos, nenhum com competencia.
--
-- So funcionava pelo caminho da execucao
-- (POST /api/execucao/.../finalizar), que menciona `execucao_fim_em` no proprio
-- UPDATE. Quem envia a OS para pagamento pela tela de status nunca carimbava.
--
-- SOLUCAO
-- Disparar em qualquer UPDATE da linha e filtrar pela clausula WHEN, que le o
-- valor efetivo de NEW — ja depois dos triggers BEFORE. A funcao nao muda.
BEGIN;

DROP TRIGGER IF EXISTS trg_carimbar_competencia_eventos_os ON public.ordemservico;
CREATE TRIGGER trg_carimbar_competencia_eventos_os
AFTER UPDATE ON public.ordemservico
FOR EACH ROW
WHEN (new.execucao_fim_em IS DISTINCT FROM old.execucao_fim_em)
EXECUTE FUNCTION public.tg_carimbar_competencia_eventos_os();

COMMIT;
