-- Ambiente fiscal único: a empresa manda, todos os modelos seguem.
--
-- Havia duas fontes para a mesma informação: `empresa.ambiente` (a única que a
-- tela de configuração edita) e `nfe_config.ambiente`, uma por modelo. Isso
-- permitia o estado que apareceu na prática: NF-e em produção, NFC-e em
-- homologação, e a tela mostrando um enquanto a emissão usava o outro.
--
-- A regra agora é uma só: quem decide é `empresa.ambiente`. Trocar lá muda
-- tudo. `nfe_config.ambiente` continua existindo — outras partes do sistema
-- leem essa coluna — mas passa a ser um espelho, mantido por trigger para não
-- depender de ninguém lembrar de atualizar os dois lugares.
--
-- ATENÇÃO AOS TIPOS: as duas colunas usam enums DIFERENTES, com os mesmos
-- rótulos:
--
--   empresa.ambiente     -> public.tipo_ambiente      ('PRODUCAO','HOMOLOGACAO')
--   nfe_config.ambiente  -> public.enum_ambiente_nfe  ('HOMOLOGACAO','PRODUCAO')
--
-- O Postgres não compara nem atribui um ao outro diretamente ("operator does
-- not exist: enum_ambiente_nfe = tipo_ambiente"). A ponte é o texto, e por isso
-- todas as comparações e atribuições abaixo passam por `::text`.
BEGIN;

-- 1) Alinha o que está gravado hoje.
UPDATE public.nfe_config c
   SET ambiente = e.ambiente::text::public.enum_ambiente_nfe,
       updatedat = now()
  FROM public.empresa e
 WHERE e.id = c.empresaid
   AND c.ambiente::text IS DISTINCT FROM e.ambiente::text;

-- 2) Mantém alinhado daqui para frente.
CREATE OR REPLACE FUNCTION public.sincronizar_ambiente_fiscal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.nfe_config
     SET ambiente = NEW.ambiente::text::public.enum_ambiente_nfe,
         updatedat = now()
   WHERE empresaid = NEW.id
     AND ambiente::text IS DISTINCT FROM NEW.ambiente::text;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_ambiente_fiscal() IS
  'Replica empresa.ambiente para todas as configuracoes fiscais da empresa. Ambiente fiscal e unico: trocar na empresa muda NF-e e NFC-e juntas.';

DROP TRIGGER IF EXISTS trg_sincronizar_ambiente_fiscal ON public.empresa;

CREATE TRIGGER trg_sincronizar_ambiente_fiscal
  AFTER UPDATE OF ambiente ON public.empresa
  FOR EACH ROW
  WHEN (OLD.ambiente IS DISTINCT FROM NEW.ambiente)
  EXECUTE FUNCTION public.sincronizar_ambiente_fiscal();

COMMENT ON COLUMN public.nfe_config.ambiente IS
  'Espelho de empresa.ambiente, mantido por trigger. Nao editar direto: o ambiente fiscal e definido no cadastro da empresa.';

COMMIT;
