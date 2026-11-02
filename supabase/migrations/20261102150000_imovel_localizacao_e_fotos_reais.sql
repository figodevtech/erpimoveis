-- Anúncio sem campos que o operador não precisa decidir:
-- 1) Bairro, cidade e UF do site são os do endereço cadastrado na aba Geral. O banco copia
--    esses três para endereco_publico a cada gravação; rua, número, complemento e CEP nunca
--    vão para lá. endereco_publico continua guardando só o que é próprio do anúncio
--    (detalhes da localização, latitude/longitude), e todo leitor atual dele segue igual.
-- 2) Fotos são reais por padrão; o operador marca quando forem ilustrativas.
BEGIN;

CREATE OR REPLACE FUNCTION public.imob_sincronizar_localizacao_publica() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  new.endereco_publico := (coalesce(new.endereco_publico, '{}'::jsonb) - 'bairro' - 'cidade' - 'estado')
    || jsonb_strip_nulls(jsonb_build_object(
      'bairro', nullif(btrim(new.endereco->>'bairro'), ''),
      'cidade', nullif(btrim(new.endereco->>'cidade'), ''),
      'estado', nullif(upper(btrim(new.endereco->>'estado')), '')
    ));
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.imob_sincronizar_localizacao_publica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS imob_localizacao_publica ON public.imovel;
CREATE TRIGGER imob_localizacao_publica BEFORE INSERT OR UPDATE OF endereco, endereco_publico ON public.imovel
  FOR EACH ROW EXECUTE FUNCTION public.imob_sincronizar_localizacao_publica();

-- Reaplica nos imóveis já cadastrados (o gatilho roda neste UPDATE).
UPDATE public.imovel SET endereco_publico = endereco_publico;

ALTER TABLE public.imovel ALTER COLUMN fotos_reais SET DEFAULT true;
-- Até aqui o padrão era "ilustrativas" sem o operador escolher; nenhum imóvel foi marcado de propósito.
UPDATE public.imovel SET fotos_reais = true WHERE NOT fotos_reais;

COMMIT;
