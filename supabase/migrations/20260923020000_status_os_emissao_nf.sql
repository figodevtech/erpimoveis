-- Status de OS que permitem emitir nota fiscal, escolhidos em Configurações Gerais.
--
-- Até aqui a regra era fixa no código, com um único switch
-- (`emissao_nf_ordens_nao_pagas`): desligado, só CONCLUIDO emitia; ligado,
-- também PAGAMENTO e FATURAMENTO. Agora a oficina marca os status.
--
-- O array é do próprio enum, então o banco recusa status inexistente. O CHECK
-- exige ao menos um status (para esconder a emissão existe
-- `emissao_nf_no_modulo_ordens`) e recusa CANCELADO.
--
-- O backfill traduz o switch de cada banco, para ninguém passar a emitir onde
-- hoje não emite. Instalação nova nasce com os três status. O switch antigo
-- fica na tabela, mas o app só o consulta enquanto esta coluna não existir.

ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS emissao_nf_status_os public.enum_status_os[];

UPDATE public.config_geral
   SET emissao_nf_status_os = CASE
         WHEN emissao_nf_ordens_nao_pagas
           THEN ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO']::public.enum_status_os[]
         ELSE ARRAY['CONCLUIDO']::public.enum_status_os[]
       END
 WHERE emissao_nf_status_os IS NULL;

ALTER TABLE public.config_geral
  ALTER COLUMN emissao_nf_status_os
    SET DEFAULT ARRAY['PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO']::public.enum_status_os[];

ALTER TABLE public.config_geral
  ALTER COLUMN emissao_nf_status_os SET NOT NULL;

ALTER TABLE public.config_geral
  DROP CONSTRAINT IF EXISTS config_geral_emissao_nf_status_os_chk;

ALTER TABLE public.config_geral
  ADD CONSTRAINT config_geral_emissao_nf_status_os_chk
  CHECK (
    cardinality(emissao_nf_status_os) >= 1
    AND NOT ('CANCELADO'::public.enum_status_os = ANY (emissao_nf_status_os))
  );

COMMENT ON COLUMN public.config_geral.emissao_nf_status_os IS
  'Status de OS em que a emissão de nota fiscal (NF-e, NFC-e e NFS-e) é liberada. Ao menos um; CANCELADO não entra. Substitui emissao_nf_ordens_nao_pagas.';
