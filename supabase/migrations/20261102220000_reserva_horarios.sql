-- Horário de entrada e saída próprio de cada reserva.
--
-- Até aqui a reserva guardava só as datas e o horário vinha do cadastro do imóvel. Agora
-- cada reserva tem o seu (early check-in, late checkout): nasce com o padrão do imóvel e
-- pode ser editado no ERP. Quem não informa — o site, uma rotina — recebe o do imóvel.
BEGIN;

ALTER TABLE public.reserva_imovel
  ADD COLUMN IF NOT EXISTS horario_checkin time,
  ADD COLUMN IF NOT EXISTS horario_checkout time;

-- Reservas existentes ficam com o horário que o imóvel tem hoje.
UPDATE public.reserva_imovel r
   SET horario_checkin = coalesce(r.horario_checkin, i.horario_checkin),
       horario_checkout = coalesce(r.horario_checkout, i.horario_checkout)
  FROM public.imovel i
 WHERE i.id = r.imovel_id AND (r.horario_checkin IS NULL OR r.horario_checkout IS NULL);

CREATE OR REPLACE FUNCTION public.imob_reserva_horario_padrao() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF new.horario_checkin IS NULL OR new.horario_checkout IS NULL THEN
    SELECT coalesce(new.horario_checkin, i.horario_checkin), coalesce(new.horario_checkout, i.horario_checkout)
      INTO new.horario_checkin, new.horario_checkout
      FROM public.imovel i WHERE i.id = new.imovel_id;
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS imob_reserva_horario_padrao ON public.reserva_imovel;
CREATE TRIGGER imob_reserva_horario_padrao BEFORE INSERT OR UPDATE OF imovel_id, horario_checkin, horario_checkout
  ON public.reserva_imovel FOR EACH ROW EXECUTE FUNCTION public.imob_reserva_horario_padrao();

REVOKE ALL ON FUNCTION public.imob_reserva_horario_padrao() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.reserva_imovel
  ALTER COLUMN horario_checkin SET NOT NULL,
  ALTER COLUMN horario_checkout SET NOT NULL;

COMMIT;
