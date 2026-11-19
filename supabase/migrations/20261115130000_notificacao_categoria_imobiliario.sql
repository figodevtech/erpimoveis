-- Categoria IMOBILIARIO na central de notificações.
--
-- Primeiro uso: o proprietário cria, altera ou cancela pelo site um bloqueio de uso próprio do
-- imóvel, e a equipe que acompanha os imóveis é avisada no ERP. A categoria serve para os
-- demais avisos do módulo imobiliário (reservas do site, por exemplo).
--
-- Sem esta migration o aviso é recusado pela constraint; o bloqueio continua valendo e a falha
-- fica no log do ERP ("[imobiliario] notificação do bloqueio").
BEGIN;

ALTER TABLE public.system_notification DROP CONSTRAINT IF EXISTS system_notification_category_check;
ALTER TABLE public.system_notification ADD CONSTRAINT system_notification_category_check CHECK (
  category IN ('MARKETPLACE', 'SALES', 'STOCK', 'FINANCIAL', 'SYSTEM', 'IMOBILIARIO')
);

COMMIT;
