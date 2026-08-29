-- Destaque automatico da OS por status na listagem.
--
-- Ate aqui a unica forma de pintar uma OS na lista era o destaque manual, ligado
-- a mao no dialog de detalhes. Isso resolve o caso pontual ("essa OS precisa de
-- atencao"), mas nao o estrutural: a oficina quer bater o olho e saber, pela cor,
-- que toda OS em PAGAMENTO esta esperando o cliente pagar.
--
-- A regra fica indexada pelo proprio status, entao o formato do dado ja garante
-- uma cor por status — nao existe como cadastrar duas regras conflitantes.
-- A validacao da cor (paleta fechada) e do status e feita no PUT /api/config,
-- em src/lib/ordens/destaque.ts; aqui embaixo so garantimos que e um objeto.

ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS destaque_os_por_status jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.config_geral
  DROP CONSTRAINT IF EXISTS config_geral_destaque_os_por_status_obj_chk;

ALTER TABLE public.config_geral
  ADD CONSTRAINT config_geral_destaque_os_por_status_obj_chk
  CHECK (jsonb_typeof(destaque_os_por_status) = 'object');

COMMENT ON COLUMN public.config_geral.destaque_os_por_status IS
  'Regras de destaque automatico na lista de OS, indexadas pelo status. Formato: {"PAGAMENTO": {"cor": "verde", "texto": "Aguardando o cliente pagar"}}. O texto e opcional. O destaque manual da propria OS (ordemservico.destacada) sobrepoe estas regras.';
