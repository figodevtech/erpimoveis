-- Motivo da rejeicao da NF-e.
--
-- Ate aqui o retorno da SEFAZ so aparecia no toast do momento do envio: a rota de
-- autorizacao gravava status = REJEITADA e descartava cStat/xMotivo. Quem abrisse
-- a nota depois nao tinha como saber o que corrigir — a propria UI dizia
-- "Motivo nao esta registrado na tabela de NF-e".
--
-- Campos opcionais: notas antigas seguem sem motivo, e nada quebra.

ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS codigo_rejeicao text,
  ADD COLUMN IF NOT EXISTS motivo_rejeicao text,
  ADD COLUMN IF NOT EXISTS rejeitada_em timestamptz;

COMMENT ON COLUMN public.nfe.codigo_rejeicao IS
  'cStat devolvido pela SEFAZ na ultima rejeicao (ex.: 694).';
COMMENT ON COLUMN public.nfe.motivo_rejeicao IS
  'xMotivo devolvido pela SEFAZ na ultima rejeicao.';
COMMENT ON COLUMN public.nfe.rejeitada_em IS
  'Momento da ultima rejeicao. Limpo quando a nota e autorizada.';

-- Encontrar as notas pendentes de correcao e a consulta natural desta tela.
CREATE INDEX IF NOT EXISTS nfe_rejeitadas_idx
  ON public.nfe (empresaid, rejeitada_em DESC)
  WHERE status = 'REJEITADA'::public.enum_status_nfe AND NOT is_deleted;
