-- Permite ordem de servico sem cliente.
--
-- A aplicacao ja tratava o cliente como opcional em todas as camadas:
--   * UI  ("Selecione um cliente cadastrado ou deixe sem cliente")
--   * validacao do formulario (validateAll nunca exigiu cliente)
--   * API /api/ordens/criar ("Envie cliente.id numerico ou cliente null")
-- ...mas o banco nunca foi migrado: `ordemservico.clienteid` e `peca.clienteid`
-- seguiam NOT NULL, entao salvar uma OS sem cliente sempre falhava com 23502.
-- No alvo PECA o erro aparecia primeiro em `peca`, porque a peca e inserida
-- antes da propria OS.
BEGIN;

ALTER TABLE public.ordemservico ALTER COLUMN clienteid DROP NOT NULL;
ALTER TABLE public.peca        ALTER COLUMN clienteid DROP NOT NULL;

COMMENT ON COLUMN public.ordemservico.clienteid IS
  'Cliente da OS. NULL quando a ordem e aberta sem cliente vinculado.';
COMMENT ON COLUMN public.peca.clienteid IS
  'Cliente dono da peca. NULL quando a peca pertence a uma OS sem cliente.';

COMMIT;
