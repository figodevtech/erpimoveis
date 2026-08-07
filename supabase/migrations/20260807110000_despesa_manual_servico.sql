-- Despesas manuais diretamente relacionadas a um servico da OS usam a origem
-- SERVICO e a natureza DESPESA. Na DRE elas representam custo direto do
-- servico prestado, separado da comissao automatica (mao de obra direta).
BEGIN;

-- A carga generica de auditoria exclui tabelas cujo nome contem "evento" para
-- evitar logs tecnicos. Eventos financeiros da OS, porem, sao registros de
-- negocio editaveis e precisam aparecer no historico do painel de detalhes.
DROP TRIGGER IF EXISTS auditoria_linha ON public.eventos_financeiros;
DROP TRIGGER IF EXISTS auditoria_evento_financeiro_insert ON public.eventos_financeiros;
DROP TRIGGER IF EXISTS auditoria_evento_financeiro_update ON public.eventos_financeiros;
DROP TRIGGER IF EXISTS auditoria_evento_financeiro_delete ON public.eventos_financeiros;

-- Audita apenas eventos que nasceram manuais ou receberam uma intervencao
-- manual. Eventos automaticos sao numerosos e ja podem ser reconstruidos a
-- partir dos itens da OS; registra-los aqui poluiria o historico do usuario.
CREATE TRIGGER auditoria_evento_financeiro_insert
AFTER INSERT ON public.eventos_financeiros
FOR EACH ROW WHEN (new.is_manual)
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER auditoria_evento_financeiro_update
AFTER UPDATE ON public.eventos_financeiros
FOR EACH ROW WHEN (old.is_manual OR new.is_manual)
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER auditoria_evento_financeiro_delete
AFTER DELETE ON public.eventos_financeiros
FOR EACH ROW WHEN (old.is_manual)
EXECUTE FUNCTION public.registrar_auditoria();

WITH template AS (
  SELECT id
  FROM public.dre_template
  WHERE codigo = 'PADRAO' AND versao = 1
), linha AS (
  SELECT dl.id, dl.template_id
  FROM public.dre_linha dl
  JOIN template t ON t.id = dl.template_id
  WHERE dl.codigo = '4.3'
)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT linha.template_id, linha.id, 'EVENTO_ORIGEM', 'SERVICO:DESPESA', 100,
       'Despesa manual vinculada a receita de um servico da ordem de servico.'
FROM linha
WHERE NOT EXISTS (
  SELECT 1
  FROM public.dre_mapeamento existente
  WHERE existente.template_id = linha.template_id
    AND existente.origem_tipo = 'EVENTO_ORIGEM'
    AND existente.origem_valor = 'SERVICO:DESPESA'
);

COMMIT;
