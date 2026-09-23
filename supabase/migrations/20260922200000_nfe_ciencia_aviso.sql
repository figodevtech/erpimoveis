-- Ciência dos avisos fiscais da NF-e, registrada pelo servidor.
--
-- Até aqui a ciência viajava no próprio payload da NF-e
-- (avisosFiscaisConfirmados = ["code@fingerprint"]). O fingerprint provava que
-- a confirmação era da situação atual, mas não que alguém marcou "estou
-- ciente": o algoritmo é determinístico e está no navegador, então um cliente
-- manipulado podia calcular a chave e mandá-la direto.
--
-- Agora o clique chama POST /api/fiscal/nfe/ciencias. O servidor recalcula os
-- avisos do item com o mesmo motor da emissão e grava aqui só o que está
-- pendente de verdade: quem, quando, qual divergência, com quais dados e sob
-- qual regra. Salvar o rascunho consulta esta tabela; o payload deixou de ser
-- prova de ciência.
--
--   escopo       sessão de emissão (UUID gerado pela tela). Liga a ciência
--                ao rascunho antes de ele existir.
--   nfe_id       preenchido quando o rascunho é salvo. Reabrir a nota aceita
--                as ciências já ligadas a ela.
--   item_ref     sourceItemId do item (os:, venda:, entrada:, saida:) ou
--                "#<índice>" na NF-e avulsa.
--   fingerprint  hash dos dados que produziram o aviso + versão da regra.
--   dados        os dados que entraram no fingerprint, legíveis.
--
-- Trilha de auditoria: não se apaga nem se reescreve. O único UPDATE aceito é
-- ligar a linha a uma NF-e (nfe_id NULL -> id) ou desligá-la quando o
-- rascunho é descartado (FK com SET NULL).
--
-- Acesso: RLS ligada, sem policy, GRANT só para service_role. Leitura e
-- escrita passam pelo servidor, com a permissão da rota de emissão.
BEGIN;

CREATE TABLE IF NOT EXISTS public.nfe_ciencia_aviso (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  escopo          uuid NOT NULL,
  nfe_id          bigint REFERENCES public.nfe(id) ON DELETE SET NULL,
  origem_tipo     text NOT NULL,
  origem_id       bigint,
  item_ref        text NOT NULL,
  item_numero     integer NOT NULL,
  code            text NOT NULL,
  fingerprint     text NOT NULL,
  versao_regra    text NOT NULL,
  mensagem        text NOT NULL,
  fontes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  usuario_id      uuid NOT NULL REFERENCES public.usuario(id),
  confirmado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nfe_ciencia_aviso IS
  'Ciência de avisos fiscais da NF-e dada pelo usuário e validada pelo servidor. Trilha de auditoria: somente inclusão. Ver docs/modulos/avisos-fiscais-nfe.md.';
COMMENT ON COLUMN public.nfe_ciencia_aviso.escopo IS
  'Sessão de emissão gerada pela tela; liga a ciência ao rascunho antes de ele ter id.';
COMMENT ON COLUMN public.nfe_ciencia_aviso.nfe_id IS
  'NF-e em que a ciência foi usada. NULL até o rascunho ser salvo ou depois de ele ser descartado.';
COMMENT ON COLUMN public.nfe_ciencia_aviso.item_ref IS
  'sourceItemId do item na origem, ou #<índice> na NF-e avulsa.';
COMMENT ON COLUMN public.nfe_ciencia_aviso.fingerprint IS
  'Hash estável dos dados que produziram o aviso e da versão da regra (src/lib/nfe/issuesFiscais.ts).';
COMMENT ON COLUMN public.nfe_ciencia_aviso.dados IS
  'Os dados que entraram no fingerprint (CFOP, CST, papel da ST, base, componentes, data fiscal...).';
COMMENT ON COLUMN public.nfe_ciencia_aviso.versao_regra IS
  'NFE_FISCAL_RULE_VERSION vigente quando o servidor validou a ciência.';
COMMENT ON COLUMN public.nfe_ciencia_aviso.mensagem IS
  'Mensagem do aviso como o servidor a calculou, não como a tela a mostrou.';

ALTER TABLE public.nfe_ciencia_aviso
  DROP CONSTRAINT IF EXISTS nfe_ciencia_aviso_origem_tipo_valida;
ALTER TABLE public.nfe_ciencia_aviso
  ADD CONSTRAINT nfe_ciencia_aviso_origem_tipo_valida
  CHECK (origem_tipo IN ('AVULSA', 'OS', 'VENDA', 'ENTRADA', 'SAIDA'));

ALTER TABLE public.nfe_ciencia_aviso
  DROP CONSTRAINT IF EXISTS nfe_ciencia_aviso_campos_preenchidos;
ALTER TABLE public.nfe_ciencia_aviso
  ADD CONSTRAINT nfe_ciencia_aviso_campos_preenchidos CHECK (
    btrim(item_ref) <> '' AND btrim(code) <> '' AND btrim(versao_regra) <> ''
    AND btrim(mensagem) <> '' AND item_numero > 0
    AND fingerprint ~ '^fp[0-9]+\.[0-9a-z]+$'
    AND jsonb_typeof(fontes) = 'array' AND jsonb_typeof(dados) = 'object'
  );

CREATE UNIQUE INDEX IF NOT EXISTS nfe_ciencia_aviso_situacao_unica
  ON public.nfe_ciencia_aviso (escopo, item_ref, code, fingerprint);
CREATE INDEX IF NOT EXISTS nfe_ciencia_aviso_nfe_idx
  ON public.nfe_ciencia_aviso (nfe_id) WHERE nfe_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nfe_ciencia_aviso_somente_inclusao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'nfe_ciencia_aviso é trilha de auditoria: não se apaga ciência registrada (id %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(NEW) - 'nfe_id') IS DISTINCT FROM (to_jsonb(OLD) - 'nfe_id') THEN
    RAISE EXCEPTION 'nfe_ciencia_aviso é trilha de auditoria: só nfe_id pode mudar (id %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ligar a uma NF-e (NULL -> id) ou desligar pelo descarte (id -> NULL).
  -- Mover a ciência de uma nota para outra não é permitido.
  IF OLD.nfe_id IS NOT NULL AND NEW.nfe_id IS NOT NULL AND NEW.nfe_id <> OLD.nfe_id THEN
    RAISE EXCEPTION 'ciência % já pertence à NF-e %; não pode ser movida para a %.', OLD.id, OLD.nfe_id, NEW.nfe_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfe_ciencia_aviso_somente_inclusao ON public.nfe_ciencia_aviso;
CREATE TRIGGER nfe_ciencia_aviso_somente_inclusao
  BEFORE UPDATE OR DELETE ON public.nfe_ciencia_aviso
  FOR EACH ROW EXECUTE FUNCTION public.nfe_ciencia_aviso_somente_inclusao();

ALTER TABLE public.nfe_ciencia_aviso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_ciencia_aviso NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfe_ciencia_aviso FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nfe_ciencia_aviso TO service_role;
-- Os privilégios padrão do Supabase dão tudo ao service_role; TRUNCATE passaria
-- por cima do gatilho de linha.
REVOKE DELETE, TRUNCATE ON TABLE public.nfe_ciencia_aviso FROM service_role;
REVOKE ALL ON FUNCTION public.nfe_ciencia_aviso_somente_inclusao() FROM PUBLIC, anon, authenticated;

COMMIT;
