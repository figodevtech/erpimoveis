BEGIN;

-- Consumidor Final: cliente do sistema para a venda sem cliente identificado.
--
-- O PROBLEMA
-- A venda exige cliente, e no balcão nem sempre há como pegar os dados. Cada
-- oficina improvisava um cadastro ("VENDA BALCÃO", "CONSUMIDOR/FINAL/BALCÃO")
-- com CPF inventado — que qualquer um podia editar, e que entrava na busca por
-- documento e na NF-e como se fosse gente de verdade.
--
-- A REGRA
-- 1) `codigo_sistema` marca o cadastro que o sistema mantém. Há um só hoje:
--    'consumidor_final', nome CONSUMIDOR FINAL, pessoa física, sem documento.
-- 2) Sem documento de propósito: nenhuma busca por CPF/CNPJ cai nele, e a NF-e
--    não o aceita como destinatário. Só o cadastro do sistema pode ficar sem
--    documento; o de qualquer cliente continua obrigatório.
-- 3) Ninguém altera nem exclui o cadastro do sistema — nem pela tela, nem por
--    rota, nem por SQL. Também não acumula crédito: não há a quem devolver.
--    Uma migration futura que precise mexer nele liga
--    `set local app.cliente_sistema_liberado = 'on'`.
-- 4) `cliente_consumidor_final_id()` devolve o id e cria o cadastro se faltar:
--    banco que nasce de dump só de estrutura também o recebe no primeiro uso.
-- 5) Os cadastros improvisados que já existem ficam como estão.
--
-- ORDEM DO DEPLOY
-- Esta migration antes do código: o código novo lê `codigo_sistema`.

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS codigo_sistema text;

ALTER TABLE public.cliente DROP CONSTRAINT IF EXISTS cliente_codigo_sistema_check;
ALTER TABLE public.cliente
  ADD CONSTRAINT cliente_codigo_sistema_check
  CHECK (codigo_sistema IS NULL OR codigo_sistema IN ('consumidor_final'));

CREATE UNIQUE INDEX IF NOT EXISTS cliente_codigo_sistema_uidx
  ON public.cliente (codigo_sistema)
  WHERE codigo_sistema IS NOT NULL;

COMMENT ON COLUMN public.cliente.codigo_sistema IS
  'Cadastro mantido pelo sistema (consumidor_final). Não pode ser alterado nem excluído.';

-- Documento: obrigatório para todo cliente, menos o do sistema.
ALTER TABLE public.cliente ALTER COLUMN cpfcnpj DROP NOT NULL;
ALTER TABLE public.cliente DROP CONSTRAINT IF EXISTS cliente_documento_obrigatorio_chk;
ALTER TABLE public.cliente
  ADD CONSTRAINT cliente_documento_obrigatorio_chk
  CHECK (cpfcnpj IS NOT NULL OR codigo_sistema IS NOT NULL);

CREATE OR REPLACE FUNCTION public.cliente_sistema_protegido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.codigo_sistema IS NULL OR current_setting('app.cliente_sistema_liberado', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O Consumidor Final é um cadastro do sistema e não pode ser excluído.';
  END IF;
  IF NEW.saldo_credito IS DISTINCT FROM OLD.saldo_credito THEN
    RAISE EXCEPTION 'O Consumidor Final não acumula crédito: não há cliente identificado para receber o saldo.';
  END IF;
  -- Carimbo de atualização sozinho passa (o recálculo do saldo o regrava);
  -- qualquer outro campo, não.
  IF (to_jsonb(NEW) - 'updatedat' - 'updated_by') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedat' - 'updated_by') THEN
    RAISE EXCEPTION 'O Consumidor Final é um cadastro do sistema e não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cliente_sistema_protegido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cliente_sistema_protegido ON public.cliente;
CREATE TRIGGER trg_cliente_sistema_protegido
BEFORE UPDATE OR DELETE ON public.cliente
FOR EACH ROW EXECUTE FUNCTION public.cliente_sistema_protegido();

CREATE OR REPLACE FUNCTION public.cliente_consumidor_final_id()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id integer;
BEGIN
  SELECT id INTO v_id FROM public.cliente WHERE codigo_sistema = 'consumidor_final';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.cliente WHERE nomerazaosocial = 'CONSUMIDOR FINAL') THEN
    RAISE EXCEPTION 'Já existe um cliente com o nome CONSUMIDOR FINAL. Renomeie-o para o sistema criar o Consumidor Final.';
  END IF;

  INSERT INTO public.cliente (tipopessoa, cpfcnpj, nomerazaosocial, status, codigo_sistema)
  VALUES ('FISICA', NULL, 'CONSUMIDOR FINAL', 'ATIVO', 'consumidor_final')
  ON CONFLICT (codigo_sistema) WHERE codigo_sistema IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  -- Outra chamada criou no meio do caminho.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.cliente WHERE codigo_sistema = 'consumidor_final';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cliente_consumidor_final_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_consumidor_final_id() TO service_role;

SELECT public.cliente_consumidor_final_id();

COMMIT;
