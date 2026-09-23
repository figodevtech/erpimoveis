-- Ciência de aviso fiscal: o vínculo com a NF-e passa a ser por uso.
--
-- A primeira versão ligava ao salvar todas as ciências da sessão de emissão
-- (WHERE escopo = ...). Se o usuário confirmava o aviso A, depois mudava o item
-- e confirmava o aviso B, as duas apareciam ligadas à nota, embora só B tivesse
-- liberado a emissão. O snapshot fiscal estava certo; a tabela, não.
--
-- O código agora liga só os ids que casaram com os avisos da situação final
-- (nfe_item.tributacao_snapshot.icmsDecisao.avisosConfirmados[].ciencia.id).
-- Aqui: o comentário da coluna e a correção dos vínculos feitos pela regra
-- anterior. Ciência ligada a uma NF-e cujo snapshot não a cita volta a
-- nfe_id NULL; ela continua na tabela como ato histórico. O gatilho de
-- auditoria aceita esse UPDATE (id -> NULL).
--
-- Idempotente: rodar de novo não muda nada.
BEGIN;

COMMENT ON COLUMN public.nfe_ciencia_aviso.nfe_id IS
  'NF-e cujo aviso esta ciência liberou (o snapshot do item cita o id). NULL se ela nunca foi usada — a situação mudou antes de salvar — ou se o rascunho foi descartado.';

UPDATE public.nfe_ciencia_aviso c
   SET nfe_id = NULL
 WHERE c.nfe_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.nfe_item i
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(i.tributacao_snapshot -> 'icmsDecisao' -> 'avisosConfirmados') = 'array'
            THEN i.tributacao_snapshot -> 'icmsDecisao' -> 'avisosConfirmados'
          ELSE '[]'::jsonb
        END
      ) AS aviso
      WHERE i.nfe_id = c.nfe_id
        AND aviso -> 'ciencia' ->> 'id' = c.id::text
   );

COMMIT;
